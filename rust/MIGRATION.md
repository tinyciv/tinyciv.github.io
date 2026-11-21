# Simulation migration ledger

The requested endpoint is a Rust/bevy_ecs simulation preserving existing game
behavior, with the requested XP, Keep price, farm/house price, pathfinding, and
enemy engagement corrections. The first set of native systems is integrated;
the full migration remains active.

## Integrated

- Required raw WebAssembly core, native Rust builds/tests, and locked Cargo
  dependencies. Browser, headless tools, standalone labs, and multiplayer load
  the same artifact.
- Entity lifetime and role queries use bevy_ecs, replacing bitECS. Ordering,
  immutable cached views, membership revisions, and speculative IDs survive.
- Navigation is Rust: A*, multi-source search, travel-time and nearest-city maps.
  Search memory is resident and queries do not call JavaScript.
- XP, skill learning, death penalties, construction price constants, treasury
  charges, veterancy, equipment, and damage arithmetic execute in Rust.
- Cadence arithmetic executes in Rust; TypeScript retains FIFO task admission.
- Population growth is an ordered Bevy schedule with persistent city/home pools.
- Health initialization/regeneration uses persistent Bevy components/schedules,
  reusable buffers, and separate initialization/regeneration worlds.
- Commander bounty is 960 XP, Keep conversion costs 1000 gold, and current farm
  and house prices rose 30% from 7.5/32.5 to 9.75/42.25.
- Missing leader breadcrumbs lead to reachable rally goals. Rally positions
  prefer nearby rooms over gates. Patrol armies initiate reachable local combat,
  and distant escorts defend themselves before regrouping.

- Movement execution is native inside simulation frames. `movement_steer` is
  an atomic ordered command at the existing `advanceUnit` call site: Rust
  computes the step, defensive-post bound, occupancy and swept terrain checks
  (faction structures, guard boundary, forbidden cells, player-push exit-only
  rule), single-axis slides, moving/facing, and writes the resident transform.
  A blocked step into a traversable occupied cell returns traffic so the host
  arbitrates the friendly/neutral yield before any slide. Work and trade views
  probe their own resident geometry engine.
- Post-loop collision separation (`movement_separate`) runs natively over
  resident actors in original active order with the existing correction
  limits, segment-continuity and post rules, and reindexes moved tiles.
- Direct public `moveUnit` calls outside a frame (fixtures, editor) keep the
  scalar fallback; nothing in `stepGame` uses it.

- Settlements are native (`settlement.rs`, `affiliation.rs`, `village_plan.rs`;
  design: `docs/loyalty-affiliation-design.md`). One affiliation score (0–100)
  per settlement and civilization replaces `CityLoyalty`, `Faction.affinity`
  and the TypeScript village relation fields: culture alignment, decayed trade,
  and threat sensed at 1 Hz from the `movement.rs` sector census (O(1) per actor
  sector change; no all-pairs scans), integrated every 5 s with elapsed time
  chunked. Rust owns secession decisions, village relations/trade ledger/
  treasury, the hostility matrix, identity bonuses, AI village diplomacy,
  confederation (deterministic threshold, refusal cooldown, petitions),
  civilization confederation rolls, and village evolution (five stages, four
  layout families, staggered 60/90 s clocks, at most 4 outstanding build
  requests, adoption of nearby faction buildings, claims). TypeScript
  (`settlement-bridge.ts`, `settlement-step.ts`, `settlement-transfer.ts`,
  `village-sites.ts`, `placement-physical.ts`) only encodes host rows, places
  approved buildings through physical validation, executes approved ownership
  transfers and formats UI. Saves are version 7 with a sparse binary snapshot
  (`GameState.settlementCore`) flushed inside `assembleSave`. `loyalty.ts`,
  `loyalty-model.ts`, `city-secession.ts` and `village-relations.ts` are deleted.

- Staged engines that TypeScript still drives per call, with TypeScript as the
  authority: `path_budget.rs` (eight-request FIFO path admission, hidden-marauder
  retry windows), `projectiles.rs` (flight advance and impact damage, rebuilt
  from host rows every frame), `morale.rs` (casualty history, pressure, morale
  integration, rout/rally and commander shock over host-sampled perception),
  `construction.rs` (site lifecycle modes, durations, refunds, repair and the
  stroke rasterizer, re-imported from `Building.construction` per command),
  `research.rs` (graph, focus/priority, funding, refunds and completion,
  reloaded from `Faction.research` on every call) and `census.rs` (8x8 sector
  armed census maintained by movement for settlement sensing).
- Step 03, entity authority (2026-11-14; the outbox, `sim-mirror.ts` and the fixture seed/patch API are deferred
  to the first step that makes an entity field Rust-owned, so no unused transport ships). Units and buildings
  are entities of the game's World (`sim/entities.rs`: `SimId`, `Sequence`, `Roles`, `UnitTraits`,
  `BuildingTraits`, `Sleeping`; resource `EntityTables`). Rust owns lifetime, array order (registration
  sequence), sleeping, the 12 unit and 12 building role masks (recomputed from published kind/flag/health
  scalars; kind tables in `sim/kinds.rs`), per-role ordered views and counts, the membership revision and ID
  allocation (lazy first scan, never reused afterwards, speculative negative IDs ignored). `entity-store.ts`
  keeps the id-to-object map, the observers and caches derived from native answers (role views dropped on the
  changed role bits each mutation returns, array-order lookup, last revision). Deleted: `entities.rs`, the
  `collection_*` ABI, `RustEntityCollection`, engine kinds 11/12, the TypeScript mask computation,
  `nextEntityId`, `arrayOrders` and the sleeping WeakSet. ABI 5.
- Resident building index (`sim/structures.rs`, resource `StructureIndex` over `Structure` components on the
  building entities; bridge `src/game/structure-index.ts`). One row per building (owner, footprint, kind,
  alive/present/ready), republished only when the entity store adds or reclassifies it or an observed scalar
  changes; open construction sites are rechecked per query; removal follows the entity. Rust owns: the nearest
  refuge for a fleeing unit (per-faction R-trees; distance, then building order), shelter within a radius for
  morale, the wall cells javelins arc over, solid footprints for merchant road laying, the per-step partition of
  defensive buildings among palaces, and ordered owner/kind/state queries (`structuresOf`). These replace
  whole-list scans of `state.buildings` in `updateFleeing`, `updateMorale`, `hasAttackContact`, `palaceDefenses`,
  `recordMerchantRoad`, faction strategy, archery/blacksmith/dock lookups, and feed the geometry revision that lets
  `beginUnitFrame` skip its per-building comparison. `buildingWithId` replaces id lookups written as scans.
- Step 04, first part (2026-11-14). `sim/work.rs`: the recurring work scheduler is a resource of the game's
  World: interned work keys with stable IDs for the 31 production keys (background 0.5 s versus 3 Hz cadence,
  the four budgeted keys, FNV phase of the key string), resident clocks, the FIFO interactive budget and the
  immediate/deferred scopes. `work-cadence.ts` interns key names, forwards the host clock and reports a replaced
  store/world; the `cadence_observe_work`/`cadence_commit_work` ABI is gone. `sim/marauders.rs`: frame counter,
  five-frame phases and pending time of hidden-marauder unit and formation clocks (cleared on despawn and on a
  state import); `marauder-schedule.ts` supplies only human visibility, in the original evaluation order.
  `DecisionRevision` is a World resource (`invalidateDecisions`/`decisionRevision`).
  Not moved, by decision: the per-entity `DecisionClock` holders (about 30 sites), `SimulationEvents` and
  `settlement-decisions.ts`. Their arithmetic is already `cadence::decision_due`; each holder also carries the
  cached decision it gates, so the clock becomes a native component in the step that moves that rule (13, 25-28,
  34-36, 49) instead of being split from its data now.
- Verification status of the three entries above: `cargo check --tests`, the three TypeScript checks and the wasm
  build pass; `scratch/sim-digest.mjs` (advanced start, default interactive, duel, and a 1,480-unit save) is
  bit-identical to the pre-step-03 tree on all 19 checkpoints after each of them. `cargo test`, vitest, the orchestration trace
  and the parity compare have NOT been run for them (test runs need the user's go-ahead).
- Step 01 safety net (moves no rule code, deletes nothing):
  `tests/orchestration-trace.test.ts` runs three seeded fixtures (the
  `combat-600` performance crowd with 100 HP soldiers, a 96x72
  `createGame` settlement/economy seed, a 96x72 `createDuelGame`) for 600
  direct-path substeps. It records every update, substep, `stepGame` phase,
  recurring work key and settlement decision actually run, with the mulberry32
  draws since the previous event (derived from `rngState`, no per-generator
  hooks), plus canonical SHA-256 digests of units, buildings, factions,
  rngState, time and tick at substeps 100/200/400/600. Golden values:
  `tests/fixtures/orchestration-trace.json` (re-baseline with
  `UPDATE_ORCHESTRATION_TRACE=1`); a second in-process run must reproduce the
  first 100 substeps, and the trace holds with one worker and with
  `--no-isolate`. The debug-only sink is `src/game/orchestration-trace.ts`
  (one undefined check per call site; phases are named markers in `stepGame`,
  work keys come from `runRecurringWork`/`runSettlementDecision`). The digest
  helper moved to `tests/helpers/state-digest.ts` (the multicore lab imports it).
- The host wall clock is injected: `updateGame(..., { wallNow })`,
  `updateLeaderRespawns(state, wallNow)`, `recordLeaderDeath(state, leader, now)`
  and `leaderRespawnRemainingSeconds(state, faction, now)` take it explicitly;
  deaths inside a step use the last host-supplied value (per-game host memory,
  never saved, 0 until supplied). `main.ts` and `server/match-worker.ts` pass
  `Date.now()`; tests and `scripts/sim-parity.mjs` pass fixed or simulated
  clocks (the harness now throws if the simulation reads `Date.now`). Nothing
  under `src/game` reads `Date.now`.
- `src/game/native-owned-fields.ts` is the (empty) registry of Rust-owned
  Unit/Building/Faction/GameState/Tile fields plus the bridge allowlist;
  `tests/native-field-ownership.test.ts` scans `src/` and `server/` for writes
  (assignment, compound, ++/--, delete, bracket, `Object.assign`) outside the
  allowlist and also guards against wall-clock reads in `src/game`.
  `tests/helpers/native-fixture.ts` is the seed/patch API shell (today a thin
  wrapper over the entity store; later steps reroute it to native commands).
  Verified 2026-11-13: parity compare PASS with all 20 checkpoint hashes
  MATCH (`scratch/rust-migration/step-01/`); full vitest run has no new
  deterministic failure identity (11 load-induced timeouts all pass alone).
- Every native subsystem still owns a separate handle-addressed World in a
  `thread_local` registry in `lib.rs`; there is no shared simulation World or
  Rust step schedule yet. The ABI version is 2 (`rust-runtime.test.ts` still
  expects 1, a recorded baseline failure).

## Plan

Numbered, agent-sized steps; each moves at most about 1500 TypeScript rule
lines and is verified on its own. The machine-readable copy with full scope and
acceptance criteria per step is `scratch/rust-migration/plan.json` (written
from the same source; keep both in sync when the plan changes). The baseline
to compare against is `scratch/rust-migration/baseline/` (failure identities
in `failures.json`, the parity band in `parity.json` and the perturbed runs).

The order follows the ledger (movement state, combat, tactical and strategic
planners, construction and workforce, harvest and couriers, trade, research,
culture and loyalty, visibility, world creation, command validation, then one
authority and the native actor dispatcher), preceded by foundations that every
later step builds on. Terrain rules and territory/culture (steps 6, 7, 18), the
hostility matrix (19), resident research (20) and the treasury (21) come earlier
than their ledger position because movement, combat, AI, validation and farms
all read them; moving them first avoids interim host uploads.

### Invariants

- One authority: every new component and resource lives in the shared sim World created in step 02 (one handle per GameState). No new handle-addressed engine registries.
- Ordering: keep the stepGame phase order and the sequential actor loop. Atomic native commands at existing call sites; drain events synchronously after each command. Never batch per-actor intents after the loop; the native dispatcher (step 67) stays sequential in ActorOrder.
- Determinism: explicit row order, never archetype order; stable sort_by where JS used Array.sort; Map/Set insertion order reproduced; all RNG through the native Rng; V8-exact math through jsmath.rs.
- Performance (skills/performance.md): keep slow sensing clocks (CHECK_INTERVAL, 0.5 s, 1 Hz, 3 Hz), the 8-request path budget, bounded per-frame queues, spatial indexes and counters instead of scans, reusable buffers, batched due queries instead of per-entity FFI calls.
- WASM memory growth: call the Rust function that may grow memory before creating typed arrays over rustEngine.memory.buffer; copy results before the next rule call.
- TypeScript reads compact changed-entity rows and events from the outbox (step 03). No property proxies, no full-world JSON transfers, no per-call full-state uploads.
- Tests mutate state only through tests/helpers/native-fixture.ts (seed/patch commands) or real commands; the bounded upsert stays test/editor only.
- Saves: each step adds its native section to GameState.simCore (step 02); no save migration; old saves may break.
- Balance: no gameplay change except changes recorded in this ledger. The leader respawn deadline stays wall-clock based, supplied by the host.

### Standard gates for every step

- npm run build:wasm && npm run test:rust pass (new Rust tests included).
- npx tsc --noEmit and npx tsc --noEmit -p stories/tsconfig.json are clean.
- npx vitest run --dir tests <listed substrings>, then the full npx vitest run --dir tests: no failure identity outside scratch/rust-migration/baseline/failures.json (compare by identity; a new timeout counts only if it also fails when its file runs alone).
- tests/orchestration-trace.test.ts (step 01): phase/work-key trace and state digest unchanged. A digest change is allowed only when the step explains it as an ulp-level float difference or a recorded ledger change, re-baselines the golden file and passes the parity compare.
- node scripts/sim-parity.mjs --out scratch/rust-migration/candidate.json && node scripts/sim-parity-compare.mjs scratch/rust-migration/baseline/parity.json scratch/rust-migration/candidate.json reports PASS. When a step removes a field the harness reads (state.unitDeaths, state.projectiles, navigationWasmStatus, GameState collections), the same step switches the harness to the native counter or outbox row.
- tests/native-field-ownership.test.ts passes: every field the step makes Rust-owned is registered in src/game/native-owned-fields.ts, and nothing outside the bridge allowlist writes it.
- The step deletes its TypeScript rule code; the TypeScript left behind is encoding, bridging, mirrors, UI, input or rendering. No rule exists in both languages.
- Steps touching updateGame, main.ts, saves or multiplayer also run node scratch/boot-check.mjs http://127.0.0.1:5174/ <out.png> with no page errors.
- rust/MIGRATION.md Integrated section and rust/README.md Current authority are updated in the same step.

### Foundations

1. **Safety net: golden orchestration trace, state digest, injectable wall clock, field-ownership guard**. Golden trace/digest test, injectable respawn wall clock, field-ownership registry and guard test, fixture helper shell. Deletes nothing.
2. **Simulation core handle: V8-exact math, clock, RNG and sectioned native save** (after 1). One sim handle per game (clock, mulberry32 Rng, handle table for existing engines), jsmath.rs, sectioned `GameState.simCore` replacing `settlementCore`. Deletes TS RNG and per-module handle maps.
3. **Unified entity authority and the changed-row outbox** (after 2). Entity IDs, array order, retain, sleeping and roles native in the sim World; generic changed-row outbox + TS mirror applier + fixture seed API. Deletes entity-store internals and `collection_*`.
4. **Native work scheduler, decision clocks, marauder schedule and deadline queue** (after 3). `sim/work.rs` (WorkKey enum, FIFO budget, scopes), resident decision clocks with batched due queries, marauder clocks, native deadline queue. Deletes work-cadence/decision-schedule/marauder-schedule/simulation-events/settlement-decisions logic.
5. **Native step driver and phase plan** (after 4). `sim_update` owns substeps/speed/clamp/budget and returns the ordered phase plan; `stepGame` becomes a PhaseId table. Deletes the TS loop scaffolding.

### Terrain

6. **Native terrain grid, world revisions and tile journal** (after 2). TerrainGrid columns, world revisions and bounded tile journal native; all tile edits go through `tile_edit`. Deletes world-revisions.ts logic.
7. **Pure terrain rules and sight** (after 6). Ridge/stair walkability, ground speed, sight cover/high ground, fertility, yields native; navigation and movement geometry read TerrainGrid directly. Deletes geography/ridges/sight/fertility/resource-terrain/water-navigation/tundra-starts rules.

### Movement

8. **Navigation in shared memory with native topology** (after 3, 7). Navigation engines in shared memory; structure grid, nav profiles, forbidden bitsets and reachability queries native. Deletes navigation-wasm.ts, ~700 lines of pathfinding.ts, navigation proxy views.
9. **Native path search wrappers** (after 8). findPath wrapper, reverse queries, shortest-between and travel/nearest maps native. pathfinding.ts becomes a bridge.
10. **Native spatial broad phase** (after 3, 8). Broad-phase buckets and ordered nearby queries inside the movement engine. Deletes spatial.ts internals, movement-native record mirror, collision/civilian fallbacks.
11. **Native routes, motion clocks, old positions and forbidden evacuation** (after 4, 9, 10). Route/Motion/MovePolicy/PrevPosition components: plan/validate clocks, budgeted planning with congestion, cursor, stuck/repath, marauder continuation, forbidden evacuation. Deletes ~450 lines of simulation.ts and movement-path-schedule.ts.
12. **Native yields and the single movement_move command** (after 11). Friendly/neutral yield chains native; `moveUnit` is one native `movement_move` command. Deletes yield code and the scalar fallback.
13. **Attack-slot reservations and approach memos** (after 12). Attack reservations, spot ranking, 3 Hz claims and approach memos native (two-phase host contact filter until step 27). Deletes engagement.ts.
14. **Native retinue formation** (after 12). Retinue trails, slots, modes and rally goals native. Deletes formation.ts.
15. **Native infantry drill prepass and marauder formation routes** (after 14). Drill formation state (saved natively), clearance, spine march, strength routs and 1 Hz marauder routes native. Deletes infantry-drill.ts and marauder-formations.ts.
16. **Native road wear** (after 11). Road-wear recording and sweep native; road candidates as events. Deletes traffic.ts logic and `state.traffic` JSON.
17. **Native sailing** (after 11). Vessels, water traffic index, galley A* and momentum steering native. Deletes sailing.ts and its four helpers.

### Territory

18. **Native territory, culture and civic counters** (after 6, 7, 3). Territory owners/claims, city ownership, culture accrual and civic counters native (moved earlier because health, AI, validation and farms read them). Deletes borders.ts rules, territory-*, culture.ts.

### Combat

19. **Hostility matrix and pure combat rules** (after 10, 7). One native hostility bitset (`atWar` O(1)), relation authority, arrow/contact DDA, spear/cavalry/aura/armor rules native. Deletes relations.ts, arrows/spearmen/cavalry/leader-aura/defense-equipment bodies.
20. **Resident research accounts** (after 2, 18). Persistent research accounts with command/outbox API; `researchStatus` reads a mirror. Deletes the per-call upload in research-native.ts and TS research mutation.
21. **Native treasury and gold ledger** (after 20). Treasury, gold ledger and income diversion native; all gold/food writes are commands. Deletes gold-ledger/resource-income logic and ~45 direct writes.
22. **Native hit pipeline** (after 19, 21, 15). Hit commands compose damage, apply hits, charge/pierce and emit ordered hit events. Deletes attackTarget/applyMeleeHit/launchJavelin.
23. **Resident projectiles** (after 22). Projectiles resident across frames, launched by events, saved natively. Deletes per-frame projectile re-import.
24. **Native death and destruction rules** (after 23). destroyTarget consequences, kill credit, bounty/XP, casualty history and rout cascade native; ordered death events. Deletes destroyTarget and the casualty/blood/death GameState arrays.
25. **Towers, ballistae and tower threats** (after 23). Tower and ballista fire, return-fire threats native; interim per-faction visibility bitset upload from fog.ts. Deletes tower-combat/ballista/tower-threats.
26. **Morale and health in the shared world** (after 24, 18). Morale perception/integration and health regeneration native in the shared World. Deletes battle-morale/morale-perception/unit-health/healer-shack logic and their separate worlds.
27. **Native target selection** (after 25, 13). Target choice/retention with 15 query purposes, sight and contact checks native; claims become single-phase. Deletes nearestEnemy family.
28. **Native fight, breach, forced attack, fleeing and evasion** (after 27, 26). fight/breach/forced-attack/flee/evade/autoHunt as native commands returning movement intents. Deletes those simulation.ts bodies.

### AI

29. **AI pure rules and camp layout** (after 2, 7). Bandit intensity, pressure ramps, enemy strength, commander promotion and warcamp layout native. Deletes those six files.
30. **Raider camps and waves** (after 29, 24, 25). Camp lifecycle, wave spawning and siege reinforcement native with PackIndex counters. Raid pacing, stress, era strength and raid choice are already native in `sim/raid_director.rs`; raider-technology.ts and raider-camp-pressure.ts were deleted with it. Deletes raider-camps/fog-raids/roaming-marauders.
31. **Marauder packs and specialist planning** (after 30, 28). Pack lifecycle, reserves, camp defense, alarms and motivation planning native (recurring skirmishes no longer exist). Deletes raider-activity/raid-targeting and the planning halves of alerts/motivations.
32. **Sea raids and army warnings** (after 31, 17). Sea invasions and mobilization warnings native. Deletes sea-raids.ts and army-warnings.ts.
33. **Faction strategy** (after 28, 15, 21). AI missions, campaign ranking, emergency levy and army services native. Deletes faction-strategy/military/ai-profile/budget.
34. **Guard posts, militia, garrisons and the mass levy** (after 28, 18, 21). Guard upkeep/recruitment/militia, wall patrols, garrison duty and levy conversion/upkeep native. Deletes guard-posts/wall-patrols/garrison/mass-levy.
35. **Wildlife, marsh birds and hermits** (after 28, 21). Herds, hunting rewards, marsh birds and hermits native. Deletes hunting/marsh-birds/hermits.
36. **Per-actor tactical AI** (after 31, 32, 33, 34). Marauder, mission, guard, warrior, AI-leader, alert, return, sea-retreat and civilian-panic controllers as native intents. Deletes ~800 lines of simulation.ts plus raider-motivations/alerts and civilian-panic.

### Construction

37. **Structure grid and network topology** (after 8, 29). Per-cell structure layers, road/wall topology rules and placement occupancy native. Deletes network-placement/placement-occupancy/wall-towers/wall-upgrades.
38. **Construction site authority and footprint clearance** (after 37, 12, 20). Construction sites authoritative in Rust, native footprint clearance and completion events. Deletes structures.ts, construction-native.ts import, construction-clearance.ts.
39. **Wall stats, wall ownership and enclosures** (after 38, 18). Wall stats, ownership transfers and enclosure flood fill native, driven by revisions. Deletes wall-stats/stone-defense/wall-ownership and enclosure rules.
40. **Placement validation core** (after 39, 21). `validate_build` reason codes in the existing check order, cost table and dock/bridge/physical rules native (farm/house checks two-phase until step 50). Deletes validateBuildCellAt chain.
41. **Construction orders and payment** (after 40). `build_at`, building factory, payment/refund, cancellation and reconciliation queue native. Deletes buildAt/makeBuilding/cancelConstruction.
42. **Builders and repair workforce** (after 41, 34). Builder staffing, job dispatch, repair board, tree felling and builder state machine native. Deletes builders/builder-jobs/peasant-capacity.
43. **Strokes, construction routes and linear purchases** (after 41). Stroke planning, bounded route A*, linear purchases and preview overlay native. Deletes construction.ts/construction-route.ts/road-purchase.ts and cloned preview states.
44. **Area tools, Keep upgrades, forts and defense rebuilds** (after 41, 28). Area cancel/clear/demolish, Keep conversion/housing, fort upkeep/brigades/skirmishers, defense rebuilds and palace road rings native. Deletes those five files.

### Economy

45. **Upkeep, tax and maintenance rules** (after 21, 44, 34). Upkeep components, tax and maintenance native. Deletes maintenance/city-support and upkeep sums.
46. **Persistent cities and homes** (after 45, 39). Persistent City/Home components, house levels, residents, immigration and rosters native. Deletes city-growth re-import, wells/house-wells/civilian-population/immigration/settlement-rosters.
47. **Farm plots and harvests** (after 46). Farm plots, harvest heap, wheat groups, orchards and irrigation coverage native; `state.fields` leaves JSON. Deletes ~650 lines of farms.ts plus parcel/index/work-group/wheat/orchard/irrigation rules.
48. **City summaries and the economy tick** (after 47). City summaries, consumption, taxes, yields and the 30 s economy tick native. Deletes economy-inputs, city-economy-index, scalar-observer property proxies, regional-economy.
49. **Couriers and collectors** (after 47, 42). Collector staffing, courier state machine, cargo spoilage, dispatch limits and courier sleep native. Deletes the rest of farms.ts and courier/cargo modules.
50. **Farm placement queries and house siting** (after 47, 40). Farm relocation, travel ownership, siting, clusters, blocks and house siting native; validation becomes single-phase. Deletes those eight files.
51. **AI and governor build planning** (after 50, 33). AI/governor development cohorts as a resumable native cursor, AI defenses and tower layouts. Deletes faction-development/defense/tower-layout/irrigation and governor.ts.
52. **Resource development and workers** (after 50, 42). Deposit index, development purchase, worksites, road cursor and worker state machine native. Deletes the resource-* modules.
53. **Fishing and supply carts** (after 47, 17, 26). Fishing zones, fish, boats, receipts and supply carts native. Deletes fishing.ts and supply-train.ts.
54. **Trade and river trade** (after 49, 41). Trade route planning, merchants, river legs, payouts and quotes native. Deletes trade/river-trade/village-trade-quote/faction-trade-agreements.

### Progression

55. **Leaders, retinues and military services** (after 28, 21, 20). Leader XP/skills/respawn/brace/engineer, retinue composition, training, squads, blacksmith and slot purchases native. Deletes leader-*/archery/blacksmith/retinue-* modules.
56. **Diplomacy transfers, match outcome, palace capture and treasure** (after 55, 24). Civ confederation transfer, game over/victory, capture offers and treasure collection native. Deletes checkGameOver, diplomacyAction, palace-capture.ts, treasure collection.
57. **Village and settlement host execution** (after 56, 46, 41). Secession/capture/confederation execution, village sites, village unit AI and trails native; settlement reads resident state in-crate. Deletes settlement-bridge encoding, settlement-step/transfer, village-sites.

### Visibility

58. **Native visibility, scouting and observation posts** (after 57, 25). Per-viewer fog, explored journal, memories, scouts and observation posts native. Deletes fog.ts simulation half, scouts, scout-exploration, observation-posts.

### World

59. **World generation foundations and land mask** (after 6, 2). Golden worldgen hashes, native seeded RNG/simplex noise/data blobs, land mask, landforms and islands. Deletes those passes.
60. **World generation relief, ridges, climate and lakes** (after 59). Relief, ridges placement, climate, hill biomes and lakes native. Deletes those passes.
61. **World generation rivers and water** (after 60). Drainage, river network, canyons, waterfalls, deltas, spurs and fords native. Deletes those passes.
62. **World generation surface and spawns** (after 61). Remaining procedural surface passes and spawns native; `generateWorld` is native everywhere. Deletes src/world rules.
63. **Native game creation** (after 62, 57, 58). New-game setup (factions, starting cities, villages, treasure, initializers, advanced start) is one native call. Deletes createGame/createDuelGame/migrateGame and settlement-layout/faction-start/advanced-start.

### Boundary

64. **Command validation and the shared command queue** (after 63). One native command queue with validation for single-player and multiplayer. Deletes applyGameCommand and TS validation.
65. **Replication from the outbox** (after 64, 58). Per-viewer binary outbox frames and snapshots replace JSON deltas. Deletes state-delta, client-state JSON, view.ts, multicore lab, cell-journal.
66. **Native save export** (after 65). Saves are one chunked native export; game-save.ts is framing only. Deletes JSON GameState save encoding.
67. **Native actor dispatcher** (after 36, 42, 49, 52, 53, 54, 55, 57, 64). Behavior tags and the sequential actor dispatch with per-actor epilogue run in Rust; `stepGame` is gone.
68. **Consolidation, cleanup, final verification and playtest** (after 66, 67). Fold leftover registries into the single World, drop simulation-reads and mutable TS entity fields, update ledger, full verification, then the requested browser playtest.

### Coordination

- A parallel workflow is changing `simulation.ts`, `villages.ts`,
  `settlement.rs`, `settlement-bridge.ts`, upkeep (`maintenance.ts`, forts,
  guard posts, `faction-budget.ts`), farm relocation, the Settlement-to-Town
  text, the Colosseum and the AI bonus against marauders. Re-read files at the
  start of every step, port the merged result, and run step 45 only after the
  upkeep change has landed.
- `simulation.ts` line numbers above are approximate; locate code by function
  name.

## Verification in progress

The initial build and native test pass succeeded (36 Rust tests). The full
headless suite ran all 4382 assertions, with 4269 passing and 113 failures.
The untouched-HEAD comparison reproduced 110 failures in the 56 initially
failing files. After correcting the requested balance expectations and the new
AI fixture assertion, the combined recheck covered 80 files / 1018 assertions:
917 passed and 101 baseline failures remained, with zero new failing identities.
100 failure messages match baseline exactly. The remaining city-development
message retains its preexisting 12.5-gold maintenance mismatch after the requested
price changes (85 versus 97.5 becomes 103 versus 115.5). Builds and TypeScript
checks pass; browser/client/server WASM artifacts have identical SHA-256 hashes.
Reports are in `output/rust-verification/parity.json`, `output/ci-tests/`, and
`scratch/rust-migration-comparison.json`. These results verify the integrated
stage; they do not establish completion of the remaining simulation migration.
No browser game or interactive playtest was launched.

Current baseline (2026-11-12, HEAD `224c263`, `scratch/rust-migration/`): build
and all 131 native tests pass, both TypeScript checks are clean, and the scoped
vitest run (437 files, 4417 tests) has 4282 passes and 135 failures: 102
deterministic assertion failures (the identity list in `baseline/failures.json`,
including the ABI 1 versus 2 expectation and the 12.5-gold maintenance
mismatch) and 33 load-sensitive world-generation timeouts (16 still time out
alone). `scripts/sim-parity.mjs` runs four 900 s scenarios (default, advanced
start, maximum bandits, duel) with simulated wall time; `scripts/sim-parity-compare.mjs`
compares against the band of the baseline and three RNG-perturbed runs.
Combat rules in that compare only catch order-of-magnitude changes, so combat
steps also rely on the orchestration digest (plan step 1) and behavior suites.

The user has now explicitly requested a playtest once the full migration and
automated checks are finished. Preserve that final verification requirement;
do not mark the goal complete before the actual browser playtest. Cover early
XP, Keep conversion/payment, farm/house prices, difficult narrow-path regrouping,
proactive enemy combat, save/load, and ordinary controls/rendering.
