# Sites

Sites are fixed landscape opportunities for particular buildings. They do not
appear in the ordinary construction menu. The first Site kind is **Thermal
bath**, available on each complete steaming mud pool (all three art variants).
Volcanoes are not building sites.

New worlds retain one fifth of the original volcano frequency and half of the
original mud-pool frequency. All three variants of each remain eligible.

## Interaction

- Visible, unoccupied mud pools show a red silhouette outline when the living
  Leader is on land within three tiles. Click the pool to open its construction
  popup.
- The popup shows the purchase price and any unmet construction requirement.
  **Later** closes it until the player clicks the site again.
- Ordering construction immediately reserves the whole site. Queued and
  completed buildings hide its marker. Cancellation or demolition restores
  the opportunity on the existing underlying mud pool.
- Single player uses the existing pausing dialog. Multiplayer keeps running
  and sends a validated `build-site` command to the authoritative game.

Thermal bath rules remain 300 gold, 60 seconds, 3 gold upkeep per 30 seconds,
and +30% house capacity for the nearest friendly town after completion,
rounded to whole residents without stacking.

## Implementation

`rust/src/sim/sites.rs` stores Site components and an anchor index. Terrain
anchors are imported only when geometry changes; availability uses the native
building footprint index. Presentation caches actionable anchors between
three-Hz samples. Build commands recheck the site and Leader immediately, then
use the ordinary construction transaction. The existing direct build command
also enforces Site approach rules.

`src/game/site-types.ts` declares presentation labels, building associations
and portraits. `sites-native.ts` transports observations and native results;
`site-construction.ts` routes local and multiplayer construction.

`site-art.ts` traces the pool sprite to create an outline cached by the
renderer. The popup uses the existing thermal bath portrait and standard
dialog controls, with Pixel Operator.
