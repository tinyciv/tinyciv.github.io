import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'scratch/2026-11-03-world-additions';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
await page.routeWebSocket('**', socket => socket.close());
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); assert.ok(ok, `${name}: ${JSON.stringify(detail)}`); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5177/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && document.documentElement.dataset.assets === 'ready');
  const hidden = await page.evaluate(async () => {
    const { createGame } = await import('/src/game/simulation.ts');
    const { updateFog, pointInSight } = await import('/src/game/fog.ts');
    const { territory } = await import('/src/game/borders.ts');
    const s = createGame({ width: 64, height: 40, seed: 'border-fog-review', source: 'test', revision: 0,
      spawns: [{ x: 8, y: 20 }, { x: 46, y: 20 }],
      tiles: Array.from({ length: 2560 }, () => ({ terrain: 'grassland', overlay: 'none', elevation: .3, moisture: .5, food: 2, production: 1, gold: 0, variation: .5 })) });
    s.paused = true; s.factions = s.factions.slice(0, 2); s.factions[1].color = '#307ed6';
    s.buildings = s.buildings.filter(b => b.kind === 'palace' && b.faction < 2);
    s.units = s.units.filter(u => u.kind === 'leader' && u.faction === 0);
    s.villages = []; s.fields = []; s.raiderCamps = []; s.marauderPacks = []; delete s.fog;
    window.__game.replaceState(s);
    const enemy = s.buildings.find(b => b.faction === 1), fog = updateFog(s);
    __game.renderer.follow = false; __game.renderer.zoom = 1;
    __game.renderer.camera = { x: enemy.x + 1, y: enemy.y + 1 };
    for (let i = 0; i < 12; i++) __game.renderer.draw(s, .05);
    return { enemySeen: pointInSight(fog, enemy.x + 1, enemy.y + 1), enemyKnown: fog.buildings.some(b => b.id === enemy.id),
      paths: territory(s).paths.filter(p => p.edge.faction === 1 || p.edge.neighborFaction === 1).length };
  });
  check('enemy borders exist while the settlement itself stays undiscovered', !hidden.enemySeen && !hidden.enemyKnown && hidden.paths > 0, hidden);
  await page.screenshot({ path: `${output}/borders-through-fog.png` });
  const loading = await page.evaluate(async () => {
    const { Frontend } = await import('/src/ui/frontend.ts');
    const host = document.createElement('div'); host.id = 'loading-review'; document.body.append(host);
    new Frontend(host, () => {}).loading('Loading', '', .42);
    const title = host.querySelector('h1'), bar = host.querySelector('progress');
    const t = title.getBoundingClientRect(), p = bar.getBoundingClientRect();
    return { diamond: !!host.querySelector('.loading-emblem'), alignment: getComputedStyle(title).textAlign,
      centerDelta: Math.abs(t.x + t.width / 2 - p.x - p.width / 2), gap: p.top - t.bottom, value: bar.value };
  });
  check('loading title is centered immediately above the bar without a diamond', !loading.diamond && loading.alignment === 'center'
    && loading.centerDelta < 1 && loading.gap >= 0 && loading.gap <= 16 && loading.value === .42, loading);
  await page.screenshot({ path: `${output}/loading.png` });
  check('no runtime errors', errors.length === 0, errors);
} finally {
  writeFileSync(`${output}/loading-borders-checks.json`, JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
