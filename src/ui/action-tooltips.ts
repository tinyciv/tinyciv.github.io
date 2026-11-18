import { BUILDING_UPKEEP, SETTLEMENT_MAINTENANCE, WATCHTOWER_MAINTENANCE, type townBuildTerms } from '../game/maintenance';
import { ECONOMY_INTERVAL } from '../game/economy-constants';
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
  camp: 'Grows grain that peasants carry to the town or its granary.',
  granary: 'Peasants collect grain from here, extending this city’s farming area. +25% food from friendly farms within 6 tiles. One per city; bonuses do not stack.',
  militaryAcademy: 'Choose your army’s formation.',
  foundry: 'Equips field cannon. Upkeep: 200 gold / 30s.',
  thermalBath: 'Build over a mud pool. Adds 30% house capacity to the nearest friendly town, rounded to whole residents. Does not stack.',
  house: 'Adds housing so this city can grow.',
  apartments: 'Dense housing for a growing city.',
  hospital: 'Heals friendly people nearby.',
  factory: 'Increases your realm’s gold output.',
  goldMine: 'Control with troops to earn a share of world gold output.',
  palisade: 'A wooden barrier that blocks enemies; roads make gates.',
  wall: 'A strong stone barrier; replacing a palisade credits its cost.',
  tower: 'Fires at nearby enemy units and buildings; benefits from supporting stone walls.',
  woodenTower: 'Fires at nearby enemy units and buildings; benefits from supporting stone walls.',
  guardPost: 'Protects nearby people; reduces loyalty loss from threats.',
  fort: 'Claims nearby unowned land and fires at enemy units and buildings.',
  supplyDepot: 'Sends healing supplies to the Leader and nearby troops.',
  ballista: 'Slowly fires long-range bolts, prioritizing enemy buildings before units.',
  siegeCannon: 'Fixed rotating cannon: 5× ballista damage; 50% splash to all units and buildings within 2 tiles, including friendlies.',
  observationPost: 'Posts a concealed scout with extended sight on neutral land.',
  well: 'Upgrades nearby homes to level two housing.',
  monument: 'Expands borders with culture and adds 12 loyalty; one loyalty bonus per city.',
  blacksmith: 'Improves army weapons and armor and controls spearmen recruitment.',
  archeryRange: 'Sets the proportion of your retinue trained as archers.',
  scoutLodge: 'Trains retinue scouts and unlocks observation posts.',
  healerShack: 'Triples healing for friendly units nearby.',
  stable: 'Trains a chosen proportion of the retinue as mounted troops.',
  library: 'Directs gold income into research and sets technology priorities.',
  forum: 'Spend culture on permanent achievements for your faction. Approach within three tiles of the completed forum to open its achievement tree.',
  colosseum: 'Public games: doubles population growth across your realm and triples culture within 5 tiles, fading to normal by 25 tiles. Needs a town of 200 people. Does not stack.',
  barracks: 'Trains pikemen and, after Gunpowder, musketmen. Musters every new recruit for its town. Sets your army composition.',
  palace: 'Founds a city with its own borders, housing, food and governor.',
  whalingPost: 'Launches one whaling ship with a 300-tile range. Needs a 2×2 shore site. Each whale delivery earns 250 gold and refreshes +5% movement for all your ships and units for 60 seconds.',
  shipyard: 'Requires a city of 100 people. Builds and repairs warships.',
  dock: 'Supports one fishing vessel carrying up to 20 food per trip; overfishing can permanently collapse the shared fishery. Provides a boat for the Leader. Receives trade ships from neutral village docks over connected water, with no distance limit. Deliveries earn 0.05 gold per water-route tile, or 0.4 gold with trade ties (8×). Paid on arrival; the return journey earns nothing.',
};

export function actionTooltip(description: string, cost: string | number = 0, cooldown = 0, extra = ''): string {
  return `${description}\nCost: ${typeof cost === 'number' ? `${Math.round(cost)} gold` : cost} · Cooldown: ${cooldown ? `${Math.ceil(cooldown)}s` : 'None'}${extra ? `\n${extra}` : ''}`;
}
type TownBuildTerms = ReturnType<typeof townBuildTerms>;

export function townBuildDetails({ upkeep, residents }: TownBuildTerms): string {
  return `${upkeep} gold / ${ECONOMY_INTERVAL}s upkeep${residents ? ` · ${residents} residents in your first new town` : ''}`;
}

export function buildTooltip(kind: Exclude<BuildSelection, 'clearTrees'>, gold: number, seconds: number, upkeepMultiplier = 1, town?: TownBuildTerms): string {
  const perTile = ['road', 'bridge', 'wall', 'palisade', 'irrigation', 'camp'].includes(kind) ? ' / tile' : '';
  const cost = `${Math.round(gold)} gold${perTile}${kind === 'observationPost' ? ' + 1 population' : ''}`;
  if (kind === 'palace' && town) return actionTooltip(BUILD_DESCRIPTIONS.palace, cost, 0, `Build time: ${Math.round(seconds)}s · ${townBuildDetails(town)}`);
  const upkeep = ({ palace: SETTLEMENT_MAINTENANCE, woodenTower: WATCHTOWER_MAINTENANCE, tower: WATCHTOWER_MAINTENANCE,
    guardPost: GUARD_POST_UPKEEP, fort: FORT_UPKEEP, observationPost: OBSERVATION_POST_UPKEEP, ...BUILDING_UPKEEP } as Partial<Record<BuildSelection, number>>)[kind];
  return actionTooltip(BUILD_DESCRIPTIONS[kind], cost, 0, `Build time: ${Math.round(seconds)}s${upkeep ? ` · Upkeep: ${Math.round(upkeep * upkeepMultiplier * 100) / 100} gold${perTile} / 30s${kind === 'palace' ? ', rising with each town' : ''}` : ''}`);
}
