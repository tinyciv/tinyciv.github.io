import { mkdir } from 'node:fs/promises';

/** Draw authored procedural starts offscreen, without advancing or saving them. */
export async function captureSettlementTierPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1180, height: 900 });
  try {
    await page.evaluate(async () => {
      const { Renderer } = await import('/src/game/renderer.ts');
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const { cityResidents } = await import('/src/game/cities.ts');
      const { setMapRevealed } = await import('/src/game/fog.ts');
      const { buildingActivityAvailable } = await import('/src/game/building-activity.ts');
      const { settlementLabel, settlementPopulationLimit } = await import('/src/game/settlement-upgrades.ts');
      const { buildingArtTop } = await import('/src/game/types.ts');
      const { drawPalace, palaceArtHeight } = await import('/src/game/palace-sprite.ts');
      for (const [level, x, y, color] of [[1, 13, 11, '#3988ff'], [2, 26, 31, '#9054ed']]) {
        const sprite = document.createElement('canvas');
        sprite.width = 32;
        sprite.height = palaceArtHeight(level, 32, 3);
        const context = sprite.getContext('2d');
        drawPalace(context, 0, 0, 32, color, level, 3);
        const [red, , blue, alpha] = context.getImageData(x, y, 1, 1).data;
        if (blue <= red || alpha !== 255) throw new Error(`Metropolis roof accent did not take faction color at ${x},${y}`);
      }
      const sandbox = await createScenarioGame('sandbox');
      const musketry = await createScenarioGame('musketry-deathmatch');
      const exploration = await createScenarioGame('age-of-exploration');
      const explorationCities = cityResidents(exploration);
      const town = cityResidents(musketry).find(({ palace, population }) => palace.faction === 0
        && palace.settlementTier === 1 && population === settlementPopulationLimit(palace)
        && !buildingActivityAvailable(musketry, palace));
      const examples = [
        [sandbox, cityResidents(sandbox).find(({ palace }) => (palace.settlementTier ?? 0) === 0)],
        [musketry, town],
        [exploration, explorationCities.find(({ palace }) => palace.settlementTier === 2 && palace.faction === 0)],
        [exploration, explorationCities.find(({ palace }) => palace.settlementTier === 3)],
      ];
      if (examples.some(([, city]) => !city)) throw new Error('Settlement preview needs all four civic tiers and a capped Town beyond Leader range');

      const host = document.createElement('section');
      host.id = 'startup-settlement-tiers';
      Object.assign(host.style, {
        position: 'fixed', inset: '0', zIndex: '99999', padding: '20px 24px', background: '#20261c',
        color: '#f7eedc', display: 'grid', gridTemplateColumns: 'repeat(2, 556px)',
        gridTemplateRows: '40px repeat(2, 390px)', gap: '12px 20px',
        font: '20px "Pixel Operator"',
      });
      const title = document.createElement('h1');
      title.textContent = 'Settlement tiers';
      Object.assign(title.style, { gridColumn: '1 / -1', margin: '0', font: 'bold 34px "Pixel Operator"' });
      host.append(title);
      document.body.append(host);

      const canvas = document.createElement('canvas');
      Object.assign(canvas.style, { position: 'fixed', left: '-600px', top: '0', width: '556px', height: '350px' });
      host.append(canvas);
      const renderer = new Renderer(canvas, document.createElement('canvas'));
      await renderer.initialize();
      renderer.follow = false;
      renderer.overlays = false;
      renderer.zoom = 1.9;

      const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
      const peak = Math.ceil(performance.now() / 1800) * 1800;
      const frameAt = (state, clock) => {
        Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
        try { renderer.draw(state, 0); } finally {
          if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
          else delete performance.now;
        }
        return renderer.snapshot();
      };
      const compareOutline = (palace, first, second) => {
        const topLeft = renderer.screenPoint({ x: palace.x - .2, y: palace.y + buildingArtTop(palace) - .2 });
        const bottomRight = renderer.screenPoint({ x: palace.x + 2.2, y: palace.y + 2.2 });
        const density = first.width / renderer.width;
        const x = Math.floor(topLeft.x * density), y = Math.floor(topLeft.y * density);
        const width = Math.ceil(bottomRight.x * density) - x, height = Math.ceil(bottomRight.y * density) - y;
        const sample = document.createElement('canvas');
        sample.width = width; sample.height = height;
        const context = sample.getContext('2d', { willReadFrequently: true });
        context.drawImage(first, -x, -y);
        const before = context.getImageData(0, 0, width, height).data;
        context.drawImage(second, -x, -y);
        const after = context.getImageData(0, 0, width, height).data;
        let changes = 0;
        for (let i = 0; i < before.length; i += 4)
          if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) >= 24) changes++;
        return changes;
      };

      try {
        for (const [state, city] of examples) {
          state.paused = true;
          const time = state.time;
          setMapRevealed(state, true);
          const { palace, name, population } = city;
          const limit = settlementPopulationLimit(palace), capped = population >= limit;
          renderer.camera = { x: palace.x + 1, y: palace.y + 1 + buildingArtTop(palace) / 2 };
          const bright = frameAt(state, peak);
          if (city === town || !Number.isFinite(limit)) {
            const dim = frameAt(state, peak + 900);
            const changes = compareOutline(palace, bright, dim);
            if (city === town ? changes < 30 : changes >= 30)
              throw new Error(`Unexpected capacity pulse raster for ${name} (${changes} changing pixels)`);
          }
          if (state.time !== time) throw new Error('Settlement tier preview advanced simulation time');

          const section = document.createElement('section'), heading = document.createElement('header');
          const label = document.createElement('strong'), caption = document.createElement('span');
          label.textContent = `${settlementLabel(palace)} · ${name}`;
          caption.textContent = Number.isFinite(limit) ? `${population} / ${limit}${capped ? ' · At cap' : ''}` : `${population} · Uncapped`;
          caption.style.color = capped ? '#ffd193' : '#d7deca';
          Object.assign(heading.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            height: '40px', padding: '0 10px', background: '#333b2e' });
          Object.assign(bright.style, { display: 'block', width: '556px', height: '350px', imageRendering: 'pixelated' });
          heading.append(label, caption);
          section.append(heading, bright);
          host.append(section);
        }
      } finally {
        renderer.destroy();
        canvas.remove();
      }
    });
    await mkdir('output/startup', { recursive: true });
    await page.locator('#startup-settlement-tiers').screenshot({ path: 'output/startup/settlement-tiers.png' });
  } finally {
    await page.locator('#startup-settlement-tiers').evaluateAll(elements => elements.forEach(element => element.remove()));
    await page.setViewportSize(viewport);
  }
}
