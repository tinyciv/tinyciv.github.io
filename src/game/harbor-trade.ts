import { rustEngine } from './rust-engine';
import { simCore, SimSlot } from './sim-handle';
import { harborWaterEdges } from './harbor-water-geometry';
import { dockMoorings } from './dock';
import { entityStore } from './entity-store';
import { structuresOf, STRUCTURE_READY } from './structure-index';
import { hostileView, settlementTrade, villageTrading } from './settlement-bridge';
import { grantIncome } from './resource-income';
import { buildingReady, type GameState, type Point } from './types';

/** Render-only view. Rust's HarborTrade resource owns voyages and saves. */
export interface HarborTradeShip extends Point {
  village: number; faction: number; source: number; target: number;
  facing: number; moving: boolean; returning: boolean;
}
const geometry = new SimSlot<Uint8Array>();

function publish(state: GameState, mode: number, values: ArrayLike<number>): void {
  const handle = simCore(state).handle, pointer = rustEngine.sim_harbor_input(handle, values.length);
  new Float64Array(rustEngine.memory.buffer, pointer, values.length).set(values);
  rustEngine.sim_harbor_commit(handle, mode, values.length, state.world.width, state.time);
}

/** Transport only. The native 1 Hz clock controls observations; path planning,
 * nearest dock selection, travel and delivery amounts never run in the host. */
export function updateHarborTrade(state: GameState, dt: number): void {
  const handle = simCore(state).handle;
  if (rustEngine.sim_harbor_sync_due(handle, state.time)) {
    const edges = harborWaterEdges(state);
    if (geometry.get(state) !== edges) { publish(state, 0, edges); geometry.set(state, edges); }
    const villages = new Map((state.villages ?? []).filter(v => !v.destroyed).map(v => [v.id, v]));
    const realms = new Map(state.factions.filter(f => f.id >= 0 && !f.defeated && f.villageId === undefined && f.relation !== 'confederated').map(f => [f.id, f]));
    const rows: number[] = [], activeVillages = new Set<number>(), store = entityStore(state);
    for (const dock of structuresOf(state, undefined, STRUCTURE_READY, 'dock')) {
      const village = dock.villageId === undefined ? undefined : villages.get(dock.villageId);
      const camp = village && store.buildings.get(village.campId);
      if (village ? !camp || !buildingReady(camp) || village.faction !== dock.faction : !realms.has(dock.faction)) continue;
      for (const point of dockMoorings(state, dock)) {
        const cell = Math.floor(point.y) * state.world.width + Math.floor(point.x);
        rows.push(dock.id, dock.faction, village?.id ?? -1, cell);
        if (village) activeVillages.add(village.id);
      }
    }
    publish(state, 1, rows);
    const relations: number[] = [];
    for (const id of activeVillages) {
      const village = villages.get(id)!;
      for (const realm of realms.values()) relations.push(id, realm.id,
        Number(!hostileView(state, village.faction, realm.id)), Number(villageTrading(state, village, realm.id)));
    }
    publish(state, 2, relations);
    publish(state, 3, state.factions.flatMap(f => [f.id, f.whalingUntil ?? 0]));
  }
  const pointer = rustEngine.sim_harbor_step(handle, state.time, dt);
  const [ships, receipts] = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  // Income callbacks can grow native memory, so copy before applying events.
  const output = new Float64Array(rustEngine.memory.buffer, pointer + 16, ships * 9 + receipts * 4).slice();
  state.harborTradeShips = [];
  for (let i = 0; i < ships * 9; i += 9) state.harborTradeShips.push({ village: output[i], faction: output[i + 1],
    source: output[i + 2], target: output[i + 3], x: output[i + 4], y: output[i + 5], facing: output[i + 6],
    moving: !!output[i + 7], returning: !!output[i + 8] });
  for (let i = ships * 9; i < output.length; i += 4) {
    const faction = state.factions.find(f => f.id === output[i]), dock = entityStore(state).buildings.get(output[i + 1]);
    if (!faction || faction.defeated || !dock || !buildingReady(dock) || dock.faction !== faction.id) continue;
    grantIncome(faction, { gold: output[i + 2] }, state, 'trade');
    const village = state.villages?.find(v => v.id === output[i + 3]);
    if (village) settlementTrade(state, village.campId, -1, faction.id, -1, output[i + 2], 1);
    state.particles.push({ x: dock.x + .5, y: dock.y + .5, text: `+${Number(output[i + 2].toFixed(2))} gold`, color: '#edcf7a', life: 1.6 });
  }
}
