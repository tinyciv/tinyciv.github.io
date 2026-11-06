# River network design

Design proposal for the standalone study; no production behavior changes. The intended progression is a crossable ribbon on land, a one-cell tributary with frequent fords, then a broad river collecting several tributaries.

## What the current code already does

- [hydrology.ts](../../src/world/hydrology.ts) priority-floods depressions, assigns one downstream receiver, resolves lakes to one spillway, and conserves accumulated rainfall runoff. Keep those foundations.
- [generator.ts](../../src/world/generator.ts) selects a limited number of high-scoring headwaters, then paints their paths as river cells. `riverRadius` begins at 0.8 tile before widening. Consequently there is no visual or navigational class for a small feeder.
- Existing fords span the whole channel and retain their crossing axis. Their global ten-tile Euclidean exclusion suppresses crossings on nearby, unrelated branches; it does not guarantee a crossing every few steps along a tributary.
- [pathfinding.ts](../../src/game/pathfinding.ts) blocks water except for fords and bridges. Fords move at 45% speed. Navigation has per-cell costs and eight direction availability bits; the WASM kernel does not yet accept per-edge crossing costs. Bridge spans currently allow eight water cells.

## Water first, width second

Keep an acyclic directed drainage graph independent of the painted water footprint. Each land cell contributes local runoff once: `R = 0.15 + 0.85 × rainfall` is the existing baseline. Accumulate upstream to downstream:

`Q(node) = R(node) + sum(Q(each upstream node))`

A lake is one reservoir with a single outlet. With no storage or evaporation in this study, its outflow equals its inflows plus its own local input. Changing branch density redistributes the same runoff; adding a branch must not create water. Changing rainfall changes discharge. Never sum painted channel widths, duplicate shared downstream segments, or normalize each river by its own mouth flow.

Retain visible headwater ribbons on every selected feeder. Ordinary hillslope drainage remains implicit. In production, select feeders from the drainage/catchment graph and trace them downstream; the study can use a planned branching skeleton with surrounding runoff routed into it. Discharge still comes from that catchment, not from branch count.

Use one global reference discharge `Q_t = 64` equivalent wet tiles for this study. Define dimensionless `q = Q / Q_t`. These are gameplay calibration units, not cubic metres per second. The deliberately wide tributary band suits the study's 96×70 catchment and keeps many one-cell feeders visible before they combine into a broad trunk.

| Discharge | Channel | Target water width | Ground behavior |
|---|---|---|---|
| `0 < q < 1` | Stream | `0.125 + 0.3125√q` tiles | Dry land with a water ribbon; crossable everywhere |
| `1 ≤ q < 10` | Tributary | Exactly one occupied cell across | Deep except at frequent complete fords |
| `q ≥ 10` | Main river | `min(5, 2√(q/10))` tiles | Broad barrier; rare shallow crossings and bridge sites |

Thus the model's raw thresholds are 64 and 640. Width is a full cross-section, not a brush radius. Rendering can ease class changes over two or three downstream tiles; keep the underlying discharge and target width unchanged. Do not apply a wide-water brush to a one-cell reach: keep a cardinally connected one-cell spine, including elbows. Width must never shrink at an ordinary confluence. Thresholds are shared across the map; zoom, branch density and map extent must not silently change them.

Compute Strahler order on the visible channel graph: source order 1; increase only when two largest incoming orders match. Use it for inspection, tributary prominence and layout diagnostics. Discharge determines width: a wet order-2 tributary can carry more water than a dry order-3 one.

## Bends with different character

Avoid both ruler-straight branches and a repeated sine-wave pattern. The study
uses asymmetric bend sequences with independently changing lateral excursion
and spacing. Some connectors remain quiet, while neighboring reaches swing
more widely. The broad trunk gets larger bends than the tributaries, so its
water footprint does not swallow the meanders. Branches terminate at actual
receiver junctions, including any earlier channel they encounter.

Small source extensions follow eight-way least-cost paths through a smoothly
varying valley field. This produces winding feeders instead of the previous
cardinal distance-field arms. Positive routing costs preserve a drainage DAG;
diagonal routes cannot cross an existing receiver edge without joining it.
Stream rendering rounds corners within their receiver cells and keeps shared
ports and confluences aligned. Width, water masks and crossing rules still come
from the connected flow graph.

This is a planform design approximation. Production should constrain bend
amplitude by available valley width and local slope: tighter, quieter reaches
in confined valleys, broader wandering reaches on low-gradient floodplains.
Use slowly changing constraints along a reach, pin lake outlets and geological
constrictions, then recompute channel footprints and ford candidates. Do not
warp only the artwork while leaving drainage or traversal on straight paths.

## Crossings that match the drawing

- Split the graph into reaches between sources, confluences, lake boundaries and mouths. Measure crossing separation along each reach's centerline, not across the map in a straight line.
- On one-cell tributaries, use a seeded target spacing of 6–10 channel tiles. Short reaches should get one central crossing when legal. Prefer straight sections, gentle banks and sites at least two steps from a confluence. Resolve a missed interval at the nearest legal site; flag unresolved long gaps in the study instead of painting a disconnected ford.
- A crossing is an explicit record: reach, distance along it, axis, every water cell in its spine, and two opposite dry bank cells. Both banks and all intervening steps must pass actual traversal rules. Do not accept a lake, the sea, an isolated decorative stone, or a cliff as the far bank.
- Main-river candidates are much rarer: roughly 20–32 channel tiles apart. Prefer narrow, gently sloped sections. Natural fords belong at shallow reaches; broad/deep sections offer bridge sites instead. Keep bridge candidates within the existing eight-cell span limit. Rare main crossings are not a reason to make every broad river shallow.
- One crossing lane means its thickness **along the bank**; channel width means the distance **between banks**. A five-cell river still requires all five intervening cells to be marked walkable. Existing tapered side shallows can remain decorative additions to that complete spine.

## Navigation and rendering contract

Streams must not set `terrain = 'river'`. Keep their land, vegetation and biome; store channel geometry separately. A stream does not make a defensive enclosure. Keep building foundations clear of its actual ribbon; a road crossing can display a small culvert without requiring the full bridge tool.

Only movement segments intersecting the stream ribbon pay its modest crossing cost. An initial wet-ribbon speed of 75% gives an extra cost `wetDistance × (1/0.75 − 1)` in normal tile-travel units. Movement along a dry bank pays nothing. Compute the same segment overlap for path edges and physical movement, including diagonals; do not charge a fixed toll every animation frame. Add cached per-direction edge costs to both JS and WASM and invalidate them with stream/crossing geometry. Fords retain the existing 45% speed; completed bridges retain normal speed.

Draw stream ribbons after ground and before scenery using the same water colors as rivers. Their shared edge ports must meet exactly. At confluences, union branches into one junction and taper to the downstream width; never cap each branch independently. Stream-to-tributary joins flare into the first water cell. Tributary-to-main joins broaden downstream, without a round puddle or a dry diagonal seam. Reuse the native water/shore atlas for full water cells and existing upright ford-stone crops across the complete crossing axis. The study should expose centerlines, water masks, banks and crossing spines separately so appearance can be checked against movement.

## Acceptance checks

1. Deterministic graph and crossings; one receiver per node; no cycles; every channel reaches its designated lake/outlet. Source runoff equals total outlet discharge within floating-point tolerance.
2. Equal/unequal-order junction fixtures verify Strahler rules. Joined discharge is the sum of incoming flow plus local input; width never decreases there. Threshold tests distinguish sub-tile streams, exactly-one-cell tributaries and broad main channels.
3. Every ford has a continuous traversable bank-to-bank path in both directions, no isolated walkable water fragments, and no water/cliff endpoints. Eligible tributary crossing gaps fall in the 6–10 target range; exceptions are visible diagnostics. Adjacent branches do not suppress each other's crossings.
4. Units cross any stream, cannot cross an unforded tributary, and can cross full ford/bridge spans. JS, WASM and direct movement agree on passability and crossing time; diagonal movement cannot skip water cells or crossing cost.
5. Pixel/mask checks cover elbows, three-way confluences, stream-to-water upgrades, lake inlets/outlets and protected cliffs. No visual water gap, detached brush pixel, or mismatch between a displayed ford and its walkable spine.
6. Several seeded catchments demonstrate many small feeders per broad trunk. Rainfall changes widths; branch-density changes redistribute flow without changing the total. The study reports class counts, crossing gaps and conservation error rather than relying on a single attractive example.
7. Every channel class includes winding and quiet stretches. Measure lateral departure and smoothed path length along same-class receiver paths so diagonal grid steps alone do not count as meanders. Check all example seeds and reject disconnected channels, receiver cycles or crossing diagonal spines.
