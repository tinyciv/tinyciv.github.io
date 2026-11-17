# Sites

Sites are fixed landscape opportunities for particular buildings. They do not
appear in the ordinary construction menu. The first Site kind is **Thermal
bath**, available on each complete steaming mud pool (all three art variants).
Volcanoes are not building sites.

New worlds retain one fifth of the original volcano frequency and half of the
original mud-pool frequency. All three variants of each remain eligible.

## Interaction

- Explored sites show faint gray square corner brackets around their 2×2
  footprint only while the active, living Leader on land is within five tiles
  of it. Undiscovered corners remain hidden. Mud pool bodies are centered
  within the footprint, with steam extending above the north edge.
- An active, living Leader on land within three tiles of the footprint turns
  the brackets red and automatically opens the construction popup.
- The popup shows the building benefit, build time, upkeep and purchase price.
  Ordinary gold, faction-border, terrain and builder-route requirements still
  apply, with an inline reason when construction is unavailable.
- **Later** dismisses the popup for that visit. Clicking the nearby site can
  reopen it. Moving more than four tiles away rearms the automatic offer;
  the extra tile prevents repeated dialogs around the interaction threshold.
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
building footprint index. Four-Hz presentation samples report approach and
visit-halo and five-tile bracket flags. Build commands recheck the site and Leader immediately, then
use the ordinary construction transaction. The existing direct build command
also enforces Site approach rules.

`src/game/site-types.ts` declares presentation labels, building associations
and portraits. `sites-native.ts` transports observations and native results;
`site-construction.ts` routes local and multiplayer construction. Popup dismissal
is local UI state in `src/ui/site-dialog.ts`.

`site-art.ts` draws runtime vector footprint annotations using retained Pixi
graphics, like selection outlines. Markers reuse geometry, respect exploration
and preserve remembered sites outside current sight. The popup uses the existing
imagegen thermal bath portrait and standard dialog controls, with Pixel Operator.
