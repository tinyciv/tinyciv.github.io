import { entityStore } from '../src/game/entity-store';
import { describe, expect, it } from 'vitest';
import { armyWarningFixture } from './helpers/army-warnings';
import { recordNativeFrame } from './helpers/native-renderer';
import { resourceInteractionColor } from '../src/game/resource-interaction-highlight';
import type { FogView } from '../src/game/fog';

function fixture() {
  const state = armyWarningFixture();
  Object.assign(state.world.tiles[27 * state.world.width + 18], { resource: 'iron', resourceGroup: 1 });
  const fog: FogView = { width: state.world.width, height: state.world.height, visible: new Uint8Array(state.world.tiles.length).fill(1),
    explored: Array(state.world.tiles.length).fill(1), buildings: [...state.buildings], fields: [], sources: [], revision: 1, explorationRevision: 1 };
  return { state, fog };
}
describe('nearby resource silhouettes', () => {
  it('uses the city faction color and includes the three-tile footing boundary', () => {
    const { state, fog } = fixture(); state.units[0].x = 22; state.units[0].y = 27.5;
    expect(resourceInteractionColor(state, 18, 27, fog)).toBe('#cd4141');
    state.units[0].x = 22.01;
    expect(resourceInteractionColor(state, 18, 27, fog)).toBeUndefined();
  });
  it('does not expose hidden resources or highlight unavailable interaction', () => {
    const { state, fog } = fixture();
    fog.visible.fill(0); expect(resourceInteractionColor(state, 18, 27, fog)).toBeUndefined();
    fog.visible.fill(1); state.units[0].inside = true;
    expect(resourceInteractionColor(state, 18, 27, fog)).toBeUndefined();
    state.units[0].inside = false; state.gameOver = true;
    expect(resourceInteractionColor(state, 18, 27, fog)).toBeUndefined();
  });
  it('renders the halo behind the actual deposit and hides it when a building covers the cell', () => {
    const { state, fog } = fixture();
    const order = recordNativeFrame(state, { fog }).drawOrder;
    const halo = order.findIndex(key => key.startsWith('resource-outline:iron:'));
    expect(halo).toBeGreaterThanOrEqual(0);
    expect(halo).toBeLessThan(order.findIndex(key => key.startsWith('resource:iron:')));
    entityStore(state).buildings.add({ id: 1234, kind: 'house', x: 18, y: 27, faction: 0, hp: 100, maxHp: 100, capacity: 2 });
    fog.buildings = [...state.buildings];
    expect(recordNativeFrame(state, { fog }).drawOrder.some(key => key.startsWith('resource-outline:iron:'))).toBe(false);
  });
});
