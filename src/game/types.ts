import type { DiplomacySnapshot } from './diplomacy-view';
import type { FishingState } from './fishing';
import type { HarborTradeShip } from './harbor-trade';
import type { InfantryFormationState } from './infantry-drill';
import type { ArmyWarning } from './army-warnings';
import type { WorldGenerationStyle } from '../world/options';

export type Terrain = 'ocean' | 'coast' | 'river' | 'lake' | 'desert' | 'plains' | 'grassland' | 'tundra';
export type Overlay = 'none' | 'forest' | 'jungle' | 'swamp' | 'volcano' | 'glacier' | 'ford';
export type TreeClass = 'tropical' | 'dry' | 'temperate' | 'conifer' | 'snowy';
export type Biome = 'temperate' | 'taiga' | 'tundra' | 'rainforest' | 'savanna' | 'steppe' | 'desert' | 'wetland' | 'alpine';
export type HillBiome = 'desert-hills' | 'forest-hills';
export type RegionalResource = 'clay' | 'copper' | 'iron' | 'gold' | 'stone' | 'salt' | 'olives' | 'fish';
export type ResourceWorkKind = 'copper' | 'iron' | 'gold' | 'stone' | 'salt' | 'olives';
export interface ResourceWorkSite {
    id: number;
    faction: number;
    resource: ResourceWorkKind;
    cells: number[];
    revision: number;
    nextVisitAt: number;
    roadComplete: boolean;
    roadWorker?: number;
    retryAt?: number;
}
export interface ResourceWork {
    site: number;
    revision: number;
    resource: ResourceWorkKind;
    /** Assigned footprint retained through the return trip and ownership edits. */
    cells?: number[];
    phase: 'road' | 'outbound' | 'working' | 'returning';
    goal: Point;
    approach: Point;
    roadCells?: Point[];
    roadIndex?: number;
    roadProgress?: number;
    worked?: number;
    roamAt?: number;
    workTarget?: Point;
    pulseUntil?: number;
    nextPlanAt?: number;
}
export interface Tile {
    /** 1..3 volcanoes, 4..6 hot mud pools; every occupied cell is volcanic terrain. */
    geothermal?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Top-left cell index of this feature's complete 2x2 footprint. */
    geothermalAnchor?: number;
    /** Nonblocking 8FC desert decoration; permanently removed by construction. */
    desertStone?: number;
    terrain: Terrain;
    overlay: Overlay;
    elevation: number;
    moisture: number;
    /** Generated climate fields, normalized to 0..1. */
    temperature?: number;
    rainfall?: number;
    /** Base food multiplier: grass 100%, plains 75%, desert 50%, plus freshwater. */
    fertility?: number;
    /** Ecological identity uses the existing terrain and vegetation artwork. */
    biome?: Biome;
    /** Local hill-country identity, independent of the underlying climate. */
    hillBiome?: HillBiome;
    resource?: RegionalResource;
    /** Connected geological deposit/grove identity, stable within this world. */
    resourceGroup?: number;
    /** Complete native ore footprint; all members reference its top-left cell. */
    oreAnchor?: number;
    oreFamily?: 0 | 1 | 2;
    oreVariant?: 0 | 1;
    oreWidth?: number;
    oreHeight?: number;
    /** Development belongs to the land; benefits follow its current city owner. */
    resourceDeveloped?: boolean;
    /** Catchment runoff and downstream tile index in the generated drainage network. */
    flow?: number;
    drainage?: number;
    /** Visible river centerline, separate from its full water footprint. */
    channel?: 'tributary' | 'main';
    channelWidth?: number;
    channelNext?: number;
    /** Narrow surface stream, rendered with native slim water and closed to boats. */
    creek?: boolean;
    creekGround?: 'grassland' | 'plains' | 'desert';
    /** Original Puny 10px banked channel through a waterfall-bearing reach. */
    riverArt?: 'banked';
    /** A detached crescent left beside a winding lowland river. */
    oxbow?: boolean;
    /** Downstream drop through a south-facing native ledge; never a crossing. */
    waterfall?: 'south';
    /** Coastal delta identity; marsh marks dry, vegetated interchannel ground. */
    delta?: number;
    marsh?: boolean;
    /** Incised floor or surviving native ledge along a river cut through uplands. */
    canyon?: 'floor' | 'wall';
    /** Geological province and erosion fields, separate from climate/biome. */
    landform?: import('../world/options').LandformKind;
    rockResistance?: number;
    sediment?: number;
    food: number;
    production: number;
    gold: number;
    variation: number;
    /** Sandy ocean shoreline, distinct from the inland desert biome. */
    beach?: boolean;
    /** Sparse coastal scenery; a lone palm is not a dense forest tile. */
    palm?: boolean;
    /** Regional tree family chosen by latitude, moisture and elevation. */
    treeClass?: TreeClass;
    /** Raised plateau identity; unset is the surrounding low ground. */
    ridge?: number;
    /** Height within a range; each upper shelf is nested inside the lower one. */
    ridgeTier?: 1 | 2 | 3 | 4 | 5;
    /** Broad landform region; vegetation remains an independent overlay. */
    relief?: 'hills' | 'mountains';
    /** Native terrain region; identity has no effect on traversal. */
    reliefRegion?: number;
    /** Rust policy bits: walkable 1, buildable 2, trees 4. */
    reliefFlags?: number;
    /** Tactical elevation independently of cliff/stair artwork. */
    reliefLevel?: number;
    reliefSpeed?: number;
    reliefRuggedness?: number;
    /** Retained chunky/reference/natural art treatment. */
    reliefStyle?: 0 | 1 | 2;
    /** Low-ground corridor through a layered mountain range. */
    mountainPass?: boolean;
    /** Freshwater basin shape, independent of connected rivers. */
    lakeShape?: 'compact' | 'snaky';
    /** Uphill direction, from the adjacent low approach into this raised tile. */
    stair?: 'north' | 'east' | 'south' | 'west';
    /** Bank-to-bank direction shared by every tile of a ford strip. */
    fordAxis?: 'horizontal' | 'vertical';
    /** Generated neutral-village footpath; normal road placement removes it. */
    villageTrail?: true;
    farm?: number;
    /** Native-generated landscape identity; independent of movement/building rules. */
    worldFeature?: number;
}
export interface Point {
    x: number;
    y: number;
}
export interface TreasureChest extends Point {
    id: number;
    collected?: boolean;
    discovery?: 'ancient-grove' | 'mountain-pass' | 'lake-shore' | 'river-confluence' | 'coastal-headland';
    name?: string;
    rewardGold?: number;
}
export type WorldFeatureKind = 'atoll' | 'harbor' | 'oasis' | 'old-river' | 'volcanic-island';
export interface WorldFeature extends Point {
    id: number;
    kind: WorldFeatureKind;
    radiusX: number;
    radiusY: number;
}
export interface World {
    scenario?: import('./scenario-content').ScenarioId;
    /** The initial ECS terrain-placement command has completed. */
    geothermalGenerated?: true;
    width: number;
    height: number;
    seed: string;
    generationStyle?: WorldGenerationStyle;
    generationParameters?: import('../world/options').LandscapeParameters;
    landformFamily?: import('../world/options').LandformFamily;
    landformProvinces?: import('../world/landforms').LandformProvince[];
    riverDeltas?: import('../world/river-deltas').RiverDelta[];
    worldFeatures?: WorldFeature[];
    tiles: Tile[];
    spawns: Point[];
    /** Second city for each rival, indexed by faction id minus one. */
    secondarySpawns?: Point[];
    /** Initial city placement preserves this inter-faction separation. */
    minimumFactionStartDistance?: number;
    source: string;
    revision?: number;
}
export type BuildingKind = 'fort' | 'supplyDepot' | 'palace' | 'camp' | 'house' | 'shack' | 'cottage' | 'road' | 'wall' | 'palisade' | 'bridge' | 'dock' | 'irrigation' | 'ruin' | 'tower' | 'woodenTower' | 'well' | 'monument' | 'blacksmith' | 'guardPost' | 'archeryRange' | 'scoutLodge' | 'observationPost' | 'healerShack' | 'ballista' | 'siegeCannon' | 'stable' | 'library' | 'villageTent' | 'colosseum' | 'barracks' | 'forum' | 'granary' | 'thermalBath' | 'shipyard' | 'whalingPost' | 'foundry' | 'militaryAcademy' | 'hospital' | 'apartments' | 'factory' | 'goldMine';
export interface BridgeConstruction extends Point {
    readonly width: number;
    readonly height: number;
    /** Tile entities in deterministic order, starting with the construction site. */
    readonly ids: readonly number[];
}
export type RoadStyle = 'road' | 'trail';
export type BuildSelection = BuildingKind | 'clearTrees';
export const buildingKindForSelection = (kind: Exclude<BuildSelection, 'clearTrees'>): BuildingKind => kind;
export type HouseStyle = 'shack' | 'hovel' | 'cottage' | 'villa';
/** Stone walls and wooden palisades share gates, ownership and path blocking. */
export const isWallKind = (kind: BuildingKind): boolean => kind === 'wall' || kind === 'palisade';
/** Farms are uninhabited, pathable single-tile crop plots. */
export const isFarmKind = (kind: BuildingKind): boolean => kind === 'camp' || kind === 'shack' || kind === 'cottage';
export const BUILDABLE_KINDS: readonly BuildingKind[] = ['fort', 'supplyDepot', 'road', 'camp', 'house', 'wall', 'palisade', 'bridge', 'dock', 'irrigation', 'woodenTower', 'well', 'monument', 'blacksmith', 'guardPost', 'archeryRange', 'scoutLodge', 'observationPost', 'healerShack', 'ballista', 'siegeCannon', 'stable', 'library', 'palace', 'colosseum', 'barracks', 'forum', 'granary', 'thermalBath', 'shipyard', 'whalingPost', 'foundry', 'militaryAcademy', 'hospital', 'apartments', 'factory'];
export type WarshipClass = 'warGalley' | 'caravel' | 'frigate';
export type NavalWeapon = 'empty' | 'ballista' | 'cannon';
export type MarineType = 'archer' | 'musketman';
export interface NavalGunner {
    target?: number; facing: number; firedAt?: number;
    shot?: { from: Point; to: Point; time: number; projectile?: boolean };
}
export interface ShipSinking extends Point {
    id: number; class: WarshipClass; faction: number; facing: number; time: number;
}
export interface Warship {
    class: WarshipClass; name: string; yard: number; speed: number; kills: number;
    marine: MarineType; crewHp: number; weapons: NavalWeapon[]; anchored: boolean;
    readyAt: number; nextUpkeepAt: number; funded: boolean; lastAttacker: number; lastAttackerShip?: number; rewarded: boolean;
    attackTarget?: number; guns?: NavalGunner[]; passengers?: number[]; shore?: Point; reinforcing?: boolean;
}
export interface Building extends Point {
    scenarioCity?: boolean;
    explorationUpkeepUntil?: number;
    /** Previous sovereign for negotiated return of captured towns. */
    previousSovereign?: number;
    /** A confederated village's palace keeps the village identity bonus. */
    villageIdentity?: VillageIdentity;
    fort?: { brigadeLevel: 0 | 1 | 2 | 3; nextUpkeepAt: number; funded: boolean; nextRecruitAt: number; destroyed?: boolean; initialGold?: number };
    supplyDepot?: { nextDispatchAt: number };
    id: number;
    /** Initial capital only; later settlements start with the ordinary border radius. */
    initialCity?: boolean;
    /** This town receives lower upkeep while its original founder owns it. */
    foundingSubsidyFaction?: number;
    kind: BuildingKind;
    /** Capturable world objective; progress is in simulated seconds. */
    mineCaptureFaction?: number;
    mineCaptureProgress?: number;
    mineContested?: boolean;
    /** Omitted for the standard road; trails differ only in their artwork. */
    roadStyle?: RoadStyle;
    /** Derived by the native neighborhood/research rule. */
    roadPaved?: boolean;
    /** Direction from this dock's dry house tile to the reserved water tile: N/E/S/W. */
    dockFacing?: 0 | 1 | 2 | 3;
    /** Set only after the dock successfully launches its one included sailboat. */
    dockBoatLaunched?: boolean;
    faction: number;
    hp: number;
    maxHp: number;
    capacity: number;
    /** Applied computer difficulty; separate from fortification/research health. */
    enemyStrengthMultiplier?: number;
    villageId?: number;
    /** Unmodified defensive health before layout and faction research bonuses. */
    defenseBaseMaxHp?: number;
    /** Derived from live stone walls, gates, and tower support; never a new base. */
    fortificationHealthMultiplier?: number;
    /** A palace's city identity persists when its faction changes. */
    cityName?: string;
    /** A fort's name persists through destruction and rebuilding. */
    fortName?: string;
    /** Original fort, then moat; the 3×3 plot never changes. */
    fortLevel?: 1 | 2;
    /** Palaces begin as settlements; Fortification permits a one-time Keep upgrade. */
    palaceLevel?: 1 | 2;
    /** One paid expansion raises the Keep's own housing from 10 to 25. */
    keepHousingExpanded?: boolean;
    /** Faction culture when this city was founded or acquired. */
    cultureAtFounding?: number;
    /** Residents staying at their city's palace, including any overflow waiting for houses. */
    unhousedResidents?: number;
    /** Fractional natural-birth progress earned only by this city's food surplus. */
    populationGrowth?: number;
    /** Last resident died; immigration can repopulate this city, unlike a new settlement. */
    depopulated?: boolean;
    /** Fractional automatic house orders for a city with excess vacant beds. */
    automaticHouseCredit?: number;
    /** Each palace plans its own automatic construction on this game-time clock. */
    governorNextPlanAt?: number;
    /** Simulation time last credited by a governor's housing phase. */
    governorHousingCreditedAt?: number;
    /** Cancelled or demolished productive buildings pause only this city's replacement orders. */
    governorPauseUntil?: Partial<Record<'camp' | 'house', number>>;
    /** Each city's governor independently controls new farm and house orders. */
    governorPermissions?: { farms: boolean; housing: boolean };
    /** Cumulative physical deliveries, useful when evaluating a city's supply routes. */
    foodDelivered?: number;
    /** Each hunt grants this city ten percent extra growth for thirty seconds. */
    huntingBonuses?: { startedAt: number; expiresAt: number }[];
    /** House art variant; a recorded houseLevel takes precedence when present. */
    houseStyle?: HouseStyle;
    houseLevel?: number;
    /** Advanced homes keep their current tier during this 60-second recovery grace period. */
    houseDowngradeAt?: number;
    houseUpgradeAt?: number;
    houseUpgradeLevel?: number;
    houseUpgradeFaction?: number;
    /** A residential lot reclaimed by moving its farm retains one extra bed. */
    redevelopedFarm?: boolean;
    residents?: number;
    /** Independent raider settlement, separate from full factions and farms. */
    raiderCamp?: number;
    /** Preserve harvested food when an old farm cannot retain its plots. */
    storedFood?: number;
    storedFoodBatches?: FoodBatch[];
    /** Crowded legacy camp awaiting a reachable site with space for its farm. */
    farmSuppressed?: boolean;
    /** Actual visits by the owner's units keep this crop cell cultivated. */
    farmLastVisitedAt?: number;
    /** First crop after establishment/replanting gets one normal pickup window. */
    farmFirstHarvestAt?: number;
    /** Two minutes without a visit stops regrowth until somebody returns. */
    farmFallow?: boolean;
    /** Orchard conversion is paid once and matures after two game minutes. */
    orchard?: { startedAt: number; readyAt: number };
    /** Time this farm became neutral; any ownership claim cancels disappearance. */
    farmAbandonedAt?: number;
    armor?: number;
    /** Remaining game seconds before a defensive tower may throw again. */
    attackCooldown?: number;
    siegeFacing?: number;
    siegeShotAt?: number;
    /** Game time of the most recent damaging attack; repairs require five quiet seconds. */
    lastAttacked?: number;
    repairerId?: number;
    /** The two free starting explorers and replacement deadline persist with this lodge. */
    scoutLodge?: { owner: number; initialRemaining: number; nextRecruitAt?: number };
    /** Completed guard posts pay for their garrison every thirty game seconds. */
    guardPost?: { nextUpkeepAt: number; funded: boolean; level?: 0 | 1 | 2; kills?: number; lastThreatAt?: number; needsRecruits?: boolean; wallsOnly?: boolean;
        /** Guards route and pursue through forbidden zones (default: they avoid them). */
        ignoreForbidden?: boolean };
    /** Gold paid for this completed road or bridge. Generated roads have no purchase cost. */
    roadBuildGold?: number;
    construction?: { startedAt: number; duration: number; healthProgress?: number; paidGold?: number; waitingForBuilder?: boolean; builderId?: number; pausedAt?: number; cleared?: boolean; evacuating?: boolean; researchSpeed?: number; replacesPalisade?: number; engineerId?: number; bridge?: BridgeConstruction };
}
export type UnitKind = 'slinger' | 'skirmisher' | 'levyInfantry' | 'supplyCart' | 'leader' | 'warrior' | 'swordsman' | 'spearman' | 'pikeman' | 'archer' | 'horseman' | 'horseArcher' | 'knight' | 'scout' | 'militia' | 'worker' | 'merchant' | 'sailboat' | 'boar' | 'marshBird' | 'deer' | 'buffalo' | 'elephant' | 'ostrich' | 'musketman' | 'fieldCannon';
// `kind` is an observed scalar on live entities: read it once per call.
const SOLDIER_KINDS: ReadonlySet<string> = new Set(['fieldCannon', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'archer', 'horseman', 'horseArcher', 'knight', 'levyInfantry', 'slinger', 'skirmisher']);
export const isSoldier = (unit: Pick<Unit, 'kind'>): boolean => SOLDIER_KINDS.has(unit.kind);
/** Dedicated lodge scouts explore independently of the Leader's combat retinue. */
export const isMountedKind = (kind: UnitKind): boolean => kind === 'horseman' || kind === 'horseArcher' || kind === 'knight';
export const isMeleeCavalry = (kind: UnitKind): boolean => kind === 'horseman' || kind === 'knight';
const RETINUE_KINDS: ReadonlySet<string> = new Set(['fieldCannon', 'warrior', 'swordsman', 'spearman', 'pikeman', 'musketman', 'archer', 'horseman', 'horseArcher', 'knight']);
export const isRetinueMember = (unit: Pick<Unit, 'kind'>): boolean => RETINUE_KINDS.has(unit.kind);
export type EquipmentLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type UnitOrder = 'follow' | 'hold' | 'work' | 'raid' | 'wander' | 'flee';
export type RetinueStance = 'defensive' | 'hold' | 'aggressive';
export interface OffensiveState {
    faction: number;
    leader: number;
    phase: 'rally' | 'attack' | 'captured';
    rally: Point;
    objective: Point;
}
export type BaseLeaderSkillId = 'power' | 'guard' | 'command';
export type AdvancedLeaderSkillId = 'engineer' | 'brace' | 'discretion';
export type LeaderSkillId = BaseLeaderSkillId | AdvancedLeaderSkillId;
export interface LeaderProgression {
    level: number;
    /** Experience toward the next level; excess carries forward. */
    xp: number;
    skillPoints: number;
    skills: Record<BaseLeaderSkillId, number> & Partial<Record<AdvancedLeaderSkillId, number>>;
}
export interface LeaderRespawnState {
    readyAtWallTime: number;
    progression: LeaderProgression;
    maxHp: number;
    attack: number;
    defense: number;
    position: Point;
}
export interface Unit extends Point {
    fieldCannon?: { nextUpkeepAt: number; funded: boolean; shotAt?: number };
    /** Immutable ranger specialty uses the archer combat and art pipeline. */
    ranger?: boolean;
    explorationRefugee?: Point & { city: number };
    /** A nonresident companion, independent of civilian jobs and retinue slots. */
    engineer?: { leader: number };
    brace?: { x: number; y: number; stillFor: number; defense: number };

    /** Retinue detached to defend a settlement until explicitly recalled. */
    garrison?: import('./garrison').GarrisonDuty;
    garrisonCity?: number;
    fort?: number;
    levy?: import('./mass-levy').LevyState;
    supplyCart?: { depot: number; leader: number; delivered?: boolean };
    /** Separate from the older Shift travel mode; persisted on the Leader. */
    infantryFormation?: InfantryFormationState;
    /** Refreshed each step; only this Leader and participating escorts overlap. */
    infantryDrillLeader?: number;
    /** A boarded Leader travels at this boat's position and does not fight. */
    embarkedOn?: number;
    /** Pending approach to an empty, friendly sailboat. */
    boardingBoat?: number;
    /** One boat is launched per completed dock. Landing is an explicit shore order. */
    warship?: Warship;
    barbarianGalley?: {target?:number;firedAt?:number;aim?:number};
    sailboat?: { dock: number; passenger?: number; landing?: Point; velocity?: Point };
    /** A human-owned Leader has directional right of way through its retinue. */
    humanControlled?: boolean;
    id: number;
    kind: UnitKind;
    faction: number;
    villageId?: number;
    raiderEquipmentMultiplier?: number;
    technologyBonus?: { attack: number; defense: number };
    raiderBonus?: { attack: number; defense: number };
    seaInvasion?: number;
    wallPatrol?: { gate: number; wall?: number; enteringUntil?: number; nextWall?: number; previousWall?: number };

    /** Applied difficulty factor; role conversion preserves the scaled health. */
    enemyStrengthMultiplier?: number;
    villageNextWanderAt?: number;
    villageNextThinkAt?: number;
    villageThreatId?: number;
    hp: number;
    /** Per-unit maximum, including the strength of the raid that spawned it. */
    maxHp?: number;
    morale: number;
    attack: number;
    defense: number;
    /** Faction equipment tiers; base combat stats remain unchanged. */
    armorLevel?: EquipmentLevel;
    weaponLevel?: EquipmentLevel;
    speed: number;
    range: number;
    order: UnitOrder;
    retinueStance?: RetinueStance;
    /** Temporary collision-free arrival at a levy slot. */
    levyAssembling?: boolean;
    defensiveThreat?: { target: number; until: number };
    healerHealingAt?: number;
    /** Palace recruits travel to their Leader before adopting the retinue stance. */
    joiningRetinue?: boolean;
    /** Persistent three-soldier squad; shared experience is mirrored in kills. */
    retinueSquad?: number;
    /** Home lodge for an independent explorer; it never consumes a retinue slot. */
    scoutLodge?: number;
    /** A resident assigned to a concealed, stationary wilderness lookout. */
    observationPost?: { x: number; y: number; city: number; discoveredBy: number[]; nextUpkeepAt: number; nextSmokeAt: number; retreating?: boolean; questVillage?: number };
    /** Combat role changes require a physical visit to a range or stable. */
    training?: { range: number; role: 'fieldCannon' | 'warrior' | 'swordsman' | 'spearman' | 'pikeman' | 'musketman' | 'archer' | 'horseman' | 'horseArcher' | 'knight'; enteredAt?: number };
    warriorStats?: { hp: number; attack: number; defense: number; speed?: number };
    /** Actual continuous running distance and the next allowed cavalry charge. */
    cavalryCharge?: { distance: number; dx: number; dy: number; lastMoveAt: number; readyAt: number };
    /** Loot remains on the thief until killed or deposited at a raider house. */
    stolenGold?: number;
    /** A physically entered raider building; these reserves leave the active scheduler. */
    raiderGarrison?: number;
    defensiveAnchor?: Point;
    forcedAttack?: { target: number; previousTarget?: number; previousDestination?: Point; previousRecallIssuedAt?: number; previousPosition?: Point };
    attackReturn?: Point;
    /** Recall suppresses combat until the Leader stops and this warrior regroups. */
    recallIssuedAt?: number;
    /** Recall temporarily follows the Leader, then resumes this standing order. */
    recallReturnOrder?: 'hold' | 'follow';
    home?: number;
    /** Militia belong to a guard post, independently of the Leader's retinue. */
    guardPost?: number;
    /** Guard recruits remain residents of this city; actual casualties remove one resident. */
    guardCity?: number;
    guardCasualtyRecorded?: boolean;
    /** Administrative retirement returns the guard to civilian life rather than killing a resident. */
    guardRetired?: boolean;
    herdId?: number;
    huntRewarded?: boolean;
    tradeRoute?: number;
    /** The same caravan is drawn and navigated as a boat during its river leg. */
    aboardRiverTrade?: boolean;
    /** Native-derived civilian travel mode; refreshed after movement. */
    aboardRowboat?: boolean;
    target?: number;
    destination?: Point;
    path?: Point[];
    cooldown: number;
    lastCombat: number;
    /** Actual damage time, independent of attacking or being targeted. */
    lastDamagedAt?: number;
    /** Visual hit clock: set only when an impact actually reduces health. */
    damageFlashAt?: number;
    moving: boolean;
    facing: number;
    attackTime: number;
    work?: Point;
    bornAt?: number;
    routed?: boolean;
    /** Resume the pre-rout stance once morale recovers. */
    routOrder?: UnitOrder;
    /** Marauders cannot rally or redeploy before this rout episode's deadline. */
    routUntil?: number;
    /** Brief casualty shock; its deadline also consumes losses from that episode. */
    casualtyShock?: { until: number; routed?: boolean };
    civilianPanic?: { until: number; threat: Point; previousOrder: UnitOrder; shelter?: number; destinationShelter?: number };
    /** Actual worker losses count once, even when multiple staffing passes see the corpse. */
    civilianCasualtyRecorded?: boolean;
    repathAt?: number;
    /** Consecutive failed galley route searches; drives retry backoff. */
    sailingRouteFailures?: number;
    pathGoal?: Point;
    /** Independent roaming band; its members share hostility, never a settled faction. */
    marauderPack?: number;
    lastFormationWarningAt?: number;
    marauderLeader?: boolean;
    marauderRetreating?: boolean;
    kills?: number;
    /** This Leader's earned levels and skills. Death removes one level. */
    leaderProgression?: LeaderProgression;
    leaderDeathRecorded?: boolean;
    name?: string;
    /** Palace collectors replace stationary farming sprites. */
    collector?: boolean;
    /** A member of the contiguous parcel assigned to this collector. */
    collectorCamp?: number;
    /** Grain collection point; home remains the resident's owning city. */
    collectorStorage?: number;
    /** Source field for restoring a carried harvest if a courier is retired. */
    cargoField?: number;
    inside?: boolean;
    cargo?: number;
    /** A harvest's spoilage clock continues while a peasant carries it. */
    cargoBatches?: FoodBatch[];
    cargoExpiresAt?: number;
    field?: number;
    collectPhase?: 'idle' | 'outbound' | 'returning';
    /** A visit to restart a fallow farm, even when no ripe food is waiting. */
    cultivating?: boolean;
    /** Dedicated palace peasants walk to orders and work at the site. */
    builder?: boolean;
    /** A resident on a resource road job or timed visit; separate from builders and farm couriers. */
    resourceWork?: ResourceWork;
    builderRetiring?: boolean;
    repairSite?: number;
    buildSite?: number;
    buildPhase?: 'idle' | 'outbound' | 'working' | 'repairing' | 'clearing' | 'returning';
    /** Native Drainage target and the dry bank where its civilian works. */
    drainageWork?: { cell: number; workCell: number; progress: number; farms: [number, number] };
    clearTree?: Point;
    clearProgress?: number;
    trafficTile?: number;
    stuckFor?: number;
}
export const unitMaxHp = (unit: Pick<Unit, 'kind' | 'maxHp'>): number => unit.maxHp ?? (unit.kind === 'worker' ? 50 : 100);

export interface FoodBatch { amount: number; expiresAt: number; }
export interface FarmField extends Point {
    id: number;
    camp: number;
    faction: number;
    planted: boolean;
    /** Mirrors the farm conversion for rendering and remembered fog artwork. */
    orchard?: { startedAt: number; readyAt: number };
    food: number;
    foodBatches?: FoodBatch[];
    expiresAt?: number;
    /** Shared ripe appearance across the connected wheat patch; food remains per tile. */
    wheatRipe?: boolean;
    /** Existing crop clock retained when a freshly completed plot joins a patch. */
    wheatSynchronized?: boolean;
    /** A new plot can adopt a patch’s appearance before its first full growing cycle earns food. */
    wheatYieldAfter?: number;
    nextHarvest: number;
    /** Camp-specific harvest timing has been applied; kept in saves to avoid shifting it again. */
    harvestStaggered?: boolean;
    /** Last harvest time drives the early crop stage and regrowth phases. */
    harvestedAt?: number;
    claimedBy?: number;
}
/** Last observed crop state; the timestamp freezes its growth stage beyond sight. */
export interface FarmFieldMemory extends FarmField {
    observedAt: number;
}
export interface MarauderPack {
    ruinsAmbush?: { leader: number; committed: boolean; finished?: boolean };
    seaInvasion?: number;
    lastFormationWarningAt?: number;
    id: number;
    name: string;
    color: string;
    targetFaction: number;
    home: Point;
    waypoint: Point;
    nextWanderAt: number;
    approachAt?: number;
    /** A recurring fog raid keeps attacking settlements instead of wandering home. */
    raid?: boolean;
    targetBuilding?: number;
    spawnedAt?: number;
    retinueAtSpawn?: number;
    raiderCamp?: number;
    leaderId?: number;
    startingTroops?: number;
    returning?: boolean;
    motivation?: 'assault' | 'harass' | 'theft' | 'siege';
    phase?: 'approach' | 'muster' | 'attack' | 'escape';
    musterUntil?: number;
    rally?: Point;
    lootCarrier?: number;
    raidObjectiveDone?: boolean;
    nextMotivationAt?: number;
    raidGoal?: Point;
    musterStartedAt?: number;
    musterTarget?: number;
    siegeNextReinforceAt?: number;
    /** Small recurring attacks do not consume the large-wave allowance. */
    microRaid?: boolean;
    campDefense?: boolean;
    defenseUntil?: number;
    lastProgressAt?: number;
    progressPosition?: Point;
}
export type CampSize = 'small' | 'medium' | 'large';
export interface RaiderCamp extends Point {
    id: number;
    name: string;
    size: CampSize;
    width: number;
    height: number;
    gate: Point;
    /** Stone refuge gate first, then independent palisade outpost gates. */
    gates?: Point[];
    /** Native wooden signposts; decorative, without collision or combat stats. */
    signs?: Point[];
    houses: number[];
    /** Surviving inner towers sustain the camp, independently of its tents. */
    coreTowers?: number[];
    /** Walkable middle of the protected 3×3 court, in unit coordinates. */
    refuge?: Point;
    /** Number of tents built initially; losses reduce local recruitment. */
    tentCapacity?: number;
    nextRaidAt: number;
    waves: number;
    destroyed?: boolean;
    replacementAt?: number;
    /** One defender sortie per attacked structure per thirty-second episode. */
    defenderReadyAt?: Record<number, number>;
    /** Damage and nearby civilization units refresh a short recruitment surge. */
    pressureUntil?: number;
    pressureUpdatedAt?: number;
}
export type VillageIdentity = 'growers' | 'merchants' | 'builders' | 'scholars';
export type VillageRelation = 'neutral' | 'trade' | 'allied' | 'war';
/** Static founding data and presentation for a neutral settlement. Relations,
 * trade ledgers, affiliation, treasury, growth and clocks live in the Rust
 * settlement engine (settlement.rs) and are read through settlement-view.ts. */
export interface NeutralVillage extends Point {
    /** A seceded city keeps its settlement, people and existing footprint. */
    secededCity?: { formerFaction: number; territoryCells: number[] };
    id: number;
    faction: number;
    campId: number;
    name: string;
    identity: VillageIdentity;
    /** Scenario seed: the relation toward faction 0 installed when the settlement
     * engine first imports this village. Rust owns the relation afterwards. */
    relation?: VillageRelation;
    /** Stable demand; access to a developed deposit quadruples this partner's trade. */
    requiredResource?: ResourceWorkKind;
    /** Founding layout chosen by settlement_plan_choose (lot origin in tiles). */
    layout?: { family: number; transform: number; lotX: number; lotY: number };
    destroyed?: boolean;
    /** The palace this village became when it confederated. */
    confederatedInto?: number;
}
export interface WildlifeHerd {
    id: number;
    /** Unset for boar; marsh flocks remain in their original coastal delta. */
    species?: 'marshBird';
    delta?: number;
    waypoint: Point;
    nextWanderAt: number;
    /** A brief slow forage walk; otherwise the herd grazes in place. */
    wanderUntil?: number;
    fleeUntil?: number;
    nextThinkAt?: number;
    lastThreat?: Point;
}
/** A city's merchant owns one persistent back-and-forth route. */
export interface FactionTradeAgreement { faction: number; partnerFaction: number; origin: number; partner: number }

export interface TradeRoute {
    id: number;
    faction: number;
    origin: number;
    partner: number;
    target: number;
    merchantId?: number;
    nextDepartureAt: number;
    distance: number;
    /** Population-supported rate fixed at departure, paid on arrival. */
    legValue?: { distance: number; originShare: number; partnerShare: number; goldPerSecond: number };
    /** Active game seconds, weighted by the river premium while aboard. */
    transitSeconds?: number;
    partnerFaction?: number;
    journeys: number;
    goal?: Point;
    nextPlanAt?: number;
    stuckSince?: number;
    /** Additional village connections use time-based, resource-sensitive trade. */
    villageId?: number;
    river?: RiverTradeConnection;
    /** A new river partner is adopted only after the current caravan returns home. */
    pendingRiverPartner?: number;
    riverLeg?: { connection: RiverTradeConnection; fromOrigin: boolean; phase: 'embark' | 'board' | 'river' | 'disembark' | 'city'; waterPath: Point[]; nextRepathAt?: number };
}
export interface RiverTradeEnd { city: number; door: Point; shore: Point; water: Point; post: Point; landDistance: number }
export interface RiverTradeConnection { origin: RiverTradeEnd; partner: RiverTradeEnd; waterPath: Point[]; waterDistance: number }
export type Relation = 'self' | 'peace' | 'war' | 'confederated';
export interface RetinueSquad {
    id: number;
    faction: number;
    kills: number;
}
export type ResearchBranchId = 'supplyTrain' | 'massLevy' | 'wall' | 'woodenTower' | 'monument' | 'blacksmith' | 'archeryRange' | 'scoutLodge' | 'sailing' | 'irrigation' | 'traditionalMedicine' | 'militaryTactics' | 'infantryDrill' | 'siegeEngines' | 'horsebackRiding' | 'compoundBow' | 'gunpowder' | 'stirrups' | 'populism' | 'urbanMilitia'
    | 'reinforcedDefenses' | 'coinage' | 'urbanPlanning' | 'metalCasting' | 'metalTools' | 'fletching' | 'grainStorage' | 'engineering' | 'culturalIdentity' | 'roadBuilding' | 'lateenSails' | 'navalEngineering' | 'whaling' | 'fieldCannon' | 'drainage' | 'militaryScience' | 'officerCorps';
export interface ResearchState {
    /** Resolved project; explicit priorities may refer to later technologies. */
    focus: ResearchBranchId;
    allocation?: number;
    priorities?: ResearchBranchId[];
    levels: Partial<Record<ResearchBranchId, number>>;
    progress: Partial<Record<ResearchBranchId, number>>;
    /** Paid Science released gradually; pauses when no completed library remains. */
    funding?: { points: number; remaining: number }[];
    /** Released Science awaiting the next continuous progress step. */
    credit?: number;
    /** Gold actually paid for the unspent Science reserve. */
    reservedGold?: number;
    /** Bounded thirty-second Science receipts for the presentation rate. */
    receipts?: { time: number; points: number }[];
}
export type GoldInputCategory = 'taxes' | 'trade' | 'mining' | 'loot' | 'treasure' | 'refunds' | 'transfers' | 'other' | 'controlMines';
export type GoldOutlayCategory = 'construction' | 'settlements' | 'defenses' | 'army' | 'science' | 'upgrades' | 'immigration' | 'diplomacy' | 'raided' | 'transfers' | 'other';
export interface GoldLedgerEntry {
    /** Exact game time; transactions in one simulation step share a bucket. */
    time: number;
    inputs: Partial<Record<GoldInputCategory, number>>;
    outlays: Partial<Record<GoldOutlayCategory, number>>;
}
export type MilitaryFormationType = 'wide' | 'standard' | 'deep';
export interface Faction {
    /** A normal one-city start can grant settlers and reduced upkeep to one completed town. */
    firstTownFoundingAvailable?: true;
    formationType?: MilitaryFormationType;
    rangerCompanions?: number;
    /** Native whale-delivery reward: expiry in simulation seconds. */
    whalingUntil?: number;
    levyReadyAt?: number;
    leaderRespawn?: LeaderRespawnState;
    engineerRespawnAt?: number;
    /** Combat-destroyed walls and towers are reordered using normal resources. */
    autoRebuildDefenses?: boolean;
    id: number;
    name: string;
    color: string;
    /** @deprecated Ignored. Confederation uses Rust settlement affiliation. */
    affinity?: number;
    relation: Relation;
    food: number;
    gold: number;
    /** Saved transaction buckets, pruned to the most recent sixty game seconds on writes. */
    goldLedger?: GoldLedgerEntry[];
    production: number;
    population: number;
    /** Independent villages have no Leader, palace, territory, or governor. */
    villageId?: number;
    /** Recomputed from living allied camps; these disappear when a camp falls. */
    villageBonuses?: { food: number; trade: number; construction: number; research: number };
    /** Permanent blacksmith research shared by current soldiers and new recruits. */
    armorLevel?: EquipmentLevel;
    weaponLevel?: EquipmentLevel;
    /** Desired fraction of the faction retinue trained as archers. */
    archerFraction?: number;
    spearmanFraction?: number;
    /** Desired fraction of the retinue trained as pikemen at a barracks. */
    pikemanFraction?: number;
    /** Desired share trained as musketmen at barracks after Gunpowder. */
    musketmanFraction?: number;
    fieldCannonFraction?: number;
    swordsmanFraction?: number;
    levySlingerFraction?: number;
    horsemanFraction?: number;
    horseArcherFraction?: number;
    knightFraction?: number;
    /** Scenario capacity without a purchased-slot maintenance charge. */
    bonusRetinueSlots?: number;
    /** Permanent paid retinue capacity, charged even while its slots are vacant. */
    purchasedRetinueSlots?: number;
    research?: ResearchState;
    /** Unspent culture produced by towns and monuments. */
    culture?: number;
    /** Culture invested at forums; still counts toward territorial influence. */
    cultureSpent?: number;
    /** Permanent faction achievement bitset, with rules and costs owned by Rust. */
    achievements?: number;
    /** Permanent, once-per-quest rewards owned by the native quest account. */
    questBenefits?: number;
    /** Gross earned resources; purchases, upkeep and refunds never change these counters. */
    incomeTotals?: { food: number; gold: number; culture: number };
    yields: {
        food: number;
        production: number;
        gold: number;
    };
    nextRaid: number;
    /** Earliest game time for the next single palace recruit. */
    nextRetinueAt?: number;
    defeated: boolean;
    lastDiplomacy?: number;
    /** Briefly respect a cancelled order before automatic expansion retries it. */
    constructionPauseUntil?: Partial<Record<BuildingKind, number>>;
}
export interface GameEvent {
    id: number;
    text: string;
    time: number;
    kind: 'info' | 'good' | 'warning';
}
export interface Particle extends Point {
    followUnit?: number;
    text: string;
    color: string;
    life: number;
    kind?: 'hunt' | 'food' | 'damage' | 'healing' | 'exploration';
    duration?: number;
    direction?: number;
    /** Damaged unit's owner; color is chosen per viewer, including multiplayer. */
    faction?: number;
    damageUnitId?: number;
    /** Also marks lingering hits on this casualty, so only its bounty remains for enemies. */
    damageFatal?: boolean;
}
/** Short-lived impact flecks, independent of floating gold rewards. */
export interface BloodEffect extends Point {
    elapsed: number;
    angle: number;
    height: number;
}
/** A transient drawing snapshot; never participates in combat or collision. */
export interface UnitDeath extends Point {
    unit: Unit;
    time: number;
    color: string;
}
/** Rust-owned destruction lifetime; the building is a drawing snapshot only. */
export interface BuildingDestruction extends Point {
    id: number;
    width: number;
    height: number;
    faction: number;
    time: number;
    building?: Building;
}
/** Nearby losses are remembered briefly for battlefield morale. */
export interface BattleCasualty extends Point {
    unit: number;
    faction: number;
    time: number;
}
/** Transient native shell landing; depth keeps a primary building hit visible. */
export interface ShellImpact extends Point {
    id: number;
    time: number;
    renderDepth?: number;
}
/** A thrown javelin deals its damage when it reaches its target. */
export interface Projectile extends Point {
    /** Preserve Leader XP credit when a retinue archer dies before its arrow lands. */
    leaderXp?: number;
    kind?: 'stone' | 'javelin' | 'arrow' | 'ballistaBolt' | 'bullet' | 'cannonball';
    start: Point;
    end: Point;
    /** Taller firing platforms interpolate down to the target's torso. */
    startHeight?: number;
    /** Elevated Keep arrows retain tower clearance rules after launch. */
    towerArrow?: boolean;
    attacker: number;
    target: number;
    faction: number;
    damage: number;
    elapsed: number;
    duration: number;
}
export interface GameState {
    /** Temporary setup phase; normal economy/builders grow scenario towns. */
    scenarioPreparing?: boolean;
    raiderTechnologyAt?: number;
    seaRaids?: import('./sea-raids').SeaRaidState;
    /** Local view and synchronous command actor; never identifies every human. */
    playerFaction?: number;
    multiplayer?: {
        humanFactionIds: number[];
        inputs: Record<number, InputState>;
        controls: Record<number, PlayerControlState>;
        winner: number | null;
    };
    world: World;
    /** Serializable views; entity-store owns membership and replacement. */
    readonly units: readonly Unit[];
    readonly buildings: readonly Building[];
    /** Player victories await an explicit capture/leave decision before time resumes. */
    palaceCaptures?: { palaceId: number; faction: number; captor?: number; x: number; y: number; cityName: string;
        /** Snapshot membership before the fallen palace leaves the nearest-city map. */
        buildingIds: number[]; workerIds: number[]; population: number; unhousedResidents: number; populationGrowth: number }[];
    explorationSites?: import('./exploration-native').ExplorationSite[];
    treasures?: TreasureChest[];
    hermits?: Hermit[];
    /** Serializable presentation mirrors; Rust owns quest rules and progress. */
    quests?: import('./quest-types').QuestView[];
    questsRevision?: number;
    factions: Faction[];
    villages?: NeutralVillage[];
    /** Base64 sectioned native simulation snapshot (rust/src/sim/save.rs):
     * section 0 clock and RNG, section 1 settlements. Present only in saves;
     * the simulation core consumes it when it is created. */
    simCore?: string;
    /** Surviving squads retain their experience while replacements arrive. */
    retinueSquads?: RetinueSquad[];
    nextRetinueSquadId?: number;
    time: number;
    tick: number;
    paused: boolean;
    speed: number;
    events: GameEvent[];
    armyWarnings?: ArmyWarning[];
    nextArmyWarningId?: number;
    particles: Particle[];
    bloodEffects?: BloodEffect[];
    unitDeaths?: UnitDeath[];
    buildingDestructions?: BuildingDestruction[];
    shipSinkings?: ShipSinking[];
    casualties?: BattleCasualty[];
    projectiles?: Projectile[];
    shellImpacts?: ShellImpact[];
    selected: number | null;
    selectedType: 'unit' | 'building' | null;
    buildMode: BuildSelection | null;
    /** Player-designated exclusion cells for friendly units outside the Leader's retinue. */
    forbiddenZones?: { cells: number[]; revision: number };
    treeClearings?: { x: number; y: number; faction: number; workerId?: number }[];
    /** Developed connected deposits dispatch resident workers on a game-time schedule. */
    resourceWorkSites?: ResourceWorkSite[];
    nextResourceWorkSiteId?: number;
    /** Read-only publication of the native offensive orders. */
    offensives?: OffensiveState[];
    /** Temporary, walkable remains of felled trees; source coordinates preserve the tree family. */
    treeStumps?: { x: number; y: number; sourceX: number; sourceY: number; expiresAt: number }[];
    retinueStance?: RetinueStance;
    movementMode?: 'travel' | 'formation';
    diplomacy: number | null;
    /** Read-only publication of the native diplomacy ECS. */
    diplomacyState?: DiplomacySnapshot;
    gameOver: boolean;
    victory: boolean;
    /** Victory was acknowledged; keep simulating this world, including defeat. */
    victoryContinued?: boolean;
    /** Game-wide border wave: index and each realm's claimed culture for this wave. */
    borderWave?: { index: number; culture: Record<number, number> };
    seed: string;
    /** Mirror of the native mulberry32 state (rust/src/sim); written only by sim-handle.ts. */
    rngState: number;
    /** Display IDs for native policy codes; definitions and assignments live in simCore. */
    aiPolicyNames?: string[];
    /** Approximate smoke hints contain no hidden post identity or exact location. */
    observationSmoke?: { x: number; y: number; faction: number; startedAt: number }[];
    /** Bandit spawn-rate and living-population multiplier; 1 is the default. */
    banditIntensity?: number;
    /** Computer unit/building HP, damage and earned gold multiplier. */
    enemyStrength?: number;
    /** Single-player cheat: add 5,000 gold per 30-second economy tick. */
    infiniteGold?: boolean;
    defenseRebuilds?: import('./defense-rebuilding').DefenseRebuild[];
    /** Frozen spawn-clock origin and prior multiplier while intensity is zero. */
    banditSpawnPause?: { at: number; intensity: number };
    marauderPacks?: MarauderPack[];
    wildlife?: { herds: WildlifeHerd[]; nextRespawnAt: number; sequence: number; targetHerds: number };
    /** Shared natural fish stocks and independent dock-operated fishing vessels. */
    fishing?: FishingState;
    /** Render-only mirror; authoritative harbor voyages are saved in simCore. */
    harborTradeShips?: HarborTradeShip[];
    tradeRoutes?: TradeRoute[];
    factionTrades?: FactionTradeAgreement[];
    /** Merchant casualty replacement deadlines, keyed by unordered palace IDs. */
    tradeCooldowns?: Record<string, number>;
    /** One-time scattering of independent packs; defeated packs never refill on load. */
    roamingMaraudersVersion?: number;
    /** Active camps and persistent recovery clocks for destroyed camps. */
    raiderCamps?: RaiderCamp[];
    /** Retry an initially unfilled camp slot when hidden, suitable land becomes available. */
    raiderCampPopulationRetryAt?: number;
    fields?: FarmField[];
    traffic?: Record<string, number[]>;
    farmVersion?: number;
    /** One-time migration of surviving marauders to the current threat level. */
    enemyPressureVersion?: number;
    /** Persist raid pacing so reloading cannot cause a sudden wave or reset the timer. */
    fogRaids?: { nextAt: number; waves: number; pressureVersion?: number };
    raiderSkirmishes?: { nextByFaction: Record<number, number>; wavesByFaction: Record<number, number> };
    /** Independent exploration memory for AI factions; human fog remains in player controls. */
    scoutExploration?: Record<number, NonNullable<GameState['fog']>>;
    fog?: { explored: number[]; width: number; height: number; seed: string; buildings?: Building[]; fields?: FarmFieldMemory[] };
}
export interface InputState {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    turnLeft?: boolean;
    turnRight?: boolean;
}
export interface PlayerControlState {
    retinueStance: RetinueStance;
    movementMode: 'travel' | 'formation';
    forbiddenZones?: GameState['forbiddenZones'];
    fog?: GameState['fog'];
}
export const TILE_SIZE = 32;
/** Maximum span, for broad spatial queries. Use width/height for footprints. */
const WIDE_KINDS: ReadonlySet<string> = new Set(['palace', 'fort', 'archeryRange', 'supplyDepot', 'library', 'colosseum', 'barracks', 'forum', 'granary', 'thermalBath', 'whalingPost', 'foundry', 'militaryAcademy', 'hospital', 'apartments', 'factory', 'goldMine']);
const SQUARE_WIDE_KINDS: ReadonlySet<string> = new Set(['palace', 'fort', 'library', 'colosseum', 'forum', 'granary', 'thermalBath', 'whalingPost', 'foundry', 'militaryAcademy', 'hospital', 'apartments', 'factory', 'goldMine']);
export const buildingSize = (building: Pick<Building, 'kind'>): number => building.kind === 'shipyard' || building.kind === 'fort' ? 3 : WIDE_KINDS.has(building.kind) ? 2 : 1;
export const buildingWidth = (building: Pick<Building, 'kind'>): number => buildingSize(building);
export const buildingHeight = (building: Pick<Building, 'kind'>): number => building.kind === 'shipyard' || building.kind === 'fort' ? 3 : SQUARE_WIDE_KINDS.has(building.kind) ? 2 : 1;
/** Northward art overhang, in tiles; collision footprints remain unchanged. */
export const buildingArtTop = (building: Pick<Building, 'kind' | 'construction'>): number =>
    building.construction ? 0 : building.kind === 'tower' || building.kind === 'woodenTower' ? -.75 : building.kind === 'barracks' ? -1 : 0;
export const buildingReady = (building: Building): boolean => building.hp > 0 && !building.construction;
/** A reservation is open ground until a peasant actually starts working. */
export const buildingPresent = (building: Building): boolean => building.hp > 0 && (!building.construction
    || building.construction.waitingForBuilder !== true && building.construction.pausedAt === undefined && !building.construction.evacuating);
export const WATER = new Set<Terrain>(['ocean', 'coast', 'river', 'lake']);
export const isFord = (tile: Tile | undefined): boolean => tile?.terrain === 'river' && tile.overlay === 'ford';
export function tileAt(world: World, x: number, y: number): Tile | undefined { if (x < 0 || y < 0 || x >= world.width || y >= world.height)
    return undefined; return world.tiles[Math.floor(y) * world.width + Math.floor(x)]; }
export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

export interface Hermit extends Point { id: number; status: "home" | "fleeing" | "gone"; position?: Point; path?: Point[]; retryAt?: number; }
