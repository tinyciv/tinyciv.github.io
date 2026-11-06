/** Shared static routes for the standalone company prototype. Soldiers sample
 * a destination field; they never run their own A* search. */
export interface Point { x: number; y: number }
export interface NavigationWorld {
  width: number;
  height: number;
  tiles: Uint8Array;
  elevations: Int8Array;
  /** Uphill direction: north/east/south/west = 0/1/2/3; -1 unspecified. */
  stairDir?: Int8Array;
  revision?: number;
}
export interface FlowField { goal: Point; distances: Float64Array }
export interface NavigationStats { searches: number; cacheHits: number; expanded: number; totalMs: number; maxMs: number }
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
const diagonal = Math.SQRT2;
const terrainCost = (tile: number): number => tile === 1 || tile === 6 ? .8 : tile === 8 ? 1.15 : tile === 7 ? 1.05 : 1;

export class Navigation {
  readonly stats: NavigationStats = { searches: 0, cacheHits: 0, expanded: 0, totalMs: 0, maxMs: 0 };
  private readonly cache = new Map<number, FlowField>();
  private readonly snapped = new Map<string, number>();
  private readonly neighbors: Int32Array;
  private readonly costs: Float64Array;
  private readonly components: Int32Array;
  private readonly open: number[] = [];
  private readonly members: number[][] = [];
  private readonly heap: Int32Array;
  private readonly positions: Int32Array;
  private graphDirty = true;
  private revision = -1;
  private heapSize = 0;
  private readonly capacity: number;

  constructor(readonly world: NavigationWorld, capacity = 128) {
    const count = world.width * world.height;
    if (world.width < 1 || world.height < 1 || world.tiles.length !== count || world.elevations.length !== count)
      throw new Error('Navigation requires a complete rectangular world.');
    this.capacity = Math.max(1, Math.floor(capacity));
    this.neighbors = new Int32Array(count * 8);
    this.costs = new Float64Array(count * 8);
    this.components = new Int32Array(count);
    this.heap = new Int32Array(count);
    this.positions = new Int32Array(count);
    this.ensureGraph();
  }

  passable(x: number, y: number): boolean {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return false;
    const tile = this.world.tiles[y * this.world.width + x];
    return tile !== 2 && tile !== 3 && tile !== 4 && tile !== 5;
  }

  private cardinal(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.passable(ax, ay) || !this.passable(bx, by)) return false;
    const a = ay * this.world.width + ax, b = by * this.world.width + bx;
    const elevation = this.world.elevations[b] - this.world.elevations[a];
    if (!elevation) return true;
    if (Math.abs(elevation) !== 1 || this.world.tiles[a] !== 8 && this.world.tiles[b] !== 8) return false;
    const uphillX = (bx - ax) * Math.sign(elevation), uphillY = (by - ay) * Math.sign(elevation);
    const direction = uphillY < 0 ? 0 : uphillX > 0 ? 1 : uphillY > 0 ? 2 : 3;
    // A stair on either side can connect a low approach and a high landing.
    for (const index of [a, b]) if (this.world.tiles[index] === 8) {
      const stair = this.world.stairDir?.[index];
      if (stair === undefined || stair < 0 || stair === direction) return true;
    }
    return false;
  }

  canStep(ax: number, ay: number, bx: number, by: number): boolean {
    ax = Math.floor(ax); ay = Math.floor(ay); bx = Math.floor(bx); by = Math.floor(by);
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
    if (dx > 1 || dy > 1 || !dx && !dy) return false;
    if (!dx || !dy) return this.cardinal(ax, ay, bx, by);
    if (!this.passable(ax, ay) || !this.passable(bx, by)
      || this.world.elevations[ay * this.world.width + ax] !== this.world.elevations[by * this.world.width + bx]) return false;
    // Both sides of a diagonal must be usable, including their elevation edges.
    return this.cardinal(ax, ay, bx, ay) && this.cardinal(ax, ay, ax, by)
      && this.cardinal(bx, ay, bx, by) && this.cardinal(ax, by, bx, by);
  }

  clearCache(): void {
    this.cache.clear(); this.snapped.clear(); this.graphDirty = true;
  }

  resetStats(): void {
    this.stats.searches = this.stats.cacheHits = this.stats.expanded = this.stats.totalMs = this.stats.maxMs = 0;
  }

  private ensureGraph(): void {
    if (!this.graphDirty && this.revision === (this.world.revision ?? 0)) return;
    this.cache.clear(); this.snapped.clear(); this.neighbors.fill(-1); this.components.fill(-1);
    this.open.length = 0; this.members.length = 0;
    const { width, height, tiles } = this.world;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!this.passable(x, y)) continue;
      const index = y * width + x; this.open.push(index);
      for (let side = 0; side < 8; side++) {
        const nx = x + DX[side], ny = y + DY[side];
        if (!this.canStep(x, y, nx, ny)) continue;
        const neighbor = ny * width + nx, edge = index * 8 + side;
        this.neighbors[edge] = neighbor;
        this.costs[edge] = (terrainCost(tiles[index]) + terrainCost(tiles[neighbor])) * .5 * (side < 4 ? 1 : diagonal);
      }
    }
    for (const origin of this.open) {
      if (this.components[origin] !== -1) continue;
      const id = this.members.length, cells = [origin]; this.members.push(cells); this.components[origin] = id;
      for (let cursor = 0; cursor < cells.length; cursor++) {
        const base = cells[cursor] * 8;
        for (let side = 0; side < 8; side++) {
          const next = this.neighbors[base + side];
          if (next < 0 || this.components[next] !== -1) continue;
          this.components[next] = id; cells.push(next);
        }
      }
    }
    this.revision = this.world.revision ?? 0; this.graphDirty = false;
  }

  private clampedCell(point: Point): number {
    const x = Math.max(0, Math.min(this.world.width - 1, Math.floor(Number.isFinite(point.x) ? point.x : 0)));
    const y = Math.max(0, Math.min(this.world.height - 1, Math.floor(Number.isFinite(point.y) ? point.y : 0)));
    return y * this.world.width + x;
  }
  private center(index: number): Point { return { x: index % this.world.width + .5, y: Math.floor(index / this.world.width) + .5 }; }

  private nearestCell(point: Point, component = -1): number {
    const goal = this.clampedCell(point);
    if (this.components[goal] !== -1 && (component < 0 || this.components[goal] === component)) return goal;
    const key = `${goal}:${component}`, previous = this.snapped.get(key);
    if (previous !== undefined) return previous;
    const x = goal % this.world.width, y = Math.floor(goal / this.world.width);
    let nearest = goal, best = Infinity;
    for (const index of component < 0 ? this.open : this.members[component]) {
      const dx = index % this.world.width - x, dy = Math.floor(index / this.world.width) - y, cost = dx * dx + dy * dy;
      if (cost < best || cost === best && index < nearest) { best = cost; nearest = index; }
    }
    this.snapped.set(key, nearest);
    if (this.snapped.size > this.capacity * 4) this.snapped.delete(this.snapped.keys().next().value!);
    return nearest;
  }

  /** Optional origin keeps blocked/disconnected commands on reachable ground. */
  nearestOpen(point: Point, from?: Point): Point {
    this.ensureGraph();
    const component = from ? this.components[this.nearestCell(from)] : -1;
    return this.center(this.nearestCell(point, component));
  }

  field(goal: Point, from?: Point): FlowField {
    this.ensureGraph();
    const component = from ? this.components[this.nearestCell(from)] : -1;
    const target = this.nearestCell(goal, component), previous = this.cache.get(target);
    if (previous) {
      this.stats.cacheHits++; this.cache.delete(target); this.cache.set(target, previous);
      return previous;
    }
    const started = performance.now(), distances = new Float64Array(this.world.width * this.world.height);
    distances.fill(Infinity); this.positions.fill(-1); this.heapSize = 0;
    if (this.components[target] !== -1) { distances[target] = 0; this.push(target, distances); }
    while (this.heapSize) {
      const index = this.pop(distances), base = index * 8;
      this.stats.expanded++;
      for (let side = 0; side < 8; side++) {
        const neighbor = this.neighbors[base + side];
        if (neighbor < 0 || this.positions[neighbor] === -2) continue;
        const cost = distances[index] + this.costs[base + side];
        if (cost >= distances[neighbor]) continue;
        distances[neighbor] = cost; this.push(neighbor, distances);
      }
    }
    const elapsed = performance.now() - started;
    this.stats.searches++; this.stats.totalMs += elapsed; this.stats.maxMs = Math.max(this.stats.maxMs, elapsed);
    const field = { goal: this.center(target), distances };
    this.cache.set(target, field);
    if (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
    return field;
  }

  distance(x: number, y: number, field: FlowField): number {
    x = Math.floor(x); y = Math.floor(y);
    return x < 0 || y < 0 || x >= this.world.width || y >= this.world.height ? Infinity : field.distances[y * this.world.width + x];
  }

  /** Include sideways alternatives for local traffic negotiation; best route
   * first. Occupancy belongs to the company solver, not this static field. */
  choices(x: number, y: number, field: FlowField): Point[] {
    this.ensureGraph(); x = Math.floor(x); y = Math.floor(y);
    if (!this.passable(x, y)) return [];
    const index = y * this.world.width + x, current = field.distances[index];
    if (!Number.isFinite(current) || current === 0) return [];
    const candidates: { index: number; score: number; distance: number }[] = [];
    for (let side = 0; side < 8; side++) {
      const edge = index * 8 + side, next = this.neighbors[edge];
      if (next < 0 || !Number.isFinite(field.distances[next])) continue;
      candidates.push({ index: next, score: field.distances[next] + this.costs[edge], distance: field.distances[next] });
    }
    candidates.sort((a, b) => a.score - b.score || a.distance - b.distance || a.index - b.index);
    return candidates.map(candidate => this.center(candidate.index));
  }

  private push(index: number, distances: Float64Array): void {
    let position = this.positions[index];
    if (position < 0) position = this.heapSize++;
    while (position > 0) {
      const parent = (position - 1) >>> 1, other = this.heap[parent];
      if (distances[other] <= distances[index]) break;
      this.heap[position] = other; this.positions[other] = position; position = parent;
    }
    this.heap[position] = index; this.positions[index] = position;
  }
  private pop(distances: Float64Array): number {
    const result = this.heap[0], last = this.heap[--this.heapSize];
    this.positions[result] = -2;
    if (!this.heapSize) return result;
    let position = 0;
    while (position * 2 + 1 < this.heapSize) {
      let child = position * 2 + 1;
      if (child + 1 < this.heapSize && distances[this.heap[child + 1]] < distances[this.heap[child]]) child++;
      if (distances[last] <= distances[this.heap[child]]) break;
      this.heap[position] = this.heap[child]; this.positions[this.heap[position]] = position; position = child;
    }
    this.heap[position] = last; this.positions[last] = position;
    return result;
  }
}
