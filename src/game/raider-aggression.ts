import { banditIntensity } from './bandit-intensity';
import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import type { Building, GameState, MarauderPack, Unit } from './types';

const packIndices = new WeakMap<GameState, { packs: MarauderPack[] | undefined; length: number; byId: Map<number, MarauderPack> }>();
export function raiderCanTarget(state: GameState, attacker: Unit | Building, faction: number): boolean {
  if (attacker.faction !== -2) return true;
  let camp: number | undefined;
  if ('capacity' in attacker) camp = attacker.raiderCamp;
  else {
    let index = packIndices.get(state);
    if (!index || index.packs !== state.marauderPacks || index.length !== (state.marauderPacks?.length ?? 0)) {
      index = { packs: state.marauderPacks, length: state.marauderPacks?.length ?? 0,
        byId: new Map((state.marauderPacks ?? []).map(pack => [pack.id, pack])) };
      packIndices.set(state, index);
    }
    const pack = index.byId.get(attacker.marauderPack ?? -1);
    if (pack?.ruinsAmbush) return faction === pack.targetFaction;
    camp = pack?.raiderCamp;
  }
  return raiderMayAttack(state, faction, camp);
}

/** Rust owns the camp/faction retaliation ledger and the difficulty rule. */
export function raiderMayAttack(state: GameState, faction: number, camp?: number): boolean {
  return !!rustEngine.sim_raider_may_attack(simCore(state).handle, banditIntensity(state), camp ?? -1, faction);
}
export function provokeRaiderCamp(state: GameState, camp: number, faction: number): void {
  rustEngine.sim_raider_provoke(simCore(state).handle, camp, faction);
}
