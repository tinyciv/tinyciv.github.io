import { atWar } from './relations';
import { isHumanFaction } from './player-context';
import { buildingWidth, buildingHeight, distance, type Building, type GameState, type Point, type Unit } from './types';

export const ARMY_WARNING_RANGE = 80;
export const ARMY_WARNING_SECONDS = 6;
export const MARAUDER_FORMATION_WARNING_COOLDOWN = 60;
export interface ArmyWarning extends Point {
  id: number; kind: 'formation' | 'levy' | 'town' | 'attack'; sourceId: number; faction: number;
  createdAt: number; recipients: number[]; color: string; message: string;
}

const COMBAT_REGION_SIZE = 12;
const combatReports = new WeakMap<GameState, { interval: number; reported: Set<string> }>();

export function combatWarningRegion(point: Point): string {
  return `${Math.floor(point.x / COMBAT_REGION_SIZE)}:${Math.floor(point.y / COMBAT_REGION_SIZE)}`;
}

/** Unit and town damage feed the HUD directly from confirmed hits. Group
 * nearby hits before publishing so a battle doesn't flood the warning feed. */
export function announceCombatDamage(state: GameState, target: Unit | Building): void {
  const town = 'capacity' in target;
  if (town && target.kind !== 'palace' || !isHumanFaction(state, target.faction)) return;
  const point = town ? { x: target.x + buildingWidth(target) / 2, y: target.y + buildingHeight(target) / 2 } : target;
  const interval = Math.floor(state.time / 2);
  let reports = combatReports.get(state);
  if (!reports || reports.interval !== interval) {
    reports = { interval, reported: new Set() };
    combatReports.set(state, reports);
  }
  const region = `${target.faction}:${combatWarningRegion(point)}`;
  if (reports.reported.has(region)) return;
  reports.reported.add(region);
  pushWarning(state, { kind: 'attack', sourceId: target.id, faction: target.faction, createdAt: state.time,
    recipients: [target.faction], x: point.x, y: point.y, color: '#c52c32',
    message: town ? 'City under attack' : 'Units under attack' });
}

function pushWarning(state: GameState, warning: Omit<ArmyWarning, 'id'>): void {
  // Retain a short bounded event history for multiplayer frames/reconnects.
  // Presentation gives each new event six real seconds even at accelerated speed.
  state.armyWarnings = (state.armyWarnings ?? []).filter(event => state.time - event.createdAt < 30).slice(-127);
  state.armyWarnings.push({ id: state.nextArmyWarningId = (state.nextArmyWarningId ?? 0) + 1, ...warning });
}

/** A completed town of another civilization, announced once when it is finished,
 * to every other human realm. The marker points toward the new town. */
export function announceTownFounded(state: GameState, town: Building): void {
  if (town.kind !== 'palace' || town.faction < 0) return;
  const owner = state.factions.find(f => f.id === town.faction);
  if (!owner || owner.villageId !== undefined) return;
  const recipients = (state.multiplayer?.humanFactionIds ?? [0]).filter(viewer => viewer !== town.faction
    && !state.factions.find(f => f.id === viewer)?.defeated);
  if (!recipients.length) return;
  pushWarning(state, { kind: 'town', sourceId: town.id, faction: town.faction, createdAt: state.time, recipients,
    x: town.x + 1, y: town.y + 1, color: owner.color, message: `The ${owner.name} have founded a new settlement.` });
}

/** Called only on successful mobilization, never by a render or AI polling loop.
 * Eligibility uses each human's Leader at the instant the army mobilizes. */
export function announceArmyMobilization(state: GameState, leader: Unit, kind: 'formation' | 'levy'): void {
  const recipients = (state.multiplayer?.humanFactionIds ?? [0]).filter(viewer => {
    if (!atWar(state, viewer, leader.faction) || state.factions.find(f => f.id === viewer)?.defeated) return false;
    const player = state.units.find(unit => unit.kind === 'leader' && unit.faction === viewer && unit.hp > 0);
    return !!player && distance(player, leader) <= ARMY_WARNING_RANGE;
  });
  if (!recipients.length) return;
  const faction = state.factions.find(f => f.id === leader.faction);
  const pack = state.marauderPacks?.find(pack => pack.id === leader.marauderPack);
  const marauder = leader.faction === -2;
  if (marauder && kind === 'formation') {
    // Keep this on the army, separately from the short-lived display events.
    // Retreat/reform oscillation and save/reload must not restart the timer.
    const source = pack ?? leader;
    if (state.time - (source.lastFormationWarningAt ?? -Infinity) < MARAUDER_FORMATION_WARNING_COOLDOWN) return;
    source.lastFormationWarningAt = state.time;
  }
  const message = kind === 'levy' ? `The ${faction?.name ?? 'enemy'} are conscripting their people to raise a large army!`
    : marauder ? 'Nearby marauders have entered into a formation and are on the move'
    : `The ${faction?.name ?? 'enemy'} have entered into a formation and are on the move!`;
  pushWarning(state, {
    kind, sourceId: leader.id, faction: leader.faction, createdAt: state.time, recipients,
    x: leader.x, y: leader.y, color: marauder ? pack?.color ?? '#cf5444' : faction?.color ?? '#cf5444', message });
}
