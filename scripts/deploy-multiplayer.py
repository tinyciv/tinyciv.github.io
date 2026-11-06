#!/usr/bin/env python3
"""Prepare/deploy only the isolated BTV stack and an allowlisted Node release."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'infra/.state'
REGION = 'us-west-2'
ACCOUNT = '780705957578'
NETWORK = {'VpcId': 'vpc-b000bdd5', 'SubnetId': 'subnet-239e3554', 'CloudFrontServiceSecurityGroup': 'sg-06e81587caba552e4'}
FILES = ['server-dist/server.mjs', 'server-dist/match-worker.mjs', 'server-dist/navigation.wasm', 'infra/tinyciv.service', 'infra/install-multiplayer.sh']


def aws(*arguments, output='json'):
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/aws-command.py'), '--region', REGION, *arguments, '--output', output], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'AWS command failed')
    return json.loads(result.stdout) if output == 'json' and result.stdout.strip() else result.stdout.strip()


def verify_account():
    if aws('sts', 'get-caller-identity')['Account'] != ACCOUNT:
        raise RuntimeError('AWS account differs from the reviewed BTV deployment account')


def stack_status(name):
    try:
        stack = aws('cloudformation', 'describe-stacks', '--stack-name', name)['Stacks'][0]
    except RuntimeError as error:
        if 'does not exist' in str(error):
            return None
        raise
    if not any(tag['Key'] == 'Project' and tag['Value'] == 'BTV' for tag in stack.get('Tags', [])):
        raise RuntimeError('Refusing to use a stack not tagged Project=BTV')
    return stack


def outputs(stack):
    return {item['OutputKey']: item['OutputValue'] for item in stack.get('Outputs', [])}


def wait_stack(name):
    deadline, previous = time.monotonic() + 1800, None
    while time.monotonic() < deadline:
        stack = stack_status(name)
        status = stack['StackStatus']
        if status != previous:
            print(f'BTV stack: {status}', flush=True); previous = status
        if status in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
            values = outputs(stack)
            (STATE / 'outputs.json').write_text(json.dumps(values, indent=2) + '\n')
            return values
        if not status.endswith('_IN_PROGRESS'):
            events = aws('cloudformation', 'describe-stack-events', '--stack-name', name)['StackEvents']
            failures = [{'resource': e.get('LogicalResourceId'), 'reason': e.get('ResourceStatusReason')} for e in events if e.get('ResourceStatus', '').endswith('FAILED')][:5]
            raise RuntimeError(f'BTV stack {status}: {json.dumps(failures)}')
        time.sleep(10)
    raise RuntimeError('BTV stack is still changing; inspect it before retrying')


def provision(args):
    current = stack_status(args.stack)
    if args.existing_only:
        if not current:
            raise RuntimeError('Existing-only deployment requires the existing stack; infrastructure creation is disabled')
        if current['StackStatus'] not in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
            raise RuntimeError(f'Existing-only deployment requires a stable stack: {current["StackStatus"]}')
        print('Existing BTV infrastructure retained; provisioning is disabled.', flush=True)
        return outputs(current)
    if current:
        if current['StackStatus'].endswith('_IN_PROGRESS'):
            return wait_stack(args.stack)
        if current['StackStatus'] not in ['CREATE_COMPLETE', 'UPDATE_COMPLETE']:
            raise RuntimeError(f'Existing BTV stack needs inspection: {current["StackStatus"]}')
        print('Existing BTV infrastructure retained; no stack update requested.', flush=True)
        return outputs(current)
    image = aws('ssm', 'get-parameter', '--name', '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64')['Parameter']['Value']
    template = json.loads((ROOT / 'infra/multiplayer.template.json').read_text())
    template['Resources']['GameServer']['Properties']['UserData'] = {'Fn::Base64': (ROOT / 'infra/bootstrap-multiplayer.sh').read_text()}
    rendered = STATE / 'multiplayer.rendered.json'; rendered.write_text(json.dumps(template, indent=2) + '\n')
    parameters = [{'ParameterKey': key, 'ParameterValue': value} for key, value in {**NETWORK, 'AmiId': image, 'InstanceType': args.instance_type}.items()]
    parameter_file = STATE / 'parameters.json'; parameter_file.write_text(json.dumps(parameters))
    aws('cloudformation', 'validate-template', '--template-body', 'file://' + str(rendered))
    aws('cloudformation', 'create-stack', '--stack-name', args.stack, '--template-body', 'file://' + str(rendered), '--parameters', 'file://' + str(parameter_file), '--capabilities', 'CAPABILITY_IAM', '--tags', 'Key=Project,Value=BTV', 'Key=Component,Value=Multiplayer')
    return wait_stack(args.stack)


def prepare_release():
    inputs = [(name, ROOT / name) for name in FILES]
    client = ROOT / 'dist'
    if not (client / 'index.html').is_file():
        raise RuntimeError('Build the frontend before packaging: dist/index.html is missing')
    inputs += [('server-dist/client/' + str(path.relative_to(client)), path) for path in sorted(client.rglob('*')) if path.is_file() or path.is_symlink()]
    for name, path in inputs:
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            raise RuntimeError(f'Missing or invalid release input: {name}')
    archive = STATE / 'release.tar.gz'
    with archive.open('wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as bundle:
            for name, path in inputs:
                info = bundle.gettarinfo(str(path), arcname=name)
                info.uid = info.gid = info.mtime = 0; info.uname = info.gname = ''; info.mode = 0o644
                with path.open('rb') as source: bundle.addfile(info, source)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    manifest = {'sha256': digest, 'files': [{'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in inputs]}
    (STATE / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Prepared {len(inputs)} allowlisted files; release {digest[:12]}.', flush=True)
    return archive, digest


def ssm(instance, commands, timeout=600):
    payload = {'DocumentName': 'AWS-RunShellScript', 'InstanceIds': [instance], 'Parameters': {'commands': commands, 'executionTimeout': [str(timeout)]}, 'TimeoutSeconds': timeout, 'Comment': 'Isolated BTV multiplayer deployment'}
    path = STATE / 'ssm-request.json'; path.write_text(json.dumps(payload))
    command = aws('ssm', 'send-command', '--cli-input-json', 'file://' + str(path))['Command']['CommandId']
    (STATE / 'last-command.json').write_text(json.dumps({'commandId': command, 'instanceId': instance}) + '\n')
    deadline = time.monotonic() + timeout + 30
    while time.monotonic() < deadline:
        try:
            result = aws('ssm', 'get-command-invocation', '--command-id', command, '--instance-id', instance)
        except RuntimeError as error:
            if 'InvocationDoesNotExist' in str(error): time.sleep(2); continue
            raise
        if result['Status'] == 'Success': return result['StandardOutputContent'].strip()
        if result['Status'] in ['Failed', 'Cancelled', 'TimedOut']:
            raise RuntimeError(f'BTV SSM {result["Status"]}: {result["StandardErrorContent"]}\n{result["StandardOutputContent"]}')
        time.sleep(3)
    raise RuntimeError(f'BTV SSM command {command} still running; inspect before retrying')


def room_player_count(payload):
    """Fail closed if the lobby response cannot prove all rooms are empty."""
    if not isinstance(payload, dict) or not isinstance(payload.get('rooms'), list):
        raise RuntimeError('Invalid lobby response; refusing to assume the server is idle')
    count = 0
    for room in payload['rooms']:
        if not isinstance(room, dict):
            raise RuntimeError('Invalid room status; refusing to assume the server is idle')
        players = room.get('players')
        if isinstance(players, list):
            count += len(players)
        elif type(players) is int and players >= 0:
            count += players
        else:
            raise RuntimeError('Invalid player count; refusing to assume the server is idle')
    return count


def wait_for_idle(endpoint, timeout):
    """Wait without disconnecting players. Installer rechecks locally under its lock."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(endpoint.rstrip('/') + '/api/lobbies', timeout=15) as response:
                count = room_player_count(json.load(response))
        except (OSError, ValueError) as error:
            raise RuntimeError('Cannot confirm that multiplayer is idle; no release installed') from error
        if count == 0:
            print('Multiplayer rooms are empty; continuing deployment.', flush=True)
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError('Multiplayer players are connected or reserved; idle wait expired without installing a release')
        print(f'Waiting for {count} connected/reserved player(s); up to {int(remaining)} seconds remain.', flush=True)
        time.sleep(min(30, remaining))


def verify_public_health(base_url, timeout=180):
    """Bound retries so waiting for CloudFront cannot consume the CI session."""
    deadline = time.monotonic() + timeout

    def request_timeout():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Public health deadline expired')
        return min(15, remaining)

    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base_url + '/api/health', timeout=request_timeout()) as response:
                health = json.load(response)
            if not isinstance(health, dict):
                raise ValueError('Invalid public health response')
            if health.get('ok') is True:
                with urllib.request.urlopen(base_url + '/', timeout=request_timeout()) as response:
                    if response.headers.get_content_type() != 'text/html' or '<html' not in response.read().decode().lower():
                        raise RuntimeError('Public frontend did not return HTML')
                return health
        except (OSError, ValueError, RuntimeError):
            pass
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(min(5, remaining))
    raise RuntimeError(f'Local service is healthy but public CloudFront health did not pass within {timeout} seconds; inspect before retrying')


def deploy(args, values, archive, digest):
    instance, bucket = values['InstanceId'], values['ReleaseBucket']
    ready = False
    for _ in range(60):
        rows = aws('ssm', 'describe-instance-information', '--filters', f'Key=InstanceIds,Values={instance}')['InstanceInformationList']
        if rows and rows[0]['PingStatus'] == 'Online': ready = True; break
        time.sleep(5)
    if not ready: raise RuntimeError('BTV instance has not registered with SSM')
    if args.wait_for_idle is not None:
        wait_for_idle(values['BackendUrl'], args.wait_for_idle)
    previous = ssm(instance, ['set -eu', 'for i in $(seq 1 60); do test -f /var/lib/btv-bootstrap.ready && break; sleep 5; done', 'test -f /var/lib/btv-bootstrap.ready', 'readlink /opt/btv/current || true'])
    expected = previous.rsplit('/', 1)[-1] if previous else ''
    if expected and not re.fullmatch('[a-f0-9]{64}', expected): raise RuntimeError('Unexpected current BTV release path')
    aws('s3', 'cp', str(archive), f's3://{bucket}/releases/{digest}.tar.gz', '--sse', 'AES256', '--only-show-errors', output='text')
    commands = ['set -euo pipefail', 'umask 077', 'stage=$(mktemp -d /var/tmp/btv-release.XXXXXX)', 'trap \'rm -rf "$stage"\' EXIT',
                f'aws s3 cp {shlex.quote(f"s3://{bucket}/releases/{digest}.tar.gz")} "$stage/release.tar.gz" --region {REGION} --only-show-errors',
                f'echo "{digest}  $stage/release.tar.gz" | sha256sum -c -', 'tar -xzf "$stage/release.tar.gz" -C "$stage"',
                f'bash "$stage/infra/install-multiplayer.sh" {digest} "$stage" {shlex.quote(args.origins)} {shlex.quote(expected)}']
    print(ssm(instance, commands), flush=True)
    health = verify_public_health(values['BackendUrl'])
    result = {'release': digest, 'endpoint': values['BackendUrl'], 'health': health, 'instanceId': instance}
    (STATE / 'deployment.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Provision if needed, then deploy the prepared server bundle')
    parser.add_argument('--existing-only', action='store_true', help='Refuse to create or wait for infrastructure; required in GitHub Actions')
    parser.add_argument('--wait-for-idle', type=int, metavar='SECONDS', help='Wait at most this long for empty multiplayer rooms, without interrupting players')
    parser.add_argument('--provision', action='store_true', help='Create only isolated BTV infrastructure')
    parser.add_argument('--status', action='store_true', help='Read current BTV stack outputs only')
    parser.add_argument('--stack', default='btv-multiplayer')
    parser.add_argument('--instance-type', choices=['t3.micro', 't3.small'], default='t3.small')
    parser.add_argument('--origins', default='http://127.0.0.1:5173,http://localhost:5173')
    args = parser.parse_args()
    if os.environ.get('GITHUB_ACTIONS', '').lower() == 'true' and not args.existing_only:
        parser.error('GitHub Actions must use --existing-only')
    if args.existing_only and args.provision: parser.error('--existing-only cannot be used with --provision')
    if args.wait_for_idle is not None and not 0 <= args.wait_for_idle <= 1800:
        parser.error('--wait-for-idle must be between 0 and 1800 seconds')
    if args.wait_for_idle is not None and not args.apply: parser.error('--wait-for-idle requires --apply')
    if not re.fullmatch(r'btv-[A-Za-z0-9-]+', args.stack): parser.error('Stack name must start with btv-')
    if not re.fullmatch(r'[A-Za-z0-9:/.,_-]+', args.origins): parser.error('Invalid origin allowlist')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.status:
        verify_account(); stack = stack_status(args.stack); print(json.dumps(outputs(stack) if stack else {}, indent=2)); return
    if args.provision:
        verify_account(); print(json.dumps(provision(args), indent=2)); return
    archive, digest = prepare_release()
    if args.apply:
        verify_account(); deploy(args, provision(args), archive, digest)


if __name__ == '__main__':
    try: main()
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
