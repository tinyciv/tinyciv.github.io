#!/usr/bin/env python3
"""Run Terraform with the repository's existing local AWS credential support."""
from pathlib import Path
import runpy
import shutil
import subprocess
import sys


if __name__ == '__main__':
    try:
        executable = shutil.which('terraform')
        if not executable:
            raise RuntimeError('Install Terraform 1.13.5 and add it to PATH')
        root = Path(__file__).resolve().parents[2]
        aws_env = runpy.run_path(str(root / 'scripts/aws-command.py'))['aws_env']
        sys.exit(subprocess.call([executable, *sys.argv[1:]], env=aws_env()))
    except (RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
