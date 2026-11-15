#!/usr/bin/env python3
"""Run account integration checks against disposable PostgreSQL with TLS."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
container = None

def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()

with tempfile.TemporaryDirectory(prefix='tinyciv-account-tests-') as directory:
    directory = Path(directory)
    try:
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-keyout', str(directory / 'server.key'), '-out', str(directory / 'server.crt'),
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        master_password, app_password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        env_file = directory / 'postgres.env'
        env_file.write_text(f'POSTGRES_PASSWORD={master_password}\nPOSTGRES_DB=tinyciv\n')
        env_file.chmod(0o600)
        container = run('docker', 'run', '-d', '--rm', '--env-file', str(env_file),
                        '--publish', '127.0.0.1::5432', '--mount', f'type=bind,source={directory},target=/cert,readonly',
                        '--tmpfs', '/var/lib/postgresql', '--entrypoint', 'bash', 'postgres:18', '-c',
                        'cp /cert/server.key /tmp/server.key && cp /cert/server.crt /tmp/server.crt && '
                        'chown postgres:postgres /tmp/server.key /tmp/server.crt && chmod 600 /tmp/server.key && '
                        'exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key')
        for _ in range(60):
            ready = subprocess.run(['docker', 'exec', container, 'pg_isready', '-U', 'postgres'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('Temporary PostgreSQL did not become ready')
        port = int(run('docker', 'port', container, '5432/tcp').rsplit(':', 1)[1])
        shared = {'host': '127.0.0.1', 'port': port, 'database': 'tinyciv'}
        app_file, master_file = directory / 'app.json', directory / 'master.json'
        app_file.write_text(json.dumps({**shared, 'username': 'tinyciv_app', 'password': app_password}))
        master_file.write_text(json.dumps({**shared, 'username': 'postgres', 'password': master_password}))
        app_file.chmod(0o600)
        master_file.chmod(0o600)
        env = {**os.environ, 'ACCOUNT_DATABASE_CONFIG': str(app_file), 'ACCOUNT_DATABASE_CA': str(directory / 'server.crt'),
               'ACCOUNTS_TEST_CONFIG': str(master_file)}
        subprocess.run(['node', 'node_modules/vitest/vitest.mjs', 'run', 'infra/accounts-postgres.test.ts'],
                       cwd=ROOT, env=env, check=True)
    finally:
        if container:
            subprocess.run(['docker', 'rm', '-f', container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
