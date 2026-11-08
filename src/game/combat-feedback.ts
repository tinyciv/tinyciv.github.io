import { nearbyUnits } from './spatial';
import { distance, type GameState, type Unit, type Particle } from './types';
import { playerFaction } from './player-context';

export const DEFENSIVE_RADIUS = 5;
export const DAMAGE_NUMBER_DURATION = .85;
/** Record actual lost HP, including the final hit, rather than raw attack power. */
export function recordUnitDamage(state: GameState, target: Unit, previousHp: number, attackerId?: number): void {
  const lost = Math.max(0, previousHp - target.hp);
  if (!lost) return;
  const fatal = target.hp <= 0;
  if (fatal) for (const particle of state.particles)
    if (particle.kind === 'damage' && particle.damageUnitId === target.id) particle.damageFatal = true;
  const last = state.particles.at(-1);
  // A bounded queue keeps huge engagements from retaining unlimited labels.
  if (state.particles.length < 240) state.particles.push({ x: target.x, y: target.y,
    text: `-${Math.max(1, Math.round(lost))}`, color: '#fff0db', life: DAMAGE_NUMBER_DURATION,
    duration: DAMAGE_NUMBER_DURATION, kind: 'damage', faction: target.faction, damageUnitId: target.id, damageFatal: fatal,
    direction: (target.id % 2 ? 1 : -1) * (last?.x === target.x ? -1 : 1) });
  if (attackerId === undefined) return;
  for (const ally of nearbyUnits(state, target, DEFENSIVE_RADIUS)) {
    if (ally.faction !== target.faction || ally.hp <= 0 || ally.retinueStance !== 'defensive' || !ally.defensiveAnchor) continue;
    if (distance(ally.defensiveAnchor, target) > DEFENSIVE_RADIUS) continue;
    ally.defensiveThreat = { target: attackerId, until: state.time + 4 };
  }
}
export function damageNumberPose(life: number, direction = 1): { rise: number; offset: number; alpha: number } {
  const progress = Math.max(0, Math.min(1, 1 - life / DAMAGE_NUMBER_DURATION));
  return { rise: .18 + .42 * Math.sin(Math.PI * Math.min(1, progress * 1.15)) + .22 * progress,
    offset: direction * (.2 + .22 * progress), alpha: Math.min(1, life / .25) };
}

function friendlyDamage(state: GameState, particle: Particle): boolean {
  const viewer = playerFaction(state), owner = particle.faction;
  return owner === viewer || viewer === 0 && (state.factions.some(faction => faction.id === owner && faction.relation === 'confederated')
    || !!state.villages?.some(village => village.faction === owner && village.relation === 'allied' && !village.destroyed));
}
/** Resolve per viewer: the victim's owner still sees friendly damage in multiplayer. */
export function damageNumberVisible(state: GameState, particle: Particle): boolean {
  return !particle.damageFatal || friendlyDamage(state, particle);
}
export function damageNumberStyle(state: GameState, particle: Particle): { text: string; color: string } {
  const friendly = friendlyDamage(state, particle);
  const amount = Math.abs(Math.round(Number(particle.text.replace('−', '-'))));
  return { text: `${friendly ? '-' : ''}${amount}`, color: friendly ? '#ff5252' : '#ffffff' };
}

/** Gold glides upward without the lateral bounce used by damage numbers. */
export function goldNumberPose(life: number, duration = 1.6): { rise: number; offset: number; alpha: number } {
  const progress = Math.max(0, Math.min(1, 1 - life / duration));
  const fade = Math.max(0, (progress - .3) / .7);
  return { rise: .1 + .65 * (1 - (1 - progress) ** 2), offset: 0, alpha: 1 - fade * fade * (3 - 2 * fade) };
}
