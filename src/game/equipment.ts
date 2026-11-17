import type { EquipmentLevel } from './types';
import { rustEngine } from './rust-engine';

export const MAX_EQUIPMENT_LEVEL = rustEngine.combat_constant(14) as 6 satisfies EquipmentLevel;
export const EQUIPMENT_MULTIPLIERS = [rustEngine.combat_constant(7), rustEngine.combat_constant(8),
  rustEngine.combat_constant(9), rustEngine.combat_constant(10), rustEngine.combat_constant(11),
  rustEngine.combat_constant(12), rustEngine.combat_constant(13)] as const;
// Cache this fixed Rust table once; building/UI reads need no repeated boundary calls.
export const equipmentMultiplier = (level: EquipmentLevel = 0): number => EQUIPMENT_MULTIPLIERS[level];
