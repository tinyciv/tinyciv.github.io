#!/bin/bash
# A private, checksum-verified release is supplied through SSM.
set -euo pipefail
umask 077
test "$#" -ge 3 -a "$#" -le 4
release=$1
source_dir=$2
origins=$3
expected_release=${4:-}
[[ "$release" =~ ^[a-f0-9]{64}$ ]]
[[ -z "$expected_release" || "$expected_release" =~ ^[a-f0-9]{64}$ ]]
[[ "$origins" =~ ^[A-Za-z0-9:/.,_-]+$ ]]
test -f /var/lib/btv-bootstrap.ready
test -x /usr/bin/node-22
exec 9>/var/lock/btv-release.lock
flock -n 9 || { echo 'Another BTV release is in progress.' >&2; exit 1; }
current=$(readlink /opt/btv/current || true)
if [ -n "$expected_release" ] && [ "$current" != "/opt/btv/releases/$expected_release" ]; then
  echo 'Current BTV release changed; refusing replacement.' >&2; exit 1
fi
verify_empty_rooms() {
 if systemctl is-active --quiet btv.service; then
  curl --fail --silent --max-time 10 http://127.0.0.1:8080/api/lobbies | python3 -c '
import json, sys
rooms = json.load(sys.stdin).get("rooms")
if not isinstance(rooms, list): raise SystemExit("Cannot verify empty BTV rooms")
for room in rooms:
    players = room.get("players")
    count = len(players) if isinstance(players, list) else players
    if not isinstance(count, int) or count != 0: raise SystemExit("BTV players are connected or reserved; release deferred")
'
 fi
}
verify_empty_rooms
target=/opt/btv/releases/$release
install -d -m 0755 "$target/server-dist"
for name in server.mjs match-worker.mjs navigation.wasm; do
  test -s "$source_dir/server-dist/$name"
  install -m 0644 "$source_dir/server-dist/$name" "$target/server-dist/$name"
done
test -s "$source_dir/server-dist/client/index.html"
cp -R "$source_dir/server-dist/client" "$target/server-dist/"
# The private staging directory is created under umask 077. Publish only these
# allowlisted static files with traversal/read permissions for the service user.
chmod -R u=rwX,go=rX "$target/server-dist/client"
runuser -u btv -- test -r "$target/server-dist/client/index.html"
/usr/bin/node-22 --check "$target/server-dist/server.mjs"
/usr/bin/node-22 --check "$target/server-dist/match-worker.mjs"
verify_empty_rooms
config_backup=$(mktemp /var/tmp/btv-env.XXXXXX)
service_backup=$(mktemp /var/tmp/btv-service.XXXXXX)
had_config=false
had_service=false
if [ -f /etc/btv.env ]; then cp /etc/btv.env "$config_backup"; had_config=true; fi
if [ -f /etc/systemd/system/btv.service ]; then cp /etc/systemd/system/btv.service "$service_backup"; had_service=true; fi
trap 'rm -f "$config_backup" "$service_backup"' EXIT
cat >/etc/btv.env.next <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
MAX_ROOMS=2
ALLOWED_ORIGINS=$origins
DATA_DIR=/var/lib/btv
APP_DIR=/opt/btv/current/server-dist/client
EOF
chmod 0600 /etc/btv.env.next
mv /etc/btv.env.next /etc/btv.env
install -m 0644 "$source_dir/infra/tinyciv.service" /etc/systemd/system/btv.service
systemctl daemon-reload
systemctl enable btv.service >/dev/null
ln -sfn "$target" /opt/btv/current.next
mv -Tf /opt/btv/current.next /opt/btv/current
healthy=false
if systemctl restart btv.service; then
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/health | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("ok") is True else 1)' 2>/dev/null; then
      if curl --fail --silent --max-time 2 http://127.0.0.1:8080/ | python3 -c 'import sys; sys.exit(0 if "<html" in sys.stdin.read().lower() else 1)' 2>/dev/null; then healthy=true; break; fi
    fi
    sleep 1
  done
fi
if [ "$healthy" != true ]; then
  systemctl stop btv.service || true
  if [ "$had_config" = true ]; then cp "$config_backup" /etc/btv.env; else rm -f /etc/btv.env; fi
  if [ "$had_service" = true ]; then cp "$service_backup" /etc/systemd/system/btv.service; systemctl daemon-reload; fi
  if [ -n "$current" ]; then
    ln -sfn "$current" /opt/btv/current.next; mv -Tf /opt/btv/current.next /opt/btv/current
    systemctl restart btv.service
    echo 'BTV health check failed; previous release restored.' >&2
  else echo 'Initial BTV release failed; service stopped.' >&2; fi
  exit 1
fi
printf 'BTV release %s is healthy.\n' "$release"
