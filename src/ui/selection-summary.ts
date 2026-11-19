import { SHIP_LABELS, shipRank } from '../game/warships-native';
import { leaderAttackAura } from '../game/leader-aura';
import { AchievementEffect, achievementEffect } from '../game/achievement-effects';
import { culturalHomeGround } from '../game/cultural-territory';
import { FORT_GOLD } from '../game/forts';
import { fortName } from '../game/fort-names';
import { playerFaction } from '../game/player-context';
import { buildingReady, buildingWidth, buildingHeight, isFarmKind, isRetinueMember, unitMaxHp, type Building, type GameState, type Unit } from '../game/types';
import { entityVisible } from '../game/fog';
import { factionColor } from '../game/faction-colors';
import { attackDamage, hasUnpaidUpkeep, unitAttack, unitDamageTakenMultiplier, unitDefense, veterancy, VETERANCY_KILLS, VETERANCY_NAMES } from '../game/veterancy';
import { RETINUE_SQUAD_SIZE } from '../game/retinue-squads';
import { woodenTowerAttack, WOODEN_TOWER_RANGE } from '../game/tower-combat';
import { RAIDER_COLOR } from '../game/raider-camps';
import { nativeHouseTier } from '../game/puny-building-art';
import { houseLevel, WELL_RADIUS } from '../game/wells';
import { FOUNTAIN_RADIUS } from '../game/structure-index';
import { constructionProgress } from '../game/construction-cancellation';
import { constructionHead } from '../game/bridge-construction';
import { IRRIGATION_RADIUS } from '../game/irrigation';
import { MONUMENT_CULTURE_PER_SECOND } from '../game/culture';
import { guardPostCapacity, guardPostUpkeep, GUARD_POST_UPKEEP_INTERVAL } from '../game/guard-posts';
import { buildingMaintenance } from '../game/maintenance';
import { cityOwnership } from '../game/city-ownership';
import { fieldCannonUpkeep } from '../game/field-cannons-native';
import { FIELD_CANNON_UPKEEP } from '../game/field-cannon-config';
import { cityHasDevelopedPeat, peatUpkeepMultiplier } from '../game/resource-development';
import { ECONOMY_INTERVAL } from '../game/economy-constants';
import { equipmentMultiplier } from '../game/equipment';
import { citySpecialties } from '../game/regional-economy';
import { RESOURCE_NAMES } from '../game/geography';
import { isHouseEnclosed } from '../game/enclosures';
import { buildLabel, buildMenuForSelection } from './build-controls';
import { isKeep, settlementLabel } from '../game/settlement-upgrades';
import { buildingArmor, isDefensiveBuilding } from '../game/defense-equipment';
import { HEALER_SHACK_RADIUS, HEALER_SHACK_MULTIPLIER } from '../game/healer-shack';
import { multiplierPercent, wholeNumber } from './number-format';
import { cityGranary, granaryCity, granaryYieldMultiplier, GRANARY_RADIUS } from '../game/granaries-native';
import { thermalBathCity, thermalBathCityMultiplier } from '../game/thermal-baths-native';
import { WHALING_RANGE } from '../game/fishing';

/** Unformatted values let the compact HUD choose its own precision and markup. */
export interface SelectionSummary {
  name: string;
  picture: string;
  factionColor: string;
  houseTier?: number;
  armorLevel?: number;
  hp: number;
  maxHp: number;
  showHealth: boolean;
  showCombatStats: boolean;
  attack: number;
  defense: number;
  title: string;
  hint?: string;
}

function unitSummary(state: GameState, unit: Unit): SelectionSummary {
  let name = unit.kind === 'fieldCannon' ? 'Field cannon' : unit.marauderLeader ? 'Marauder Leader' : unit.name ?? unit.kind[0].toUpperCase() + unit.kind.slice(1);
  let picture = unit.kind === 'leader' ? 'crown' : ['fieldCannon', 'archer', 'horseman', 'horseArcher', 'knight', 'spearman', 'pikeman', 'musketman', 'scout', 'warrior', 'swordsman', 'militia', 'boar', 'marshBird', 'merchant'].includes(unit.kind) ? unit.kind : 'worker';
  if (unit.marauderPack !== undefined) picture = unit.marauderLeader ? 'crown' : unit.kind === 'archer' ? 'archer' : 'marauder';
  if (unit.ranger) name = 'Ranger';
  if (unit.kind === 'horseArcher') name = 'Horse Archer';
  if (unit.kind === 'slinger') { name = 'Slinger'; picture = 'slinger'; }
  if (unit.kind === 'levyInfantry') { name = 'Levy Infantry'; picture = 'levyInfantry'; }
  if (unit.kind === 'skirmisher') { name = 'Skirmisher'; picture = 'skirmisher'; }
  if (unit.kind === 'supplyCart') { name = 'Supply cart'; picture = 'supplyCart'; }
  if (unit.collector) name = 'Farm courier';
  if (unit.kind === 'boar') name = 'Wild boar';
  if (unit.kind === 'marshBird') name = 'Marsh bird';
  if (unit.builder) name = 'Builder';
  if (unit.kind === 'sailboat') { name = unit.barbarianGalley ? unit.sailboat?.passenger!==undefined?'Barbarian galley · Archer aboard':'Barbarian galley'
    : unit.sailboat?.passenger !== undefined ? 'Galley · Leader aboard' : 'Galley'; picture = 'sailboat'; }
  if (unit.warship) { name = `${unit.warship.name} · ${SHIP_LABELS[unit.warship.class]}`; picture = unit.warship.class; }
  const details = [name, `Speed ${wholeNumber(unit.speed)}`, `Range ${wholeNumber(unit.range)}`, `Morale ${wholeNumber(unit.morale)}`];
  if (unit.warship) details.push(shipRank(unit), `${unit.warship.kills} ships sunk`, `${Math.ceil(unit.warship.crewHp / 100)}/8 marines`, unit.warship.anchored ? 'Anchored' : 'Underway', '50 gold / 30s', ...(!unit.warship.funded ? ['Unpaid upkeep · Reduced speed and weapons offline'] : []));
  if (unit.kind === 'slinger') details.push('Stone projectiles', '80 maximum morale', '5 gold every 30s', 'Dismisses when gold runs out');
  if (unit.kind === 'levyInfantry') details.push('Half warrior attack and defense', '80 maximum morale', '5 gold every 30s', 'Dismisses when gold runs out');
  if (unit.kind === 'skirmisher') details.push('Fort patrol', 'Throws javelins and evades approaching enemies');
  if (unit.kind === 'supplyCart') details.push('Heals the Leader and friendly units within 8 tiles by up to 10 HP', 'No population or kill reward');
  if (unit.ranger) details.push('+50% range · +25% speed · +25% flee radius', 'Permanent companion · no upkeep · cannot retrain');
  if (unit.kind === 'horseArcher') details.push('Fast mounted archer', 'Light armor · Retreats from melee');
  if (unit.kind === 'knight') details.push('Heavy armor · Powerful melee attack', 'Running charge · Area damage', '2 gold every 30s');
  if (unit.kind === 'horseman') details.push('65% faster · 50% greater base attack', 'Running charge · Area damage');
  if (unit.kind === 'swordsman') details.push('Twice spearman base attack', 'Lower defense than spearmen');
  if (unit.kind === 'spearman') details.push('50% greater base defense', 'Thrusts pierce up to two additional enemies');
  if (unit.kind === 'fieldCannon') details.push('Half infantry speed · Off-road speed 20%', 'Range 18 · Siege cannon damage · Splash 2 tiles, including friendlies',
    `Upkeep ${wholeNumber(fieldCannonUpkeep(state, unit))} gold / 30s`, ...(hasUnpaidUpkeep(unit) ? ['Unpaid upkeep · Half attack and defense'] : []));
  if (unit.kind === 'musketman') details.push('Heavy musket volleys · one shot every 2.5 seconds', 'Upkeep: 2 gold / 30s · no Fletching bonus');
  if (unit.kind === 'pikeman') details.push('Spearman attack, 50% more defense and 25% more reach', 'Thrusts pierce up to two enemies behind and knock them back');
  if (unit.kind === 'scout') details.push('Automatically maps unexplored land', 'Avoids combat', 'Independent of the retinue');
  if (unit.kind === 'marshBird') details.push('Hunt: +20 food', 'Stays in marshes; crosses water');
  if (unit.kind === 'leader' || unit.kind === 'militia' || isRetinueMember(unit)) {
    const rank = veterancy(unit), nextRank = VETERANCY_KILLS.at(rank);
    const squad = state.retinueSquads?.find(squad => squad.id === unit.retinueSquad && squad.faction === unit.faction);
    details.push(VETERANCY_NAMES[rank], `${unit.kills ?? 0} ${squad ? 'squad ' : unit.kind === 'militia' ? 'guard post ' : ''}kills`);
    if (nextRank !== undefined) details.push(`${VETERANCY_NAMES[rank + 1]} at ${nextRank}`);
    if (squad) {
      const members = state.units.filter(other => other.retinueSquad === squad.id && other.faction === unit.faction && other.hp > 0).length;
      details.push(`Squad ${squad.id}: ${members}/${RETINUE_SQUAD_SIZE}`);
    }
    const resistance = Math.round((1 - unitDamageTakenMultiplier(unit)) * 100);
    if (resistance) details.push(`${resistance}% less damage taken after armor`);
  }
  if (unit.drainageWork) details.push(unit.buildPhase === 'working'
    ? `Draining freshwater · ${Math.floor(unit.drainageWork.progress)}/8s` : 'Traveling to drainage site');
  else if (unit.builder) details.push(unit.buildPhase === 'clearing' ? 'Clearing trees' : unit.buildPhase === 'repairing' ? 'Repairing'
    : unit.buildPhase === 'working' ? 'Building' : unit.buildPhase === 'outbound' ? 'On the way' : unit.inside ? 'Idle' : 'Returning');
  if (unit.collector) details.push(`Carrying ${wholeNumber(unit.cargo ?? 0)} food`);
  if (unit.kind === 'merchant') {
    const route = state.tradeRoutes?.find(route => route.merchantId === unit.id);
    if (route) {
      const target = state.buildings.find(building => building.id === route.target);
      const destination = target?.cityName ?? state.villages?.find(village => village.campId === target?.id)?.name ?? 'city';
      details.push(`To ${destination}`, `${Math.round(route.distance)} tiles`);
    }
  }
  if (unit.technologyBonus) details.push(`Technology bonus: +${Math.round(unit.technologyBonus.attack)} Attack, +${Math.round(unit.technologyBonus.defense)} Defense`);
  if (unit.raiderBonus) details.push(`Raider bonus: +${Math.round(unit.raiderBonus.attack)} Attack, +${Math.round(unit.raiderBonus.defense)} Defense`);
  if (unit.kind === 'militia') details.push(unit.wallPatrol?.wall !== undefined ? 'Wall patrol · Javelins' : unit.target !== undefined ? 'Defending city' : 'Returning to guard post');
  const faction = state.factions.find(faction => faction.id === unit.faction), home = culturalHomeGround(state, faction, unit);
  return {
    name, picture, factionColor: factionColor(state, unit.faction, state.marauderPacks?.find(pack => pack.id === unit.marauderPack)?.color ?? '#b6a77e'),
    armorLevel: unit.armorLevel ?? 0, hp: unit.hp, maxHp: unitMaxHp(unit), showHealth: true,
    showCombatStats: unit.kind !== 'sailboat', attack: unitAttack(unit, faction, home) * leaderAttackAura(state, unit), defense: unitDefense(unit, faction, home), title: details.join(' · '),
    hint: unit.warship ? undefined : unit.kind === 'sailboat' && unit.faction === playerFaction(state) ? unit.sailboat?.passenger !== undefined
      ? 'W/S thrust · A/D strafe · Q/E turn · Right-click shore: land.' : 'Right-click this boat to board with the Leader.' : undefined,
  };
}

function buildingSummary(state: GameState, building: Building): SelectionSummary {
  const ready = buildingReady(building);
  const owner = state.factions.find(faction => faction.id === building.faction);
  const gate = ready && (building.kind === 'wall' || building.kind === 'palisade')
    && state.buildings.some(other => other.kind === 'road' && other.hp > 0 && other.x === building.x && other.y === building.y);
  let name = gate ? 'Gate' : building.kind === 'villageTent'
    ? state.villages?.some(village => village.campId === building.id) ? 'Village main tent' : 'Tent' : buildLabel(building.kind);
  if (building.kind === 'road' && building.roadStyle === 'trail') name = 'Dirt trail';
  if (building.kind === 'road' && building.roadPaved) name = 'Paved road';
  if (building.kind === 'house') name = `House · Level ${houseLevel(building)}`;
  if (building.kind === 'palace') name = settlementLabel(building);
  if (isFarmKind(building.kind) && building.farmFallow) name += ' · Fallow';
  if (building.kind === 'fort') name = `${fortName(building)} · Level ${building.fortLevel ?? 1}${building.fort?.destroyed ? ' · Foundation' : ''}`;
  const details = [name];
  if (building.kind === 'scoutTower' && ready) details.push('Extends sight');
  if (building.kind === 'goldMine') {
    details.push(owner?.name ?? 'Neutral');
    if (building.mineContested) details.push('Contested');
    if ((building.mineCaptureFaction ?? -1) >= 0) {
      const challenger = state.factions.find(faction => faction.id === building.mineCaptureFaction);
      details.push(`${challenger?.name ?? 'Claim'} ${Math.floor((building.mineCaptureProgress ?? 0) / 12 * 100)}%`);
    }
  }
  if (building.kind === 'hospital') details.push('Heals friendly people nearby');
  if (building.kind === 'factory') details.push('Increases your realm’s gold output');
  if (ready && building.kind === 'road' && building.roadPaved) details.push('25% faster than dirt roads');
  if (building.kind === 'fort') details.push(building.fort?.destroyed ? `Rebuild for ${wholeNumber((building.fort.initialGold ?? FORT_GOLD) / 2)} gold` : 'Fires at two targets · Expands borders', '20 gold every 30s');
  if (building.kind === 'supplyDepot') details.push('Sends one supply cart every 30s', 'Heals the Leader and friendly units within 8 tiles by up to 10 HP');
  if (building.cityName) details.push(building.cityName);
  if (building.capacity) {
    const residents = building.kind === 'palace' ? building.unhousedResidents : building.residents;
    details.push(`Residents ${residents ?? 0}/${building.capacity}`);
  }
  if (building.construction) {
    const head = constructionHead(state, building), work = head.construction!, progress = constructionProgress(state, head);
    details.push(`Construction ${Math.floor(progress * 100)}%`);
    details.push(work.waitingForBuilder ? work.builderId === undefined ? 'Awaiting builder' : 'Builder en route'
      : `${Math.max(0, Math.ceil(work.duration * (1 - progress)))}s remaining`);
  } else {
    if (building.faction >= 0 && building.villageId === undefined && ['palace', 'tower', 'woodenTower', 'granary'].includes(building.kind)) {
      const upkeep = buildingMaintenance(state, building);
      if (upkeep) details.push(`Upkeep ${wholeNumber(upkeep)} gold every ${ECONOMY_INTERVAL}s`);
      else if (building.kind === 'palace') details.push('Capital: administration exempt');
    }
    if (building.kind === 'woodenTower' || building.kind === 'tower' || building.kind === 'fort' || isKeep(building)) details.push(`Range ${WOODEN_TOWER_RANGE}`);
    if (isKeep(building)) details.push('Immune to raider theft');
    if (isDefensiveBuilding(building)) {
      if (owner?.armorLevel) details.push(`Armor ${multiplierPercent(equipmentMultiplier(owner.armorLevel))}`);
      if ((building.kind === 'woodenTower' || building.kind === 'tower' || building.kind === 'fort' || isKeep(building)) && owner?.weaponLevel) details.push(`Weapons ${multiplierPercent(equipmentMultiplier(owner.weaponLevel))}`);
    }
    if (building.kind === 'well') details.push(`Level 2 housing within ${WELL_RADIUS} tiles`);
    if (building.kind === 'fountain') details.push(`Level 4 housing within ${FOUNTAIN_RADIUS} tiles`);
    if (building.kind === 'granary') {
      const city = granaryCity(state, building);
      if (city) details.push(city.cityName ?? 'City granary');
      if (city && cityGranary(state, city)?.id === building.id) {
        details.push('Farm couriers collect and deliver here', `Farm food +25% within ${GRANARY_RADIUS} tiles`, `${wholeNumber(building.foodDelivered ?? 0)} food delivered`);
      } else details.push(city ? 'Inactive: this city already has an operating granary' : 'Needs a completed city');
    }
    if (building.kind === 'militaryAcademy') details.push('Choose wide, standard or deep formation');
    if (building.kind === 'foundry') {
      const supplied = cityHasDevelopedPeat(state, cityOwnership(state).building(building));
      details.push(`Field cannon upkeep: ${wholeNumber(FIELD_CANNON_UPKEEP * peatUpkeepMultiplier(supplied))} gold / 30s`);
    }
    if (building.kind === 'thermalBath') {
      const town = thermalBathCity(state, building);
      if (town) details.push(town.cityName ?? 'Nearest town', buildingReady(building) ? 'House capacity +30% · Does not stack' : 'Housing bonus begins when construction finishes');
      else details.push('Needs a completed friendly town');
    }
    if (building.kind === 'palace' && thermalBathCityMultiplier(state, building) > 1) details.push('Thermal baths: house capacity +30%');
    if (isFarmKind(building.kind) && granaryYieldMultiplier(state, building.faction, building.x, building.y) > 1)
      details.push('Granary: +25% food');
    if (building.kind === 'whalingPost') details.push(`One whaling ship · Range ${WHALING_RANGE} tiles · 250 gold per delivery`, '+5% movement for your ships and units · 60s, refreshed by deliveries');
    if (building.kind === 'dock') {
      details.push('One fishing vessel · Up to 20 food per trip', 'Overfishing can permanently collapse a fishery');
      if (building.villageId === undefined) details.push('Launches one galley for the Leader', 'Right-click the boat to board');
      details.push('Village harbor trade · Connected water, unlimited range', '0.05 gold per water-route tile · Trade ties: 0.4 gold (8×)', 'Paid on delivery · Return journey earns nothing');
    }
    if (building.kind === 'ballista') details.push('Range 18 tiles · One shot every 4 seconds', 'Targets enemy buildings before units');
    if (building.kind === 'siegeCannon') details.push('Range 18 tiles · One shot every 4 seconds', '5× ballista damage · 50% splash within 2 tiles', 'Splash damages friendlies · Upkeep 100 gold / 30 seconds');
    if (building.kind === 'healerShack') details.push(`${HEALER_SHACK_MULTIPLIER}× friendly healing within ${HEALER_SHACK_RADIUS} tiles`, 'Own borders · Normal recovery delay · Does not stack');
    if (building.kind === 'irrigation') details.push(`Farmland yield: 2× on other land, 3× on desert within ${IRRIGATION_RADIUS} tiles`, 'Immune to enemy attacks');
    if (building.kind === 'monument') details.push(`+${wholeNumber(MONUMENT_CULTURE_PER_SECOND * 60)} culture/min`);
    if (building.kind === 'blacksmith') {
      const owner = state.factions.find(faction => faction.id === building.faction);
      details.push(`Armor ${multiplierPercent(equipmentMultiplier(owner?.armorLevel))}`, `Weapons ${multiplierPercent(equipmentMultiplier(owner?.weaponLevel))}`);
    }
    if (building.kind === 'guardPost' && building.villageId === undefined) {
      const guards = state.units.filter(unit => unit.kind === 'militia' && unit.guardPost === building.id && unit.hp > 0);
      details.push(`Militia ${guards.length}/${guardPostCapacity(building)}`, `${guardPostUpkeep(building)} gold every ${GUARD_POST_UPKEEP_INTERVAL}s`);
      if (building.guardPost?.funded === false) details.push('Awaiting upkeep payment');
      else if (!building.guardPost) details.push('Awaiting city');
    }
    if (building.kind === 'house') {
      if (isHouseEnclosed(state, building)) details.push('Enclosed town: growth +30%');
      if (building.redevelopedFarm) details.push('Farm relocation: +1 housing capacity');
    }
    if (isFarmKind(building.kind) && building.farmFallow) details.push('Visit with an owning unit to restart cultivation');
    if (building.kind === 'palace' && building.faction === playerFaction(state)) {
      const specialties = citySpecialties(state.world, building, state);
      if (specialties.length) details.push(`Local specialties: ${specialties.map(resource => RESOURCE_NAMES[resource]).join(', ')}`);
    }
  }
  return {
    name, picture: gate ? 'wallGate' : isKeep(building) ? 'keep' : building.kind === 'road' && building.roadStyle === 'trail' ? 'trail' : building.kind,
    factionColor: factionColor(state, building.faction, building.faction === -2 ? RAIDER_COLOR : '#b6a77e'),
    houseTier: building.kind === 'house' ? nativeHouseTier(building) : undefined,
    hp: building.hp, maxHp: building.maxHp,
    showHealth: !isFarmKind(building.kind) && !['road', 'bridge', 'irrigation'].includes(building.kind) && !building.fort?.destroyed,
    showCombatStats: buildMenuForSelection(building.kind) === 'fortifications' || isKeep(building),
    attack: ready && (building.kind === 'woodenTower' || building.kind === 'tower' || building.kind === 'fort' || isKeep(building))
      ? attackDamage(woodenTowerAttack(building, owner), 0) * achievementEffect(owner, AchievementEffect.homelandDamage, 1,
        Number(culturalHomeGround(state, owner, { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 }))) : 0,
    defense: buildingArmor(building, owner), title: details.join(' · '),
    hint: ready && building.kind === 'dock' && building.faction === playerFaction(state)
      ? building.dockBoatLaunched ? 'Right-click your galley to board.' : 'Waiting for a clear water berth to launch.' : undefined,
  };
}

/** Hidden, dead, missing, or garrisoned entities must not leak into the HUD. */
export function selectionSummary(state: GameState): SelectionSummary | undefined {
  if (state.selectedType === 'unit') {
    let unit = state.units.find(unit => unit.id === state.selected);
    if (unit?.embarkedOn !== undefined && unit.faction === playerFaction(state))
      unit = state.units.find(boat => boat.id === unit!.embarkedOn && boat.kind === 'sailboat');
    return unit && unit.hp > 0 && entityVisible(state, unit) ? unitSummary(state, unit) : undefined;
  }
  if (state.selectedType === 'building') {
    const building = state.buildings.find(building => building.id === state.selected);
    return building && (building.hp > 0 || building.kind === 'fort' && building.fort?.destroyed) && entityVisible(state, building) ? buildingSummary(state, building) : undefined;
  }
  return undefined;
}
