# Terrain-adaptive Blackroot camps

Open `output/marauder-terrain-review.html` for the standalone design study. It includes four procedural test sites, seed regeneration, terrain-only comparison, a tile grid, tier highlighting, and PNG export. The live game uses the same planner from `src/game/warcamp-planner.ts`; the preview retains isolated demonstration sites.

## Placement system

`planCamp(world, anchor, seed, options?)` returns a complete plan or an explicit rejection without mutating terrain. The options supply world-indexed construction reservations, actual movement obstacles, strategic access, and whether woodland must be preserved. The design keeps one-tile tents and palisades, timber towers, signs, and narrow roads. `options.size` selects small, medium, or large; the standalone design study defaults to the approved large camp.

| Size | Defensive tiers | Tents | Watchtowers |
| --- | --- | --- | --- |
| Small | 1 | 3–5 | 2 |
| Medium | 2 | 6–9 | 4 |
| Large | 3 | 10–18 | 6–8 |

1. **Read the ground.** Constructed cells require dry terrain, `traversable`, and `ridgeFootprintAllowed`. The preview preserves forest and jungle; production can request selective clearing after accepting a plan. Movement follows `canTraverseEdge`. Stairs, landings, and other natural walking links remain unbuilt.
2. **Fit from the inner ward outward.** Try 25 nearby anchor positions and a size-specific family of footprint proportions. Large camps use 17×17, 19×15, 15×19, 15×15, 17×13, and 13×17. Small camps use 9×9, 11×7, or 7×11 footprints. Medium camps use 13×13, 15×11, 11×15, 11×11, 13×9, or 9×13. The search is bounded to at most 150 attempts. Fit the inner enclosure, shift the middle enclosure only where spacing permits, and shape the outer contour with zero-, one-, or two-tile corner cuts. At least one open cell separates physical wall tiers.
3. **Use genuine terrain defenses.** A virtual closed contour may follow inherently impassable water or ledges; only its buildable portions receive palisades. Fords, stairs, walkable land, reservations, and existing buildings never substitute for a wall. Actual eight-direction movement must still prove that each occupied tier requires its gates.
4. **Reserve gates and pack the camp.** Choose an accessible outer gate, stagger the inner gates, and reserve routes before packing the selected size’s tent allowance, with tents in every tier. Every south-facing tent entrance must remain accessible. Construct roads only on eligible cells and within two tiles of the camp envelope; natural route links remain unpaved.
5. **Remove stranded defenses and validate.** Flood from the primary outer gate, prune wall fragments without an accessible adjacent workface, and choose towers only on surviving stockades. Recheck every gate, tent entrance, and wall workface from that entrance. Reject overlapping objects, hostile bypasses, touching tiers, and solid 2×2 palisade blocks. Decorative signs do not block movement or conceal a defensive gap.

The deterministic search chooses among a limited family of rectilinear contours using greedy ring and gate selection. Rejection means no valid fit was found within this search, not that every conceivable layout is impossible. No partial camp is returned. `metrics.naturalBarrierTiles` reports the impassable contour cells that replace constructed walls.

## Demonstrated adaptations

- **River bend:** corner shaping fits a curved bank and preserves an accessible landward entrance.
- **Raised bench:** structures use usable plateau floors while the existing stair supplies access; genuine ledges can defend portions of the perimeter.
- **Coastal pocket:** an elongated footprint fits between rocky shoulders and the shoreline.
- **Narrow isthmus:** a single-file causeway cannot hold the required tent plots and keep the routes through three wards open, so the search rejects it.

## Production integration

`spawnRaiderCamps` in `src/game/raider-camps.ts` retains strategic distance, fog, live-unit avoidance, camp spacing, and replacement retry rules. It checks at most 48 strategic sites per requested size and supplies building and field reservations plus actual movement obstacles. It also rejects a footprint that would surround existing buildings, roads, or fields. Standard worlds aim for one large, one medium, and one small camp; compact maps retain two camps, one medium and one small. The least represented living class is selected first, with large footprints fitted before smaller ones when counts tie. Hidden replacements restore missing classes. A failed class does not get replaced with a duplicate of another size. If initial placement cannot fill the population, a separate 30-second retry clock searches hidden terrain for those vacancies; destroyed camps retain their own 120-second respite and do not count as vacant slots.

Each production search uses a maximum 31×31 window with a one-cell terrain halo. Finite strategic access values seed only the inner perimeter of that window; interior reachable cells cannot masquerade as an outside entrance. The halo prevents cropping from inventing cliff edges on a continuous plateau. All returned coordinates are global.

Before committing, the game instantiates the complete proposed structure list in a temporary state and recomputes global travel from usable settlement exits. The new outer gate and previously connected active camp gates must remain connected. This catches placements that would close their own peninsula exit or isolate an earlier camp. Strategic checks preserve the established treatment of player walls as assaultable obstacles.

Only an accepted plan creates the `palisade`, `woodenTower`, and `villageTent` entities. Roads layered on palisades provide normal faction-controlled gates. Native signposts are decorative and respect sight. Production clears forest and jungle only on accepted structure, sign, and road cells; water, elevation, cliffs, stairs, and surrounding vegetation remain unchanged. `campSpawnTiles` floods from the real gate across the larger footprint.

## Verification

Build the preview with `node scripts/build-terrain-warcamp-review.mjs`; check it in Chrome with `node scripts/check-terrain-warcamp-review.mjs`. The build validates procedural cases, deterministic regeneration, and unchanged planner input. Browser checks cover terrain collisions, gate depth, tent access, wall thickness, controls, embedded native assets, PNG export, and mobile layout. Preview reports live in `scratch/2026-11-01-terrain-warcamps/`.

`tests/warcamp-planner.test.ts` covers global coordinate conversion, bounded searches and roads, reservation masks, cropped plateau access, woodland policy, natural defenses, ford and occupied-water exclusion, and pruning detached island defenses. `tests/warcamp-integration.test.ts` verifies instantiated camps with the game's actual movement and gate rules. Game screenshots and browser audits live in `scratch/2026-11-01-warcamp-game/`.
