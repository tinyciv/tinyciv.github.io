# TinyCiv Storybook

Storybook 10 (`@storybook/html-vite` 10.6.4, exact pins) previews the game with
the real code path: `generateWorld` -> `createGame`/`createDuelGame` ->
`updateGame` (Rust WASM core) -> `Renderer` (`PixiScene`, WebGL). Nothing is
mocked or screenshotted. All story text uses Pixel Operator.

```sh
npm run storybook         # dev server: http://127.0.0.1:6006
npm run build-storybook   # static build -> storybook-static/ (git-ignored)
npx tsc --noEmit -p stories/tsconfig.json   # typecheck stories + .storybook
```

- Stories: `stories/**/*.stories.ts` (CSF 3, `@storybook/html-vite` types).
- `public/` is a static dir, so `/wasm/simulation.wasm`, `/assets/...` and the
  fonts load exactly as in the app.
- The dev server watcher ignores `scratch/`, `output/`, `dist/`, so other tools
  writing review files never reload stories.
- Direct iframe URL for checks: `http://127.0.0.1:6006/iframe.html?id=<story-id>&viewMode=story`.

## Musket firing range

`units-musketman-firing--volley` shows synchronized musket volleys at normal
speed and 0.1× slow motion, with the shipped faction-colored animation sheets
and the same bullet drawing used by the game. Rust's projectile engine supplies
the flight positions and duration; the preview does not start a game.

Each panel has Play/Pause, Replay volley, Freeze bullet, and a scrubber. The
normal panel includes the full 2.5-second reload. Slow motion repeats the first
0.8 seconds so the firing animation remains easy to inspect. Storybook controls
select any of eight directions, one to five soldiers, and the faction color.
`units-musketman-firing--bullet-in-flight` opens both panels paused halfway
through a bullet's flight.

## Base scenarios (`stories/game/Scenarios.stories.ts`)

| Story id | Seed | What it shows |
|---|---|---|
| `game-base-scenarios--river-city` | `Storybook-River-1`, `river-basin` landform, advanced start, 3 s simulated, map revealed | River plains and a developed capital |
| `game-base-scenarios--walled-city` | `Storybook-Walls-1`, advanced start, stone wall ring built with the player build path, south side left as live construction, 5 s simulated | Walled city; builders at work |
| `game-base-scenarios--field-battle` | `Storybook-Battle-1`, advanced start, player army vs. the hostile rival's army beside the capital, 4 s simulated at 1/30 s steps | Live combat |

Controls (Storybook args): `width`, `height`, `zoom` (0.65 to 2.2, like the
game), `play`. Each scenario also has **Play / Pause** and **Step 1 s** buttons
that run the real simulation. Building a scenario takes about 7 to 9 s (world
generation plus an advanced-start city); a "Building ..." line shows meanwhile.
Builds are deterministic: the same seed and options give the same state in
Node and in the browser.

## a) Scenario harness

Files: `stories/harness/scenario.ts` (DOM-free; also runs in Node via
`npx vite-node`) and `stories/harness/mount.ts` (browser rendering).

```ts
import { buildScenario, simulate, scenarioTools, IDLE_INPUT } from '../harness/scenario';
import { scenarioStory, mountGameState } from '../harness/mount';

buildScenario(options: ScenarioOptions): GameState
interface ScenarioOptions {
  seed: string;                               // fixed seed => deterministic
  world?: { width?, height?, style?, landformFamily?, parameters?, riverDeltas? }; // WorldGenerationOptions
  game?: { advancedStart?, banditIntensity?, enemyStrength?, duel? };        // createGame / createDuelGame
  mutate?: (state: GameState, tools: ScenarioTools) => void;                 // edit before simulating
  simulateSeconds?: number;                   // real updateGame time to advance (default 0)
  step?: number;                              // fixed step, default 0.1 (the game's largest step)
  revealMap?: boolean;                        // the in-game dev "Reveal map" view
}
simulate(state, seconds, step = 0.1): void    // non-interactive updateGame loop
```

`ScenarioTools` (passed to `mutate`, or `scenarioTools(state)`) only calls game APIs:

| Tool | Purpose |
|---|---|
| `playerPalace(faction?)`, `centerOf(building)`, `leader(faction?)` | Find things |
| `army(faction, includeLeader = true)` | Living soldiers outside buildings |
| `hostileFaction()` | First rival at war with the player |
| `build(kind, points, faction?)` | Real `buildStroke` (player rules, gates on roads, costs); splits strokes to honor the Leader's 10-tile range and tops up gold |
| `line(a, b)` | Straight list of cells |
| `completeConstruction(filter?)` | Finish queued sites instantly (same steps as `updateConstruction`) |
| `ringRadius(center, min, max, maxBlocked?)` | Pick a square ring that avoids buildings |
| `openField(around, halfW, halfH, minR?, maxR?, factions?)` | Open ground walkable for the listed factions |
| `reinforce(faction, count, roles?)` | Copy a faction soldier with new entity IDs and `setSoldierRole` roles |
| `formation(units, center, columns?, spacing?)` | Arrange units in a block |

Rendering:

```ts
// In a story's render(): returns an element immediately, builds + mounts async.
scenarioStory(
  scenario: ScenarioOptions | (() => GameState | Promise<GameState>),
  options?: MountOptions | ((state: GameState) => MountOptions),
  title?: string,                              // "Building <title>..."
): HTMLElement

// Lower level: mount an existing state into a connected host element.
mountGameState(host: HTMLElement, state: GameState, options?: MountOptions): Promise<MountedScenario>
interface MountOptions {
  camera?: Point;      // world tiles at the view centre (default: player capital)
  zoom?: number;       // clamped to MIN_ZOOM..MAX_ZOOM (0.65..2.2)
  width?: number; height?: number;  // CSS px, default 1280 x 800
  play?: boolean;      // start running (default false: frozen, deterministic frame)
  controls?: boolean;  // Play/Pause + Step 1 s bar (default true)
}
interface MountedScenario { state; renderer; canvas; element; playing; step(seconds); draw(dt?); snapshot(): HTMLCanvasElement; destroy() }
```

The mount awaits `loadGameArt()` (`stories/harness/assets.ts`), the same
loaders `src/main.ts` awaits; `tests/storybook-harness.test.ts` fails if the
lists drift. Playback uses the same elapsed-time simulation clock as `main.ts`.
Rendering runs independently, and paused frames are drawn with `dt = 0`. When ready,
`.tc-scenario` gets `data-ready="true"`, and `window.__scenario` holds the
`MountedScenario` for headless checks. Leaving the story destroys the WebGL
renderer.

Example story:

```ts
import type { Meta, StoryObj } from '@storybook/html-vite';
import { scenarioStory } from '../harness/mount';
import { scenarioTools } from '../harness/scenario';

export default { title: 'Game/My Feature' } satisfies Meta;
export const Village: StoryObj = {
  render: () => scenarioStory({
    seed: 'My-Feature-1', simulateSeconds: 10,
    mutate: (state, tools) => { tools.build('house', [{ x: 10, y: 12 }]); tools.completeConstruction(); },
  }, state => ({ camera: scenarioTools(state).centerOf(scenarioTools(state).playerPalace()), zoom: 1.2 }), 'village'),
};
```

## b) Gallery helper (images and animations only)

File: `stories/harness/gallery.ts`.

```ts
import { renderGallery, repoAsset } from '../harness/gallery';

renderGallery(items: GalleryItem[], options?: { scales?: number[]; background?: string }): HTMLElement
interface GalleryItem {
  label: string;           // the only text shown, e.g. '1A', '2C'
  src: string;             // repoAsset('scratch/...png'), '/assets/...png', or a Vite `?url` import
  sheet?: {                // present => animated sprite sheet
    frameWidth: number; frameHeight: number;
    rows?: number;         // rows = directions (default image height / frameHeight)
    columns?: number;      // columns = frames (default image width / frameWidth)
    fps?: number;          // default 8
    rowIndices?: number[]; // subset/order of direction rows
    frames?: number;       // frames used per row if fewer than columns
    offsetX?: number; offsetY?: number;
  };
  scales?: number[];       // per-item override
}
repoAsset(path: string): string   // 'scratch/a/b.png' -> '/@repo/scratch/a/b.png'
```

Each item shows its label, then every image or direction row at native, 2x and
4x (default `[1, 2, 4]`, left to right), nearest-neighbor, with sheets
animating. There is no other text. `.tc-gallery` gets `data-ready` once every
image has loaded or failed. A missing file shows its error in red.

Serving repo files: the dev server serves `GET /@repo/<path>` for image files
(`png gif webp jpg jpeg svg`) under `scratch/`, `public/`, `docs/` and `output/`
only. Everything else is a 404, so `.env.local` is never served. `/@repo/` is a
dev-server route only. If a gallery must also work in `npm run build-storybook`,
import its files so Vite bundles them:

```ts
const sheets = import.meta.glob('../../scratch/2026-11-11-ships/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
```

Example: `stories/gallery/GalleryExample.stories.ts`.

## Verification

`node stories/check-stories.mjs` (Playwright, same Chrome setup as
`scripts/*-check.mjs`; env `STORYBOOK_URL`, `STORIES=id1,id2`, `CHECK_OUT`)
loads each story iframe, waits for `data-ready`, reads the WebGL frame back
through `window.__scenario.snapshot()`, and checks for console errors.
For gallery stories it checks that canvases rendered and no image is missing.
Screenshots and `report.json` go to `scratch/2026-11-11-storybook/` by default.

## Main menu

- `menu-main-menu--menu` mounts the real `Frontend` (src/ui/frontend.ts) with no game: painted backdrop, engine-rendered globe and every menu view (`view`, `resumable`, `saved` args).
- `menu-globe-bake--whole-world` builds the globe's world (seed `Globe-4`, 128 × 128 fractal, complete advanced start, 150 s simulated, a field battle; worlds under 128 tiles are always one compact island) and draws all of it at zoom 1 with `overlays: false`. `node scripts/bake-menu-globe.mjs` reads it back into `public/assets/ui/main-menu/globe-world.webp`.
