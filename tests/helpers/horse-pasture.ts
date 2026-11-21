import type { GameState } from '../../src/game/types';

export function withHorsePasture<T extends GameState>(state: T): T {
  state.livestock = { revision: 0, herds: [{
    id: 0, species: 'horse', animals: [1, 2], center: { x: 27.5, y: 23.5 }, nextMoveAt: 0,
    pasture: { faction: 0, x: 25, y: 21, width: 6, height: 5 },
  }] };
  return state;
}
