#!/bin/bash
set -euo pipefail
umask 077
dnf install -y nodejs22 awscli-2 python3 tar gzip curl-minimal
systemctl enable --now amazon-ssm-agent
id btv >/dev/null 2>&1 || useradd --system --home-dir /var/lib/btv --shell /sbin/nologin btv
install -d -m 0755 -o root -g root /opt/btv /opt/btv/releases
install -d -m 0700 -o btv -g btv /var/lib/btv
/usr/bin/node-22 --version >/var/lib/btv-bootstrap-node-version
touch /var/lib/btv-bootstrap.ready
