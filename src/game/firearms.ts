import { UNIT_KIND_CODES } from './entity-store';
import { areMusketmenUnlocked } from './research';
import { rustEngine } from './rust-engine';
import type { GameState, Unit } from './types';

/** Rust owns the equipment policy; presentation shares the same answer. */
export function usesFirearm(state: GameState, unit: Unit): boolean {
  return !!rustEngine.retinue_uses_firearm(UNIT_KIND_CODES[unit.kind],
    Number(areMusketmenUnlocked(state.factions.find(faction => faction.id === unit.faction))));
}
