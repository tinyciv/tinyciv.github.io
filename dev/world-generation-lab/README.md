# World generation preview

Open `output/world-generation-lab.html` directly in a browser. The file embeds
the current production generator and Puny World terrain artwork; no server or
network connection is needed.

The three overview cards generate Continents, Pangaea, and Fractal at the same
seed and game dimensions. Click a map location to inspect it with the real
terrain renderer. Drag to pan, scroll or use the buttons to zoom, and jump to
hill country, freshwater, mountain passes, or a starting city. Optional markings
show uphill ramps and traversable mountain-pass cells; the grid and tile
inspector expose exact navigation geometry.

Five generated terrain samples show grassy hills, desert hills, a layered
mountain range, a compact lake, and a winding lake. These use the same production
placement helpers on flat sample worlds. The world views use the production
tree families and embedded Medieval World artwork. Woodland is visible by
default; switch it off to inspect cliff silhouettes. A dedicated jump locates
forested high ground. The mountain sample also uses production ecology to show
forests on upper floors. Hill and lake geometry samples remain bare, and buildings
are omitted.

Hill country mixes tiny 2×2, 2×3, and 2×4 closed outcrops with varied larger
shelves. Tiny outcrops consist entirely of ledge cells; they have no traversable
summit or artificial ramp. Mountain ranges use slim bands with occasional
low-ground passes.

Rebuild after changing world generation:

```sh
node scripts/build-world-generation-lab.mjs
node scripts/check-world-generation-lab.mjs
```

The browser check uses isolated Chrome, opens the artifact over `file://`, checks
controls and mobile layout, verifies zero network requests, and saves screenshots
and results in `scratch/2026-10-30-world-generation/`.
