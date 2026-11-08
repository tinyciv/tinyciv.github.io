import { atWar } from './relations';
import { distance, type GameState, type Point, type Unit } from './types';

export const ARMY_WARNING_RANGE = 80;
export const ARMY_WARNING_SECONDS = 6;
export interface ArmyWarning extends Point {
  id: number; kind: 'formation' | 'levy'; sourceId: number; faction: number;
  createdAt: number; recipients: number[]; color: string; message: string;
}

/** Called only on successful mobilization, never by a render or AI polling loop.
 * Eligibility uses each human's Leader at the instant the army mobilizes. */
export function announceArmyMobilization(state: GameState, leader: Unit, kind: ArmyWarning['kind']): void {
  const recipients = (state.multiplayer?.humanFactionIds ?? [0]).filter(viewer => {
    if (!atWar(state, viewer, leader.faction) || state.factions.find(f => f.id === viewer)?.defeated) return false;
    const player = state.units.find(unit => unit.kind === 'leader' && unit.faction === viewer && unit.hp > 0);
    return !!player && distance(player, leader) <= ARMY_WARNING_RANGE;
  });
  if (!recipients.length) return;
  const faction = state.factions.find(f => f.id === leader.faction);
  const pack = state.marauderPacks?.find(pack => pack.id === leader.marauderPack);
  const marauder = leader.faction === -2;
  const message = kind === 'levy' ? `The ${faction?.name ?? 'enemy'} are conscripting their people to raise a large army!`
    : marauder ? 'Nearby marauders have entered into a formation and are on the move'
    : `The ${faction?.name ?? 'enemy'} have entered into a formation and are on the move!`;
  // Retain a short bounded event history for multiplayer frames/reconnects.
  // Presentation gives each new event six real seconds even at accelerated speed.
  state.armyWarnings = (state.armyWarnings ?? []).filter(event => state.time - event.createdAt < 30).slice(-127);
  state.armyWarnings.push({ id: state.nextArmyWarningId = (state.nextArmyWarningId ?? 0) + 1,
    kind, sourceId: leader.id, faction: leader.faction, createdAt: state.time, recipients,
    x: leader.x, y: leader.y, color: marauder ? pack?.color ?? '#cf5444' : faction?.color ?? '#cf5444', message });
}
