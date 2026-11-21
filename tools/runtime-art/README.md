# Runtime artwork

The game fetches compact derivatives from `public/assets/runtime/`. Original art
stays in its existing location for authoring, future exports, and source-coordinate
metadata. `npm run build`, `npm run frozen`, and the deployment workflow use
the checked-in derivatives directly. Players fetch the derivatives used by the
game, and the originals stay available in `public/` for authoring.

## Rebuild

Rebuilding requires Python 3 with Pillow, the WebP `cwebp` executable on `PATH`,
and the project's npm dependencies. The ore and relief transforms also require
Chrome or Playwright Chromium; set `BROWSER_EXECUTABLE` to select a browser.

```sh
npm run build:art
npm run check:art
```

The build reuses unchanged outputs. Use `python3 tools/runtime-art/build.py
--force` to rebuild everything, or `--jobs 2` to limit parallel encodes.
`check:art` verifies source/profile fingerprints, generated file hashes, and the
URL map without opening the game or rebuilding images. After changing source art
or profiles, rebuild and review the affected surfaces at their actual display
size. Commit the updated sources or profiles, derivatives, `manifest.json`, and
`src/generated/runtime-art.json` together.

`npm run test:startup -- --capture-art` also captures before/after artwork at
1× and 2× density in `output/startup/`, verifies native browser-decoded pixels,
and records the startup page's artwork requests. It uses a separate static
review page after the normal startup check; it does not run a playtest.

## Sizing and fidelity

- Native terrain, characters, animation sheets, and coordinate atlases keep their
  dimensions and pixels unless a dedicated transform reproduces the game's
  existing rasterization. Animation timing and source rectangles stay intact.
- Oversized UI images target their largest displayed size with approximately
  2× density allowance. Pixelated sheets use nearest sampling; smooth UI art uses
  Lanczos. Sprite grids keep the same cell layout and aspect ratio.
- Full-screen scenes, wide frames, and nine-slice images retain their original
  dimensions when reducing them would lose detail at supported layouts. Any
  resized nine-slice image must also update every source-pixel slice value.
- The HUD uses a separate 793×496 panel frame for its maximum 250×202 controls
  at 2× density. Tall compact world-setup panels keep the full-size frame and
  original nine-slice coordinates; they fetch it only when that view is shown.
- A dedicated crop can replace a large reference sheet when the UI uses only a
  small region. The slate texture, retinue icon, and favicon have separate URLs.

Derivatives use lossless encoding. WebP uses `cwebp -lossless -exact`; native
PNG art with partial transparency retains PNG because browser alpha decoding
can differ between formats even when the encoded RGBA pixels match. This keeps
existing Canvas pixels and UI edges faithful. Automatic conversions keep the
original pixel dimensions and are used only when the output is smaller. An
existing WebP is retained when re-encoding would increase its size.

## Profiles and URLs

The JSON arrays beside `build.py` contain explicit profiles. `source` and
`output` paths are relative to `public/`:

```json
{
  "source": "assets/ui/example.png",
  "output": "assets/runtime/ui/example.webp",
  "width": 128,
  "height": 128,
  "resample": "lanczos"
}
```

Optional `crop` is `[x, y, width, height]`, applied before resizing. Dimensions
are explicit; preserve the intended aspect ratio when choosing both values.
Profiles alias the source URL by default. Set `alias: false` for a dedicated crop
or repacked atlas whose coordinates differ from the original, then update its
consumer explicitly. Game image loaders use `runtimeArtUrl()` and the generated
map; CSS uses the derivative URL directly.

Custom transforms use `transform: "ore-atlas"` plus `family`, or
`transform: "relief-atlas"` plus `style`. Their `.mjs` files rasterize isolated
images in browser Canvas using the existing sampling and alpha thresholds. They
do not start the game or simulate a world. Update the matching loader whenever
atlas layout changes; relief fingerprints also include `relief-shapes.json`.
Bump `VERSION` in `build.py` when changing shared encoding or resizing behavior
so cached derivatives are rebuilt.
