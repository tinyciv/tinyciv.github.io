import TinyQueue from 'tinyqueue';
import { entityStore, type EntityStore } from './entity-store';
import { isFreshwaterSource } from './irrigation';
import { placementOccupancy } from './placement-occupancy';
import { playerFaction } from './player-context';
import { buildAt, getLeader, withConstructionBatch } from './simulation';
import { structureChangeRevision, withSimulationReads } from './simulation-reads';
import { isFord, isWallKind, tileAt, type Building, type GameState, type Point } from './types';
import { withDeferredMaintenance } from './work-cadence';

export type LinearPurchaseKind = 'road' | 'irrigation';
export interface RoadPurchaseResult {
  done: boolean;
  ok: boolean;
  placed: number;
  skipped: number;
  message: string;
}
export interface RoadPurchase {
  /** Attempts at most one new cell. Existing infrastructure/water is free. */
  step(currentState?: GameState): RoadPurchaseResult;
  /** Stop an unfinished gesture; accepted cells and their queued cleanup remain. */
  finish(): RoadPurchaseResult;
  readonly result: RoadPurchaseResult;
  readonly kind: LinearPurchaseKind;
  /** Number of unique finite input cells, including free/existing cells. */
  readonly total: number;
  /** Immutable snapshot of cells still awaiting processing, in gesture order. */
  readonly remaining: readonly Point[];
}
export type LinearPurchase = RoadPurchase;
export type LinearPurchaseResult = RoadPurchaseResult;
const cardinal = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const pointKey = (point: Point): string => `${point.x},${point.y}`;

interface TopologyStamp {
  store: EntityStore; buildings: GameState['buildings']; membership: number; structures: number; terrain: number | undefined;
}
function topologyStamp(state: GameState): TopologyStamp {
  const store = entityStore(state);
  return { store, buildings: state.buildings, membership: store.buildings.revision,
    structures: structureChangeRevision(state), terrain: state.world.revision };
}
function sameTopology(a: TopologyStamp | undefined, b: TopologyStamp): boolean {
  return !!a && a.store === b.store && a.buildings === b.buildings && a.membership === b.membership
    && a.structures === b.structures && a.terrain === b.terrain;
}

/** A retained local connectivity view. New cells purchased by this job extend
 * its overlay; tracked external edits rebuild the view. As with other trusted
 * runtime reads, position/kind edits must publish their topology revision.
 * Placement still uses buildAt's live validation, never this eligibility index. */
function connectionView(state: GameState, kind: LinearPurchaseKind, faction: number) {
  const occupancy = placementOccupancy(state), additions = new Map<string, Building[]>();
  const someAt = (point: Point, test: (building: Building) => boolean): boolean => {
    const matches = (building: Building) => building.hp > 0 && building.x === point.x && building.y === point.y && test(building);
    return occupancy.at(point.x, point.y).some(matches) || !!additions.get(pointKey(point))?.some(matches);
  };
  const gate = (point: Point) => someAt(point, building => isWallKind(building.kind) && (building.faction === faction || building.faction === -1));
  return {
    add(building: Building) {
      const key = pointKey(building), members = additions.get(key);
      if (members) members.push(building); else additions.set(key, [building]);
    },
    existing(point: Point) {
      return someAt(point, building => building.kind === kind && building.faction === faction)
        || (kind === 'irrigation' ? isFreshwaterSource(state, point.x, point.y) : isFord(tileAt(state.world, point.x, point.y)) && !gate(point));
    },
    connected(point: Point) {
      return kind === 'road' && gate(point) || cardinal.some(([dx, dy]) => {
        const next = { x: point.x + dx, y: point.y + dy };
        return kind === 'road' ? isFord(tileAt(state.world, next.x, next.y))
          || someAt(next, building => building.kind === 'road' || building.kind === 'bridge')
          : isFreshwaterSource(state, next.x, next.y) || someAt(next, building => building.kind === 'irrigation');
      });
    },
  };
}

/** UI linear orders validate and pay for at most one new cell per turn. Roads
 * reserve the full stroke against crop relocation; irrigation shares farm and
 * road layers without moving crops. The frontend drains construction cleanup
 * separately, including while paused. Public/server buildStroke stays immediate. */
export function createLinearPurchase(state: GameState, kind: LinearPurchaseKind, points: readonly Point[]): LinearPurchase {
  const faction = playerFaction(state), leaderId = getLeader(state, faction)?.id;
  const world = state.world, tiles = world.tiles, width = world.width, height = world.height;
  const unique = new Map<string, Point>();
  for (const point of points) if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
    const x = Math.floor(point.x), y = Math.floor(point.y);
    unique.set(`${x},${y}`, Object.freeze({ x, y }));
  }
  const ordered = [...unique.values()], total = ordered.length;
  const pending = new Map(ordered.map((point, index) => [index, point]));
  const indices = new Map(ordered.map((point, index) => [pointKey(point), index]));
  const reserved = kind === 'road' ? new Set(ordered.map(point => point.y * width + point.x)) : undefined;
  let placed = 0, skipped = 0, message = '', done = total === 0, remaining: readonly Point[] | undefined;
  let stamp: TopologyStamp | undefined, view: ReturnType<typeof connectionView> | undefined;
  let frontier = new TinyQueue<number>([], (a, b) => a - b);
  const queued = new Set<number>();
  const result = (): RoadPurchaseResult => ({ done, ok: placed > 0 || skipped === 0, placed, skipped, message });
  const remove = (index: number) => { pending.delete(index); remaining = undefined; };
  const finish = (reason = `${kind === 'road' ? 'Road' : 'Irrigation'} order cancelled.`): RoadPurchaseResult => {
    if (!done) { skipped += pending.size; pending.clear(); remaining = undefined; message ||= reason; done = true; }
    frontier = new TinyQueue<number>(); queued.clear(); view = undefined; stamp = undefined;
    return result();
  };
  const canExtend = (index: number, point: Point) => kind === 'road' && index === 0 || view!.connected(point);
  const enqueue = (index: number) => {
    if (!queued.has(index) && pending.has(index) && canExtend(index, pending.get(index)!)) {
      frontier.push(index); queued.add(index);
    }
  };
  const refreshFrontier = () => {
    frontier = new TinyQueue<number>([], (a, b) => a - b); queued.clear();
    for (const [index, point] of pending) {
      if (view!.existing(point)) remove(index); else enqueue(index);
    }
  };

  return {
    kind, total,
    get remaining() { return remaining ??= Object.freeze([...pending.values()]); },
    get result() { return result(); },
    finish: () => finish(),
    step(currentState = state) {
      if (done) return result();
      const leader = getLeader(state, faction), owner = state.factions.find(candidate => candidate.id === faction);
      if (currentState !== state || state.world !== world || world.tiles !== tiles || world.width !== width || world.height !== height
        || playerFaction(state) !== faction || state.gameOver || !owner || owner.defeated
        || !leader || leader.id !== leaderId || leader.hp <= 0)
        return finish('This realm can no longer build.');
      return withSimulationReads(state, () => withDeferredMaintenance(state, () => withConstructionBatch(state, () => {
        const current = topologyStamp(state);
        if (!sameTopology(stamp, current)) {
          view = connectionView(state, kind, faction); stamp = current; refreshFrontier();
        } else if (!frontier.length) {
          // Recheck negative eligibility before rejecting a disconnected cell;
          // live health and freshwater edits may have restored an anchor.
          refreshFrontier();
        }
        let next: number | undefined;
        while (frontier.length) {
          const index = frontier.pop()!; queued.delete(index);
          const point = pending.get(index); if (!point) continue;
          if (view!.existing(point)) { remove(index); continue; }
          if (canExtend(index, point)) { next = index; break; }
        }
        if (next === undefined) {
          const first = pending.keys().next().value;
          if (first !== undefined) {
            remove(first); skipped++;
            message ||= kind === 'road' ? 'This part of the road is disconnected.' : 'Start irrigation beside freshwater or extend an existing ditch.';
          }
        } else {
          const point = pending.get(next)!; remove(next);
          const purchase = buildAt(state, kind, point.x, point.y, faction, reserved);
          if (purchase.ok) {
            placed++;
            // buildAt appends this accepted order synchronously. Keep the view
            // and frontier through our own mutation instead of rescanning every
            // building and every pending cell on the next turn.
            view!.add(state.buildings.at(-1)!);
            stamp = topologyStamp(state);
            for (const [dx, dy] of cardinal) {
              const index = indices.get(`${point.x + dx},${point.y + dy}`);
              if (index !== undefined) enqueue(index);
            }
          } else { skipped++; message ||= purchase.message; }
        }
        done = pending.size === 0;
        return result();
      }, true)));
    },
  };
}

export function createRoadPurchase(state: GameState, points: readonly Point[]): RoadPurchase {
  return createLinearPurchase(state, 'road', points);
}
