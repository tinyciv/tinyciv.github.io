# TinyCiv hosting

The `btv-multiplayer` CloudFormation stack is separate from Bolts. It uses one
Oregon `t3.small` (2 GiB RAM, standard CPU credits), Amazon Linux 2023, Node 22,
an encrypted 12 GiB root disk, and its own security group, instance role and
private release bucket. The existing VPC/subnet and AWS-managed CloudFront
service security group are referenced without modifying the Bolts stacks.

CloudFront supplies a default HTTPS hostname and WSS at `/api/ws`. Its VPC
origin reaches the instance's private address on port 8080. The instance has
an outbound public address for package downloads and SSM, but its only inbound
rule permits the CloudFront service security group on port 8080; there is no
SSH ingress. TLS terminates at CloudFront. No load balancer or GameLift fleet
is provisioned. [CloudFront supports WebSockets through VPC origins](https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-cloudfront-websockets-vpc-origins/).

GitHub Pages serves the primary frontend at `https://tinyciv.github.io/`.
The production build sets `VITE_MULTIPLAYER_URL` to
`https://d120onxzjgx6ss.cloudfront.net`; Pages cannot run the authoritative server.
The `main` branch of `tinyciv/tinyciv.github.io` contains the game source and
licensed runtime assets. GitHub Actions builds and deploys the site; generated
client/server bundles are workflow artifacts, not commits. GitHub Pages must use
**GitHub Actions** as its build source. `npm run pages:prepare` prepares the
browser-only artifact in ignored `output/tinyciv-pages/`; `.nojekyll` preserves
game assets. Local saves, credentials and deployment records remain excluded.
`.env.production` contains only the public multiplayer URL.

The same multiplayer server also serves the built frontend from `server-dist/client`, the lobby
API, and WebSockets. Frontend multiplayer can use its own origin. CloudFront
forwards viewer headers, cookies and query strings with caching disabled;
the server can set browser cache headers for fingerprinted assets.

`infra/tinyciv.service` is installed under the existing operational name
`btv.service` and runs unprivileged as `btv`, with a 1400 MiB process-group memory
limit. The existing AWS stack, service account and installation paths retain their
original `btv` identifiers to avoid replacing running infrastructure.
The deployment allows two rooms; each active match has a worker
with a 384 MiB heap limit. The application is
denied access to instance metadata; only the SSM deployment commands use the
instance role. Node is called by its versioned `/usr/bin/node-22` path, as
described in the [Amazon Linux Node.js documentation](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).

Rooms and sessions are ephemeral. There is no game database or match-state
backup; restarting the service ends existing matches. The installer defers
updates while a room contains players or reconnect reservations. It stages a
versioned release, checks both JavaScript bundles, atomically switches the
current symlink, and rolls back the previous release, service and environment if local
API or frontend HTML health fails. Published static files are explicitly readable
by the service user; private release staging remains restricted. The private release bucket is retained on stack deletion and
expires release archives after 90 days. The instance's ephemeral root disk is
deleted with its instance.

## Build and deploy

The [deployment workflow](../.github/workflows/deploy.yml) runs for pushes to
`main`, pull requests targeting `main`, and manual **Run workflow** requests.
It installs the locked dependencies on Node 22, builds navigation WASM, runs the
game test gate, type-checks and builds both client and server, then exercises an
isolated local multiplayer match and the production UI in Chromium. Test reports
and desktop/mobile screenshots are retained with the workflow run. The test gate
documents the existing terrain assertions in `tests/ci-known-failures.json`;
unexpected failures and runtime/collection errors fail the release.

Only the original repository's `main` branch can deploy. After tests pass, the
server job verifies every downloaded artifact's SHA-256 and source commit,
obtains short-lived AWS credentials using GitHub OIDC, and updates the existing
stack. It waits up to 20 minutes for occupied rooms to empty; if the wait expires,
the deployment fails without replacing the server or publishing the new Pages
build. The Pages job runs only after the server passes its health checks. Releases
are serialized, and an in-progress release is never cancelled by a newer push.
Pull requests only test and build; they receive neither AWS credentials nor Pages
write access. Actions are pinned to immutable commit hashes.

Set repository variable `AWS_DEPLOY_ROLE_ARN` to the role created using
[the AWS OIDC setup instructions](ACTIONS-AWS.md). No long-lived AWS access-key
secrets are needed. Use the `github-pages` environment for Pages and restrict its
deployment branches to `main`. Deployment logs, checksums and release identifiers
are retained as workflow artifacts; build products are not pushed to a branch.

For local validation and an explicit manual server deployment:

The deployment is pinned to the reviewed AWS account and Oregon network.
`scripts/aws-command.py` uses the existing AWS credential chain and supports
the laptop's legacy export-format credentials without printing or copying
credential values. Never include credentials in frontend environment files.

```sh
npm ci
npm run build:wasm
npm run test:ci
npm run build
npm run build:server
npx --no-install playwright install chromium
node scripts/ci-smoke.mjs
npm run pages:prepare
# Local-only: build an allowlisted archive and SHA256 manifest.
python3 scripts/deploy-multiplayer.py
# Read the existing stack outputs.
python3 scripts/deploy-multiplayer.py --status
# Install the current server and frontend bundle; preserve existing infrastructure.
python3 scripts/deploy-multiplayer.py --apply --existing-only --wait-for-idle 1200 --origins 'https://tinyciv.github.io,https://d120onxzjgx6ss.cloudfront.net,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5177,http://localhost:5177'
```

The release includes only `server.mjs`, `match-worker.mjs`, `navigation.wasm`,
the service/installer, and generated files below `dist/`. Symlinks are rejected.
It excludes source trees, local saves, environment files and credentials.
Artifacts, checksums, AWS outputs and command IDs are in ignored `infra/.state/`.
The deployer verifies the expected AWS account and `Project=BTV` stack tag,
uses an instance deployment lock and previous-release check, uploads a private
checksum-addressed S3 archive, then installs it through SSM. Ordinary application
updates do not modify CloudFormation or replace instances.

Creating infrastructure is a separate, deliberate operation using `--provision`;
the Actions deployment role cannot create or update the stack.
The first infrastructure creation can take several minutes while IAM, EC2,
the private origin and CloudFront finish. If interrupted, inspect `--status`
and `infra/.state/last-command.json` before retrying. A pending stack creation
is resumed instead of blindly creating another stack. Failed stacks require
inspection; the helper does not automatically destroy or recreate them.

## Verify and operate

Check the game HTML at `/`, its static assets, and both `GET /api/health` and
`GET /api/lobbies` at the CloudFront hostname.
Then run the two-client multiplayer check against `/api/ws` and use two fresh
browser sessions to verify create/join, readiness, independent player controls,
state replication, reconnect and clean room removal. Local HTTP health alone
does not establish browser CORS or public WebSocket behavior.

```sh
MULTIPLAYER_URL=https://d120onxzjgx6ss.cloudfront.net MULTIPLAYER_ORIGIN=https://tinyciv.github.io npm run test:multiplayer
GAME_URL=https://tinyciv.github.io npm run test:multiplayer:browser
```

This check creates a temporary two-player room and removes it on completion.

Through SSM, inspect `systemctl status btv.service` and `journalctl -u
btv.service` without printing `/etc/btv.env`. Check CPU credits, process memory,
tick timings and network throughput before increasing `MAX_ROOMS`. The current
configuration is a single host without seamless failover. The multiplayer API depends on that host; GitHub Pages continues serving
single-player independently.

Cloud resources incur ongoing compute, storage, public IPv4 and bandwidth
charges. Changing instance size or deleting infrastructure is a deliberate
maintenance action; the normal application deployer leaves infrastructure
unchanged. No Bolts endpoint, binary, database, role, bucket or service is
replaced by this deployment.
