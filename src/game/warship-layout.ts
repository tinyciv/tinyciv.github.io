import type { Unit, Point } from './types';
export function deckPoint(ship: Pick<Unit, 'facing'>, side: number, forward: number): Point {
 return { x: side * -Math.sin(ship.facing) + forward * Math.cos(ship.facing), y: side * Math.cos(ship.facing) + forward * Math.sin(ship.facing) };
}
export function weaponPosition(index: number, count: number): Point {
 return count === 4 ? { x: 16 + (index % 2 ? 15 : -15), y: 16 + (index < 2 ? -42 : 40) }
  : { x: 16, y: 16 + (count === 2 ? index ? 45 : -45 : (index - 1) * 44) };
}
/** Presentation coordinates mirror the native mount/crew attachment offsets. */
export function warshipGunPoint(ship: Unit, slot: number): Point {
 const count = ship.warship!.class === 'warGalley' ? 2 : ship.warship!.class === 'caravel' ? 3 : 4;
 const position = slot < 4 ? weaponPosition(slot, count) : undefined;
 const i = slot - 4;
 const p = position ? deckPoint(ship, (position.x - 16) / 32, -(position.y - 16) / 32)
  : deckPoint(ship, i % 2 ? .65 : -.65, (Math.floor(i / 2) - 1.5) * .7);
 return { x: ship.x + p.x, y: ship.y + p.y };
}
