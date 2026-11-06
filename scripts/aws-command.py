#!/usr/bin/env python3
"""Run AWS CLI without printing credentials; also support legacy export files."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def aws_env():
    env = os.environ.copy()
    credentials = Path.home() / '.aws/credentials'
    # Actions receives short-lived OIDC credentials from configure-aws-credentials.
    # Never fall back to a runner's profile or a developer's legacy export file.
    in_actions = env.get('GITHUB_ACTIONS', '').lower() == 'true'
    if in_actions:
        if not all(env.get(key) for key in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN')):
            raise RuntimeError('GitHub Actions requires temporary AWS credentials from OIDC')
        env['AWS_SHARED_CREDENTIALS_FILE'] = '/dev/null'
        env['AWS_CONFIG_FILE'] = '/dev/null'
        env['AWS_EC2_METADATA_DISABLED'] = 'true'
    elif not (env.get('AWS_ACCESS_KEY_ID') and env.get('AWS_SECRET_ACCESS_KEY')) and credentials.exists():
        content = credentials.read_text()
        if not re.search(r'^\s*\[', content, re.M):
            for key, value in re.findall(r'^\s*(?:export\s+)?(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN))\s*=\s*["\']?([^"\'\n]+)', content, re.M):
                env.setdefault(key, value.strip())
            env['AWS_SHARED_CREDENTIALS_FILE'] = '/dev/null'
    env.setdefault('AWS_DEFAULT_REGION', 'us-west-2')
    env['AWS_PAGER'] = ''
    return env


if __name__ == '__main__':
    executable = shutil.which('aws') or '/opt/homebrew/bin/aws'
    try:
        sys.exit(subprocess.call([executable, *sys.argv[1:]], env=aws_env()))
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
