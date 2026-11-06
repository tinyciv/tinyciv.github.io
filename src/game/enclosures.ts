import { type FogView, pointInSight } from './fog';
import { canTraverseEdge, friendlyGateAccess, traversable } from './pathfinding';
import { RAIDER_FACTION, raiderCampActive } from './raider-camps';
import { buildingReady, buildingWidth, buildingHeight, isWallKind, type Building, type GameState, type World, WATER } from './types';
import { entityStore, type EntityStore } from './entity-store';
import { simulationReadsActive, structureChangeRevision } from './simulation-reads';
import { worldRevisions, worldStructureRevision } from './world-revisions';

export const ENCLOSED_HOUSE_GROWTH_MULTIPLIER = 1.3;
export interface PalaceEnclosure { faction: number; palaces: number[]; cells: number[] }
export interface PalaceEnclosures {
  width: number;
  height: number;
  regions: PalaceEnclosure[];
  /** A house needs a palace of its own faction in the same protected region. */
  byFaction: ReadonlyMap<number, Uint8Array>;
  /** Shared allied regions are drawn only once. */
  cells: number[];
}
interface CachedEnclosures extends PalaceEnclosures {
  world: World; tiles: World['tiles']; signature: string; terrain: EnclosureTerrain;
  regionByFaction: ReadonlyMap<number, Int32Array>;
  occupied?: { signature: string; result: PalaceEnclosures };
}
const caches = new WeakMap<GameState, CachedEnclosures>();
const validations = new WeakMap<GameState, { geometry: CachedEnclosures; store: EntityStore; key: string }>();
interface EnclosureTerrain {
  worldRevision: number; revision: number; ground: Uint8Array; ridges: Float64Array; tiers: Uint8Array; stairs: Uint8Array;
}
const stairCode = { north: 1, east: 2, south: 3, west: 4 };
/** Roads, harvesting and cleared trees change world.revision but not the
 * defensive topology. Retain flood geometry unless ground, ridges or ramps
 * actually change; bridge/wall/palace changes are checked separately. */
function enclosureTerrain(world: World, previous?: CachedEnclosures): EnclosureTerrain {
  const count = world.width * world.height, worldRevision = worldRevisions(world).geometry;
  const old = previous?.world === world && previous.tiles === world.tiles && previous.width === world.width
    && previous.height === world.height ? previous.terrain : undefined;
  if (old?.worldRevision === worldRevision) return old;
  const terrain = old ?? { worldRevision, revision: 0, ground: new Uint8Array(count),
    ridges: new Float64Array(count), tiers: new Uint8Array(count), stairs: new Uint8Array(count) };
  let changed = !old;
  for (let i = 0; i < count; i++) {
    const tile = world.tiles[i];
    const ground = tile.terrain === 'river' ? (tile.overlay === 'ford' ? 3 : 2)
      : WATER.has(tile.terrain) || tile.overlay === 'volcano' || tile.overlay === 'glacier' ? 1 : 0;
    const ridge = tile.ridge ?? 0, tier = ridge ? tile.ridgeTier ?? 1 : 0, stair = tile.stair ? stairCode[tile.stair] : 0;
    if (terrain.ground[i] !== ground || terrain.ridges[i] !== ridge || terrain.tiers[i] !== tier || terrain.stairs[i] !== stair) changed = true;
    terrain.ground[i] = ground; terrain.ridges[i] = ridge; terrain.tiers[i] = tier; terrain.stairs[i] = stair;
  }
  terrain.worldRevision = worldRevision;
  if (changed) terrain.revision++;
  return terrain;
}

/** Wilderness bands have no permanent settlement. Their current reachable
 * component is an enemy origin too; a city with enemies inside is not secure.
 * Keep this cheap occupancy check separate from the cached terrain floods. */
function secureEnclosures(state: GameState, geometry: CachedEnclosures): PalaceEnclosures {
  if (!geometry.regions.length) return geometry;
  const occupied = new Set<number>();
  for (const unit of state.units) {
    if (unit.hp <= 0 || unit.inside || unit.faction < 0 && unit.faction !== RAIDER_FACTION) continue;
    const x = Math.floor(unit.x), y = Math.floor(unit.y);
    if (x < 0 || y < 0 || x >= geometry.width || y >= geometry.height) continue;
    for (const [faction, regions] of geometry.regionByFaction) {
      const region = regions[y * geometry.width + x];
      if (region && !friendlyGateAccess(state, faction, unit.faction)) occupied.add(region);
    }
  }
  if (!occupied.size) return geometry;
  const signature = [...occupied].sort((a, b) => a - b).join(',');
  if (geometry.occupied?.signature === signature) return geometry.occupied.result;
  const regions = geometry.regions.filter((_, index) => !occupied.has(index + 1));
  const byFaction = new Map<number, Uint8Array>(), highlighted = new Set<number>();
  for (const region of regions) {
    let mask = byFaction.get(region.faction);
    if (!mask) { mask = new Uint8Array(geometry.width * geometry.height); byFaction.set(region.faction, mask); }
    for (const cell of region.cells) { mask[cell] = 1; highlighted.add(cell); }
  }
  const result = { width: geometry.width, height: geometry.height, regions, byFaction, cells: [...highlighted] };
  geometry.occupied = { signature, result };
  return result;
}

/** Walls may meet water, but diagonal gaps remain breaches just as they do for movement. */
/** Guards need the physical interior even when an intruder suspends its growth bonus. */
export function palaceEnclosures(state: GameState, includeOccupied = false): PalaceEnclosures {
  const { world } = state, { width, height } = world, total = width * height;
  const previous = caches.get(state), trusted = simulationReadsActive(state), store = entityStore(state);
  const camps = (state.raiderCamps ?? []).filter(camp => raiderCampActive(state, camp));
  const factions = state.factions.map(faction => `${faction.id},${faction.relation},${faction.defeated}`).join(';');
  const campKey = camps.map(camp => `${camp.id},${camp.gate.x},${camp.gate.y}`).join(';');
  const key = `${worldRevisions(world).geometry}|${worldStructureRevision(world)}|${entityStore(state).buildings.revision}|${structureChangeRevision(state)}|${factions}|${campKey}`;
  const validated = validations.get(state);
  if (trusted && previous && previous.world === world && previous.tiles === world.tiles
    && validated?.geometry === previous && validated.store === store && validated.key === key)
    return includeOccupied ? previous : secureEnclosures(state, previous);
  if (!trusted) validations.delete(state);
  const relevant = state.buildings.filter(building => buildingReady(building)
    && (isWallKind(building.kind) || building.kind === 'palace' || building.kind === 'bridge'));
  const terrain = enclosureTerrain(world, previous);
  const signature = `${width},${height},${terrain.revision}|${factions}|${relevant.map(building => `${building.id},${building.kind},${building.faction},${building.x},${building.y}`).join(';')}|${campKey}`;
  if (previous?.world === world && previous.tiles === world.tiles && previous.signature === signature) {
    if (trusted) validations.set(state, { geometry: previous, store, key });
    return includeOccupied ? previous : secureEnclosures(state, previous);
  }
  const walls = relevant.filter(building => isWallKind(building.kind));
  const palaces = relevant.filter(building => building.kind === 'palace' && building.faction >= 0
    && !state.factions.find(faction => faction.id === building.faction)?.defeated);
  const bridges = new Set(relevant.filter(building => building.kind === 'bridge').map(building => building.y * width + building.x));
  const ground = new Uint8Array(total);
  for (let index = 0; index < total; index++) {
    const tile = world.tiles[index];
    ground[index] = Number(traversable(world, index % width, Math.floor(index / width))
      || WATER.has(tile.terrain) && bridges.has(index));
  }
  const regions: PalaceEnclosure[] = [], byFaction = new Map<number, Uint8Array>(), highlighted = new Uint8Array(total);
  const neighbors = (index: number, visit: (next: number) => void): void => {
    const x = index % width, y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height) visit((y + dy) * width + x + dx);
  };
  const movementNeighbors = (index: number, visit: (next: number) => void): void => {
    const from = { x: index % width, y: Math.floor(index / width) };
    neighbors(index, next => {
      if (ground[next] && canTraverseEdge(world, from, { x: next % width, y: Math.floor(next / width) })) visit(next);
    });
  };
  for (const faction of new Set(palaces.map(palace => palace.faction))) {
    const ownWalls = new Uint8Array(total), defenses = new Uint8Array(total);
    for (const wall of walls) if (friendlyGateAccess(state, faction, wall.faction)) {
      const index = wall.y * width + wall.x;
      if (wall.x < 0 || wall.y < 0 || wall.x >= width || wall.y >= height) continue;
      defenses[index] = 1;
      if (wall.faction === faction) ownWalls[index] = 1;
    }
    if (!ownWalls.some(Boolean)) continue;
    const components = new Int32Array(total), protectedCells = new Uint8Array(total), accepted = new Map<number, PalaceEnclosure>();
    const queue = new Int32Array(total);
    let nextComponent = 0;
    for (const palace of palaces.filter(building => building.faction === faction)) {
      const seed = palace.y * width + palace.x;
      if (palace.x < 0 || palace.y < 0 || palace.x >= width || palace.y >= height || !ground[seed] || defenses[seed]) continue;
      if (components[seed]) { accepted.get(components[seed])?.palaces.push(palace.id); continue; }
      const component = ++nextComponent, cells: number[] = [];
      let head = 0, tail = 1, open = false;
      queue[0] = seed; components[seed] = component;
      while (head < tail) {
        const index = queue[head++], x = index % width, y = Math.floor(index / width);
        cells.push(index);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) open = true;
        movementNeighbors(index, next => {
          if (!defenses[next] && !components[next]) {
            components[next] = component; queue[tail++] = next;
          }
        });
      }
      if (open) continue;
      // A finite island can contain the whole wilderness as well as the city.
      // Enemy settlement exits must be outside the protected component. Ignore
      // ordinary buildings and foreign walls so they cannot supply our defense.
      const contains = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height
        && components[y * width + x] === component;
      const rivalSettlement = palaces.some(other => {
        if (friendlyGateAccess(state, faction, other.faction)) return false;
        for (let dy = 0; dy < buildingHeight(other); dy++) for (let dx = 0; dx < buildingWidth(other); dx++)
          if (contains(other.x + dx, other.y + dy)) return true;
        return false;
      });
      if (rivalSettlement || camps.some(camp => contains(camp.gate.x, camp.gate.y))) continue;

      // Removing a real perimeter must expose additional walkable land, not
      // just the removed wall's own footprint. A coastal wall stub otherwise
      // incorrectly protects the entire island. Follow whole wall clusters so
      // two- or three-tile-thick defenses work as well as a single wall row.
      const separatingWalls = new Uint8Array(total);
      const wallSeparates = (seed: number): boolean => {
        if (separatingWalls[seed]) return separatingWalls[seed] === 2;
        const cluster = [seed]; separatingWalls[seed] = 1;
        let separates = false;
        for (let cursor = 0; cursor < cluster.length; cursor++) movementNeighbors(cluster[cursor], next => {
          if (!defenses[next]) {
            if (components[next] !== component) separates = true;
          } else if (!separatingWalls[next]) {
            separatingWalls[next] = 1; cluster.push(next);
          }
        });
        if (separates) for (const cell of cluster) separatingWalls[cell] = 2;
        return separates;
      };
      // Walk the complement from the world edge. An isolated wall standing
      // inside a naturally protected island is an interior obstacle, not its enclosure.
      const outside = new Uint8Array(total); head = 0; tail = 0;
      const addOutside = (index: number): void => {
        if (!outside[index] && components[index] !== component) { outside[index] = 1; queue[tail++] = index; }
      };
      for (let x = 0; x < width; x++) { addOutside(x); addOutside((height - 1) * width + x); }
      for (let y = 1; y < height - 1; y++) { addOutside(y * width); addOutside(y * width + width - 1); }
      let ownedBoundary = false;
      while (head < tail && !ownedBoundary) {
        const index = queue[head++];
        if (ownWalls[index] && ground[index]) {
          let touchesInterior = false;
          movementNeighbors(index, next => { if (components[next] === component) touchesInterior = true; });
          if (touchesInterior && wallSeparates(index)) ownedBoundary = true;
        }
        neighbors(index, addOutside);
      }
      if (!ownedBoundary) continue;
      const region: PalaceEnclosure = { faction, palaces: [palace.id], cells };
      regions.push(region); accepted.set(component, region);
      for (const cell of cells) { protectedCells[cell] = 1; highlighted[cell] = 1; }
    }
    if (accepted.size) byFaction.set(faction, protectedCells);
  }
  const cells: number[] = [];
  for (let index = 0; index < total; index++) if (highlighted[index]) cells.push(index);
  const regionByFaction = new Map<number, Int32Array>();
  regions.forEach((region, index) => {
    let mask = regionByFaction.get(region.faction);
    if (!mask) { mask = new Int32Array(total); regionByFaction.set(region.faction, mask); }
    for (const cell of region.cells) mask[cell] = index + 1;
  });
  const result: CachedEnclosures = { width, height, regions, byFaction, cells, world, tiles: world.tiles, signature, terrain, regionByFaction };
  caches.set(state, result);
  if (trusted) validations.set(state, { geometry: result, store, key });
  return includeOccupied ? result : secureEnclosures(state, result);
}

export function isHouseEnclosed(state: GameState, house: Building, enclosures = palaceEnclosures(state)): boolean {
  if (house.kind !== 'house' || !buildingReady(house)) return false;
  const cells = enclosures.byFaction.get(house.faction);
  if (!cells) return false;
  for (let dy = 0; dy < buildingHeight(house); dy++) for (let dx = 0; dx < buildingWidth(house); dx++) {
    const x = house.x + dx, y = house.y + dy;
    if (x < 0 || y < 0 || x >= enclosures.width || y >= enclosures.height || !cells[y * enclosures.width + x]) return false;
  }
  return true;
}

/** The existing growth pool measures ordinary birth progress. A protected
 * destination needs 1/1.3 progress; outside destinations still need exactly 1. */
export function houseBirthProgress(state: GameState, house: Building): number {
  return isHouseEnclosed(state, house) ? 1 / ENCLOSED_HOUSE_GROWTH_MULTIPLIER : 1;
}

/** Approved Pixel glints preset: Fast (1.5×), 250% intensity. */
export const ENCLOSURE_SHIMMER = { speed: 1.5, intensity: 2.5 } as const;
interface ShimmerSample { u: number; glint: boolean; seed: number }
interface ShimmerCell { index: number; x: number; y: number; min: number; max: number; samples: ShimmerSample[] }
interface ShimmerRegion { min: number; span: number; start: number; cells: ShimmerCell[] }
const shimmerSamples = new WeakMap<PalaceEnclosures, ShimmerRegion[]>();
function shimmerRegions(enclosures: PalaceEnclosures): ShimmerRegion[] {
  let regions = shimmerSamples.get(enclosures);
  if (regions) return regions;
  const painted = new Set<number>();
  regions = enclosures.regions.map(region => {
    let min = Infinity, max = -Infinity;
    const cells = region.cells.filter(index => {
      if (painted.has(index)) return false;
      painted.add(index); return true;
    }).map(index => {
      const x = index % enclosures.width, y = Math.floor(index / enclosures.width), samples: ShimmerSample[] = [];
      // The approved demo uses two-pixel clusters on a32px tile. This grid
      // follows world coordinates, so camera movement never makes it swim.
      for (let sy = 0; sy < 32; sy += 2) for (let sx = 0; sx < 32; sx += 2) {
        const nx = x * 32 + sx, ny = y * 32 + sy, u = (nx - ny) / Math.SQRT2;
        let hash = Math.imul(nx + 91, 374761393) ^ Math.imul(ny + 17, 668265263);
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
        samples.push({ u, glint: hash % 31 === 0, seed: (hash % 997) / 997 });
        min = Math.min(min, u); max = Math.max(max, u);
      }
      return { index, x, y, min: samples[240].u, max: samples[15].u, samples };
    });
    return { min: min - 28, span: max - min + 56, start: 28 + (max - min) * .3, cells };
  }).filter(region => region.cells.length > 0);
  shimmerSamples.set(enclosures, regions); return regions;
}
const gaussian = (distance: number, width: number) => Math.abs(distance) > width * 3 ? 0 : Math.exp(-.5 * (distance / width) ** 2);

/** Draw before foreground scenery. Only protected, observed floor cells receive
 * the SW→NE sweep; roofs, trees, walls and people are painted above its pixels. */
export function forEachEnclosureShimmerSpan(state: GameState, fog: FogView,
  ox: number, oy: number, size: number, time: number, viewport: { width: number; height: number } | undefined,
  draw: (x: number, y: number, width: number, height: number, alpha: number) => void,
  enclosures = palaceEnclosures(state)): void {
  if (!enclosures.cells.length) return;
  const animationTime = time * ENCLOSURE_SHIMMER.speed;
  for (const region of shimmerRegions(enclosures)) {
    const front = region.min + ((animationTime * 42 + region.start) % region.span + region.span) % region.span;
    // Many neighboring samples share the same diagonal. Evaluate each sweep
    // coefficient once, instead of repeating exp() for every two-pixel cluster.
    const coefficients = new Map<number, { wash: number; spark: number }>();
    for (const cell of region.cells) {
      const { x, y, samples } = cell, px = ox + x * size, py = oy + y * size;
      if (viewport && (px < -size || py < -size || px > viewport.width || py > viewport.height)) continue;
      if (!pointInSight(fog, x + .5, y + .5)) continue;
      if (cell.max < front - 102 || cell.min > front + 102) continue;
      for (let row = 0; row < 16; row++) {
        let runStart = 0, previousAlpha = -1;
        for (let column = 0; column <= 16; column++) {
          let alpha = 0;
          if (column < 16) {
            const sample = samples[row * 16 + column];
            let coefficient = coefficients.get(sample.u);
            if (!coefficient) {
              const delta = sample.u - front;
              coefficient = { wash: .045 * gaussian(delta, 34), spark: .38 * gaussian(delta, 20) };
              coefficients.set(sample.u, coefficient);
            }
            const wash = coefficient.wash;
            const spark = sample.glint ? coefficient.spark * (.65 + .35 * Math.sin(animationTime * 3.2 + sample.seed * 6.28) ** 2) : 0;
            alpha = Math.round(Math.min(.78, (wash + spark) * ENCLOSURE_SHIMMER.intensity) * 255);
          }
          // Merge equal neighboring alpha clusters into one draw call.
          if (alpha !== previousAlpha || column === 16) {
            if (previousAlpha > 0) {
              const left = Math.round(px + runStart * size / 16), top = Math.round(py + row * size / 16);
              draw(left, top, Math.round(px + column * size / 16) - left, Math.round(py + (row + 1) * size / 16) - top, previousAlpha / 255);
            }
            runStart = column; previousAlpha = alpha;
          }
        }
      }
    }
  }
}
