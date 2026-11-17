import type { Building, GameState, Point } from './types';

/** Host callbacks stay separate from transfer effects to avoid import cycles. */
export interface SettlementHost {
  makePalace(state: GameState, faction: number, point: Point): Building;
  log(state: GameState, text: string, kind?: 'info' | 'good' | 'warning'): void;
  afterTransfer(state: GameState, faction: number): void;
}

let registeredHost: SettlementHost | undefined;
/** simulation.ts registers palace construction and post-transfer refreshes. */
export function registerSettlementHost(host: SettlementHost): void { registeredHost = host; }
export function settlementHost(): SettlementHost {
  if (!registeredHost) throw new Error('The town host is not registered.');
  return registeredHost;
}
