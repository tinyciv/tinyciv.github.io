"""Deployment guards run without AWS access or credentials."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


deploy = load_script('deploy-multiplayer')
credentials = load_script('aws-command')
bootstrap = load_script('configure-actions-aws')


class ExistingInfrastructureTests(unittest.TestCase):
    def test_missing_stack_never_provisions(self):
        args = types.SimpleNamespace(stack='btv-multiplayer', existing_only=True)
        with patch.object(deploy, 'stack_status', return_value=None), patch.object(deploy, 'aws') as aws:
            with self.assertRaisesRegex(RuntimeError, 'infrastructure creation is disabled'):
                deploy.provision(args)
            aws.assert_not_called()

    def test_changing_stack_does_not_wait_or_modify(self):
        args = types.SimpleNamespace(stack='btv-multiplayer', existing_only=True)
        with patch.object(deploy, 'stack_status', return_value={'StackStatus': 'UPDATE_IN_PROGRESS'}), patch.object(deploy, 'wait_stack') as wait:
            with self.assertRaisesRegex(RuntimeError, 'stable stack'):
                deploy.provision(args)
            wait.assert_not_called()

    def test_ready_stack_uses_existing_outputs_only(self):
        args = types.SimpleNamespace(stack='btv-multiplayer', existing_only=True)
        stack = {'StackStatus': 'UPDATE_COMPLETE', 'Outputs': [{'OutputKey': 'InstanceId', 'OutputValue': 'existing'}]}
        with patch.object(deploy, 'stack_status', return_value=stack), patch.object(deploy, 'aws') as aws, redirect_stdout(io.StringIO()):
            self.assertEqual(deploy.provision(args), {'InstanceId': 'existing'})
            aws.assert_not_called()


class IdleWaitTests(unittest.TestCase):
    def response(self, rooms):
        return io.StringIO(json.dumps({'rooms': rooms}))

    def test_reservations_count_even_when_disconnected(self):
        self.assertEqual(deploy.room_player_count({'rooms': [{'players': [{'connected': False}]}]}), 1)

    def test_bad_status_cannot_look_empty(self):
        for payload in ({}, [], {'rooms': None}, {'rooms': [None]}, {'rooms': [{}]},
                        {'rooms': [{'players': '0'}]}, {'rooms': [{'players': False}]}, {'rooms': [{'players': -1}]}):
            with self.subTest(payload=payload), self.assertRaises(RuntimeError):
                deploy.room_player_count(payload)

    def test_busy_server_times_out_without_retrying_install(self):
        with patch.object(deploy.urllib.request, 'urlopen', return_value=self.response([{'players': 1}])) as request, patch.object(deploy.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'idle wait expired'):
                deploy.wait_for_idle('https://example.test', 0)
            request.assert_called_once()
            sleep.assert_not_called()

    def test_wait_continues_after_players_leave(self):
        with patch.object(deploy.urllib.request, 'urlopen', side_effect=[self.response([{'players': 2}]), self.response([])]), patch.object(deploy.time, 'sleep') as sleep, redirect_stdout(io.StringIO()):
            deploy.wait_for_idle('https://example.test', 60)
            sleep.assert_called_once()
            self.assertLessEqual(sleep.call_args.args[0], 30)

    def test_network_failure_fails_closed(self):
        with patch.object(deploy.urllib.request, 'urlopen', side_effect=OSError('offline')):
            with self.assertRaisesRegex(RuntimeError, 'Cannot confirm'):
                deploy.wait_for_idle('https://example.test', 60)


class CredentialsTests(unittest.TestCase):
    def test_actions_uses_only_temporary_environment_credentials(self):
        env = {'GITHUB_ACTIONS': 'true', 'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test', 'AWS_SESSION_TOKEN': 'test'}
        with patch.dict(credentials.os.environ, env, clear=True), patch.object(Path, 'read_text', side_effect=AssertionError('Must not read local credentials')):
            result = credentials.aws_env()
        self.assertEqual(result['AWS_SHARED_CREDENTIALS_FILE'], '/dev/null')
        self.assertEqual(result['AWS_CONFIG_FILE'], '/dev/null')
        self.assertEqual(result['AWS_EC2_METADATA_DISABLED'], 'true')

    def test_actions_does_not_fall_back_when_oidc_was_not_configured(self):
        with patch.dict(credentials.os.environ, {'GITHUB_ACTIONS': 'true'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'temporary AWS credentials'):
                credentials.aws_env()


class PublicHealthTests(unittest.TestCase):
    def test_failing_health_stops_at_deadline(self):
        now = [0.0]
        def sleep(seconds):
            now[0] += seconds
        with patch.object(deploy.time, 'monotonic', side_effect=lambda: now[0]), patch.object(deploy.time, 'sleep', side_effect=sleep), patch.object(deploy.urllib.request, 'urlopen', side_effect=OSError('unreachable')) as request:
            with self.assertRaisesRegex(RuntimeError, 'public CloudFront health'):
                deploy.verify_public_health('https://example.test', timeout=18)
            self.assertEqual(now[0], 18)
            self.assertEqual(request.call_count, 4)
            self.assertEqual(request.call_args.kwargs['timeout'], 3)

    def test_valid_health_requires_frontend_html_too(self):
        health = io.StringIO('{"ok": true}')
        html = io.BytesIO(b'<!doctype html><html></html>')
        html.headers = types.SimpleNamespace(get_content_type=lambda: 'text/html')
        with patch.object(deploy.urllib.request, 'urlopen', side_effect=[health, html]) as request:
            self.assertEqual(deploy.verify_public_health('https://example.test'), {'ok': True})
            self.assertEqual([call.args[0] for call in request.call_args_list], ['https://example.test/api/health', 'https://example.test/'])


class IamScopeTests(unittest.TestCase):
    def test_trust_has_one_exact_main_subject_and_audience(self):
        trust = bootstrap.trust_policy('123', '456')
        statement, = trust['Statement']
        self.assertEqual(statement['Principal'], {'Federated': bootstrap.PROVIDER_ARN})
        self.assertEqual(statement['Condition'], {'StringEquals': {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': 'repo:tinyciv@123/tinyciv.github.io@456:ref:refs/heads/main',
        }})
        self.assertNotIn('*', json.dumps(trust))

    def test_invalid_immutable_ids_are_rejected(self):
        for owner, repo in [('123', None), (None, '456'), ('*', '456'), ('123', '0')]:
            with self.subTest(owner=owner, repo=repo), self.assertRaises(ValueError):
                bootstrap.trust_policy(owner, repo)

    def test_deploy_policy_is_limited_to_existing_resources(self):
        policy = json.loads((ROOT / 'infra/actions-deploy-policy.json').read_text())
        actions = {action for row in policy['Statement'] for action in (row['Action'] if isinstance(row['Action'], list) else [row['Action']])}
        self.assertEqual(actions, {'cloudformation:DescribeStacks', 's3:PutObject', 's3:AbortMultipartUpload', 'ssm:SendCommand', 'ssm:GetCommandInvocation', 'ssm:DescribeInstanceInformation', 'sts:GetCallerIdentity'})
        statements = {row['Sid']: row for row in policy['Statement']}
        self.assertEqual(statements['InstallOnExistingGameServer']['Resource'], [
            'arn:aws:ssm:us-west-2::document/AWS-RunShellScript',
            'arn:aws:ec2:us-west-2:780705957578:instance/i-047a731995c08404d'])
        self.assertEqual(statements['UploadReleaseBundle']['Resource'], 'arn:aws:s3:::btv-multiplayer-releasebucket-5khoxayaqmw7/releases/*')
        self.assertEqual(statements['ReadExistingGameStack']['Resource'], 'arn:aws:cloudformation:us-west-2:780705957578:stack/btv-multiplayer/*')

    def test_unrelated_role_is_not_modified(self):
        with patch.object(bootstrap, 'aws', return_value={'Role': {'Tags': []}}) as aws:
            with self.assertRaisesRegex(RuntimeError, 'ownership tags'):
                bootstrap.inspect_role()
            aws.assert_called_once_with('iam', 'get-role', '--role-name', bootstrap.ROLE)

    def test_existing_role_with_extra_privileges_is_not_modified(self):
        role = {'Role': {'Tags': [{'Key': k, 'Value': v} for k, v in bootstrap.TAGS.items()]}}
        with patch.object(bootstrap, 'aws', side_effect=[role, {'AttachedPolicies': [{'PolicyName': 'AdministratorAccess'}]}]) as aws:
            with self.assertRaisesRegex(RuntimeError, 'unexpected managed policies'):
                bootstrap.inspect_role()
            self.assertEqual(aws.call_count, 2)


if __name__ == '__main__':
    unittest.main()
