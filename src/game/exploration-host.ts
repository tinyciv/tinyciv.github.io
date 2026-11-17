import type { Building, BuildingKind, GameState, Point, Unit } from './types';

interface ExplorationHost {
    building(state: GameState, kind: BuildingKind, faction: number, point: Point): Building;
    unit(state: GameState, kind: Unit['kind'], faction: number, point: Point, home?: number): Unit;
    changed(state: GameState, faction: number): void;
}

// Keep registration independent of exploration's runtime imports: they can
// reach simulation.ts before exploration-native.ts has finished evaluating.
let host: ExplorationHost | undefined;
export function registerExplorationHost(value: ExplorationHost): void { host = value; }
export function explorationHost(): ExplorationHost {
    if (!host) throw new Error('The exploration host is not registered.');
    return host;
}
