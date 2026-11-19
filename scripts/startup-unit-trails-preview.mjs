import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const output = 'scratch/2026-11-18-unit-tracks';

/** Render authored movement poses on an existing baked world, without playing the scenario. */
export async function captureUnitTrailsPreview(page) {
  await page.setViewportSize({ width: 1056, height: 592 });
  await mkdir(`${output}/frames`, { recursive: true });
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { Renderer } = await import('/src/game/renderer.ts');
    const { presentationFog, setMapRevealed } = await import('/src/game/fog.ts');
    const { buildingWidth, buildingHeight, tileAt } = await import('/src/game/types.ts');
    const { unitDustVisible } = await import('/src/game/unit-trails.ts');
    const state = await createScenarioGame('no-mans-land');
    state.paused = true;
    const { world } = state, time = state.time;
    const occupied = new Set(), scenery = new Set();
    for (const b of state.buildings) if (b.hp > 0 && b.kind !== 'road') {
      for (let dy = 0; dy < buildingHeight(b); dy++) for (let dx = 0; dx < buildingWidth(b); dx++)
        occupied.add((b.y + dy) * world.width + b.x + dx);
      scenery.add(b.y * world.width + b.x);
    }
    const lanes = [
      { kind: 'knight', x: .75, y: -.92, speed: 2.35 },
      { kind: 'pikeman', x: .3, y: -.26, speed: 1.9 },
      { kind: 'musketman', x: -.5, y: .38, speed: 1.85 },
      { kind: 'musketman', x: .24, y: .96, speed: 1.8 },
      { kind: 'pikeman', x: -.8, y: 1.48, speed: 1.75 },
    ];
    const unitsUsed = new Set();
    const units = lanes.map(lane => {
      const unit = state.units.find(u => u.faction === 0 && u.kind === lane.kind && u.hp > 0 && !unitsUsed.has(u));
      if (!unit) throw new Error(`The preview needs a friendly ${lane.kind}`);
      unitsUsed.add(unit);
      return unit;
    });
    const duration = 2.5;
    const findRoute = terrain => {
      let best;
      for (let y = 4; y < world.height - 4; y++) for (let x = 4; x < world.width - 10; x++) {
        const canStage = lanes.every(lane => {
          for (let t = 0; t <= duration; t += .125) {
            const px = Math.floor(x + lane.x + lane.speed * t), py = Math.floor(y + lane.y - .28 * t);
            const tile = tileAt(world, px, py);
            if (tile?.terrain !== terrain || tile.relief || tile.creek || tile.marsh || tile.resource
              || tile.overlay !== 'none' || occupied.has(py * world.width + px)) return false;
          }
          return true;
        });
        if (!canStage) continue;
        let score = 0;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -4; dx <= 10; dx++) {
          const tile = tileAt(world, x + dx, y + dy);
          if (!tile) continue;
          score += Number(scenery.has((y + dy) * world.width + x + dx)) * (Math.abs(dy) < 4 ? 4 : 1);
          score += Number(tile.palm || tile.overlay === 'forest' || !!tile.creek) * .5;
        }
        if (!best || score > best.score) best = { x, y, score };
      }
      if (!best) throw new Error(`Could not find unobstructed generated ${terrain} for the preview`);
      return best;
    };
    const locations = { desert: findRoute('desert'), grassland: findRoute('grassland') };
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999' });
    host.innerHTML = '<canvas style="display:block;width:100%;height:100%"></canvas><canvas hidden></canvas>';
    document.body.append(host);
    const [canvas, minimap] = host.querySelectorAll('canvas');
    const renderer = new Renderer(canvas, minimap);
    await renderer.initialize();
    renderer.zoom = 2.8;
    renderer.follow = false;
    renderer.overlays = false;
    setMapRevealed(state, true);
    const draw = (terrain, elapsed) => {
      const start = locations[terrain], t = Math.min(duration, elapsed);
      renderer.camera = { x: start.x + 2.6, y: start.y - .38 };
      for (const [i, lane] of lanes.entries()) Object.assign(units[i], {
        x: start.x + lane.x + lane.speed * t, y: start.y + lane.y - .28 * t,
        facing: Math.atan2(-.28, lane.speed), moving: elapsed <= duration, inside: false,
      });
      state.time = time + elapsed;
      renderer.mountedAnimation.time = elapsed;
      renderer.draw(state, 0);
    };
    const effects = () => {
      const result = { tracks: 0, newPuffs: 0, puffStamps: 0, surfaces: [] };
      const { x, y } = renderer.camera;
      renderer.unitTrails.forEachVisible({ left: x - 6, right: x + 6, top: y - 3, bottom: y + 3 }, presentationFog(state), (track, age) => {
        result.tracks++;
        result.puffStamps += Number(track.puff);
        result.newPuffs += Number(unitDustVisible(track, age));
        if (!result.surfaces.includes(track.surface)) result.surfaces.push(track.surface);
      });
      return result;
    };
    window.__unitTrailsReview = { draw, effects, host, renderer };
  });

  const samples = new Map();
  const reviewTimes = new Set([17 / 8, 3.5, 6.5, 7.5]);
  const movement = Array.from({ length: 21 }, (_, frame) => frame / 8);
  const fade = Array.from({ length: 20 }, (_, frame) => 3 + frame / 2);
  for (const [frame, elapsed] of [...movement, ...fade].entries()) {
    const { png, stats } = await page.evaluate(({ elapsed, review }) => {
      const { draw, effects, renderer } = window.__unitTrailsReview;
      draw('desert', elapsed);
      return { png: renderer.snapshot().toDataURL('image/png').split(',')[1], stats: review ? effects() : undefined };
    }, { elapsed, review: reviewTimes.has(elapsed) });
    if (stats) samples.set(elapsed, stats);
    await writeFile(`${output}/frames/${String(frame).padStart(2, '0')}.png`, Buffer.from(png, 'base64'));
    if (frame === 17) await writeFile(`${output}/desert.png`, Buffer.from(png, 'base64'));
  }
  const report = await page.evaluate(() => {
    const { draw, effects, renderer } = window.__unitTrailsReview;
    for (let frame = 0; frame <= 17; frame++) draw('grassland', frame / 8);
    return { grassland: effects(), image: renderer.snapshot().toDataURL('image/png').split(',')[1] };
  });
  const desert = samples.get(17 / 8);
  assert.deepEqual(desert.surfaces, ['desert']);
  assert.deepEqual(report.grassland.surfaces, ['grassland']);
  assert.ok(desert.tracks > 0 && desert.newPuffs > 0 && report.grassland.newPuffs > 0);
  assert.ok(desert.puffStamps > report.grassland.puffStamps && desert.newPuffs > report.grassland.newPuffs);
  assert.equal(samples.get(3.5).newPuffs, 0);
  assert.ok(samples.get(6.5).tracks > 0);
  assert.equal(samples.get(7.5).tracks, 0);
  await writeFile(`${output}/grassland.png`, Buffer.from(report.image, 'base64'));
  await page.evaluate(() => {
    const { host, renderer } = window.__unitTrailsReview;
    renderer.destroy();
    host.remove();
  });
}
