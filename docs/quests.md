# Village and hermit quests

Quest rules live in `rust/src/sim/quests.rs` in the game's Bevy world. TypeScript transports observations, applies native output, and presents dialogue and generated marker artwork. Broad updates run once per game second; accept/turn-in commands revalidate immediately. Boarding and landing are sparse native events. Road connectivity and enclosure geometry are cached by topology, and landmass classification is retained across ownership changes.

Each human player can receive each quest type once per game, independently in multiplayer. AI realms receive no quests. Each village shares one request between its main building and resident. Each hermit shares one request with its cabin, either a road request or a camp request. The overseas quest explicitly unlocks a follow-up at that same giver. Offers require the applicable researched technology and a suitable target. Givers must first be seen. World and minimap markers appear only when the surrounding tiles are currently visible and the local reveal fade has cleared. Markers and their click targets follow live giver positions without waiting for the quest progress sample. Objective pins use the same reveal rule.

Neutral villages also spawn in multiplayer. New hermit homes are planned in Rust on ground reachable from the human starting continent, outside claims and away from buildings. Sites near existing camps are preferred, making the road and camp requests usable without requiring an ocean-spanning road.

Available requests show a yellow exclamation mark, accepted requests a gray question mark, and fulfilled requests a yellow question mark. The Leader must approach within four tiles to accept or turn in. Rewards require an explicit return and claim. Dialogue includes the objective, payout, affiliation gain and permanent benefit. Active targets have pins; designated construction areas have a pale yellow tile overlay. “Show target” moves the camera without revealing terrain.

Work must happen after acceptance. Existing roads may be extended, but the finished connection needs new work; settlements must be newly ordered and fully completed. Farm credit excludes farmland present in the selected area at acceptance, and includes subsequent automatic farms. Destroyed or lost objectives revert before turn-in. Loss or hostility of the giver fails an unfinished request; loss of the original capital fails its road request. Another realm destroying the camp's required targets fails that request.

| Request | Completion | Gold | Food | Affiliation | Permanent benefit |
| --- | --- | ---: | ---: | ---: | --- |
| Eyes on the Frontier | Establish a post in the small highlighted area; the same post survives 180 uninterrupted game seconds | 600 | — | +35 | Watchtower upkeep −25% |
| A Road to Solitude | Complete a road/bridge connection from the original capital's road network to the hermit's doorstep | 1,200 | — | — | Construction and repairs +20% |
| Silence the Raiders | Destroy the identified camp's houses and watchtowers; walls are unnecessary | 1,800 | 300 | — | Troop attack +10% |
| Beyond the Horizon | Sail the Leader to a substantial, previously unvisited continent and land | 1,000 | 200 | +35 | Trade income +20% |
| Shelter Behind Timber | Enclose the village's main building and homes using settlement enclosure rules | 900 | 200 | +45 | Wall, tower and fort health +25% |
| A Neighboring Hearth | Finish a new player settlement within eight straight-line tiles of the main village building | 1,200 | 400 | +40 | One additional bed per house |
| Fields by the River | Establish at least ten new farm tiles in the highlighted riverside patch; no harvest required | 700 | 500 | +35 | Farm harvests +20% |
| Forty Hearths Overseas | After returning and accepting the follow-up, found one settlement on that continent and grow it to forty residents | 2,400 | 1,000 | +55 | Science per gold +25% |

The village supplies no observation-post construction resources, resident or upkeep during the survival objective. At turn-in it takes ownership and pays upkeep from its own native treasury. Gifted posts transfer with the village if it joins a realm. Village farmland and defenses likewise transfer at turn-in; the neighboring settlement remains player-owned. Native construction permissions allow only the active request's building kinds and designated area. Pledged construction is protected from automatic property claims before turn-in. Peaceful cooperation grants reciprocal gate access, so completing an enclosure cannot trap its builder.

Camp dialogue gives a compass direction and approximate distance. Its initial pin marks a broad search area; discovering camp structures reveals the exact pin. A continent is separated by sea, so rivers and lakes never create false continents. It must contain at least `max(120, world area / 140)` dry tiles. Previously visited land is tracked from the beginning of the game, and the home continent is always considered visited. Reaching the destination earns a milestone that remains valid during the required return voyage. The forty-person follow-up requires one newly founded settlement, rather than combined population across several towns.

Quest components, visited landmasses, original capitals and camp destruction credits save in native snapshot section 7. Faction benefit bitsets and presentation mirrors travel with ordinary game state. Multiplayer snapshots filter quest views by player, while read-only clients import those views into native placement previews.

## River generation

The remaining map styles are Continents, Pangaea and Fractal. The Mediterranean mode, authored generator, dedicated data and tooling are removed. Native river planning retains the existing watershed selection before adding up to three additional catchments on normal maps, favors long headwater reaches in the dominant systems, and varies source cutoffs between catchments. Regional resistance produces differing sinuosity both between rivers and along their courses. Selected lowland reaches become small connected horseshoe bends, and detached crescent oxbows remain separated by dry necks. Main channels can widen to five tiles; existing ford spacing is retained, increasing the importance of bridges and boats. Terrain changes apply to newly generated worlds.

The marker atlas and exact built-in imagegen prompt are recorded in `public/assets/ui/quest-markers-source.json`. A labeled three-style review is available at `scratch/2026-11-15-rivers-quests/markers.html`.

Marker styling uses the narrow, warm-outlined first column of `public/assets/ui/quest-markers-routing.png`. World and minimap markers are 25% smaller than the initial design. Quest extents use a 1.8% yellow wash and a 14% outer edge, with no interior tile grid; camp search extents use a 0.8% wash and 12% boundary. The current imagegen prompt is in `public/assets/ui/quest-markers-routing-source.json`, with a before/after preview in `scratch/2026-11-15-quest-marker-refinement/preview.html`.
