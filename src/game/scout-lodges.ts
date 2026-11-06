import { constructionEdges } from './builders';
import { entityStore } from './entity-store';
import { isForbidden } from './forbidden-zones';
import { buildingReady, type Building, type GameState, type Point, type Unit } from './types';

export const SCOUT_LODGE_CAPACITY = 2;
export const SCOUT_RECRUIT_SECONDS = 15;
export const LODGE_SCOUT_SPEED = 3.6 * 1.1 * 1.2;
const cell = (state: GameState, point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const checks = new WeakMap<GameState, { nextAt: number; time: number; units: number; buildings: number; lodges: string }>();

function canRecruit(state: GameState, lodge: Building): boolean {
  const faction = state.factions.find(faction => faction.id === lodge.faction);
  return lodge.kind === 'scoutLodge' && buildingReady(lodge) && lodge.faction >= 0
    && !!faction && !faction.defeated && !isForbidden(state, lodge.x, lodge.y, lodge.faction);
}
function livingScouts(state: GameState, lodge: Building): Unit[] {
  return state.units.filter(unit => unit.kind === 'scout' && unit.scoutLodge === lodge.id
    && unit.faction === lodge.faction && unit.hp > 0);
}

/** Read-only status for a completed lodge's automatic explorer service. */
export function scoutLodgeStatus(state: GameState, lodge: Building): {
  capacity: number; alive: number; recruitingIn: number | null; blocked: boolean;
} {
  const alive = livingScouts(state, lodge).length, enabled = canRecruit(state, lodge);
  const clock = lodge.scoutLodge?.owner === lodge.faction ? lodge.scoutLodge : undefined;
  const recruitingIn = !enabled || alive >= SCOUT_LODGE_CAPACITY ? null
    : clock?.initialRemaining || !clock ? 0 : Math.max(0, (clock.nextRecruitAt ?? state.time + SCOUT_RECRUIT_SECONDS) - state.time);
  return { capacity: SCOUT_LODGE_CAPACITY, alive, recruitingIn,
    blocked: enabled && alive < SCOUT_LODGE_CAPACITY && recruitingIn === 0 && !freeExits(state, lodge).length };
}
function freeExits(state: GameState, lodge: Building, occupied?: ReadonlySet<number>): Point[] {
  occupied ??= new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => cell(state, unit)));
  return constructionEdges(state, lodge, true).filter(point => !occupied.has(cell(state, point)));
}

/** Two scouts leave a completed lodge automatically. Losses are replaced one
 * at a time, without consuming city residents or the Leader's retinue slots.
 * Surviving explorers keep their allegiance if their lodge is lost. */
export function updateScoutLodges(state: GameState): void {
  if (state.paused || state.gameOver) return;
  const store = entityStore(state), lodges = store.buildings.query('scoutLodge').filter(lodge => canRecruit(state, lodge));
  if (!lodges.length) return;
  const signature = lodges.map(lodge => `${lodge.id}:${lodge.faction}`).join(','), previous = checks.get(state);
  if (previous && state.time >= previous.time && state.time < previous.nextAt && previous.units === store.units.revision
    && previous.buildings === store.buildings.revision && previous.lodges === signature) return;
  const live = new Map<string, number>();
  for (const unit of state.units) if (unit.kind === 'scout' && unit.hp > 0 && unit.scoutLodge !== undefined) {
    const key = `${unit.faction}:${unit.scoutLodge}`; live.set(key, (live.get(key) ?? 0) + 1);
  }
  let occupied: Set<number> | undefined, nextId: number | undefined;
  for (const lodge of lodges) {
    let count = live.get(`${lodge.faction}:${lodge.id}`) ?? 0;
    if (!lodge.scoutLodge || lodge.scoutLodge.owner !== lodge.faction)
      lodge.scoutLodge = { owner: lodge.faction, initialRemaining: Math.max(0, SCOUT_LODGE_CAPACITY - count) };
    const clock = lodge.scoutLodge;
    if (count >= SCOUT_LODGE_CAPACITY) { clock.initialRemaining = 0; delete clock.nextRecruitAt; continue; }
    if (!clock.initialRemaining) {
      clock.nextRecruitAt ??= state.time + SCOUT_RECRUIT_SECONDS;
      if (clock.nextRecruitAt > state.time + 1e-7) continue;
    }
    occupied ??= new Set(state.units.filter(unit => unit.hp > 0 && !unit.inside).map(unit => cell(state, unit)));
    const exits = freeExits(state, lodge, occupied);
    const allowance = Math.min(SCOUT_LODGE_CAPACITY - count, clock.initialRemaining || 1, exits.length);
    if (!allowance) continue;
    nextId ??= Math.max(0, ...state.units.map(unit => unit.id), ...state.buildings.map(building => building.id));
    for (const point of exits.slice(0, allowance)) {
      const scout: Unit = { id: ++nextId, kind: 'scout', faction: lodge.faction, scoutLodge: lodge.id, ...point,
        hp: 100, maxHp: 100, morale: 100, attack: 0, defense: 4, speed: LODGE_SCOUT_SPEED, range: 0,
        order: 'follow', cooldown: 0, lastCombat: -60, lastDamagedAt: -60,
        facing: 0, moving: false, attackTime: 0, bornAt: state.time };
      entityStore(state).units.add(scout); occupied.add(cell(state, point)); count++;
      clock.initialRemaining = Math.max(0, clock.initialRemaining - 1);
    }
    if (count < SCOUT_LODGE_CAPACITY && !clock.initialRemaining) clock.nextRecruitAt = state.time + SCOUT_RECRUIT_SECONDS;
    else delete clock.nextRecruitAt;
  }
  checks.set(state, { time: state.time, nextAt: Math.min(state.time + .5, ...lodges.flatMap(lodge =>
    lodge.scoutLodge?.nextRecruitAt !== undefined && lodge.scoutLodge.nextRecruitAt > state.time ? [lodge.scoutLodge.nextRecruitAt] : [])),
    units: store.units.revision, buildings: store.buildings.revision, lodges: signature });
}
