# AWS access for GitHub Actions

The deployment job exchanges GitHub's OIDC token for a short-lived session on
`arn:aws:iam::780705957578:role/TinyCivGitHubDeploy`. Do not add AWS access keys
to GitHub secrets. Only `tinyciv/tinyciv.github.io` on `main` is trusted. Pull
requests, other branches, forks, and jobs using a GitHub environment have a
different subject and cannot assume this role.

The checked-in [permission policy](actions-deploy-policy.json) permits:

- Reading outputs of the existing `btv-multiplayer` stack.
- Uploading release archives below `releases/` in the existing private bucket.
- Running `AWS-RunShellScript` on the existing TinyCiv instance only.
- Reading SSM agent/command status in Oregon, and verifying the AWS account.

The two SSM read operations require `Resource: "*"`; AWS does not support
resource-specific permission for them. They are constrained to `us-west-2`.
`SendCommand` is scoped to the exact EC2 instance and AWS-managed document
(the document ARN has an empty account segment). This is deployment authority
over the game host, so changes to the main branch and workflow are trusted
code. The role cannot create infrastructure, pass IAM roles, alter IAM, or
upload to unrelated buckets.

## One-time setup

Use the repository's numeric owner and repository IDs from GitHub's repository
metadata. Repositories created after July 15, 2026 use immutable IDs in their
OIDC subject. This repository uses that format; do not replace the IDs with
wildcards or add legacy subjects unnecessarily.

```sh
# Writes trust/permissions for review, without making any AWS calls.
python3 scripts/configure-actions-aws.py --owner-id OWNER_ID --repository-id REPOSITORY_ID
# After review, uses the local administrator's existing credentials.
python3 scripts/configure-actions-aws.py --owner-id OWNER_ID --repository-id REPOSITORY_ID --apply
```

The helper writes `infra/.state/actions-trust.json` and
`infra/.state/actions-permissions.json`. With `--apply`, it verifies the AWS
account, reuses an existing correctly configured GitHub OIDC provider (or
creates one), and creates the dedicated tagged role. It will only update an
existing role with the expected ownership tags and no unrelated policies.
It verifies both policies after applying them. Provider certificate
thumbprints are retrieved by IAM, rather than hardcoded.

Set the repository Actions variable `AWS_DEPLOY_ROLE_ARN` to the printed role
ARN. The backend job needs `id-token: write` and `contents: read`. It should
have no GitHub environment because that changes the trusted OIDC subject.
The bootstrap script is an administrator operation and is never run in CI.

## Runtime safeguards

```sh
python3 scripts/deploy-multiplayer.py --apply --existing-only --wait-for-idle 1200 \
  --origins 'https://tinyciv.github.io,https://d120onxzjgx6ss.cloudfront.net,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5177,http://localhost:5177'
```

Actions must pass `--existing-only`; absent or changing infrastructure fails
without provisioning. The AWS wrapper requires temporary credentials in
Actions and disables local credential/config files and instance metadata.

The idle wait checks all players, including disconnected reconnect
reservations, for up to 20 minutes. A timeout or invalid/unreachable lobby
response fails the deployment without installing a release. Run the failed
job again when rooms are empty. This wait does not close rooms or kick players.
The installer independently checks rooms before staging and immediately
before switching releases under its deployment lock. If a player arrives
after the preflight check, the installer can still defer the release. There
is no admission drain, so the existing brief race between the final check and
restart remains; this is not a zero-downtime server.

Release SHA256 checks, expected-previous-release checks, versioned symlink
switching, local health checks and rollback remain in place. Public API and
frontend health retries have a three-minute deadline. Inspect the
recorded SSM command if a runner is interrupted during deployment; the remote
command may still be running. Do not launch overlapping manual deployments.

The tests need no AWS access:

```sh
python3 -m unittest discover -s tests -p 'test_actions_deploy.py'
```

References: [GitHub OIDC and immutable subjects](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[AWS OIDC provider creation](https://docs.aws.amazon.com/cli/latest/reference/iam/create-open-id-connect-provider.html),
[SSM action/resource support](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ssm.html).
