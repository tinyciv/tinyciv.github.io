import { defendRaiderCamp, updateRaiderReturn } from '../src/game/raider-activity';
import { updateFogRaids } from '../src/game/fog-raids';
import { describe, expect, it } from 'vitest';
import { constructionEdges } from '../src/game/builders';
import { entityStore } from '../src/game/entity-store';
import { updateFog } from '../src/game/fog';
import { canMove, canWalk, findPath, withNavigationFrame } from '../src/game/pathfinding';
import { initializeRaiderCamps, raiderCampActive, raiderCampCenter, updateRaiderCamps,
  RAIDER_CAMP_REBUILD_SECONDS, RAIDER_CAMP_RETRY_SECONDS, RAIDER_FACTION, raiderCampSupply, raiderCampPopulationCap, raiderCampPartySize } from '../src/game/raider-camps';
import { ridgeFootprintAllowed } from '../src/game/ridges';
import { updateWallOwnership, NEUTRAL_WALL_FACTION } from '../src/game/wall-ownership';
import { markWorldChanged, worldRevisions } from '../src/game/world-revisions';
import { buildingHeight, buildingSize, distance, type Building, type GameState, type Point, type Unit, type World, WATER } from '../src/game/types';

function structure(id: number, kind: Building['kind'], x: number, y: number): Building {
  return { id, kind, x, y, faction: 0, hp: 100, maxHp: 100, capacity: 0 };
}
function soldier(id: number, x: number, y: number): Unit {
  return { id, x, y, kind: 'leader', faction: 0, hp: 100, morale: 100, attack: 17, defense: 4,
    speed: 3.6, range: 1.1, order: 'follow', cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0 };
}
function fixture(): GameState {
  const width = 112, height = 96;
  const world: World = { width, height, seed: 'warcamp-integration', source: 'test', spawns: [],
    tiles: Array.from({ length: width * height }, (_, cell) => ({ terrain: 'grassland', overlay: 'none', elevation: .2,
      moisture: .5, food: 1, production: 0, gold: 0, variation: (cell * 29 % 997) / 997 })) };
  return { world, units: [soldier(1, 49.5, 40.5)], buildings: [structure(100, 'palace', 46, 39)],
    factions: [], time: 0, tick: 0, paused: false, speed: 1, events: [], particles: [], selected: null, selectedType: null,
    buildMode: null, diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 731, marauderPacks: [] };
}
const cellKey = (world: World, p: Point) => Math.floor(p.y) * world.width + Math.floor(p.x);
const steps = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [-1,1], [0,1], [1,1]];
const sizeExpectations = {
  small: { tiers: 2, tents: [3, 5], towers: [5, 5] },
  medium: { tiers: 3, tents: [6, 9], towers: [6, 6] },
  large: { tiers: 4, tents: [10, 18], towers: [7, 7] },
} as const;

/** Probe instantiated structures with the same edges and gate ownership used
 * by moving units, rather than trusting the planner's own validation result. */
function gateDepths(state: GameState, gates: Set<number>, faction: number): Float64Array {
  return withNavigationFrame(state, () => {
    const { width, height } = state.world, depth = new Float64Array(width * height).fill(Infinity), queue: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      if (canWalk(state, x + .5, y + .5, faction)) { depth[y * width + x] = 0; queue.push(y * width + x); }
    }
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head], x = k % width, y = Math.floor(k / width);
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !canMove(state, { x: x + .5, y: y + .5 }, { x: nx + .5, y: ny + .5 }, faction)) continue;
        const value = depth[k] + Number(gates.has(next));
        if (value < depth[next]) { depth[next] = value; queue.push(next); }
      }
    }
    return depth;
  });
}

describe('terrain-fitted warcamps in the live game', () => {
  it('balances three genuinely different camp sizes with the correct real defensive depth', () => {
    const state = fixture(); initializeRaiderCamps(state);
    expect(state.raiderCamps).toHaveLength(3);
    expect(state.raiderCamps!.map(camp => camp.size).sort()).toEqual(['large', 'medium', 'small']);
    const { width } = state.world;
    for (const camp of state.raiderCamps!) {
      const profile = sizeExpectations[camp.size!];
      const buildings = state.buildings.filter(b => b.raiderCamp === camp.id);
      const walls = buildings.filter(b => (b.kind === 'palisade' || b.kind === 'wall')), roads = new Set(buildings.filter(b => b.kind === 'road').map(b => cellKey(state.world, b)));
      expect(buildings.filter(b => b.kind === 'road').every(road => road.roadStyle === 'trail')).toBe(true);
      const wallCells = new Set(walls.map(b => cellKey(state.world, b))), gates = new Set([...wallCells].filter(k => roads.has(k)));
      const tents = buildings.filter(b => b.kind === 'villageTent'), towers = buildings.filter(b => b.kind === 'woodenTower');
      expect(new Set(buildings.map(b => b.kind))).toEqual(new Set(['wall', 'palisade', 'road', 'villageTent', 'woodenTower']));
      expect(gates.size).toBe(profile.tiers);
      expect(towers.length).toBeGreaterThanOrEqual(profile.towers[0]); expect(towers.length).toBeLessThanOrEqual(profile.towers[1]);
      expect(tents.length).toBeGreaterThanOrEqual(profile.tents[0]); expect(tents.length).toBeLessThanOrEqual(profile.tents[1]);
      expect(camp.houses.slice().sort((a,b) => a-b)).toEqual(tents.map(t => t.id).sort((a,b) => a-b));
      expect(towers.every(t => !wallCells.has(cellKey(state.world, t)) && !gates.has(cellKey(state.world, t)))).toBe(true);
      expect(camp.coreTowers).toHaveLength(4);
      expect(towers.filter(t=>camp.coreTowers!.includes(t.id)).every(t=>Math.abs(t.x+.5-camp.refuge!.x)===1&&Math.abs(t.y+.5-camp.refuge!.y)===1)).toBe(true);
      for (const k of wallCells) expect([1, width, width + 1].every(offset => wallCells.has(k + offset))).toBe(false);
      for (const k of gates) {
        expect(canWalk(state, k % width + .5, Math.floor(k / width) + .5, RAIDER_FACTION)).toBe(true);
        expect(canWalk(state, k % width + .5, Math.floor(k / width) + .5, 0)).toBe(false);
      }
      const friendly = gateDepths(state, gates, RAIDER_FACTION), hostile = gateDepths(state, gates, 0);
      const doorDepths = tents.map(t => friendly[(t.y + 1) * width + t.x]);
      expect(doorDepths.every(Number.isFinite)).toBe(true);
      expect(new Set(doorDepths)).toEqual(new Set([0]));
      expect(friendly[cellKey(state.world,camp.refuge!)]).toBe(1);
      expect(hostile[cellKey(state.world,camp.refuge!)]).toBe(Infinity);
      expect(tents.every(t => Number.isFinite(hostile[(t.y + 1) * width + t.x]))).toBe(true);
      const start = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
      expect(constructionEdges(state, state.buildings[0]).some(exit => findPath(state, start, exit, RAIDER_FACTION).length > 0)).toBe(true);
    }
    expect(state.raiderCamps!.map(c=>c.coreTowers!.length)).toEqual([4,4,4]);
  });

  it('refreshes existing camp roads without changing ordinary roads or gate ownership', () => {
    const state = fixture(); state.world.revision = 0;
    const campRoad = { ...structure(201, 'road', 20, 20), faction: RAIDER_FACTION, raiderCamp: 1 };
    const playerRoad = structure(202, 'road', 21, 20);
    const unrelatedRaiderRoad = { ...structure(203, 'road', 22, 20), faction: RAIDER_FACTION };
    const capturedRoad = { ...structure(204, 'road', 23, 20), raiderCamp: 1 };
    entityStore(state).buildings.add({ ...structure(200, 'villageTent', 20, 18), faction: RAIDER_FACTION, raiderCamp: 1 },
      { ...structure(205, 'palisade', 20, 20), faction: RAIDER_FACTION, raiderCamp: 1 },
      campRoad, playerRoad, unrelatedRaiderRoad, capturedRoad);
    state.raiderCamps = [{ id: 1, size: 'small', x: 18, y: 17, width: 7, height: 7, gate: { x: 20, y: 20 },
      houses: [200], name: 'Existing camp', waves: 0, nextRaidAt: 1e9 }];
    const revisions = worldRevisions(state.world), before = state.buildings.map(building => ({ ...building }));
    initializeRaiderCamps(state);
    expect(campRoad.roadStyle).toBe('trail');
    expect([playerRoad, unrelatedRaiderRoad, capturedRoad].every(road => road.roadStyle === undefined)).toBe(true);
    expect(state.buildings).toEqual(before.map(building => building.id === campRoad.id ? { ...building, roadStyle: 'trail' } : building));
    expect(worldRevisions(state.world)).toEqual({ ...revisions, appearance: revisions.appearance + 1 });
    expect(canWalk(state, 20.5, 20.5, RAIDER_FACTION)).toBe(true);
    expect(canWalk(state, 20.5, 20.5, 0)).toBe(false);
    const revision = state.world.revision;
    for (let step = 0; step < 20; step++) updateRaiderCamps(state);
    expect(state.world.revision).toBe(revision);
    const additional = { ...structure(206, 'road', 24, 20), faction: RAIDER_FACTION, raiderCamp: 1 };
    entityStore(state).buildings.add(additional); updateRaiderCamps(state);
    expect(additional.roadStyle).toBe('trail');
    expect(state.world.revision).toBe(revision! + 1);
  });

  it('preserves the existing river, trees, yields, and ridge terrain while fitting actual structures', () => {
    const state = fixture(), { width, height } = state.world;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const tile = state.world.tiles[y * width + x];
      if (x >= 73 + Math.round(2 * Math.sin(y / 6)) && x <= 79) { tile.terrain = 'river'; tile.elevation = .04; }
      if (x < 2 && y % 3 !== 0) tile.overlay = 'forest';
      if (x > 80 && y < 25) { tile.ridge = 1; tile.ridgeTier = 1; tile.relief = 'hills'; tile.elevation = .7; }
    }
    const before = JSON.stringify(state.world.tiles);
    initializeRaiderCamps(state);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    expect(JSON.stringify(state.world.tiles)).toBe(before);
    for (const b of state.buildings.filter(b => b.raiderCamp !== undefined)) {
      const tile = state.world.tiles[cellKey(state.world, b)];
      expect(WATER.has(tile.terrain)).toBe(false);
      expect(['forest', 'jungle']).not.toContain(tile.overlay);
      expect(ridgeFootprintAllowed(state.world, b.x, b.y)).toBe(true);
    }
  });

  it('keeps every outpost owned until the final core tower falls, then opens the abandoned gates', () => {
    const state = fixture(); initializeRaiderCamps(state);
    const camp = state.raiderCamps!.find(camp => camp.size === 'large')!;
    // Other same-faction settlements must not supply this camp's property claim.
    entityStore(state).buildings.retain(b => b.raiderCamp === undefined || b.raiderCamp === camp.id);
    state.raiderCamps = [camp];
    const walls = state.buildings.filter(b => b.raiderCamp === camp.id && (b.kind === 'palisade' || b.kind === 'wall'));
    updateWallOwnership(state);
    expect(walls.every(b => b.faction === RAIDER_FACTION)).toBe(true);
    for (const id of camp.coreTowers!.slice(1)) state.buildings.find(b => b.id === id)!.hp = 0;
    updateWallOwnership(state);
    expect(walls.every(b => b.faction === RAIDER_FACTION)).toBe(true);
    state.buildings.find(b => b.id === camp.coreTowers![0])!.hp = 0;
    updateWallOwnership(state);
    expect(walls.every(b => b.faction === NEUTRAL_WALL_FACTION)).toBe(true);
    expect(state.buildings.some(b => b.raiderCamp === camp.id && b.kind === 'woodenTower' && b.hp > 0)).toBe(true);
    for (const gate of camp.gates!) expect(canWalk(state, gate.x + .5, gate.y + .5, 0)).toBe(true);
  });

  it('keeps a connected raised plateau usable across the bounded planner window', () => {
    const state = fixture();
    for (const tile of state.world.tiles) { tile.ridge = 1; tile.ridgeTier = 1; tile.relief = 'hills'; tile.elevation = .7; }
    initializeRaiderCamps(state);
    expect(state.raiderCamps).toHaveLength(3);
    for (const camp of state.raiderCamps!) {
      const start = { x: camp.gate.x + .5, y: camp.gate.y + .5 };
      expect(constructionEdges(state, state.buildings[0]).some(exit => findPath(state, start, exit, RAIDER_FACTION).length > 0)).toBe(true);
      expect(state.buildings.filter(b => b.raiderCamp === camp.id).every(b => ridgeFootprintAllowed(state.world, b.x, b.y))).toBe(true);
    }
  });

  it('clears woodland only under committed camp plots, leaving natural ground and surrounding trees intact', () => {
    const state = fixture();
    for (const tile of state.world.tiles) { tile.overlay = 'forest'; tile.food = 2; tile.production = 3; }
    const before = structuredClone(state.world.tiles);
    initializeRaiderCamps(state);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    const plotted = new Set(state.buildings.filter(b => b.raiderCamp !== undefined).map(b => cellKey(state.world, b)));
    for (const camp of state.raiderCamps!) for (const sign of camp.signs ?? []) plotted.add(cellKey(state.world, sign));
    let cleared = 0, retained = 0;
    for (const [cell, tile] of state.world.tiles.entries()) {
      if (tile.overlay === 'forest') { retained++; expect(tile).toEqual(before[cell]); continue; }
      cleared++; expect(plotted.has(cell)).toBe(true); expect(tile.overlay).toBe('none');
      const { overlay: _oldOverlay, food: _oldFood, production: _oldProduction, gold: _oldGold, ...oldGround } = before[cell];
      const { overlay: _newOverlay, food: _newFood, production: _newProduction, gold: _newGold, ...newGround } = tile;
      expect(newGround).toEqual(oldGround);
    }
    expect(cleared).toBeGreaterThan(0); expect(retained).toBeGreaterThan(cleared);
  });

  it('moves away from occupied preferred sites and preserves construction, farm fields, and live units', () => {
    const baseline = fixture(); initializeRaiderCamps(baseline);
    const state = fixture(), [one, two] = baseline.raiderCamps!, first = raiderCampCenter(one), second = raiderCampCenter(two);
    const pending = structure(200, 'house', Math.floor(first.x), Math.floor(first.y));
    pending.construction = { startedAt: 0, duration: 20, waitingForBuilder: true };
    const farm = structure(201, 'camp', Math.floor(first.x) + 4, Math.floor(first.y));
    entityStore(state).buildings.add(pending, farm);
    state.fields = [{ id: 300, camp: farm.id, faction: 0, x: farm.x + 1, y: farm.y + 1, planted: true, food: 5, nextHarvest: 100 }];
    const scout = soldier(2, second.x, second.y); entityStore(state).units.add(scout);
    const saved = JSON.stringify({ pending, farm, field: state.fields[0], scout });
    initializeRaiderCamps(state);
    expect(state.raiderCamps!.length).toBeGreaterThan(0);
    expect(JSON.stringify({ pending, farm, field: state.fields[0], scout })).toBe(saved);
    const reserved = new Set<number>();
    for (const b of [pending, farm]) {
      const margin = b === farm ? 2 : 1;
      for (let y = b.y - margin; y < b.y + buildingHeight(b) + margin; y++)
        for (let x = b.x - margin; x < b.x + buildingSize(b) + margin; x++) reserved.add(y * state.world.width + x);
    }
    reserved.add(cellKey(state.world, state.fields[0])); reserved.add(cellKey(state.world, scout));
    expect(state.buildings.filter(b => b.raiderCamp !== undefined).every(b => !reserved.has(cellKey(state.world, b)))).toBe(true);
    expect(state.raiderCamps!.every(camp => distance(raiderCampCenter(camp), scout) >= 12)).toBe(true);
    for (const camp of state.raiderCamps!) {
      for (const b of [pending, farm]) expect(camp.x < b.x + buildingSize(b) && camp.x + camp.width > b.x
        && camp.y < b.y + buildingHeight(b) && camp.y + camp.height > b.y).toBe(false);
      const field = state.fields[0];
      expect(field.x >= camp.x && field.x < camp.x + camp.width && field.y >= camp.y && field.y < camp.y + camp.height).toBe(false);
    }
  });

  it('rejects disconnected land unchanged, then fills the balanced initial population only when safe land returns', () => {
    const state = fixture(), { width, height } = state.world;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
      if (Math.max(Math.abs(x - 48), Math.abs(y - 40)) === 9) state.world.tiles[y * width + x].terrain = 'river';
    const before = JSON.stringify(state.world.tiles), original = structuredClone(state.buildings);
    initializeRaiderCamps(state);
    expect(state.raiderCamps).toEqual([]); expect(state.buildings).toEqual(original);
    expect(JSON.stringify(state.world.tiles)).toBe(before);
    expect(state.raiderCampPopulationRetryAt).toBe(RAIDER_CAMP_RETRY_SECONDS);
    for (const tile of state.world.tiles) if (tile.terrain === 'river') tile.terrain = 'grassland';
    markWorldChanged(state.world, 'geometry');
    state.time = RAIDER_CAMP_RETRY_SECONDS - .1; updateRaiderCamps(state);
    expect(state.raiderCamps).toEqual([]);
    state.time = RAIDER_CAMP_RETRY_SECONDS; updateRaiderCamps(state);
    expect(state.raiderCamps!.map(camp => camp.size).sort()).toEqual(['large', 'medium', 'small']);
    expect(state.raiderCampPopulationRetryAt).toBeUndefined();
  });

  it.each(['small', 'medium', 'large'] as const)('restores a destroyed %s camp without duplicating the surviving classes or revealing a new site', size => {
    const state = fixture(); initializeRaiderCamps(state);
    const original = state.raiderCamps!.map(camp => camp.id), terrain = JSON.stringify(state.world.tiles);
    const victim = state.raiderCamps!.find(camp => camp.size === size)!;
    for (const id of victim.coreTowers!) state.buildings.find(b => b.id === id)!.hp = 0;
    updateRaiderCamps(state); state.time = RAIDER_CAMP_REBUILD_SECONDS;
    const fog = updateFog(state); fog.visible.fill(1);
    updateRaiderCamps(state);
    expect(victim.destroyed).toBe(true); expect(victim.replacementAt).toBe(state.time + RAIDER_CAMP_RETRY_SECONDS);
    expect(state.raiderCamps!.filter(camp => camp.id !== victim.id).every(camp => raiderCampActive(state, camp))).toBe(true);
    fog.visible.fill(0); state.time += RAIDER_CAMP_RETRY_SECONDS; updateRaiderCamps(state);
    expect(state.raiderCamps).toHaveLength(original.length);
    expect(state.raiderCamps!.map(camp => camp.size).sort()).toEqual(['large', 'medium', 'small']);
    expect(state.raiderCamps!.every(camp => raiderCampActive(state, camp))).toBe(true);
    const replacements = state.raiderCamps!.filter(camp => !original.includes(camp.id));
    expect(replacements).toHaveLength(1); expect(replacements[0].size).toBe(size);
    expect(state.raiderCamps!.some(camp => camp.id === victim.id)).toBe(false);
    expect(original.filter(id => id !== victim.id).every(id => state.raiderCamps!.some(camp => camp.id === id))).toBe(true);
    for (const b of state.buildings.filter(b => b.raiderCamp !== undefined && !original.includes(b.raiderCamp)))
      expect(fog.visible[cellKey(state.world, b)]).toBe(0);
    expect(JSON.stringify(state.world.tiles)).toBe(terrain);
  });

  it('does not postpone an initial-population retry when an earlier destroyed camp is replaced', () => {
    const state = fixture(); initializeRaiderCamps(state);
    const victim = state.raiderCamps![0];
    state.raiderCamps = [victim];
    entityStore(state).buildings.retain(b => b.raiderCamp === undefined || b.raiderCamp === victim.id);
    for (const id of victim.coreTowers!) state.buildings.find(b => b.id === id)!.hp = 0;
    victim.destroyed = true; victim.replacementAt = 40;
    state.raiderCampPopulationRetryAt = 60; state.time = 40;
    updateRaiderCamps(state);
    expect(state.raiderCamps).toHaveLength(1);
    expect(state.raiderCamps![0].id).not.toBe(victim.id);
    expect(raiderCampActive(state, state.raiderCamps![0])).toBe(true);
    expect(state.raiderCampPopulationRetryAt).toBe(60);
  });
});

describe('marauder refuge and tent-dependent recruitment', () => {
  it('losing tents proportionally reduces raids and capacity, while the core survives', () => {
    const state=fixture(); initializeRaiderCamps(state); const camp=state.raiderCamps![0];
    expect(raiderCampSupply(state,camp)).toBe(1); expect(raiderCampPopulationCap(state,camp)).toBe(90);
    const half=Math.floor(camp.houses.length/2);
    for(const id of camp.houses.slice(0,half))state.buildings.find(b=>b.id===id)!.hp=0;
    expect(raiderCampSupply(state,camp)).toBeCloseTo((camp.houses.length-half)/camp.houses.length);
    expect(raiderCampPartySize(state,camp,30)).toBeLessThan(30);
    for(const id of camp.houses)state.buildings.find(b=>b.id===id)!.hp=0;
    expect(raiderCampActive(state,camp)).toBe(true);expect(raiderCampPopulationCap(state,camp)).toBe(5);
    expect(raiderCampPartySize(state,camp,60)).toBe(1);
    camp.nextRaidAt=state.time=1000;
    for(const other of state.raiderCamps!)if(other!==camp)other.nextRaidAt=Infinity;
    updateFogRaids(state);
    const packs=new Set(state.marauderPacks!.filter(p=>p.raiderCamp===camp.id).map(p=>p.id));
    expect(state.units.filter(u=>packs.has(u.marauderPack??-1))).toHaveLength(1);
  });
  it('kills recruitment immediately when all four core towers fall, even with every tent standing', () => {
    const state=fixture(); initializeRaiderCamps(state); const camp=state.raiderCamps![0];
    for(const id of camp.coreTowers!.slice(1))state.buildings.find(b=>b.id===id)!.hp=0;
    expect(raiderCampActive(state,camp)).toBe(true);
    state.buildings.find(b=>b.id===camp.coreTowers![0])!.hp=0;
    expect(raiderCampActive(state,camp)).toBe(false);expect(raiderCampPopulationCap(state,camp)).toBe(0);
    const tent=state.buildings.find(b=>b.id===camp.houses[0])!;
    expect(defendRaiderCamp(state,tent,{faction:0,x:tent.x+1,y:tent.y})).toBe(0);
    updateRaiderCamps(state);expect(camp.destroyed).toBe(true);
    expect(camp.houses.every(id=>state.buildings.find(b=>b.id===id)!.hp>0)).toBe(true);
  });
  it('takes retreating commanders through the stone gate before sheltering in an inner tower', () => {
    const state=fixture(); initializeRaiderCamps(state);const camp=state.raiderCamps![0];
    const commander:Unit={...soldier(9000,camp.gate.x+.5,camp.gate.y+.5),faction:-2,kind:'warrior' as const,marauderLeader:true,marauderPack:1};
    entityStore(state).units.add(commander);
    const pack={id:1,name:'Retreat',color:'#111',targetFaction:0,raiderCamp:camp.id,home:camp.refuge!,waypoint:camp.refuge!,nextWanderAt:0,returning:true};
    state.marauderPacks=[pack];let next:Point|undefined;
    expect(updateRaiderReturn(state,commander,pack,p=>{next=p})).toBe(true);expect(next).toEqual(camp.refuge);
    expect(findPath(state,commander,camp.refuge!,-2).length).toBeGreaterThan(0);
    Object.assign(commander,camp.refuge);updateRaiderReturn(state,commander,pack,()=>{});
    expect(commander.inside).toBe(true);expect(camp.coreTowers).toContain(commander.raiderGarrison);
  });
});
