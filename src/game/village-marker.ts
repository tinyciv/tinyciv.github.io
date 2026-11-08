import { villageAlliedWith } from './village-relations';
import { playerFaction } from './player-context';
import { buildingReady, type Building, type GameState } from './types';

// Two screen pixels per cell; the silhouette is 14×12 before its 1px outline.
const CHECKMARK = ['      #', '     ##', '#   ## ', '## ##  ', ' ###   ', '  #    '];

/** A destroyed camp immediately loses its visible alliance symbol. */
export function alliedVillageCamps(state: GameState): Building[] {
  return (state.villages ?? []).flatMap(village => {
    if (!villageAlliedWith(village, playerFaction(state))) return [];
    const camp = state.buildings.find(building => building.id === village.campId && buildingReady(building));
    return camp ? [camp] : [];
  });
}

/** White pixel check, using the warning marks' palette at a fixed UI size. */
export function drawAllianceMarker(c: CanvasRenderingContext2D): void {
  c.save();
  // Paint all outline cells first, then the connected white silhouette.
  for (const outline of [true, false]) {
    const inset = outline ? 1 : 0;
    c.fillStyle = outline ? '#5f5544' : '#fffbe9';
    for (let row = 0; row < CHECKMARK.length; row++) {
      for (let column = 0; column < CHECKMARK[row].length; column++) {
        if (CHECKMARK[row][column] !== '#') continue;
        c.fillRect(column * 2 - 7 - inset, row * 2 - 6 - inset, 2 + inset * 2, 2 + inset * 2);
      }
    }
  }
  c.restore();
}
