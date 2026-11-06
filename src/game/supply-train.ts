import { constructionEdges } from './builders';
import { entityStore } from './entity-store';
import { hasStaticPath } from './pathfinding';
import { researchLevel } from './research';
import { buildingReady, distance, unitMaxHp, type GameState, type Point, type Unit } from './types';

export const SUPPLY_DEPOT_COST = 120;
export const SUPPLY_DEPOT_BUILD_SECONDS = 45;
export const SUPPLY_CART_INTERVAL = 30;
export const SUPPLY_CART_HEALING = 10;
export const SUPPLY_CART_HP = 40;
export const SUPPLY_CART_SPEED = 2.8;
export const SUPPLY_CART_DELIVERY_RANGE = .85;
type Move = (state: GameState, unit: Unit, goal: Point, dt: number) => void;

/** A depot maintains one physical, population-free cart. A blocked route waits
 * at its source rather than spawning carts into a building or across water. */
export function updateSupplyDepots(state: GameState): void {
  const store = entityStore(state), due = [];
  for (const depot of store.buildings.query('supplyDepot')) {
    if (!buildingReady(depot)) continue;
    const faction = state.factions.find(candidate => candidate.id === depot.faction);
    if (!faction || faction.defeated || !researchLevel(faction, 'supplyTrain')) continue;
    depot.supplyDepot ??= { nextDispatchAt: state.time + SUPPLY_CART_INTERVAL };
    if (state.time + 1e-7 >= depot.supplyDepot.nextDispatchAt) due.push(depot);
  }
  if (!due.length) return;
  // Preparation belongs to an actual dispatch, not each intervening movement step.
  const occupied = new Set(state.units.filter(unit => unit.kind === 'supplyCart' && unit.hp > 0).map(unit => unit.supplyCart?.depot));
  let nextId: number | undefined;
  for (const depot of due) {
    if (occupied.has(depot.id)) continue;
    const leader = store.units.query('leader').find(unit => unit.faction === depot.faction && unit.hp > 0 && !unit.inside && unit.embarkedOn === undefined);
    if (!leader) continue;
    const exit = constructionEdges(state, depot, true).sort((a, b) => distance(a, leader) - distance(b, leader))
      .find(point => hasStaticPath(state, point, leader, depot.faction));
    if (!exit) { depot.supplyDepot!.nextDispatchAt = state.time + 3; continue; }
    if (nextId === undefined) {
      nextId = 1;
      for (const id of store.units.ids()) nextId = Math.max(nextId, id + 1);
      for (const id of store.buildings.ids()) nextId = Math.max(nextId, id + 1);
    }
    store.units.add({ id: nextId++, kind: 'supplyCart', faction: depot.faction, ...exit,
      supplyCart: { depot: depot.id, leader: leader.id }, home: depot.id, hp: SUPPLY_CART_HP, maxHp: SUPPLY_CART_HP,
      attack: 0, defense: 0, morale: 100, speed: SUPPLY_CART_SPEED, range: 0, order: 'work',
      cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time });
    depot.supplyDepot!.nextDispatchAt = state.time + SUPPLY_CART_INTERVAL;
  }
}

/** Delivery consumes the cart once. Healing is faction-wide and cannot revive
 * casualties, overfill maximum health, or affect an enemy beside the Leader. */
export function updateSupplyCart(state: GameState, cart: Unit, dt: number, move: Move): boolean {
  if (cart.kind !== 'supplyCart') return false;
  if (cart.hp <= 0 || cart.supplyCart?.delivered) return true;
  const leader = entityStore(state).units.get(cart.supplyCart?.leader ?? -1);
  if (!leader || leader.kind !== 'leader' || leader.faction !== cart.faction || leader.hp <= 0
    || state.factions.find(faction => faction.id === cart.faction)?.defeated) {
    cart.hp = 0; cart.inside = true; cart.moving = false; return true;
  }
  cart.target = undefined; cart.order = 'work';
  if (leader.inside || leader.embarkedOn !== undefined) { cart.moving = false; return true; }
  if (distance(cart, leader) > SUPPLY_CART_DELIVERY_RANGE) move(state, cart, leader, dt);
  if (distance(cart, leader) > SUPPLY_CART_DELIVERY_RANGE) return true;
  for (const unit of state.units) if (unit.faction === cart.faction && unit.hp > 0 && unit !== cart)
    unit.hp = Math.min(unitMaxHp(unit), unit.hp + SUPPLY_CART_HEALING);
  cart.supplyCart!.delivered = true; cart.hp = 0; cart.inside = true; cart.moving = false;
  cart.path = undefined; cart.destination = undefined;
  state.particles.push({ x: leader.x, y: leader.y, text: '+10 HP supplies', color: '#88d18a', life: 1.6 });
  return true;
}
