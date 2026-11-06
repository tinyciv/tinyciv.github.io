# Live TinyCiv deployment

Primary game address: **https://tinyciv.github.io/**.

Repository: **https://github.com/tinyciv/tinyciv.github.io**, owned by the
`tinyciv` organization created under `ckrapu`. Its `main` branch now contains
source, runtime assets, tests, and the GitHub Actions deployment workflow.
Pushes to `main` test and build the game, deploy the existing AWS server, and
then publish GitHub Pages. See the [workflow runs](https://github.com/tinyciv/tinyciv.github.io/actions/workflows/deploy.yml)
for the current source commit, release checksum, test reports, and deployment status.

The last manually published browser build was commit
`d9d9d646f631fdd7ff559fdec38a593de3a1acdc`, with bundle
`assets/index-MOBi2IBy.js`. It included the Engineer, Brace and Discretion skills,
real-time Leader respawns, hidden observation posts, cheaper scouting and irrigation,
redesigned marauder camps, adaptive two-click construction, and landscape touch controls.
Construction countdowns remain hidden until actual work begins.

Multiplayer server and secondary game address: **https://d120onxzjgx6ss.cloudfront.net**.

The last manual November 5, 2026 release was
`960e09765e83a099e564425764877504299e1b80f63252dec7fd383bab81f159`.
The authority handles the new mechanics and hides concealed observation-post records
from opponents' full snapshots and incremental frames. Both public frontend bundles
were verified byte-for-byte against the tested local build.

Verification: client/server production builds pass; 11 public network checks and
13 two-player browser checks pass, including a landscape touch joystick, independent
commands, reconnect and clean room shutdown. Public single-player checks pass with
all 87 requested assets loading and no browser errors. Local touch checks also cover
independent joystick/steering fingers, adaptive road placement, and building popups.
A paused 4× game was observed waiting ten real seconds before automatic Leader recovery.
The final integration batch passes 156 tests; dedicated camp, research, visibility,
placement and Leader suites also pass. Eight existing terrain-generation checks
remain failing, as reproduced before this release. Evidence is in
`scratch/2026-11-05-feature-release/`, `scratch/2026-11-05-mobile-placement/`,
`scratch/2026-11-05-leader-respawn/`, `scratch/2026-11-05-leader-abilities/`,
`scratch/2026-11-05-observation-posts/`, and `scratch/2026-11-05-marauder-refuge/`.

The following historical infrastructure identifiers remain operational; the
rename does not replace the AWS stack, account, host or service identity.

| Resource | Identifier |
| --- | --- |
| EC2 | `i-047a731995c08404d` — `t3.small`, Amazon Linux 2023, Node 22.23.4 |
| CloudFront distribution | `E2IHBRH1DLHRZO` |
| CloudFront private VPC origin | `vo_5xHl1nPC7DwG5fDek2e9xd` |
| Game security group | `sg-0ffdb36dd76aaa9a0` |
| Private release bucket | `btv-multiplayer-releasebucket-5khoxayaqmw7` |
| Actions deployment role | `TinyCivGitHubDeploy` — temporary credentials, exact repository/main trust |

The application port permits only CloudFront's VPC-origin service security
group. There is no SSH ingress. Management and checksum-verified releases use
SSM. No Bolts service, distribution, database or repository was changed.

Verification:

- November 2 menu update: 183 local layout checks and 71 public browser checks
  passed. Public checks covered Pixel Operator loading, the 50% world backdrop,
  the unframed panel, Controls/Loading layout, concise labels, and text fit at
  1440, 390 and 320 pixels. Screenshots and results are under
  `scratch/2026-11-02-menu-deployment/`; `backend-preservation.json` records
  matching hashes read directly from the host before and after deployment.
- Production frontend and standalone server builds passed.
- Public game HTML, main JavaScript bundles and CSS returned HTTP 200 with
  appropriate content types; both API health and lobby directory passed.
- A same-origin secure WebSocket completed the protocol-1 handshake.
- The public two-client network test passed all 11 checks: room capacity,
  readiness, shared world, independent factions/fog/movement, commands,
  construction replication, invalid-command rejection, reconnect, victory
  and cleanup. See `scratch/2026-11-01-multiplayer/network-report.json`.
- HTTP/asset/WebSocket smoke evidence is in
  `scratch/2026-11-01-multiplayer/deployment-smoke.json`.
- Two fresh public browser sessions passed 13 checks with zero browser errors;
  screenshots and results are in
  `scratch/2026-11-01-multiplayer/production-browser-report.json`.
- The final public generation-cancellation probe passed all 7 checks, including
  the initiator returning to the server browser, the remaining player returning
  to an unready lobby, and both players leaving cleanly. See
  `scratch/2026-11-01-multiplayer/production-cancel-report.json`.
- The service cgroup peaked at 175,259,648 bytes (about 167 MiB) during the
  initial public browser checks, against a 1,400 MiB limit, with no memory-limit or
  OOM events. This short functional run is not a sustained-load benchmark.
  See `scratch/2026-11-01-multiplayer/aws-memory-peak.txt`.

The initial capacity is two simultaneous two-player rooms. Rooms and sessions
are held in memory; restart ends active matches. Deployment refuses replacement
while players or reconnect reservations occupy a room. This is a single host
without seamless failover. The AWS resources incur ongoing charges.

See [README.md](README.md) for release and operational commands. The ignored
`infra/.state/` directory retains the latest artifact manifest, deployment
record and SSM command ID; it contains no application credentials.
