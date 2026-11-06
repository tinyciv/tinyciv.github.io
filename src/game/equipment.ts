import type { EquipmentLevel } from './types';

export const MAX_EQUIPMENT_LEVEL = 6 satisfies EquipmentLevel;
export const EQUIPMENT_MULTIPLIERS = [1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1] as const;
export const equipmentMultiplier = (level: EquipmentLevel = 0): number => EQUIPMENT_MULTIPLIERS[level];
