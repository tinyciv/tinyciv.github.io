import { rustEngine } from './rust-engine';

// Keep native metadata independent of settlement/city/village host modules:
// those modules form a cycle and Node bundles may initialize villages first.
const constant = (index: number): number => rustEngine.settlement_constant(index);
export const SETTLEMENT_CONSTANTS = {
  senseInterval: constant(0), integrateInterval: constant(1), loyaltyStart: constant(22), loyaltyGrace: constant(23),
  confederationMin: constant(25), confederationMargin: constant(26), tradeCost: constant(28), allianceCost: constant(29), allianceMinCost: constant(30),
  villageBaseIncome: constant(110), patch: constant(113),
};
