#!/usr/bin/env python3
"""Defer stack changes while multiplayer rooms contain players/reservations."""
import json
from pathlib import Path
import runpy
import subprocess
import sys


def main():
    if len(sys.argv) != 2:
        raise RuntimeError('Expected the saved Terraform plan path')
    plan_path = Path(sys.argv[1]).resolve()
    plan = json.loads(subprocess.check_output(
        ['terraform', 'show', '-json', plan_path.name], cwd=plan_path.parent, text=True))
    changes = [row for row in plan.get('resource_changes', [])
               if row['address'] == 'aws_cloudformation_stack.multiplayer'
               and row['change']['actions'] != ['no-op']]
    if not changes:
        print('No stack changes; infrastructure idle wait is unnecessary.')
        return
    root = Path(__file__).resolve().parents[2]
    deploy = runpy.run_path(str(root / 'scripts/deploy-multiplayer.py'))
    deploy['verify_account']()
    stack = deploy['stack_status']('btv-multiplayer')
    if not stack or stack['StackStatus'] not in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'):
        raise RuntimeError('Infrastructure changes require the existing stable TinyCiv stack')
    deploy['wait_for_idle'](deploy['outputs'](stack)['BackendUrl'], 1200)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
