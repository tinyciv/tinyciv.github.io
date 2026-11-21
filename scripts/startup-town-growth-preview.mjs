import { mkdir } from 'node:fs/promises';

export async function captureTownGrowthPreview(page) {
  await page.setViewportSize({ width: 1120, height: 730 });
  await mkdir('output/startup', { recursive: true });
  for (const feature of ['street', 'stone-walls']) {
    await page.evaluate(async feature => {
      const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
      const { Renderer } = await import('/src/game/renderer.ts');
      const { entityStore } = await import('/src/game/entity-store.ts');
      const { setMapRevealed } = await import('/src/game/fog.ts');
      const { territory } = await import('/src/game/borders.ts');
      const { planTownStreet } = await import('/src/game/town-streets.ts');
      const { validateBuildAt } = await import('/src/game/simulation.ts');
      const { removeBuildings } = await import('/src/game/construction-cancellation.ts');
      const { invalidateNavigation } = await import('/src/game/pathfinding.ts');
      const { cityTaxIncome } = await import('/src/game/cities.ts');
      const { isHouseEnclosed, stoneWalledPalaces } = await import('/src/game/enclosures.ts');
      const { researchAllocation, isBuildingUnlocked } = await import('/src/game/research.ts');
      const state = await createScenarioGame('sandbox');
      const faction = state.factions[0], store = entityStore(state);
      const town = state.buildings.find(b => b.kind === 'palace' && b.faction === faction.id);
      if (state.buildings.some(b => ['scoutTower', 'woodenTower', 'tower'].includes(b.kind))) throw new Error('Sandbox started with a tower');
      if (researchAllocation(faction) !== .10 || isBuildingUnlocked(faction, 'fountain')) throw new Error('Sandbox starting research settings are incorrect');
      const add = (kind, point) => {
        const building = { id: store.allocateId(), kind, faction: faction.id, ...point, hp: 100, maxHp: 100, capacity: 0 };
        store.buildings.add(building);
        return building;
      };
      const leader = state.units.find(unit => unit.kind === 'leader' && unit.faction === faction.id);
      let focus = { x: town.x + 1, y: town.y + 1 };
      let street = [];
      if (feature === 'street') {
        const borders = territory(state);
        state.scenarioPreparing = true;
        for (let y = town.y - 6; y <= town.y + 8 && !street.length; y++) {
          for (let x = town.x - 8; x <= town.x + 12 && !street.length; x++) {
            const point = { x, y };
            const branch = planTownStreet(state, town, point, borders);
            if (!branch.length || !validateBuildAt(state, 'house', x, y, faction.id, undefined, false, true).ok
              || !branch.every(p => validateBuildAt(state, 'road', p.x, p.y, faction.id, undefined, false, true).ok)) continue;
            street = branch;
            add('house', point);
            for (const cell of street) add('road', cell);
          }
        }
        state.scenarioPreparing = false;
        if (street.length < 3 || street.length > 4) throw new Error('Expected a three- or four-tile street extension');
        const end = street.at(-1);
        focus = { x: (focus.x + end.x) / 2, y: (focus.y + end.y) / 2 };
      } else {
        const perimeter = [];
        for (let y = town.y - 3; y <= town.y + 4; y++)
          for (let x = town.x - 3; x <= town.x + 5; x++)
            if (x === town.x - 3 || x === town.x + 5 || y === town.y - 3 || y === town.y + 4) perimeter.push({ x, y });
        const covered = state.buildings.filter(b => perimeter.some(p => p.x === b.x && p.y === b.y));
        if (covered.some(b => b.kind === 'house' || b.kind === 'palace')) throw new Error('Preview walls overlap housing');
        removeBuildings(state, new Set(covered.filter(b => b.kind !== 'road' || b.x === town.x + 4 && b.y === town.y - 3).map(b => b.id)));
        const baseline = cityTaxIncome(state, faction);
        const walls = perimeter.map(point => add('wall', point));
        invalidateNavigation(state);
        const homes = state.buildings.filter(b => b.kind === 'house' && b.faction === faction.id);
        if (!stoneWalledPalaces(state).has(town.id) || !homes.some(home => isHouseEnclosed(state, home))
          || Math.abs(cityTaxIncome(state, faction) - baseline * 1.2) > 1e-8)
          throw new Error('Completed stone walls must combine the enclosure effect with +20% city taxes');
        const segment = walls.find(b => b.x === town.x && b.y === town.y - 3);
        store.setBuildingKind(segment, 'palisade');
        if (stoneWalledPalaces(state).has(town.id) || !homes.some(home => isHouseEnclosed(state, home))
          || cityTaxIncome(state, faction) !== baseline) throw new Error('A palisade segment must retain growth and remove the stone wealth bonus');
        store.setBuildingKind(segment, 'wall');
      }
      if (leader) state.selected = leader.id;
      state.paused = true;
      invalidateNavigation(state);
      setMapRevealed(state, true);
      const host = document.createElement('div');
      host.dataset.townGrowthPreview = feature;
      Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: '#20261c' });
      host.innerHTML = '<canvas style="width:100%;height:100%;display:block"></canvas><canvas hidden></canvas>';
      document.body.append(host);
      const [canvas, minimap] = host.querySelectorAll('canvas'), renderer = new Renderer(canvas, minimap);
      await renderer.initialize();
      renderer.follow = false;
      renderer.camera = focus;
      renderer.zoom = feature === 'street' ? 1.7 : 2.15;
      renderer.draw(state, 0);
      if (street.length) {
        const label = document.createElement('div'), end = street.at(-1);
        const point = renderer.screenPoint({ x: end.x + .5, y: end.y + 1.35 });
        Object.assign(label.style, { position: 'absolute', left: `${point.x}px`, top: `${point.y}px`,
          transform: 'translateX(-50%)', padding: '5px 10px', background: '#18221ef0', color: '#ffedc3', font: '22px "Pixel Operator"' });
        label.textContent = `${street.length}-tile road extension`;
        host.append(label);
      }
    }, feature);
    await page.screenshot({ path: `output/startup/town-${feature}.png` });
    await page.locator('[data-town-growth-preview]').evaluate(element => element.remove());
  }
  await page.evaluate(async () => {
    const { createScenarioGame } = await import('/src/game/scenario-loader.ts');
    const { isMapRevealed, presentationFog } = await import('/src/game/fog.ts');
    const { isBuildingUnlocked } = await import('/src/game/research.ts');
    const { WOODEN_TOWER_RANGE } = await import('/src/game/tower-combat.ts');
    const { unitDamage } = await import('/src/game/veterancy.ts');
    const state = await createScenarioGame('no-mans-land');
    const fog = presentationFog(state);
    if (isMapRevealed(state) || fog.explored.some(cell => cell !== 1) || !fog.visible.includes(0))
      throw new Error('No Man’s Land must start explored with live fog of war');
    for (const faction of state.factions) {
      if (!isBuildingUnlocked(faction, 'fountain')) throw new Error('Urban Planning must unlock fountains');
      const towers = state.buildings.filter(b => b.kind === 'woodenTower' && b.faction === faction.id && !b.construction)
        .sort((a, b) => a.y - b.y);
      if (towers.length < 2 || towers.slice(1).some((tower, i) =>
        Math.hypot(tower.x - towers[i].x, tower.y - towers[i].y) !== WOODEN_TOWER_RANGE * 2.5))
        throw new Error('Each No Man’s Land tower line needs 15-tile spacing');
    }
    const damage = unitDamage({ kind: 'archer', attack: 12 }, 5);
    if (Math.abs(damage - 2 * unitDamage({ kind: 'warrior', attack: 12 }, 5)) > 1e-8)
      throw new Error('Archer hits must deal double damage after armor');
  });
}
