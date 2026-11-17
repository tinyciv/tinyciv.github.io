# Field cannon

Research **Field cannon** after **Gunpowder** and **Siege Engines**. It unlocks a **2×2 Foundry** costing **600 gold**, with 750 HP and a 60-second base construction time.

Open a completed friendly foundry with the Leader nearby. It shows the same faction-wide army composition sliders as the other military schools, including **Field cannon**. Raising its share routes available retinue soldiers to a foundry for free retraining; lowering the share returns surplus cannon to the requested roles. New retinue recruits can also fill the requested cannon quota. No purchase or conversion fee is charged for the cannon. The foundry building retains its normal construction price.

The cannon uses the selected **1C slender barrel-and-two-wheels artwork at native 16×16 resolution**, with a rolling animation and a steady barrel while firing. Its logical footprint is one tile. The foundry uses a generated 32×32 sprite displayed across its four-tile footprint. UI icons were generated separately with imagegen. Cannon art and prompts are recorded in `public/assets/units/field-cannon-simple/source.json`.

- **Movement:** half normal infantry base speed (1.98 tiles/second before road bonuses). Dirt-road, paved-road and temporary whaling bonuses apply. Off-road travel is permitted at 20% of the cannon’s normal base speed. Shared weighted paths prefer completed roads and bridges, while respecting ordinary terrain, walls, ramps and faction access. Cannons follow the Leader in the rear of ordinary and drilled formations, can be held, and accept individual land destinations.
- **Combat:** the same 18-tile base range, four-second firing interval and damage calculation as a fixed siege cannon, including its research/equipment effects, downhill range bonus and wall multiplier. Cannonball impacts reuse the existing native projectile and splash rules: 50% secondary damage within two tiles, including friendly units and buildings. Roads and bridges are immune. Cannons stop to fire. Keeps have defensive-building priority.
- **Upkeep:** 200 gold every 30 simulated seconds per cannon, first due 30 seconds after conversion. An unpaid cannon cannot move or fire and retries at the next upkeep interval. Its saved `fieldCannon` state preserves the funding deadline. The ordinary army ledger does not charge it a second time.
- **Durability:** 200 base HP and 3 base defense.

Conversion rules, shared bounded weighted route fields, movement, firing decisions and upkeep live in `rust/src/sim/field_cannons.rs` in the game's Bevy World. The TypeScript bridge publishes indexed observations and mirrors native results. Target searches and ordinary route-goal decisions run at most once a second; explicit movement commands invalidate the route immediately. Road topology has maintained reference counts and revision-based field invalidation. Resident native movement geometry supplies off-road and terrain constraints. All cannon route fields share a bounded expansion budget.

The UI and multiplayer command path both validate ownership, research, school availability and composition requirements. The foundry panel is refreshed once a second while open.

Art provenance and full generation prompts are in `scratch/2026-11-16-foundry/art-manifest.json`; the paused UI fixture and screenshot are in the same directory. Verification follows the repository restriction: compile Rust/WASM, type-check TypeScript, and run only `npm run test:startup`. No playtest or headless simulation is run.
