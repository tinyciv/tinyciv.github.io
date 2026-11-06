# Generated river worlds

`output/river-world-review.html` embeds six actual generated world snapshots:
two seeds across river basins, folded ranges and dissected plateaus. All use
Fractal landmasses and identical broader-upland settings (relief coverage .14,
hill size 1.4, mountain width 6, mountain share .5) to expose the canyon cuts.
Base game defaults remain unchanged. The review uses the game
terrain rasterizer, original Puny World ledges and Medieval World vegetation.
No server, external image or network connection is required.

The gallery opens a whole-world overview or a measured canyon focus. The
inspector supports pan/zoom, exact 16/32-pixel tile scales, small-river/large-river/canyon
jumps, woodland visibility, grid, ramps, favorites and exact
settings exports. Waterways mode shows the generated channel classes and
canyon walls; native terrain mode retains the actual water footprint.

Channel metrics use `Tile.channel` and `Tile.channelNext`. Only full river
channels are generated; headwater creeks have been removed. Canyon focus points
are actual river tiles explicitly marked `canyon: 'floor'`, with walls on
opposite sides. If no measured canyon is present, the gallery opens a river
detail instead. Canyon ledge counts require
both the generated canyon marker and an actual native ledge. This avoids
calling a river merely passing near a hill a carved canyon. Canyon focus ranks
actual walls on opposite sides of a four-step channel tangent and opens at
native 2× scale with a focus marker.

```sh
node scripts/build-river-world-review.mjs
node scripts/check-river-world-review.mjs
```

Use `--reuse-worlds` on the build command for UI-only changes. The browser must
support `DecompressionStream`. Frozen compressed snapshots, generator bundle,
measurements, screenshots and browser checks live under
`scratch/2026-10-31-rivers-without-creeks/`.
