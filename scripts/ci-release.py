#!/usr/bin/env python3
"""Record and verify the exact tested client/server artifacts passed between CI jobs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'output/ci-release.json'
BUILD_DIRS = ('dist', 'server-dist')
REQUIRED = ('dist/index.html', 'dist/wasm/navigation.wasm',
            'server-dist/server.mjs', 'server-dist/match-worker.mjs', 'server-dist/navigation.wasm')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_commit():
    commit = os.environ.get('GITHUB_SHA') or subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('Missing or invalid source commit')
    return commit


def build_files():
    files = []
    for folder in BUILD_DIRS:
        directory = ROOT / folder
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f'Missing or symlinked build directory: {folder}')
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ValueError(f'Refusing symlink in release: {path.relative_to(ROOT)}')
            if path.is_file():
                files.append({'path': path.relative_to(ROOT).as_posix(),
                              'bytes': path.stat().st_size, 'sha256': digest(path)})
    found = {entry['path'] for entry in files}
    if missing := set(REQUIRED) - found:
        raise ValueError(f'Missing required build files: {sorted(missing)}')
    return files


def summary(markdown):
    if destination := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(destination, 'a') as output:
            output.write(markdown + '\n')
    print(markdown, flush=True)


def prepare():
    files = build_files()
    manifest = {'source_commit': source_commit(), 'run_id': os.environ.get('GITHUB_RUN_ID'),
                'files': files}
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    checksum = digest(MANIFEST)
    if destination := os.environ.get('GITHUB_OUTPUT'):
        with open(destination, 'a') as output:
            output.write(f'sha256={checksum}\n')
    summary(f'### Tested release\n\nSource: `{manifest["source_commit"]}`\n\n'
            f'{len(files)} files, {sum(entry["bytes"] for entry in files):,} bytes.\n\n'
            f'Manifest SHA-256: `{checksum}`')


def verify():
    expected = os.environ.get('EXPECTED_MANIFEST_SHA256')
    if not expected or digest(MANIFEST) != expected:
        raise ValueError('Artifact manifest checksum does not match the build job')
    manifest = json.loads(MANIFEST.read_text())
    if manifest['source_commit'] != source_commit():
        raise ValueError('Artifact source commit differs from this workflow run')
    if manifest['files'] != build_files():
        raise ValueError('Build artifacts changed after testing (missing, extra, or modified files)')
    print(f'Verified {len(manifest["files"])} build files from {manifest["source_commit"]}.')


def report():
    destination = ROOT / 'output/ci-deploy'
    destination.mkdir(parents=True, exist_ok=True)
    # Publish only known reports. Never upload the AWS credential chain, request
    # payloads, or the entire infra/.state directory.
    for name in ('release-manifest.json', 'deployment.json', 'last-command.json'):
        path = ROOT / 'infra/.state' / name
        if path.is_file():
            shutil.copy2(path, destination / name)
    if MANIFEST.is_file():
        shutil.copy2(MANIFEST, destination / MANIFEST.name)
    result_path = destination / 'deployment.json'
    if result_path.is_file():
        result = json.loads(result_path.read_text())
        if not re.fullmatch('[a-f0-9]{64}', result['release']):
            raise ValueError('Invalid deployment release digest')
        if output_path := os.environ.get('GITHUB_OUTPUT'):
            with open(output_path, 'a') as output:
                output.write(f'release={result["release"]}\n')
        summary(f'### Multiplayer deployed\n\nSource: `{source_commit()}`\n\n'
                f'Release SHA-256: `{result["release"]}`\n\nEndpoint: {result["endpoint"]}')
    else:
        summary('### Multiplayer deployment incomplete\n\nThe Pages deployment remains blocked. '
                'See the deployment log for the failure or active-match timeout.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'verify', 'report'))
    args = parser.parse_args()
    try:
        {'prepare': prepare, 'verify': verify, 'report': report}[args.command]()
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f'{error}\n')
