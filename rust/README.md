# TinyCiv simulation

Build with `npm run build:wasm`. This requires Rust 1.99 or newer and the
`wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).
`npm run test:rust` executes the same rules natively. Cargo dependencies are
locked; the browser and multiplayer artifacts include `simulation.wasm`.

The browser loads the required module before importing game state. Headless
tools load the same artifact from disk. JavaScript rendering, DOM controls,
and browser storage use TypeScript views during the migration.

## Current authority

- `sim/ai_empire.rs`: resident, throttled city/Fort/siege expeditions, placement
  cursors, funding decisions, cooldowns and army staging goals. The host supplies
  observations and executes normal validated build commands.
- `sim/ai_policy.rs`: immutable policy definitions, per-faction ECS assignments,
  validation and native retreat/recovery, garrison, hunt, campaign and formation
  decisions. The harness can register inherited parameter/feature variants;
  definitions and assignments are included in the native snapshot.
- `sim/entities.rs`: units and buildings as entities of the game's World:
  lifetime, array order, sleeping, role masks recomputed from published
  kind/flag/health scalars (`sim/kinds.rs`), ordered role views, counts, the
  membership revision and ID allocation. JavaScript keeps the view objects.
- `sim/structures.rs`: resident building index over the building entities
  (nearest refuge, shelter, arcing wall cells, solid footprints, palace
  defenses, ordered owner/kind queries).
- `navigation.rs`: weighted A*, multi-origin path searches, travel-time fields,
  and nearest-city fields. Terrain and search buffers remain resident in WASM.
- `progression.rs`: XP, level thresholds, skills, death penalties, construction
  prices, purchase affordability, and treasury spending.
- `combat.rs`: veterancy, equipment, effective attack/defense, armor, damage,
  elite modifiers, and casualty kill counts.
- `cadence.rs`: decision phases, recurring deadlines, elapsed credit, and
  coalescing (pure rules).
- `sim/work.rs`: resident recurring-work clocks per interned key, the FIFO
  interactive budget and the immediate/deferred publication scopes.
- `sim/marauders.rs`: hidden-marauder frame counter, phases and pending time.
- `population.rs`: persistent Bevy city/home components and ordered home
  assignment, growth credit, births, housing capacity, and food spending.
- `movement.rs`: resident transforms and occupancy, collision policy, swept
  geometry with native masks, atomic steering commands, and post-loop
  separation, plus a per-sector armed-presence census for settlement sensing.
  Host code keeps path planning and yield arbitration for now.
- `affiliation.rs`: pure score model for settlement affiliation (culture
  families and alignment, trade half-life, exposure/threat/protection, owner
  and foreign targets, independence, confederation and petition thresholds).
- `settlement.rs`: persistent Bevy settlements (cities, villages, seceded
  cities) with an ordered schedule: activation, 1 Hz presence sensing from the
  movement census, 5 s affiliation integration, secession events, village
  relations and hostility, AI village diplomacy, stage gates, growth requests,
  adoption, recruits and claims. Batched inputs, changed-row outbox, status and
  command queries, and a versioned sparse export/import for saves.
- `village_plan.rs`: the four ASCII layout families (Roadside, Market cross,
  Riverside, Hill cluster) with transforms, founding choice and slot plans.
- `health.rs`: persistent Bevy health/regeneration components and ordered
  damage-clock initialization and healing integration. Host territory and healer
  queries supply sampled eligibility; Rust owns resulting health changes.
- Staged engines still driven per call from TypeScript, which remains their
  authority: `path_budget.rs` (FIFO path admission), `projectiles.rs` (resident flight
  and impact damage; launch rows published once and target observations batched), `morale.rs` (casualty
  history, pressure, rout/rally), `construction.rs` (site lifecycle, durations,
  refunds, repair, stroke lines), `research.rs` (graph, priorities, funding,
  completion) and `census.rs` (sector armed census fed by movement).

Migration safety net (plan step 01): `tests/orchestration-trace.test.ts`
pins the `stepGame` phase/work-key/RNG-draw trace and a state digest for three
fixtures (`tests/fixtures/orchestration-trace.json`);
`tests/native-field-ownership.test.ts` rejects TypeScript writes to fields
registered as Rust-owned in `src/game/native-owned-fields.ts` (empty so far).
The simulation reads no wall clock: hosts pass `wallNow` to `updateGame` for
the real-time Leader respawn deadline.

All scalar result buffers must be consumed before calling another Rust rule.
Typed array views must be renewed after WASM memory grows. Navigation instances
own isolated scratch storage; results are copied before another query reuses it.
ABI 4 publishes projectile launches separately from ordered target observations.
Movement uses lookup-only FxHashMap indexes, inline occupancy buckets and bounded
bitset masks. Structure proximity trees update with row changes and retain
registration-order distance ties.

Entity IDs preserve the full JavaScript safe-integer range, including negative
IDs used by speculative construction views.

## Remaining migration

The larger migration remains active: simulation orchestration, movement
execution and collision, tactical and strategic decisions, construction and
workforce, farming/harvest logistics, research/culture, trade routes, visibility,
world creation, and command validation still have TypeScript implementations.

Move each system's authoritative state and mutation rules into Rust, retaining
existing behavior tests at the browser boundary. Use persistent components and
resources, explicit ordered schedules, changed-entity publications, and batched
commands. Preserve spatial indexes, topology revisions, shared navigation fields,
work budgets, and slower decision clocks. The final architecture should use one
simulation authority for native tests, browser single-player, and multiplayer.
The ordered step plan lives in `MIGRATION.md` under Plan.
