/** Capture paused presentation on real scenario terrain, without advancing a battle. */
export async function captureBattlefieldEffects(page) {
  await page.setViewportSize({ width: 1280, height: 780 });
  const host = page.locator('[data-battlefield-preview]');
  for (const mode of ['gunpowder-smoke', 'anchored-warship']) {
    await page.evaluate(async mode => {
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const { Renderer } = await import('/src/game/renderer.ts');
      const { setMapRevealed } = await import('/src/game/fog.ts');
      const { recordGunSmoke, gunSmokePose } = await import('/src/game/gun-smoke.ts');
      const { warshipGunPoint } = await import('/src/game/warship-layout.ts');
      const battle = mode === 'gunpowder-smoke';
      const state = await createScenarioGame(battle ? 'musketry-deathmatch' : 'island-deathmatch');
      state.paused = true;
      setMapRevealed(state, true);
      const frameTime = state.time + 5;
      let camera;
      if (battle) {
        const muskets = state.units.filter(unit => unit.faction === 0 && unit.kind === 'musketman' && unit.x >= 25);
        if (muskets.length < 8) throw new Error('Gunpowder preview requires a ready musket company');
        muskets.forEach((unit, i) => {
          unit.facing = i % 3 === 0 ? -.16 : .08;
          unit.moving = false;
          for (const age of [4.65 - i % 4 * .25, 2.5 - i % 4 * .2, .82 - i % 3 * .25]) {
            state.time = frameTime - age;
            recordGunSmoke(state, unit, unit.facing, unit.id, false, .48);
          }
          unit.attackTime = .15;
        });
        const puff = state.gunSmoke[0];
        if (!(gunSmokePose(puff, puff.startedAt + 5)?.alpha > gunSmokePose(puff, puff.startedAt + 5.5)?.alpha)
          || gunSmokePose(puff, puff.startedAt + 6)) throw new Error('Smoke must linger for five seconds, then fade');
        camera = { x: 24, y: 18.5 };
      } else {
        const port = state.buildings.find(b => b.kind === 'shipyard' && b.faction === 0);
        const ship = state.units.find(unit => unit.hp > 0 && unit.warship?.yard === port?.id && unit.warship);
        if (!port || !ship) throw new Error('Warship preview requires a generated harbor and its starter warship');
        ship.moving = false;
        Object.assign(ship.warship, { anchored: true, speed: 0, weapons: ['cannon', 'ballista', 'cannon'] });
        state.time = frameTime - 1.6;
        recordGunSmoke(state, warshipGunPoint(ship, 0), .55, ship.id, true, .3);
        camera = { x: (ship.x * 2 + port.x + 1) / 3, y: (ship.y * 2 + port.y + 1) / 3 - .6 };
      }
      state.time = frameTime;
      const preview = document.createElement('div');
      preview.dataset.battlefieldPreview = '';
      Object.assign(preview.style, { position: 'fixed', inset: '0', zIndex: '99999' });
      preview.innerHTML = '<canvas style="display:block;width:100%;height:100%"></canvas><canvas hidden></canvas>';
      document.body.append(preview);
      const [canvas, minimap] = preview.querySelectorAll('canvas');
      const renderer = new Renderer(canvas, minimap);
      await renderer.initialize();
      renderer.follow = false;
      renderer.zoom = battle ? 2.55 : 2.45;
      renderer.camera = camera;
      renderer.draw(state, 0);
      window.__battlefieldPreview = { renderer, preview };
    }, mode);
    await host.screenshot({ path: `output/startup/${mode}.png` });
    await page.evaluate(() => {
      window.__battlefieldPreview.renderer.destroy();
      window.__battlefieldPreview.preview.remove();
    });
  }
}
