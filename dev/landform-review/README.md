# Geological landform review

`output/landform-world-review.html` contains twelve frozen world snapshots:
two seeds × six explicit landform families, all using the same Fractal style
and current default landscape parameters. It embeds existing Puny World and
Medieval World artwork and complete compressed worlds. No server or network
connection is needed; the browser must support `DecompressionStream`.

The gallery compares terrain, continuous elevation and province assignments.
The inspector adds native-art pan/zoom, exact 16/32-pixel tile scales, trees,
grid and ramp controls, and jumps to measured provinces, relief, rivers, lakes,
rift regions, glacial coastlines and woodland. Unavailable features are disabled.
Stars and JSON exports record favorites and exact generation configurations.

The UI explains the geometric definitions of flat interiors, low corridors,
body elongation and orientation. Woodland measurements reuse the open-forest
review's cardinal reachable-gap and no-solid-2×2 checks. These are diagnostics,
not claims that the terrain is a physical geological simulation.

```sh
node scripts/build-landform-review.mjs
node scripts/check-landform-review.mjs
```

For UI-only changes, reuse the frozen worlds without regeneration:

```sh
node scripts/build-landform-review.mjs --reuse-worlds
```

World snapshots, the bundled generator snapshot, timings, measurements, browser
checks and screenshots are in `scratch/2026-10-30-landforms/`. Timings cover
generation only, excluding measurement and compression. The gallery remains
separate from the existing forest and fractal reviews.
