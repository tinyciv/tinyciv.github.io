import type { FishingState } from './fishing';
import type { InfantryFormationState } from './infantry-drill';
import type { WorldGenerationStyle } from '../world/options';

export type Terrain = 'ocean' | 'coast' | 'river' | 'lake' | 'desert' | 'plains' | 'grassland' | 'tundra';
export type Overlay = 'none' | 'forest' | 'jungle' | 'swamp' | 'volcano' | 'glacier' | 'ford';
export type TreeClass = 'tropical' | 'dry' | 'temperate' | 'conifer' | 'snowy';
export type Biome = 'temperate' | 'taiga' | 'tundra' | 'rainforest' | 'savanna' | 'steppe' | 'desert' | 'wetland' | 'alpine';
export type RegionalResource = 'clay' | 'iron' | 'stone' | 'salt' | 'fish';
export interface Tile {
    terrain: Terrain;
    overlay: Overlay;
    elevation: number;
    moisture: number;
    /** Generated climate and soil suitability, normalized to 0..1. */
    temperature?: number;
    rainfall?: number;
    fertility?: number;
    /** Ecological identity uses the existing terrain and vegetation artwork. */
    biome?: Biome;
    resource?: RegionalResource;
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
export interface World {
    width: number;
    height: number;
    seed: string;
    generationStyle?: WorldGenerationStyle;
    generationParameters?: import('../world/options').LandscapeParameters;
    landformFamily?: import('../world/options').LandformFamily;
    landformProvinces?: import('../world/landforms').LandformProvince[];
    riverDeltas?: import('../world/river-deltas').RiverDelta[];
    tiles: Tile[];
    spawns: Point[];
    /** Second city for each rival, indexed by faction id minus one. */
    secondarySpawns?: Point[];
    source: string;
    revision?: number;
}
export type BuildingKind = 'fort' | 'supplyDepot' | 'palace' | 'camp' | 'house' | 'shack' | 'cottage' | 'road' | 'wall' | 'palisade' | 'bridge' | 'dock' | 'irrigation' | 'ruin' | 'tower' | 'woodenTower' | 'well' | 'monument' | 'blacksmith' | 'guardPost' | 'archeryRange' | 'scoutLodge' | 'observationPost' | 'healerShack' | 'ballista' | 'stable' | 'library' | 'villageTent';
export type RoadStyle = 'road' | 'trail';
export type BuildSelection = BuildingKind | 'clearTrees';
export const buildingKindForSelection = (kind: Exclude<BuildSelection, 'clearTrees'>): BuildingKind => kind;
export type HouseStyle = 'shack' | 'hovel' | 'cottage' | 'villa';
/** Stone walls and wooden palisades share gates, ownership and path blocking. */
export const isWallKind = (kind: BuildingKind): boolean => kind === 'wall' || kind === 'palisade';
/** Farms are uninhabited, pathable single-tile crop plots. */
export const isFarmKind = (kind: BuildingKind): boolean => kind === 'camp' || kind === 'shack' || kind === 'cottage';
export const BUILDABLE_KINDS: readonly BuildingKind[] = ['fort', 'supplyDepot', 'road', 'camp', 'house', 'wall', 'palisade', 'bridge', 'dock', 'irrigation', 'woodenTower', 'well', 'monument', 'blacksmith', 'guardPost', 'archeryRange', 'scoutLodge', 'observationPost', 'healerShack', 'ballista', 'stable', 'library', 'palace'];
export interface Building extends Point {
    fort?: { brigadeLevel: 0 | 1 | 2 | 3; nextUpkeepAt: number; funded: boolean; nextRecruitAt: number; destroyed?: boolean; initialGold?: number };
    supplyDepot?: { nextDispatchAt: number };
    id: number;
    /** Initial capital only; later settlements start with the ordinary border radius. */
    initialCity?: boolean;
    kind: BuildingKind;
    /** Omitted for the standard road; trails differ only in their artwork. */
    roadStyle?: RoadStyle;
    /** Direction from this dock's dry house tile to the reserved water tile: N/E/S/W. */
    dockFacing?: 0 | 1 | 2 | 3;
    /** Set only after the dock successfully launches its one included sailboat. */
    dockBoatLaunched?: boolean;
    faction: number;
    hp: number;
    maxHp: number;
    capacity: number;
    villageId?: number;
    /** Unmodified defensive health before layout and faction research bonuses. */
    defenseBaseMaxHp?: number;
    /** Derived from live stone walls, gates, and tower support; never a new base. */
    fortificationHealthMultiplier?: number;
    /** A palace's city identity persists when its faction changes. */
    cityName?: string;
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
    guardPost?: { nextUpkeepAt: number; funded: boolean; level?: 0 | 1 | 2; kills?: number; lastThreatAt?: number; needsRecruits?: boolean; wallsOnly?: boolean };
    construction?: { startedAt: number; duration: number; paidGold?: number; waitingForBuilder?: boolean; builderId?: number; pausedAt?: number; cleared?: boolean; evacuating?: boolean; researchSpeed?: number; replacesPalisade?: number; engineerId?: number };
}
export type UnitKind = 'skirmisher' | 'levyInfantry' | 'supplyCart' | 'leader' | 'warrior' | 'spearman' | 'archer' | 'horseman' | 'scout' | 'militia' | 'worker' | 'merchant' | 'sailboat' | 'boar' | 'marshBird' | 'deer' | 'buffalo' | 'elephant' | 'ostrich';
export const isSoldier = (unit: Pick<Unit, 'kind'>): boolean => unit.kind === 'warrior' || unit.kind === 'spearman' || unit.kind === 'archer' || unit.kind === 'horseman' || unit.kind === 'levyInfantry' || unit.kind === 'skirmisher';
/** Dedicated lodge scouts explore independently of the Leader's combat retinue. */
export const isRetinueMember = (unit: Pick<Unit, 'kind'>): boolean => unit.kind === 'warrior' || unit.kind === 'spearman' || unit.kind === 'archer' || unit.kind === 'horseman';
export type EquipmentLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type UnitOrder = 'follow' | 'hold' | 'work' | 'raid' | 'wander' | 'flee';
export type RetinueStance = 'defensive' | 'hold' | 'aggressive';
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
    sailboat?: { dock: number; passenger?: number; landing?: Point; velocity?: Point };
    /** A human-owned Leader has directional right of way through its retinue. */
    humanControlled?: boolean;
    id: number;
    kind: UnitKind;
    faction: number;
    villageId?: number;
    raiderEquipmentMultiplier?: number;
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
    /** Palace recruits travel to their Leader before adopting the retinue stance. */
    joiningRetinue?: boolean;
    /** Persistent three-soldier squad; shared experience is mirrored in kills. */
    retinueSquad?: number;
    /** Home lodge for an independent explorer; it never consumes a retinue slot. */
    scoutLodge?: number;
    /** A resident assigned to a concealed, stationary wilderness lookout. */
    observationPost?: { x: number; y: number; city: number; discoveredBy: number[]; nextUpkeepAt: number; nextSmokeAt: number; retreating?: boolean };
    /** Combat role changes require a physical visit to a range or stable. */
    training?: { range: number; role: 'warrior' | 'spearman' | 'archer' | 'horseman'; enteredAt?: number };
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
    pathGoal?: Point;
    /** Independent roaming band; its members share hostility, never a settled faction. */
    marauderPack?: number;
    marauderLeader?: boolean;
    marauderRetreating?: boolean;
    kills?: number;
    /** This Leader's earned levels and skills. Death removes one level. */
    leaderProgression?: LeaderProgression;
    leaderDeathRecorded?: boolean;
    name?: string;
    /** Palace collectors replace stationary farming sprites. */
    collector?: boolean;
    /** Primary farm assignment for this worker's current harvest circuit. */
    collectorCamp?: number;
    /** Fields collected on this trip; nearby harvest detours are bounded. */
    collectorPickups?: number;
    /** Nearby bags reserved for this courier's current multi-stop harvest trip. */
    collectorStops?: number[];
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
    builderRetiring?: boolean;
    repairSite?: number;
    buildSite?: number;
    buildPhase?: 'idle' | 'outbound' | 'working' | 'repairing' | 'clearing' | 'returning';
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
}
export type VillageIdentity = 'growers' | 'merchants' | 'builders' | 'scholars';
export type VillageRelation = 'neutral' | 'trade' | 'allied' | 'war';
export interface NeutralVillage extends Point {
    id: number;
    faction: number;
    campId: number;
    name: string;
    identity: VillageIdentity;
    relation: VillageRelation;
    trading?: boolean;
    /** Additional civilization partners; player trade is controlled by diplomacy. */
    tradingFactions?: number[];
    nextTradeAt?: number;
    /** Lifetime delivered trade revenue per partner, independent of spending. */
    tradeGoldByFaction?: Record<number, number>;
    nextGrowthAt: number;
    nextThinkAt: number;
    nextRecruitAt: number;
    destroyed?: boolean;
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
export interface TradeRoute {
    id: number;
    faction: number;
    origin: number;
    partner: number;
    target: number;
    merchantId?: number;
    nextDepartureAt: number;
    distance: number;
    /** Domestic delivery quote, fixed when this leg departs; villages retain
     * their separately calibrated actual-travel payout. */
    legValue?: { distance: number; originShare: number; partnerShare: number; gold: number };
    journeys: number;
    goal?: Point;
    nextPlanAt?: number;
    stuckSince?: number;
    /** Village routes are additional connections paying one fifth of city trade. */
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
export type ResearchBranchId = 'supplyTrain' | 'massLevy' | 'wall' | 'woodenTower' | 'monument' | 'blacksmith' | 'archeryRange' | 'scoutLodge' | 'sailing' | 'irrigation' | 'traditionalMedicine' | 'militaryTactics' | 'infantryDrill' | 'siegeEngines' | 'horsebackRiding'
    | 'reinforcedDefenses' | 'coinage' | 'urbanPlanning' | 'metalTools' | 'fletching' | 'grainStorage';
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
    /** Bounded thirty-second Science receipts for the presentation rate. */
    receipts?: { time: number; points: number }[];
}
export type GoldInputCategory = 'taxes' | 'trade' | 'loot' | 'treasure' | 'refunds' | 'transfers' | 'other';
export type GoldOutlayCategory = 'construction' | 'settlements' | 'defenses' | 'army' | 'science' | 'upgrades' | 'immigration' | 'diplomacy' | 'raided' | 'transfers' | 'other';
export interface GoldLedgerEntry {
    /** Exact game time; transactions in one simulation step share a bucket. */
    time: number;
    inputs: Partial<Record<GoldInputCategory, number>>;
    outlays: Partial<Record<GoldOutlayCategory, number>>;
}
export interface Faction {
    leaderRespawn?: LeaderRespawnState;
    engineerRespawnAt?: number;
    /** Combat-destroyed walls and towers are reordered using normal resources. */
    autoRebuildDefenses?: boolean;
    id: number;
    name: string;
    color: string;
    affinity: number;
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
    horsemanFraction?: number;
    /** Scenario capacity without a purchased-slot maintenance charge. */
    bonusRetinueSlots?: number;
    /** Permanent paid retinue capacity, charged even while its slots are vacant. */
    purchasedRetinueSlots?: number;
    research?: ResearchState;
    /** Accumulated cultural influence produced by completed monuments. */
    culture?: number;
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
    text: string;
    color: string;
    life: number;
    kind?: 'hunt';
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
/** Nearby losses are remembered briefly for battlefield morale. */
export interface BattleCasualty extends Point {
    unit: number;
    faction: number;
    time: number;
}
/** A thrown javelin deals its damage when it reaches its target. */
export interface Projectile extends Point {
    /** Preserve Leader XP credit when a retinue archer dies before its arrow lands. */
    leaderXp?: number;
    kind?: 'javelin' | 'arrow' | 'ballistaBolt';
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
    treasures?: TreasureChest[];
    factions: Faction[];
    villages?: NeutralVillage[];
    /** Surviving squads retain their experience while replacements arrive. */
    retinueSquads?: RetinueSquad[];
    nextRetinueSquadId?: number;
    time: number;
    tick: number;
    paused: boolean;
    speed: number;
    events: GameEvent[];
    particles: Particle[];
    bloodEffects?: BloodEffect[];
    unitDeaths?: UnitDeath[];
    casualties?: BattleCasualty[];
    projectiles?: Projectile[];
    selected: number | null;
    selectedType: 'unit' | 'building' | null;
    buildMode: BuildSelection | null;
    /** Player-designated exclusion cells for friendly units outside the Leader's retinue. */
    forbiddenZones?: { cells: number[]; revision: number };
    treeClearings?: { x: number; y: number; faction: number; workerId?: number }[];
    /** Temporary, walkable remains of felled trees; source coordinates preserve the tree family. */
    treeStumps?: { x: number; y: number; sourceX: number; sourceY: number; expiresAt: number }[];
    retinueStance?: RetinueStance;
    movementMode?: 'travel' | 'formation';
    diplomacy: number | null;
    gameOver: boolean;
    victory: boolean;
    /** Victory was acknowledged; keep simulating this world, including defeat. */
    victoryContinued?: boolean;
    seed: string;
    rngState: number;
    /** Approximate smoke hints contain no hidden post identity or exact location. */
    observationSmoke?: { x: number; y: number; faction: number; startedAt: number }[];
    /** Bandit spawn-rate and living-population multiplier; 1 is the default. */
    banditIntensity?: number;
    defenseRebuilds?: import('./defense-rebuilding').DefenseRebuild[];
    /** Frozen spawn-clock origin and prior multiplier while intensity is zero. */
    banditSpawnPause?: { at: number; intensity: number };
    marauderPacks?: MarauderPack[];
    wildlife?: { herds: WildlifeHerd[]; nextRespawnAt: number; sequence: number; targetHerds: number };
    /** Shared natural fish stocks and independent dock-operated fishing vessels. */
    fishing?: FishingState;
    tradeRoutes?: TradeRoute[];
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
export const buildingSize = (building: Pick<Building, 'kind'>): number => building.kind === 'palace' || building.kind === 'fort' || building.kind === 'archeryRange' || building.kind === 'library' ? 2 : 1;
export const buildingWidth = (building: Pick<Building, 'kind'>): number => buildingSize(building);
export const buildingHeight = (building: Pick<Building, 'kind'>): number => building.kind === 'archeryRange' ? 1 : buildingSize(building);
/** Northward art overhang, in tiles; collision footprints remain unchanged. */
export const buildingArtTop = (building: Pick<Building, 'kind' | 'construction'>): number =>
    !building.construction && (building.kind === 'tower' || building.kind === 'woodenTower') ? -.75 : 0;
export const buildingReady = (building: Building): boolean => building.hp > 0 && !building.construction;
/** A reservation is open ground until a peasant actually starts working. */
export const buildingPresent = (building: Building): boolean => building.hp > 0 && (!building.construction
    || building.construction.waitingForBuilder !== true && building.construction.pausedAt === undefined && !building.construction.evacuating);
export const WATER = new Set<Terrain>(['ocean', 'coast', 'river', 'lake']);
export const isFord = (tile: Tile | undefined): boolean => tile?.terrain === 'river' && tile.overlay === 'ford';
export function tileAt(world: World, x: number, y: number): Tile | undefined { if (x < 0 || y < 0 || x >= world.width || y >= world.height)
    return undefined; return world.tiles[Math.floor(y) * world.width + Math.floor(x)]; }
export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
