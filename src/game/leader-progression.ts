import { researchLevel, RESEARCH_BRANCHES } from './research';
import type { ResearchBranchId, Faction } from './types';
import { playerFaction } from './player-context';
import { indexedLeader } from './spatial';
import { isRetinueMember, unitMaxHp, type GameState, type LeaderProgression, type LeaderSkillId, type Unit } from './types';
import { unitAttack, unitDefense } from './veterancy';
import { culturalHomeGround } from './cultural-territory';
import { rustEngine } from './rust-engine';

export type { LeaderSkillId } from './types';
export const LEADER_XP_PER_KILL = rustEngine.progression_constant(1);
export const LEADER_XP_PER_LEVEL = rustEngine.progression_constant(0);
/** A commander is worth one initial level, not the old 6,400-XP threshold.
 * Keep this fixed as later levels become more expensive. */
export const LEADER_VICTORY_XP = rustEngine.progression_constant(2);
export const RETINUE_LEADER_XP_SHARE = rustEngine.progression_constant(3);
export const LEADER_LEVEL_HP_BONUS = rustEngine.progression_constant(4);
export const LEADER_LEVEL_ATTACK_BONUS = rustEngine.progression_constant(5);
export const LEADER_SKILL_MAX_RANK = rustEngine.progression_constant(6);
const POWER_ATTACK_BONUS = rustEngine.progression_constant(11);
const GUARD_DEFENSE_BONUS = rustEngine.progression_constant(12);
export const LEADER_SKILL_IDS: readonly LeaderSkillId[] = ['power', 'guard', 'command', 'engineer', 'brace', 'discretion'];
export const LEADER_SKILL_TECH: Partial<Record<LeaderSkillId, ResearchBranchId>> = { engineer: 'metalTools', brace: 'militaryTactics', discretion: 'scoutLodge' };
export const leaderSkillMaxRank = (skill: LeaderSkillId): number => rustEngine.progression_skill_cap(LEADER_SKILL_IDS.indexOf(skill));
export const leaderSkillUnlocked = (faction: Faction | undefined, skill: LeaderSkillId): boolean => !LEADER_SKILL_TECH[skill] || researchLevel(faction, LEADER_SKILL_TECH[skill]!) > 0;

export const leaderXpRequired = (level: number): number => rustEngine.progression_xp_required(level);
export const initialLeaderProgression = (): LeaderProgression => ({ level: 1, xp: 0, skillPoints: 0,
  skills: { power: 0, guard: 0, command: 0, engineer: 0, brace: 0, discretion: 0 } });

/** Reading the HUD never initializes or changes authoritative unit state. */
export function readLeaderProgression(unit: Pick<Unit, 'leaderProgression'>): Readonly<Omit<LeaderProgression, 'skills'>> & { readonly skills: Readonly<LeaderProgression['skills']> } {
  const progress = unit.leaderProgression ?? initialLeaderProgression();
  return { level: progress.level, xp: progress.xp, skillPoints: progress.skillPoints, skills: { ...progress.skills } };
}

/** Command capacity belongs to the living Leader, independently of paid slots. */
export function leaderRetinueBonus(leader: Unit | undefined): number {
  return leader?.kind === 'leader' && leader.hp > 0 ? readLeaderProgression(leader).skills.command : 0;
}

/** Towers, militia, civilians and marauder packs do not train a faction's Leader. */
export function earnsLeaderCombatXp(unit: Unit | undefined): boolean {
  return !!unit && unit.faction >= 0 && unit.marauderPack === undefined
    && unit.guardPost === undefined && unit.villageId === undefined
    && (unit.kind === 'leader' || isRetinueMember(unit));
}

/** Escort kills retain their squad veterancy; the Leader receives a tenth of
 * the combat XP that a personal kill earns. Snapshot this at projectile launch. */
export const leaderCombatXp = (unit: Unit | undefined): number => earnsLeaderCombatXp(unit)
  ? LEADER_XP_PER_KILL * (unit!.kind === 'leader' ? 1 : RETINUE_LEADER_XP_SHARE) : 0;

/** Called once for an eligible combat casualty; never changes veterancy. */
export function awardLeaderXp(state: GameState, amount: number, factionId = playerFaction(state)): number {
  const leader = indexedLeader(state, factionId), faction = state.factions.find(candidate => candidate.id === factionId);
  if (!leader || !faction || faction.defeated || state.gameOver || !Number.isFinite(amount) || amount <= 0) return 0;
  const progress = leader.leaderProgression ??= initialLeaderProgression();
  const pointer = rustEngine.progression_award(progress.level, progress.xp, progress.skillPoints, amount,
    leader.hp, unitMaxHp(leader), leader.attack, leader.enemyStrengthMultiplier ?? 1);
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 7);
  progress.level = result[0]; progress.xp = result[1]; progress.skillPoints = result[2];
  const levels = result[6];
  if (levels) {
    leader.hp = result[3]; leader.maxHp = result[4]; leader.attack = result[5];
  }
  return levels;
}

export const skillName: Record<LeaderSkillId, string> = { power: 'Power', guard: 'Guard', command: 'Command', engineer: 'Engineer', brace: 'Brace', discretion: 'Discretion' };
export const skillEffect: Record<LeaderSkillId, string> = { power: '+1 base Attack per 2 ranks', guard: '+1 base Defense', command: '+1 retinue slot', engineer: 'Companion builds roads and bridges at half cost', brace: 'Stand still 10s; gain up to +6 Defense', discretion: 'Flee 50% faster and recover health immediately' };
const validSkill = (skill: unknown): skill is LeaderSkillId => LEADER_SKILL_IDS.includes(skill as LeaderSkillId);
function unavailableReason(state: GameState, leader: Unit | undefined, factionId: number): string {
  if (factionId !== playerFaction(state)) return 'Choose your own Leader.';
  if (state.gameOver) return 'The match has ended.';
  if (state.factions.find(faction => faction.id === factionId)?.defeated) return 'Your faction has been defeated.';
  if (!leader) return 'A living Leader is required.';
  return '';
}

export interface LeaderSkillView {
  id: LeaderSkillId; name: string; rank: number; maxRank: number; effect: string; canLearn: boolean; requiredTech?: string; unlocked: boolean;
  nextAttack: number; nextDefense: number; nextMaxHp: number; nextRetinueBonus: number;
}
export interface LeaderProgressionView {
  leader: Unit; level: number; xp: number; xpRequired: number; skillPoints: number;
  skills: LeaderSkillView[]; hp: number; maxHp: number; attack: number; defense: number; retinueBonus: number;
}
export function leaderProgressionView(state: GameState, factionId = playerFaction(state)): LeaderProgressionView | undefined {
  const leader = indexedLeader(state, factionId);
  if (!leader) return;
  const progress = readLeaderProgression(leader), faction = state.factions.find(candidate => candidate.id === factionId);
  const home = culturalHomeGround(state, faction, leader);
  const attack = unitAttack(leader, faction, home), defense = unitDefense(leader, faction, home), retinueBonus = leaderRetinueBonus(leader);
  const available = !unavailableReason(state, leader, factionId) && progress.skillPoints > 0;
  return { leader, level: progress.level, xp: progress.xp, xpRequired: leaderXpRequired(progress.level),
    skillPoints: progress.skillPoints, hp: leader.hp, maxHp: unitMaxHp(leader), attack, defense, retinueBonus,
    skills: LEADER_SKILL_IDS.map(id => {
      const rank = progress.skills[id] ?? 0, maxRank = leaderSkillMaxRank(id), canIncrease = rank < maxRank;
      const branch = LEADER_SKILL_TECH[id], unlocked = leaderSkillUnlocked(faction, id);
      return { id, name: skillName[id], rank, maxRank, effect: skillEffect[id], unlocked, requiredTech: branch && RESEARCH_BRANCHES.find(tech => tech.id === branch)?.label, canLearn: available && canIncrease && unlocked,
        nextAttack: id === 'power' && canIncrease ? unitAttack({ ...leader, attack: leader.attack + POWER_ATTACK_BONUS }, faction, home) : attack,
        nextDefense: id === 'guard' && canIncrease ? unitDefense({ ...leader, defense: leader.defense + GUARD_DEFENSE_BONUS }, faction, home) : defense,
        nextMaxHp: unitMaxHp(leader), nextRetinueBonus: retinueBonus + (id === 'command' && canIncrease ? 1 : 0) };
    }) };
}

/** Skill points buy one rank atomically; equipment and veterancy still apply normally. */
export function learnLeaderSkill(state: GameState, skill: LeaderSkillId, factionId = playerFaction(state)): { ok: boolean; message: string } {
  if (!validSkill(skill)) return { ok: false, message: 'Unknown Leader skill.' };
  const leader = indexedLeader(state, factionId), reason = unavailableReason(state, leader, factionId);
  if (reason || !leader) return { ok: false, message: reason };
  const current = readLeaderProgression(leader);
  const pointer = rustEngine.progression_learn(LEADER_SKILL_IDS.indexOf(skill), current.skills[skill] ?? 0,
    current.skillPoints, leader.attack, leader.defense,
    Number(leaderSkillUnlocked(state.factions.find(faction => faction.id === factionId), skill)));
  const result = new Float64Array(rustEngine.memory.buffer, pointer, 5);
  if (result[0]) {
    const branch = LEADER_SKILL_TECH[skill], technology = RESEARCH_BRANCHES.find(tech => tech.id === branch)?.label;
    return { ok: false, message: ['',`Research ${technology ?? 'this skill’s prerequisite technology'} first.`, `${skillName[skill]} is at maximum rank.`,
      'Earn another Leader level to gain a skill point.', 'Choose a valid Leader skill.'][result[0]] ?? 'The skill could not be learned. Reopen the Leader panel and try again.' };
  }
  const progress = leader.leaderProgression ??= initialLeaderProgression();
  progress.skills[skill] = result[1]; progress.skillPoints = result[2];
  leader.attack = result[3]; leader.defense = result[4];
  return { ok: true, message: `${skillName[skill]} rank ${progress.skills[skill]} learned.` };
}
