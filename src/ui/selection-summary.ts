import { FORT_GOLD } from '../game/forts';
import { playerFaction } from '../game/player-context';
import { buildingReady, isFarmKind, isRetinueMember, unitMaxHp, type Building, type GameState, type Unit } from '../game/types';
import { entityVisible } from '../game/fog';
import { factionColor } from '../game/faction-colors';
import { attackDamage, unitAttack, unitDamageTakenMultiplier, unitDefense, veterancy, VETERANCY_KILLS, VETERANCY_NAMES } from '../game/veterancy';
import { RETINUE_SQUAD_SIZE } from '../game/retinue-squads';
import { woodenTowerAttack, WOODEN_TOWER_RANGE } from '../game/tower-combat';
import { RAIDER_COLOR } from '../game/raider-camps';
import { nativeHouseTier } from '../game/puny-building-art';
import { houseLevel, WELL_RADIUS } from '../game/wells';
import { constructionProgress } from '../game/construction-cancellation';
import { IRRIGATION_RADIUS } from '../game/irrigation';
import { MONUMENT_CULTURE_PER_SECOND } from '../game/culture';
import { guardPostCapacity, guardPostUpkeep, GUARD_POST_UPKEEP_INTERVAL } from '../game/guard-posts';
import { buildingMaintenance } from '../game/maintenance';
import { ECONOMY_INTERVAL } from '../game/economy-constants';
import { equipmentMultiplier } from '../game/equipment';
import { citySpecialties } from '../game/regional-economy';
import { RESOURCE_NAMES } from '../game/geography';
import { isHouseEnclosed } from '../game/enclosures';
import { buildLabel, buildMenuForSelection } from './build-controls';
import { isKeep, settlementLabel } from '../game/settlement-upgrades';
import { buildingArmor, isDefensiveBuilding } from '../game/defense-equipment';
import { HEALER_SHACK_RADIUS, HEALER_SHACK_MULTIPLIER } from '../game/healer-shack';

/** Unformatted values let the compact HUD choose its own precision and markup. */
export interface SelectionSummary {
  name: string;
  picture: string;
  factionColor: string;
  houseTier?: number;
  armorLevel?: number;
  hp: number;
  maxHp: number;
  showCombatStats: boolean;
  attack: number;
  defense: number;
  title: string;
  hint?: string;
}

function unitSummary(state: GameState, unit: Unit): SelectionSummary {
  let name = unit.marauderLeader ? 'Marauder Leader' : unit.name ?? unit.kind[0].toUpperCase() + unit.kind.slice(1);
  let picture = unit.kind === 'leader' ? 'crown' : ['archer', 'horseman', 'spearman', 'scout', 'warrior', 'militia', 'boar', 'marshBird', 'merchant'].includes(unit.kind) ? unit.kind : 'worker';
  if (unit.marauderPack !== undefined) picture = unit.marauderLeader ? 'crown' : unit.kind === 'archer' ? 'archer' : 'marauder';
  if (unit.kind === 'levyInfantry') { name = 'Levy Infantry'; picture = 'levyInfantry'; }
  if (unit.kind === 'skirmisher') { name = 'Skirmisher'; picture = 'skirmisher'; }
  if (unit.kind === 'supplyCart') { name = 'Supply cart'; picture = 'supplyCart'; }
  if (unit.collector) name = 'Farm courier';
  if (unit.kind === 'boar') name = 'Wild boar';
  if (unit.kind === 'marshBird') name = 'Marsh bird';
  if (unit.builder) name = 'Builder';
  if (unit.kind === 'sailboat') { name = unit.sailboat?.passenger !== undefined ? 'Galley · Leader aboard' : 'Galley'; picture = 'sailboat'; }
  const details = [name, `Speed ${unit.speed.toFixed(2)}`, `Range ${unit.range}`, `Morale ${Math.ceil(unit.morale)}`];
  if (unit.kind === 'levyInfantry') details.push('Half warrior attack and defense', '80 maximum morale', '5 gold every 30s', 'Dismisses when gold runs out');
  if (unit.kind === 'skirmisher') details.push('Fort patrol', 'Throws javelins and evades approaching enemies');
  if (unit.kind === 'supplyCart') details.push('Delivers 10 HP healing to the Leader and all friendly units', 'No population or kill reward');
  if (unit.kind === 'horseman') details.push('65% faster · 50% greater base attack', 'Running charge · Area damage');
  if (unit.kind === 'spearman') details.push('50% greater base defense', 'Thrusts pierce up to two additional enemies');
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
  if (unit.builder) details.push(unit.buildPhase === 'clearing' ? 'Clearing trees' : unit.buildPhase === 'repairing' ? 'Repairing'
    : unit.buildPhase === 'working' ? 'Building' : unit.buildPhase === 'outbound' ? 'On the way' : unit.inside ? 'Idle' : 'Returning');
  if (unit.collector) details.push(`Carrying ${Number((unit.cargo ?? 0).toFixed(1))} food`);
  if (unit.kind === 'merchant') {
    const route = state.tradeRoutes?.find(route => route.merchantId === unit.id);
    if (route) {
      const target = state.buildings.find(building => building.id === route.target);
      const destination = target?.cityName ?? state.villages?.find(village => village.campId === target?.id)?.name ?? 'city';
      details.push(`To ${destination}`, `${Math.round(route.distance)} tiles`);
    }
  }
  if (unit.kind === 'militia') details.push(unit.target !== undefined ? 'Defending city' : 'Returning to guard post');
  return {
    name, picture, factionColor: factionColor(state, unit.faction, state.marauderPacks?.find(pack => pack.id === unit.marauderPack)?.color ?? '#b6a77e'),
    armorLevel: unit.armorLevel ?? 0, hp: unit.hp, maxHp: unitMaxHp(unit),
    showCombatStats: unit.kind !== 'sailboat', attack: unitAttack(unit, state.factions.find(faction => faction.id === unit.faction)), defense: unitDefense(unit), title: details.join(' · '),
    hint: unit.kind === 'sailboat' && unit.faction === playerFaction(state) ? unit.sailboat?.passenger !== undefined
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
  if (building.kind === 'house') name = `House · Level ${houseLevel(building)}`;
  if (building.kind === 'palace') name = settlementLabel(building);
  if (isFarmKind(building.kind) && building.farmFallow) name += ' · Fallow';
  if (building.kind === 'fort' && building.fort?.destroyed) name = 'Fort foundation';
  const details = [name];
  if (building.kind === 'fort') details.push(building.fort?.destroyed ? `Rebuild for ${(building.fort.initialGold ?? FORT_GOLD) / 2} gold` : 'Fires at two targets · Expands borders', '20 gold every 30s');
  if (building.kind === 'supplyDepot') details.push('Sends one supply cart every 30s', 'Each delivery heals the Leader and all units by up to 10 HP');
  if (building.cityName) details.push(building.cityName);
  if (building.capacity) details.push(`Residents ${building.residents ?? 0}/${building.capacity}`);
  if (building.construction) {
    const work = building.construction, progress = constructionProgress(state, building);
    details.push(`Construction ${Math.floor(progress * 100)}%`);
    details.push(work.waitingForBuilder ? work.builderId === undefined ? 'Awaiting builder' : 'Builder en route'
      : `${Math.max(0, Math.ceil(work.duration * (1 - progress)))}s remaining`);
  } else {
    if (building.faction >= 0 && building.villageId === undefined && ['palace', 'tower', 'woodenTower'].includes(building.kind)) {
      const upkeep = buildingMaintenance(state, building);
      if (upkeep) details.push(`Upkeep ${upkeep} gold every ${ECONOMY_INTERVAL}s`);
      else if (building.kind === 'palace') details.push('Capital: administration exempt');
    }
    if (building.kind === 'woodenTower' || building.kind === 'fort' || isKeep(building)) details.push(`Range ${WOODEN_TOWER_RANGE}`);
    if (isKeep(building)) details.push('Immune to raider theft');
    if (isDefensiveBuilding(building)) {
      if (owner?.armorLevel) details.push(`Armor ${equipmentMultiplier(owner.armorLevel)}×`);
      if ((building.kind === 'woodenTower' || building.kind === 'fort' || isKeep(building)) && owner?.weaponLevel) details.push(`Weapons ${equipmentMultiplier(owner.weaponLevel)}×`);
    }
    if (building.kind === 'well') details.push(`Level 2 housing within ${WELL_RADIUS} tiles`);
    if (building.kind === 'dock') details.push('Launches one galley for the Leader', 'Right-click the boat to board');
    if (building.kind === 'ballista') details.push('Range 18 tiles · One shot every 4 seconds', 'Prioritizes towers, guard posts and walls');
    if (building.kind === 'healerShack') details.push(`${HEALER_SHACK_MULTIPLIER}× friendly healing within ${HEALER_SHACK_RADIUS} tiles`, 'Own borders · Normal recovery delay · Does not stack');
    if (building.kind === 'irrigation') details.push(`Doubles farmland yield within ${IRRIGATION_RADIUS} tiles`, 'Immune to enemy attacks');
    if (building.kind === 'monument') details.push(`+${Number(MONUMENT_CULTURE_PER_SECOND.toFixed(2))} culture/s`);
    if (building.kind === 'blacksmith') {
      const owner = state.factions.find(faction => faction.id === building.faction);
      details.push(`Armor ${equipmentMultiplier(owner?.armorLevel)}×`, `Weapons ${equipmentMultiplier(owner?.weaponLevel)}×`);
    }
    if (building.kind === 'guardPost' && building.villageId === undefined) {
      const guards = state.units.filter(unit => unit.kind === 'militia' && unit.guardPost === building.id && unit.hp > 0);
      details.push(`Militia ${guards.length}/${guardPostCapacity(building)}`, `${guardPostUpkeep(building)} gold every ${GUARD_POST_UPKEEP_INTERVAL}s`);
      if (building.guardPost?.funded === false) details.push('Awaiting upkeep payment');
      else if (!building.guardPost) details.push('Awaiting city');
    }
    if (building.kind === 'house') {
      if (isHouseEnclosed(state, building)) details.push('Enclosed settlement: growth +30%');
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
    showCombatStats: buildMenuForSelection(building.kind) === 'fortifications' || isKeep(building),
    attack: ready && (building.kind === 'woodenTower' || building.kind === 'fort' || isKeep(building)) ? attackDamage(woodenTowerAttack(building, owner), 0) : 0,
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
