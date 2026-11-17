import { rustEngine } from './rust-engine';

// Content can be imported by simulation/research without loading controllers.
export const FOUNDRY_GOLD = rustEngine.field_cannon_constant(0);
export const FOUNDRY_HP = rustEngine.field_cannon_constant(1);
export const FIELD_CANNON_UPKEEP = rustEngine.field_cannon_constant(2);
export const FIELD_CANNON_RANGE = rustEngine.field_cannon_constant(5);
