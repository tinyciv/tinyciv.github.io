import { SETTLEMENT_MAINTENANCE, WATCHTOWER_MAINTENANCE } from '../game/maintenance';
import { GUARD_POST_UPKEEP } from '../game/guard-posts';
import { FORT_UPKEEP } from '../game/forts';
import { OBSERVATION_POST_UPKEEP } from '../game/observation-posts';
import type { BuildSelection } from '../game/types';

export const BUILD_DESCRIPTIONS: Record<Exclude<BuildSelection, 'clearTrees'>, string> = {
  shack: 'Grows food for the city.',
  cottage: 'Grows food for the city.',
  ruin: 'Remains of a destroyed building.',
  villageTent: 'Houses members of a neutral village.',
  road: 'Speeds travel and makes gates through friendly walls.',
  bridge: 'Crosses water between two banks; Engineering extends the maximum span.',
  irrigation: 'Increases nearby farm yields, with a larger benefit in deserts.',
  camp: 'Grows grain that peasants carry back to the settlement.',
  house: 'Adds housing so this city can grow.',
  palisade: 'A wooden barrier that blocks enemies; roads make gates.',
  wall: 'A strong stone barrier; replacing a palisade credits its cost.',
  tower: 'Fires at nearby enemies and benefits from supporting stone walls.',
  woodenTower: 'Fires at nearby enemies and benefits from supporting stone walls.',
  guardPost: 'Recruits guards to defend this city and adds 3 loyalty.',
  fort: 'Claims nearby unowned land and fires at approaching enemies.',
  supplyDepot: 'Sends healing supplies to the Leader and nearby troops.',
  ballista: 'Slowly fires long-range bolts, prioritizing enemy fortifications.',
  observationPost: 'Posts a concealed scout with extended sight on neutral land.',
  well: 'Upgrades nearby homes to level two housing.',
  monument: 'Expands borders with culture and adds 12 loyalty; one loyalty bonus per city.',
  blacksmith: 'Improves army weapons and armor and controls spearmen recruitment.',
  archeryRange: 'Sets the proportion of your retinue trained as archers.',
  scoutLodge: 'Trains retinue scouts and unlocks observation posts.',
  healerShack: 'Triples healing for friendly units nearby.',
  stable: 'Trains a chosen proportion of the retinue as mounted troops.',
  library: 'Directs gold income into research and sets technology priorities.',
  palace: 'Founds a city with its own borders, housing, food and governor.',
  dock: 'Launches fishing boats and provides a boat for the Leader.',
};

export function actionTooltip(description: string, cost: string | number = 0, cooldown = 0, extra = ''): string {
  return `${description}\nCost: ${typeof cost === 'number' ? `${Math.round(cost)} gold` : cost} · Cooldown: ${cooldown ? `${Math.ceil(cooldown)}s` : 'None'}${extra ? `\n${extra}` : ''}`;
}
export function buildTooltip(kind: Exclude<BuildSelection, 'clearTrees'>, gold: number, seconds: number): string {
  const perTile = ['road', 'bridge', 'wall', 'palisade', 'irrigation', 'camp'].includes(kind) ? ' / tile' : '';
  const cost = `${Math.round(gold)} gold${perTile}${kind === 'observationPost' ? ' + 1 population' : ''}`;
  const upkeep = ({ palace: SETTLEMENT_MAINTENANCE, woodenTower: WATCHTOWER_MAINTENANCE, tower: WATCHTOWER_MAINTENANCE,
    guardPost: GUARD_POST_UPKEEP, fort: FORT_UPKEEP, observationPost: OBSERVATION_POST_UPKEEP } as Partial<Record<BuildSelection, number>>)[kind];
  return actionTooltip(BUILD_DESCRIPTIONS[kind], cost, 0, `Build time: ${Math.round(seconds)}s${upkeep ? ` · Upkeep: ${Math.round(upkeep)} gold / 30s` : ''}`);
}
