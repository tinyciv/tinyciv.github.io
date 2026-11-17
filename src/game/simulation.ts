import { FOUNDRY_GOLD, FOUNDRY_HP } from './field-cannon-config';
import { updateOffensives, offensiveDirective, offensiveReward, isOffensiveMember, recordOffensiveCasualty, cancelOffensive } from './offensive-native';
import { displaceNewObstacles } from './obstacle-displacement';
import { requestFieldCannonDecision, fieldCannonRoadPoint, orderFieldCannon, updateFieldCannons } from './field-cannons-native';
import { shipName } from './ship-names';
import { warshipAttack } from './warships-native';
import { warshipGunPoint } from './warship-layout';
import { scenarioPlacementError } from './scenario-access-native';
import { nextFortName } from './fort-names';
import { initializeExploration, updateExploration, needsRanger, makeRanger, updateExplorationAmbush } from './exploration-native';
import { registerExplorationHost } from './exploration-host';
import { shipyardSiteError, updateNavalEmpires, updateWarships, warshipMove, settleWarshipBounty, resolveWarshipLoss, warshipReinforcementGoal, fleetUpkeep } from './warships-native';
import { symmetricScenarioSites, type ScenarioPlan } from './scenarios-native';
import { updatePavedRoads } from './paved-roads-native';
import { negotiateDiplomacy, updateDiplomacy, refreshDiplomacy, recordDiplomaticCasualty, registerDiplomacySight } from './diplomacy';
import { emptyDiplomacyTerms, TREATY } from './diplomacy-view';
import { AchievementEffect, achievementEffect, lifetimeCulture } from './achievement-effects';
import { culturalHomeGround } from './cultural-territory';
import { rustEngine } from './rust-engine';
import { updateRaiderTechnology } from './raider-technology';
import { updateSeaRaids, updateSeaRetreat, seaMusterGoal } from './sea-raids';
import { updateBarbarianGalleys } from './barbarian-galleys-native';
import { leaderAttackAura } from './leader-aura';
import { libraryPlacementAllowed } from './research';
import { stoneDefenseMultiplier } from './stone-defense';
import { unitNavigationState, unitMovementNavigationState } from './unit-navigation';
import { refreshCivilianRowboat } from './pathfinding';
import { canUseRowboat } from './rowboats-native';
import { clearMovementPathDeferred, movementPathDeferred, requestMovementPath, withMovementPathBudget } from './movement-path-schedule';
import { withFarmTravelPlanningStep } from './farm-travel';
import { settlementStep, recordSettlementCasualty } from './settlement-step';
import { captureSecededCity, hasSecededCity, registerSettlementHost } from './settlement-transfer';
import { importSettlementSnapshot, settlements, TRANSFER, villageRelationView } from './settlement-bridge';
import { advanceSimulationClock, createSimulation, simRandom, takeEconomyTick, simCore } from './sim-handle';
import { initializeHermits, updateHermits } from './hermits';
import { DEFENSIVE_RADIUS, recordUnitDamage } from './combat-feedback';
import { recordLeaderDeath, leaderRespawnRemainingSeconds, hostWallClock, setHostWallClock } from './leader-respawn';
import { traceOrchestration } from './orchestration-trace';
import { engineerBuildMultiplier, fleeingAbilityMultiplier, recordEngineerDeath, synchronizeEngineers, updateEngineer, updateLeaderBrace } from './leader-abilities';
export { leaderRespawnRemainingSeconds } from './leader-respawn';
import { beginObservationPostRetreat, placeObservationPost, validateObservationPost } from './observation-posts';
import { observationPostVisibleTo } from './observation-visibility';
import { simulationReadsActive, withSimulationReads } from './simulation-reads';
import { FORT_GOLD, FORT_BASE_HP, preserveDestroyedFort, updateForts, updateFortSkirmisher, fortUpkeep } from './forts';
import { updateSupplyDepots, updateSupplyCart } from './supply-train';
import { garrisonMovementLimits, updateGarrison, releaseGarrison } from './garrison';
import { updateMassLevy, recordLevyCasualty, unitMoraleMaximum } from './mass-levy';
import { maximumUnitRange, unitAttackRange, downhillRangeBonus } from './combat-range';
import { DOCK_COST, DOCK_HP, dockPlacement } from './dock';
import { placementOccupancy } from './placement-occupancy';
import { boardedBoat, commandSailingMove, completeBoarding, orderBoardBoat, resolveSailingPassengers, updateSailboatLaunches, updateSailingLeader } from './sailing';
import { initializeVillageTrails, removeVillageTrailAt } from './village-trails';
import { initializeFishing, updateFishing, whalingPostSiteError, whalingMovementSpeed, WHALING_POST_COST, WHALING_POST_HP } from './fishing';
import { updateHarborTrade } from './harbor-trade';
import { playerFaction, isHumanFaction, playerInput, movementModeFor, retinueStanceFor, withPlayerFaction } from './player-context';
import { grantIncome } from './resource-income';
import { applyInfiniteGold } from './cheats';
import { recordGoldOutlay, spendGold, refundGold } from './gold-ledger';
import { forbiddenCells, forbiddenRevision, isForbidden, unitRespectsForbidden } from './forbidden-zones';
import { buildingResearchRequirement, isBuildingUnlocked, RESEARCH_BRANCHES, updateResearch } from './research';
import { applyDefenseResearch } from './defense-research';
import { PALISADE_GOLD, STONE_WALL_GOLD, updateWallStats } from './wall-stats';
import { civilianFootprint, unitCollisionRadius } from './collisions';
import { unitPositionBlocked } from './civilian-movement';
import { PALACE_HOUSING, palaceFoodProduction, recordRetinuePopulationLoss } from './city-support';
import { recordGuardKill, recordGuardCasualty } from './guard-posts';
import { recordCavalryMovement, tryCavalryCharge } from './cavalry';
import { isSoldier, isRetinueMember, buildingKindForSelection } from './types';
import { updateScout } from './scouts';
import { IRRIGATION_GOLD, irrigationConnects } from './irrigation';
import { UNIT_KIND_CODES, entityStore, resetEntities, buildingWithId } from './entity-store';
import { nearestRefuge, shelterNear, structureIndex } from './structure-index';
import { setEnemyStrength, updateEnemyStrength } from './enemy-strength';
import { marauderFortificationMultiplier, updateMarauderFormations } from './marauder-formations';
import { prepareCourierUpdates, settleCourier, wakeCourier } from './courier-sleep';
import { movementProfile } from './movement-profile';
import { invalidateSettlementDecisions, runSettlementDecision } from './settlement-decisions';
import { mountedSpeedMultiplier, retinueUpkeep, unitAttackTiming, HORSEMAN_SPEED_MULTIPLIER, HORSEMAN_ATTACK_MULTIPLIER, desiredRetinueSize, nextRecruitRole, advancedStartingEscortRole, setSoldierRole, scheduleArcheryTraining, interruptOutboundTraining, updateArcheryTraining, evadeMelee } from './archery';
import { updateRaiderGroupMotivation, updateRaiderMotivation } from './raider-motivations';
import { arrowLineClear } from './arrows';
import { usesFirearm } from './firearms';
import { battleSupport } from './battle-support-native';
import { buildingTargetable } from './building-targeting';
import { type Building, type BuildingKind, type Faction, type GameEvent, type GameState, type InputState, type Point, type RetinueStance, type Unit, type UnitKind, type World, BUILDABLE_KINDS, WATER, buildingPresent, buildingReady, buildingWidth, buildingHeight, distance, isFarmKind, isFord, isWallKind, tileAt, unitMaxHp } from './types';
import { beginNavigationFrame, endNavigationFrame, invalidateNavigation, buildingBlockers, buildingBlockerView, canMove, canTraverseEdge, canTraverseNavigationEdge, canWalk, createReachabilityQuery, findPath, hasStaticPath, isNarrowPassage, movementMultiplier, nativeMoveLayers, travelTimeMap, traversable, UNIT_RADIUS } from './pathfinding';
import { nativeMovement, STEER_BLOCKED, STEER_TRAFFIC, type NativeMoveProbe, type SeparationRow } from './movement-native';
import { normalizePunyWorld, terrainYields } from '../world/generator';
import { initializeGeothermal } from './geothermal-native';
import { CAMP_FIELD_OFFSETS, beginCollectorFrame, endCollectorFrame, ensureCollectors, invalidateScheduledHarvests, isHome, isPendingCampField, migrateFarms, synchronizeFarms, updateCollector, updateScheduledHarvests } from './farms';
import { farmBlockPlacementQuery } from './farm-blocks';
import { createAutomaticFarmSiteSearch, planAutomaticFarmSite, validateAutomaticFarmSite, type AutomaticFarmSiteSearch } from './farm-siting';
import { queueConstruction, updateActiveConstruction } from './structures';
import { raiderCanTarget, raiderMayAttack } from './raider-aggression';
import { markWorldChanged } from './world-revisions';
import { canReachConstruction, constructionEdges, ensureBuilders, notifyRepairJobChanged, updateBuilder } from './builders';
import { beginTrafficFrame, endTrafficFrame, hasNeighboringRoad, recordTraffic, updateTraffic } from './traffic';
import { hasGateWall, validateNetworkPlacement } from './network-placement';
import { buildingOverlapsVillageBorders, buildingWithinBorders } from './border-placement';
import { territory } from './borders';
import { beginFogFrame, endFogFrame, invalidateFog, refreshFogUnit, buildingInSight, buildingSightRadius, entityVisible, pointInSight, unitSightRadius, updateFog, publishFog, type FogView } from './fog';
import { highGroundSightMultiplier, sightDistance } from './sight';
import { mountainLineClear } from './terrain-rays-native';
import { fogRaidProfile, initializeFogRaids, updateFogRaids } from './fog-raids';
import { initializeRoamingMarauders } from './roaming-marauders';
import { DEFAULT_BANDIT_INTENSITY, setBanditIntensity } from './bandit-intensity';
import { recordBloodHit, updateBloodEffects } from './blood-effects';
import { recordUnitDeath, updateUnitDeaths } from './death-effects';
import { recordBuildingDestruction, publishBuildingDestructions, cancelBuildingDestruction } from './building-destruction';
import { updateWoodenTowers } from './tower-combat';
import { beginBattleRout, routLeaderRetinue, casualtyPressure, integrateBattleMorale, recordBattleDeath } from './battle-morale';
import { senseMorale } from './morale-perception';
import { firingTowerThreats } from './tower-threats';
import { campSpacingAllowed, palaceSpacingAllowed } from './placement';
import { planHouseAt, planHouseSite, type HouseSitePlan } from './housing';
import { buildingDisplacesFarms, farmAt, farmsUnderBuilding, planBuildingFarmRelocations, planRoadFarmRelocation, planWallFarmRelocation, relocateBuildingFarms, relocateFarm, withFarmRelocationBatch } from './farm-relocation';
import { FARM_BUILD_GOLD } from './farm-config';
import { houseCapacity } from './wells';
import { HOUSE_BASE_CAPACITIES, HOUSE_BUILD_GOLD } from './housing-config';
import { validateBridgeTile } from './bridge-spans';
import { reliefFootprintAllowed } from './relief';
import { settlementFootprintAllowed, SETTLEMENT_MOUNTAIN_GAP, unitSpawnTerrainAllowed } from './terrain-sites';
import { resourceFootprintError } from './resource-terrain';
import { unitObstructs, unitsCollide } from './collisions';
import { beginUnitFrame, cellOccupant, endUnitFrame, forEachNearbyUnit, indexedBuilding, indexedLeader, indexedUnit, lastCollidingUnitInCell, nearbyUnits, nearbyBuildings, refreshIndexedUnit, unitOccupancy } from './spatial';
import { retinueFormation } from './formation';
import { nativeRetinueSettled, nativeRetinueYieldAllowed } from './retinue-settling-native';
import { advanceInfantryFormations, enforceInfantryFormationStrength, infantryFormationGoal, infantryFormationLeader, infantryAttackMultiplier, infantryDefenseMultiplier, infantryAttackCooldown, toggleInfantryFormation } from './infantry-drill';
import { MILITARY_ACADEMY_GOLD, MILITARY_ACADEMY_HP } from './military-academy';
import { decisionDue, invalidateDecisions, type DecisionClock } from './decision-schedule';
import { CHECK_INTERVAL, runRecurringWork, withDeferredMaintenance, withImmediateMaintenance, withRecurringWorkBudget } from './work-cadence';
import { beginMarauderFrame, isScheduledMarauder, marauderUpdateElapsed } from './marauder-schedule';
import { buildingAtPoint, unitAtPoint } from './hit-testing';
import { galleyOverlapsTile } from './galley-footprint';
import { planStartingCityFarms, planStartingSettlement } from './settlement-layout';
import { ADVANCED_START_POPULATION, prepareAdvancedCity, type AdvancedStartPhase } from './advanced-start';
import { initializeVillages, updateVillageUnit, performVillageAction, villageCamp } from './villages';
import { updateQuests, recordQuestDestruction } from './quests';
import { hostileFactionPresent } from './hostile-presence';
import { atWar } from './relations';
export { atWar } from './relations';
import { clearPalaceWoodland } from './palace-clearing';
import { attackSpots, claimAttackSpot, movementCongestion, releaseAttackSpot } from './engagement';
import { initializeUnitDamageTimes, regenerateUnits } from './unit-health';
import { advanceProjectiles, projectileDuration } from './projectile-native';
import { cancellationRefund, constructionProgress, prepareConstructionCancellation, removeBuildings } from './construction-cancellation';
import { replaceableRoad } from './covered-roads';
import type { BuildSelection } from './types';
import { orderTreeClearing, validateTreeClearing, updateTreeStumps } from './tree-clearing';
import { addPalaceRoadRing } from './palace-roads';
import { clearBuildingFootprint } from './construction-clearance';
import { attackDamage, incomingUnitDamage, recordKill, unitDamage, unitDefense } from './veterancy';
import { recordCampaignCasualty, recordCampaignPopulation } from './campaign-stats';
import { invalidateRetinueSquads, joinRetinueSquad, recordRetinueKill, synchronizeRetinueSquads } from './retinue-squads';
import { awardLeaderXp, LEADER_VICTORY_XP, leaderCombatXp, initialLeaderProgression } from './leader-progression';
import { WELL_POPULATION_REQUIREMENT } from './wells';
import { canShareHouseWellTile } from './house-wells';
import { canShareWallTowerTile } from './wall-towers';
import { palisadeForUpgrade } from './wall-upgrades';
import { recordCivilianCasualty, recordCivilianCasualties } from './civilian-population';
import { panicCivilian, updateCivilianPanic } from './civilian-panic';
import { updateFactionDefenses } from './faction-defense';
import { updateFactionEmpires } from './faction-empire';
import { factionAIDecision } from './faction-ai-profile';
import { advanceFactionDevelopment, factionCityDevelopmentPriority } from './faction-development';
import { getFactionStrategy, getFactionCampaignTarget, updateFactionStrategies, type FactionMission } from './faction-strategy';
import { initializeTreasureChests, updateTreasureChests } from './treasure';
import { defendRaiderCamp, updateRaiderReturn } from './raider-activity';
import { notifyRaiderAttack, updateRaiderAlert } from './raider-alerts';
import { marauderBandDepleted, marauderLeaderInDanger } from './marauder-leaders';
import { advanceCityPopulation } from './city-growth';
import { updateCulture } from './culture';
import { isRaidObjective, selectRaidTarget } from './raid-targeting';
import { cityTaxIncome, citySummaries, factionFoodConsumption, invalidateCitySummarySnapshot, nextCityName } from './cities';
import { factionHasDevelopedResource } from './resource-development';
import { advanceResourceWorkforce, updateResourceWorkforce, updateResourceWorker } from './resource-workers';
import { updateDrainage, updateDrainageWorker } from './drainage';
import { updateWallOwnership } from './wall-ownership';
import { recordDestroyedDefense, updateDefenseRebuilds, type DefenseRebuild } from './defense-rebuilding';
import { cityDevelopmentNeeds, governorPermissions, governingPalace, pauseCityConstruction } from './governor';
import { applyFactionEquipment, equipUnitFromFaction } from './blacksmith';
import { initializeWildlife, updateWildlife, updateHerdAnimal, isHuntable, nearestHuntTarget, rewardHunt, huntingGrowthMultiplierForFaction } from './hunting';
import { establishFactionTrade, updateTradeRoutes, updateMerchant, recordMerchantRoad, MERCHANT_BOUNTY } from './trade';
import { beginPeasantFrame, endPeasantFrame, refreshPeasant } from './peasant-capacity';
import { updateGuardPosts, updateMilitia, militiaCityContains, militiaMovementLimits, guardPostUpkeep } from './guard-posts';
import { factionBuildingMaintenance, factionMaintenanceBreakdown } from './maintenance';
import { retinueSlotUpkeep } from './retinue-purchases';
import { HEALER_SHACK_COST, HEALER_SHACK_HP } from './healer-shack';
import { CIVILIZATIONS, civilizationFor, RIVAL_STARTING_GOLD } from './civilizations';
import { establishFactionStartingDefenses, ensureFactionStartingExits } from './faction-start';
import { captureOffer, palaceDefenses, transferCapturedCity } from './palace-capture';
import { isKeep, SETTLEMENT_MAX_HP } from './settlement-upgrades';
import { buildingArmor } from './defense-equipment';
import { BALLISTA_COST, BALLISTA_HP, BALLISTA_RANGE, ballistaAttack, updateBallistae } from './ballista';
import { governorPurchaseAllowed } from './battle-support-native';
import { SPEAR_PIERCE_DAMAGE_MULTIPLIER, PIKEMAN_RANGE, spearPiercingTargets } from './spearmen';

import { ECONOMY_INTERVAL } from './economy-constants';
import { colosseumSiteError } from './colosseum';
import { GRANARY_GOLD, GRANARY_HP, granarySiteError } from './granaries-native';
import { INSTITUTION_COST } from './institution-native';
import { THERMAL_BATH_GOLD, THERMAL_BATH_HP, thermalBathSiteError } from './thermal-baths-native';
import { siteTarget } from './sites-native';
import { validatePhysicalFootprint } from './placement-physical';
import { cityOwnership } from './city-ownership';
export { ECONOMY_INTERVAL } from './economy-constants';
/** Production remains zero only to read legacy saves; all construction uses gold. */
export const BUILD_COSTS: Record<BuildingKind, { food: number; gold: number; production: number }> = {
  fort: { food: 0, gold: FORT_GOLD, production: 0 }, supplyDepot: { food: 0, gold: 120, production: 0 },
  palace: { food: 0, gold: 100, production: 0 }, camp: { food: 0, gold: FARM_BUILD_GOLD, production: 0 },
  house: { food: 0, gold: HOUSE_BUILD_GOLD, production: 0 }, shack: { food: 0, gold: 250, production: 0 }, cottage: { food: 0, gold: 250, production: 0 },
  road: { food: 0, gold: 10, production: 0 }, wall: { food: 0, gold: STONE_WALL_GOLD, production: 0 }, palisade: { food: 0, gold: PALISADE_GOLD, production: 0 }, bridge: { food: 0, gold: 10, production: 0 },
  irrigation: { food: 0, gold: IRRIGATION_GOLD, production: 0 },
  ruin: { food: 0, gold: 0, production: 0 },
  well: { food: 0, gold: 50, production: 0 }, monument: { food: 0, gold: 200, production: 0 },
  forum: { food: 0, gold: INSTITUTION_COST.forum, production: 0 },
  foundry: { food: 0, gold: FOUNDRY_GOLD, production: 0 },
  militaryAcademy: { food: 0, gold: MILITARY_ACADEMY_GOLD, production: 0 },
  granary: { food: 0, gold: GRANARY_GOLD, production: 0 },
  thermalBath: { food: 0, gold: THERMAL_BATH_GOLD, production: 0 },
  shipyard: { food: 0, gold: 500, production: 0 },
  whalingPost: { food: 0, gold: WHALING_POST_COST, production: 0 },
  colosseum: { food: 0, gold: 2500, production: 0 }, barracks: { food: 0, gold: INSTITUTION_COST.barracks, production: 0 },
  stable: { food: 0, gold: 350, production: 0 }, blacksmith: { food: 0, gold: 200, production: 0 }, archeryRange: { food: 0, gold: 400, production: 0 }, library: { food: 0, gold: 200, production: 0 },
  guardPost: { food: 0, gold: 200, production: 0 }, scoutLodge: { food: 0, gold: 100, production: 0 },
  healerShack: { food: 0, gold: HEALER_SHACK_COST, production: 0 },
  ballista: { food: 0, gold: BALLISTA_COST, production: 0 },
  siegeCannon: { food: 0, gold: 500, production: 0 },
  dock: { food: 0, gold: DOCK_COST, production: 0 },
  tower: { food: 0, gold: 0, production: 0 }, woodenTower: { food: 0, gold: 40, production: 0 },
  observationPost: { food: 0, gold: 20, production: 0 },
  villageTent: { food: 0, gold: 0, production: 0 },
};
const HOUSE_CAPACITY: Partial<Record<BuildingKind, number>> = { house: HOUSE_BASE_CAPACITIES[0] };
const SUPPORTED_UNITS = new Set<UnitKind>(['fieldCannon', 'slinger', 'levyInfantry', 'skirmisher', 'supplyCart', 'leader', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'horseman', 'horseArcher', 'knight', 'archer', 'scout', 'militia', 'worker', 'boar', 'marshBird', 'merchant', 'sailboat']);
const NO_INPUT: InputState = { up: false, down: false, left: false, right: false };
const FACTION_COLORS = CIVILIZATIONS.map(civilization => civilization.color);
const RETINUE_SPEED = 3.6 * 1.1;
const RETINUE_RECRUIT_INTERVAL = 10;
export const MARAUDER_FACTION = -2;
function isRoute(kind: BuildingKind): boolean { return kind === 'road' || kind === 'bridge'; }

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}
const MILITARY_KINDS: ReadonlySet<string> = new Set(['fieldCannon', 'leader', 'militia', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'archer', 'horseman', 'horseArcher', 'knight', 'levyInfantry', 'slinger', 'skirmisher']);
function isMilitary(unit: Unit): boolean { return MILITARY_KINDS.has(unit.kind); }
function center(building: Building): Point {
  return { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 };
}
function edgeDistance(point: Point, building: Building): number {
  const size = buildingWidth(building), height = buildingHeight(building);
  return Math.hypot(Math.max(building.x - point.x, 0, point.x - building.x - size), Math.max(building.y - point.y, 0, point.y - building.y - height));
}
function factionOf(state: GameState, id: number): Faction | undefined { return state.factions.find(faction => faction.id === id); }
function palaceOf(state: GameState, faction: number): Building | undefined {
  return entityStore(state).buildings.query('palace').find(building => building.faction === faction && buildingReady(building));
}
export function getLeader(state: GameState, faction = playerFaction(state)): Unit | undefined {
  return indexedLeader(state, faction);
}
export function housingCapacity(state: GameState, faction = playerFaction(state)): number {
  return state.buildings.filter(building => building.faction === faction && (building.kind === 'house' || building.kind === 'palace') && buildingReady(building)).reduce((sum, building) => sum + building.capacity, 0);
}
export function logEvent(state: GameState, text: string, kind: GameEvent['kind'] = 'info'): void {
  state.events.unshift({ id: (state.events[0]?.id ?? 0) + 1, time: state.time, text, kind });
  if (state.events.length > 40) state.events.length = 40;
}
function particle(state: GameState, point: Point, text: string, color = '#f6e1a2'): void {
  state.particles.push({ ...point, text, color, life: 1.6 });
}
/** Irrigation follows the ground beneath vegetation. Other reservations clear
 * palms/reeds; only solid structures remove dense woodland and its effects. */
function clearBuildingVegetation(state: GameState, building: Building): void {
  if (building.hp <= 0 || building.kind === 'irrigation') return;
  let changed = false, sightChanged = false;
  const changedCells: number[] = [];
  const size = buildingWidth(building), height = buildingHeight(building);
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < size; dx++) {
    const tile = tileAt(state.world, building.x + dx, building.y + dy);
    if (!tile) continue;
    changedCells.push((building.y + dy) * state.world.width + building.x + dx);
    if (tile.palm) { delete tile.palm; changed = true; }
    if (tile.marsh) { delete tile.marsh; changed = true; }
    if (isRoute(building.kind) || dx < 0 || dy < 0 || dx >= size || dy >= height
      || !['forest', 'jungle', 'swamp'].includes(tile.overlay)) continue;
    const before = terrainYields(tile.terrain, tile.overlay), after = terrainYields(tile.terrain, 'none');
    tile.overlay = 'none'; sightChanged = true;
    for (const resource of ['food', 'production', 'gold'] as const)
      tile[resource] = Math.max(0, tile[resource] - before[resource] + after[resource]);
    changed = true;
  }
  if (changed) markWorldChanged(state.world, sightChanged ? 'sight' : 'appearance', changedCells);
}
function makeBuilding(state: GameState, kind: BuildingKind, faction: number, point: Point, minimumId = 0): Building {
  const width = buildingWidth({ kind }), height = buildingHeight({ kind });
  if (!reliefFootprintAllowed(state.world, point.x, point.y, width, height, isWallKind(kind)))
    throw new Error(`Cannot place ${kind} on this terrain.`);
  if (kind === 'palace' && !settlementFootprintAllowed(state.world, point.x, point.y, width, height))
    throw new Error('Starting towns require eight-tile mountain clearance.');
  const maxHp = kind === 'militaryAcademy' ? MILITARY_ACADEMY_HP : kind === 'foundry' ? FOUNDRY_HP : kind === 'whalingPost' ? WHALING_POST_HP : kind === 'shipyard' ? 1000 : kind === 'thermalBath' ? THERMAL_BATH_HP : kind === 'granary' ? GRANARY_HP : kind === 'fort' ? FORT_BASE_HP : kind === 'supplyDepot' ? 250 : kind === 'dock' ? DOCK_HP : (kind === 'ballista' || kind === 'siegeCannon') ? BALLISTA_HP : kind === 'healerShack' ? HEALER_SHACK_HP : kind === 'tower' ? 1200 : kind === 'woodenTower' ? 600 : kind === 'palace' ? SETTLEMENT_MAX_HP : kind === 'guardPost' ? 300 : kind === 'library' || kind === 'forum' ? 750 : kind === 'monument' || kind === 'blacksmith' || kind === 'archeryRange' || kind === 'scoutLodge' || kind === 'stable' ? 250 : kind === 'palisade' ? 225 / 4 : kind === 'wall' ? 225 : kind === 'cottage' ? 220 : kind === 'shack' || kind === 'house' ? 160 : 100;
  const building: Building = { id: entityStore(state).allocateId(minimumId), kind, faction, x: Math.floor(point.x), y: Math.floor(point.y), hp: maxHp, maxHp, capacity: HOUSE_CAPACITY[kind] ?? 0, armor: kind === 'tower' ? 15 : kind === 'woodenTower' ? 6 : kind === 'monument' ? 0 : 2 };
  if (kind === 'fort') building.fortName = nextFortName(state, faction);
  if (kind === 'dock') building.dockFacing = dockPlacement(state, point.x, point.y, faction)?.facing;
  applyDefenseResearch(building, factionOf(state, faction));
  if (kind === 'house') building.capacity = houseCapacity(building, factionOf(state, faction), state);
  if (kind === 'palace') {
    if (state.scenarioPreparing) building.scenarioCity = true;
    building.capacity = PALACE_HOUSING;
    building.cityName = nextCityName(state, faction);
    building.cultureAtFounding = lifetimeCulture(factionOf(state, faction));
    building.governorNextPlanAt = state.time + (isHumanFaction(state, faction) ? ECONOMY_INTERVAL : 2 + faction);
  }
  entityStore(state).buildings.add(building);
  if (kind === 'road' && removeVillageTrailAt(state.world, building.x, building.y)) markWorldChanged(state.world, 'appearance', [building.y * state.world.width + building.x]);
  clearBuildingVegetation(state, building);
  return building;
}
registerSettlementHost({
  makePalace: (state, faction, point) => makeBuilding(state, 'palace', faction, point),
  log: (state, text, kind) => logEvent(state, text, kind),
  afterTransfer: (state, faction) => {
    invalidateDecisions(state); updateWallOwnership(state);
    synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state);
    const owner = factionOf(state, faction); if (owner) calculateYields(state, owner);
  },
});
registerExplorationHost({
  building: (state, kind, faction, point) => makeBuilding(state, kind, faction, point),
  unit: (state, kind, faction, point, home) => makeUnit(state, kind, faction, point, home),
  changed: (state, faction) => {
    invalidateDecisions(state); synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state);
    const owner = factionOf(state, faction); if (owner) calculateYields(state, owner);
  },
});
function makeUnit(state: GameState, kind: UnitKind, faction: number, point: Point, home?: number, minimumId = 0): Unit {
  const unit: Unit = {
    id: entityStore(state).allocateId(minimumId), kind, faction, x: point.x, y: point.y, hp: kind === 'worker' ? 50 : 100, maxHp: kind === 'worker' ? 50 : 100, morale: 100,
    attack: kind === 'leader' ? 25 : kind === 'swordsman' ? 34 : kind === 'horseman' ? 17 * HORSEMAN_ATTACK_MULTIPLIER : kind === 'warrior' || kind === 'spearman' || kind === 'pikeman' ? 17 : 0,
    defense: kind === 'leader' ? 5 : kind === 'spearman' ? 6 : kind === 'pikeman' ? 9 : kind === 'swordsman' || kind === 'warrior' || kind === 'horseman' ? 4 : 0,
    speed: kind === 'leader' ? 3.6 : kind === 'horseman' ? RETINUE_SPEED * HORSEMAN_SPEED_MULTIPLIER : kind === 'swordsman' || kind === 'warrior' || kind === 'spearman' || kind === 'pikeman' ? RETINUE_SPEED : 2.2,
    range: kind === 'leader' ? 4 : kind === 'spearman' ? 1.4 : kind === 'pikeman' ? PIKEMAN_RANGE : 1.1,
    order: kind === 'worker' ? 'work' : 'follow',
    home, cooldown: 0, lastCombat: -60, moving: false, facing: 0, attackTime: 0, bornAt: state.time,
  };
  if (kind === 'fieldCannon' || kind === 'musketman' || kind === 'horseman' || kind === 'horseArcher' || kind === 'knight') { unit.warriorStats = { hp: 100, attack: 17, defense: 4, speed: RETINUE_SPEED }; setSoldierRole(unit, kind); }
  if (kind === 'leader') unit.leaderProgression = initialLeaderProgression();
  equipUnitFromFaction(unit, factionOf(state, faction));
  entityStore(state).units.add(unit);
  return unit;
}
interface SiteSearch { buildings: Set<number>; fields: Set<number>; units: Set<number>; }
const siteSearches = new WeakMap<GameState, SiteSearch>();
function freeTile(state: GameState, x: number, y: number, replaceRoadsFor?: number, allowIrrigation = false): boolean {
  if (!traversable(state.world, x, y) || !reliefFootprintAllowed(state.world, Math.floor(x), Math.floor(y))) return false;
  const search = siteSearches.get(state);
  if (search && replaceRoadsFor === undefined) return !search.buildings.has(y * state.world.width + x);
  if (isPendingCampField(state, x, y)) return false;
  return !state.buildings.some(building => {
    if (building.hp <= 0 || replaceRoadsFor !== undefined && (replaceableRoad(building, replaceRoadsFor)
      || allowIrrigation && building.kind === 'irrigation' && building.faction === replaceRoadsFor)) return false;
    const size = buildingWidth(building), height = buildingHeight(building);
    return x >= building.x && y >= building.y && x < building.x + size && y < building.y + height;
  });
}
function freeField(state: GameState, x: number, y: number, replaceRoadsFor?: number): boolean {
  const tile = tileAt(state.world, x, y);
  return !!tile && !state.buildings.some(building => building.hp > 0 && building.kind === 'road' && building.x === x && building.y === y)
    && ['none', 'forest', 'jungle', 'swamp'].includes(tile.overlay) && freeTile(state, x, y, replaceRoadsFor, true) && !(siteSearches.get(state)?.fields.has(y * state.world.width + x) ?? state.fields?.some(field => field.x === x && field.y === y));
}
function nearbyOpen(state: GameState, origin: Point, minRadius: number, maxRadius: number, preferred?: (point: Point) => number, avoidUnits = true): Point | undefined {
  // A site search never mutates the world. Build occupancy once, rather than
  // scanning every structure, field and unit for each of thousands of cells.
  const width = state.world.width, buildings = new Set<number>();
  for (const building of state.buildings) if (building.hp > 0) {
    const size = buildingWidth(building), height = buildingHeight(building);
    for (let y = building.y; y < building.y + height; y++) for (let x = building.x; x < building.x + size; x++) buildings.add(y * width + x);
  }
  const search: SiteSearch = { buildings, fields: new Set((state.fields ?? []).map(field => field.y * width + field.x)),
    units: new Set(avoidUnits ? state.units.filter(unit => !unit.inside && unit.hp > 0).map(unit => Math.floor(unit.y) * width + Math.floor(unit.x)) : []) };
  const previous = siteSearches.get(state); siteSearches.set(state, search);
  let best: Point | undefined, bestScore = -Infinity;
  try {
    for (let y = Math.max(1, Math.floor(origin.y - maxRadius)); y <= Math.min(state.world.height - 2, Math.ceil(origin.y + maxRadius)); y++) {
      for (let x = Math.max(1, Math.floor(origin.x - maxRadius)); x <= Math.min(state.world.width - 2, Math.ceil(origin.x + maxRadius)); x++) {
        const point = { x: x + 0.5, y: y + 0.5 }, d = distance(point, origin), cell = y * width + x;
        if (d < minRadius || d > maxRadius || !unitSpawnTerrainAllowed(state.world, x, y) || !freeTile(state, x, y) || search.fields.has(cell) || search.units.has(cell)) continue;
        const score = preferred ? preferred(point) : -d + simRandom(state) * 1.8;
        if (Number.isFinite(score) && score > bestScore) { best = point; bestScore = score; }
      }
    }
    return best;
  } finally { if (previous) siteSearches.set(state, previous); else siteSearches.delete(state); }
}
function syncRetinue(state: GameState, faction: Faction, startingEscort = false, advancedEscort = false): void {
  faction.nextRetinueAt ??= state.time + RETINUE_RECRUIT_INTERVAL;
  if (!startingEscort && state.time + 1e-7 < faction.nextRetinueAt) return;
  faction.nextRetinueAt = state.time + RETINUE_RECRUIT_INTERVAL;
  const leader = getLeader(state, faction.id);
  const palace = palaceOf(state, faction.id);
  if (!leader || !palace || faction.defeated || faction.relation === 'confederated') return;
  const wanted = desiredRetinueSize(faction, leader);
  // A town with a completed barracks musters every new recruit there instead.
  const ownership = cityOwnership(state);
  const muster = state.buildings.find(building => building.kind === 'barracks' && building.faction === faction.id && buildingReady(building)
    && ownership.building(building)?.id === palace.id) ?? palace;
  const present = state.units.filter(unit => isRetinueMember(unit) && unit.faction === faction.id && unit.hp > 0).length;
  if (present >= wanted) return;
  const count = startingEscort ? Math.max(0, wanted - present) : 1;
  for (let i = 0; i < count; i++) {
    const expandedStart = startingEscort && wanted > 8;
    const escortScore = (point: Point): number => hasStaticPath(state, leader, point, faction.id) ? -distance(leader, point) : -Infinity;
    const spawn = startingEscort ? (nearbyOpen(state, leader, .8, expandedStart ? 10 : 3, escortScore)
      ?? nearbyOpen(state, leader, .8, expandedStart ? 12 : 6, escortScore)) : constructionEdges(state, muster).find(point =>
      reliefFootprintAllowed(state.world, Math.floor(point.x), Math.floor(point.y)) &&
      !state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === Math.floor(point.x) && Math.floor(unit.y) === Math.floor(point.y)));
    // A blocked palace exit postpones recruitment; never spawn overlapping
    // another person or teleport a replacement to a distant Leader.
    if (!spawn) return;
    const ranger = needsRanger(state, faction.id);
    const role = startingEscort && advancedEscort ? advancedStartingEscortRole(state, faction) : nextRecruitRole(state, faction);
    const recruit = makeUnit(state, 'warrior', faction.id, spawn, palace.id);
    if (ranger) makeRanger(recruit);
    else if (role !== 'warrior') setSoldierRole(recruit, role);
    entityStore(state).units.updateRoles(recruit);
    joinRetinueSquad(state, recruit);
    recruit.joiningRetinue = !startingEscort;
    if (isHumanFaction(state, faction.id)) {
      const stance = retinueStanceFor(state, faction.id);
      recruit.retinueStance = stance;
      recruit.order = startingEscort && stance === 'hold' ? 'hold' : 'follow';
      if (startingEscort && stance === 'defensive') recruit.defensiveAnchor = { x: recruit.x, y: recruit.y };
    }
  }
  faction.nextRetinueAt = state.time + RETINUE_RECRUIT_INTERVAL;
}


export function createGame(world: World, duel?: { names?: string[]; colors?: string[] }, options: { advancedStart?: AdvancedStartPhase; banditIntensity?: number; enemyStrength?: number; scenario?: ScenarioPlan } = {}): GameState {
  world.revision ??= 0;
  const state: GameState = {
    world, units: [], buildings: [], factions: [], time: 0, tick: 0, paused: false, speed: 1, scenarioPreparing: !!options.scenario,
    events: [], particles: [], projectiles: [], selected: null, selectedType: null, buildMode: null,
    diplomacy: null, gameOver: false, victory: false, seed: world.seed, rngState: 0,
    retinueStance: 'aggressive', movementMode: 'travel',
    ...(duel ? { playerFaction: 0, multiplayer: { humanFactionIds: [0, 1], inputs: {}, controls: {
      0: { retinueStance: 'aggressive' as const, movementMode: 'travel' as const },
      1: { retinueStance: 'aggressive' as const, movementMode: 'travel' as const },
    }, winner: null } } : {}),
  };
  // The native core owns the random stream; rngState is its mirror.
  createSimulation(state, hashSeed(`${world.seed}:simulation`));
  initializeGeothermal(state, hashSeed(`${world.seed}:geothermal`));
  setBanditIntensity(state, options.banditIntensity ?? DEFAULT_BANDIT_INTENSITY);
  if (options.scenario) {
    state.raiderCamps = []; state.marauderPacks = []; state.villages = [];
    if (world.scenario === 'no-mans-land' || world.scenario === 'tutorial' || world.scenario === 'island-deathmatch' || world.scenario === 'sandbox' || world.scenario === 'musketry-deathmatch') { state.explorationSites = []; state.hermits = []; state.treasures = []; }
  }
  const spawns = world.spawns.length ? world.spawns : [{ x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) }];
  spawns.forEach((spawn, index) => {
    // Keep the world-creation random stream; the last spawn starts at war.
    simRandom(state);
    const civilization = civilizationFor(index);
    const faction: Faction = {
      id: index, name: duel?.names?.[index]?.slice(0, 40) || civilization.name, color: duel?.colors?.[index] || civilization.color,
      relation: duel ? 'war' : index === 0 ? 'self' : options.scenario ? 'peace' : index === spawns.length - 1 ? 'war' : 'peace',
      food: 500, gold: isHumanFaction(state, index) ? 500 : RIVAL_STARTING_GOLD, production: 0, population: 0, culture: 0, yields: { food: 0, production: 0, gold: 0 },
      nextRaid: 75 + simRandom(state) * 45, defeated: false,
    };
    state.factions.push(faction);
    const scenario = options.scenario;
    const citySpawns = scenario ? scenario.buildings.filter(entry => entry.kind === 'palace' && entry.faction === index) : [spawn], second = !duel && index > 0 ? world.secondarySpawns?.[index - 1] : undefined;
    if (second && !scenario) citySpawns.push(second);
    let palace: Building | undefined;
    if (scenario) {
      faction.gold = world.scenario === 'sandbox' ? scenario.gold : 150000;
      faction.food = world.scenario === 'sandbox' ? scenario.food : 1000000;
      faction.research = { focus: RESEARCH_BRANCHES[0].id, levels: {}, progress: {} };
      for (const branch of RESEARCH_BRANCHES) faction.research.levels[branch.id] = scenario.researchLevel;
      for (const branch of scenario.startingResearch ?? []) faction.research.levels[branch] = 1;
      if (world.scenario !== 'sandbox') faction.archerFraction = faction.spearmanFraction = faction.horsemanFraction = .25;
      if (scenario.musketFraction !== undefined) {
        faction.archerFraction = faction.spearmanFraction = faction.horsemanFraction = 0;
        faction.musketmanFraction = scenario.musketFraction;
      }
    }
    {
      for (const [cityIndex, citySpawn] of citySpawns.entries()) {
        const advanced = options.advancedStart && isHumanFaction(state, index);
        const startingPopulation = advanced ? ADVANCED_START_POPULATION : (world.scenario === 'tutorial' || world.scenario === 'island-deathmatch' || scenario?.completeLayouts) ? scenario!.population : scenario || isHumanFaction(state, index) ? 20 : 5;
        const layout = scenario?.completeLayouts ? { palace: citySpawn, roads: [], houses: [], farms: [] }
          : planStartingSettlement(state, citySpawn, advanced ? 20 : startingPopulation);
        const town = makeBuilding(state, 'palace', index, layout.palace);
        if (!palace) town.initialCity = true;
        palace ??= town;
        clearPalaceWoodland(world, town);
        // Each rival city begins with the same complete roads and productive
        // settlement as a capital, rather than an isolated second palace.
        for (const point of layout.roads) {
          const road = makeBuilding(state, 'road', index, point);
          clearBuildingVegetation(state, { ...road, kind: 'house' });
        }
        let residents = startingPopulation;
        for (const point of layout.houses) {
          const house = makeBuilding(state, 'house', index, point);
          if ('houseLevel' in citySpawn && Number(citySpawn.houseLevel) > 0) {
            house.houseLevel=Number(citySpawn.houseLevel);
            house.capacity=houseCapacity(house,faction,state);
          }
          house.residents = Math.min(house.capacity, residents); residents -= house.residents;
        }
        if (residents) town.unhousedResidents = residents;
        if (advanced) prepareAdvancedCity(state, faction, town, (kind, point) => makeBuilding(state, kind, index, point), options.advancedStart);
        const equipment=scenario?.buildings.filter(entry=>entry.faction===index&&entry.kind!=='palace'
          &&(entry.cityIndex===undefined?town===palace:entry.cityIndex===cityIndex))??[];
        for(const entry of equipment) {
          const building=makeBuilding(state,entry.kind,index,{x:town.x+entry.x-citySpawn.x,y:town.y+entry.y-citySpawn.y});
          if(entry.kind==='house') {
            building.houseLevel=entry.houseLevel;building.capacity=houseCapacity(building,faction,state);
            building.residents=Math.min(building.capacity,entry.residents,town.unhousedResidents??0);
            town.unhousedResidents=Math.max(0,(town.unhousedResidents??0)-building.residents);
          }
        }
        const farms = scenario?.completeLayouts ? [] : advanced || equipment.length ? planStartingCityFarms(state, town, startingPopulation, citySpawn) : layout.farms;
        for (const point of farms) makeBuilding(state, 'camp', index, point);
        if (!isHumanFaction(state, index) && world.scenario !== 'tutorial' && world.scenario !== 'island-deathmatch' && !scenario?.completeLayouts) establishFactionStartingDefenses(state, town,
          (kind, point) => makeBuilding(state, kind, index, point));
        faction.population += startingPopulation;
      }
      if (!isHumanFaction(state, index)) ensureFactionStartingExits(state, index,
        (kind, point) => makeBuilding(state, kind, index, point));
    }
    synchronizeFarms(state);
    const startingExits = constructionEdges(state, palace!).filter(point => reliefFootprintAllowed(world, Math.floor(point.x), Math.floor(point.y)));
    const startingScore = (point: Point): number => startingExits.some(exit => hasStaticPath(state, exit, point, index))
      ? -distance(center(palace!), point) : -Infinity;
    const leaderSpot = nearbyOpen(state, center(palace!), 1.4, options.advancedStart ? 8 : 4, startingScore)
      ?? nearbyOpen(state, center(palace!), 1.4, 12, startingScore);
    if (!leaderSpot) throw new Error('No vacant flat ground is reachable for the starting Leader.');
    const leader = makeUnit(state, 'leader', index, leaderSpot);
    if (duel) leader.humanControlled = true;
    if (index === 0) { state.selected = leader.id; state.selectedType = 'unit'; }
    syncRetinue(state, faction, true, !!scenario && world.scenario !== 'sandbox' || !!options.advancedStart && isHumanFaction(state, index));
  });
  if (options.scenario?.completeLayouts) {
    // Production farm siting runs after every founding footprint is present.
    // Native symmetry applies each source plan to both equal landscapes.
    for (const city of state.buildings.filter(building => building.kind === 'palace' && building.faction === 0)) {
      const sites = planStartingCityFarms(state, city, options.scenario.population).map(point => ({kind:'camp' as const,...point}));
      for (const site of symmetricScenarioSites(simCore(state).handle, world, sites)) makeBuilding(state, site.kind, site.faction, site);
    }
  }
  for (const entry of options.scenario?.ships ?? []) {
    const yard = state.buildings.find(b => b.kind === 'shipyard' && b.faction === entry.faction && b.x === entry.yardX && b.y === entry.yardY);
    if (!yard) throw new Error('Scenario warship has no shipyard.');
    const ship = makeUnit(state, 'sailboat', entry.faction, entry);
    const shipClass = ['warGalley', 'caravel', 'frigate'].indexOf(entry.class);
    ship.hp = ship.maxHp = rustEngine.naval_constant(8, shipClass);
    ship.facing = entry.facing; ship.speed = rustEngine.naval_constant(6, shipClass);
    ship.order = 'hold'; ship.range = 14; ship.sailboat = { dock: yard.id };
    ship.warship = { class: entry.class, name: shipName(state, entry.faction, ship.id), yard: yard.id,
      speed: 0, kills: 0, marine: entry.marine, crewHp: rustEngine.naval_constant(9, shipClass),
      weapons: Array.from({ length: rustEngine.naval_constant(7, shipClass) }, () => entry.weapon),
      anchored: false, readyAt: 0, nextUpkeepAt: 30, funded: true, lastAttacker: -1, rewarded: false };
  }
  synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state);
  if (!options.scenario) {
    initializeFogRaids(state);
    initializeRoamingMarauders(state);
  }
  if (!options.scenario || world.scenario === 'sandbox') {
    initializeVillages(state);
    initializeVillageTrails(state);
  }
  initializeFishing(state);
  for (const faction of state.factions) calculateYields(state, faction);
  if (!options.scenario) logEvent(state, 'Your people await. Explore, build roads, and unite the valley.', 'good');
  const enemies = state.factions.filter(faction => faction.relation === 'war');
  if (enemies.length) logEvent(state, `${enemies.map(faction => faction.name).join(' and ')} are hostile. Protect your town.`, 'warning');
  if (state.multiplayer) for (const id of state.multiplayer.humanFactionIds) updateFog(state, id);
  else updateFog(state);
  initializeTreasureChests(state);
  initializeHermits(state);
  initializeExploration(state);
  initializeWildlife(state);
  if (state.multiplayer) for (const id of state.multiplayer.humanFactionIds) publishFog(state, id);
  else publishFog(state);
  setEnemyStrength(state, options.enemyStrength ?? 1);
  if (!state.scenarioPreparing) refreshDiplomacy(state);
  for (const faction of state.factions) recordCampaignPopulation(state, faction);
  return state;
}

/** Duel worlds contain two equally equipped human capitals. Terrain is shared,
 * and choosing the most separated starting sites avoids adjacent random rivals. */
export function createDuelGame(world: World, names?: string[], colors?: string[]): GameState {
  if (world.spawns.length < 2) throw new Error('A duel requires two valid starting locations.');
  const candidates: { pair: Point[]; separation: number }[] = [];
  for (let i = 0; i < world.spawns.length; i++) for (let j = i + 1; j < world.spawns.length; j++) {
    const separation = distance(world.spawns[i], world.spawns[j]);
    if (separation <= 100 && separation >= (world.minimumFactionStartDistance ?? 0)) candidates.push({ pair: [world.spawns[i], world.spawns[j]], separation });
  }
  candidates.sort((a, b) => b.separation - a.separation);
  const planning = { world, buildings: [], units: [], factions: [], time: 0 } as unknown as GameState;
  const pair = candidates.find(({ pair: [a, b] }) => findPath(planning, { x: a.x + .5, y: a.y + .5 },
    { x: b.x + .5, y: b.y + .5 }, 0).length)?.pair;
  if (!pair) throw new Error('A duel requires two towns connected by walkable terrain.');
  return createGame({ ...world, spawns: pair, secondarySpawns: [] }, { names, colors });
}

function targetEntity(state: GameState, id?: number): Unit | Building | undefined {
  if (id === undefined) return;
  const unit = indexedUnit(state, id);
  if (unit && unit.hp > 0 && !unit.inside) return unit;
  const building = indexedBuilding(state, id);
  return building && buildingTargetable(building) && !isFarmKind(building.kind) && building.kind !== 'irrigation' ? building : undefined;
}
function isBuilding(entity: Unit | Building): entity is Building { return 'capacity' in entity; }
function validTarget(state: GameState, attacker: Unit, target: Unit | Building): boolean {
  if (!raiderCanTarget(state, attacker, target.faction)) return false;
  if (unitRespectsForbidden(state, attacker) && forbiddenTarget(state, target, attacker.faction)) return false;
  return target.hp > 0 && (isBuilding(target) ? buildingTargetable(target) && !isFarmKind(target.kind) && target.kind !== 'irrigation' : !target.inside)
    && (isBuilding(target) || observationPostVisibleTo(target, attacker.faction))
    && (!isBuilding(target) || !palaceDefenses(state, target).length)
    && (atWar(state, attacker.faction, target.faction) || !isBuilding(target) && isHuntable(target) && attacker.faction >= 0 && isMilitary(attacker));
}
function targetDistance(unit: Unit, target: Unit | Building): number { return isBuilding(target) ? edgeDistance(unit, target) : distance(unit, target); }
/** Player armies share scout reports; other combatants use their own cover-
 * limited sight. Strategic raid destinations remain known without live sight. */
function targetInSight(state: GameState, observer: Unit | Building, target: Unit | Building, from = isBuilding(observer) ? center(observer) : observer): boolean {
  if (!raiderCanTarget(state, observer, target.faction)) return false;
  if (!isBuilding(target) && !observationPostVisibleTo(target, observer.faction)) return false;
  if (isHumanFaction(state, observer.faction)) return withPlayerFaction(state, observer.faction, () => entityVisible(state, target));
  const radius = (isBuilding(observer) ? buildingSightRadius(observer) : unitSightRadius(observer)) - .65;
  const sees = (x: number, y: number) => {
    const effectiveRadius = radius * highGroundSightMultiplier(state.world, from, { x, y }, !isBuilding(observer));
    return sightDistance(state.world, from, x, y, effectiveRadius) <= effectiveRadius;
  };
  if (!isBuilding(target)) return sees(target.x, target.y);
  const size = buildingWidth(target), height = buildingHeight(target);
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++)
    if (sees(target.x + x + .5, target.y + y + .5)) return true;
  return false;
}
/** A candidate search does not move or damage entities, so its player queries
 * can share one lazily prepared fog view. Never retain this across searches:
 * an earlier unit may move a scout or kill a sight source in the same step. */
function targetSightQuery(state: GameState, observer: Unit): (target: Unit | Building) => boolean {
  if (!isHumanFaction(state, observer.faction)) return target => targetInSight(state, observer, target);
  let fog: FogView | undefined;
  return target => {
    if ('inside' in target && target.inside || !isBuilding(target) && !observationPostVisibleTo(target, observer.faction)) return false;
    if (target.faction === observer.faction) return true;
    fog ??= updateFog(state, observer.faction);
    return isBuilding(target) ? buildingInSight(fog, target) : pointInSight(fog, target.x, target.y);
  };
}
/** Melee needs physical contact through open ground. The target
 * building itself is excluded so its near face can still be attacked in a siege. */
function hasAttackContact(state: GameState, from: Point, faction: number, target: Unit | Building, ranged = false, sourceBuilding?: Building): boolean {
  const size = isBuilding(target) ? buildingWidth(target) : 0, height = isBuilding(target) ? buildingHeight(target) : 0, inset = .001;
  // Ordinary melee against a unit needs no footprint exclusions. Read the
  // shared topology directly instead of copying every building cell per probe.
  if (!size && !ranged && !sourceBuilding) return canMove(state, from, target, faction);
  const contact = isBuilding(target) ? {
    x: Math.max(target.x + inset, Math.min(target.x + size - inset, from.x)),
    y: Math.max(target.y + inset, Math.min(target.y + height - inset, from.y)),
  } : target;
  if (ranged && !mountainLineClear(state.world, from, contact)) return false;
  const buildings = buildingBlockerView(state, faction), excluded = new Set<number>();
  // Javelins arc over defensive walls and palisades (not over a wooden tower
  // standing on one). The resident index answers per blocked cell.
  const arcing = ranged ? structureIndex(state) : undefined;
  const blockers = { has: (index: number) => buildings.has(index) && !excluded.has(index) && !arcing?.arcCell(index) };
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) excluded.add((target.y + y) * state.world.width + target.x + x);
  // A tower shoots from its own occupied footprint.
  if (sourceBuilding) for (let y = 0; y < buildingHeight(sourceBuilding); y++) for (let x = 0; x < buildingWidth(sourceBuilding); x++)
    excluded.add((sourceBuilding.y + y) * state.world.width + sourceBuilding.x + x);
  if (ranged) {
    // Other buildings still stop the ray, including when its target moves
    // during the flight.
    let x = Math.floor(from.x), y = Math.floor(from.y);
    const goalX = Math.floor(contact.x), goalY = Math.floor(contact.y);
    const dx = contact.x - from.x, dy = contact.y - from.y, sx = Math.sign(dx), sy = Math.sign(dy);
    const deltaX = sx ? 1 / Math.abs(dx) : Infinity, deltaY = sy ? 1 / Math.abs(dy) : Infinity;
    let crossX = sx ? ((sx > 0 ? x + 1 : x) - from.x) / dx : Infinity;
    let crossY = sy ? ((sy > 0 ? y + 1 : y) - from.y) / dy : Infinity;
    while (true) {
      if (!tileAt(state.world, x, y) || blockers.has(y * state.world.width + x)) return false;
      if (x === goalX && y === goalY) return true;
      if (Math.abs(crossX - crossY) < 1e-8) { x += sx; y += sy; crossX += deltaX; crossY += deltaY; }
      else if (crossX < crossY) { x += sx; crossX += deltaX; }
      else { y += sy; crossY += deltaY; }
    }
  }
  return canMove(state, from, contact, faction, blockers);
}
function unitAttackContact(state: GameState, unit: Unit, target: Unit | Building, from: Point = unit): boolean {
  if (unitRespectsForbidden(state, unit) && (isForbidden(state, from.x, from.y, unit.faction) || forbiddenTarget(state, target, unit.faction))) return false;
  if (unit.wallPatrol?.wall !== undefined) return hasAttackContact(state, from, unit.faction, target, true, entityStore(state).buildings.get(unit.wallPatrol.wall));
  return ((unit.kind === 'musketman' || unit.kind === 'archer' || unit.kind === 'horseArcher') || unit.kind === 'slinger') ? arrowLineClear(state, from, isBuilding(target) ? center(target) : target, !isBuilding(target) ? target.wallPatrol?.wall ?? target.id : target.id)
    : hasAttackContact(state, from, unit.faction, target, unit.kind === 'leader' || unit.kind === 'skirmisher');
}
// Predicates close over live orders and are recreated every step. A named
// purpose, rather than function identity, keeps their decision clocks stable.
enum EnemyQuery { Marauder = 1, Recover, Mission, Guard, Rally, Raid, Defensive, Formation, Aggressive, Warrior, PlayerLeader, Leader, InfantryDrill, Garrison, Regroup, ReadyShot }
interface EnemyDecision extends DecisionClock {
  state: GameState;
  target?: Unit | Building;
  damagedAt?: number;
  order?: Unit['order'];
}
/** A friend fighting or hit within this radius draws a soldier into the fight. */
const ALLY_AGGRO_RADIUS = 4;
/** An enemy soldier this close that is targeting our faction triggers self-defense. */
const THREAT_RADIUS = 3.5;
/** Enemy search radius while assisting engaged allies. */
const ALLY_AGGRO_SEARCH = 9;
/** Minimum spacing between one unit's path re-plans toward a moved goal. */
const REPLAN_INTERVAL = .15;
const enemyDecisions = new WeakMap<Unit, Map<EnemyQuery, EnemyDecision>>();

/** Broad sensing is capped even after damage, commands and topology edits.
 * Validate only the retained target on fast steps; movement and actual attacks
 * still use current range, allegiance, visibility and contact constraints. */
function nearestEnemy(state: GameState, unit: Unit, purpose: EnemyQuery, radius: number, includeBuildings = false, canEngage: (target: Unit | Building) => boolean = () => true): Unit | Building | undefined {
  let decisions = enemyDecisions.get(unit);
  if (!decisions) { decisions = new Map(); enemyDecisions.set(unit, decisions); }
  let decision = decisions.get(purpose);
  if (!decision || decision.state !== state) {
    decision = { state }; decisions.set(purpose, decision);
  }
  // Re-decide at once when the retained target is lost, the unit is hit or its
  // order changes; fighting units re-decide at the combat rate.
  const retained = !!decision.target && targetEntity(state, decision.target.id) === decision.target && validTarget(state, unit, decision.target)
    && targetDistance(unit, decision.target) < radius && canEngage(decision.target) && targetInSight(state, unit, decision.target);
  const urgent = !!decision.target && !retained || unit.lastDamagedAt !== decision.damagedAt || unit.order !== decision.order;
  decision.damagedAt = unit.lastDamagedAt; decision.order = unit.order;
  if (decisionDue(decision, state.time, unit.id * 31 + purpose, retained || state.time - unit.lastCombat < 1, urgent)) {
    decision.target = searchNearestEnemy(state, unit, radius, includeBuildings, canEngage,
      purpose === EnemyQuery.InfantryDrill || purpose === EnemyQuery.ReadyShot);
    return decision.target;
  }
  const target = decision.target;
  return target && targetEntity(state, target.id) === target && validTarget(state, unit, target)
    && targetDistance(unit, target) < radius && canEngage(target) && targetInSight(state, unit, target) ? target : undefined;
}
function searchNearestEnemy(state: GameState, unit: Unit, radius: number, includeBuildings: boolean, canEngage: (target: Unit | Building) => boolean, inPlaceOnly: boolean): Unit | Building | undefined {
  if (!hostileFactionPresent(state, unit.faction)) return;
  const inSight = targetSightQuery(state, unit);
  // Return fire takes priority over nearby passive units. Only shots observed
  // by this unit or its immediate allies create these short-lived threats.
  for (const tower of firingTowerThreats(state, unit)) {
    if (!raiderCanTarget(state, unit, tower.faction) || unitRespectsForbidden(state, unit) && forbiddenTarget(state, tower, unit.faction) || edgeDistance(unit, tower) > radius || !atWar(state, unit.faction, tower.faction) || !canEngage(tower) || !inSight(tower)) continue;
    if (targetDistance(unit, tower) <= unitAttackRange(state.world, unit, tower) && unitAttackContact(state, unit, tower)) return tower;
    if (!inPlaceOnly && reachableTower(state, unit, tower)) return tower;
  }
  if (inPlaceOnly) {
    // Observe indexed neighbors only on the shared decision cadence. Native
    // ranking selects a reachable shot; no attack-slot or path search occurs.
    const targets: (Unit | Building)[] = [...nearbyUnits(state, unit, radius),
      ...(includeBuildings ? nearbyBuildings(state, unit, radius) : [])];
    const eligible = targets.filter(target => atWar(state, unit.faction, target.faction)
      && validTarget(state, unit, target) && canEngage(target) && inSight(target));
    const ranked = battleSupport(state, 6, unit, unit.faction, unit.id,
      eligible.map(target => ({ target, hostile: true, range: unitAttackRange(state.world, unit, target) })));
    return ranked.length ? eligible.find(target => target.id === ranked[0]) : undefined;
  }
  const candidates: { unit: Unit; distance: number; priority: number }[] = [];
  for (const other of nearbyUnits(state, unit, radius)) {
    if (!raiderCanTarget(state, unit, other.faction) || !atWar(state, unit.faction, other.faction) || other.hp <= 0 || other.inside
      || unitRespectsForbidden(state, unit) && forbiddenTarget(state, other, unit.faction)) continue;
    const d = distance(unit, other);
    if (d >= radius || !canEngage(other) || !inSight(other)) continue;
    // Leaders and warriors are equally dangerous; proximity decides within
    // that tier. Civilians are targets only when no military unit is nearby.
    const priority = isMilitary(other) ? 0 : 1;
    candidates.push({ unit: other, distance: d, priority });
  }
  candidates.sort((a, b) => a.priority - b.priority || a.distance - b.distance);
  let crowdedFallback: Unit | undefined;
  for (const candidate of candidates) {
    // A front line with no free contact cell is already covered. Preserve the
    // military tier, but let reinforcements engage the next accessible soldier.
    if (crowdedFallback && candidate.priority > (isMilitary(crowdedFallback) ? 0 : 1)) break;
    if (candidate.distance > unitAttackRange(state.world, unit, candidate.unit) && !attackSpots(state, unit, candidate.unit, point => unitAttackContact(state, unit, candidate.unit, point)).length) {
      if (unitCanMove(state, unit, candidate.unit) || hasStaticPath(state, unit, candidate.unit, unit.faction, respectsForbidden(state, unit))) crowdedFallback ??= candidate.unit;
      continue;
    }
    // A nearby soldier behind impassable terrain cannot be engaged. Do not let
    // that decoy suppress defense against reachable enemies beside us.
    if ((unit.kind === 'leader' || (unit.kind === 'musketman' || unit.kind === 'archer' || unit.kind === 'horseArcher') || unit.kind === 'slinger') && candidate.distance <= unitAttackRange(state.world, unit, candidate.unit) && unitAttackContact(state, unit, candidate.unit) || unitCanMove(state, unit, candidate.unit) || hasStaticPath(state, unit, candidate.unit, unit.faction, respectsForbidden(state, unit))) return candidate.unit;
  }
  if (crowdedFallback) return crowdedFallback;
  if (!includeBuildings) return;
  const buildings = nearbyBuildings(state, unit, radius).filter(building => raiderCanTarget(state, unit, building.faction) && atWar(state, unit.faction, building.faction)
    && !(unitRespectsForbidden(state, unit) && forbiddenTarget(state, building, unit.faction))
    && !isRoute(building.kind) && building.kind !== 'irrigation' && !isFarmKind(building.kind) && buildingTargetable(building)
    && !palaceDefenses(state, building).length
    && edgeDistance(unit, building) < radius && canEngage(building) && inSight(building));
  const ranked = battleSupport(state, 5, unit, unit.faction, unit.id,
    buildings.map(target => ({ target, hostile: true, range: radius })));
  const byId = new Map(buildings.map(building => [building.id, building]));
  buildings.length = 0;
  for (let row = 0; row < ranked.length; row += 3) buildings.push(byId.get(ranked[row])!);
  // Enter through an existing opening to attack the city before demolishing its
  // perimeter. A sealed city's non-wall objective remains the siege destination;
  // fight() breaches only the blocking section, then resumes the same approach.
  const objectives = buildings.filter(building => !isWallKind(building.kind));
  let crowdedObjective: Building | undefined;
  for (const objective of objectives) {
    if (!canReachAttack(state, unit, objective)) continue;
    crowdedObjective ??= objective;
    // A covered house does not need every reinforcement waiting for the same
    // contact cell. Other accessible buildings remain above every wall.
    if (targetDistance(unit, objective) <= unitAttackRange(state.world, unit, objective) && unitAttackContact(state, unit, objective)
        && (unit.range > 1.5 || !isNarrowPassage(state, unit, unit.faction))
      || attackSpots(state, unit, objective, point => unitAttackContact(state, unit, objective, point))
        .some(point => (unit.range > 1.5 || !isNarrowPassage(state, point, unit.faction)) && hasStaticPath(state, unit, point, unit.faction, respectsForbidden(state, unit)))) return objective;
  }
  return crowdedObjective ?? objectives[0] ?? buildings[0];
}
const towerApproaches = new WeakMap<Unit, { tower: number; cell: number; revision: number; until: number; reachable: boolean }>();
function reachableTower(state: GameState, unit: Unit, tower: Building): boolean {
  const cell = Math.floor(unit.y) * state.world.width + Math.floor(unit.x), revision = state.world.revision ?? 0;
  const previous = towerApproaches.get(unit);
  if (previous?.tower === tower.id && previous.cell === cell && previous.revision === revision && previous.until > state.time) return previous.reachable;
  const reachable = attackSpots(state, unit, tower, point => unitAttackContact(state, unit, tower, point))
    .some(point => unitCanMove(state, unit, point) || hasStaticPath(state, unit, point, unit.faction, respectsForbidden(state, unit)));
  towerApproaches.set(unit, { tower: tower.id, cell, revision, until: state.time + .8, reachable });
  return reachable;
}
const failedApproaches = new WeakMap<Unit, { target: number; x: number; y: number; fromX: number; fromY: number; revision: number; until: number }>();
function defensiveAnchor(unit: Unit): Point | undefined {
  return unit.retinueStance === 'defensive' && !unit.garrison && !unit.training && !unit.joiningRetinue && !unit.forcedAttack && !unit.attackReturn && unit.recallIssuedAt === undefined && unit.order !== 'flee' ? unit.defensiveAnchor : undefined;
}
function approachPoint(state: GameState, unit: Unit, target: Unit | Building): Point | undefined {
  // Navigation goals must remain coordinates. Spreading a whole target unit
  // here recursively copied its pathGoal into opposing units and saved games.
  const goal = isBuilding(target) ? center(target) : { x: target.x, y: target.y };
  const anchor = defensiveAnchor(unit);
  const failed = failedApproaches.get(unit);
  // Retry a blocked combat arrangement on its decision clock, not after first
  // repeating the same expensive crowded search on every movement substep.
  if (!anchor && unit.kind !== 'militia' && failed && failed.target === target.id
    && failed.x === Math.floor(goal.x) && failed.y === Math.floor(goal.y)
    && failed.fromX === Math.floor(unit.x) && failed.fromY === Math.floor(unit.y)
    && failed.revision === (state.world.revision ?? 0) && state.time < failed.until) return { ...goal };
  // Player sight is shared and independent of the proposed contact point.
  // Other factions still need line of sight from each individual candidate.
  let playerTargetVisible: boolean | undefined;
  const inSight = (point: Point) => isHumanFaction(state, unit.faction)
    ? playerTargetVisible ??= withPlayerFaction(state, unit.faction, () => entityVisible(state, target))
    : targetInSight(state, unit, target, point);
  const guardLimits = garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit);
  const garrisonReachable = unit.garrison && guardLimits
    ? createReachabilityQuery(state, unit, unit.faction, guardLimits, respectsForbidden(state, unit)) : undefined;
  const claimed = claimAttackSpot(state, unit, target, point => (!anchor || distance(point, anchor) <= DEFENSIVE_RADIUS)
    && (!respectsForbidden(state, unit) || hasStaticPath(state, unit, point, unit.faction, true))
    && (unit.kind !== 'militia' || militiaCityContains(state, unit, point))
    && inSight(point) && unitAttackContact(state, unit, target, point)
    && (!guardLimits || (garrisonReachable ? garrisonReachable(point) : findPath(state, unit, point, unit.faction, false, guardLimits, undefined, undefined, false, respectsForbidden(state, unit)).length > 0)));
  if (claimed) { failedApproaches.delete(unit); return claimed; }
  if (anchor) return;
  // Temporary military traffic can block every currently free attack slot.
  // Let a guard approach its valid target so normal movement can request a
  // sidestep, instead of freezing at the post exit before issuing any move.
  if (unit.kind === 'militia') return militiaCityContains(state, unit, goal) ? goal : undefined;
  // An unreachable attack order still advances to the nearest reachable edge;
  // physical contact is checked again before damage, and siege units can strike
  // an intervening wall once they reach it.
  failedApproaches.set(unit, { target: target.id, x: Math.floor(goal.x), y: Math.floor(goal.y), fromX: Math.floor(unit.x), fromY: Math.floor(unit.y), revision: state.world.revision ?? 0, until: state.time + .8 });
  return { ...goal };
}
function forbiddenTarget(state: GameState, target: Unit | Building, faction: number): boolean {
  if (!isBuilding(target)) return isForbidden(state, target.x, target.y, faction);
  for (let dy = 0; dy < buildingHeight(target); dy++) for (let dx = 0; dx < buildingWidth(target); dx++)
    if (isForbidden(state, target.x + dx, target.y + dy, faction)) return true;
  return false;
}
const evacuatingForbidden = new WeakSet<Unit>();
const forbiddenRouteVersions = new WeakMap<Unit, number>();
const forbiddenEscapes = new WeakMap<Unit, { revision: number; worldRevision: number; blockers: ReturnType<typeof buildingBlockerView>; guardLimits?: ReadonlySet<number>; point?: Point }>();
const respectsForbidden = (state: GameState, unit: Unit): boolean => unitRespectsForbidden(state, unit) && !evacuatingForbidden.has(unit);
function unitCanMove(state: GameState, unit: Unit, to: Point, blockers?: Parameters<typeof canMove>[4]): boolean {
  const navigation = unitMovementNavigationState(state, unit);
  const guardLimits = garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit);
  if (guardLimits) {
    const buildings = blockers ?? buildingBlockerView(navigation, unit.faction);
    blockers = { has: cell => buildings.has(cell) || guardLimits.has(cell) };
  }
  if (friendlyYield.get(unit)?.playerPush) {
    const buildings = blockers ?? buildingBlockerView(navigation, unit.faction), forbidden = forbiddenCells(state, unit.faction), current = unitCell(state, unit);
    // Player-induced sidesteps never send even an independent unit into a
    // marked zone. Allow an already marked starting cell only so it can exit.
    return canMove(navigation, unit, to, unit.faction, { has: cell => buildings.has(cell) || cell !== current && forbidden.has(cell) });
  }
  return canMove(navigation, unit, to, unit.faction, blockers, respectsForbidden(state, unit));
}

/** Native form of unitCanMove's obstacle composition. Undefined outside a
 * simulation frame, where scalar fixture/editor validation remains in use. */
function nativeUnitProbe(state: GameState, unit: Unit): NativeMoveProbe | undefined {
  const avoid = respectsForbidden(state, unit);
  const layers = nativeMoveLayers(unitMovementNavigationState(state, unit), unit.faction, avoid);
  if (!layers) return;
  const guard = layers.engine.mask(garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit));
  // Player-induced sidesteps never enter a marked zone, even for independent
  // units; an already marked starting cell may only be exited.
  const push = !!friendlyYield.get(unit)?.playerPush;
  return { engine: layers.engine, grid: layers.grid, blockers: layers.blockers, guard,
    forbidden: push ? layers.engine.mask(forbiddenCells(state, unit.faction)) : layers.forbidden,
    exemptCurrent: push, plainForbidden: layers.forbidden };
}

/** Painting over an occupied tile never strands a civilian or teleports it.
 * Its only permitted activity is walking by the shortest physical route to the
 * first unmarked tile; ordinary restricted navigation resumes on exit. */
export function updateForbiddenEvacuation(state: GameState, unit: Unit, dt: number): boolean {
  if (!unitRespectsForbidden(state, unit) || unit.inside || unit.hp <= 0) return false;
  if (!isForbidden(state, unit.x, unit.y, unit.faction)) {
    if (forbiddenEscapes.delete(unit)) { unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
    return false;
  }
  unit.target = undefined;
  clearFriendlyYield(state, unit);
  const revision = forbiddenRevision(state, unit.faction), worldRevision = state.world.revision ?? 0, blockers = buildingBlockerView(state, unit.faction);
  const guardLimits = garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit);
  let escape = forbiddenEscapes.get(unit);
  if (!escape || escape.revision !== revision || escape.worldRevision !== worldRevision || escape.blockers !== blockers || escape.guardLimits !== guardLimits) {
    const width = state.world.width, start = { x: Math.floor(unit.x) + .5, y: Math.floor(unit.y) + .5 };
    const queue = [start], seen = new Set([unitCell(state, start)]);
    const obstacles = guardLimits ? { has: (cell: number) => blockers.has(cell) || guardLimits.has(cell) } : blockers;
    let point: Point | undefined;
    for (let head = 0; head < queue.length && !point && forbiddenCells(state, unit.faction).size < state.world.tiles.length; head++) {
      const current = queue[head];
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const next = { x: current.x + dx, y: current.y + dy };
        const cell = Math.floor(next.y) * width + Math.floor(next.x);
        if (seen.has(cell) || !canMove(state, current, next, unit.faction, obstacles)) continue;
        seen.add(cell);
        if (!isForbidden(state, next.x, next.y, unit.faction)) { point = next; break; }
        queue.push(next);
      }
    }
    // Occupancy is intentionally absent from this search. A failed exit
    // remains impossible until terrain, structures or the designation change.
    escape = { revision, worldRevision, blockers, guardLimits, point };
    forbiddenEscapes.set(unit, escape);
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  unit.moving = false;
  if (escape.point) {
    evacuatingForbidden.add(unit);
    try { advanceUnit(state, unit, escape.point, dt, false, false, true); }
    finally { evacuatingForbidden.delete(unit); }
  }
  return true;
}

interface YieldOrder { point: Point; origin: Point; requester: number; until: number; settledAt?: number; returning?: boolean; playerPush?: boolean; }
const friendlyYield = new WeakMap<Unit, YieldOrder>();
const yieldingUnits = new WeakMap<GameState, Set<Unit>>();
function setFriendlyYield(state: GameState, unit: Unit, order: YieldOrder): void {
  friendlyYield.set(unit, order);
  let units = yieldingUnits.get(state);
  if (!units) { units = new Set(); yieldingUnits.set(state, units); }
  units.add(unit);
}
function clearFriendlyYield(state: GameState, unit: Unit): void {
  friendlyYield.delete(unit);
  yieldingUnits.get(state)?.delete(unit);
}
const acceptedMoveOrders = new WeakMap<Unit, Point>();
const routeVersions = new WeakMap<Unit, number>();
const movementPriority = (unit: Unit): number => unit.kind === 'leader' ? 3
  : unit.collector && unit.collectPhase === 'returning' && (unit.cargo ?? 0) > 0 ? 2.5
  : unit.kind === 'worker' ? 2 : 1;
const unitCell = (state: GameState, point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);
const noDefensiveLimits = new Set<number>();
const defensiveMasks = new WeakMap<Unit, { x: number; y: number; width: number; height: number; cell: number; cells: Set<number> }>();
/** Only searches need a defensive boundary. Ordinary movement already checks
 * its anchor geometrically; retain this small mask while its inputs match. */
function defensiveLimits(state: GameState, unit: Unit, anchor: Point | undefined): ReadonlySet<number> {
  const guardLimits = garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit);
  if (guardLimits) return guardLimits;
  if (!anchor || distance(unit, anchor) > DEFENSIVE_RADIUS) return noDefensiveLimits;
  const { width, height } = state.world, cell = unitCell(state, unit), previous = defensiveMasks.get(unit);
  if (previous && previous.x === anchor.x && previous.y === anchor.y && previous.width === width
    && previous.height === height && previous.cell === cell) return previous.cells;
  const cells = previous?.cells ?? new Set<number>(); cells.clear();
  for (let y = Math.floor(anchor.y) - 6; y <= Math.floor(anchor.y) + 6; y++) for (let x = Math.floor(anchor.x) - 6; x <= Math.floor(anchor.x) + 6; x++) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const index = y * width + x;
    if (Math.hypot(anchor.x - (x + .5), anchor.y - (y + .5)) > DEFENSIVE_RADIUS && index !== cell) cells.add(index);
  }
  defensiveMasks.set(unit, { x: anchor.x, y: anchor.y, width, height, cell, cells });
  return cells;
}
interface MovementSearchScratch { hard: Set<number>; soft: Set<number>; congestion: Map<number, number>; }
const searchScratch = new WeakMap<GameState, { depth: number; items: MovementSearchScratch[] }>();
function acquireMovementSearch(state: GameState): { scratch: MovementSearchScratch; release: () => void } {
  let pool = searchScratch.get(state);
  if (!pool) { pool = { depth: 0, items: [] }; searchScratch.set(state, pool); }
  const index = pool.depth++;
  const scratch = pool.items[index] ??= { hard: new Set(), soft: new Set(), congestion: new Map() };
  scratch.hard.clear(); scratch.soft.clear();
  return { scratch, release: () => { pool!.depth--; } };
}

/** A courier already at an intake frees its cell by delivering this frame.
 * Pulling it away for another traveler instead can jam every palace entrance. */
function readyToEnterPalace(state: GameState, unit: Unit): boolean {
  if (!unit.collector || unit.collectPhase !== 'returning' || unit.inside) return false;
  const palace = indexedBuilding(state, unit.home);
  return !!palace && palace.kind === 'palace' && palace.faction === unit.faction && buildingReady(palace)
    && constructionEdges(state, palace).some(point => distance(point, unit) < .2);
}

/** Only the player's company can ask known nonhostile factions to sidestep.
 * Wildlife and hostile soldiers retain their normal physical blocking. */
function canRequestNeutralYield(state: GameState, requester: Unit, blocker: Unit): boolean {
  if (!isHumanFaction(state, requester.faction) || requester.villageId !== undefined || requester.guardPost !== undefined
    || requester.kind !== 'leader' && !isRetinueMember(requester) || blocker.faction <= 0) return false;
  const village = state.villages?.find(candidate => candidate.faction === blocker.faction);
  if (village) return villageRelationView(state, village, requester.faction) !== 'war';
  const faction = factionOf(state, blocker.faction);
  return faction?.relation === 'peace' || faction?.relation === 'confederated';
}

/** Reserve one neighboring vacancy. Neutral units walk this short sidestep at
 * their usual speed; a crowded or sealed pocket never triggers relocation. */
function requestNeutralYield(state: GameState, requester: Unit, blocker: Unit, next: Point): boolean {
  const existing = friendlyYield.get(blocker);
  if (existing?.playerPush && distance(blocker, existing.point) > .12 && (blocker.stuckFor ?? 0) < .8) return true;
  const buildings = buildingBlockerView(state, blocker.faction), occupied = unitOccupancy(state, blocker);
  const forbidden = forbiddenCells(state, blocker.faction), current = unitCell(state, blocker);
  const obstacles = { has: (cell: number) => buildings.has(cell) || cell !== current && (forbidden.has(cell) || occupied.has(cell)) };
  const reserved = new Set<number>();
  for (const other of state.units) {
    const order = friendlyYield.get(other);
    if (order && unitObstructs(blocker, other)) reserved.add(unitCell(state, order.point));
  }
  const dx = next.x - requester.x, dy = next.y - requester.y, length = Math.hypot(dx, dy) || 1;
  const candidates: { point: Point; score: number }[] = [];
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const point = { x: Math.floor(blocker.x) + ox + .5, y: Math.floor(blocker.y) + oy + .5 };
    if (reserved.has(unitCell(state, point)) || !unitCanMove(state, blocker, point, obstacles)) continue;
    const lateral = Math.abs(ox * dy - oy * dx) / length, forward = (ox * dx + oy * dy) / length;
    candidates.push({ point, score: lateral * 4 + forward * .8 - distance(blocker, point) });
  }
  candidates.sort((a, b) => b.score - a.score || a.point.y - b.point.y || a.point.x - b.point.x);
  const point = candidates[0]?.point;
  if (!point) return false;
  const terrainSpeed = Math.min(1, movementMultiplier(state, blocker.x, blocker.y), movementMultiplier(state, point.x, point.y));
  setFriendlyYield(state, blocker, { point, origin: existing?.origin ?? { x: blocker.x, y: blocker.y }, requester: requester.id,
    until: state.time + 6 / terrainSpeed, playerPush: true });
  blocker.path = undefined; blocker.pathGoal = undefined; blocker.repathAt = 0;
  return true;
}

const failedYieldRequests = new WeakMap<Unit, { state: GameState; until: number; at: number; blocker: Unit; from: number; to: number; revision: number }>();

/** Reserve a free sidestep, or clear a short chain of allies toward a vacancy.
 * Stable priority/id arbitration prevents two approaching units from repeatedly
 * asking each other to reverse. The original order is never overwritten. */
function requestFriendlyYield(state: GameState, requester: Unit, next: Point): boolean {
  const blocker = cellOccupant(state, next, requester);
  if (!blocker || blocker.kind === 'fieldCannon') return false;
  if (blocker.faction !== requester.faction) return canRequestNeutralYield(state, requester, blocker)
    && requestNeutralYield(state, requester, blocker, next);
  const marchingLeader = movementModeFor(state, requester.faction) === 'formation' && isHumanFaction(state, requester.faction)
    && isSoldier(requester) && isSoldier(blocker) && requester.order === 'follow' && blocker.order === 'follow'
    && requester.target === undefined && blocker.target === undefined ? indexedLeader(state, requester.faction) : undefined;
  // The Leader now passes freely through its company. In an open marching mob,
  // escorts must keep following their moving slots instead of repeatedly
  // parking one another behind the group. Physical collision and rerouting
  // still apply; narrow columns retain their cooperative sidesteps.
  if (marchingLeader?.moving && retinueFormation(state, marchingLeader).mode === 'mob') return false;
  if (readyToEnterPalace(state, blocker)) return false;
  const principal = requester;
  if (!nativeRetinueYieldAllowed(state, requester, blocker)) return false;
  if (requester.kind !== 'leader' && blocker.retinueStance === 'hold' && !blocker.forcedAttack && blocker.recallIssuedAt === undefined) return false;
  // A rear rank must flank a fighting ally, rather than pull it out of combat.
  // Directly controlled leaders retain the right of way.
  if (requester.kind !== 'leader' && blocker.target !== undefined && state.time - blocker.lastCombat < 1.5) return false;
  const existing = friendlyYield.get(blocker);
  if (existing && distance(blocker, existing.point) > .12 && (blocker.stuckFor ?? 0) < .8) return true;
  const blockerBusy = blocker.moving || !!blocker.destination && distance(blocker, blocker.destination) > .12 || !!blocker.path?.length;
  if ((blockerBusy || blocker.kind === 'leader') && (movementPriority(blocker) > movementPriority(principal) || movementPriority(blocker) === movementPriority(principal) && blocker.id < principal.id)) {
    if (existing) clearFriendlyYield(state, blocker);
    return false;
  }
  // A pair boxed by static terrain need not probe the same walls every frame.
  // Failures involving other actors stay live: their next move can expose a
  // vacancy even while this requester and blocker remain in the same cells.
  const previousFailure = failedYieldRequests.get(requester);
  const from = unitCell(state, requester), to = unitCell(state, blocker), revision = state.world.revision ?? 0;
  if (requester.kind !== 'leader' && previousFailure?.state === state && previousFailure.blocker === blocker
    && previousFailure.from === from && previousFailure.to === to && previousFailure.revision === revision
    && state.time >= previousFailure.at && state.time < previousFailure.until) return false;
  if (existing) clearFriendlyYield(state, blocker);
  const dx = next.x - requester.x, dy = next.y - requester.y, length = Math.hypot(dx, dy) || 1;
  const reserved = new Set<number>();
  const yielding = yieldingUnits.get(state), units = entityStore(state).units;
  if (yielding) for (const unit of yielding) {
    if (units.get(unit.id) !== unit) { yielding.delete(unit); continue; }
    const order = friendlyYield.get(unit)!;
    if (unitsCollide(requester, unit) && distance(unit, order.point) > .12) reserved.add(unitCell(state, order.point));
  }
  const visited = new Set<number>([requester.id, principal.id]);
  let dynamicObstruction = false;
  const clear = (unit: Unit, depth: number): boolean => {
    if (depth > 32 || visited.has(unit.id) || readyToEnterPalace(state, unit)) return false;
    if (principal.kind !== 'leader' && unit.retinueStance === 'hold' && !unit.forcedAttack && unit.recallIssuedAt === undefined) return false;
    visited.add(unit.id);
    const candidates: { point: Point; score: number; occupant?: Unit }[] = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const point = { x: Math.floor(unit.x) + ox + .5, y: Math.floor(unit.y) + oy + .5 }, index = unitCell(state, point);
      if (reserved.has(index) || !unitCanMove(state, unit, point)) continue;
      const occupant = lastCollidingUnitInCell(state, index, requester);
      if (occupant && occupant !== requester && occupant !== principal) dynamicObstruction = true;
      if (occupant && (occupant.faction !== requester.faction || visited.has(occupant.id) || movementPriority(occupant) > movementPriority(principal))) continue;
      const lateral = Math.abs(ox * dy - oy * dx) / length, forward = (ox * dx + oy * dy) / length;
      // A side pocket wins; in a one-cell corridor, advance away from the
      // requester until a passing place becomes available.
      candidates.push({ point, occupant, score: lateral * 4 + forward * .8 - distance(unit, point) - (occupant ? 8 : 0) });
    }
    candidates.sort((a, b) => b.score - a.score || a.point.y - b.point.y || a.point.x - b.point.x);
    for (const candidate of candidates) {
      if (candidate.occupant && !clear(candidate.occupant, depth + 1)) continue;
      reserved.add(unitCell(state, candidate.point));
      const oldOrder = unit === blocker ? existing : friendlyYield.get(unit);
      // Slow terrain needs time for both the sidestep and the requester to pass.
      const terrainSpeed = Math.min(1, movementMultiplier(state, unit.x, unit.y), movementMultiplier(state, candidate.point.x, candidate.point.y), movementMultiplier(state, requester.x, requester.y));
      setFriendlyYield(state, unit, { point: candidate.point, origin: oldOrder?.origin ?? { x: unit.x, y: unit.y }, requester: principal.id, until: state.time + 6 / terrainSpeed });
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      return true;
    }
    return false;
  };
  const yielded = clear(blocker, 0);
  if (!yielded && existing) setFriendlyYield(state, blocker, existing);
  if (yielded || dynamicObstruction) failedYieldRequests.delete(requester);
  else failedYieldRequests.set(requester, { state, at: state.time, until: state.time + CHECK_INTERVAL, blocker, from, to, revision });
  return yielded;
}

/** Called before normal unit work so held soldiers and neutral units can also
 * yield. A held unit returns to its post once the crossing has cleared. */
export function updateFriendlyYield(state: GameState, unit: Unit, dt: number): boolean {
  // Birds follow their wetland routes; ordinary sidesteps only understand land.
  if (unit.kind === 'marshBird') { clearFriendlyYield(state, unit); return false; }
  const order = friendlyYield.get(unit);
  if (!order) return false;
  if (respectsForbidden(state, unit) && isForbidden(state, order.point.x, order.point.y, unit.faction)) { clearFriendlyYield(state, unit); return false; }
  if (readyToEnterPalace(state, unit)) { clearFriendlyYield(state, unit); return false; }
  if (unit.hp <= 0 || unit.inside || state.time >= order.until) { clearFriendlyYield(state, unit); return false; }
  const requester = indexedUnit(state, order.requester);
  if (order.playerPush && (!requester || requester.hp <= 0 || requester.inside || !canRequestNeutralYield(state, requester, unit)
    || isForbidden(state, order.point.x, order.point.y) || !unitCanMove(state, unit, order.point))) {
    clearFriendlyYield(state, unit); unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    return false;
  }
  if (distance(unit, order.point) > .12) { moveUnit(state, unit, order.point, dt, !!order.playerPush); return true; }
  order.settledAt ??= state.time;
  if (state.time - order.settledAt < .35) return true;
  const cleared = !requester || distance(requester, order.origin) > 1.5 || (!requester.moving && !requester.destination && state.time - order.settledAt > 1);
  if (!cleared && !order.returning) return true;
  const buildings = buildingBlockerView(state, unit.faction), occupied = unitOccupancy(state, unit);
  const returnBlockers = { has: (cell: number) => buildings.has(cell) || occupied.has(cell) };
  if (unit.order === 'hold' && !order.returning && (!order.playerPush || !isForbidden(state, order.origin.x, order.origin.y))
    && unitCanMove(state, unit, order.origin, returnBlockers)) {
    const terrainSpeed = Math.min(1, movementMultiplier(state, unit.x, unit.y), movementMultiplier(state, order.origin.x, order.origin.y));
    order.point = order.origin; order.returning = true; order.settledAt = undefined; order.until = state.time + 3 / terrainSpeed;
    return true;
  }
  clearFriendlyYield(state, unit); unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  return false;
}

export function moveUnit(state: GameState, unit: Unit, goal: Point, dt: number, direct = false, allowPartial = false, ignoreDefensivePost = false): void {
  // Road artillery is dispatched exclusively through its native movement engine.
  if (unit.kind === 'fieldCannon') return;
  clearMovementPathDeferred(state, unit);
  const profile = movementProfile(state), started = profile ? performance.now() : 0;
  const cavalryFrom = (unit.kind === 'horseman' || unit.kind === 'knight') ? { x: unit.x, y: unit.y } : undefined;
  try { if (!updateForbiddenEvacuation(state, unit, dt)) advanceUnit(state, unit, goal, dt, direct, allowPartial, ignoreDefensivePost, profile); }
  finally {
    if (canUseRowboat(unit)) refreshCivilianRowboat(state, unit);
    if (cavalryFrom) recordCavalryMovement(state, unit, cavalryFrom, dt);
    refreshFogUnit(state, unit);
    if (profile) { profile.calls++; profile.movementMs += performance.now() - started; }
  }
}
const routeChecks = new WeakMap<Unit, { state: GameState; validatedAt?: number; plannedAt?: number }>();
function advanceUnit(state: GameState, unit: Unit, goal: Point, dt: number, direct: boolean, allowPartial: boolean, ignoreDefensivePost: boolean,
  profile = movementProfile(state), routeContinuation = 0): void {
  const navigation = unitNavigationState(state, unit);
  const avoidForbidden = respectsForbidden(state, unit);
  if (avoidForbidden && isForbidden(state, goal.x, goal.y, unit.faction)) { unit.moving = false; unit.path = undefined; unit.pathGoal = undefined; return; }
  if (avoidForbidden && forbiddenRouteVersions.get(unit) !== forbiddenRevision(state, unit.faction)) {
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    forbiddenRouteVersions.set(unit, forbiddenRevision(state, unit.faction));
  }
  if (distance(unit, goal) < (unit.infantryDrillLeader !== undefined || isScheduledMarauder(unit) ? .001 : .12)) { unit.moving = false; unit.path = undefined; return; }
  const occupied = unitOccupancy(state, unit);
  const anchor = ignoreDefensivePost ? undefined : defensiveAnchor(unit);
  const cell = (point: Point): number => unitCell(state, point);
  let next = goal;
  if (!direct) {
    const revision = state.world.revision ?? 0, previousRevision = routeVersions.get(unit);
    let checks = routeChecks.get(unit);
    if (!checks || checks.state !== state || state.time < (checks.validatedAt ?? -Infinity) || state.time < (checks.plannedAt ?? -Infinity)) {
      checks = { state }; routeChecks.set(unit, checks);
    }
    const trusted = simulationReadsActive(state);
    const validateDue = !trusted || state.time + 1e-9 >= (checks.validatedAt ?? -Infinity) + CHECK_INTERVAL;
    const planDue = !trusted || state.time + 1e-9 >= (checks.plannedAt ?? -Infinity) + REPLAN_INTERVAL;
    let stale = previousRevision !== revision;
    const validationStarted = profile && stale ? performance.now() : 0;
    // A distant farm or road edit must not make the whole army reroute. Keep
    // a valid journey; new obstructions and elevation edges still invalidate
    // it immediately, and movement continues checking the next swept edge.
    if (stale && !validateDue && unit.path?.length) stale = false;
    if (stale && validateDue) checks.validatedAt = state.time;
    if (stale && previousRevision !== undefined && unit.path?.length
      && unitCanMove(state, unit, unit.path[0])
      && unit.path.every((point, index, path) => canWalk(navigation, point.x, point.y, unit.faction, undefined, respectsForbidden(state, unit))
        && (!index || canTraverseNavigationEdge(navigation, path[index - 1], point)))) {
      routeVersions.set(unit, revision); stale = false;
    }
    if (profile && previousRevision !== revision) profile.routeValidationMs += performance.now() - validationStarted;
    const needsPlan = !routeContinuation && planDue
      && (stale || !unit.pathGoal || distance(unit.pathGoal, goal) > 0.8 || !unit.path?.length)
      && state.time >= (unit.repathAt ?? 0);
    if (needsPlan && requestMovementPath(state, unit, unit.kind === 'leader' && isHumanFaction(state, unit.faction))) {
      checks.plannedAt = state.time;
      const limits = defensiveLimits(state, unit, anchor), { scratch, release } = acquireMovementSearch(state);
      const { hard, soft } = scratch;
      try {
        for (const cell of limits) hard.add(cell);
        const congestionStarted = profile ? performance.now() : 0;
        const congestion = movementCongestion(state, unit, (other, occupiedCell) => {
          const fighting = other.target !== undefined && state.time - other.lastCombat < 1.5;
          const settled = !!other.destination && distance(other, other.destination) < .2 && !friendlyYield.has(other);
          const canYield = canRequestNeutralYield(state, unit, other)
            || other.faction === unit.faction && (unit.kind === 'leader' || !fighting && !settled && other.kind !== 'leader');
          (canYield ? soft : hard).add(occupiedCell);
        }, scratch.congestion);
        if (profile) profile.congestionMs += performance.now() - congestionStarted;
        const roadBuilder = unit.kind === 'merchant';
        const searchStarted = profile ? performance.now() : 0;
        if (profile) profile.pathSearches++;
        unit.path = findPath(navigation, unit, goal, unit.faction, allowPartial || occupied.has(cell(goal)), hard, soft, congestion, roadBuilder, avoidForbidden);
        // A crowded choke point is not a permanent wall. Keep a static route so
        // the first blocker can be asked to yield, instead of declaring failure.
        if (!unit.path.length) {
          if (profile) profile.pathSearches++;
          unit.path = findPath(navigation, unit, goal, unit.faction, allowPartial, limits, undefined, undefined, roadBuilder, avoidForbidden);
        }
        if (profile) profile.pathSearchMs += performance.now() - searchStarted;
      } finally { release(); }
      unit.pathGoal = { ...goal }; routeVersions.set(unit, state.world.revision ?? 0);
      // Short re-plan delays keep pursuit of moving targets responsive (2026-11-13).
      unit.repathAt = state.time + (unit.path.length ? .2 : .5) + (unit.id % 5) * .02;
    }
    if (civilianFootprint(unit)) while ((unit.path?.length ?? 0) > 1 && distance(unit, unit.path![0]) < .45
      && unitCanMove(state, unit, unit.path![1])) unit.path!.shift();
    while (unit.path?.length && distance(unit, unit.path[0]) < (isScheduledMarauder(unit) ? .001 : .12)) {
      const node = unit.path[0];
      if ((occupied.has(cell(node)) && cell(node) !== cell(unit)) || !unitCanMove(state, unit, node)) break;
      unit.x = node.x; unit.y = node.y; unit.path.shift();
    }
    if (!unit.path?.length) {
      unit.moving = false;
      if (!movementPathDeferred(state, unit)) unit.stuckFor = (unit.stuckFor ?? 0) + dt;
      return;
    }
    next = unit.path[0];
    // Off-center diagonal travel can clip a neighboring occupied cell even
    // when the next path cell is free. Recenter before that corner instead of
    // repeatedly asking the oncoming traveler to abandon its own route.
    const currentCell = cell(unit);
    const centered = { x: Math.floor(unit.x) + .5, y: Math.floor(unit.y) + .5 };
    if (Math.floor(next.x) !== Math.floor(unit.x) && Math.floor(next.y) !== Math.floor(unit.y)
      && (unit.stuckFor ?? 0) > .65 && distance(unit, centered) > .01 && !occupied.has(cell(next))
      && (occupied.has(Math.floor(unit.y) * state.world.width + Math.floor(next.x))
        || occupied.has(Math.floor(next.y) * state.world.width + Math.floor(unit.x)))) {
      const staticBlockers = buildingBlockerView(state, unit.faction);
      const blockers = { has: (index: number) => staticBlockers.has(index) || index !== currentCell && occupied.has(index) };
      if (!unitCanMove(state, unit, next, blockers)
        && unitCanMove(state, unit, centered, blockers)) {
        unit.path.unshift(centered); next = centered;
      }
    }
    if (occupied.has(cell(next)) && cell(next) !== cell(unit)) requestFriendlyYield(state, unit, next);
  }
  let dx = next.x - unit.x, dy = next.y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length < (isScheduledMarauder(unit) ? 1e-7 : unit.infantryDrillLeader !== undefined ? .001 : .01)) return;
  const steeringStarted = profile ? performance.now() : 0;
  const formationSpeed = unit.infantryDrillLeader === undefined && isHumanFaction(state, unit.faction) && unit.kind === 'leader' && movementModeFor(state, unit.faction) === 'formation' ? .75 : 1;
  const speed = whalingMovementSpeed(state, unit.faction, unit.speed) * formationSpeed * movementMultiplier(navigation, unit.x, unit.y) * (unit.order === 'flee' ? 0.95 : 1) * fleeingAbilityMultiplier(unit);
  const occupancy = nativeMovement(state), probe = occupancy.resident(unit) ? nativeUnitProbe(state, unit) : undefined;
  const steered = probe && occupancy.steer(unit, probe, next, speed, dt, anchor, DEFENSIVE_RADIUS);
  if (steered) {
    // Rust owns the step, axis slides and resident transform. Yield arbitration
    // stays here: a traffic report means an ally may be asked to sidestep.
    const traffic = !!(steered.status & STEER_TRAFFIC), moving = steered.moving, facing = steered.facing;
    if (traffic) requestFriendlyYield(state, unit, { x: steered.candidate.x, y: steered.candidate.y });
    if (steered.status & STEER_BLOCKED && (!traffic || (unit.stuckFor ?? 0) > .65 && !friendlyYield.has(unit))) {
      unit.path = []; unit.repathAt = state.time + CHECK_INTERVAL;
    }
    unit.moving = moving;
    if (moving) { unit.facing = facing; unit.stuckFor = 0; }
    else unit.stuckFor = (unit.stuckFor ?? 0) + dt;
  } else {
  const step = Math.min(length, speed * dt);
  dx = dx / length * step; dy = dy / length * step;
  // Scalar fallback for direct calls outside a simulation frame. The Leader
  // may stop on a friendly soldier; entering another occupied cell blocks.
  const currentCell = cell(unit);
  const clear = (x: number, y: number): boolean => (!anchor || distance(anchor, unit) > DEFENSIVE_RADIUS + 1e-7 || distance(anchor, { x, y }) <= DEFENSIVE_RADIUS + 1e-7)
    && (cell({ x, y }) === currentCell || !unitPositionBlocked(state, unit, { x, y })) && unitCanMove(state, unit, { x, y });
  const oldX = unit.x, oldY = unit.y;
  if (clear(unit.x + dx, unit.y + dy)) { unit.x += dx; unit.y += dy; }
  else {
    const candidate = { x: unit.x + dx, y: unit.y + dy };
    const traffic = occupied.has(cell(candidate)) && unitCanMove(state, unit, candidate);
    if (traffic) requestFriendlyYield(state, unit, candidate);
    // Preserve the intended corridor while an ally yields. Reconsider a
    // moving blockage after a short delay instead of issuing A* every frame.
    if (!traffic || (unit.stuckFor ?? 0) > .65 && !friendlyYield.has(unit)) { unit.path = []; unit.repathAt = state.time + CHECK_INTERVAL; }
    if (!traffic && clear(unit.x + dx, unit.y)) unit.x += dx;
    else if (!traffic && clear(unit.x, unit.y + dy)) unit.y += dy;
  }
  unit.moving = Math.hypot(unit.x - oldX, unit.y - oldY) > .001;
  if (unit.moving) { unit.facing = Math.atan2(unit.y - oldY, unit.x - oldX); unit.stuckFor = 0; }
  else unit.stuckFor = (unit.stuckFor ?? 0) + dt;
  }
  if (profile) profile.steeringMs += performance.now() - steeringStarted;
  // Coarse hidden updates may cover more than one path edge. Spend their full
  // movement budget on the existing route, checking each swept edge, but never
  // repeat A* in the same update. Ordinary units keep their existing stepping.
  const remaining = speed > 0 ? dt - length / speed : 0;
  if (isScheduledMarauder(unit) && !direct && routeContinuation < 31 && remaining > 1e-8
    && unit.moving && distance(unit, next) < .001 && unit.path?.length) {
    refreshIndexedUnit(state, unit);
    advanceUnit(state, unit, goal, remaining, direct, allowPartial, ignoreDefensivePost, profile, routeContinuation + 1);
    unit.moving = true;
  }
}
function losePopulation(state: GameState, unit: Unit): void {
  recordRetinuePopulationLoss(state, unit);
  synchronizeFarms(state);
}
function moraleRally(state: GameState, point: Point, faction: number, amount: number): void {
  for (const unit of state.units) if (unit.faction === faction && isMilitary(unit) && distance(unit, point) < 7) unit.morale = Math.min(unitMoraleMaximum(unit), unit.morale + amount);
}
function rehouse(state: GameState, factionId: number): void {
  const faction = factionOf(state, factionId);
  const awaitingHomes = state.buildings.filter(building => building.faction === factionId && building.kind === 'palace' && buildingReady(building))
    .reduce((total, palace) => total + Math.max(0, (palace.unhousedResidents ?? 0) - palace.capacity), 0);
  if (faction) faction.population = Math.min(faction.population, housingCapacity(state, factionId) + awaitingHomes);
  synchronizeFarms(state);
}
function destroyTarget(state: GameState, attacker: Pick<Unit, 'faction' | 'target'> & Partial<Pick<Unit, 'id'>>, target: Unit | Building, projectileLeaderXp?: number, rewards = true): void {
  if (isBuilding(target) && target.kind === 'irrigation') return;
  if (!isBuilding(target) && target.warship) resolveWarshipLoss(state, target, attacker.faction, (unit, faction) => destroyTarget(state, { faction }, unit, undefined, false));
  if(!isBuilding(target)&&target.barbarianGalley) {
    const passenger=entityStore(state).units.get(target.sailboat?.passenger??-1);
    if(passenger&&passenger.embarkedOn===target.id&&passenger.hp>0){passenger.hp=0;passenger.inside=false;passenger.embarkedOn=undefined;destroyTarget(state,attacker,passenger,undefined,false);}
    if(target.sailboat)target.sailboat.passenger=undefined;
  }
  recordDiplomaticCasualty(state, attacker.faction, target.faction, isBuilding(target) && target.kind === 'palace');
  invalidateFog(state);
  if (rewards && !isBuilding(target) && rewardHunt(state, attacker, target)) { attacker.target = undefined; return; }
  const faction = rewards ? factionOf(state, attacker.faction) : undefined;
  if (isBuilding(target)) {
    recordQuestDestruction(state, target.id, attacker.faction);
    invalidateNavigation(state); invalidateDecisions(state);
    if (target.kind === 'fort') preserveDestroyedFort(state, target);
    else recordDestroyedDefense(state, target);
    if (faction) grantIncome(faction, { gold: target.kind === 'palace' ? 40 : isWallKind(target.kind) ? 5 : 10 }, state, 'loot');
    if (rewards && isHumanFaction(state, attacker.faction)) particle(state, center(target), `+${target.kind === 'palace' ? 40 : isWallKind(target.kind) ? 5 : 10} gold`);
    // A captured palace keeps its resident quarters; do not delete those people
    // before the capture offer records and transfers them with the city.
    const offersCapture = rewards && target.kind === 'palace' && isHumanFaction(state, attacker.faction) && target.faction >= 0 && target.faction !== attacker.faction;
    if (target.kind !== 'fort') recordBuildingDestruction(state, target);
    if (target.capacity > 0 && !offersCapture) rehouse(state, target.faction);
    if (target.kind === 'palace') {
      const defender = factionOf(state, target.faction);
      if (rewards && isHumanFaction(state, attacker.faction) && target.faction >= 0 && target.faction !== attacker.faction) {
        const captures = state.palaceCaptures ??= [];
        if (!captures.some(capture => capture.palaceId === target.id)) captures.push({ ...captureOffer(state, target), captor: attacker.faction });
        if (state.multiplayer) withPlayerFaction(state, attacker.faction, () => resolvePalaceCapture(state, target.id, true));
      }
      if (defender) defender.defeated = !palaceOf(state, target.faction);
      logEvent(state, `${defender?.name ?? 'A rival'}'s town has fallen.`, target.faction === 0 ? 'warning' : 'good');
      if ((state.multiplayer || target.faction !== 0) && defender?.defeated) for (const unit of state.units) if (unit.faction === target.faction) { unit.order = 'flee'; unit.morale = 0; }
    }
  } else {
    recordCampaignCasualty(state, target, attacker.faction, atWar(state, attacker.faction, target.faction));
    recordUnitDeath(state, target);
    invalidateRetinueSquads(state);
    recordBattleDeath(state, target);
    enforceInfantryFormationStrength(state, target.faction);
    const killer = !rewards || attacker.id === undefined ? undefined : entityStore(state).units.get(attacker.id);
    const defeatedLeader = (target.kind === 'leader' || target.marauderLeader) && atWar(state, attacker.faction, target.faction);
    if (defeatedLeader && faction) awardLeaderXp(state, offensiveReward(state, target, LEADER_VICTORY_XP), attacker.faction);
    if (!defeatedLeader && (projectileLeaderXp ?? leaderCombatXp(killer)) && isMilitary(target) && atWar(state, attacker.faction, target.faction))
      awardLeaderXp(state, offensiveReward(state, target, projectileLeaderXp ?? leaderCombatXp(killer)), attacker.faction);
    const experience = offensiveReward(state, target, 1);
    if (killer && !recordGuardKill(state, killer, experience) && !recordRetinueKill(state, killer, experience)) recordKill(killer, experience);
    const bounty = offensiveReward(state, target, target.warship ? target.warship.rewarded ? 0 : settleWarshipBounty(state, target, attacker.faction) : target.kind === 'supplyCart' ? 0 : (defeatedLeader ? target.marauderLeader ? 50 : 200 : target.observationPost ? 20 : target.kind === 'merchant' ? MERCHANT_BOUNTY : target.kind === 'swordsman' || target.kind === 'warrior' || target.kind === 'spearman' ? 6 : 8) + (target.stolenGold ?? 0));
    target.stolenGold = 0;
    if (faction) grantIncome(faction, { gold: bounty }, state, 'loot');
    if (rewards && bounty > 0 && isHumanFaction(state, attacker.faction)) particle(state, target, `+${bounty} gold`);
    if (target.engineer) recordEngineerDeath(state, target);
    if (target.kind === 'worker') { if (recordCivilianCasualty(state, target)) recordSettlementCasualty(state, target, attacker.faction); synchronizeFarms(state); }
    else if (target.kind === 'militia') { if (recordGuardCasualty(state, target)) recordSettlementCasualty(state, target, attacker.faction); }
    else if ((target.kind === 'levyInfantry' || target.kind === 'slinger')) { if (recordLevyCasualty(state, target)) recordSettlementCasualty(state, target, attacker.faction); synchronizeFarms(state); }
    else if (isRetinueMember(target)) { recordOffensiveCasualty(state, target); losePopulation(state, target); }
    if (target.kind === 'leader') {
      if (target.infantryFormation) target.infantryFormation.active = false;
      for (const member of state.units) if (member.infantryDrillLeader === target.id) member.infantryDrillLeader = undefined;
      const defender = factionOf(state, target.faction);
      recordLeaderDeath(state, target, hostWallClock(state));
      logEvent(state, `${defender?.name ?? 'A rival'}'s leader has fallen.`, target.faction === 0 ? 'warning' : 'good');
      if (state.multiplayer || target.faction !== 0) for (const unit of state.units) if (unit.faction === target.faction) { unit.order = 'flee'; unit.morale = 0; }
    }
  }
  if (rewards) moraleRally(state, target, attacker.faction, 18);
  // Unit losses use the local proportional casualty threshold; a flat loss per
  // death would rout even a huge army after the same handful of casualties.
  if (isBuilding(target)) for (const unit of state.units) if (unit.faction === target.faction && isMilitary(unit) && distance(unit, target) < 5) unit.morale = Math.max(0, unit.morale - 12);
  attacker.target = undefined;
  if (isBuilding(target) || target.kind === 'leader') updateWallOwnership(state);
  if (isBuilding(target) && (isWallKind(target.kind) || target.kind === 'road')) updateWallStats(state, true);
}

/** A defeated palace becomes a completed player city only after their choice. */
export function resolvePalaceCapture(state: GameState, palaceId: number, capture: boolean): { ok: boolean; message: string; palace?: Building } {
  const offer = state.palaceCaptures?.find(candidate => candidate.palaceId === palaceId);
  if (!offer || offer.captor !== undefined && offer.captor !== playerFaction(state)) return { ok: false, message: 'This town is no longer awaiting your decision.' };
  const player = factionOf(state, playerFaction(state));
  if (capture && !player) return { ok: false, message: 'No player faction is available.' };
  invalidateDecisions(state);
  let palace: Building | undefined;
  if (capture) {
    cancelBuildingDestruction(state, palaceId);
    // Keep a new identity so old attack/repair orders cannot become friendly
    // orders by accidentally reusing the destroyed palace's id.
    const minimumId = Math.max(palaceId, ...state.palaceCaptures!.map(candidate => candidate.palaceId)) + 1;
    palace = makeBuilding(state, 'palace', playerFaction(state), offer, minimumId);
    palace.cityName = offer.cityName;
    palace.previousSovereign = offer.faction;
    palace.hp = palace.maxHp * .1;
    notifyRepairJobChanged(state, palace);
    palace.lastAttacked = state.time;
    transferCapturedCity(state, offer, palace);
    if (!captureSecededCity(state, offer.faction, palace, palaceId))
      settlements(state).commitTransfer(palaceId, palace.id, palace.faction, TRANSFER.capture);
    clearBuildingFootprint(state, palace);
    addPalaceRoadRing(state, palace);
    player!.defeated = false;
    markWorldChanged(state.world);
    invalidateNavigation(state); invalidateFog(state);
    updateWallOwnership(state);
    synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state);
    for (const faction of state.factions) calculateYields(state, faction);
    logEvent(state, `${offer.cityName} has been captured. Its town stands at 10% health.`, 'good');
  } else {
    logEvent(state, `${offer.cityName}'s town was left destroyed.`, 'info');
  }
  state.palaceCaptures = state.palaceCaptures!.filter(candidate => candidate.palaceId !== palaceId);
  return { ok: true, message: capture ? `${offer.cityName} captured.` : 'Town left destroyed.', palace };
}
function launchJavelin(state: GameState, attacker: Pick<Unit, 'id' | 'faction'>, from: Point, target: Unit | Building, damage: number, startHeight = .48, kind?: 'bullet'): void {
  const targetPoint = isBuilding(target) ? center(target) : target;
  const start = { x: from.x, y: from.y }, end = { x: targetPoint.x, y: targetPoint.y };
  (state.projectiles ??= []).push({ ...start, start, end, attacker: attacker.id, target: target.id,
    faction: attacker.faction, damage, startHeight, kind, elapsed: 0, duration: kind === 'bullet'
      ? rustEngine.projectiles_duration_for_kind(start.x, start.y, end.x, end.y, 4) : projectileDuration(start, end),
    leaderXp: leaderCombatXp(indexedUnit(state, attacker.id)) });
  if (!isBuilding(target)) target.lastCombat = state.time;
}
/** AI civilizations (not human realms or villages) fight marauders at +100%
 * attack and +100% defense: their troops double these stats in any exchange. */
export const AI_VERSUS_MARAUDER_MULTIPLIER = 2;
function aiMarauderEdge(state: GameState, side: { faction: number }, opponent: { faction: number }): number {
  if (side.faction < 0 || opponent.faction !== -2 || isHumanFaction(state, side.faction)) return 1;
  return factionOf(state, side.faction)?.villageId === undefined ? AI_VERSUS_MARAUDER_MULTIPLIER : 1;
}
/** Outgoing damage of one hit, including the AI-versus-marauder matchup. */
function combatUnitDefense(state: GameState, unit: Unit): number {
  const faction = factionOf(state, unit.faction);
  return unitDefense(unit, faction, culturalHomeGround(state, faction, unit));
}
function combatHitDamage(state: GameState, attacker: Unit, target: Unit | Building): number {
  const edge = aiMarauderEdge(state, attacker, target);
  const faction = factionOf(state, attacker.faction);
  const defense = (isBuilding(target) ? buildingArmor(target, factionOf(state, target.faction)) : combatUnitDefense(state, target)) * aiMarauderEdge(state, target, attacker);
  return unitDamage(edge === 1 ? attacker : { ...attacker, attack: attacker.attack * edge }, defense, faction, culturalHomeGround(state, faction, attacker));
}
function attackTarget(state: GameState, attacker: Unit, target: Unit | Building): void {
  if (attacker.kind === 'fieldCannon') return; // Its native weapon system owns every shot.
  if (attacker.kind === 'scout') return;
  if (isBuilding(target) && (isFarmKind(target.kind) || target.kind === 'irrigation' || !buildingTargetable(target) || palaceDefenses(state, target).length) || attacker.cooldown > 0 || attacker.attack <= 0 || target.hp <= 0 || targetDistance(attacker, target) > unitAttackRange(state.world, attacker, target) || !targetInSight(state, attacker, target) || !unitAttackContact(state, attacker, target)) return;
  const targetPoint = isBuilding(target) ? center(target) : target;
  // Snapshot the outgoing formation bonus now. A projectile keeps its launch
  // strength if its soldier turns, leaves formation, or dies before impact.
  const amount = combatHitDamage(state, attacker, target)
    * leaderAttackAura(state, attacker) * infantryAttackMultiplier(state, attacker, targetPoint) * marauderFortificationMultiplier(state, attacker, target)
    * (attacker.kind === 'leader' && isBuilding(target) && (isWallKind(target.kind) || ['tower', 'woodenTower', 'guardPost', 'fort'].includes(target.kind) || target.kind === 'palace' && target.palaceLevel === 2) ? .1 : 1);
  const timing = unitAttackTiming(attacker);
  attacker.cooldown = infantryAttackCooldown(state, attacker, timing.cooldown);
  attacker.attackTime = timing.animation;
  attacker.lastCombat = state.time;
  attacker.facing = infantryFormationLeader(state, attacker)?.infantryFormation?.heading
    ?? Math.atan2(targetPoint.y - attacker.y, targetPoint.x - attacker.x);
  if (!isBuilding(target)) target.lastCombat = state.time;
  if (attacker.kind === 'musketman' || attacker.kind === 'leader' || (attacker.kind === 'archer' || attacker.kind === 'horseArcher') || attacker.kind === 'skirmisher' || attacker.kind === 'slinger' || attacker.wallPatrol?.wall !== undefined) {
    launchJavelin(state, attacker, attacker, target, amount, .48, usesFirearm(state, attacker) ? 'bullet' : undefined);
    if (attacker.kind === 'slinger') state.projectiles![state.projectiles!.length - 1].kind = 'stone';
    if ((attacker.kind === 'archer' || attacker.kind === 'horseArcher')) state.projectiles![state.projectiles!.length - 1].kind = 'arrow';
  } else {
    if (tryCavalryCharge(state, attacker, target, {
      hostile: (a, b) => atWar(state, a, b),
      clear: victim => targetInSight(state, attacker, victim) && hasAttackContact(state, attacker, attacker.faction, victim),
      hit: (victim, multiplier) => applyMeleeHit(state, attacker, victim,
        combatHitDamage(state, attacker, victim) * leaderAttackAura(state, attacker) * multiplier
          * infantryAttackMultiplier(state, attacker, isBuilding(victim) ? center(victim) : victim) * marauderFortificationMultiplier(state, attacker, victim)),
    })) return;
    const pierced = !isBuilding(target) ? spearPiercingTargets(state, attacker, target, (a, b) => atWar(state, a, b),
      unit => targetInSight(state, attacker, unit) && hasAttackContact(state, attacker, attacker.faction, unit)) : [];
    applyMeleeHit(state, attacker, target, amount);
    for (const victim of pierced) applyMeleeHit(state, attacker, victim,
      combatHitDamage(state, attacker, victim) * leaderAttackAura(state, attacker) * SPEAR_PIERCE_DAMAGE_MULTIPLIER
        * infantryAttackMultiplier(state, attacker, victim));
  }
}

/** A pikeman's thrust shoves a struck enemy back along the line of the attack,
 * only onto ground it could walk to itself; walls, water and crowds stop it. */
export const PIKE_KNOCKBACK_TILES = .35;
function pikeKnockback(state: GameState, attacker: Unit, target: Unit): void {
  if (target.inside || target.garrison || target.kind === 'sailboat' || target.embarkedOn !== undefined) return;
  const dx = target.x - attacker.x, dy = target.y - attacker.y, length = Math.hypot(dx, dy);
  if (length < .001) return;
  const to = { x: target.x + dx / length * PIKE_KNOCKBACK_TILES, y: target.y + dy / length * PIKE_KNOCKBACK_TILES };
  if (!canWalk(state, to.x, to.y, target.faction) || !canMove(state, target, to, target.faction)) return;
  if (target.kind === 'fieldCannon' && !fieldCannonRoadPoint(state, to, target)) return;
  target.x = to.x; target.y = to.y;
  target.path = undefined; target.repathAt = 0;
  refreshIndexedUnit(state, target);
}
function applyMeleeHit(state: GameState, attacker: Unit, target: Unit | Building, amount: number): void {
    if (target.hp <= 0) return;
    if (!isBuilding(target)) target.lastCombat = state.time;
    recordBloodHit(state, target, attacker);
    const previousHp = target.hp;
    target.hp = Math.max(0, target.hp - (isBuilding(target) ? amount
      : incomingUnitDamage(target, amount) / infantryDefenseMultiplier(state, target, attacker)));
    if (isBuilding(target)) {
      target.lastAttacked = state.time;
      notifyRepairJobChanged(state, target);
      if (target.hp < previousHp) defendRaiderCamp(state, target, attacker);
    }
    else {
      if (target.hp < previousHp) { target.damageFlashAt = state.time; recordUnitDamage(state, target, previousHp, attacker.id); }
      target.lastDamagedAt = state.time; wakeCourier(state, target); panicCivilian(state, target, attacker); beginObservationPostRetreat(target);
      entityStore(state).units.updateRoles(target, false);
      if (attacker.kind === 'pikeman' && target.hp > 0) pikeKnockback(state, attacker, target);
    }
    if (target.hp < previousHp) notifyRaiderAttack(state, target, attacker);
    if (target.hp <= 0) destroyTarget(state, attacker, target);
}

/** Opportunistic hunting never changes a march order or draws escorts away
 * from their Leader. Human enemies and explicit orders always take priority. */
const huntDecisions = new WeakMap<Unit, DecisionClock & { state: GameState; target?: Unit }>();
function autoHunt(state: GameState, unit: Unit): void {
  if (!isMilitary(unit) || unit.kind === 'militia' || unit.faction < 0 || unit.hp <= 0 || unit.cooldown > 0 || unit.inside
    || unit.garrison || unit.order === 'flee' || unit.recallIssuedAt !== undefined || unit.forcedAttack
    || factionOf(state, unit.faction)?.defeated) return;
  if (targetEntity(state, unit.target)) return;
  let observation = huntDecisions.get(unit);
  if (!observation || observation.state !== state) { observation = { state }; huntDecisions.set(unit, observation); }
  if (decisionDue(observation, state.time, unit.id)) {
    observation.target = nearestHuntTarget(state, unit, target => distance(unit, target) <= unitAttackRange(state.world, unit, target)
      && targetInSight(state, unit, target) && unitAttackContact(state, unit, target));
    if (observation.target && nearbyUnits(state, unit, 6).some(enemy => enemy.hp > 0 && !enemy.inside
      && atWar(state, unit.faction, enemy.faction) && distance(unit, enemy) <= 6 && targetInSight(state, unit, enemy))) observation.target = undefined;
  }
  const animal = observation.target;
  if (!animal || animal.hp <= 0 || animal.inside || distance(unit, animal) > unitAttackRange(state.world, unit, animal)
    || !targetInSight(state, unit, animal) || !unitAttackContact(state, unit, animal)) return;
  attackTarget(state, unit, animal);
}

function updateProjectiles(state: GameState, dt: number): void {
  advanceProjectiles(state, dt, {
    target: id => targetEntity(state, id),
    hostile: (a, b) => atWar(state, a, b),
    huntable: isHuntable,
    observable: observationPostVisibleTo,
    protected: target => !!palaceDefenses(state, target).length,
    clear: (projectile, target, straight) => straight
      ? arrowLineClear(state, projectile.start, projectile.end, !isBuilding(target) ? target.wallPatrol?.wall ?? target.id : target.id)
      : hasAttackContact(state, projectile.start, projectile.faction, target, true, entityStore(state).buildings.get(projectile.attacker)),
    defense: (target, from) => infantryDefenseMultiplier(state, target, from),
    hit: (projectile, target, previousHp, hp, dead, rewards = true) => {
      const sourceBuilding = entityStore(state).buildings.get(projectile.attacker);
      recordBloodHit(state, target, projectile.start);
      target.hp = hp;
      if (isBuilding(target)) {
        if (projectile.damage > 0) target.lastAttacked = state.time;
        notifyRepairJobChanged(state, target);
        if (target.hp < previousHp) defendRaiderCamp(state, target,
          entityStore(state).units.get(projectile.attacker) ?? sourceBuilding ?? { ...projectile.start, faction: projectile.faction });
      }
      else {
        if (target.hp < previousHp) { target.damageFlashAt = state.time; recordUnitDamage(state, target, previousHp, projectile.attacker); }
        target.lastCombat = state.time;
        if (projectile.damage > 0) { target.lastDamagedAt = state.time; wakeCourier(state, target); panicCivilian(state, target, projectile.start); beginObservationPostRetreat(target); }
        entityStore(state).units.updateRoles(target, false);
      }
      if (target.hp < previousHp) notifyRaiderAttack(state, target,
        entityStore(state).units.get(projectile.attacker) ?? sourceBuilding ?? { ...projectile.start, faction: projectile.faction });
      if (dead) {
        // A thrown weapon remains lethal if its thrower dies during its flight.
        const attacker = entityStore(state).units.get(projectile.attacker) ?? sourceBuilding ?? { faction: projectile.faction };
        destroyTarget(state, attacker, target, projectile.leaderXp, rewards);
      }
    },
  });
}
function fight(state: GameState, unit: Unit, target: Unit | Building, dt: number): void {
  unit.levyAssembling = undefined;
  if (isBuilding(target)) {
    const defenses = palaceDefenses(state, target);
    if (defenses.length) {
      const defense = defenses.filter(building => targetInSight(state, unit, building))
        .sort((a, b) => edgeDistance(unit, a) - edgeDistance(unit, b)).find(building => canReachAttack(state, unit, building));
      if (defense) fight(state, unit, defense, dt);
      else { unit.target = undefined; unit.moving = false; }
      return;
    }
  }
  if (unit.target !== target.id) {
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  unit.target = target.id;
  if (targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && targetInSight(state, unit, target) && unitAttackContact(state, unit, target)) {
    // Do not stop the front soldier in the breach merely because the first
    // house is now in reach. Finish entering a wider contact cell, leaving room
    // for allies. Held/anchored units and ranged Leaders keep their positions.
    if (unit.range <= 1.5 && isBuilding(target) && !isWallKind(target.kind)
      && (unit.order !== 'hold' || !!unit.forcedAttack) && !defensiveAnchor(unit)
      && (isNarrowPassage(state, unit, unit.faction) || unit.path?.slice(0, 2).some(point => isNarrowPassage(state, point, unit.faction)))) {
      const goal = approachPoint(state, unit, target);
      if (goal && canWalk(state, goal.x, goal.y, unit.faction) && !isNarrowPassage(state, goal, unit.faction) && distance(unit, goal) > .12) {
        moveUnit(state, unit, goal, dt, false, true); return;
      }
    }
    releaseAttackSpot(state, unit); attackTarget(state, unit, target);
  } else {
    // Strike an enemy already within reach before walking anywhere. Committing
    // to a farther target left rear ranks walking past enemies beside them.
    const inReach = !isBuilding(target) && unit.attack > 0 ? enemyInReach(state, unit) : undefined;
    if (inReach) {
      releaseAttackSpot(state, unit); unit.target = inReach.id; unit.path = undefined; unit.pathGoal = undefined;
      attackTarget(state, unit, inReach); return;
    }
    const goal = approachPoint(state, unit, target);
    if (goal) moveUnit(state, unit, goal, dt, false, true);
    breachBlockingWall(state, unit, target);
  }
}
/** True when a friend within ALLY_AGGRO_RADIUS is fighting or was just hit:
 * soldiers join that fight instead of honoring leader/town tethers. */
function alliesEngagedNear(state: GameState, unit: Unit): boolean {
  // Self-defense: just hit, or an enemy soldier close by is targeting this
  // faction. Without it, an army walking back to formation or to its town
  // passed an attacking army that kept chasing it, and no fight ever began.
  if (state.time - (unit.lastDamagedAt ?? -Infinity) < 2) return true;
  for (const other of nearbyUnits(state, unit, ALLY_AGGRO_RADIUS)) {
    if (other === unit || other.hp <= 0 || other.inside) continue;
    if (other.faction === unit.faction) {
      if (state.time - other.lastCombat < 1.5 || state.time - (other.lastDamagedAt ?? -Infinity) < 1.5) return true;
    } else if (other.target !== undefined && isMilitary(other) && distance(unit, other) <= THREAT_RADIUS
      && atWar(state, unit.faction, other.faction) && targetEntity(state, other.target)?.faction === unit.faction) return true;
  }
  return false;
}
/** The most wounded hostile soldier this unit can strike from where it stands
 * (focusing blows finishes enemies instead of spreading damage). */
function enemyInReach(state: GameState, unit: Unit): Unit | undefined {
  let best: Unit | undefined;
  for (const other of nearbyUnits(state, unit, maximumUnitRange(unit) + .6)) {
    if (other.hp <= 0 || other.inside || !atWar(state, unit.faction, other.faction)
      || targetDistance(unit, other) > unitAttackRange(state.world, unit, other) || !targetInSight(state, unit, other)
      || !unitAttackContact(state, unit, other) || unitRespectsForbidden(state, unit) && forbiddenTarget(state, other, unit.faction)) continue;
    if (!best || other.hp < best.hp || other.hp === best.hp && other.id < best.id) best = other;
  }
  return best;
}

/** A traffic jam in a usable gate is not a reason to knock down more walls. */
function breachBlockingWall(state: GameState, unit: Unit, target: Unit | Building): void {
  if (unit.moving || unit.path?.length || movementPathDeferred(state, unit) || canReachAttack(state, unit, target)) return;
  const destination = isBuilding(target) ? center(target) : target;
  const blockingWall = state.buildings.filter(building => isWallKind(building.kind) && buildingPresent(building)
    && atWar(state, unit.faction, building.faction) && edgeDistance(unit, building) <= unitAttackRange(state.world, unit, building)
    && targetInSight(state, unit, building) && unitAttackContact(state, unit, building))
    .sort((a, b) => distance(center(a), destination) - distance(center(b), destination))[0];
  if (blockingWall) { attackTarget(state, unit, blockingWall); unit.target = target.id; }
}

const marauderGroups = new WeakMap<GameState, Map<number, Unit[]>>();
function withinMoraleRange(a: Point, b: Point): boolean {
  const dx = a.x - b.x, dy = a.y - b.y;
  // Broad-phase buckets overhang the circle. Reject those cells before the
  // exact distance calculation, retaining its rounding at the radius boundary.
  return Math.abs(dx) < 5 && Math.abs(dy) < 5 && Math.hypot(dx, dy) < 5;
}
function updateMorale(state: GameState, unit: Unit, dt: number): void {
  if (!isMilitary(unit)) return;
  const leader = unit.marauderPack === undefined ? getLeader(state, unit.faction)
    : (marauderGroups.get(state)?.get(unit.marauderPack) ?? state.units).find(candidate => candidate.marauderLeader && candidate.hp > 0 && candidate.marauderPack === unit.marauderPack);
  // Casualty thresholds, exchange ratios and shock deadlines use current game
  // time; hidden marauders integrate elapsed morale on their coalesced update.
  const pressure = casualtyPressure(state, unit, (a, b) => atWar(state, a, b));
  const hostileSide = atWar(state, 0, unit.faction);
  const { enemies, allies, routingAllies, fightingUntil, firstEnemyFaction, shelter } = senseMorale(state, unit, leader, pressure, () => {
    const inSight = targetSightQuery(state, unit);
    let enemies = 0, allies = 0, routingAllies = 0, fightingUntil = -Infinity, enemyOrder = Infinity, firstEnemyFaction = -1;
    // Routing depends on the first enemy in original unit-array order.
    forEachNearbyUnit(state, unit, 5, (other, order) => {
      if (!isMilitary(other) || !(other.hp > 0)) return;
      if (other.faction === unit.faction) {
        if (!withinMoraleRange(unit, other)) return;
        allies++;
        if (other.id !== unit.id && other.order === 'flee' && other.routed && inSight(other)) routingAllies++;
        if (other.id !== unit.id) fightingUntil = Math.max(fightingUntil, other.lastCombat + 2);
      } else if (atWar(state, unit.faction, other.faction) && withinMoraleRange(unit, other) && inSight(other)) {
        enemies++;
        if (order < enemyOrder) { enemyOrder = order; firstEnemyFaction = other.faction; }
      }
    });
    const shelter = unit.order === 'flee' && shelterNear(state, unit.faction, unit.x, unit.y, 2.5);
    return { enemies, allies, routingAllies, fightingUntil, firstEnemyFaction, shelter };
  });
  const nearLeader = !!leader && leader.order !== 'flee' && distance(unit, leader) < 5;
  if (integrateBattleMorale(state, unit, dt, {
    enemies, allies, routingAllies, fightingUntil, shelter, hostileSide, nearLeader,
    collapsing: pressure.collapsing, unfavorableExchange: pressure.unfavorableExchange,
    maximumMorale: unitMoraleMaximum(unit), defeated: !!factionOf(state, unit.faction)?.defeated,
    leaderFleeing: leader?.order === 'flee',
  })) {
    moraleRally(state, unit, firstEnemyFaction, 12);
    if (isHumanFaction(state, unit.faction)) logEvent(state, `${unit.kind === 'leader' ? 'Your leader is' : 'A warrior is'} routing! Rally near friendly buildings.`, 'warning');
  }
}
function updateMarauderPacks(state: GameState): void {
  const groups = new Map<number, Unit[]>();
  for (const unit of state.units) if (unit.hp > 0 && unit.marauderPack !== undefined) {
    const members = groups.get(unit.marauderPack);
    if (members) members.push(unit); else groups.set(unit.marauderPack, [unit]);
  }
  marauderGroups.set(state, groups);
  for (const pack of state.marauderPacks ?? []) {
    if (pack.seaInvasion !== undefined) continue;
    const members = groups.get(pack.id) ?? [];
    if (!members.length || members.every(unit => unit.inside)) continue;
    if (pack.ruinsAmbush) { updateExplorationAmbush(state, pack, members); continue; }
    if (pack.campDefense && !pack.returning) continue;
    if (updateRaiderGroupMotivation(state, pack, members)) continue;
    // Garrisoned veterans stay in their old pack until another raid recruits
    // them. They cannot command the soldiers still outside or recall them.
    const commander = members.find(unit => unit.marauderLeader && !unit.inside);
    if (commander && !pack.returning && (commander.marauderRetreating || marauderBandDepleted(state, pack, members))) {
      pack.returning = true;
      for (const member of members) { member.path = undefined; member.pathGoal = undefined; member.repathAt = 0; }
    }
    if (pack.returning) {
      pack.waypoint = { ...pack.home };
      for (const member of members) {
        member.target = undefined;
        if (member.marauderLeader) member.marauderRetreating = true;
      }
      continue;
    }
    if (pack.raid) {
      let target = buildingWithId(state, pack.targetBuilding, building => raiderMayAttack(state, building.faction, pack.raiderCamp) && building.faction === pack.targetFaction && isRaidObjective(state, building));
      if (!target) {
        target = selectRaidTarget(state, commander ?? members.find(unit => !unit.inside)!, pack.id, undefined, pack.raiderCamp);
        pack.targetBuilding = target?.id;
        if (target) pack.targetFaction = target.faction;
        else pack.returning = true;
        for (const member of members) { member.target = undefined; member.path = undefined; member.pathGoal = undefined; member.repathAt = 0; }
      }
      if (target) pack.waypoint = center(target);
      // A raid remains committed after the old patrol's 45-second wander timer.
      continue;
    }
    // The activity lifecycle assigns either a faction attack or a shelter.
    // Unassigned bands never spend this frame calculating random patrol paths.
  }
}
const commanderObservations = new WeakMap<Unit, DecisionClock & {
  state: GameState; danger?: boolean; clear?: boolean; threat?: Point; escape?: Point;
}>();
function updateMarauder(state: GameState, unit: Unit, dt: number): void {
  if (unit.seaInvasion !== undefined) {
    const pack = state.marauderPacks?.find(p => p.id === unit.marauderPack);
    const enemy = nearestEnemy(state, unit, EnemyQuery.Marauder, 7, true);
    if (enemy) fight(state, unit, enemy, dt);
    else if (pack) moveUnit(state, unit, pack.phase === 'muster' ? seaMusterGoal(state, unit) : pack.waypoint, dt);
    return;
  }
  const pack = state.marauderPacks?.find(pack => pack.id === unit.marauderPack);
  if (unit.inside) return;
  if (pack?.ruinsAmbush) {
    if (pack.ruinsAmbush.finished) { moveUnit(state, unit, pack.home, dt); return; }
    const enemy = nearestEnemy(state, unit, EnemyQuery.Marauder, 5.5, true);
    if (enemy) fight(state, unit, enemy, dt);
    else {
      const objective = pack.ruinsAmbush.committed ? buildingWithId(state, pack.targetBuilding) : undefined;
      if (objective && edgeDistance(unit, objective) <= 5.5) fight(state, unit, objective, dt);
      else { moveUnit(state, unit, pack.waypoint, dt, false, true); if (objective) breachBlockingWall(state, unit, objective); }
    }
    return;
  }
  if (updateRaiderAlert(state, unit, dt, {
    move: (goal, elapsed) => { releaseAttackSpot(state, unit); moveUnit(state, unit, goal, elapsed); },
    attack: (target, elapsed) => fight(state, unit, target, elapsed),
    visible: target => targetInSight(state, unit, target),
    localEnemy: () => nearestEnemy(state, unit, EnemyQuery.Marauder, 5.5, true, candidate => !pack?.raid || !isBuilding(candidate) || !isWallKind(candidate.kind)),
  })) return;
  if (pack && updateRaiderReturn(state, unit, pack, goal => { releaseAttackSpot(state, unit); moveUnit(state, unit, goal, dt); })) return;
  if (evadeMelee(state, unit, dt, (game, archer, goal, elapsed) => moveUnit(game, archer, goal, elapsed, false, false, true), (a, b) => atWar(state, a, b), target => targetInSight(state, unit, target))) return;
  if (updateRaiderMotivation(state, unit, dt, {
    move: (member, goal, elapsed) => { releaseAttackSpot(state, member); moveUnit(state, member, goal, elapsed); },
    attack: (member, target, elapsed) => fight(state, member, target, elapsed),
    visible: (member, target) => targetInSight(state, member, target),
  })) return;
  if (unit.marauderLeader) {
    let observation = commanderObservations.get(unit);
    if (!observation || observation.state !== state) { observation = { state }; commanderObservations.set(unit, observation); }
    if (decisionDue(observation, state.time, unit.id)) {
      const threats = nearbyUnits(state, unit, 8).filter(other => other.hp > 0 && !other.inside && atWar(state, unit.faction, other.faction) && targetInSight(state, unit, other));
      const towers = firingTowerThreats(state, unit).filter(tower => atWar(state, unit.faction, tower.faction) && targetInSight(state, unit, tower)).map(center);
      const positions: Point[] = [...threats, ...towers];
      observation.danger = marauderLeaderInDanger(state, unit, threats, towers)
        && (!pack?.microRaid || unit.hp <= unitMaxHp(unit) * .45);
      observation.clear = positions.every(other => distance(other, unit) > 6);
      observation.threat = positions.sort((a, b) => distance(a, unit) - distance(b, unit))[0];
      observation.escape = undefined;
      const threat = observation.threat;
      if (threat && distance(unit, threat) < 6) {
        const angle = Math.atan2(unit.y - threat.y, unit.x - threat.x);
        for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
          const goal = { x: Math.max(.5, Math.min(state.world.width - .5, unit.x + Math.cos(angle + turn) * 4)),
            y: Math.max(.5, Math.min(state.world.height - .5, unit.y + Math.sin(angle + turn) * 4)) };
          if (canMove(state, unit, goal, unit.faction)) { observation.escape = goal; break; }
        }
      }
    }
    const danger = observation.danger;
    if (danger && !unit.marauderRetreating) {
      unit.marauderRetreating = true; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    }
    if (unit.marauderRetreating && !pack?.returning && !danger && observation.clear
      && unit.hp > unitMaxHp(unit) * .7) unit.marauderRetreating = false;
    if (unit.marauderRetreating) {
      unit.target = undefined; releaseAttackSpot(state, unit);
      const threat = observation.threat;
      const home = pack?.home;
      // A home beyond the attacker is not an escape: first move away from
      // the firing position, including towers with no defending units nearby.
      const homeLeadsAway = home && (!threat || (home.x - unit.x) * (unit.x - threat.x) + (home.y - unit.y) * (unit.y - threat.y) >= 0);
      if (home && distance(unit, home) > .35 && homeLeadsAway) moveUnit(state, unit, home, dt);
      else if (observation.escape) moveUnit(state, unit, observation.escape, dt);
      return;
    }
  }
  if (pack?.returning) {
    unit.target = undefined;
    if (distance(unit, pack.home) > 1.5) moveUnit(state, unit, pack.home, dt);
    return;
  }
  const target = targetEntity(state, unit.target);
  const enemy = nearestEnemy(state, unit, EnemyQuery.Marauder, 5.5, true, candidate => !pack?.raid || !isBuilding(candidate) || !isWallKind(candidate.kind))
    ?? (target && validTarget(state, unit, target) && !isBuilding(target) && targetDistance(unit, target) < 8 && (isBuilding(target) || targetInSight(state, unit, target)) ? target : undefined);
  if (enemy) { fight(state, unit, enemy, dt); return; }
  if (pack?.campDefense) {
    unit.target = undefined;
    if (distance(unit, pack.waypoint) > 1) moveUnit(state, unit, pack.waypoint, dt);
    return;
  }
  if (pack?.raid) {
    const objective = buildingWithId(state, pack.targetBuilding, building => building.faction === pack.targetFaction && isRaidObjective(state, building));
    if (objective) {
      const members = marauderGroups.get(state)?.get(pack.id) ?? [];
      const commander = members.find(member => member.id === pack.leaderId && member.hp > 0 && !member.inside);
      if (commander && edgeDistance(unit, objective) > 6) {
        const troops = members.filter(member => member.id !== commander.id && member.hp > 0 && !member.inside && member.order !== 'flee');
        const waitingForTroops = troops.length > 0 && troops.every(member => distance(commander, member) > 3.5);
        // A waiting commander needs somebody inside its actual rally radius.
        // Otherwise the old 6-tile follower trigger leaves a permanent gap
        // between 3.5 and 6 tiles, especially on opposite sides of camp walls.
        if (!unit.marauderLeader && (distance(unit, commander) > 6 || waitingForTroops)) {
          unit.target = undefined; moveUnit(state, unit, commander, dt); return;
        }
        if (unit.marauderLeader && waitingForTroops) return;
      }
      // March on a cached route before reserving melee positions at the site.
      // Distant raiders must not rerun attack-slot path searches every frame.
      if (edgeDistance(unit, objective) > 5.5) {
        if (unit.target !== objective.id) { unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
        unit.target = objective.id; releaseAttackSpot(state, unit);
        moveUnit(state, unit, center(objective), dt, false, true);
        breachBlockingWall(state, unit, objective);
      } else fight(state, unit, objective, dt);
      return;
    }
  }
  unit.target = undefined;
}
const fleeingPlans = new WeakMap<Unit, DecisionClock & { state: GameState; edges?: Point[]; edgeOwners?: Map<Point, Building>; threat?: Unit; refuge?: Building; goal?: Point }>();
function updateFleeing(state: GameState, unit: Unit, dt: number): void {
  let plan = fleeingPlans.get(unit);
  if (!plan || plan.state !== state) { plan = { state }; fleeingPlans.set(unit, plan); }
  const sample = decisionDue(plan, state.time, unit.id);
  if (unit.kind === 'leader') {
    unit.target = undefined;
    if (sample) {
      const palaces = entityStore(state).buildings.query('palace').filter(building => building.faction === unit.faction && buildingReady(building))
        .sort((a, b) => edgeDistance(unit, a) - edgeDistance(unit, b));
      plan.edgeOwners = new Map();
      plan.edges = palaces.flatMap(palace => constructionEdges(state, palace).map(edge => {
        plan!.edgeOwners!.set(edge, palace); return edge;
      }));
    }
    const edges = plan.edges ?? [];
    const validEdge = (edge: Point): boolean => {
      const palace = plan!.edgeOwners?.get(edge);
      return !!palace && palace.faction === unit.faction && buildingReady(palace);
    };
    if (edges.some(edge => validEdge(edge) && distance(unit, edge) <= .25) && !factionOf(state, unit.faction)?.defeated) {
      unit.order = unit.routOrder && unit.routOrder !== 'flee' ? unit.routOrder : 'follow';
      unit.morale = Math.max(50, unit.morale); unit.routed = false; unit.routOrder = undefined;
      unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
      if (unit.casualtyShock) { unit.casualtyShock.until = state.time; unit.casualtyShock.routed = false; }
      return;
    }
    if (sample && (!unit.destination || !edges.some(edge => distance(edge, unit.destination!) < .1)
      || !unit.path?.length && state.time >= (unit.repathAt ?? 0))) {
      unit.destination = undefined;
      for (const edge of edges.sort((a, b) => distance(unit, a) - distance(unit, b))) {
        const path = findPath(state, unit, edge, unit.faction);
        if (path.length) { unit.destination = edge; unit.path = path; unit.pathGoal = { ...edge }; unit.repathAt = 0; break; }
      }
    }
    if (unit.destination && edges.some(edge => validEdge(edge) && distance(edge, unit.destination!) < .1)) moveUnit(state, unit, unit.destination, dt);
    return;
  }
  if (unit.marauderPack !== undefined) {
    const pack = state.marauderPacks?.find(candidate => candidate.id === unit.marauderPack);
    if (sample) plan.threat = nearbyUnits(state, unit, 8).filter(other => other.hp > 0 && !other.inside && atWar(state, unit.faction, other.faction) && distance(unit, other) <= 8 && targetInSight(state, unit, other))
      .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    const threat = plan.threat?.hp && plan.threat.hp > 0 ? plan.threat : undefined;
    const retreat = pack?.home;
    if (retreat && distance(unit, retreat) > 1.5 && (!threat || distance(retreat, threat) > distance(unit, threat))) moveUnit(state, unit, retreat, dt);
    else if (threat) {
      const dx = unit.x - threat.x, dy = unit.y - threat.y, length = Math.hypot(dx, dy) || 1;
      moveUnit(state, unit, { x: Math.max(.5, Math.min(state.world.width - .5, unit.x + dx / length * 5)),
        y: Math.max(.5, Math.min(state.world.height - .5, unit.y + dy / length * 5)) }, dt);
    }
    return;
  }
  if (sample) {
    // Nearest own shelter from the resident building index, in the original
    // (distance, building order) ranking; forbidden candidates are skipped.
    const avoidForbidden = unitRespectsForbidden(state, unit);
    let refuge = nearestRefuge(state, unit.faction, unit.x, unit.y);
    for (let skip = 1; refuge && avoidForbidden && forbiddenTarget(state, refuge, unit.faction); skip++)
      refuge = nearestRefuge(state, unit.faction, unit.x, unit.y, skip);
    plan.refuge = refuge; plan.goal = plan.refuge && approachPoint(state, unit, plan.refuge);
  }
  if (!plan.refuge || plan.refuge.hp <= 0 || plan.refuge.faction !== unit.faction || edgeDistance(unit, plan.refuge) < 1) return;
  if (plan.goal) moveUnit(state, unit, plan.goal, dt);
}
function canReachAttack(state: GameState, unit: Unit, target: Unit | Building): boolean {
  if (unit.attack <= 0) return false;
  if (targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target)) return true;
  const size = isBuilding(target) ? buildingWidth(target) : 0, height = isBuilding(target) ? buildingHeight(target) : 0;
  let reachable = false;
  // Ignore temporary crowding here. An ally occupying an attack cell is not an
  // impossible route; physical terrain and buildings decide cancellation.
  for (let y = Math.floor(target.y - maximumUnitRange(unit)); y <= Math.floor(target.y + height + maximumUnitRange(unit)) && !reachable; y++) {
    for (let x = Math.floor(target.x - maximumUnitRange(unit)); x <= Math.floor(target.x + size + maximumUnitRange(unit)); x++) {
      const point = { x: x + .5, y: y + .5 };
      if (unit.kind === 'militia' && !militiaCityContains(state, unit, point)) continue;
      if (!canWalk(state, x, y, unit.faction, undefined, respectsForbidden(state, unit)) || (isBuilding(target) ? edgeDistance(point, target) : distance(point, target)) > unitAttackRange(state.world, unit, target, point) || !unitAttackContact(state, unit, target, point)) continue;
      const limits = garrisonMovementLimits(state, unit) ?? militiaMovementLimits(state, unit);
      if (limits ? findPath(state, unit, point, unit.faction, false, limits, undefined, undefined, false, respectsForbidden(state, unit)).length > 0
        : hasStaticPath(state, unit, point, unit.faction, respectsForbidden(state, unit))) { reachable = true; break; }
    }
  }
  return reachable;
}
function finishForcedAttack(state: GameState, unit: Unit, returnToActivity = true): void {
  const previous = unit.forcedAttack;
  if (!previous) return;
  unit.forcedAttack = undefined;
  unit.target = returnToActivity ? previous.previousTarget : undefined;
  unit.destination = returnToActivity ? previous.previousDestination : undefined;
  unit.recallIssuedAt = returnToActivity ? previous.previousRecallIssuedAt : undefined;
  unit.attackReturn = returnToActivity && (unit.retinueStance === 'hold' || unit.retinueStance === 'defensive' || unit.order === 'hold') ? previous.previousPosition : undefined;
  unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.moving = false;
  releaseAttackSpot(state, unit);
}
function updateForcedAttack(state: GameState, unit: Unit, dt: number): boolean {
  if (!unit.forcedAttack) return false;
  const target = targetEntity(state, unit.forcedAttack.target);
  if (!target || !validTarget(state, unit, target) || !withPlayerFaction(state, unit.faction, () => entityVisible(state, target))) {
    finishForcedAttack(state, unit);
    return false;
  }
  fight(state, unit, target, dt);
  return true;
}
const guardPatrols = new WeakMap<Unit, { until: number; goal: Point }>();
function fightFactionTarget(state: GameState, unit: Unit, target: Unit | Building, mission: FactionMission, dt: number): void {
  // A fleeing raider can almost match the Leader's speed. Waiting motionless
  // between throws or at each old attack-slot waypoint loses that small
  // advantage. On clear ground, close continuously at the real movement speed;
  // obstacles and traffic still use the ordinary collision-aware movement.
  if (['hunt', 'defend'].includes(mission.mode) && unit.kind === 'leader' && !isBuilding(target)
    && (target.moving || target.order === 'flee' || target.marauderRetreating)
    && targetInSight(state, unit, target)) {
    const gap = distance(unit, target);
    if (gap > 2.5) {
      const goal = { x: unit.x + (target.x - unit.x) * (gap - 2.5) / gap,
        y: unit.y + (target.y - unit.y) * (gap - 2.5) / gap };
      if (canMove(state, unit, goal, unit.faction)) {
        unit.target = target.id;
        attackTarget(state, unit, target);
        unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
        moveUnit(state, unit, goal, dt, true);
        return;
      }
    }
  }
  fight(state, unit, target, dt);
}
/** Execute the shared mission using ordinary combat, paths and formations.
 * The planner knows scout reports; strikes still require the unit's own sight. */
function updateFactionMission(state: GameState, unit: Unit, leader: Unit, mission: FactionMission, dt: number): void {
  const palace = indexedBuilding(state, mission.palaceId);
  if (!palace) return;
  const retreating = mission.mode === 'recover';
  const recovering = retreating || unit.hp < unitMaxHp(unit) * .4;
  const regrouping = mission.mode === 'regroup';
  if (recovering) {
    // Cover the retreat without turning back into another pursuit.
    const threat = nearestEnemy(state, unit, EnemyQuery.Recover, maximumUnitRange(unit) + 1e-7, false,
      target => !isBuilding(target) && targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target));
    if (threat) attackTarget(state, unit, threat);
    unit.target = undefined;
    if (unit.kind === 'leader') {
      const goal = mission.mode === 'recover' ? mission.goal
        : constructionEdges(state, palace).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
      if (goal && distance(unit, goal) > .3) moveUnit(state, unit, goal, dt);
    } else if (retreating && distance(leader, center(palace)) > 4) {
      moveInFormation(state, unit, leader, dt);
    } else {
      const goal = constructionEdges(state, palace).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
      if (goal && distance(unit, goal) > .25) moveUnit(state, unit, goal, dt);
    }
    return;
  }
  // Rear escorts still defend themselves while catching up. Otherwise a
  // straggler can walk past a nearby enemy indefinitely because strategic
  // regrouping returns before the ordinary combat acquisition below.
  const assist = isSoldier(unit) && alliesEngagedNear(state, unit);
  if (isSoldier(unit) && distance(unit, leader) > 7) {
    const threat = nearestEnemy(state, unit, EnemyQuery.Regroup, assist ? ALLY_AGGRO_SEARCH : Math.max(3.5, maximumUnitRange(unit) + 1e-7), false,
      target => !isBuilding(target) && isMilitary(target));
    if (threat) { fight(state, unit, threat, dt); return; }
    unit.target = undefined; moveInFormation(state, unit, leader, dt); return;
  }
  const objective = targetEntity(state, mission.targetId);
  // Keep the ranged Leader on the chosen quarry while the escorts occupy its
  // nearby guards. Switching to every closer guard gives fleeing commanders
  // a head start that equal movement speeds cannot recover.
  if (unit.kind === 'leader' && ['hunt', 'defend'].includes(mission.mode) && objective
    && (mission.mode !== 'defend' || distance(center(palace), objective) <= 14)
    && validTarget(state, unit, objective) && targetInSight(state, unit, objective)) {
    fightFactionTarget(state, unit, objective, mission, dt); return;
  }
  const immediateOnly = regrouping || mission.mode === 'patrol' && unit.kind === 'leader';
  const enemy = nearestEnemy(state, unit, EnemyQuery.Mission, immediateOnly ? maximumUnitRange(unit) + 1e-7 : assist ? ALLY_AGGRO_SEARCH : 6.5, true, target =>
    (mission.mode === 'attack' || !isBuilding(target)) && (assist || targetDistance(leader, target) <= 7)
    && (!immediateOnly || targetDistance(unit, target) <= unitAttackRange(state.world, unit, target))
    && (mission.mode !== 'defend' || distance(center(palace), target) <= 14));
  if (enemy) { fightFactionTarget(state, unit, enemy, mission, dt); return; }
  unit.target = undefined;
  if (isSoldier(unit)) { moveInFormation(state, unit, leader, dt); return; }
  if (regrouping) return;
  const escorts = mission.escortIds.map(id => indexedUnit(state, id)).filter((escort): escort is Unit => !!escort && escort.hp > 0 && escort.order !== 'flee');
  // A narrow exit or short traffic stop should not let the Leader run ahead.
  if (escorts.length >= 2 && escorts.filter(escort => distance(escort, leader) <= 6).length < 2) return;
  if (objective && (mission.mode !== 'defend' || distance(center(palace), objective) <= 14)
    && validTarget(state, unit, objective) && targetInSight(state, unit, objective)) {
    fightFactionTarget(state, unit, objective, mission, dt); return;
  }
  if (distance(unit, mission.goal) > .3) moveUnit(state, unit, mission.goal, dt, false, mission.mode === 'attack');
}
function updateSettlementGuard(state: GameState, unit: Unit, dt: number): boolean {
  if (unit.faction <= 0 || isHumanFaction(state, unit.faction) || unit.order === 'hold' || unit.forcedAttack) return false;
  // Faction soldiers always belong to the Leader's command structure; raid
  // orders and pack archetypes are exclusive to wilderness marauders.
  if (unit.order === 'raid') { unit.order = 'follow'; unit.target = undefined; }
  const palace = palaceOf(state, unit.faction);
  if (!palace) return false;
  const leader = getLeader(state, unit.faction);
  const mission = getFactionStrategy(state, unit.faction);
  if (mission && leader && (unit.id === mission.leaderId || mission.escortIds.includes(unit.id))) {
    updateFactionMission(state, unit, leader, mission, dt); return true;
  }
  // Allies fighting nearby lift the town and Leader tethers: a soldier caught
  // outside the town's 10-tile radius no longer walks home past the enemy.
  const assist = isSoldier(unit) && alliesEngagedNear(state, unit);
  const enemy = nearestEnemy(state, unit, EnemyQuery.Guard, unit.kind === 'leader' ? 8 : assist ? ALLY_AGGRO_SEARCH : 6, true,
    target => (assist || (isBuilding(target) ? edgeDistance(center(palace), target) : distance(center(palace), target)) <= 10)
      && (assist || !!mission || !isSoldier(unit) || !leader || targetDistance(leader, target) <= 8));
  if (enemy && (unit.hp >= unitMaxHp(unit) * .35 || targetDistance(unit, enemy) <= unitAttackRange(state.world, unit, enemy))) {
    fight(state, unit, enemy, dt); return true;
  }
  unit.target = undefined;
  if (edgeDistance(unit, palace) > 8 || unit.hp < unitMaxHp(unit) * .35) {
    const refuge = constructionEdges(state, palace).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (refuge && distance(unit, refuge) > .2) moveUnit(state, unit, refuge, dt);
    return true;
  }
  if (!mission && isSoldier(unit) && leader && edgeDistance(leader, palace) < 8) {
    moveInFormation(state, unit, leader, dt); return true;
  }
  let patrol = guardPatrols.get(unit);
  if (!patrol || state.time >= patrol.until) {
    const phase = Math.floor(state.time / 12) + unit.id;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = (phase + attempt) * Math.PI / 4;
      const goal = { x: Math.floor(palace.x + 1 + Math.cos(angle) * 3.5) + .5,
        y: Math.floor(palace.y + 1 + Math.sin(angle) * 3.5) + .5 };
      if (canWalk(state, goal.x, goal.y, unit.faction) && (distance(unit, goal) < .2 || hasStaticPath(state, unit, goal, unit.faction))) {
        patrol = { until: state.time + 12, goal }; guardPatrols.set(unit, patrol); break;
      }
    }
  }
  if (patrol && distance(unit, patrol.goal) > .2) moveUnit(state, unit, patrol.goal, dt);
  return true;
}
function updateWarrior(state: GameState, unit: Unit, dt: number, playerTraveling = false): void {
  const leader = getLeader(state, unit.faction);
  const leaderDistance = leader ? distance(unit, leader) : Infinity;
  const formation = leader ? retinueFormation(state, leader) : undefined;
  // Allies fighting or hit within 4 tiles pull this soldier into their fight:
  // a wider search that ignores the Leader tether and the formation return.
  let alliesEngaged: boolean | undefined;
  const assisting = (): boolean => alliesEngaged ??= alliesEngagedNear(state, unit);
  const rallyEnemy = (): Unit | Building | undefined => leader && !formation?.traveling && leaderDistance <= 14
    ? nearestEnemy(state, unit, EnemyQuery.Rally, Math.min(21, leaderDistance + 6.5), true, target => targetDistance(leader, target) <= 6.5)
    : undefined;
  if (unit.joiningRetinue && leader) {
    // Reinforcements near a stalled front may help immediately. Requiring a
    // distant recruit to reach an occupied parade slot keeps the rear passive.
    if (unit.recallIssuedAt === undefined && unit.retinueStance !== 'hold' && unit.retinueStance !== 'defensive') {
      const enemy = nearestEnemy(state, unit, EnemyQuery.Aggressive, 7, true) ?? rallyEnemy();
      if (enemy) {
        if (leaderDistance <= 14 && targetDistance(leader, enemy) <= 6.5) unit.joiningRetinue = undefined;
        fight(state, unit, enemy, dt); return;
      }
    }
    unit.target = undefined; unit.order = 'follow';
    if (leaderDistance > 3) {
      const goal = moveInFormation(state, unit, leader, dt);
      // Large retinues have outer slots beyond three tiles. Reaching one also
      // completes the journey; a distant single-file queue does not.
      if (formation?.mode === 'column' || !goal || distance(unit, goal) > .6) return;
    }
    unit.joiningRetinue = undefined;
    unit.order = unit.retinueStance === 'hold' && unit.recallIssuedAt === undefined ? 'hold' : 'follow';
    if (unit.retinueStance === 'defensive' && unit.recallIssuedAt === undefined) unit.defensiveAnchor = { x: unit.x, y: unit.y };
  }
  if (updateSettlementGuard(state, unit, dt)) return;
  if (updateForcedAttack(state, unit, dt)) return;
  if (unit.attackReturn) {
    if (distance(unit, unit.attackReturn) < .2) unit.attackReturn = undefined;
    else { moveUnit(state, unit, unit.attackReturn, dt); return; }
  }
  if (unit.order === 'follow' && unit.recallIssuedAt !== undefined && leader) {
    // A recall must beat target acquisition even at melee range. Travel intent
    // also covers the first keyboard frame and brief traffic/pathfinding stops.
    unit.target = undefined;
    const goal = moveInFormation(state, unit, leader, dt);
    const traveling = formation?.traveling || leader.order === 'flee' || isHumanFaction(state, unit.faction) && playerTraveling;
    // A hostile or crowded formation cell must not leave a nearby escort
    // permanently passive once the Leader has stopped.
    const regrouped = goal && (distance(unit, goal) <= .5 || leaderDistance <= 4 && (unit.stuckFor ?? 0) >= .5);
    if (!traveling && state.time - unit.recallIssuedAt >= .5 && regrouped) {
      unit.recallIssuedAt = undefined;
      unit.order = unit.recallReturnOrder ?? (unit.retinueStance === 'hold' ? 'hold' : 'follow');
      unit.recallReturnOrder = undefined;
      // Defensive escorts guard their new rally position instead of walking
      // back to the post from which they were recalled.
      if (unit.retinueStance === 'defensive') unit.defensiveAnchor = { x: unit.x, y: unit.y };
      unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.moving = false;
      clearFriendlyYield(state, unit);
    }
    return;
  }
  if (unit.faction < 0 && unit.order === 'raid') {
    const defender = nearestEnemy(state, unit, EnemyQuery.Raid, Math.max(4.5, maximumUnitRange(unit) + 1e-7));
    if (defender) { fight(state, unit, defender, dt); return; }
    const target = targetEntity(state, unit.target);
    const palace = target && isBuilding(target) && validTarget(state, unit, target) ? target : palaceOf(state, 0);
    if (palace && atWar(state, unit.faction, palace.faction)) fight(state, unit, palace, dt);
    else { unit.order = 'follow'; unit.target = undefined; }
    return;
  }
  const anchor = defensiveAnchor(unit);
  if (anchor) {
    const enemy = nearestEnemy(state, unit, EnemyQuery.Defensive, DEFENSIVE_RADIUS * 2 + maximumUnitRange(unit), true, target =>
      !isBuilding(target) && (distance(anchor, target) <= DEFENSIVE_RADIUS
        || unit.defensiveThreat?.target === target.id && unit.defensiveThreat.until > state.time
          && distance(anchor, target) <= DEFENSIVE_RADIUS + unitAttackRange(state.world, unit, target)));
    // A vanished or escaping enemy must never leave a stale pursuit route.
    if (enemy) { fight(state, unit, enemy, dt); return; }
    unit.target = undefined;
    if (distance(unit, anchor) > .12) moveUnit(state, unit, anchor, dt);
    return;
  }
  const aggressive = unit.retinueStance === 'aggressive';
  if (unit.order === 'follow' && unit.recallIssuedAt === undefined && (aggressive || unit.retinueStance === undefined)) {
    // Rear escorts share the Leader's nearby fight once actual forward travel
    // stops. Their own shorter search radius must not strand them in the tail.
    const enemy = rallyEnemy();
    if (enemy) { fight(state, unit, enemy, dt); return; }
  }
  if (unit.order === 'follow' && leader && isHumanFaction(state, leader.faction) && movementModeFor(state, leader.faction) === 'formation') {
    const enemy = nearestEnemy(state, unit, EnemyQuery.Formation, Math.max(5.5, maximumUnitRange(unit) + 1e-7), true,
      target => targetDistance(leader, target) <= 8);
    if (enemy) { fight(state, unit, enemy, dt); return; }
    unit.target = undefined;
    moveInFormation(state, unit, leader, dt);
    return;
  }
  if (aggressive && unit.order !== 'hold') {
    const enemy = nearestEnemy(state, unit, EnemyQuery.Aggressive, assisting() ? ALLY_AGGRO_SEARCH : 7, true);
    if (enemy) { fight(state, unit, enemy, dt); return; }
  }
  if (unit.order === 'follow' && leader && (leaderDistance > 8 || (leader.moving && leaderDistance > 4))
    && (unit.order !== 'follow' || leader.moving || !assisting())) {
    unit.target = undefined;
    moveInFormation(state, unit, leader, dt);
    return;
  }
  const assist = unit.order !== 'hold' && assisting();
  const enemy = nearestEnemy(state, unit, EnemyQuery.Warrior, unit.order === 'hold' ? Math.max(1.5, maximumUnitRange(unit) + 1e-7) : assist ? ALLY_AGGRO_SEARCH : Math.max(5.5, maximumUnitRange(unit) + 1e-7), true, target =>
    (unit.order !== 'hold' || targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target)) &&
    (unit.order !== 'follow' || !leader || assist || targetDistance(leader, target) <= 8));
  if (enemy) { fight(state, unit, enemy, dt); return; }
  unit.target = undefined;
  if (unit.order === 'follow' && leader) moveInFormation(state, unit, leader, dt);
}
function moveInFormation(state: GameState, unit: Unit, leader: Unit, dt: number): Point | undefined {
  const formation = retinueFormation(state, leader), goal = formation.goals.get(unit.id);
  if (!goal) { unit.levyAssembling = undefined; return; }
  if (nativeRetinueSettled(state, unit, leader, goal, formation.traveling)) {
    unit.moving = false; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    unit.levyAssembling = undefined; clearFriendlyYield(state, unit);
    return goal;
  }
  if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger')) unit.levyAssembling = distance(unit, goal) > .12 && distance(unit, goal) <= 2;
  // Continuously follow a nearby visible slot instead of waiting on an A*
  // refresh for each tile the leader crosses. Bent/blocked routes still use
  // normal pathfinding and all movement still respects occupied cells.
  const gap = distance(unit, goal), marching = isHumanFaction(state, leader.faction) && movementModeFor(state, leader.faction) === 'formation' && formation.traveling;
  const pace = marching && gap < .35 && leader.moving ? Math.min(.75, leader.speed * .75 / unit.speed) : 1;
  const movementGoal = goal;
  let direct = gap < 6 && canMove(state, unit, movementGoal, unit.faction);
  if ((marching || formation.mode === 'mob') && direct) {
    const occupied = unitOccupancy(state, unit), own = unitCell(state, unit), samples = Math.ceil(gap / .15);
    for (let i = 1; i <= samples; i++) {
      const sample = { x: unit.x + (movementGoal.x - unit.x) * i / samples, y: unit.y + (movementGoal.y - unit.y) * i / samples };
      const cell = unitCell(state, sample);
      if (cell !== own && occupied.has(cell)) { direct = false; break; }
    }
    if (direct) { unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; }
  }
  if (gap > .12) moveUnit(state, unit, movementGoal, dt * pace, direct);
  if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger')) unit.levyAssembling = distance(unit, goal) > .12 && distance(unit, goal) <= 2;
  if (distance(unit, goal) < 1.5) unit.facing = formation.heading;
  return goal;
}
function updateLeader(state: GameState, leader: Unit, dt: number, input: InputState): void {
  if (updateSailingLeader(state, leader, dt, input)) return;
  const dx = Number(input.right) - Number(input.left), dy = Number(input.down) - Number(input.up);
  if (!(dx || dy) && completeBoarding(state, leader)) return;
  if (updateSettlementGuard(state, leader, dt)) return;
  if (dx || dy) {
    for (const unit of state.units) if (unit.faction === leader.faction && unit.forcedAttack) finishForcedAttack(state, unit, unit !== leader);
    leader.boardingBoat = undefined;
    leader.target = undefined; leader.destination = undefined; leader.path = undefined;
    const length = Math.hypot(dx, dy);
    moveUnit(state, leader, { x: leader.x + dx / length, y: leader.y + dy / length }, dt, true);
    return;
  }
  if (updateForcedAttack(state, leader, dt)) return;
  const target = targetEntity(state, leader.target);
  if (isHumanFaction(state, leader.faction) && target && !withPlayerFaction(state, leader.faction, () => entityVisible(state, target))) {
    leader.target = undefined; leader.path = undefined; leader.pathGoal = undefined;
    return;
  }
  // A player-issued attack remains explicit; AI leaders reconsider nearby
  // threats every step instead of staying locked onto the first leader seen.
  if (isHumanFaction(state, leader.faction) && target && validTarget(state, leader, target)) { fight(state, leader, target, dt); return; }
  const pursuing = !isHumanFaction(state, leader.faction) && target && validTarget(state, leader, target) && targetDistance(leader, target) < 8 && (isBuilding(target) || targetInSight(state, leader, target)) ? target : undefined;
  leader.target = pursuing?.id;
  if (leader.destination) {
    if (distance(leader, leader.destination) < 0.22) leader.destination = undefined;
    else {
      const canRepath = state.time >= (leader.repathAt ?? 0);
      if (leader.path?.length && leader.pathGoal && distance(leader.pathGoal, leader.destination) < .8) acceptedMoveOrders.set(leader, leader.destination);
      moveUnit(state, leader, leader.destination, dt);
      if (leader.moving || leader.path?.length) acceptedMoveOrders.set(leader, leader.destination);
      // A dead-end click must not leave the leader permanently unable to defend.
      // Ignore temporary unit traffic, and keep a previously valid order when a
      // gate closes so movement resumes if its route opens again.
      if (isHumanFaction(state, leader.faction) && canRepath && !leader.moving && !leader.path?.length && acceptedMoveOrders.get(leader) !== leader.destination && !hasStaticPath(state, leader, leader.destination, leader.faction)) {
        leader.destination = undefined; leader.path = undefined; leader.pathGoal = undefined; leader.repathAt = 0;
      }
    }
  }
  if (isHumanFaction(state, leader.faction)) {
    // Defend an idle leader without creating a pursuit order. Movement and
    // explicit attacks above always take precedence over automatic strikes.
    const enemy = (!leader.destination || (!leader.moving && !leader.path?.length)) && nearestEnemy(state, leader, EnemyQuery.PlayerLeader, maximumUnitRange(leader) + 1e-7, true, target => targetDistance(leader, target) <= unitAttackRange(state.world, leader, target) && hasAttackContact(state, leader, leader.faction, target, true));
    if (enemy) attackTarget(state, leader, enemy);
    return;
  }
  const enemy = nearestEnemy(state, leader, EnemyQuery.Leader, Math.max(3.5, maximumUnitRange(leader) + 1e-7), true);
  const palace = palaceOf(state, leader.faction);
  if (enemy && (pursuing || !palace || edgeDistance(leader, palace) < 7)) fight(state, leader, enemy, dt);
  else if (pursuing) fight(state, leader, pursuing, dt);
  else if (palace && edgeDistance(leader, palace) > 5) {
    const point = approachPoint(state, leader, palace);
    if (point) moveUnit(state, leader, point, dt);
  }
}
function settlementGoldBreakdown(state: GameState, faction: Faction) {
  const gross = cityTaxIncome(state, faction), costs = factionMaintenanceBreakdown(state, faction);
  const army = state.units.filter(unit => isRetinueMember(unit) && unit.kind !== 'fieldCannon' && unit.faction === faction.id && unit.hp > 0).reduce((sum, unit) => sum + retinueUpkeep(unit), 0) + retinueSlotUpkeep(faction) + fleetUpkeep(state, faction.id);
  return { gross, ...costs, army, net: Math.round((gross - army - costs.settlements - costs.defenses) * 10) / 10 };
}
function settlementGoldIncome(state: GameState, faction: Faction): number {
  return settlementGoldBreakdown(state, faction).net - rustEngine.field_cannon_total_upkeep(entityStore(state).units.query('soldier').filter(u => u.kind === 'fieldCannon' && u.faction === faction.id && u.hp > 0).length);
}
function calculateYields(state: GameState, faction: Faction): void {
  // Field food is delivered physically; palace gardens provide their small
  // local baseline directly. Rates include both supply and consumption.
  const population = faction.population;
  const cities = citySummaries(state).filter(city => city.palace.faction === faction.id);
  const guardUpkeep = cities.length && isHumanFaction(state, faction.id) ? state.buildings.filter(building => building.kind === 'guardPost'
    && building.faction === faction.id && building.villageId === undefined && buildingReady(building) && building.guardPost?.funded === true)
    .reduce((sum, post) => sum + guardPostUpkeep(post), 0) : 0;
  faction.yields = { food: cities.length ? cities.reduce((sum, city) => sum + city.food, 0) : -population,
    production: 0, gold: settlementGoldIncome(state, faction) - guardUpkeep
      - state.buildings.filter(b => b.faction === faction.id).reduce((sum, b) => sum + fortUpkeep(b), 0)
      - state.units.filter(u => u.faction === faction.id && (u.kind === 'levyInfantry' || u.kind === 'slinger') && u.hp > 0).length * 5 };
}
/** Placement, preview and payment must all use the same replacement credit. */
export function buildCostAt(state: GameState, selection: Exclude<BuildSelection, 'clearTrees'>, x: number, y: number, faction = playerFaction(state)) {
  const kind = buildingKindForSelection(selection);
  if (kind === 'bridge' && tileAt(state.world, x, y)?.overlay === 'ford') return { gold: 0, food: 0, production: 0 };
  const multiplier = engineerBuildMultiplier(state, kind, faction) * stoneDefenseMultiplier(state, faction, kind);
  const cost = multiplier === 1 ? BUILD_COSTS[kind] : { ...BUILD_COSTS[kind], gold: BUILD_COSTS[kind].gold * multiplier };
  return palisadeForUpgrade(state, kind, x, y, faction)
    ? { ...cost, gold: Math.max(0, cost.gold - BUILD_COSTS.palisade.gold) } : cost;
}

/** The wall tool must remain selectable when only a palisade upgrade is affordable. */
export function minimumBuildGold(selection: Exclude<BuildSelection, 'clearTrees'>, state?: GameState): number {
  const kind = buildingKindForSelection(selection);
  const gold = BUILD_COSTS[kind].gold * (state ? engineerBuildMultiplier(state, kind, playerFaction(state)) * stoneDefenseMultiplier(state, playerFaction(state), kind) : 1);
  return kind === 'bridge' ? 0 : kind === 'wall' ? Math.max(0, gold - BUILD_COSTS.palisade.gold) : gold;
}

function canAfford(faction: Faction, kind: BuildingKind, cost = BUILD_COSTS[kind]): boolean {
  return faction.food >= cost.food && faction.gold >= cost.gold;
}
const automaticUpkeepReserves = new WeakMap<GameState, Map<number, number>>();
const automaticYieldPublications = new WeakMap<GameState, { world: World; at: number; factions: Set<number> }>();
function deferAutomaticYields(state: GameState, faction: number): void {
  let pending = automaticYieldPublications.get(state);
  if (!pending || pending.world !== state.world || pending.at > state.time) {
    pending = { world: state.world, at: state.time, factions: new Set() };
    automaticYieldPublications.set(state, pending);
  }
  pending.at = state.time; pending.factions.add(faction);
}
/** Governors leave one maintenance interval available before optional building.
 * A planning pass reuses each faction's reserve across every candidate tile. */
function canAffordAutomatic(state: GameState, faction: Faction, kind: BuildingKind): boolean {
  if (!governorPurchaseAllowed(state, faction.id, kind)) return false;
  if (!canAfford(faction, kind, { ...BUILD_COSTS[kind], gold: BUILD_COSTS[kind].gold * stoneDefenseMultiplier(state, faction.id, kind) })) return false;
  const scope = automaticUpkeepReserves.get(state);
  let reserve = scope?.get(faction.id);
  if (reserve === undefined) {
    reserve = factionBuildingMaintenance(state, faction) + retinueSlotUpkeep(faction) + fleetUpkeep(state, faction.id)
      + state.buildings.filter(b => b.faction === faction.id).reduce((sum, b) => sum + fortUpkeep(b), 0)
      + state.units.filter(u => u.faction === faction.id && (u.kind === 'levyInfantry' || u.kind === 'slinger') && u.hp > 0).length * 5;
    for (const post of state.buildings) if (isHumanFaction(state, faction.id) && post.kind === 'guardPost' && post.faction === faction.id
      && post.villageId === undefined && buildingReady(post) && post.guardPost?.funded === true) reserve += guardPostUpkeep(post);
    scope?.set(faction.id, reserve);
  }
  return faction.gold + 1e-7 >= BUILD_COSTS[kind].gold * stoneDefenseMultiplier(state, faction.id, kind) + reserve;
}
function pay(state: GameState, faction: Faction, kind: BuildingKind, cost = BUILD_COSTS[kind]): void {
  faction.food -= cost.food; spendGold(state, faction, cost.gold, 'construction');
}
/** Farms receive funding first when food delivery is the next limit on births.
 * Reserve housing land near the palace and use compact, fertile outer plots. */
const automaticFarmSearches = new WeakMap<GameState, { world: World; at: number;
  cities: WeakMap<Building, { faction: Faction; planAt?: number; search: AutomaticFarmSiteSearch }> }>();
function expandCamps(state: GameState, faction: Faction, palace: Building, slice?: { maxCandidates: number }): boolean {
  if (!governorPurchaseAllowed(state, faction.id, 'camp')) return true;
  let pendingSearches = automaticFarmSearches.get(state);
  if (!pendingSearches || pendingSearches.world !== state.world || pendingSearches.at > state.time) {
    pendingSearches = { world: state.world, at: state.time, cities: new WeakMap() };
    automaticFarmSearches.set(state, pendingSearches);
  }
  pendingSearches.at = state.time;
  const searches = pendingSearches.cities;
  const finish = (): true => { searches.delete(palace); return true; };
  if ((palace.governorPauseUntil?.camp ?? 0) > state.time || !governorPermissions(palace).farms) return finish();
  const eligible = (): boolean => {
    if (!canAffordAutomatic(state, faction, 'camp')
      || (!isHumanFaction(state, faction.id) && faction.id > 0 ? factionCityDevelopmentPriority(state, palace) : cityDevelopmentNeeds(state, palace).priority) !== 'farm') return false;
    return state.buildings.filter(building => building.faction === faction.id && isHome(building) && building.hp > 0 && building.construction
      && governingPalace(state, center(building), faction.id)?.id === palace.id).length < 8;
  };
  let site;
  if (slice) {
    let task = searches.get(palace);
    if (!task || task.faction !== faction || task.planAt !== palace.governorNextPlanAt) {
      if (!eligible()) return finish();
      task = { faction, planAt: palace.governorNextPlanAt, search: createAutomaticFarmSiteSearch(state, palace) };
      searches.set(palace, task);
    }
    const result = task.search.advance(slice.maxCandidates);
    if (!result.done) return false;
    finish();
    // Reconcile food demand and the shared treasury at admission and purchase,
    // not on every cheap search slice. No credit is reserved while searching.
    site = result.plan && eligible() ? validateAutomaticFarmSite(state, palace, result.plan.point) : undefined;
  } else {
    finish(); if (!eligible()) return true;
    site = planAutomaticFarmSite(state, palace);
  }
  if (!site) return true;
  pay(state, faction, 'camp');
  const farm = makeBuilding(state, 'camp', faction.id, site.point);
  queueConstruction(farm, state.time, BUILD_COSTS.camp.gold, state);
  return true;
}
/** Human governors retain two homes per economy cycle. Native faction policy
 * supplies rival credit and pending limits; actual siting, payment and elapsed
 * credit retain the shared governor rules. */
function expandHouses(state: GameState, faction: Faction, elapsedSeconds: number, palace: Building, slice?: { maxOrders: number; keepCredit?: boolean }): void {
  if (!governorPurchaseAllowed(state, faction.id, 'house')) return;
  if ((palace.governorPauseUntil?.house ?? 0) > state.time || faction.food < 6) return;
  const city = citySummaries(state).find(candidate => candidate.palace.id === palace.id);
  if (!city || city.food <= 0 || !governorPermissions(palace).housing
    || (!isHumanFaction(state, faction.id) && faction.id > 0 ? factionCityDevelopmentPriority(state, palace) : cityDevelopmentNeeds(state, palace).priority) !== 'house') return;
  const pending = state.buildings.filter(building => building.faction === faction.id && building.kind === 'house' && building.hp > 0 && building.construction
    && governingPalace(state, center(building), faction.id)?.id === palace.id).length;
  const houseLimit = isHumanFaction(state, faction.id) ? 2 : factionAIDecision(state, faction.id, 'housingLimit');
  if (pending >= houseLimit) return;
  const slow = Math.max(0, city.housing - city.population) > city.housing * .25;
  // Never bank a burst of speculative houses while a site or funds are unavailable.
  const credit = isHumanFaction(state, faction.id) ? Math.min(slow ? 1 : 2, (palace.automaticHouseCredit ?? 0)
    + (slow ? .2 : 2) * elapsedSeconds / ECONOMY_INTERVAL)
    : factionAIDecision(state, faction.id, 'housingCredit', palace.automaticHouseCredit ?? 0, elapsedSeconds, Number(slow));
  // Player governors do not bank normal unused orders into a later slowdown.
  palace.automaticHouseCredit = slice?.keepCredit || slow || !isHumanFaction(state, faction.id) && faction.id > 0 ? credit : 0;
  const allowance = Math.min(slice?.maxOrders ?? houseLimit, houseLimit - pending, Math.floor(credit + 1e-9));
  for (let count = 0; count < allowance; count++) {
    if (!canAffordAutomatic(state, faction, 'house')) return;
    const borders = territory(state);
    const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction === faction.id && buildingReady(building));
    const plan = planHouseSite(state, palace, () => true,
      point => {
        if (isForbidden(state, point.x, point.y, faction.id) || !buildingWithinBorders(state, 'house', point.x, point.y, faction.id, borders)) return false;
        const d = (point.x - palace.x - .5) ** 2 + (point.y - palace.y - .5) ** 2;
        return !scenarioPlacementError(state,'house',point.x,point.y) && !palaces.some(other => {
          const otherDistance = (point.x - other.x - .5) ** 2 + (point.y - other.y - .5) ** 2;
          return otherDistance < d || otherDistance === d && other.id < palace.id;
        });
      });
    if (!plan) return;
    if (plan.farmMove && !relocateFarm(state, plan.farmMove, plan.point)) return;
    pay(state, faction, 'house');
    const house = makeBuilding(state, 'house', faction.id, plan.point);
    if (plan.farmMove) { house.redevelopedFarm = true; house.capacity = houseCapacity(house, faction, state); }
    queueConstruction(house, state.time, BUILD_COSTS.house.gold, state);
    palace.automaticHouseCredit = Math.max(0, (palace.automaticHouseCredit ?? 0) - 1);
    if (plan.farmMove) { synchronizeFarms(state); ensureCollectors(state); deferAutomaticYields(state, faction.id); }
  }
}
/** Advance one bounded automatic-development turn without advancing game time.
 * The simulation calls this every fast step; tools can drain due turns directly. */
export function advanceAutomaticDevelopment(state: GameState): void {
  withSimulationReads(state, () => {
    const pending = automaticYieldPublications.get(state);
    if (pending && pending.world === state.world && pending.at <= state.time && pending.factions.size) {
      // Relocation is already paid and complete. Publishing its derived rates
      // can rebuild newly exposed claims, so give it a separate city turn.
      const id = pending.factions.values().next().value!;
      pending.factions.delete(id); pending.at = state.time;
      if (!pending.factions.size) automaticYieldPublications.delete(state);
      const faction = factionOf(state, id); if (faction) calculateYields(state, faction);
      return;
    }
    automaticYieldPublications.delete(state);
    automaticUpkeepReserves.set(state, new Map());
    try { advanceFactionDevelopment(state, {
      // Siting and payment read live city inputs, never faction.yields. A new
      // pending farm changes neither harvest output nor recurring upkeep.
      farms: (faction, palace, slice) => expandCamps(state, faction, palace, slice),
      houses: (faction, elapsedSeconds, palace, slice) => expandHouses(state, faction, elapsedSeconds, palace, slice),
      validate: (faction, kind, x, y) => canAffordAutomatic(state, factionOf(state, faction)!, kind)
        ? validateBuildAt(state, kind, x, y, faction) : { ok: false, message: 'Keep gold available for upkeep.' },
      build: (faction, kind, x, y) => canAffordAutomatic(state, factionOf(state, faction)!, kind)
        ? buildAt(state, kind, x, y, faction) : { ok: false, message: 'Keep gold available for upkeep.' },
    }); } finally { automaticUpkeepReserves.delete(state); }
  });
}
function economyTick(state: GameState): void {
  applyInfiniteGold(state);
  for (const faction of state.factions) {
    if (faction.defeated || faction.relation === 'confederated' || faction.villageId !== undefined) continue;
    const cities = citySummaries(state).filter(city => city.palace.faction === faction.id);
    grantIncome(faction, { food: cities.reduce((sum, city) => sum + palaceFoodProduction(city.palace), 0) }, state);
    const consumption = factionFoodConsumption(state, faction.id);
    const unfed = Math.max(0, consumption - faction.food);
    faction.food = Math.max(0, faction.food - consumption);
    // Guard posts bill on their own completion-relative clock; the displayed
    // net rate includes that expense, but must not charge it a second time.
    // Mandatory expenses spend the available treasury without carrying debt.
    const gold = settlementGoldBreakdown(state, faction);
    grantIncome(faction, { gold: gold.gross }, state, 'taxes');
    spendGold(state, faction, gold.settlements, 'settlements');
    spendGold(state, faction, gold.defenses, 'defenses');
    spendGold(state, faction, gold.army, 'army');
    faction.production = 0;
    const births = advanceCityPopulation(state, faction, cities,
      huntingGrowthMultiplierForFaction(state, faction.id, (state.tick - 1) * ECONOMY_INTERVAL, state.tick * ECONOMY_INTERVAL), unfed);
    if (births) { synchronizeFarms(state); ensureCollectors(state); }
    if (unfed > 1e-7 && faction.id === 0)
      logEvent(state, `Food deliveries fell short by ${Math.ceil(unfed - 1e-7)} rations. Keep routes open or establish another city.`, 'warning');
    syncRetinue(state, faction);
    calculateYields(state, faction);
  }
}
const positionSnapshots = new WeakMap<GameState, { positions: Map<number, Point>; points: WeakMap<Unit, Point> }>();
const separationOrders = new WeakMap<GameState, Map<Unit, number>>();
function snapshotUnitPositions(state: GameState): Map<number, Point> {
  let snapshot = positionSnapshots.get(state);
  if (!snapshot) { snapshot = { positions: new Map(), points: new WeakMap() }; positionSnapshots.set(state, snapshot); }
  snapshot.positions.clear();
  for (const unit of entityStore(state).units.query('active')) {
    let point = snapshot.points.get(unit);
    if (!point) { point = { x: unit.x, y: unit.y }; snapshot.points.set(unit, point); }
    else { point.x = unit.x; point.y = unit.y; }
    snapshot.positions.set(unit.id, point);
  }
  return snapshot.positions;
}
const separationRows = new WeakMap<GameState, SeparationRow[]>();
/** Native collision separation in original active order. The host only
 * describes each mover's obstacle layers, post and current path segment. */
function separateUnits(state: GameState, oldPositions: Map<number, Point>, activeUnits: readonly Unit[]): void {
  const occupancy = nativeMovement(state);
  let rows = separationRows.get(state);
  if (!rows) { rows = []; separationRows.set(state, rows); }
  rows.length = activeUnits.length;
  for (let i = 0; i < activeUnits.length; i++) {
    const unit = activeUnits[i], row = rows[i] ??= { unit };
    row.unit = unit; row.probe = row.anchor = row.next = row.old = undefined;
    if (!unit.moving || unit.hp <= 0 || unit.inside || unit.kind === 'marshBird' || unit.kind === 'sailboat' || unit.kind === 'fieldCannon' || !occupancy.resident(unit)) continue;
    row.probe = nativeUnitProbe(state, unit); row.anchor = defensiveAnchor(unit);
    row.next = unit.path?.[0]; row.old = oldPositions.get(unit.id);
  }
  occupancy.separate(rows, DEFENSIVE_RADIUS, unit => refreshIndexedUnit(state, unit));
}
function checkGameOver(state: GameState): void {
  if (state.scenarioPreparing) return;
  if (state.multiplayer) {
    const alive = state.multiplayer.humanFactionIds.filter(id => (!!getLeader(state, id) || !!factionOf(state, id)?.leaderRespawn) && (!!palaceOf(state, id) || hasSecededCity(state, id))
      && !factionOf(state, id)?.defeated);
    if (alive.length < 2) {
      state.multiplayer.winner = alive[0] ?? -1;
      state.gameOver = true;
      state.victory = state.multiplayer.winner === playerFaction(state);
    }
    return;
  }
  if (state.palaceCaptures?.length) return;
  if ((!getLeader(state) && !factionOf(state, 0)?.leaderRespawn) || !palaceOf(state, 0) && !hasSecededCity(state, 0)) {
    state.gameOver = true; state.victory = false;
    logEvent(state, 'Your crown has fallen. A new world awaits another leader.', 'warning');
  } else if (state.world.scenario === 'sandbox' && !state.victoryContinued && rustEngine.sim_scenario_goal(simCore(state).handle, 4, playerFaction(state))) {
    state.gameOver = true; state.victory = true;
  } else if (!state.victoryContinued && state.factions.filter(f => f.villageId === undefined).length > 1 && state.factions.filter(f => f.id !== 0 && f.villageId === undefined).every(faction => faction.defeated || faction.relation === 'confederated')) {
    state.gameOver = true; state.victory = true;
    logEvent(state, 'The valley is united under your crown. Victory!', 'good');
  }
}

/** Resume the victorious world without reopening the same victory each tick. */
export function continueAfterVictory(state: GameState): boolean {
  if (state.multiplayer || !state.gameOver || !state.victory) return false;
  state.victoryContinued = true;
  state.gameOver = false;
  state.paused = false;
  return true;
}

function leaderRespawnSites(state: GameState, factionId = playerFaction(state)): { palace: Building; points: Point[] } | undefined {
  if (!factionOf(state, factionId) || getLeader(state, factionId)) return;
  const palaces = state.buildings.filter(palace => palace.kind === 'palace' && palace.faction === factionId && buildingReady(palace))
    .sort((a, b) => distance(a, factionOf(state, factionId)!.leaderRespawn?.position ?? a) - distance(b, factionOf(state, factionId)!.leaderRespawn?.position ?? b))
    .map(palace => ({ palace, exits: constructionEdges(state, palace) }));
  const safe = (point: Point): boolean => !state.units.some(unit => unit.hp > 0 && !unit.inside
    && (distance(unit, point) < 1 || atWar(state, factionId, unit.faction)
      && Math.abs(Math.floor(unit.x) - Math.floor(point.x)) <= 1
      && Math.abs(Math.floor(unit.y) - Math.floor(point.y)) <= 1));
  // Respawn anywhere in the four-tile neighborhood, not always at the same
  // entrance. Flood from palace doors so a wall, water or ledge cannot put the
  // Leader in an isolated pocket. Units do not block the flood (defeat freezes
  // guards), but the chosen tile must be vacant and free of adjacent enemies,
  // including enemies on diagonally neighboring tiles.
  const key = (point: Point): number => Math.floor(point.y) * state.world.width + Math.floor(point.x);
  for (const { palace, exits } of palaces) {
    const origin = center(palace), queue = exits.filter(point => distance(point, origin) <= 4);
    const visited = new Set(queue.map(key)), points: Point[] = [];
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head];
      if (safe(point) && unitSpawnTerrainAllowed(state.world, point.x, point.y)) points.push(point);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const next = { x: point.x + dx, y: point.y + dy };
        if (visited.has(key(next)) || distance(next, origin) > 4 || !canMove(state, point, next, factionId)) continue;
        visited.add(key(next)); queue.push(next);
      }
    }
    if (points.length) return { palace, points };
  }
}

export function canRespawnLeader(state: GameState): boolean {
  return !state.multiplayer && state.gameOver && !state.victory && !!leaderRespawnSites(state);
}

/** Continue a defeated realm with a new, untrained Leader at a surviving palace. */
export function respawnLeader(state: GameState): { ok: boolean; message: string; leader?: Unit } {
  if (state.multiplayer || !state.gameOver || state.victory) return { ok: false, message: 'Respawn is available after single-player defeat.' };
  return respawnFactionLeader(state, playerFaction(state));
}
function respawnFactionLeader(state: GameState, factionId: number): { ok: boolean; message: string; leader?: Unit } {
  if (getLeader(state, factionId)) return { ok: false, message: 'Your Leader is still alive.' };
  const site = leaderRespawnSites(state, factionId), faction = factionOf(state, factionId);
  if (!faction || !palaceOf(state, factionId)) return { ok: false, message: 'A surviving town is required to respawn.' };
  if (!site) return { ok: false, message: 'Tiles within four tiles of your towns are blocked or threatened by adjacent enemies.' };

  // The fallen Leader may already have been removed. Reserve IDs still held
  // by arrows and orders so none can mistake the new Leader for their target.
  let reservedId = state.selected ?? 0;
  for (const unit of state.units) {
    for (const id of [unit.id, unit.target, unit.forcedAttack?.target, unit.forcedAttack?.previousTarget])
      if (id !== undefined) reservedId = Math.max(reservedId, id);
  }
  for (const projectile of state.projectiles ?? []) reservedId = Math.max(reservedId, projectile.attacker, projectile.target);
  const point = site.points[Math.floor(simRandom(state) * site.points.length)];
  const leader = makeUnit(state, 'leader', factionId, point, site.palace.id, reservedId + 1);
  const pending = faction.leaderRespawn;
  if (pending) { leader.leaderProgression = pending.progression; leader.hp = leader.maxHp = pending.maxHp; leader.attack = pending.attack; leader.defense = pending.defense; delete faction.leaderRespawn; }
  if (isHumanFaction(state, factionId)) leader.humanControlled = true;
  leader.kills = 0;
  leader.lastDamagedAt = state.time;
  entityStore(state).units.retain(unit => unit.kind !== 'leader' || unit.faction !== factionId || unit.hp > 0);
  faction.defeated = false;
  if (factionId === playerFaction(state)) {
    state.gameOver = false; state.victory = false;
    if (!pending) state.paused = false;
    state.selected = leader.id; state.selectedType = 'unit'; state.buildMode = null; state.diplomacy = null;
  }
  invalidateFog(state); updateFog(state);
  return { ok: true, message: 'Your Leader has returned to the town.', leader };
}


/** Called by the authority even while paused; game speed never changes this
 * deadline. `wallNow` is the host wall clock in milliseconds. */
export function updateLeaderRespawns(state: GameState, wallNow: number): void {
  setHostWallClock(state, wallNow);
  const now = hostWallClock(state);
  for (const faction of state.factions) {
    if (!faction.leaderRespawn) continue;
    if (!palaceOf(state, faction.id)) { delete faction.leaderRespawn; faction.defeated = true; continue; }
    if (leaderRespawnRemainingSeconds(state, faction.id, now) <= 0) respawnFactionLeader(state, faction.id);
  }
}

function stepGame(state: GameState, dt: number, input: InputState): void {
  const arrivedRefugees = new Set<number>();
  advanceSimulationClock(state, dt);
  publishBuildingDestructions(state);
  traceOrchestration(state, 'phase', 'begin');
  for (const leader of entityStore(state).units.query('leader')) if (leader.hp <= 0) recordLeaderDeath(state, leader, hostWallClock(state));
  synchronizeEngineers(state, (faction, point, home) => makeUnit(state, 'worker', faction, point, home));
  runRecurringWork(state, 'health-initialization', dt, () => initializeUnitDamageTimes(state));
  runRecurringWork(state, 'retinue-membership', dt, () => synchronizeRetinueSquads(state));
  runRecurringWork(state, 'tree-stumps', dt, () => updateTreeStumps(state));
  runRecurringWork(state, 'retinue-recruitment', dt, () => {
    for (const faction of state.factions) if (faction.nextRetinueAt !== undefined) syncRetinue(state, faction);
  });
  updateBloodEffects(state, dt);
  traceOrchestration(state, 'phase', 'structures');
  runRecurringWork(state, 'construction-completion', dt, () => {
    if (updateActiveConstruction(state)) invalidateSettlementDecisions(state);
  });
  runRecurringWork(state, 'sailboat-launches', dt, () => updateSailboatLaunches(state));
  if (updateFishing(state, dt) > 0) invalidateCitySummarySnapshot(state);
  updateHarborTrade(state, dt);
  runRecurringWork(state, 'wall-ownership', dt, () => {
    if (updateWallOwnership(state)) invalidateSettlementDecisions(state);
  });
  runRecurringWork(state, 'wall-stats', dt, () => updateWallStats(state));
  traceOrchestration(state, 'phase', 'settlements');
  runRecurringWork(state, 'settlements', dt, () => settlementStep(state));
  runRecurringWork(state, 'research', dt, elapsed => updateResearch(state, elapsed));
  runRecurringWork(state, 'paved-roads', dt, () => updatePavedRoads(state));
  updateCulture(state, dt);
  traceOrchestration(state, 'phase', 'development');
  runRecurringWork(state, 'faction-defenses', dt, () => {
    automaticUpkeepReserves.set(state, new Map());
    try { if (!state.scenarioPreparing) updateFactionDefenses(state, {
      validate: (faction, kind, x, y) => canAffordAutomatic(state, factionOf(state, faction)!, kind)
        ? validateBuildAt(state, kind, x, y, faction) : { ok: false, message: 'Keep gold available for upkeep.' },
      build: (faction, kind, x, y) => canAffordAutomatic(state, factionOf(state, faction)!, kind)
        ? buildAt(state, kind, x, y, faction) : { ok: false, message: 'Keep gold available for upkeep.' },
    });
    if (!state.scenarioPreparing) updateFactionEmpires(state, {
      cost: kind => BUILD_COSTS[kind].gold,
      validateSite: (faction,kind,x,y) => validateBuildCellAt(state,kind,x,y,faction,undefined,false,true),
      build: (faction,kind,x,y) => canAffordAutomatic(state,factionOf(state,faction)!,kind)
        ? buildAt(state,kind,x,y,faction) : {ok:false},
      campaign: faction => getFactionCampaignTarget(state,faction),
      visible: (observer,target) => targetInSight(state,observer,target),
    }); } finally { automaticUpkeepReserves.delete(state); }
  });
  ensureBuilders(state);
  runRecurringWork(state, 'drainage', dt, () => updateDrainage(state));
  runRecurringWork(state, 'resource-workers', dt, () => updateResourceWorkforce(state));
  advanceResourceWorkforce(state);
  runRecurringWork(state, 'forts', dt, () => updateForts(state));
  runRecurringWork(state, 'supply-depots', dt, () => updateSupplyDepots(state));
  runRecurringWork(state, 'mass-levy', dt, () => updateMassLevy(state));
  runRecurringWork(state, 'archery-training', dt, () => scheduleArcheryTraining(state));
  synchronizeFarms(state);
  runRecurringWork(state, 'harvests', dt, () => updateScheduledHarvests(state));
  runSettlementDecision(state, 'trade', () => updateTradeRoutes(state));
  runRecurringWork(state, 'wildlife', dt, () => updateWildlife(state));
  traceOrchestration(state, 'phase', 'frame-prep');
  // Snapshot active movement before dispatch and collision separation.
  runRecurringWork(state, 'courier-wakeups', dt, () => prepareCourierUpdates(state));
  if (!state.scenarioPreparing) updateNavalEmpires(state);
  const oldPositions = snapshotUnitPositions(state);
  updateWarships(state, dt, faction => state.multiplayer ? playerInput(state, faction) : faction === 0 ? input : NO_INPUT,
    (unit, faction) => destroyTarget(state, { faction }, unit, undefined, false), {
      observe: (ship,target) => ({ eligible: targetInSight(state,ship,target) && arrowLineClear(state,ship,target,target.id),
        defense: combatUnitDefense(state,target) }),
      shoot: (ship,target,slot,damage) => {
        const marine = slot>=4, musket = marine && ship.warship!.marine==='musketman';
        launchJavelin(state,ship,warshipGunPoint(ship,slot),target,damage,.65,musket?'bullet':undefined);
        state.projectiles![state.projectiles!.length-1].kind = marine ? musket?'bullet':'arrow'
          : ship.warship!.weapons[slot]==='cannon'?'cannonball':'ballistaBolt';
      },
    });
  // Keep the event's world position fixed for fog checks; the renderer animates its rise.
  for (const particle of state.particles) particle.life -= dt;
  state.particles = state.particles.filter(particle => particle.life > 0);
  traceOrchestration(state, 'phase', 'projectiles');
  updateProjectiles(state, dt);
  traceOrchestration(state, 'phase', 'raids');
  runRecurringWork(state, 'fog-raids', dt, () => updateFogRaids(state));
  updateRaiderTechnology(state);
  updateSeaRaids(state, dt);
  updateBarbarianGalleys(state,{
    observe:(ship,target)=>({eligible:atWar(state,ship.faction,target.faction)&&targetInSight(state,ship,target)&&arrowLineClear(state,ship,target,target.wallPatrol?.wall??target.id),defense:combatUnitDefense(state,target)}),
    shoot:(ship,target,_slot,damage)=>{const archer=entityStore(state).units.get(ship.sailboat?.passenger??-1);
      if(archer){launchJavelin(state,archer,ship,target,damage,.6);state.projectiles![state.projectiles!.length-1].kind='arrow';}}
  });
  beginMarauderFrame(state);
  runRecurringWork(state, 'marauder-packs', dt, () => updateMarauderPacks(state));
  runRecurringWork(state, 'guard-posts', dt, () => {
    const changedGarrisons = updateGuardPosts(state, { hostile: (a, b) => atWar(state, a, b) });
    for (const factionId of changedGarrisons) {
      const faction = factionOf(state, factionId);
      if (faction) calculateYields(state, faction);
    }
  });
  runRecurringWork(state, 'courier-wakeups', dt, () => prepareCourierUpdates(state));
  traceOrchestration(state, 'phase', 'unit-frame');
  const activeUnits = entityStore(state).units.query('active');
  updateEnemyStrength(state);
  const profile = movementProfile(state), spatialStarted = profile ? performance.now() : 0;
  beginUnitFrame(state);
  if (profile) profile.spatialMs += performance.now() - spatialStarted;
  beginCollectorFrame(state);
  beginPeasantFrame(state);
  beginNavigationFrame(state);
  beginFogFrame(state);
  if (!state.scenarioPreparing) updateDiplomacy(state);
  // Imported/direct retreat orders and new recruits obey the same rout as a
  // freshly broken Leader, before any formation or unit can move this step.
  for (const leader of entityStore(state).units.query('leader')) routLeaderRetinue(state, leader);
  updateMarauderFormations(state, (observer, target) => targetInSight(state, observer, target));
  for (const unit of entityStore(state).units.query('soldier')) if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger')) unit.levyAssembling = undefined;
  advanceInfantryFormations(state, dt,
    faction => state.multiplayer ? playerInput(state, faction) : faction === 0 ? input : NO_INPUT,
    (unit, goal, speed, elapsed) => {
      clearFriendlyYield(state, unit);
      const slot = infantryFormationGoal(state, unit) ?? goal;
      if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger')) unit.levyAssembling = distance(unit, slot) > .12 && distance(unit, slot) <= 2;
      moveUnit(state, unit, goal, elapsed * speed / Math.max(.01, whalingMovementSpeed(state, unit.faction, unit.speed)), true, false, true);
      if ((unit.kind === 'levyInfantry' || unit.kind === 'slinger')) unit.levyAssembling = distance(unit, slot) > .12 && distance(unit, slot) <= 2;
      refreshIndexedUnit(state, unit);
    });
  const playerLeader = getLeader(state);
  // Capture movement intent before unit order can affect the result. Imported
  // saves can list warriors before their Leader in the update array.
  const playerTraveling = input.left !== input.right || input.up !== input.down || playerLeader?.order === 'flee';
  try {
    traceOrchestration(state, 'phase', 'strategies');
    runRecurringWork(state, 'faction-strategies', dt, () => updateFactionStrategies(state, {
      hostile: (a, b) => atWar(state, a, b),
      visible: (observer, target) => targetInSight(state, observer, target),
    }));
    traceOrchestration(state, 'phase', 'towers');
    updateWoodenTowers(state, dt, {
      hostile: (a, b) => atWar(state, a, b),
      clearShot: (tower, from, target) => targetInSight(state, tower, target) && hasAttackContact(state, from, tower.faction, target, true, tower),
      shoot: (tower, from, target, attack) => {
        const faction = factionOf(state, tower.faction);
        const multiplier = achievementEffect(faction, AchievementEffect.homelandDamage, tower.enemyStrengthMultiplier ?? 1,
          Number(culturalHomeGround(state, faction, from)));
        launchJavelin(state, tower, from, target, attackDamage(attack * aiMarauderEdge(state, tower, target),
          isBuilding(target) ? buildingArmor(target, factionOf(state, target.faction)) : combatUnitDefense(state, target)) * multiplier, 1.2);
        if (isKeep(tower) || tower.kind === 'fort' || tower.kind === 'tower') Object.assign(state.projectiles![state.projectiles!.length - 1], { kind: 'arrow', towerArrow: true });
      },
    });
    updateBallistae(state, dt, {
      hostile: (a, b) => atWar(state, a, b),
      clearShot: (ballista, from, target) => !isBuilding(target) || !palaceDefenses(state, target).length
        ? targetInSight(state, ballista, target) && arrowLineClear(state, from, isBuilding(target) ? center(target) : target, target.id) : false,
      shoot: (ballista, from, target, attack) => {
        const damage = attackDamage(attack * aiMarauderEdge(state, ballista, target), isBuilding(target) ? buildingArmor(target, factionOf(state, target.faction)) : combatUnitDefense(state, target)) * (ballista.enemyStrengthMultiplier ?? 1) * (isBuilding(target) && isWallKind(target.kind) ? 2 : 1);
        launchJavelin(state, ballista, from, target, rustEngine.siege_attack(Number(ballista.kind === 'siegeCannon'), damage), .5);
        state.projectiles![state.projectiles!.length - 1].kind = ballista.kind === 'siegeCannon' ? 'cannonball' : 'ballistaBolt';
      },
    });
    // Cannons use a specialized movement loop and skip the ordinary actors
    // below, but share the same native morale integration and recovery.
    for (const cannon of entityStore(state).units.query('retinue')) {
      if (cannon.kind === 'fieldCannon' && cannon.hp > 0 && !cannon.inside) updateMorale(state, cannon, dt);
    }
    updateOffensives(state);
    updateFieldCannons(state, dt, {
      validOrder: (cannon, target) => validTarget(state, cannon, target) && withPlayerFaction(state, cannon.faction, () => entityVisible(state, target)),
      finishOrder: cannon => finishForcedAttack(state, cannon),
      attack: cannon => ({ attack: ballistaAttack(factionOf(state, cannon.faction)), strength: cannon.enemyStrengthMultiplier ?? 1 }),
      observe: (cannon, target) => ({
        eligible: cannon.order !== 'flee' && !cannon.routed && target.hp > 0 && atWar(state, cannon.faction, target.faction)
          && (isBuilding(target) ? buildingTargetable(target) && !isFarmKind(target.kind) && !['road', 'bridge', 'irrigation', 'ruin'].includes(target.kind) && !palaceDefenses(state, target).length : !target.inside)
          && targetInSight(state, cannon, target) && arrowLineClear(state, cannon, isBuilding(target) ? center(target) : target, target.id),
        range: BALLISTA_RANGE + downhillRangeBonus(state.world, cannon, target),
        defense: isBuilding(target) ? buildingArmor(target, factionOf(state, target.faction)) : combatUnitDefense(state, target),
        edge: aiMarauderEdge(state, cannon, target),
      }),
      shoot: (cannon, target, damage) => {
        launchJavelin(state, cannon, cannon, target, damage, .5);
        state.projectiles![state.projectiles!.length - 1].kind = 'cannonball';
      },
    });
    traceOrchestration(state, 'phase', 'actors');
    for (const unit of activeUnits) {
      if (state.palaceCaptures?.length) break;
      const marauder = unit.hp > 0 && unit.kind !== 'sailboat' && isScheduledMarauder(unit);
      const unitDt = marauder ? marauderUpdateElapsed(state, unit, dt) : dt;
      if (marauder) {
        unit.cooldown = Math.max(0, unit.cooldown - dt);
        unit.attackTime = Math.max(0, unit.attackTime - dt);
        if (!unitDt) {
          if (!unit.infantryDrillLeader) unit.moving = false;
          // Keep firing at an already acquired, still-valid target on the
          // ordinary combat clock. This never selects a target or plans a path.
          if (unit.cooldown <= 0 && unit.attack > 0 && unit.order !== 'flee' && !unit.marauderRetreating) {
            const target = targetEntity(state, unit.target);
            if (target && targetDistance(unit, target) <= unitAttackRange(state.world, unit, target)
              && validTarget(state, unit, target)) attackTarget(state, unit, target);
          }
          continue;
        }
      }
      try {
        if (unit.hp <= 0 || unit.kind === 'fieldCannon' || unit.kind === 'sailboat' || unit.embarkedOn !== undefined && unit.kind !== 'leader') continue;
        // Hundreds of builders wait inside their towns. Every other branch below
        // is a no-op for them (evacuation, panic, morale, yields and drills skip
        // sheltered workers), so take the same path without the long cascade.
        if (unit.inside && unit.kind === 'worker' && unit.builder && !marauder && !unit.engineer && unit.villageId === undefined
          && !unit.explorationRefugee && unit.training === undefined && !unit.civilianPanic && !unit.cargoBatches?.length
          && unit.seaInvasion === undefined && unit.order !== 'flee' && !unit.garrison && !unit.drainageWork && !unit.resourceWork
          && !isRetinueMember(unit) && !friendlyYield.has(unit) && !(offensiveDirective(state, unit) && isOffensiveMember(state, unit))) {
          unit.moving = false;
          unit.cooldown = Math.max(0, unit.cooldown - unitDt); unit.attackTime = Math.max(0, unit.attackTime - unitDt);
          updateBuilder(state, unit, unitDt, moveUnit);
          continue;
        }
        if (unit.engineer) { updateEngineer(state, unit, unitDt, moveUnit, (a, b) => atWar(state, a, b)); continue; }
        if (unit.kind === 'leader' && unit.embarkedOn !== undefined) {
          updateSailingLeader(state, unit, unitDt, state.multiplayer ? playerInput(state, unit.faction) : unit.faction === 0 ? input : NO_INPUT);
          continue;
        }
        if (isRetinueMember(unit) && !unit.garrison && getLeader(state, unit.faction)?.embarkedOn !== undefined) {
          const landing = warshipReinforcementGoal(state, unit);
          if (unit.embarkedOn !== undefined) continue;
          if (landing) { moveUnit(state, unit, landing, unitDt, true); continue; }
          unit.moving = false; unit.path = undefined; unit.destination = undefined;
          unit.cooldown = Math.max(0, unit.cooldown - unitDt); unit.attackTime = Math.max(0, unit.attackTime - unitDt);
          const enemy = isSoldier(unit) && nearestEnemy(state, unit, EnemyQuery.PlayerLeader, maximumUnitRange(unit) + 1e-7, false, target => targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target));
          if (enemy) attackTarget(state, unit, enemy);
          continue;
        }
        if (unit.kind === 'merchant' && unit.aboardRiverTrade) {
          updateMerchant(state, unit, unitDt, moveUnit); continue;
        }
        if (unit.explorationRefugee) {
          const goal = unit.explorationRefugee;
          if (rustEngine.exploration_refugee_arrived(unit.x, unit.y, goal.x, goal.y)) arrivedRefugees.add(unit.id);
          else moveUnit(state, unit, goal, unitDt);
          continue;
        }
        if (updateForbiddenEvacuation(state, unit, unitDt)) continue;
        // Dedicated explorers handle navigation and danger independently of
        // the Leader's formation, combat stance, or morale orders.
        if (unit.kind === 'scout' && updateScout(state, unit, unitDt,
          (game, scout, goal, elapsed) => moveUnit(game, scout, goal, elapsed, false, false, true),
          (a, b) => atWar(state, a, b))) continue;
        if (unit.training && unit.training.enteredAt === undefined && unit.retinueStance === 'aggressive' && unit.recallIssuedAt === undefined) {
          const threat = nearestEnemy(state, unit, EnemyQuery.Aggressive, 7, true);
          if (threat) interruptOutboundTraining(state, unit);
        }
        if (unit.training && updateArcheryTraining(state, unit, unitDt,
          (game, trainee, goal, elapsed) => moveUnit(game, trainee, goal, elapsed, false, false, true))) continue;
        if (!infantryFormationLeader(state, unit)) unit.moving = false;
        if (!marauder) { unit.cooldown = Math.max(0, unit.cooldown - unitDt); unit.attackTime = Math.max(0, unit.attackTime - unitDt); }
        if (unit.kind === 'supplyCart') { updateSupplyCart(state, unit, unitDt, moveUnit); continue; }
        if (unit.kind === 'skirmisher' && updateFortSkirmisher(state, unit, unitDt, {
          hostile: (a, b) => atWar(state, a, b), visible: (observer, target) => targetInSight(state, observer, target),
          move: moveUnit, attack: (skirmisher, target) => attackTarget(state, skirmisher, target),
        })) continue;
        if (updateCivilianPanic(state, unit, unitDt, moveUnit,
          (a, b) => atWar(state, a, b), (observer, target) => targetInSight(state, observer, target))) continue;
        if (unit.villageId !== undefined) {
          if (updateFriendlyYield(state, unit, unitDt)) continue;
          updateVillageUnit(state, unit, unitDt, {
            hostile: (a, b) => atWar(state, a, b), visible: (observer, target) => targetInSight(state, observer, target),
            move: moveUnit, engage: (villager, target, elapsed) => fight(state, villager, target, elapsed),
          });
          continue;
        }
        if (unit.kind === 'scout') continue;
        if (unit.kind === 'militia') {
          updateMilitia(state, unit, unitDt, {
            shoot: (guard, target) => attackTarget(state, guard, target),
            canEngage: (guard, target) => canReachAttack(state, guard, target),
            move: (game, guard, goal, elapsed) => { if (!updateFriendlyYield(game, guard, elapsed)) moveUnit(game, guard, goal, elapsed); },
            engage: (guard, target, elapsed) => { if (!updateFriendlyYield(state, guard, elapsed)) fight(state, guard, target, elapsed); },
          });
          continue;
        }
        if (isHuntable(unit)) {
          if (!updateFriendlyYield(state, unit, unitDt)) updateHerdAnimal(state, unit, unitDt, moveUnit);
          continue;
        }
        if (unit.kind === 'merchant') {
          if (!updateFriendlyYield(state, unit, unitDt)) updateMerchant(state, unit, unitDt, moveUnit);
          continue;
        }
        if (unit.seaInvasion !== undefined && updateSeaRetreat(state, unit, unitDt, moveUnit)) continue;
        updateMorale(state, unit, unitDt);
        const offensive = offensiveDirective(state, unit);
        if (offensive && isOffensiveMember(state, unit)) {
          clearFriendlyYield(state, unit);
          if (offensive.recover) { unit.order = 'follow'; unit.routed = false; unit.routOrder = undefined; unit.routUntil = undefined; }
          const target = offensive.target === undefined ? undefined : targetEntity(state, offensive.target);
          if (offensive.mode === 3 && unit.order !== 'flee' && target && target.hp > 0 && atWar(state, unit.faction, target.faction)) fight(state, unit, target, unitDt);
          else {
            unit.target = undefined;
            // A newly routed member waits at most one observation interval for
            // its return order, rather than fleeing toward the stationary Leader.
            if (unit.order !== 'flee' || offensive.mode === 1) {
              if (distance(unit, offensive.goal) > .4) moveUnit(state, unit, offensive.goal, unitDt, false, true);
              else { unit.path = undefined; unit.pathGoal = undefined; unit.moving = false; }
            }
          }
          continue;
        }
        if (unit.order === 'flee') {
          unit.infantryDrillLeader = undefined;
          if (unit.infantryFormation?.active) {
            unit.infantryFormation.active = false;
            for (const member of state.units) if (member.infantryDrillLeader === unit.id) member.infantryDrillLeader = undefined;
          }
          updateFleeing(state, unit, unitDt); continue;
        }
        if (unit.garrison && updateGarrison(state, unit, {
          yield: () => updateFriendlyYield(state, unit, unitDt),
          enemy: (accept, radius) => nearestEnemy(state, unit, EnemyQuery.Garrison, radius, true, accept),
          fight: target => fight(state, unit, target, unitDt),
          move: point => moveUnit(state, unit, point, unitDt),
        })) continue;
        const drilledLeader = infantryFormationLeader(state, unit);
        if (drilledLeader) {
          // Ranks hold their positions and fire/strike only in actual reach.
          // In particular, archers do not evade into a separate loose mob.
          unit.target = undefined;
          const enemy = nearestEnemy(state, unit, EnemyQuery.InfantryDrill, maximumUnitRange(unit) + 1e-7, true,
            target => targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target));
          if (enemy) attackTarget(state, unit, enemy);
          unit.facing = drilledLeader.infantryFormation!.heading;
          continue;
        }
        if (isSoldier(unit) && unit.forcedAttack && updateForcedAttack(state, unit, unitDt)) continue;
        // Movement and retreat previously returned before muskets could fire.
        // A ready shot is independent of yielding or taking an evasive step.
        if (unit.kind === 'musketman' && rustEngine.battle_ready_shot(UNIT_KIND_CODES[unit.kind], unit.cooldown, unit.attack,
          Number(unit.recallIssuedAt !== undefined), Number(!!unit.forcedAttack))) {
          const shot = nearestEnemy(state, unit, EnemyQuery.ReadyShot, maximumUnitRange(unit) + 1e-7, true,
            target => targetDistance(unit, target) <= unitAttackRange(state.world, unit, target) && unitAttackContact(state, unit, target));
          if (shot) attackTarget(state, unit, shot);
        }
        if (updateFriendlyYield(state, unit, unitDt)) continue;
        if (unit.faction === MARAUDER_FACTION && unit.marauderPack !== undefined) { updateMarauder(state, unit, unitDt); continue; }
        if (unit.kind === 'leader') updateLeader(state, unit, unitDt, state.multiplayer ? playerInput(state, unit.faction) : unit.faction === 0 ? input : NO_INPUT);
        else if (isSoldier(unit)) {
          if (!evadeMelee(state, unit, unitDt, (game, archer, goal, elapsed) => moveUnit(game, archer, goal, elapsed, false, false, true), (a, b) => atWar(state, a, b), target => targetInSight(state, unit, target)))
            updateWarrior(state, unit, unitDt, state.multiplayer ? (() => { const held = playerInput(state, unit.faction); return held.left !== held.right || held.up !== held.down || getLeader(state, unit.faction)?.order === 'flee'; })() : playerTraveling);
        }
        else if (unit.kind === 'worker' && unit.drainageWork) updateDrainageWorker(state, unit, unitDt, moveUnit);
        else if (unit.kind === 'worker' && unit.resourceWork) updateResourceWorker(state, unit, unitDt, moveUnit);
        else if (unit.kind === 'worker' && unit.builder) updateBuilder(state, unit, unitDt, moveUnit);
        else if (unit.kind === 'worker' && unit.collector) updateCollector(state, unit, unitDt, moveUnit);
      } finally { if (unit.kind === 'leader') updateLeaderBrace(unit, unitDt); autoHunt(state, unit); settleCourier(state, unit); refreshIndexedUnit(state, unit); refreshFogUnit(state, unit); refreshPeasant(state, unit); }
    }
    traceOrchestration(state, 'phase', 'separation');
    // Collision separation can move several scouts. It does not query sight;
    // let the normal end-of-update validation observe the resulting positions.
    endFogFrame(state);
    const separationStarted = profile ? performance.now() : 0;
    separateUnits(state, oldPositions, activeUnits);
    if (profile) profile.separationMs += performance.now() - separationStarted;
  } finally { endUnitFrame(state); endCollectorFrame(state); endPeasantFrame(state); endNavigationFrame(state); endFogFrame(state); }
  if (arrivedRefugees.size) entityStore(state).units.retain(unit => !arrivedRefugees.has(unit.id));
  traceOrchestration(state, 'phase', 'post-units');
  updateHermits(state, dt);
  updateQuests(state);
  runRecurringWork(state, 'treasure-discovery', dt, () => { updateTreasureChests(state); updateExploration(state); });
  regenerateUnits(state, dt);
  traceOrchestration(state, 'phase', 'traffic');
  if (!state.palaceCaptures?.length) {
    beginTrafficFrame(state);
    try {
      for (const unit of activeUnits) {
        const from = oldPositions.get(unit.id);
        if (from && unit.kind !== 'sailboat' && unit.embarkedOn === undefined) {
          if (unit.kind === 'merchant') recordMerchantRoad(state, unit, from);
          else recordTraffic(state, unit, from);
        }
      }
      runRecurringWork(state, 'traffic-maintenance', dt, () => updateTraffic(state));
    } finally { endTrafficFrame(state); }
  }
  traceOrchestration(state, 'phase', 'cleanup');
  runRecurringWork(state, 'dead-entities', dt, () => {
    // Account for deaths before removing them; combat impacts remain immediate.
    resolveSailingPassengers(state);
    recordCivilianCasualties(state);
    updateUnitDeaths(state);
    entityStore(state).units.retain(unit => unit.hp > 0);
    entityStore(state).buildings.retain(building => building.hp > 0 || building.kind === 'fort');
  });
  runRecurringWork(state, 'retinue-membership', dt, () => synchronizeRetinueSquads(state));
  if (state.palaceCaptures?.length) return;
  traceOrchestration(state, 'phase', 'economy');
  runRecurringWork(state, 'defense-rebuilds', dt, () => updateDefenseRebuilds(state, (order, minimumId) => buildAt(state, order.kind, order.x, order.y, order.faction, undefined, { ...order, minimumId }).ok));
  while (takeEconomyTick(state, ECONOMY_INTERVAL)) economyTick(state);
  runRecurringWork(state, 'mass-levy', dt, () => updateMassLevy(state));
  traceOrchestration(state, 'phase', 'automation');
  advanceAutomaticDevelopment(state);
  runRecurringWork(state, 'mass-levy', dt, () => updateMassLevy(state));
  ensureCollectors(state);
  traceOrchestration(state, 'phase', 'game-over');
  runRecurringWork(state, 'game-over', dt, () => checkGameOver(state));
}
export interface GameUpdateOptions {
  /** Single-player frontend: budget broad recurring passes and let its RAF
   * construction queue own cleanup. Direct/server callers retain full updates. */
  interactive?: boolean;
  /** Host wall clock in milliseconds (Date.now() in main.ts and the match
   * worker; a fixed or simulated clock in tests and parity runs). Only the
   * real-time Leader respawn deadline reads it. Omitted: the last value the
   * host supplied for this game is reused. */
  wallNow?: number;
}
export function updateGame(state: GameState, dt: number, input: InputState, options?: GameUpdateOptions): void {
  if (options?.wallNow !== undefined) setHostWallClock(state, options.wallNow);
  withSimulationReads(state, () => {
    displaceNewObstacles(state);
    try { updateGameWithSharedViews(state, dt, input, !!options?.interactive && !state.multiplayer); }
    finally { displaceNewObstacles(state); }
  });
}
function updateGameWithSharedViews(state: GameState, dt: number, input: InputState, interactive: boolean): void {
  traceOrchestration(state, 'update', interactive ? 'interactive' : 'direct');
  updateLeaderRespawns(state, hostWallClock(state));
  runRecurringWork(state, 'wall-stats', 0, () => updateWallStats(state));
  if (!interactive) advanceConstructionReconciliation(state);
  if (state.paused || state.gameOver || state.palaceCaptures?.length || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, 60) * state.speed;
  while (remaining > 1e-8 && !state.gameOver && !state.palaceCaptures?.length) {
    const step = Math.min(remaining, .1);
    traceOrchestration(state, 'substep', 'step');
    const advance = () => withFarmTravelPlanningStep(state, () => withMovementPathBudget(state, () => stepGame(state, step, input)));
    if (interactive) withRecurringWorkBudget(state, advance); else advance();
    remaining -= step;
  }
  if (state.multiplayer) for (const faction of state.multiplayer.humanFactionIds) publishFog(state, faction);
  else publishFog(state);
}

/** Holding is an explicit command; selecting a soldier must never stop its following. */
export function setRetinueOrder(state: GameState, order: 'hold' | 'follow', unitId?: number): void {
  invalidateDecisions(state);
  for (const unit of state.units) {
    if (unit.faction !== playerFaction(state) || !isSoldier(unit) || unit.garrison || unit.hp <= 0 || (unitId !== undefined && unit.id !== unitId)) continue;
    interruptOutboundTraining(state, unit);
    finishForcedAttack(state, unit, false);
    unit.attackReturn = undefined;
    unit.retinueStance = undefined; unit.defensiveAnchor = undefined;
    unit.recallIssuedAt = undefined; unit.recallReturnOrder = undefined;
    if (unit.order === 'flee') { unit.routOrder = order; continue; }
    unit.order = order; unit.target = undefined; unit.destination = undefined;
    unit.moving = false;
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  if (unitId === undefined) state.retinueStance = order === 'hold' ? 'hold' : 'aggressive';
}

export function setRetinueStance(state: GameState, stance: RetinueStance): void {
  if (state.gameOver) return;
  setRetinueOrder(state, stance === 'hold' ? 'hold' : 'follow');
  state.retinueStance = stance;
  for (const unit of state.units) {
    if (unit.faction !== playerFaction(state) || !isSoldier(unit) || unit.garrison || unit.hp <= 0) continue;
    unit.retinueStance = stance;
    if (unit.joiningRetinue) unit.order = 'follow';
    unit.defensiveAnchor = stance === 'defensive' ? { x: unit.x, y: unit.y } : undefined;
    releaseAttackSpot(state, unit); clearFriendlyYield(state, unit);
  }
}

export function toggleMovementMode(state: GameState): 'travel' | 'formation' {
  invalidateDecisions(state);
  if (!state.gameOver) {
    state.movementMode = state.movementMode === 'formation' ? 'travel' : 'formation';
    if (state.movementMode === 'formation') setRetinueStance(state, 'aggressive');
  }
  return state.movementMode ?? 'travel';
}

/** Break combat for the entire retinue, regardless of the current selection. */
export function recallRetinue(state: GameState): void {
  invalidateDecisions(state);
  if (state.gameOver || !getLeader(state)) return;
  cancelOffensive(state);
  releaseGarrison(state);
  for (const unit of state.units) {
    if (unit.faction !== playerFaction(state) || !isRetinueMember(unit) || unit.hp <= 0) continue;
    // Recall is a temporary movement command, independent of the selected
    // stance. Remember explicit individual hold orders as well as named stances.
    unit.recallReturnOrder ??= unit.retinueStance === 'hold' || (unit.order === 'flee' ? unit.routOrder : unit.order) === 'hold' ? 'hold' : 'follow';
    interruptOutboundTraining(state, unit);
    finishForcedAttack(state, unit, false);
    unit.attackReturn = undefined;
    if (unit.order === 'flee') unit.routOrder = 'follow';
    else unit.order = 'follow';
    unit.recallIssuedAt = state.time;
    unit.target = undefined; unit.destination = undefined; unit.path = undefined; unit.pathGoal = undefined;
    unit.repathAt = 0; unit.stuckFor = 0; unit.attackTime = 0; unit.moving = false;
    releaseAttackSpot(state, unit); clearFriendlyYield(state, unit); failedApproaches.delete(unit);
  }
}

/** Pointing selects an entity without issuing an attack or movement order. */
export function selectAt(state: GameState, x: number, y: number): void {
  if (state.gameOver) return;
  const unit = unitAtPoint(state, { x, y });
  state.diplomacy = null;
  if (unit) { state.selected = unit.id; state.selectedType = 'unit'; return; }
  const building = buildingAtPoint(state, { x, y });
  if (!building) { state.selected = null; state.selectedType = null; return; }
  state.selected = building.id; state.selectedType = 'building';
  const leader = getLeader(state);
  if (leader && building.kind === 'palace' && building.faction !== playerFaction(state) && building.faction >= 0 && edgeDistance(leader, building) <= 6
    && !factionOf(state, building.faction)?.defeated) state.diplomacy = building.faction;
}

/** A ground command always attempts an in-bounds location. If that cell cannot
 * be reached, approach the nearest reachable cell instead of discarding it. */
export function commandMove(state: GameState, x: number, y: number, onFailure?: (message: string) => void): boolean {
  invalidateDecisions(state);
  const leader = getLeader(state);
  if (state.gameOver || !leader || !Number.isFinite(x) || !Number.isFinite(y) || !tileAt(state.world, x, y)) {
    onFailure?.(state.gameOver ? 'The match has ended.' : !leader ? 'A living Leader is required to issue orders.' : 'Choose a destination inside the world.');
    return false;
  }
  const report = (result: { ok: boolean; message: string }): boolean => {
    if (!result.ok) { logEvent(state, result.message, 'warning'); onFailure?.(result.message); }
    return result.ok;
  };
  const selectedShip = state.selectedType === 'unit' && state.selected !== null ? entityStore(state).units.get(state.selected) : undefined;
  if (selectedShip?.kind === 'fieldCannon') return report(orderFieldCannon(state, selectedShip, { x, y }));
  if (selectedShip?.warship && selectedShip.faction === leader.faction && leader.embarkedOn !== selectedShip.id && unitAtPoint(state, { x, y })?.id !== selectedShip.id) {
    return report(warshipMove(state, selectedShip, { x, y }));
  }
  if (leader.embarkedOn !== undefined) {
    const result = commandSailingMove(state, leader, { x, y });
    const boat = boardedBoat(state, leader);
    state.selected = boat?.id ?? leader.id; state.selectedType = 'unit'; state.diplomacy = null;
    return report(result);
  }
  const boat = unitAtPoint(state, { x, y });
  if (boat?.kind === 'sailboat') {
    const result = orderBoardBoat(state, boat, leader);
    state.selected = leader.embarkedOn !== undefined ? boat.id : leader.id; state.selectedType = 'unit'; state.diplomacy = null;
    return report(result);
  }
  leader.boardingBoat = undefined;
  for (const unit of state.units) if (unit.faction === playerFaction(state) && unit.forcedAttack) finishForcedAttack(state, unit, unit !== leader);
  const requested = { x: Math.floor(x) + .5, y: Math.floor(y) + .5 };
  const route = findPath(state, leader, requested, leader.faction, true);
  const destination = route.at(-1) ?? { x: leader.x, y: leader.y };
  leader.destination = { ...destination }; leader.target = undefined; leader.path = undefined; leader.pathGoal = undefined; leader.repathAt = 0;
  state.selected = leader.id; state.selectedType = 'unit'; state.diplomacy = null;
  return true;
}

/** A visible peaceful structure can offer war without requiring a palace visit.
 * Querying the target does not move troops or change diplomatic relations. */
export function warDeclarationTargetAt(state: GameState, x: number, y: number): Building | undefined {
  if (state.gameOver || !getLeader(state) || unitAtPoint(state, { x, y })) return;
  const building = buildingAtPoint(state, { x, y });
  if (!building || building.faction < 0 || building.faction === playerFaction(state)) return;
  const faction = factionOf(state, building.faction);
  return faction && !faction.defeated && faction.relation === 'peace' ? building : undefined;
}

/** Right-click enemy commands include every living escort, even a held one. */
export function commandAttackAt(state: GameState, x: number, y: number, onFailure?: (message: string) => void): boolean {
  invalidateDecisions(state);
  const leader = getLeader(state);
  const selectedShip = state.selectedType === 'unit' && state.selected !== null ? entityStore(state).units.get(state.selected) : undefined;
  const navalTarget = selectedShip?.warship ? unitAtPoint(state, { x, y }) : undefined;
  if (leader && selectedShip?.warship && selectedShip.faction === leader.faction && navalTarget && atWar(state, selectedShip.faction, navalTarget.faction)) {
    const result = warshipAttack(state, selectedShip, navalTarget);
    if (!result.ok) onFailure?.(result.message);
    return result.ok;
  }
  if (state.gameOver || !leader || leader.embarkedOn !== undefined) {
    onFailure?.(state.gameOver ? 'The match has ended.' : !leader ? 'A living Leader is required to issue orders.' : 'Bring your Leader ashore before issuing a land attack.');
    return false;
  }
  leader.boardingBoat = undefined;
  let target = unitAtPoint(state, { x, y }) ?? buildingAtPoint(state, { x, y }), blocked = '';
  if (target && isBuilding(target) && atWar(state, leader.faction, target.faction)) {
    const defenses = palaceDefenses(state, target);
    if (defenses.length) {
      blocked = 'Destroy this city’s watchtowers and guard posts before capturing its town.';
      logEvent(state, blocked, 'warning');
      target = defenses.filter(building => targetInSight(state, leader, building))
        .sort((a, b) => edgeDistance(leader, a) - edgeDistance(leader, b)).find(building => canReachAttack(state, leader, building));
    }
  }
  if (!target || !validTarget(state, leader, target)) {
    onFailure?.(blocked || 'Choose a visible hostile unit or building to attack.');
    return false;
  }
  // An explicit assault releases stationary drill ranks through the same
  // command used by the formation control, allowing every escort to approach.
  if (leader.infantryFormation?.active) toggleInfantryFormation(state);
  state.diplomacy = null;
  state.selected = target.id; state.selectedType = isBuilding(target) ? 'building' : 'unit';
  for (const unit of state.units) {
    if (unit.faction !== playerFaction(state) || unit.hp <= 0 || unit.garrison || !isMilitary(unit) || unit.kind === 'militia') continue;
    interruptOutboundTraining(state, unit);
    const previous = unit.forcedAttack;
    unit.forcedAttack = { target: target.id,
      previousTarget: previous ? previous.previousTarget : unit.target,
      previousDestination: previous ? previous.previousDestination : unit.destination && { ...unit.destination },
      previousRecallIssuedAt: previous ? previous.previousRecallIssuedAt : unit.recallIssuedAt,
      previousPosition: previous ? previous.previousPosition : { x: unit.x, y: unit.y },
    };
    unit.target = target.id; unit.destination = undefined; unit.recallIssuedAt = undefined; unit.attackReturn = undefined;
    if (unit.kind === 'fieldCannon') requestFieldCannonDecision(state, unit);
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
    releaseAttackSpot(state, unit); clearFriendlyYield(state, unit);
  }
  return true;
}

export function interactAt(state: GameState, x: number, y: number): void {
  if (state.gameOver) return;
  const leader = getLeader(state);
  if (!leader) return;
  const point = { x, y };
  const clickedUnit = unitAtPoint(state, point);
  if (clickedUnit) {
    if (clickedUnit.faction === playerFaction(state)) {
      state.selected = clickedUnit.id; state.selectedType = 'unit'; state.diplomacy = null;
      return;
    }
    if (atWar(state, playerFaction(state), clickedUnit.faction)) {
      leader.target = clickedUnit.id; leader.destination = undefined; leader.path = undefined; leader.repathAt = 0;
      state.selected = clickedUnit.marauderPack !== undefined ? clickedUnit.id : leader.id; state.selectedType = 'unit'; state.diplomacy = null;
    } else logEvent(state, 'These people are at peace. Approach their town for diplomacy.');
    return;
  }
  const clickedBuilding = buildingAtPoint(state, point);
  if (clickedBuilding && clickedBuilding.kind !== 'irrigation' && !isRoute(clickedBuilding.kind) && !isFarmKind(clickedBuilding.kind)) {
    state.selected = clickedBuilding.id; state.selectedType = 'building';
    if (clickedBuilding.kind === 'palace' && clickedBuilding.faction !== playerFaction(state)) {
      if (edgeDistance(leader, clickedBuilding) <= 6 && !factionOf(state, clickedBuilding.faction)?.defeated) {
        state.diplomacy = clickedBuilding.faction;
      }
      else { state.diplomacy = null; logEvent(state, 'Bring your leader within 6 tiles of this town to speak with its people.'); }
      return;
    }
    if (atWar(state, playerFaction(state), clickedBuilding.faction)) {
      leader.target = clickedBuilding.id; leader.destination = undefined; leader.path = undefined; leader.repathAt = 0;
    }
    return;
  }
  state.diplomacy = null;
  if (canWalk(state, x, y, playerFaction(state))) {
    leader.destination = { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
    leader.target = undefined; leader.path = undefined; leader.repathAt = 0;
    state.selected = leader.id; state.selectedType = 'unit';
  }
}

/** Manual housing chooses a city for farm relocation without governor siting rules. */
function manualHousePlan(state: GameState, faction: number, point: Point): HouseSitePlan | undefined {
  const palaces = state.buildings.filter(building => building.kind === 'palace' && building.faction === faction && buildingReady(building))
    .sort((a, b) => distance(center(a), point) - distance(center(b), point) || a.id - b.id);
  let clearing: HouseSitePlan | undefined;
  for (const palace of palaces) {
    const plan = planHouseAt(state, palace, point);
    if (plan && !plan.clearFarm) return plan;
    clearing ??= plan;
  }
  return clearing;
}

/** A farm with no replacement plot no longer blocks an order: it is cleared and
 * its owner refunded half the farm's gold cost. Relocation is always preferred. */
function farmsToClear(state: GameState, kind: BuildingKind, point: Point, factionId: number, homePlan: HouseSitePlan | undefined,
  displacedFarm: Building | undefined, wallFarmMove: unknown, buildingFarmMoves: unknown): Building[] {
  if (kind === 'house') return homePlan?.clearFarm ? state.buildings.filter(building => building.id === homePlan.replaceCampId) : [];
  if (displacedFarm && !wallFarmMove) return [displacedFarm];
  if (buildingDisplacesFarms(kind) && !buildingFarmMoves) return farmsUnderBuilding(state, kind, point, factionId);
  return [];
}
function clearUnplaceableFarms(state: GameState, faction: Faction, farms: readonly Building[]): number {
  const ids = new Set<number>(); let refund = 0;
  for (const farm of farms) {
    if (ids.has(farm.id) || farm.hp <= 0 || !prepareConstructionCancellation(state, farm)) continue;
    ids.add(farm.id); refund += (BUILD_COSTS[farm.kind]?.gold ?? 0) / 2;
  }
  if (!ids.size) return 0;
  removeBuildings(state, ids);
  refundGold(state, faction, refund);
  return refund;
}

/** Placement previews and construction share this read-only validation. */
function validateBuildCellAt(state: GameState, kind: BuildingKind | 'clearTrees', x: number, y: number, factionId = playerFaction(state), reservedTiles?: ReadonlySet<number>, rebuilding = false, planning = false): { ok: boolean; message: string } {
  if (kind === 'clearTrees') return factionId === playerFaction(state) ? validateTreeClearing(state, x, y)
    : { ok: false, message: 'This realm cannot order tree clearing.' };
  const leader = getLeader(state, factionId), faction = factionOf(state, factionId);
  if (state.gameOver || !leader && !rebuilding || !faction) return { ok: false, message: 'This realm can no longer build.' };
  if (!BUILDABLE_KINDS.includes(kind) && !(rebuilding && kind === 'tower')) return { ok: false, message: 'Choose a building from the build panel.' };
  const point = { x: Math.floor(x), y: Math.floor(y) };
  if (kind === 'thermalBath') {
    const error = thermalBathSiteError(state, factionId, point); if (error) return { ok: false, message: error };
    if (!siteTarget(state, point.y * state.world.width + point.x, factionId)) return { ok: false, message: 'Approach the site with your Leader.' };
  }
  const resourceError = resourceFootprintError(state.world, point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind }));
  if (resourceError) return { ok: false, message: resourceError };
  if (!reliefFootprintAllowed(state.world, point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind }), isWallKind(kind)))
    return { ok: false, message: isWallKind(kind) ? 'Walls require pathable ground.' : 'Hills and mountains cannot be built on.' };
  if (kind === 'palace' && !settlementFootprintAllowed(state.world, point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind })))
    return { ok: false, message: `Place towns at least ${SETTLEMENT_MOUNTAIN_GAP} tiles from mountains.` };
  const occupancy = placementOccupancy(state);
  if (occupancy.berthBlocked(point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind })))
    return { ok: false, message: 'Leave the dock jetty clear.' };
  if (kind === 'dock' && !dockPlacement(state, point.x, point.y, factionId))
    return { ok: false, message: 'Place a dock on a low shore with clear water beside it and a dry approach.' };
  for (let dy = 0; dy < buildingHeight({ kind }); dy++) for (let dx = 0; dx < buildingWidth({ kind }); dx++)
    if (isForbidden(state, point.x + dx, point.y + dy, factionId)) return { ok: false, message: 'Remove the forbidden zone before building here.' };
  if (occupancy.permanentFortOverlaps(point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind })))
    return { ok: false, message: 'This Fort foundation is permanent. Its owner can rebuild it for half price.' };
  if (!rustEngine.sim_exploration_build_allowed(simCore(state).handle, point.x, point.y, buildingWidth({ kind }), buildingHeight({ kind })))
    return { ok: false, message: 'Explore this site with your Leader first.' };
  if (state.hermits?.some(h => point.x < h.x + (h.status === 'gone' ? 1 : 2) && point.x + buildingWidth({ kind }) > h.x
    && point.y < h.y + (h.status === 'gone' ? 1 : 2) && point.y + buildingHeight({ kind }) > h.y))
    return { ok: false, message: 'Leave the hermit and their cabin undisturbed.' };
  const gateRoad = kind === 'road' && hasGateWall(state, point.x, point.y, factionId);
  if (kind === 'road' && !gateRoad && isFord(tileAt(state.world, point.x, point.y)))
    return { ok: false, message: 'Fords already provide a crossing. Start the road on either bank.' };
  const siteCenter = { x: point.x + .5, y: point.y + .5 };
  const expedition = !isHumanFaction(state,factionId) && ['palace','ballista','siegeCannon'].includes(kind);
  const origin = isHumanFaction(state, factionId) || expedition ? leader : entityStore(state).buildings.query('palace')
    .filter(palace => palace.faction === factionId && buildingReady(palace))
    .reduce<Building | undefined>((nearest, palace) => !nearest || distance(palace, siteCenter) < distance(nearest, siteCenter) ? palace : nearest, undefined);
  if (!rebuilding && !planning && (!origin || distance(origin, siteCenter) > 10))
    return { ok: false, message: isHumanFaction(state, factionId) ? 'Build within 10 tiles of your leader.' : 'Build near your town.' };
  if (kind === 'bridge') {
    if (state.units.some(unit => unit.kind === 'sailboat' && unit.hp > 0
      && galleyOverlapsTile(unit, point.x, point.y)))
      return { ok: false, message: 'Move the galley before building a bridge here.' };
    const crossing = validateBridgeTile(state, point.x, point.y, factionId);
    if (!crossing.ok) return crossing;
  }
  if (kind !== 'bridge' && kind !== 'thermalBath' && !traversable(state.world, point.x, point.y)) return { ok: false, message: 'Build on dry land.' };
  if (kind === 'irrigation' && WATER.has(tileAt(state.world, point.x, point.y)!.terrain)) return { ok: false, message: 'Build on dry land.' };
  if (buildingOverlapsVillageBorders(state, kind, point.x, point.y, factionId))
    return { ok: false, message: 'Cannot build inside a neutral village’s borders.' };
  if (kind === 'observationPost') {
    const postValidation = validateObservationPost(state, factionId, siteCenter);
    if (!postValidation.ok) return postValidation;
    if (faction.gold < BUILD_COSTS.observationPost.gold) return { ok: false, message: 'Need 20 gold.' };
    return { ok: true, message: '' };
  }
  if (!buildingWithinBorders(state, kind, point.x, point.y, factionId))
    return { ok: false, message: kind === 'palace' ? 'Towns cannot be built inside another faction’s borders.' : 'Build entirely within your faction’s borders.' };
  if (kind === 'whalingPost') { const error = whalingPostSiteError(state, point); if (error) return { ok: false, message: error }; }
  if (kind === 'shipyard') { const error = shipyardSiteError(state, factionId, point); if (error) return { ok: false, message: error }; }
  if (kind === 'colosseum') { const error = colosseumSiteError(state, factionId, point); if (error) return { ok: false, message: error }; }
  if (kind === 'granary') { const error = granarySiteError(state, factionId, point); if (error) return { ok: false, message: error }; }
  if (kind === 'library' && !libraryPlacementAllowed(state, factionId, { x: point.x + 1, y: point.y + 1 }))
    return { ok: false, message: 'Only one library per city.' };
  if (kind === 'well' && faction.population < WELL_POPULATION_REQUIREMENT)
    return { ok: false, message: `Wells require ${WELL_POPULATION_REQUIREMENT} population.` };
  if (!isBuildingUnlocked(faction, kind)) {
    const technology = RESEARCH_BRANCHES.find(branch => branch.id === buildingResearchRequirement(kind))!;
    return { ok: false, message: `Research ${technology.tiers[0].name} at a library first.` };
  }
  if (kind === 'siegeCannon' && !factionHasDevelopedResource(state, factionId, 'iron'))
    return { ok: false, message: 'Develop an iron mine inside your city borders first.' };
  const cost = buildCostAt(state, kind, point.x, point.y, factionId);
  if (!canAfford(faction, kind, cost)) return { ok: false, message: `Need ${Math.ceil(cost.gold)} gold.` };
  const replacedPalisade = palisadeForUpgrade(state, kind, point.x, point.y, factionId);
  const homePlan = kind === 'house' ? manualHousePlan(state, factionId, point) : undefined;
  const displacedFarm = isWallKind(kind) || kind === 'road' ? farmAt(state, point, factionId) : undefined;
  const wallFarmMove = displacedFarm ? (kind === 'road' ? planRoadFarmRelocation : planWallFarmRelocation)(state, point, factionId, reservedTiles) : undefined;
  const buildingFarmMoves = buildingDisplacesFarms(kind) ? planBuildingFarmRelocations(state, kind, point, factionId) : undefined;
  const movingFarmIds = new Set(buildingFarmMoves?.farms.map(plan => plan.camp));
  const clearingFarmIds = new Set(farmsToClear(state, kind, point, factionId, homePlan, displacedFarm, wallFarmMove, buildingFarmMoves).map(farm => farm.id));
  const removedFarmIds = new Set([...movingFarmIds, ...clearingFarmIds]);
  const occupants = occupancy.at(point.x, point.y);
  const sharedDefense = occupants.find(building => building.hp > 0
    && canShareWallTowerTile({ kind, faction: factionId, ...point }, building));
  if (sharedDefense && occupants.some(building => building.hp > 0 && building.kind === 'road'
    && building.x === point.x && building.y === point.y))
    return { ok: false, message: 'Towers need a solid wall section, not a gate.' };
  if (occupants.some(building => {
    const gateLayer = (building.faction === factionId || building.faction === -1) && ((kind === 'road' && isWallKind(building.kind)) || (isWallKind(kind) && building.kind === 'road'));
    const irrigationLayer = building.faction === factionId && (kind === 'irrigation' && (isFarmKind(building.kind) || building.kind === 'road')
      || building.kind === 'irrigation' && (kind === 'road' || isFarmKind(kind)));
    if (replacedPalisade?.id === building.id || homePlan?.replaceCampId === building.id || wallFarmMove?.camp === building.id || removedFarmIds.has(building.id) || gateLayer || irrigationLayer || canShareHouseWellTile({ kind, faction: factionId, ...point }, building)
      || canShareWallTowerTile({ kind, faction: factionId, ...point }, building)
      || !isFarmKind(kind) && !['road', 'bridge'].includes(kind) && replaceableRoad(building, factionId)) return false;
    const size = buildingWidth(building), height = buildingHeight(building);
    return building.hp > 0 && point.x >= building.x && point.y >= building.y && point.x < building.x + size && point.y < building.y + height;
  })) return { ok: false, message: 'Tile occupied.' };
  const clearedSite = removedFarmIds.size ? { ...state,
    buildings: state.buildings.filter(building => !removedFarmIds.has(building.id)),
    fields: state.fields?.filter(field => !removedFarmIds.has(field.camp)) } : state;
  if (kind !== 'irrigation' && !homePlan?.farmMove && !wallFarmMove && (clearedSite.fields?.some(field => field.x === point.x && field.y === point.y) || isPendingCampField(clearedSite, point.x, point.y)))
    return { ok: false, message: 'Keep this field open.' };
  if (kind === 'road' && !gateRoad && !hasNeighboringRoad(state, point.x, point.y, { includeConstruction: true })) return { ok: false, message: 'Extend an existing road or bridge, or start from a ford.' };
  if (kind === 'irrigation' && !irrigationConnects(state, point.x, point.y, reservedTiles))
    return { ok: false, message: 'Start irrigation beside freshwater or extend an existing ditch.' };
  // Replacing wall material does not add a gate or alter its existing spacing.
  const network = replacedPalisade || rebuilding ? { ok: true, message: '' } : validateNetworkPlacement(state, kind, point.x, point.y, factionId);
  if (!network.ok) return network;
  if (kind === 'camp') {
    if (!campSpacingAllowed(state, point.x, point.y)) return { ok: false, message: 'Farm plots cannot overlap.' };
    if (!CAMP_FIELD_OFFSETS.every(([dx, dy]) => freeField(state, point.x + dx, point.y + dy, factionId)))
      return { ok: false, message: 'A farm needs one clear crop tile without a road.' };
    const proposed: Building = { id: -1, kind, ...point, faction: factionId, hp: 100, maxHp: 100, capacity: 0 };
    if (!state.buildings.some(palace => palace.kind === 'palace' && palace.faction === factionId && buildingReady(palace) && canReachConstruction(state, palace, proposed)))
      return { ok: false, message: 'Farm needs a route from the town.' };
  }
  if (kind === 'thermalBath') {
    const physical = validatePhysicalFootprint(state, kind, point.x, point.y, factionId, { units: false });
    if (!physical.ok) return physical;
    const proposed: Building = { id: -1, kind, ...point, faction: factionId, hp: THERMAL_BATH_HP, maxHp: THERMAL_BATH_HP, capacity: 0 };
    if (!state.buildings.some(palace => palace.kind === 'palace' && palace.faction === factionId && buildingReady(palace) && canReachConstruction(state, palace, proposed)))
      return { ok: false, message: 'This building needs a builder route from the town.' };
  }
  if (kind === 'dock') {
    const proposed: Building = { id: -1, kind, ...point, faction: factionId, hp: DOCK_HP, maxHp: DOCK_HP, capacity: 0 };
    if (!state.buildings.some(palace => palace.kind === 'palace' && palace.faction === factionId && buildingReady(palace) && canReachConstruction(state, palace, proposed)))
      return { ok: false, message: 'This building needs a builder route from the town.' };
  }
  if (kind === 'palace' || kind === 'fort' || kind === 'archeryRange' || kind === 'library' || kind === 'colosseum' || kind === 'barracks' || kind === 'forum' || kind === 'granary' || kind === 'shipyard' || kind === 'whalingPost' || kind === 'foundry' || kind === 'militaryAcademy') {
    for (let dy = 0; dy < buildingHeight({ kind }); dy++) for (let dx = 0; dx < buildingWidth({ kind }); dx++)
      if (!freeTile(clearedSite, point.x + dx, point.y + dy, factionId)
        || clearedSite.fields?.some(field => field.x === point.x + dx && field.y === point.y + dy))
        return { ok: false, message: kind === 'militaryAcademy' ? 'A Military Academy needs a clear 2 by 2 area.' : kind === 'foundry' ? 'A foundry needs a clear 2 by 2 area.' : kind === 'whalingPost' ? 'A whaling post needs a clear 2 by 2 area.' : kind === 'fort' ? 'A Fort needs a clear 3 by 3 area.' : kind === 'palace' ? 'A town needs a clear 2 by 2 area.' : kind === 'shipyard' ? 'A shipyard needs a clear 3 by 3 area.' : kind === 'granary' ? 'A granary needs a clear 2 by 2 area.' : kind === 'forum' ? 'A forum needs a clear 2 by 2 area.' : kind === 'library' ? 'A library needs a clear 2 by 2 area.' : kind === 'colosseum' ? 'A Colosseum needs a clear 2 by 2 area.' : kind === 'barracks' ? 'A barracks needs a clear 2 by 1 area.' : 'An archery range needs a clear 2 by 1 area.' };
    const proposed: Building = { id: -1, kind, ...point, faction: factionId, hp: SETTLEMENT_MAX_HP, maxHp: SETTLEMENT_MAX_HP, capacity: 0 };
    if (!state.buildings.some(palace => palace.kind === 'palace' && palace.faction === factionId && buildingReady(palace) && canReachConstruction(state, palace, proposed)))
      return { ok: false, message: 'This building needs a builder route from an existing city.' };
  }
  if (kind === 'house' && !homePlan) return { ok: false, message: 'House needs a dry, unoccupied tile; occupied farms need a free replacement plot farther from the town.' };
  const accessError = scenarioPlacementError(state,kind,point.x,point.y);
  if (accessError) return { ok: false, message: accessError };
  return { ok: true, message: '' };
}

/** Placement previews and orders enforce the same connected farm-block rules. */
export function validateBuildAt(state: GameState, kind: BuildSelection, x: number, y: number, factionId = playerFaction(state), reservedTiles?: ReadonlySet<number>, rebuilding = false, scenarioOrder = false): { ok: boolean; message: string } {
  const validation = validateBuildCellAt(state, kind === 'clearTrees' ? kind : buildingKindForSelection(kind), x, y, factionId, reservedTiles, rebuilding, scenarioOrder && !!state.scenarioPreparing);
  if (!validation.ok || kind !== 'camp') return validation;
  return farmBlockPlacementQuery(state).canAdd({ x: Math.floor(x), y: Math.floor(y) });
}

const constructionBatches = new WeakMap<GameState, { factions: Set<number>; farms: boolean }>();
interface ConstructionReconciliation { farms: boolean; collectors: boolean; builders: boolean }
const constructionReconciliations = new WeakMap<GameState, ConstructionReconciliation>();

/** The frontend also pumps ordinary orders when there is no linear purchase. */
export function constructionReconciliationPending(state: GameState): boolean {
  return constructionReconciliations.has(state);
}

/** Complete one global housekeeping phase between interactive road cells.
 * Paused orders also drain this queue, without advancing the simulation clock. */
export function advanceConstructionReconciliation(state: GameState): boolean {
  const pending = constructionReconciliations.get(state);
  if (!pending) return false;
  const task = (): boolean => {
    if (pending.farms) { pending.farms = false; synchronizeFarms(state); return true; }
    if (pending.collectors) { pending.collectors = false; ensureCollectors(state); return true; }
    if (pending.builders) { pending.builders = false; ensureBuilders(state); return true; }
    // Unfinished footprints have no output or upkeep. Recomputing every city
    // yield here is both unnecessary and the largest placement-time hitch.
    // Completion and the normal economy/HUD passes publish actual new output.
    constructionReconciliations.delete(state);
    return false;
  };
  return withSimulationReads(state, () => withImmediateMaintenance(state, task));
}

/** A linear order still validates and pays for each tile immediately. Reconcile
 * city rates and worker assignments once after all accepted tiles are present,
 * instead of rebuilding those derived views for every segment of the stroke. */
export function withConstructionBatch<T>(state: GameState, run: () => T, deferReconciliation = false): T {
  if (constructionBatches.has(state)) return run();
  const batch = { factions: new Set<number>(), farms: false }; constructionBatches.set(state, batch);
  try {
    return deferReconciliation ? withDeferredMaintenance(state, () => withFarmRelocationBatch(state, run))
      : withFarmRelocationBatch(state, run);
  }
  finally {
    constructionBatches.delete(state);
    if (deferReconciliation) {
      let pending = constructionReconciliations.get(state);
      if (!pending) {
        pending = { farms: false, collectors: false, builders: false };
        constructionReconciliations.set(state, pending);
      }
      pending.farms ||= batch.farms; pending.collectors ||= batch.farms; pending.builders ||= batch.factions.size > 0;

    } else {
      if (batch.farms) ensureCollectors(state);
      if (batch.factions.size) {
        ensureBuilders(state);
        scheduleArcheryTraining(state);
        for (const id of batch.factions) { const faction = factionOf(state, id); if (faction) calculateYields(state, faction); }
      }
    }
  }
}

function refreshAfterConstructionOrder(state: GameState, faction: Faction): void {
  const batch = constructionBatches.get(state);
  if (batch) { batch.factions.add(faction.id); return; }
  let pending = constructionReconciliations.get(state);
  if (!pending) { pending = { farms: false, collectors: false, builders: true }; constructionReconciliations.set(state, pending); }
  pending.builders = true;
}

/** Offline scenario orders omit Leader proximity while preparation is active.
 * Ordinary terrain, ownership, technology, cost and construction rules apply. */
export function buildAt(state: GameState, selection: BuildSelection, x: number, y: number, factionId = playerFaction(state), reservedTiles?: ReadonlySet<number>, rebuilding?: DefenseRebuild & { minimumId?: number }, scenarioOrder = false): { ok: boolean; message: string } {
  if (!constructionBatches.has(state)) return withSimulationReads(state, () => withConstructionBatch(state, () => buildAt(state, selection, x, y, factionId, reservedTiles, rebuilding, scenarioOrder), true));
  const kind = selection === 'clearTrees' ? selection : buildingKindForSelection(selection);
  const validation = validateBuildAt(state, kind, x, y, factionId, reservedTiles, !!rebuilding, scenarioOrder);
  if (!validation.ok) return validation;
  invalidateDecisions(state);
  if (kind === 'observationPost') return placeObservationPost(state, factionId, { x, y });
  if (kind === 'clearTrees') { const result = orderTreeClearing(state, x, y); if (result.ok) ensureBuilders(state); return result; }
  const faction = factionOf(state, factionId)!;
  const point = { x: Math.floor(x), y: Math.floor(y) };
  const homePlan = kind === 'house' ? manualHousePlan(state, factionId, point) : undefined;
  if (kind === 'house' && !homePlan) return { ok: false, message: 'House needs a dry, unoccupied tile.' };
  // Relocate displaced farms when a replacement plot exists; otherwise clear them.
  const unplaceable: Building[] = [];
  const campOf = (id: number | undefined) => state.buildings.find(building => building.id === id);
  const relocatedHome = !!homePlan?.farmMove && relocateFarm(state, homePlan.farmMove, point);
  if (homePlan?.replaceCampId !== undefined && !relocatedHome) { const camp = campOf(homePlan.replaceCampId); if (camp) unplaceable.push(camp); }
  const displacedFarm = isWallKind(kind) || kind === 'road' ? farmAt(state, point, factionId) : undefined;
  const wallFarmMove = displacedFarm ? (kind === 'road' ? planRoadFarmRelocation : planWallFarmRelocation)(state, point, factionId, reservedTiles) : undefined;
  if (displacedFarm && (!wallFarmMove || !relocateFarm(state, wallFarmMove, point, { wall: true, road: kind === 'road', reservedTiles }))) unplaceable.push(displacedFarm);
  const buildingFarmMoves = buildingDisplacesFarms(kind) ? planBuildingFarmRelocations(state, kind, point, factionId) : undefined;
  if (buildingDisplacesFarms(kind) && (!buildingFarmMoves || !relocateBuildingFarms(state, buildingFarmMoves)))
    unplaceable.push(...farmsUnderBuilding(state, kind, point, factionId));
  const farmRefund = clearUnplaceableFarms(state, faction, unplaceable);
  const cost = buildCostAt(state, kind, point.x, point.y, factionId);
  const replacedPalisade = palisadeForUpgrade(state, kind, point.x, point.y, factionId);
  pay(state, faction, kind, cost);
  const building = makeBuilding(state, kind, factionId, point, rebuilding ? Math.max(rebuilding.sourceId + 1, rebuilding.minimumId ?? 0) : 0);
  if (relocatedHome) { building.redevelopedFarm = true; building.capacity = houseCapacity(building, faction, state); }
  queueConstruction(building, state.time, cost.gold, state);
  if (replacedPalisade && building.construction) building.construction.replacesPalisade = replacedPalisade.id;
  if (relocatedHome || wallFarmMove || buildingFarmMoves?.farms.length || unplaceable.length) {
    const batch = constructionBatches.get(state);
    if (batch) batch.farms = true;
    else { synchronizeFarms(state); ensureCollectors(state); }
  }
  refreshAfterConstructionOrder(state, faction);
  const message = kind === 'ballista' || kind === 'siegeCannon' ? `${kind === 'siegeCannon' ? 'Siege cannon' : 'Ballista'} ordered. Assembly starts automatically without a civilian.` : `${kind === 'palace' ? 'Town' : kind === 'guardPost' ? 'Guard post' : kind.charAt(0).toUpperCase() + kind.slice(1)} ordered. A town peasant will begin construction.`;
  return { ok: true, message: farmRefund ? `${message} No free plot for the farm: cleared, ${Math.round(farmRefund)} gold refunded.` : message };
}

/** Cancel only a living friendly order; finished buildings are never deleted. */
export function cancelConstruction(state: GameState, buildingId: number, factionId = playerFaction(state)): { ok: boolean; refund: number } {
  const building = state.buildings.find(candidate => candidate.id === buildingId);
  const faction = factionOf(state, factionId);
  if (state.gameOver || !faction || !building || building.faction !== factionId || building.hp <= 0 || !building.construction)
    return { ok: false, refund: 0 };
  if (!prepareConstructionCancellation(state, building)) return { ok: false, refund: 0 };
  // Canceling an unfinished source also cancels its dependent stone order:
  // refunding the palisade alone would leave a wall with an unpaid discount.
  let replacementRefund = 0;
  if (building.kind === 'palisade') for (const replacement of state.buildings.filter(candidate =>
    candidate.faction === factionId && candidate.hp > 0 && candidate.construction?.replacesPalisade === building.id))
    replacementRefund += cancelConstruction(state, replacement.id, factionId).refund;
  invalidateDecisions(state);
  const refund = cancellationRefund(state, building);
  refundGold(state, faction, refund);
  pauseCityConstruction(state, building);
  removeBuildings(state, new Set([building.id]));
  const size = buildingWidth(building), height = buildingHeight(building);
  const left = building.x, top = building.y;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + size; x++) {
    if (building.kind === 'irrigation') continue;
    if (state.traffic) delete state.traffic[y * state.world.width + x];
  }
  synchronizeFarms(state); ensureCollectors(state); ensureBuilders(state);
  calculateYields(state, faction);
  return { ok: true, refund: refund + replacementRefund };
}

/** Reconcile the economy and dependent jobs immediately after demolition. */
export function refreshAfterBuildingRemoval(state: GameState, factionId: number, housingRemoved = false): void {
  invalidateDecisions(state);
  const faction = factionOf(state, factionId);
  if (faction && !palaceOf(state, factionId)) faction.defeated = true;
  if (housingRemoved) rehouse(state, factionId);
  else synchronizeFarms(state);
  updateWallOwnership(state);
  ensureCollectors(state); ensureBuilders(state);
  if (faction) calculateYields(state, faction);
  checkGameOver(state);
}

/** Apply current simulation rules when opening an older saved realm. */
export function migrateGame(state: GameState): GameState {
  invalidateDecisions(state);
  resetEntities(state);
  state.retinueStance ??= 'aggressive';
  state.movementMode ??= 'travel';
  for (const unit of state.units) if (unit.faction === playerFaction(state) && isSoldier(unit)) {
    unit.retinueStance ??= (unit.order === 'flee' ? unit.routOrder : unit.order) === 'hold' ? 'hold' : state.retinueStance;
    if (unit.retinueStance === 'defensive') unit.defensiveAnchor ??= { x: unit.x, y: unit.y };
  }
  state.projectiles ??= [];
  normalizePunyWorld(state.world);
  // Retire legacy concepts with no matching Puny assets, including fog memories.
  const removedIds = new Set([...state.units.filter(unit => !SUPPORTED_UNITS.has(unit.kind)).map(unit => unit.id), ...state.buildings.filter(building => building.kind === 'ruin').map(building => building.id)]);
  entityStore(state).units.retain(unit => SUPPORTED_UNITS.has(unit.kind));
  entityStore(state).buildings.retain(building => building.kind !== 'ruin');
  for (const building of state.buildings) if (building.construction) {
    const site = building.construction;
    // Orders from before this price reduction retain their original refund value.
    site.paidGold ??= building.kind === 'camp' ? 300 : ['house', 'shack', 'cottage'].includes(building.kind) ? 500
      : building.kind === 'wall' && building.maxHp === 450 ? 0 : BUILD_COSTS[building.kind].gold;
    if (isWallKind(building.kind) && site.duration !== 4) {
      const progress = constructionProgress(state, building);
      site.duration = 4;
      site.startedAt = (site.pausedAt ?? state.time) - progress * site.duration;
    }
  }
  for (const building of [...state.buildings, ...(state.fog?.buildings ?? [])]) {
    if (building.kind !== 'wall' && building.kind !== 'tower') continue;
    const ratio = building.hp / building.maxHp;
    building.kind = isWallKind(building.kind) ? 'wall' : 'woodenTower';
    building.maxHp = building.kind === 'wall' ? 225 : 600;
    building.hp = Math.max(0, ratio * building.maxHp);
    building.armor = building.kind === 'wall' ? 2 : 6;
  }
  for (const faction of state.factions) { faction.production = 0; faction.yields.production = 0; }
  for (const palace of state.buildings) if (palace.kind === 'palace') clearPalaceWoodland(state.world, palace);
  for (const building of state.buildings) clearBuildingVegetation(state, building);
  if (state.fog?.buildings) state.fog = { ...state.fog, buildings: state.fog.buildings.filter(building => building.kind !== 'ruin') };
  for (const unit of state.units) if (unit.target !== undefined && removedIds.has(unit.target)) unit.target = undefined;
  if (state.selected !== null && removedIds.has(state.selected)) {
    state.selected = getLeader(state)?.id ?? null;
    state.selectedType = state.selected === null ? null : 'unit';
  }
  for (const faction of state.factions) {
    // Keep ownership colors from saves and custom scenarios. Expand short hex
    // for the unit renderer, which consumes complete RGB channels.
    if (/^#[\da-f]{6}$/i.test(faction.color)) continue;
    if (/^#[\da-f]{3}$/i.test(faction.color)) {
      faction.color = '#' + faction.color.slice(1).split('').map(channel => channel + channel).join('');
    } else {
      const id = Number.isFinite(faction.id) ? Math.trunc(faction.id) : 0;
      faction.color = FACTION_COLORS[((id % FACTION_COLORS.length) + FACTION_COLORS.length) % FACTION_COLORS.length];
    }
  }
  const migrationWalls = new Map<number, { blockers: Set<number>; solidWalls: Building[]; wallTiles: Set<number> }>();
  for (const unit of state.units) {
    let access = migrationWalls.get(unit.faction);
    if (!access) {
      const blockers = buildingBlockers(state, unit.faction);
      const solidWalls = state.buildings.filter(building => isWallKind(building.kind) && building.hp > 0 && blockers.has(building.y * state.world.width + building.x));
      access = { blockers, solidWalls, wallTiles: new Set(solidWalls.map(wall => wall.y * state.world.width + wall.x)) };
      migrationWalls.set(unit.faction, access);
    }
    const { blockers, solidWalls, wallTiles } = access;
    // Older saves had public gates. Move occupants out only when their own
    // faction can no longer pass, without crossing water or solid buildings.
    if (unit.hp > 0 && solidWalls.some(wall => unit.x + UNIT_RADIUS > wall.x && unit.x - UNIT_RADIUS < wall.x + 1 && unit.y + UNIT_RADIUS > wall.y && unit.y - UNIT_RADIUS < wall.y + 1)) {
      const queue: Point[] = [{ x: Math.floor(unit.x), y: Math.floor(unit.y) }], visited = new Set<number>();
      let replacement: Point | undefined;
      for (let index = 0; index < queue.length && !replacement; index++) {
        const tile = queue[index], key = tile.y * state.world.width + tile.x;
        if (visited.has(key)) continue;
        visited.add(key);
        const point = { x: tile.x + .5, y: tile.y + .5 };
        if (canMove(state, point, point, unit.faction, blockers)) { replacement = point; break; }
        if (index > 0 && !wallTiles.has(key)) continue;
        const neighbors = [{ x: tile.x - 1, y: tile.y }, { x: tile.x + 1, y: tile.y }, { x: tile.x, y: tile.y - 1 }, { x: tile.x, y: tile.y + 1 }];
        neighbors.sort((a, b) => distance(unit, { x: a.x + .5, y: a.y + .5 }) - distance(unit, { x: b.x + .5, y: b.y + .5 }));
        for (const neighbor of neighbors) if (traversable(state.world, neighbor.x, neighbor.y) && (wallTiles.has(neighbor.y * state.world.width + neighbor.x) || canWalk(state, neighbor.x, neighbor.y, unit.faction, blockers))) queue.push(neighbor);
      }
      if (replacement) {
        unit.x = replacement.x; unit.y = replacement.y; unit.destination = undefined;
        if (unit.kind === 'worker') unit.work = { ...replacement };
      }
    }
    if (unit.kind === 'leader') unit.range = 4;
    if (isRetinueMember(unit)) unit.speed = unit.marauderPack !== undefined ? 2.35 : RETINUE_SPEED * mountedSpeedMultiplier(unit.kind);
    unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0;
  }
  for (const unit of state.units) {
    if (unit.kind === 'worker') {
      // Preserve wounds while applying the new peasant health once, including legacy saves.
      unit.hp = Math.max(0, Math.min(50, unit.hp / (unit.maxHp ?? 100) * 50));
      unit.maxHp = 50;
    } else if (unit.maxHp === undefined) {
      const pack = state.marauderPacks?.find(candidate => candidate.id === unit.marauderPack);
      unit.maxHp = pack?.raiderCamp !== undefined ? fogRaidProfile(pack.retinueAtSpawn ?? 0, pack.spawnedAt ?? state.time).hp
        : pack?.raid ? 60 + Math.min(40, (pack.retinueAtSpawn ?? 0) * 3)
        : unit.marauderPack !== undefined ? (unit.attack <= (unit.marauderLeader ? 14 : 10) ? 65 : 80) : 100;
      unit.hp = Math.min(unit.hp, unit.maxHp);
    }
  }
  initializeUnitDamageTimes(state);
  initializeFogRaids(state, 30);
  migrateFarms(state); ensureBuilders(state);
  initializeRoamingMarauders(state);
  importSettlementSnapshot(state);
  initializeExploration(state);
  if (state.buildMode && state.buildMode !== 'clearTrees' && !BUILDABLE_KINDS.includes(buildingKindForSelection(state.buildMode))) state.buildMode = null;
  for (const faction of state.factions) calculateYields(state, faction);
  publishFog(state);
  refreshDiplomacy(state);
  return state;
}

export function diplomacyAction(state: GameState, factionId: number, action: 'war' | 'confederate' | 'trade' | 'ally' | 'petition', buildingId?: number): { ok: boolean; message: string } {
  if (state.multiplayer && factionOf(state, factionId)?.villageId === undefined) return { ok: false, message: 'The two duel factions are at war.' };
  const faction = factionOf(state, factionId), leader = getLeader(state);
  if (state.gameOver || !faction || factionId === playerFaction(state) || faction.defeated || faction.relation === 'confederated') return { ok: false, message: 'This faction is no longer available for diplomacy.' };
  if (faction.villageId !== undefined) {
    if (!leader) return { ok: false, message: 'Your leader is no longer available.' };
    const village = state.villages?.find(v => v.id === faction.villageId), camp = village && villageCamp(state, village);
    if (!camp) return { ok: false, message: 'This village no longer has a camp.' };
    const targetId = buildingId ?? camp.id;
    const target = state.buildings.find(b => b.id === targetId && b.faction === factionId && b.hp > 0)
      ?? state.units.find(unit => unit.id === targetId && unit.faction === factionId && unit.hp > 0 && !unit.inside);
    if (!target || !entityVisible(state, target)) return { ok: false, message: 'That village representative is no longer visible.' };
    const result = performVillageAction(state, camp, action, true);
    if (result.ok) { invalidateDecisions(state); logEvent(state, result.message, action === 'war' ? 'warning' : 'good'); }
    return result;
  }
  if (action === 'petition') return { ok: false, message: 'This faction has no petition.' };
  if (action === 'war') return negotiateDiplomacy(state, factionId, 'war');
  if (action === 'trade' || action === 'ally') return negotiateDiplomacy(state, factionId, 'propose',
    { ...emptyDiplomacyTerms(), flags: action === 'trade' ? TREATY.trade : TREATY.alliance });
  const eligibility = negotiateDiplomacy(state, factionId, 'confederate');
  if (!eligibility.ok) return eligibility;
  {
    invalidateDecisions(state);
    const player = factionOf(state, playerFaction(state))!;
    grantIncome(player, { food: faction.food, gold: faction.gold, culture: faction.culture ?? 0 }, state, 'transfers');
    player.food += Math.min(0, faction.food); player.population += faction.population;
    recordCampaignPopulation(state, player);
    recordGoldOutlay(state, faction, faction.gold, 'transfers');
    faction.culture = 0;
    faction.food = 0; faction.gold = 0; faction.production = 0; faction.population = 0; faction.yields = { food: 0, production: 0, gold: 0 };
    faction.relation = 'confederated';
    const joined: Building[] = [];
    for (const building of state.buildings) if (building.faction === factionId) {
      building.faction = player.id;
      applyDefenseResearch(building, player);
      if (building.kind === 'palace') { building.cultureAtFounding = lifetimeCulture(player); joined.push(building); }
    }
    const changedTiles: number[] = [];
    for (let cell = 0; cell < state.world.tiles.length; cell++) if (state.world.tiles[cell].farm === factionId) {
      state.world.tiles[cell].farm = player.id; changedTiles.push(cell);
    }
    for (const field of state.fields ?? []) if (field.faction === factionId) field.faction = player.id;
    invalidateScheduledHarvests(state);
    markWorldChanged(state.world, 'structure', changedTiles);
    for (const unit of state.units) if (unit.faction === factionId) {
      unit.faction = player.id; unit.target = undefined; unit.path = undefined; unit.pathGoal = undefined; unit.repathAt = 0; unit.destination = undefined; unit.morale = Math.max(60, unit.morale);
      if (unit.kind === 'leader') { entityStore(state).setUnitRole(unit, { kind: 'warrior' }); unit.attack = 20; unit.range = 1.2; }
      if (isRetinueMember(unit)) unit.speed = RETINUE_SPEED * mountedSpeedMultiplier(unit.kind);
      unit.order = unit.kind === 'worker' ? 'work' : 'follow';
    }
    for (const squad of state.retinueSquads ?? []) if (squad.faction === factionId) squad.faction = player.id;
    // Each joining city keeps its heritage; loyalty becomes max(previous, 60).
    for (const palace of joined) settlements(state).commitTransfer(palace.id, palace.id, player.id, TRANSFER.confederateCivilization);
    invalidateRetinueSquads(state);
    synchronizeRetinueSquads(state);
    applyFactionEquipment(state, player.id);
    synchronizeFarms(state); ensureCollectors(state);
    calculateYields(state, player); state.diplomacy = null;
    const message = `${faction.name} joins your realm! Its people, buildings, and stores are now yours.`;
    logEvent(state, message, 'good'); checkGameOver(state);
    return { ok: true, message };
  }

}

registerDiplomacySight(targetInSight);
