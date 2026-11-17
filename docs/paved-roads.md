# Paved roads

Roads automatically gain paving after their owner completes **Road Building**, which follows Masonry. A road qualifies when the median level of completed, living houses belonging to its faction within a circular **10-tile radius** is **4**, the highest housing level. No nearby houses means no paving. With an even number of houses, both middle levels must be 4. Construction sites, other building kinds and other factions' houses do not count.

Paved roads multiply dirt-road speed by **1.25**: dirt roads move at **1.5×** open-ground speed and paving at **1.875×**. Bridges retain their normal water-crossing behavior. Movement probes, native steering, navigation costs and admissible route heuristics use the same maximum speed. Losing the neighborhood condition or research entitlement returns a road to dirt.

`rust/src/sim/paved_roads.rs` owns the rule in the game's Bevy ECS world. Lifecycle and house-level edits update faction-specific spatial buckets and queue only affected roads. A deterministic FIFO processes at most 256 road decisions per simulated second; excess work carries forward. Initial loading and large city changes can therefore settle over several seconds. Ordinary movement never searches housing.

`src/game/paved-roads-native.ts` transports lifecycle/research inputs and mirrors native surfacing changes. Located appearance changes and navigation revisions invalidate the relevant caches. This derived index is reconstructed on load.

The renderer uses PixelLab's native 16px medium gray surface with dense fine speckling with light brown earthen shoulders. The generated Wang transitions fade into dirt, and the last boundary pixels match the existing dirt path. Cached road geometry shapes straight runs, corners and junctions; paved-neighbor changes are part of each texture key. Production assets live in `public/assets/roads/paved/`, with exact generation prompts, source references and hashes in `source.json`. The static game-scale preview is in `scratch/2026-11-15-mid-gray-road/gallery.html`.

Validation: Rust WASM build and TypeScript compilation. No tests or gameplay playtest were requested or run.
