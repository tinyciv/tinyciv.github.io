#!/usr/bin/env python3
"""Prepare GitHub Actions OIDC access; change IAM only with --apply."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'infra/.state'
ACCOUNT = '780705957578'
REGION = 'us-west-2'
REPOSITORY = 'tinyciv/tinyciv.github.io'
PROVIDER_URL = 'https://token.actions.githubusercontent.com'
PROVIDER_ARN = f'arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com'
ROLE = 'TinyCivGitHubDeploy'
ROLE_ARN = f'arn:aws:iam::{ACCOUNT}:role/{ROLE}'
POLICY = 'DeployExistingTinyCivServer'
TAGS = {'Project': 'BTV', 'Component': 'GitHubActions'}


def aws(*arguments):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/aws-command.py'), '--region', REGION,
                             *arguments, '--output', 'json'], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'AWS command failed')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def trust_policy(owner_id=None, repository_id=None):
    if bool(owner_id) != bool(repository_id):
        raise ValueError('Supply both immutable GitHub IDs, or explicitly select the legacy subject format')
    if owner_id and (not re.fullmatch(r'[1-9][0-9]*', owner_id) or not re.fullmatch(r'[1-9][0-9]*', repository_id)):
        raise ValueError('GitHub owner/repository IDs must be positive integers')
    owner, repository = REPOSITORY.split('/')
    slug = f'{owner}@{owner_id}/{repository}@{repository_id}' if owner_id else REPOSITORY
    return {
        'Version': '2012-10-17',
        'Statement': [{
            'Effect': 'Allow',
            'Principal': {'Federated': PROVIDER_ARN},
            'Action': 'sts:AssumeRoleWithWebIdentity',
            'Condition': {'StringEquals': {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': f'repo:{slug}:ref:refs/heads/main',
            }},
        }],
    }


def optional_aws(*arguments):
    try:
        return aws(*arguments)
    except RuntimeError as error:
        if 'NoSuchEntity' in str(error):
            return None
        raise


def inspect_role():
    """Never repurpose an unrelated role or retain additional unknown privileges."""
    result = optional_aws('iam', 'get-role', '--role-name', ROLE)
    if result is None:
        return None
    role = result['Role']
    tags = {row['Key']: row['Value'] for row in role.get('Tags', [])}
    if any(tags.get(key) != value for key, value in TAGS.items()):
        raise RuntimeError(f'Refusing to modify {ROLE}: its ownership tags do not match')
    if aws('iam', 'list-attached-role-policies', '--role-name', ROLE).get('AttachedPolicies'):
        raise RuntimeError(f'Refusing to modify {ROLE}: unexpected managed policies are attached')
    inline = aws('iam', 'list-role-policies', '--role-name', ROLE).get('PolicyNames', [])
    if set(inline) - {POLICY}:
        raise RuntimeError(f'Refusing to modify {ROLE}: unexpected inline policies exist')
    return role


def apply(trust_path, permissions_path):
    if aws('sts', 'get-caller-identity')['Account'] != ACCOUNT:
        raise RuntimeError('AWS account differs from the reviewed TinyCiv deployment account')
    # Check everything before the first mutation. Shared providers are reused unchanged.
    role = inspect_role()
    provider = optional_aws('iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', PROVIDER_ARN)
    if provider and (provider['Url'].removeprefix('https://') != PROVIDER_URL.removeprefix('https://')
                     or 'sts.amazonaws.com' not in provider['ClientIDList']):
        raise RuntimeError('Existing GitHub OIDC provider has unexpected settings; inspect it before modifying')
    if not provider:
        # IAM obtains the current certificate thumbprint; do not pin an obsolete one.
        aws('iam', 'create-open-id-connect-provider', '--url', PROVIDER_URL,
            '--client-id-list', 'sts.amazonaws.com', '--tags', 'Key=Project,Value=BTV', 'Key=Component,Value=GitHubActions')
    trust_file = 'file://' + str(trust_path)
    if role:
        aws('iam', 'update-assume-role-policy', '--role-name', ROLE, '--policy-document', trust_file)
    else:
        aws('iam', 'create-role', '--role-name', ROLE, '--assume-role-policy-document', trust_file,
            '--max-session-duration', '3600', '--description', 'TinyCiv main-branch Actions deployment to the existing game server',
            '--tags', 'Key=Project,Value=BTV', 'Key=Component,Value=GitHubActions')
    aws('iam', 'put-role-policy', '--role-name', ROLE, '--policy-name', POLICY,
        '--policy-document', 'file://' + str(permissions_path))
    # Read back the applied policy/trust, so a successful result is concrete and reviewable.
    installed_role = aws('iam', 'get-role', '--role-name', ROLE)['Role']
    installed_policy = aws('iam', 'get-role-policy', '--role-name', ROLE, '--policy-name', POLICY)['PolicyDocument']
    if installed_role['AssumeRolePolicyDocument'] != json.loads(trust_path.read_text()):
        raise RuntimeError('Applied role trust differs from the reviewed trust document')
    if installed_policy != json.loads(permissions_path.read_text()):
        raise RuntimeError('Applied permissions differ from the reviewed permissions document')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create/update the dedicated IAM role after reviewing the generated documents')
    parser.add_argument('--owner-id', help='Immutable GitHub organization ID')
    parser.add_argument('--repository-id', help='Immutable GitHub repository ID')
    parser.add_argument('--legacy-subject', action='store_true', help='Only for repositories verified to use the older name-only OIDC subject')
    args = parser.parse_args()
    if args.legacy_subject and (args.owner_id or args.repository_id):
        parser.error('--legacy-subject cannot be combined with immutable IDs')
    if not args.legacy_subject and not (args.owner_id and args.repository_id):
        parser.error('Supply --owner-id and --repository-id, or verify and select --legacy-subject')
    trust = trust_policy(args.owner_id, args.repository_id)
    permissions = json.loads((ROOT / 'infra/actions-deploy-policy.json').read_text())
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    trust_path = STATE / 'actions-trust.json'
    permissions_path = STATE / 'actions-permissions.json'
    trust_path.write_text(json.dumps(trust, indent=2) + '\n')
    permissions_path.write_text(json.dumps(permissions, indent=2) + '\n')
    print(f'Trust: {trust_path}\nPermissions: {permissions_path}')
    print('GitHub subject: ' + trust['Statement'][0]['Condition']['StringEquals']['token.actions.githubusercontent.com:sub'])
    if args.apply:
        apply(trust_path, permissions_path)
        print('Verified IAM role and permissions. Set the GitHub repository variable:')
    else:
        print('Prepared only; no AWS calls made. After review, repeat with --apply. Repository variable:')
    print('AWS_DEPLOY_ROLE_ARN=' + ROLE_ARN)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
