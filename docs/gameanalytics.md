# Usage analytics and game telemetry

The game sends bounded batches to the existing AWS server at `/api/telemetry`.
PostgreSQL stores reports in `telemetry.events`; a durable SQL outbox forwards them
to GameAnalytics through the Collection API. GameAnalytics collection credentials
stay on the server. Browser events contain a random visitor ID, a random visible
session ID, build, world preset, terrain generation style, landform family,
scenario, mode, map dimensions and the metric. Account emails, passwords,
session tokens, world seeds and feedback text are never added to analytics.

## Account and production setup

Setup progress on November 17, 2026: the account is activated, and the
[TinyCiv organization](https://tool.gameanalytics.com/organization/108656/home/overview)
and its TinyCiv Studio have been created. Game registration, collection keys and
the GameAnalytics custom dashboard remain pending because browser control timed
out. The SQL dashboard and deployment configuration are implemented locally;
production has not been deployed or connected to GameAnalytics yet. Continue
with **Create Game** in the existing Studio rather than creating another organization.

1. In GameAnalytics, create an organization/studio and a **TinyCiv** game with the
   JavaScript/WebGL platform. Copy its **game key** and **secret key** from game
   settings. These are Collection API credentials, not a management API token.
2. Create/sign into the owner's normal TinyCiv game account. On the AWS host an
   operator can look up its UUID with `accounts-admin.mjs analytics-account`,
   supplying `{"email":"owner@example.com"}` through stdin and
   `ACCOUNT_DATABASE_CONFIG=/etc/btv-database.json`. The command prints only the
   UUID needed for the allowlist.
3. Populate the existing Terraform-managed Secrets Manager container
   `tinyciv/accounts/analytics` with JSON of this form, using a private file or the
   AWS console rather than shell command arguments:

   ```json
   {"gameKey":"<32 hexadecimal characters>","secretKey":"<collection secret>","adminUserIds":["<TinyCiv account UUID>"]}
   ```

   Empty game/secret keys with a valid allowlist enable the SQL dashboard while
   GameAnalytics setup is pending. An empty allowlist grants nobody access.
   The protected secret can alternatively contain `"adminEmails":["owner@example.com"]`.
   The root installer resolves these against **existing** TinyCiv accounts during
   installation and fails if any requested account is missing. Only the resolved
   UUIDs are written to the runtime configuration; a future registration with an
   allowlisted email cannot silently gain access.
4. Deploy through the repository's existing GitHub Actions workflow. Terraform
   creates only the secret container and grants the existing host role read
   access. The root installer copies its JSON into `/etc/btv-analytics.json`,
   readable only by root and the game service group. The service receives its
   path through `ANALYTICS_CONFIG`. No credentials enter Terraform state, the
   client bundle, CI logs, or the repository.
5. Open `/analytics.html` on the deployed game website and sign in with the
   allowlisted game account. The dashboard shows players, sessions, active play
   duration, attempted/successful worlds, scenario use, FPS, stalls, errors, builds
   and GameAnalytics delivery status. Its `/api/analytics` endpoint requires a
   valid game account token and rechecks the UUID allowlist on every request.
6. In GameAnalytics's realtime event view, confirm `user`, `session_end`, design
   and error events arrive. Create the game usage dashboard from the event
   definitions below. Allow for GameAnalytics processing delay in historical
   charts. This repository does not fabricate telemetry to activate dashboards.

The authorized startup check passed on a frozen source snapshot with
`--capture-feedback --capture-civic --capture-civic-art --capture-analytics`.
Dashboard screenshots use explicitly labeled sample data; no production events
or player feedback were sent by that check.

The client is enabled in production and disabled in development. Set
`VITE_TELEMETRY_ENABLED=true` to enable an explicit development collection build,
or `false` to disable collection in a release. `VITE_TELEMETRY_URL` optionally
overrides the **server origin**; otherwise the account/multiplayer endpoint is
used. Local development can use the existing `?multiplayer=http://127.0.0.1:8080`
override. Malformed/insecure endpoints disable telemetry without blocking the
game. `VITE_BUILD_VERSION` overrides the GitHub commit SHA build label.

Do Not Track, Global Privacy Control and the local preference
`tinyciv-telemetry-disabled=true` disable browser collection. Development and
startup checks do not send analytics by default.

## Events and recommended dashboard widgets

Design event IDs have five bounded segments:
`Metric:WorldPreset:Scenario:Mode:Landform`.

| Metric/event | Meaning | Dashboard widget |
| --- | --- | --- |
| `user`, `session_end` | Visible browser session and its duration | DAU, sessions, retention and session length |
| `WorldTried` | Requested new world/scenario, before loading begins | Attempts by preset/scenario |
| `WorldStarted` | Successfully entered new, saved or multiplayer world | Starts by preset/scenario; compare with attempts |
| `WorldEnded` | Switched away from a world | World exits |
| `PlaySeconds` | Incremental active seconds, excluding menus, pause, hidden tab and game-over | **Sum**, grouped by world/scenario, plus total hours |
| `FPS` | Rendered frame count divided by visible frame duration in the reporting window | **Mean**, grouped by preset/scenario/build |
| `FrameP95Ms` | Approximate frame interval p95 from a fixed 16 ms histogram | Mean p95 by preset/build |
| `Stalls` | Count of visible frame intervals ≥250 ms | **Sum**, grouped by preset/scenario/build |
| `WorstFrameMs` | Longest visible frame interval in the window | Worst-frame trend |
| `LongTaskMs` | Time in browser Long Tasks when the API is supported | **Sum**, by preset/scenario |
| `Errors` | Deduplicated error report count | **Sum**, grouped by world/scenario |
| error category | Redacted message/stack with source, preset, landform, scenario and build | Error inbox / affected sessions |

Custom dimension 01 is the world preset (`continents`, `pangaea`, `fractal`,
`archipelago`, `menu`, `unknown`); 02 is scenario (`none` and the six IDs in
`src/game/scenario-content.ts`); 03 is mode (`menu`, `singleplayer`,
`multiplayer`). The archipelago menu preset uses the existing fractal generator
with its island density/size settings; telemetry retains both that preset and
the underlying style. Design IDs carry these segments because GameAnalytics's
documentation notes that some design/error views do not support custom-dimension
filters. The first-party dashboard groups the actual SQL columns directly.

Default raw-data retention is **90 days**. GA outbox records retry network errors,
429 and 5xx responses, split oversized batches, and expire after seven days or
20 attempts. Permanent 400/401-style responses are rejected without replay:
GameAnalytics may partially accept a 400 batch. The local dashboard still retains
its source events and reports rejected/pending counts. Outbox delivery is at
least once if a server stops after collector acceptance but before marking SQL
records as sent. The same service must have one active forwarding process;
the current deployment runs one server process.

## Cost and accuracy

- Frame sampling performs constant work and uses a fixed 65-bin histogram. No
  world/entity scans, per-frame serialization or per-frame network calls occur.
- Performance and play time aggregate once a minute, on world switches and when
  the page hides. Batches flush every 15 seconds, contain at most 16 events and
  48 KB UTF-8, and retry from a queue capped at 128 events. Error messages are
  capped at 2,000 characters; repeated identical errors are limited to one per
  minute, 20 reports/minute and 100 per page lifetime. Counts therefore represent
  deduplicated reports, not every exception occurrence.
- A random visitor UUID persists per browser. Clearing browser storage creates
  a new visitor. Anonymous analytics never joins account identity. Feedback can
  include the visitor/session context separately in the private accounts schema.
- Closing or crashing before a heartbeat flush can lose up to a minute of play
  time. Pending events are persisted before dispatch and on page hide. Browser
  blockers, privacy preferences and offline queue bounds also cause undercounts.
- Visible stalls longer than five seconds are included. A single interval's
  contribution to active play time is capped at five minutes to bound accidental
  computer-sleep time. Long Tasks are browser-dependent. SQL FPS uses total
  frames/time (weighted); GA's `FPS` widget averages reporting-window values.
- Retention and outbox work use bounded indexed batches. Dashboard reads use
  fixed 1/7/30-day windows and bounded output groups. Ingestion validates enums,
  sizes and numeric bounds, deduplicates event UUIDs, and rate limits IP/visitor.

Official references: [Collection API setup](https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/setup/),
[event types and schemas](https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/event-types/),
[collection limitations](https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/api/limitations/),
[JavaScript SDK](https://docs.gameanalytics.com/event-tracking-and-integrations/sdks-and-collection-api/open-source-sdks/javascript/).
