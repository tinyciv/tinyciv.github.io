# World viewer

Run `npm run world`. Vite opens `/world.html` directly into a new, fully revealed
world using the normal world generator, founding code, assets, and game renderer.
The viewer never reads or writes game saves and keeps simulation time at zero.

The world type selector immediately regenerates continents, archipelago, Pangaea,
warm/cool/arid/wet climates, and young/old geology. Change size, landmass, water,
climate, temperature, age, landform family, river deltas, or the grouped landscape
controls, then choose **Regenerate** to compare with the same seed. **New seed**
keeps settings and generates another example. The URL records the settings and
seed, so it can be copied or reloaded to reproduce a world.

The whole map fits initially. Drag or use arrow keys/WASD to pan; scroll, pinch,
or use +/− to zoom; **Fit map** or F restores the complete overview. Click the
minimap to move the camera. Hover terrain for coordinates, biome, cover, resources,
and relief. City labels/borders and the tile grid can be toggled independently.

Landscape presets use the game's existing parameter resolver. Non-neutral
climate, age, water, and temperature settings determine the related low-level
controls, as in the game. The inputs show effective values. Editing a related
low-level value switches its world setting to neutral and preserves the other
effective values, so custom adjustments are not silently overridden.

`npm run test:startup -- --world` checks viewer startup, full reveal, paused time,
whole-map camera fit, fonts, and rendering, and saves
`output/startup/world-viewer.png`. It does not drive gameplay.
Add `--capture-ui` to also render screenshots of the Sandbox browser and loading
interface over the frozen viewer without starting a scenario.
