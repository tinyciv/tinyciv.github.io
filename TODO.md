### Fixes and features:
- Remove the current demolition animation for walls and towers; propose new ones that are crumbling (not fire) and top down, not isomorphic.
- Show the basic controls on the loading screen for the world; give me some designs for a nice WASD explanation with visuals. It sohuld show the keys highlighted on the keyboard (only show WASD) and then show the Leader zooming around as they are highlighted
- When opening the menu from within the running game, show a popup menu like most games instead of immediately returning to the main menu. Put options for Save game, Load game, Exit to menu, Preferences, etc. Style it like the other popups in the game.
- Prepare an initial loading animation (shown when the app is loading for the first time of a small group of spearmen attacking a settlement with a few archers. Record the frames; we will play this in the initial loading screen to keep people's attention. It should last for ~15 seconds. When it finishes, it should freeze on the last frame and fade out to a sepia and wait for the rest of the game to finish loading.) 


- Make sure warships can reverse. Also, reduce their collision box slightly. Make it easier for them to reverse/move around. When they are anchored, show a small white anchor symbol above them
- Halve the time that footsteps stay present on the map
- For gold mines, dont draw them with a mine entry until they are developed
- Roads do not need to start on a previously existing road / ford tile
- For quick start, have it default to roaming barbarians
- Show progress bar for world generation, and have it say "Generating world..."
- For gunpowder units, we should add a translucent smoke cloud effect from each firing animation that hangs around for 5 seconds and then fades away. If there is a large battle with lots of units, we want it to produce a substantial amount of smoke. The clouds can have a small amount of random drift too; the drift should be bias + random noise with bias = 10% of the strength of the random noise variation.
- Remove the old Leader-only 1x2 galley art; it looks bad. Create some new versions with the same size, using the other ships as comparisons / grounding context.
- For the musketry deathmatch scenario, give the AI player 50% more gold per turn than the player
- Add minimum range of 5 tiles for cannons
- Reduce cannon damage against units by 70%
- Let cannons fire over buildings and walls, but not mountains
- When a building is destroyed,do not show a construction site on its location until a civilian comes to start it
- when fortifications are destroyed, do not let other buildings get autoplaced on top of it
- Marauders sometimes mill about and even when I attack them, they dont come after me. This happens around a camp, might not be related to that though
- For developed gold mines, there doesnt need to be a civilian walking back and forth; just generate the gold in situ and show the floating gold number each time it happens


- At end of game, victory or defeat popup should link to main menu, not new world.
- Don't use construction site for well
Make the blocked footprint of the 3x3 ore sites into just 1x3 and let units walk behind it. 
- Include 6 and 8x as game speeds
In the sandbox game, include a few neutral villages and quests 
- Make sure all building and construction site health bars are centered above their image
- Add a new tech "Officer Corps". This unlocks a new leader ability, "Offensive" which, when used, zooms out and lets the leader place a Rally flag and an Objective flag. The retinue will create a formation at the Rally flag and attack until it captures the objective flag and kills all enemy buildings and units within a 6 tile radius of it. If units break and run, they regroup back at the rally flag. Then, an attack starts again when the full retinue is present (up to 2 units may be missing to handle bugs) and then advances again. When its are in this mode, they drop 75% less gold and yield 75% less experience to the faction which kills them. Pop points lost during an offensive are regenerated 2x as fast. The flags can be set outside of the leader's immediate radius. 
- Units sometimes get stuck or rapidly oscillate when they are moving. This is especially obvious with the retinue. I want you to create some simulations of the retinue moving around a landscape, and then observe how, even though the leader is stopped, there may still be visual action from the retinue as it is shifting around, units trade spots, and individual units rapidly oscillate back and forth. We want to suppress this behavior such that when the Leader is done moving, his retinue is mostly stopped as well when they are close to him.


- Create a simplified 16x16 field cannon that is just a barrel on two wheels


- Control the number of field cannon like slider; adjust the slider to change #. Put the same sliders on that buildng as the other buildings that allow changing unit types. Remove the creation cost for the field cannon, but preserve the upkeep cost
- In formations, cannon always go in back
- Build a new under-construction tileset for roads; we dont want to just repeat the 1x1 construction site many times
- cannons should not destroy roads
- cannons can move off roads, but at 20% of normal speed
- Make sure that units naturally attack keeps when nearby; they should be prioritized above other nondefense buildings, and right clicking on them should force-attack onto them.
- After the musketman tech is researched, give the leader a firearm instead of a spear
- Sometimes, there seems to be a bug in which musketmen don't fire despite enemy in front of them.
- Increase range of musketmen by 30%



The wetland vegetation (also sometimes used with the oasis) can be too tall; rescale it to be no taller than a standard unit, plus one pixel.

Extend the tutorial scenario to create a Musketry Deathmatch in which both players have two cities on either side of a landmass, with equal resources and space. Give them all techs and have the starting cities both be 150 people. Let the retinue have mostly musketmen and a few cannons. Make the world map be 30% taller and 40% wider.

Use the PixelLab API to produce a new Military Academy building requiring a new tech. When built, it should allow the player to select the formation type used; the options are wide, standard, and deep. units in wide formation lose their defense bonus but gain +30% rate of fire if they are missile units. Wide is 2 units deep, standard is 3 units deep, deep is 4 units deep.


Add a world viewer module that, when started with `npm run world` opens up the game right away with no menu into a new world; let the user select which world type to look at (archipelago, warm climate, different settings, etc). The intent is to quickly critique all world gen processes. The map should be fully revealed and allow for full zoom to see everything in one screen. 
- In a standalone HTML, show what it would look like to have cliffs ingame without stairs; for example, we want ledges and cliffs that do not need to be fully enclosed, but which block pathing.
- Remove the little fake progress text like "Founding cities"; they're lame and gay. Just show the progress % and the spinner. Get a proper spinner with more than 8 frames.
- Create a Sandbox scenario with no enemies and no marauders; the goal is to get to a population of 2000 people as fast as possible. Base it off the tutorial map, but use a map which is 2x as tall, same width. Make sure all resource are present in that world. Give the user the standard starting conditions for a new game.


- Create more extensive victory screen showing # of gold gathered, # of enemy units killed, # of units killed, # of techs researched, maximum population, etc. 
- Enhance tutorial to produce gold at 2x normal rate
- Put scenarios into a scenario browser with scenarios on left side in scrollable windowm and scenario information + world map on right side. Make sure to use the same mouseover / selection appearance as the main menu
- some of the action item buttons on the toolbar are pixel slop; they need to be remade with imagegen to look better.
- Let ships repair once they are within 3 tiles of a friendly shipyard and "cast anchor" is set. Show the green healing indicator over them when this is happening.
- Change the ship / shipyard requirement from 200 people to 100 people. Give 
- Ships can passively fire on enemies even if the Leader is not in it. When the Leader comes ashore, the marines and weapons on the ship can continue firing.
- Create a Island Deathmatch scenario which is identical to the Tutorial one, save for the the map is 30 pixels wider, 20 pixels taller, and there is a roughly 4 meter wide water body in the middle dividing the two parties. Both sides start with a ship (galley with 2 ballistae), dock, shipyard, library, wooden tower, well, monument, and blacksmith. for each faction, put the single city at the north end of the island so there is enough space for another city in the south. The map should continue to be fully revealed. Make sure there is a whale resource for each player, and give each player a whaling post. Have the factions start with the techs needed to build any of these things.


- Create a simple "Tutorial" scenario that uses a very small game map (30 tiles tall, 80 tiles wide), two factions, each with one city (starting with 30 people, a well, and a tower, no marauders, and have both sides be at war with each other. Start with the map fully revealed. Include a small amount of copper and iron ore on each side. for this scenario, let techs take 1/10 the normal resources to research and therefore happen 10x as fast. There should be water around the borders of the map, and it should be a realistic setting with a few trees as well.
- Civilians are too quick to use rowboat instead of take a slightly longer path; make the rowboat move at 20% normal speed.
- Use the PixelLab API to create a spinner animation which is thematically consistent with this game, and use it in the loading screen
- Adjust the generation progress bar to actually reflect the progress; right now it goes from 0 to 100 instantaneously after waiting for a few seconds.


-For all scenarios, make sure that the road placement and building placement does not block off or isolate any part of the terrain, making the map unpathable to the leader
- Add a few marauder camps in the age of exploration scenario. Make sure ships can target units on shore
- Make sure marines can fire on enemy units and ships from their ship


The city growing during the scenario creation should not be done at gametime; it should be done once offline and stored for reuse.

The towers for each faction should have banner colors for their faction, not red.

Remove the scenario description text for each scenaro.

The no mans land scenario world is too vertically tall. Compress it vertically by 40%.

Ballistae cannot be placed in the no mans land scenario ("cannot build here") while other buildings can be placed; figure out why this is.

#### Fixes:
For the scenarios, the landscape should not be generated by hand; you should use the world simulation logic and also let the cities be produced by simulation because right now they are too simplistic and unrealistic.

For naval combat, let the marines fire from the boats (e.g. archers) and also make sure the ballistae and cannons on teh boats are the ones firing; each one can track and fire independently. Remove the veterancy text from each boat. Just show the name; give each faction linguistically appropriate names for their boats. Remove numbers from boat names

Allow for boats to collide such that they both receive damage; let the damage be a function of which part of boat is hit (prow receives less than side, etc) so that ramming is a viable strategy.

Create ship sinking animations for each ship.

The popup on the shipyard is too small and the selections are broken; verify that we can add weapons to each ship. The dropdown styling is also bad; it needs to be consistent with the rest.

Add an oar rowing animation to the galley.


#### Scenarios
For both playtesting and for users to experience different parts of the game quickly, we should add a "Scenarios" option in the main menu:
1) Age of Exploration: each faction starts out with a single city on an island (200+) people, a shipyard, and a warship. There should be a large number of equally sized islands for them to explore. Most of the game techs should be already researched. The factions should start relatively close together.

2) "No man's land" In a small world, two factions have split the world in half with a no mans land of 20 tiles in between them. They each have 3 cities, each with 200 people, and a heavily fortified wall with towers protects each of them from the other side. 

Implement these scenarios; you can design the cities by running a simulation from scratch until you get the population required.


#### Diversity of goody huts / ruins / huts / treasure
- New object art should be created for 1) a 2x2 crumbling ancient ruin. When the Leader moves on top of this, it should yield between 100 - 300 gold (Random, 10 gold increments) or a new technology (automatically pick the most expensive one which you have the prereqs for, or opens a popup revealing that it is the last remnants of another civilization which are looking for a strong leader to watch over them and protect them. They give you the option of leading them, which converts them to a new town with 10/10 people immediately, albeit with a double maintenance cost for the first 3 minutes. the last option (with 5% probability) is that a formation of marauders spawns immediately nearby and attacks you, with the # of marauders equal to the Leader's army / retinue plus 3. If you flee, then it should attack straight to your capital and won't stop until all units are killed or flee. The last option is that 10 people appear in the ruins and immediately flee to your civilization, building a house and farm immediately in proportion to their numbers (no cost to you)

The text for each option are:

"In the ruins of a long-gone civilization, you've found ancient treasure!"
"While exploring the ruins, your scholars make a great discovery about a long-lost technology!"
"You have unwittingly violated the sacred ruins of a powerful nearby clan. Defend yourself immediately!"
"Refugees from these ruins flee to your nation for safety!"

These appear as text ingame.

"In the labyrinth of this ruined city, you spy children racing through abandoned alleyways. These people have been trembling in the ruins for generations and are in need of a strong leader to protect them. Do you offer to accept them into our nation?"

This appears as a popup with choices. Add the details as tooltips.

Create a 1x1 hermit hut as another explorable building. When explored by the Leader, you can get either:
- Fog of war revealed, showing up to 300 tiles revealed concentrated along the pathways to the nearest cities/camps which are not yet discovered. Text: "After sitting down with a hermit, you learn much about the surrounding countryside."
- permanent +1 to the retinue, and a new unit type, the ranger, which is an archer with +50% range and +25% flee radius and +25% speed. This ranger type cannot be removed from the army, does not have maintenance cost, and cannot be changed to another unit type. He respawns normally if killed. Text: "A wizened ranger seeks greater glory and joins your army"
- Give the Leader another full level, with the text "After consulting with the hermit for hours, you feel wiser and more prepared to rule."
- With low probability (5%), you get 25 gold "Something has happened to this hermit, and he's nowhere to be found. You take a few trinkets for your trouble."

Then, retain the old treasure chest icon which can remain in the game unchanged.

All text (besides the popup) should appear in translucent small white text above the leader, and should fade over 8 seconds.



#### Fishing + ocean economy:
- Lakes and oceans should now have fishery zones which are not apparent to the players, but which show occasional fish splashes, with the number of animations proportional to the fishery health. Multiple docks can be built from each city, and each one supports 1 fishing vessel. Each fishing vessel can harvest X food on every trip, and the health of the fishery rapidly regenerates. However, overfishing can drive its number to zero, and if it reaches zero, it collapses entirely and will never return. The fishery recovery function should be inspirated by scientific findings.
- Use the pixellabs api to produce a new 1x2 fishing vessel with animations for movement and loading/unloading fish. 
- Also, create a new 2x2 grid cells animation for a whale breaching. This will indicate a whale resource. A new building, whaling post (2x2 grid cells, must be adjacent to water) will produce a whaling ship (1x3 grid cells) which can then harvest whale from that. This produces a large amount of gold, and also offers a 5% movement boost to all ships and units. This bonus lasts for 1 minute, and can be renewed indefinitely. Use the pixellab api to produce the needed assets. Add a new tech, "Whaling" to enable this.

#### Naval combat
New features for naval combat:
- new 3x3 building (96x96 tiles, at least one must be adjacent to water for shipyard. Each city can only have one, and city must have at least 150 people first. 
- The ship must be built at each shipyard; each warship costs 500 gold to build, and 50 gold / 30 seconds to maintain.
- Each shipyard can support one warship; these should be war galley, caravel, frigate. Caravel and frigate both require new technologies.
- Each warship should be a 2x5 with oars, rigging, etc as appropriate. Each warship can be upgraded to have ballistae and cannons (with the right technologies). They will also come with a complement of marines. At the shipyard, the upgrades and marine type can be chosen.
- 2x4 of the layout is usable; the war galley should allow 2 weapon spots, caravel should allow 3, frigate should allow 4. For top speed, it should be galley, then caravel +15%, then frigate (15%). Ships should try to avoid each other; if they collide, they take damage proportional to speed of collision. 
Ranged marines can fire from the ship, but are much weaker in melee combat. We need a boarding mechanic so that if two ships are close enough, the melee troops will automatically place boards (generate boarding objects with pixel lab api) and attack onto the other ship
- When the Leader is on a ship, the retinue joins him onboard where it was when he boarded, though it is not visible. If a ship is sunk, all units on it die.
- Veterancy is associated with each ship. Each ship gets its own name.
- Warships use the turn and move forward, reverse dynamic. They turn much more slowly than the existing 1x2 galley
- When within 2 tiles of shore, the Leader gains an ability "Cast anchor" which prevents the boat from leaving and allows the Leader to take them onshore. The warship can then allow for retinue reinforcements to be issued.
- When warships are sunk, they award 1000 gold to the party that sank them.

OLD

- Extend the game logic to include ability to save games and load them. These should be stored in local storage or DB or something. Provide the option to save with a custom name for the save, and ability to load them as well.

- Salt is too rare; increase its frequency by 4x. Let it occur in smaller patches too.

- Let civilians take rowboats to move across water. Let the Leader build towns on new islands; the civilians will sail over to build it.



- Add a cheat code mode which gives you an extra +5000 gold / 30 seconds; put it in the preferences. Call it "Infinite gold"

- Remove text like "Enemy health, damage and gold income.

"Rebuild destroyed walls and towers using gold and builders. Existing construction orders continue when disabled."

and "Development: show the whole world without fog.
"

Find a name for this kind of text, and add instructions to AGENTS.md to not create this ai slop text.
 
Make sure the text on each building button is fit to the area, and that the buttons are not cut off

Civilians should be able to construct buildings diagonally, even if they cannot get access to a cell which is rook-adjacent to the building site.

The building destruction animation should play 3x faster and rubble should fade 3x faster.

When in a boat, the Leader should be able to push all other friendly and neutral boats out of his way

Ford tiles should be pathable to all boats, including trade boats



Add the forum building from the scratch folder ingame, with a required tech of "Cultural Identity" which appears midway through the game. This building has a popup like the science tech tree that lets you purchase Achievements using your culture.

Include the following achievements with an appropriate dependency amongst them
- Hunting legend
- Creation story
- Ancestor worship



Replace the existing barbarian / marauder warrior with the brigand art; should be in the scratch folder. Use a brigand with a crown as the marauder leader.


Add a game mechanic that some neutral villages spawn close to water and have a dock. Once you build a dock which they can path to, (and the range can be quite large, e.g. 100+ tiles) then they will automatically send trade ships to your dock producing a small amount of gold. IF you find the village, and establish trade ties, they will provide much more gold (8x more).


We need to create a 1x1 and 2x2 destruction animation for buildings; it should be agnostic of the building and consist of a growing series of flames that eventually cover the whole footprint and produce a large cloud of smoke. A pile of rubble is left behind. After this animation finishes, we will fade the rubble over 10 seconds.
- Red outline for ore / resource patches should be a single outline around the whole contiguous patch, not outline around each grid cell
- Stone resources should be at most 10 cells
- Placing buildings during pause should still place footprint immediately and debit gold
- In the sedentary mode. for barbarians, they spawn at reduced rate but also will not directly attack you unless you attack their camp.
- Creating trade with village then placing a new town seems to make the trade route disappear; there is some bug with trade route to neutral village disappearing. The trade route for a neutral village does not count against a city's limit for trade routes.


- Make sure farms cannot be placed on ramps
- When supply depot reaches leader, show a small + with the number of damage healed, floating like the damage or gold counters. It should also heal all units by up to 10 health within a 8 tile radius. Show the + health on those units as well
- ballistae target enemy buildings before enemy units
- Based on the ballista, also create a new siege cannon fixed emplacement which is also 1 grid cell, can rotate and fire. It should do 5x as much damage as the ballista, and also do splash damage at 50% to everything in a 2 grid cell radius. It should cost 500 gold, and upkeep of 100 gold / 30 seconds.

- When the player has selected a building for placement, the AI should not automatically place farms or houses as to avoid spending the money intended for the new building
- At the start, extend the roads to include 4 roads extending from the corners of the town out to 6+ tiles


- Make sure roads and other things can be built on farms, and that farms that are replaced are moved zero-cost to the next best place
- Add gold upkeep costs for monument, ballista, irrigation and all other buildings. We have a problem with the game producing too much gold once 3+ cities are built. Consider also increasing city upkeep cost with # of cities.
- Rename "Settlement" to "Town"
- AI factions should get a 100% boost in attack/defense versus marauders

### Implement Storybook for previewing units/animations
Create some base storybook views which show the ingame terrain + city+ combat in 3 different base scenarios. It should be exact reproduction of what it looks like ingame.

### Overhaul loyalty and affiliation system
Loyalty and affiliation should be overhauled to be the same score system controlled by 1) trade, 2) frequency and proximity of enemy units coming close, 3) base shared cultural alignment (100% for your people, lower for other villages / factions). We want to make the village system more elaborate and make it possible to request that they confederate. We should also design a new village evolution system that shows how the neutral village can become more elaborate over time, with roads, groups of houses, buildings, etc. As time progresses, they should add the same buildings that nearby factions have. Present a few different layouts, and show how they appear at 5 different timesteps in Storybook

### Create new military units 
Using the PixelLab API and the folder of unit art at `public/assets/pixellab-grounding/units/`, create new units for the following units: pikeman, crossbowman, brigand, musketman, longbowman, cavalry, rifleman, machine gun, tank, fighter, bomber. Make sure each of them has a moving, firing, and dying animation as well all necessary rotations. 

Then, after user approval, do the same for the following: canoe, sailboat, galley, caravel, clipper, frigate, destroyer, battleship, carrier. Canoe and sailboat can be 1x1 ingame size (16x16 pixels),  galley can be 1x2, caravel, clipper should be 1x3, and frigate should be 2x4. Battleship should be 2x5 and carrier should be 2x5. Show movement/firing (arrows for wooden ships, cannons for larger ships, and carrier doesn't need a firing animation) / sinking animations and rotations for each. Also create a shipwreck image of each of those ships showing what it looks like when each is sunk and mostly underwater. For each of these sets of results, group them together and present these in Storybook and only show the images and animations for each.

### Create new road bridge tiles
The current bridge appearance is rather poor; we need a new one using the existing wall (wooden and stone) assets as grounding. We should produce the following using the PixelLab AI API:
- new images for endpoints and interior sections of a bridge, and rotations of each so that they can be placed in both left-right and up-down orientations
- a screenshot showing how they look ingame with connected roads
The generation API should take the wood and stone; we should explore using the tileset generation API in addition to the object generation API and compare results. We should produce both wooden and stone bridges. Finally, after review, we may also produce a suspension bridge as well, which will be at least 6 tiles long, allowing for larger spans. 
We should also follow the same procedure to produce road tiles for 1) paved medieval roads, 2) simple asphalt roads, and 3) highways. These will need to have multiple junction tiles created as well, using the previous art and assets as grounding context in the pixellab api.

### Create new building images

Using the PixelLab AI API, create images for each of the following building types in 32x32 resolution and a 2x2 format. The prompt should be "Front-facing <X> viewed from slightly above, pixel art style, NOT isometric". Start with Temple, University, Palace, Library then present for review. Use the assets in the folder `public/assets/pixellab-grounding/buildings/` as the context for this; use the image generation API. The docs for that are at https://api.pixellab.ai/v2/docs#description/python-client. Start with a 2x2 grid cell (overall 32x32 resolution) layout, but adapt if it makes sense, e.g. an airport should be larger and is 48x32 or 64x32.

For each of these sets of results, group them together and present these in Storybook and only show the images and animations for each.

```
civ3_buildings = [
    "Airport",
    "Aqueduct",
    "Bank",
    "Barracks",
    "Cathedral",
    "Civil Defense",
    "Coal Plant",
    "Coastal Fortress",
    "Colosseum",
    "Commercial Dock",
    "Courthouse",
    "Factory",
    "Granary",
    "Harbor",
    "Hospital",
    "Hydro Plant",
    "Library",
    "Manufacturing Plant",
    "Marketplace",
    "Mass Transit System",
    "Nuclear Plant",
    "Offshore Platform",
    "Palace",
    "Police Station",
    "Recycling Center",
    "Research Lab",
    "SAM Missile Battery",
    "Stock Exchange",
    "Temple",
    "University",
]
```
