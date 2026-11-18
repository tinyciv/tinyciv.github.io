# Scenarios

Choose **Scenarios** in the single-player menu. The browser lists scenarios beside their details and a preview
of the complete prepared world. Starting a scenario loads a reusable compressed save from
`public/scenarios/`; world generation and city growth never run during launch.
Normal session replacement and autosaving apply afterward.

- **Age of Exploration:** a 320×280 naturally generated archipelago, four
  factions, developed cities, coastal shipyards, armed caravels and three
  marauder camps with ordinary defenders and reserves.
- **No Man’s Land:** a 240×144 naturally generated continent, two hostile
  factions and three founding cities per faction. This is 40% shorter than the
  previous 240×240 world. Native territory grants leave a central frontier.
- **Tutorial:** an 80×30 naturally generated island, two hostile factions with
  one thirty-person city each, a well and a wooden tower. Ordinary founding
  layouts provide homes, roads, farms and workers. The map is revealed, there
  are no marauders, and each half has a small copper and iron outcrop. Research
  costs one tenth of normal; funding release and the minimum research time are
  ten times faster. Earned gold production is doubled before Science diversion;
  initial stocks, refunds and transfers stay unchanged. The reusable start is
  authored at time zero.
- **Island Deathmatch:** the Tutorial rules on a 110×50 procedural island split
  by a roughly four-tile, meandering sea channel. Each faction starts with one
  thirty-person city in the north, a galley with two ballistae, a dock, shipyard,
  library, wooden tower, well, monument, blacksmith and whaling post. Native
  fisheries placement supplies one reachable whale per harbor, and all starting
  equipment technologies and prerequisites are already researched. The whole
  map is revealed; the southern islands retain room for another city.
- **Sandbox:** an 80×60 procedural island using the Tutorial geography settings,
  with one player faction, three naturally placed neutral villages with ordinary
  quest givers, and no enemies or marauders. Reach 2,000 people as
  quickly as possible; the victory report records elapsed game time. The start
  uses the ordinary twenty-person village, 500 gold, 500 food, starting escort,
  research rates and fog. Every regional resource and an offshore whale
  are present in the generated world. The reusable start is authored at time zero.
- **Musketry Deathmatch:** a 160×39 landmass, with a broad natural frontier
  between the factions. Two cities of exactly 150 residents face two equivalent rival
  cities. Every technology, including Officer Corps, is researched; each faction starts with 15,000
  gold, 12,000 food, musketmen, two field cannons, barracks, foundries and
  Military Academies. The whole map is revealed and the factions are at war.
  One half of an ordinary generated landscape is reflected through a native
  scenario command, including ore footprints and directional terrain links,
  giving both sides equal resources and space. Native founding layouts follow
  real buildable clearings and walking routes. Production farm siting supplies
  matching fields on both sides. The reusable start is authored at time zero.

All starts use the ordinary world generator. The two developed scenarios grow through
production governors, construction, farming, transport and births during an
offline bake. Normal siting planners select civic works and frontier equipment;
the bake does not paint terrain or stamp a mature city grid. Treasuries are
funded during preparation and reset to the scenario's starting stocks afterward.

Scenario farms use irrigation rather than orchard upgrades. The native offline
planner routes connected ditches from actual rivers and lakes through suitable
owned ground, prioritizing coverage of existing farms. Ordinary purchases and
builders establish the network before saving. Each finished city must retain
at least 200 residents and nonnegative projected food production. Orchard
upgrades are never used to satisfy scenario growth requirements.
Native founding sites require a freshwater feeder within twelve buildable
tiles, including the coastal cities in Age of Exploration.
Civic siting reserves the inner neighborhoods for homes and service wells.
Larger civic buildings use native candidates eight to fourteen tiles from the
town center; granaries retain their farm-coverage ranking within that outer
belt. Offline redevelopment rebuilds older central civic buildings through
normal purchases and builders. Native street planning connects house and civic
entrances to existing roads along the actual walking graph, and the resulting
roads are purchased and constructed normally. It never paints terrain or
replaces the simulation-grown population.
When a valid shipyard site overlaps ditches, preparation clears those ditches
through the normal removal lifecycle before purchasing the yard. Native naval
siting also requires launch room for a warship; an unusable empty yard in a
resumed checkpoint is retired and resited through ordinary construction.
After construction, each Age of Exploration starter warship is placed in the
nearest broad coastal or ocean waterway to its shipyard. A berth must connect
to at least 96 hull centers with room to turn fully, using the actual
post-construction water grid.

Run `npm run build:scenarios` to rebuild all stored starts. This compiles Rust
first, then writes `.json.gz` saves and `-source.json` manifests with dimensions,
city populations, resource availability and engine hashes. Each bake also renders a
static world map for the scenario browser through `tools/scenario-bake/maps.py`
(Python Pillow); maps can be refreshed separately without advancing gameplay. To rebuild one start,
run `npm run build:wasm` followed by
`node tools/scenario-bake/build.mjs no-mans-land` (or `age-of-exploration`, `tutorial`, `island-deathmatch`, `musketry-deathmatch` or `sandbox`).
Intermediate checkpoints and frozen build engines go under
`scratch/scenario-bake/`. A stopped bake can resume with
`--resume=path/to/scenario-checkpoint.json.gz`.

Scenario identity and native city territory grants persist in the saved world.
Loading does not repeat founding or equipment commands. Scenario construction
uses normal research and resource requirements: ballistae require Siege Engines
but no iron; siege cannons still require a developed iron mine. Placement errors
display unmet requirements instead of the generic “Cannot build here”.

The offline finalizer audits the native cardinal walking graph and opens
corridors by removing whole blocking structures. Each natural landmass keeps
one connected walking region; islands still require boats. Palace and shipyard
removals fail the bake. Leaders start on open tiles, and camp gates have physical
openings. Both shipped saves include these corrections. Scenario construction,
automatic housing, village development and replacement camps reject placements
that would split an existing walking region, including queued structures.
Roads remain walkable.

Run `npm run refine:scenarios` to apply the finalizer to the existing stored
starts without advancing their simulation clocks or repeating city growth.
Its manifests record the connectivity report, camp populations and refinement
engine hashes; input backups are retained under `scratch/scenario-bake/`.
After building Rust, `node tools/scenario-bake/refine.mjs no-mans-land --diplomacy`
refreshes only the native starting relationships in the stored start. It preserves
the terrain, cities, stocks and clock, and records the final relationships in the
source manifest. Ordinary game loads do not reset negotiated relationships.
Use `npm run refine:scenarios -- --irrigation` to convert existing scenario
orchards and let builders finish the replacement irrigation offline. This mode
advances the stored simulation during construction, preserves starting resource
stocks, and records ditch and irrigated-field counts in each source manifest.
An interrupted irrigation pass can resume one scenario with
`node tools/scenario-bake/refine.mjs no-mans-land --irrigation --resume=path/to/no-mans-land-irrigation-checkpoint.json.gz`.
Worker rowboat observations use simulation unit codes, matching the native
eligibility rule, so builders can finish feeders on the far side of a river.
Use `npm run refine:scenarios -- --layout` to refresh civic placement, streets
and coastal shipyards in stored starts. Ports outside a compact city's current
claim receive ordinary outskirts monuments before construction. Starting gold,
food and governor permissions are restored afterward. The finalizer rechecks
walking connections and irrigated food support before saving for reuse.

Use `npm run refine:scenarios -- --streets` to repair streets in all six stored
starts without advancing their clocks. Native planning closes every town's
perimeter, joins disconnected road fragments on each landmass, and connects
civic entrances, including the land side of village docks. Buildings covering
roads move to nearby native-selected sites; farms use ordinary relocation.
Terrain, water, resources, population, research and starting stocks are retained.
Each source manifest records before/after road connectivity and the moved sites.
Completed town rings and the last open entrance to a building remain reserved
by native scenario placement checks during later city growth.

Mounted ballistae, cannons and surviving ranged marines acquire enemy ships and
shore units independently. Nearby shore candidates use the unit spatial index
once per second; Rust controls targeting, range, reloads and damage. Shore shots
launch from their own deck positions through the ordinary projectile system.
An attack order selects a water firing position rather than ordering the hull
onto the target's land tile. This order also works in multiplayer.

Tower banners are rendered in their owner's faction color. Only the sprites'
two authored banner palette entries are recolored; wood, stone and outlines
remain unchanged. The cached variants are shared between tower draws.

The isolated `Menu / Main Menu / Scenarios` Storybook preview does not start a
game. Gameplay playtests and automated test runs remain opt-in.
