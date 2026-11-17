import { rustEngine } from './rust-engine';
import { simCore } from './sim-handle';
import { BUILDING_KIND_CODES, entityStore } from './entity-store';
import { playerFaction } from './player-context';
import { updateConstructionResearch } from './structures';
import type { Building, GameState, Faction } from './types';

export type AchievementId = 'superstition' | 'huntingLegend' | 'creationStory' | 'ancestorWorship' | 'storytelling' | 'heroism' | 'redemptionArc'
  | 'householdTradition' | 'customaryLaw' | 'oathsOfService' | 'inheritedCraft' | 'secureProperty' | 'codeOfHonor'
  | 'guildCharters' | 'localLiberties' | 'citizenMilitia' | 'stewardshipOfTheLand' | 'livingTradition' | 'defenseOfTheHomeland';
const content: readonly { id: AchievementId; label: string; description: string; icon: string; column: number; row: number }[] = [
  { id: 'superstition', label: 'Superstition', description: 'Reassuring rituals: morale recovers 20% faster when no enemies are nearby.', icon: 'monument', column: 0, row: 0 },
  { id: 'huntingLegend', label: 'Hunting legend', description: 'Nothing wasted: every hunted animal provides 25 additional food.', icon: 'archeryRange', column: 1, row: 2 },
  { id: 'creationStory', label: 'Creation story', description: 'A shared beginning: completed towns produce 20% more culture.', icon: 'urbanPlanning', column: 1, row: 0 },
  { id: 'ancestorWorship', label: 'Ancestor worship', description: 'Familiar ground: passive healing within your borders is 40% faster, after the normal recovery delay.', icon: 'monument', column: 2, row: 0 },
  { id: 'storytelling', label: 'Storytelling', description: 'Memorable lessons: libraries turn each gold allocated to research into 20% more Science.', icon: 'culture', column: 0, row: 2 },
  { id: 'heroism', label: 'Heroism', description: 'Courage by example: positive morale recovery near the Leader is 20% faster while enemies are nearby.', icon: 'reinforcedDefenses', column: 2, row: 2 },
  { id: 'redemptionArc', label: 'Redemption Arc', description: 'A chance to return: positive morale recovery is 80% faster while routing. Normal rally requirements still apply.', icon: 'woodenTower', column: 3, row: 1 },
  { id: 'householdTradition', label: 'Household Tradition', description: '+25% population growth. Food and housing are still required.', icon: 'urbanPlanning', column: 4, row: 0 },
  { id: 'customaryLaw', label: 'Customary Law', description: '+4 loyalty target in owned towns.', icon: 'culture', column: 4, row: 1 },
  { id: 'oathsOfService', label: 'Oaths of Service', description: '+25% positive morale recovery for soldiers within your borders.', icon: 'reinforcedDefenses', column: 4, row: 2 },
  { id: 'inheritedCraft', label: 'Inherited Craft', description: '+35% construction and repair speed.', icon: 'metalTools', column: 5, row: 0 },
  { id: 'secureProperty', label: 'Secure Property', description: '+35% town tax income.', icon: 'coinage', column: 5, row: 1 },
  { id: 'codeOfHonor', label: 'Code of Honor', description: '+35% defense for the Leader and retinue within your borders.', icon: 'reinforcedDefenses', column: 5, row: 2 },
  { id: 'guildCharters', label: 'Guild Charters', description: '+50% gold from domestic trade deliveries.', icon: 'coinage', column: 6, row: 0 },
  { id: 'localLiberties', label: 'Local Liberties', description: '50% less loyalty penalty from military threats in owned towns.', icon: 'urbanPlanning', column: 6, row: 1 },
  { id: 'citizenMilitia', label: 'Citizen Militia', description: '+50% militia attack and defense.', icon: 'blacksmith', column: 6, row: 2 },
  { id: 'stewardshipOfTheLand', label: 'Stewardship of the Land', description: '+65% food yield from established orchards.', icon: 'irrigation', column: 7, row: 0 },
  { id: 'livingTradition', label: 'Living Tradition', description: '+65% culture from towns and monuments.', icon: 'monument', column: 7, row: 1 },
  { id: 'defenseOfTheHomeland', label: 'Defense of the Homeland', description: '+65% damage from towers, guard posts, and town defenses within your borders.', icon: 'woodenTower', column: 7, row: 2 },
];
export const ACHIEVEMENTS = content.map((item, index) => ({ ...item, index, cost: rustEngine.achievement_cost(index),
  prerequisites: content.filter((_, p) => rustEngine.achievement_prerequisites(index) & (1 << p)).map(prerequisite => prerequisite.id) }));
export const achievementDefinition = (id: AchievementId) => ACHIEVEMENTS.find(item => item.id === id)!;
export const achievementIconUrl = (id: AchievementId): string => {
  const glyph = achievementDefinition(id).icon;
  return `${import.meta.env.BASE_URL}assets/runtime/ui/${glyph === 'culture' ? 'resources/culture.webp' : `research/forged/${glyph}.webp`}`;
};
export function achievementStatus(faction: Faction | undefined, id: AchievementId): number {
  return rustEngine.achievement_status(faction?.achievements ?? 0, faction?.culture ?? 0, achievementDefinition(id).index);
}

/** One native command validates the live forum, reach, tech, prerequisites,
 * duplicate ownership and balance, then atomically publishes the account. */
export function purchaseAchievement(state: GameState, building: Building, id: AchievementId): { ok: boolean; message: string } {
  const definition = ACHIEVEMENTS.find(item => item.id === id);
  if (!definition) return { ok: false, message: 'Choose an achievement.' };
  const faction = state.factions.find(item => item.id === playerFaction(state));
  const store = entityStore(state), leader = store.units.query('leader').find(unit => unit.faction === faction?.id && unit.hp > 0);
  const handle = simCore(state).handle, pointer = rustEngine.sim_achievement_input(handle);
  new Float64Array(rustEngine.memory.buffer, pointer, 20).set([
    faction?.culture ?? 0, faction?.cultureSpent ?? 0, faction?.achievements ?? 0, faction?.id ?? -1,
    building.faction, BUILDING_KIND_CODES[building.kind], building.hp, Number(!!building.construction),
    leader?.hp ?? 0, leader?.faction ?? -1, leader?.x ?? NaN, leader?.y ?? NaN, building.x, building.y,
    faction?.research?.levels.culturalIdentity ?? 0, Number(state.gameOver), Number(!faction || !!faction.defeated),
    Number(store.buildings.get(building.id) === building), Number(!!leader?.inside), Number(leader?.embarkedOn !== undefined),
  ]);
  const result = new Float64Array(rustEngine.memory.buffer, rustEngine.sim_achievement_purchase(handle, definition.index), 4).slice();
  if (result[0]) return { ok: false, message: [ '', 'This achievement is already purchased.', 'Purchase the prerequisite achievements first.',
    `Need ${definition.cost} culture.`, 'Choose an achievement.', 'Move your Leader within 3 tiles of your completed forum.', 'Research Cultural Identity first.' ][result[0]] ?? 'Achievement unavailable.' };
  faction!.culture = result[1]; faction!.cultureSpent = result[2]; faction!.achievements = result[3];
  if (id === 'inheritedCraft') updateConstructionResearch(state, true);
  return { ok: true, message: `Achievement purchased: ${definition.label}. ${definition.description}` };
}
