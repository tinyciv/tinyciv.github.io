import { drawExplorationSite, paintExplorationMessage } from './exploration-art';
import type { ExplorationSite } from './exploration-native';
import { maritimeArtApproved, vesselArtKey, drawMaritimeVessel, whaleSurfaceFrame, drawWhale } from './maritime-art';
import { boardingPlankImage } from './warship-art';
import { galleyClosestPoint } from './galley-footprint';
import { loyaltyOf, loyaltyPanelAlpha } from './settlement-bridge';
import { buildingDestructionPose } from './building-destruction-art';
import { shellImpactFrame } from './shell-impact-art';
import type { BuildingDestruction, ShellImpact } from './types';
import { MountedAnimationClock } from './mounted-animation';
import { resourceInteractionColor, resourceInteractionPatches, type ResourceInteractionPatch } from './resource-interaction-highlight';
import { hermitAvailable, hermitPosition } from './hermits';
import { drawHermit, drawHermitCabin } from './hermit-art';
import type { Hermit } from './types';
import { drawDesertStone } from './desert-stone-art';
import { drawGeothermal, geothermalFrame, geothermalArtOffsetY } from './geothermal-art';
import { damageNumberPose, damageNumberStyle, damageNumberVisible, goldNumberPose } from './combat-feedback';
import { drawBraceShield } from './leader-ability-art';
import { observationPostVisibleTo } from './observation-visibility';
import { drawObservationCampfire, observationFireFrame, drawObservationSmoke } from './observation-post-art';
import { playerFaction } from './player-context';
import { siteViews } from './sites-native';
import { drawSiteBrackets } from './site-art';
import { PixiScene } from './pixi-scene';
import { PresentationIndex, type BuildingIndex } from './presentation-index';
import { entityStore } from './entity-store';
import { indexedLeader } from './spatial';
import { CHECK_INTERVAL_MS } from './work-cadence';
import { gameFont } from './game-font';
import { worldChangesSince, worldRevisions } from './world-revisions';
import { fieldKey, buildingKey, NATIVE_TILE_RESOLUTION, ANIMATED_BUILDING_KINDS } from './native-art';
import { pavedRoadArtRevision } from './paved-road-art';
import { isRetinueMember, buildingKindForSelection } from './types';
import { type Building, type FarmField, type GameState, type Point, type Tile, type Unit, type World, TILE_SIZE, WATER, buildingPresent, buildingReady, buildingWidth, buildingHeight, isFarmKind, isFord, isWallKind, tileAt, unitMaxHp } from './types';
import { type Connections, buildingArtTop, buildingImageAnchor } from './sprites';
import { drawGrainCrate } from './food-art';
import { dirtRoadArtKey, drawDirtRoad } from './road-sprites';
import { villageTrailLinks } from './village-trails';
import { drawFish, drawFishingBoat, fishArtKey, fishSurfaceFrame, fishingBoatArtKey } from './fishing-art';
import type { FishingBoat, FishingFish, WhaleResource } from './fishing';
import type { HarborTradeShip } from './harbor-trade';
import { drawTreeStump, vegetationRenderDepth, vegetationVariant } from './vegetation-art';
import { fordCrossingAxis } from './ford-art';
import { drawFarmOcclusion, drawFoodExpiryClock, farmOcclusionHeight, wheatJoinMask } from './farm-art';
import { clipFarmAroundIrrigation, drawIrrigationBridge, drawIrrigationInlet, irrigationConnections } from './irrigation-art';
import { FIELD_SPOIL_WARNING_SECONDS } from './farms';
import { farmHarvestMarkers } from './farm-parcels';
import { buildingInteractionHighlighted } from './building-interaction-highlight';
import { drawBuildingActivityOutline } from './building-activity-art';
import { drawBuildingGround } from './building-ground';
import { dockBerth, dockFootprint, dockPlacement } from './dock';
import { drawRiverTradingPost } from './naval-art';
import { riverTradingPosts } from './river-trade';
import { buildingPlacementEffect } from './building-aoe';
import { COMMAND_MARKER_SECONDS, drawCommandCheck, type MoveMarker } from './command-effects';
import { drawArrow } from './archery-art';
import { drawMusketBullet } from './musket-projectile-art';
import { usesFirearm } from './firearms';
import { infantryRotationAlpha } from './infantry-drill';
import { drawInfantryAdvanceArrow } from './infantry-drill-art';
import { drawBallistaBolt } from './siege-art';
import { BLOOD_EFFECT_DURATION } from './blood-effects';
import { damageFlashWeight } from './combat-effect-art';
import { UNIT_DEATH_LIFETIME } from './death-effects';
import type { UnitDeath } from './types';
import { factionColor } from './faction-colors';
import { RAIDER_COLOR, RAIDER_CAMP_COLOR, raiderCampCenter, raiderCampWarning } from './raider-camps';
import type { ConstructionPlan } from './construction';
import type { ConstructionGesturePreview } from './construction-gesture';
import { ConstructionGhostCache, ConstructionEffectCache } from './construction-presentation';
import { previewConstructionPlan } from './construction-display';
import { constructionProgress } from './construction-cancellation';
import { CONSTRUCTION_TIMER_RADIUS, CONSTRUCTION_TIMER_STEPS, drawConstructionTimer } from './construction-timer';
import { hasGateWall } from './network-placement';
import { terrainMinimapColor, waterArtKey, waterSpriteKey, waterAnimationFrame, clipFarmToLand, paintTerrain, drawAnimatedWater } from './terrain';
import { isMapRevealed, type FogView, buildingInSight, pointExplored, pointInSight, unitInSight, presentationFog, fogRenderMask, withPresentationReads, FOG_RETURN_DELAY, FOG_RETURN_FADE } from './fog';
import { createMinimapProjection, MinimapTerritoryMemory, minimapToWorld, worldToMinimap, type MinimapProjection } from './minimap';
import { drawVeterancy, veterancy } from './veterancy';
import { borderCultureAt, territory, UNCLAIMED } from './borders';
import { forEachEnclosureShimmerSpan, palaceEnclosures } from './enclosures';
import { TREASURE_SPRITE } from './treasure';
import { punyWorldImage } from './puny-world';
import { HOUSE_WELL_OFFSET, sharedHouseForWell, sharedWellForHouse } from './house-wells';
import { canShareWallTowerTile, sharedWallForTower, sharedTowerForWall, type TowerWallKind } from './wall-towers';
import { visibleReliefStamps, reliefFigureDepth, reliefImage, type ReliefStamp } from './relief-art';
import { landmarkSight } from './terrain-rays-native';
import { ReliefFogArt } from './relief-fog-art';
import { drawCityRibbon, CITY_RIBBON_HEIGHT, CITY_NAME_RIBBON_HEIGHT, CITY_RIBBON_MAX_WIDTH } from './city-ribbon';
import { drawNameplate, nameplateWidth, NAMEPLATE_HEIGHT } from './nameplate';
import { fortName } from './fort-names';
import { citySummariesForFaction, withCitySummarySnapshot, type CitySummary } from './cities';
import { RESEARCH_BAR_WIDTH, RESEARCH_BAR_HEIGHT, RESEARCH_BAR_GAP } from './research-bar';
import { researchStatus } from './research';
import { alliedVillageCamps, drawAllianceMarker } from './village-marker';
import { forbiddenCells, forbiddenRegions } from './forbidden-zones';
import { drawForbiddenCell, drawForbiddenMarker } from './forbidden-art';
import { drawQuestCell, drawQuestMarker, QUEST_MARKER_SIZE } from './quest-art';
import { questAreaCells, questGiverPosition, questMarkerRevealed } from './quest-presentation';
import { RESOURCE_COLORS } from './geography';
import { ResourceArtMemory, drawResourceRoad, resourceHasObject, type ResourceCellArt } from './resource-art';
import { drawLooseRocks } from './outcrop-art';
import { trailArtVariant } from './road-sprites';
import { MeadowPlacementCache, meadowFrame, type MeadowTuft } from './meadow-art';
export { TERRAIN_COLORS } from './terrain';
export const MIN_ZOOM = .65;
export const MAX_ZOOM = 2.2;
const directions = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]] as const;
const tileKey = (x: number, y: number) => `${x},${y}`;
const WATER_TILE_BOUNDS = Object.freeze({ x: 0, y: 0, width: 32, height: 32 });
const isPerson = (u: Unit) => !u.aboardRowboat && !u.aboardRiverTrade && (u.kind === 'leader' || (u.kind === 'levyInfantry' || u.kind === 'slinger') || u.kind === 'skirmisher' || u.kind === 'supplyCart' || isRetinueMember(u) || u.kind === 'scout' || u.kind === 'militia' || u.kind === 'worker' || u.kind === 'merchant');
// A person's world position is their footing, beneath the three-quarter figure.
const unitTop = (u: Unit) => u.y - (isPerson(u) ? .85 : .5);
const unitColor = (state: GameState, u: Unit) => factionColor(state, u.faction, state.marauderPacks?.find(p => p.id === u.marauderPack)?.color ?? (u.faction === -2 ? RAIDER_COLOR : '#ad8c57'));

export { indexBuildings, type BuildingIndex } from './presentation-index';
/** Optional authored terrain art, rendered with the same pixels and depth as
 * the normal world. Standalone previews supply these; the live game does not. */
export interface PresentationStamp {
    id: string; image: HTMLImageElement | HTMLCanvasElement;
    x: number; y: number; width: number; height: number; depth?: number;
}
type Scenery = { x: number; y: number; tile: Tile };
type SceneObject = { depth: number; exploration?: ExplorationSite; relief?: ReliefStamp; hermit?: Hermit; hermitHome?: Hermit; b?: Building; u?: Unit; death?: UnitDeath; feature?: Scenery; sign?: Point & { variant: number };
    meadow?: { x: number; y: number; tuft: MeadowTuft };
    geothermal?: Point & { variant: NonNullable<Tile['geothermal']>; mask: number };
    destruction?: BuildingDestruction;
    shellImpact?: { effect: ShellImpact; frame: number };
    fish?: FishingFish; whale?: WhaleResource; fishingBoat?: FishingBoat | HarborTradeShip; riverPost?: Point;
    resource?: { x: number; y: number; art: ResourceCellArt; fence?: boolean };
    resourceOutline?: { patch: ResourceInteractionPatch; color: string };
    orchard?: { field: FarmField; time: number; ditchLinks?: Connections; crossingLinks?: Connections };
    presentationStamp?: PresentationStamp };

/** Network frames replace GameState while preserving the same displayed world. */
const samePresentationSession = (previous: GameState, state: GameState): boolean => previous === state
    || !!previous.multiplayer && !!state.multiplayer && previous.world === state.world && playerFaction(previous) === playerFaction(state);

interface PresentationChecks {
    state: GameState; world: World; faction: number; nextRefreshAt: number;
    enclosures: ReturnType<typeof palaceEnclosures>;
    borders: ReturnType<typeof territory>;
    villageOwners: Set<number>;
    colors: Map<number, string>;
    packColors: Map<number, string>;
    highlights: Map<number, { nextRefreshAt: number; active: boolean }>;
    alliedCamps: { camp: Building; center: Point }[];
    research: ReturnType<typeof researchStatus> | undefined;
    riverPosts: Point[];
    warnings: NonNullable<GameState['raiderCamps']>;
}

export function drawMovementModeIcon(c: CanvasRenderingContext2D, mode: 'travel' | 'formation', x: number, y: number, alpha = 1): void {
    c.save(); c.translate(x, y); c.globalAlpha = Math.max(0, alpha);
    c.strokeStyle = '#3e493b'; c.fillStyle = '#f0e4b8'; c.lineWidth = 1.5;
    if (mode === 'formation') {
        for (const [offset, vertical] of [[-6, -3], [6, -3], [0, 3]]) {
            c.save(); c.translate(0, vertical);
            c.beginPath(); c.moveTo(offset - 4, -6); c.lineTo(offset + 4, -6); c.lineTo(offset + 4, 1);
            c.quadraticCurveTo(offset + 3, 5, offset, 7); c.quadraticCurveTo(offset - 3, 5, offset - 4, 1);
            c.closePath(); c.fill(); c.stroke(); c.restore();
        }
    } else {
        c.rotate(-.35); c.beginPath(); c.ellipse(0, 1, 3.7, 6.5, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        for (let i = 0; i < 4; i++) {
            c.beginPath(); c.ellipse(-3.5 + i * 2.5, -7 + i * .6, 1.4 - i * .15, 1.8 - i * .18, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        }
    }
    c.restore();
}

export function wellAttachedToHouse(b: Building, index: BuildingIndex): boolean {
    return !!sharedHouseForWell(b, index.get(tileKey(b.x, b.y)) ?? []);
}

export function towerAttachedToWall(b: Building, index: BuildingIndex): boolean {
    return !!sharedWallForTower(b, index.get(tileKey(b.x, b.y)) ?? []);
}

/** Queued wall stakes do not support a completed tower yet. During a stone
 * upgrade the original completed palisade still supplies that support. */
export function towerSupportingWallKind(b: Building, index: BuildingIndex): TowerWallKind | undefined {
    if (b.kind !== 'woodenTower' || b.hp <= 0) return;
    let support: TowerWallKind | undefined;
    for (const wall of index.get(tileKey(b.x, b.y)) ?? []) {
        if (!buildingReady(wall) || !canShareWallTowerTile(b, wall)) continue;
        if (wall.kind === 'wall') return 'wall';
        support = 'palisade';
    }
    return support;
}

export function towerMountedOnWall(b: Building, index: BuildingIndex): boolean {
    return towerSupportingWallKind(b, index) !== undefined;
}

/** Shared-tile wells and towers draw after their house or wall in either build order. */
export function buildingRenderDepth(b: Building, index: BuildingIndex): number {
    return b.y + buildingHeight(b) + (wellAttachedToHouse(b, index) ? HOUSE_WELL_OFFSET.y : towerAttachedToWall(b, index) ? 1 / 64 : 0);
}

/** Structure links depend only on the presentation index (replaced whenever an
 * observed structure changes), the world and, for ditch inlets, exploration. */
interface StructureLinks {
    network: Connections; secondary?: Connections; attached: boolean; towerWall?: TowerWallKind;
    /** Atlas key of a still picture; fog memories are immutable, so it holds per index. */
    artKey?: string; artColor?: string; artRevision?: number;
    groundKey?: string;
}
interface LinkCache { world: World; geometry: number; exploration: number; links: Map<Building, StructureLinks>; ditches: Map<Building, StructureLinks>; keys: WeakMap<Connections, string> }
const linkCaches = new WeakMap<BuildingIndex, LinkCache>();
/** Border paths are immutable territory output; their local shape never changes. */
const borderShapeKeys = new WeakMap<object, string>();
/** `epoch` carries the frame's exploration and terrain-geometry revisions. */
interface LinkEpoch { exploration: number; geometry: number }
function linkCache(index: BuildingIndex, world: World, epoch: LinkEpoch): LinkCache {
    let cache = linkCaches.get(index);
    const { exploration, geometry } = epoch;
    if (!cache || cache.world !== world || cache.geometry !== geometry) {
        cache = { world, geometry, exploration, links: new Map(), ditches: new Map(), keys: new WeakMap() }; linkCaches.set(index, cache);
    }
    if (cache.exploration !== exploration) {
        // Ditch inlets and clearings read explored ground; other links do not.
        cache.ditches.clear(); cache.exploration = exploration;
        for (const links of cache.links.values()) links.groundKey = undefined;
    }
    return cache;
}
function structureLinks(b: Building, index: BuildingIndex, world: World, epoch: LinkEpoch, waterKnown: (x: number, y: number) => boolean): StructureLinks {
    const cache = linkCache(index, world, epoch), map = b.kind === 'irrigation' ? cache.ditches : cache.links;
    let links = map.get(b);
    if (!links) {
        const towerWall = towerSupportingWallKind(b, index), network = buildingConnections(b, index, world, waterKnown);
        links = { network, secondary: b.kind === 'bridge' ? bridgeBanks(b, index, network) : gateConnections(b, index, world),
            attached: wellAttachedToHouse(b, index) || towerWall !== undefined, towerWall };
        map.set(b, links);
    }
    return links;
}
/** JSON key of a links object, shared by every crop drawn with it. */
function connectionsJsonKey(index: BuildingIndex, world: World, epoch: LinkEpoch, links: Connections | undefined): string {
    if (!links) return 'null';
    const keys = linkCache(index, world, epoch).keys;
    let key = keys.get(links);
    if (key === undefined) { key = JSON.stringify(links); keys.set(links, key); }
    return key;
}

export function buildingConnections(b: Building, index: BuildingIndex, world?: World, waterKnown?: (x: number, y: number) => boolean): Connections {
    if (b.kind === 'irrigation') return irrigationConnections(b, (x, y) => index.get(tileKey(x, y)) ?? [], world, waterKnown);
    const links: Connections = { north: false, east: false, south: false, west: false };
    const path = b.kind === 'road' || b.kind === 'bridge';
    for (const [side, dx, dy] of directions) {
        const neighbors = index.get(tileKey(b.x + dx, b.y + dy)) ?? [];
        links[side] = neighbors.some(neighbor => path ? ['road', 'bridge'].includes(neighbor.kind)
            : isWallKind(b.kind) && isWallKind(neighbor.kind) && neighbor.faction === b.faction && buildingReady(neighbor));
        if (b.kind === 'road' && world && isFord(tileAt(world, b.x + dx, b.y + dy))) links[side] = true;
    }
    if (b.kind === 'road') {
        for (const [side, dx, dy, horizontal, vertical] of [
            ['northeast', 1, -1, 'east', 'north'], ['southeast', 1, 1, 'east', 'south'],
            ['southwest', -1, 1, 'west', 'south'], ['northwest', -1, -1, 'west', 'north'],
        ] as const) {
            // A cardinal elbow already joins these tiles. Only expose a corner
            // when it is the actual link, keeping bends and junctions narrow.
            if (!links[horizontal] && !links[vertical]
                && index.get(tileKey(b.x + dx, b.y + dy))?.some(other => other.kind === 'road')) links[side] = true;
        }
    }
    if (b.kind === 'road' && b.roadPaved) {
        links.pavedEnds = 0;
        const exits = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0],
            ['northeast', 1, -1], ['southeast', 1, 1], ['southwest', -1, 1], ['northwest', -1, -1]] as const;
        exits.forEach(([side, dx, dy], bit) => {
            if (links[side] && !index.get(tileKey(b.x + dx, b.y + dy))?.some(other => other.kind === 'road' && other.roadPaved && buildingReady(other)))
                links.pavedEnds! |= 1 << bit;
        });
    }
    if (b.kind === 'bridge' && world) {
        const bank = (dx: number, dy: number) => { const tile = tileAt(world, b.x + dx, b.y + dy); return !!tile && !WATER.has(tile.terrain); };
        // An isolated span still reaches its banks. Explicit road approaches
        // take precedence at bends or crossings.
        if (!links.north && !links.south && !links.east && !links.west) {
            if (bank(0, -1) && bank(0, 1)) links.north = links.south = true;
            else links.east = links.west = true;
        } else {
            if ((links.north || links.south) && !(links.east || links.west)) {
                links.north ||= bank(0, -1); links.south ||= bank(0, 1);
            }
            if ((links.east || links.west) && !(links.north || links.south)) {
                links.east ||= bank(1, 0); links.west ||= bank(-1, 0);
            }
        }
    }
    return links;
}

/** Linked sides of a bridge whose neighbor is not another bridge: the span's
 * bank ends, which use abutment art instead of the interior deck. */
export function bridgeBanks(b: Building, index: BuildingIndex, links: Connections): Connections {
    const bridged = (dx: number, dy: number) => !!index.get(tileKey(b.x + dx, b.y + dy))?.some(other => other.kind === 'bridge' && other.hp > 0);
    return { north: links.north && !bridged(0, -1), east: links.east && !bridged(1, 0),
        south: links.south && !bridged(0, 1), west: links.west && !bridged(-1, 0) };
}

/** The passage follows the road; an isolated gate opens across its wall. */
export function gateConnections(b: Building, index: BuildingIndex, world?: World): Connections | undefined {
    if (!isWallKind(b.kind) || !buildingReady(b)) return;
    const road = index.get(tileKey(b.x, b.y))?.find(other => other.kind === 'road' && other.hp > 0);
    if (!road) return;
    const roadLinks = buildingConnections(road, index, world);
    const links: Connections = { north: roadLinks.north, east: roadLinks.east, south: roadLinks.south, west: roadLinks.west };
    // A road ending at a gate still opens the entire crossing.
    if (Number(links.north) + Number(links.east) + Number(links.south) + Number(links.west) === 1) {
        if (links.north || links.south) links.north = links.south = true;
        else links.east = links.west = true;
    }
    if (Object.values(links).some(Boolean)) return links;
    const walls = buildingConnections(b, index, world);
    return walls.north || walls.south
        ? { north: false, east: true, south: false, west: true }
        : { north: true, east: false, south: true, west: false };
}

export class Renderer {
    private vesselSight=new WeakMap<Unit,{time:number;pose:Unit;passenger?:Unit}>();
    canvas: HTMLCanvasElement;
    private gpu?: PixiScene;
    private initializing?: Promise<void>;
    private destroyed = false;
    get backend(): 'pixi-webgl' { return 'pixi-webgl'; }
    get renderStats() { return this.gpu?.stats; }
    snapshot(): HTMLCanvasElement { return this.gpu!.snapshot(); }
    initialize(): Promise<void> { return this.initializing ??= this.initializeBackend(); }
    private async initializeBackend(): Promise<void> {
        const scene = new PixiScene();
        await scene.initialize(this.canvas, this.width, this.height, Math.min(devicePixelRatio, 2));
        if (this.destroyed) { scene.destroy(); return; }
        this.gpu = scene; this.resize();
    }
    destroy(): void { this.destroyed = true; this.gpu?.destroy(); this.gpu = undefined; }

    minimap: HTMLCanvasElement;
    mini: CanvasRenderingContext2D;
    camera: Point = { x: 0, y: 0 };
    zoom = 1.35;
    width = 0;
    height = 0;
    follow = true;
    showYields = false;
    showGrid = false;
    /** Health bars, city ribbons and alerts; off for presentation renders such as the menu globe. */
    overlays = true;
    presentationStamps: readonly PresentationStamp[] = [];
    hover: Point | null = null;
    /** Local flag placement preview; committed orders are published by Rust. */
    offensivePreview?: { rally?: Point };
    buildPreview: Point[] = [];
    constructionGesture?: ConstructionGesturePreview;
    pendingConstruction: { kind: 'road' | 'irrigation'; points: readonly Point[] }[] = [];
    areaPreview: { tool: 'clear' | 'forbid'; start: Point; end: Point; erase?: boolean } | null = null;
    moveMarker: MoveMarker | null = null;
    movementModeMarker: { mode: 'travel' | 'formation'; elapsed: number } | null = null;
    private terrain = document.createElement('canvas');
    private miniature = document.createElement('canvas');
    private minimapTerritory = document.createElement('canvas');
    private minimapContent = document.createElement('canvas');
    private minimapFrame?: { state: GameState; world: World; fog: FogView; faction: number; width: number; height: number; dpr: number; nextRefreshAt: number };
    private minimapClaims = new MinimapTerritoryMemory();
    private minimapClaimWorld?: World;
    private minimapClaimPalette = '';
    private fogCanvas = document.createElement('canvas');
    private reliefFogArt = new ReliefFogArt();
    private fogPixels?: ImageData;
    private fogView?: FogView;
    private fogRevision = -1;
    private miniatureColors: string[] = [];
    private worldSeed = '';
    private worldAppearanceRevision = -1;
    private terrainJournalRevision?: number;
    private terrainGeometryRevision = -1;
    private preparedWorld?: World;
    private nextTerrainRefreshAt = -Infinity;
    private minimapProjection?: MinimapProjection;
    private minimapExploration?: number[];
    private minimapExplorationRevision = -1;
    private designationTime = 0;
    private mountedAnimation = new MountedAnimationClock();
    private citySummaryCache?: { state: GameState; world: World; faction: number; nextRefreshAt: number; values: CitySummary[] };
    private presentationChecks?: PresentationChecks;
    private constructionPreview?: { state: GameState; world: World; kind: GameState['buildMode']; key: string;
        nextRefreshAt: number; plan: ConstructionPlan };
    private constructionGhosts?: ConstructionGhostCache;
    private constructionEffects?: ConstructionEffectCache;
    private presentation?: PresentationIndex;
    private resourceMemory = new ResourceArtMemory();
    private meadowPlacements = new MeadowPlacementCache();
    private buildingObjects?: { structures: readonly Building[]; index: BuildingIndex; objects: SceneObject[] };
    constructor(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement) { this.canvas = canvas; this.minimap = minimap; this.mini = minimap.getContext('2d')!; this.resize(); }
    resize() {
        const r = this.canvas.getBoundingClientRect(); this.width = r.width; this.height = r.height; const d = Math.min(devicePixelRatio, 2);
        if (this.gpu) this.gpu.resize(r.width, r.height, d);
    }
    worldPoint(clientX: number, clientY: number): Point {
        const r = this.canvas.getBoundingClientRect(), x = (clientX - r.left - this.width / 2) / (TILE_SIZE * this.zoom) + this.camera.x;
        const y = (clientY - r.top - this.height / 2) / (TILE_SIZE * this.zoom) + this.camera.y;
        return { x, y };
    }
    minimapWorldPoint(clientX: number, clientY: number): Point | null {
        if (!this.minimapProjection) return null;
        const rect = this.minimap.getBoundingClientRect();
        return minimapToWorld({ x: (clientX - rect.left) * this.minimap.clientWidth / rect.width, y: (clientY - rect.top) * this.minimap.clientHeight / rect.height }, this.minimapProjection);
    }
    screenPoint(p: Point): Point { return { x: (p.x - this.camera.x) * TILE_SIZE * this.zoom + this.width / 2,
        y: (p.y - this.camera.y) * TILE_SIZE * this.zoom + this.height / 2 }; }
    center(state: GameState) { const leader = indexedLeader(state, playerFaction(state)); if (leader) {
        this.camera = { x: leader.x, y: leader.y };
        this.follow = true;
    } }
    changeZoom(delta: number) { this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom + delta)); }
    showMoveMarker(point: Point, attack = false) { this.moveMarker = { ...point, elapsed: 0, attack }; }
    showMovementMode(mode: 'travel' | 'formation') { this.movementModeMarker = { mode, elapsed: 0 }; }
    prepare(state: GameState) {
        const w = state.world;
        this.nextTerrainRefreshAt = performance.now() + CHECK_INTERVAL_MS;
        if (this.preparedWorld !== w || this.terrain.width !== w.width * TILE_SIZE || this.terrain.height !== w.height * TILE_SIZE)
            this.gpu?.resetWorld();
        const resetMiniature = this.preparedWorld !== w || this.worldSeed !== w.seed
            || this.miniature.width !== w.width || this.miniature.height !== w.height;
        const changes = worldChangesSince(w, resetMiniature ? undefined : this.terrainJournalRevision);
        const revisions = worldRevisions(w), geometryChanged = this.terrainGeometryRevision !== revisions.geometry;
        this.worldSeed = w.seed;
        this.worldAppearanceRevision = revisions.appearance;
        this.preparedWorld = w;
        const changed = paintTerrain(this.terrain, w, changes);
        this.terrainJournalRevision = changes.revision; this.terrainGeometryRevision = revisions.geometry;
        if (changed) for (const region of changed.regions ?? [changed])
            this.gpu?.invalidateTerrain({ x: region.x * TILE_SIZE, y: region.y * TILE_SIZE,
                width: region.width * TILE_SIZE, height: region.height * TILE_SIZE });
        if (resetMiniature) {
            this.miniature.width = w.width;
            this.miniature.height = w.height;
            this.miniatureColors = [];
        }
        const m = this.miniature.getContext('2d')!;
        const paintMiniature = (index: number) => {
            const x = index % w.width, y = Math.floor(index / w.width), t = w.tiles[index];
            const color = t.marsh && !WATER.has(t.terrain) ? '#527d55' : t.overlay === 'forest' || t.overlay === 'jungle' ? '#648b60' : terrainMinimapColor(w, x, y);
            if (this.miniatureColors[index] === color) return;
            this.miniatureColors[index] = color;
            m.fillStyle = color; m.fillRect(x, y, 1, 1);
        };
        // Only coastline edits can change distant water-depth colors. Ordinary
        // trees, crops and decoration affect their journaled cells alone.
        if (resetMiniature || changes.full || geometryChanged)
            for (let index = 0; index < w.tiles.length; index++) paintMiniature(index);
        else for (const index of changes.cells) paintMiniature(index);
    }
    draw(state: GameState, dt: number, beforeDraw?: () => void) {
        return withPresentationReads(state, () => withCitySummarySnapshot(state, () => this.drawFrame(state, dt, beforeDraw)));
    }
    /** Slow observation is separate from animation, camera transforms and culling. */
    private observePresentation(state: GameState, now: number): PresentationChecks {
        const previous = this.presentationChecks, faction = playerFaction(state);
        const sameSession = previous && samePresentationSession(previous.state, state) && previous.world === state.world
            && previous.faction === faction;
        if (sameSession && now < previous.nextRefreshAt) return previous;
        const centers = new Map((state.villages ?? []).map(village => [village.campId, village]));
        const player = state.factions.find(candidate => candidate.id === faction);
        return this.presentationChecks = {
            state, world: state.world, faction, nextRefreshAt: now + CHECK_INTERVAL_MS,
            enclosures: palaceEnclosures(state), borders: territory(state),
            villageOwners: new Set(state.factions.filter(candidate => candidate.villageId !== undefined).map(candidate => candidate.id)),
            colors: new Map(state.factions.map(candidate => [candidate.id, candidate.color])),
            packColors: new Map((state.marauderPacks ?? []).filter(pack => pack.color).map(pack => [pack.id, pack.color!])),
            highlights: sameSession ? previous.highlights : new Map(),
            alliedCamps: alliedVillageCamps(state).map(camp => ({ camp, center: centers.get(camp.id) ?? camp })),
            research: player && !player.defeated ? researchStatus(state, faction) : undefined,
            riverPosts: riverTradingPosts(state), warnings: (state.raiderCamps ?? []).filter(camp => raiderCampWarning(state, camp)),
        };
    }
    private drawFrame(state: GameState, dt: number, beforeDraw?: () => void) {
        this.designationTime += Math.max(0, Math.min(dt, .15));
        (this.mountedAnimation ??= new MountedAnimationClock()).advance(dt, state);
        const scene = this.gpu!; scene.beginFrame();
        const now = performance.now();
        if (this.preparedWorld !== state.world || this.worldSeed !== state.world.seed
            || now >= this.nextTerrainRefreshAt && this.worldAppearanceRevision !== worldRevisions(state.world).appearance)
            this.prepare(state);
        const leader = indexedLeader(state, playerFaction(state));
        if (leader && this.follow) {
            const k = Math.min(1, dt * 8);
            this.camera.x += (leader.x - this.camera.x) * k;
            this.camera.y += (leader.y - this.camera.y) * k;
        }
        beforeDraw?.();
        const fog = presentationFog(state);
        const knownWater = (x: number, y: number) => pointExplored(fog, x, y);
        const linkEpoch: LinkEpoch = { exploration: fog.explorationRevision, geometry: worldRevisions(state.world).geometry };
        const checks = this.observePresentation(state, now);
        const colorFor = (faction: number, fallback = '#b5a587') => checks.colors.get(faction) ?? fallback;
        this.prepareFog(fog);
        const s = TILE_SIZE * this.zoom, w = state.world;
        const screenOx = this.width / 2 - this.camera.x * s, screenOy = this.height / 2 - this.camera.y * s;
        // Draw in camera-independent world pixels. Panning updates one render
        // group instead of changing every child's position and vector path.
        scene.setCamera(screenOx, screenOy);
        const ox = 0, oy = 0;
        const art = scene.art, scale = s / 32;
        const bake = (key: string, x: number, y: number, width: number, height: number, paint: (c: CanvasRenderingContext2D) => void, alpha = 1) =>
            scene.sprite(art.paint(key, { x: 0, y: 0, width, height }, paint), x, y, scale, alpha);
        const building = (b: Building, index: BuildingIndex = buildingIndex, alpha = 1) => {
            const links = structureLinks(b, index, w, linkEpoch, knownWater);
            const color = colorFor(b.faction, b.faction === -2 ? RAIDER_CAMP_COLOR : '#9c9d80');
            let key: string | undefined;
            if (stillBuildings && (b.construction || !ANIMATED_BUILDING_KINDS.has(b.kind))) {
                const revision = pavedRoadArtRevision();
                if (links.artKey === undefined || links.artColor !== color || links.artRevision !== revision) {
                    links.artKey = buildingKey(b, time, color, links.network, links.secondary, links.attached, links.towerWall);
                    links.artColor = color; links.artRevision = revision;
                }
                key = links.artKey;
            }
            const picture = art.building(b, time, color, links.network, links.secondary, links.attached, links.towerWall, key);
            return scene.sprite(picture, (ox + b.x * s), (oy + b.y * s), scale, alpha);
        };
        scene.terrain(this.terrain, screenOx, screenOy, scale, this.width, this.height);
        const left = Math.max(0, Math.floor(-screenOx / s) - 5), right = Math.min(w.width, Math.ceil((this.width - screenOx) / s) + 2), top = Math.max(0, Math.floor(-screenOy / s) - 3), bottom = Math.min(w.height, Math.ceil((this.height - screenOy) / s) + 4);
        const time = state.time;
        const scenery: { depth: number; feature: Scenery }[] = [];
        const objects: SceneObject[] = [];
        const drawnIronOutcrops = new Set<NonNullable<ResourceCellArt['ore']>>();
        const geothermalSeen = new Set<number>();
        const presentation = this.presentation ??= new PresentationIndex();
        presentation.update(fog);
        const buildingIndex = presentation.buildings, roadCells = presentation.roads, fields = presentation.fields;
        // Revealed maps present live (mutable) buildings; fog presents immutable memories.
        const stillBuildings = !isMapRevealed(state);
        const cellBuildings = presentation.cellBuildings, cellFields = presentation.cellFields;
        const fieldAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height ? cellFields[y * w.width + x] : undefined;
        const resources = this.resourceMemory.observe(w, fog.visible, fog.revision, playerFaction(state), fog.owned,
            fog.explored, fog.explorationRevision);
        const resourcePatches = resourceInteractionPatches(state, resources, fog), outlinedPatches = new Set<ResourceInteractionPatch>();
        const cropTime = (field: FarmField) => pointInSight(fog, field.x + .5, field.y + .5) ? time : fields.get(tileKey(field.x, field.y))!.observedAt;
        const cropMasks = new Map<FarmField, number>();
        const fieldJoins = (field: FarmField, fieldTime: number) => {
            let mask = cropMasks.get(field);
            if (mask === undefined) {
                mask = wheatJoinMask(field, fieldTime, (x, y) => fields.get(tileKey(x, y)), cropTime);
                cropMasks.set(field, mask);
            }
            return mask;
        };
        const visible = (p: Point, margin = 2) => p.x >= left - margin && p.x <= right + margin && p.y >= top - margin && p.y <= bottom + margin;
        const landKey = (x: number, y: number) => WATER.has(w.tiles[y * w.width + x].terrain) ? waterArtKey(w, x, y) : 'land';
        // Two extra footing cells also retain towers whose upper storey is
        // visible while their occupied cell lies below the viewport.
        const structures = presentation.inViewport(left - 2, right + 2, top - 2, bottom + 2);
        // Finish water animation before blending settlement clearings into the
        // ground. Clip each fringe to its actual shoreline, including corners.
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const tile = w.tiles[y * w.width + x];
            if (!WATER.has(tile.terrain) || !pointExplored(fog, x, y)) continue;
            // Native 16-pixel water needs one texel per art pixel: every tile and
            // animation frame then shares a single small atlas page.
            scene.sprite(art.paint(waterSpriteKey(w, x, y, waterAnimationFrame(tile, time)), WATER_TILE_BOUNDS,
                c => drawAnimatedWater(c, w, x, y, 0, 0, 32, time), NATIVE_TILE_RESOLUTION), ox + x * s, oy + y * s, scale);
        }
        for (const b of structures) {
            if (!buildingReady(b) || isFarmKind(b.kind) || isWallKind(b.kind) || ['road', 'bridge', 'irrigation', 'ruin', 'dock'].includes(b.kind)) continue;
            const house = sharedHouseForWell(b, buildingIndex.get(tileKey(b.x, b.y)) ?? []);
            // Two independent structures sharing one tile need only one dirt
            // clearing. Keep the well's clearing until the house is completed.
            if (house && buildingReady(house)) continue;
            const wall = sharedWallForTower(b, buildingIndex.get(tileKey(b.x, b.y)) ?? []);
            if (wall && buildingReady(wall)) continue;
            const width = buildingWidth(b), height = buildingHeight(b);
            // The clearing depends on the footprint, its explored ground and the
            // terrain geometry: all fixed for one index and exploration revision.
            const links = structureLinks(b, buildingIndex, w, linkEpoch, knownWater);
            if (links.groundKey === undefined || !stillBuildings) {
                const cells: string[] = [];
                for (let y = b.y - 1; y <= b.y + height; y++) for (let x = b.x - 1; x <= b.x + width; x++)
                    cells.push(x >= 0 && y >= 0 && x < w.width && y < w.height && pointExplored(fog, x, y) ? landKey(x, y) : 'hidden');
                links.groundKey = `ground:${width},${height}:${Math.abs(b.x * 7 + b.y * 13) % 4}:${cells.join(';')}`;
            }
            bake(links.groundKey, ox + (b.x - 1) * s, oy + (b.y - 1) * s,
                (width + 2) * 32, (height + 2) * 32, c => {
                    for (let y = Math.max(0, b.y - 1); y <= Math.min(w.height - 1, b.y + height); y++)
                        for (let x = Math.max(0, b.x - 1); x <= Math.min(w.width - 1, b.x + width); x++) {
                            if (!pointExplored(fog, x, y)) continue;
                            const px = (x - b.x + 1) * 32, py = (y - b.y + 1) * 32;
                            c.save(); c.beginPath(); c.rect(px, py, 32, 32); c.clip();
                            clipFarmToLand(c, this.terrain, x, y, px, py, 32); drawBuildingGround(c, b, 32, 32, 32); c.restore();
                        }
                });
        }
        const previewKind = state.buildMode && state.buildMode !== 'clearTrees' ? buildingKindForSelection(state.buildMode) : undefined;
        const rawPreview = state.buildMode ? (this.buildPreview.length ? this.buildPreview : this.hover ? [{ x: Math.floor(this.hover.x), y: Math.floor(this.hover.y) }] : []) : [];
        // Plan valid ghosts before rendering walls, so previewing a road through
        // an existing wall shows an open gate instead of a solid wall beneath it.
        let constructionPlan: ConstructionPlan | undefined;
        const gesture = this.constructionGesture;
        const sharedGesture = gesture && samePresentationSession(gesture.state, state) && gesture.world === w
            && gesture.kind === state.buildMode && gesture.points === this.buildPreview ? gesture : undefined;
        if (state.buildMode) {
            if (sharedGesture) { constructionPlan = sharedGesture.plan; this.constructionPreview = undefined; }
            else {
                const key = rawPreview.map(point => `${point.x},${point.y}`).join(';'), old = this.constructionPreview;
                // Moving the pointer is an input event; an unchanged ghost only
                // rechecks resources, access and placement on the slow clock.
                if (!old || !samePresentationSession(old.state, state) || old.world !== w || old.kind !== state.buildMode
                    || old.key !== key || now >= old.nextRefreshAt)
                    this.constructionPreview = { state, world: w, kind: state.buildMode, key,
                        nextRefreshAt: now + CHECK_INTERVAL_MS, plan: previewConstructionPlan(state, state.buildMode, rawPreview) };
                constructionPlan = this.constructionPreview!.plan;
            }
        } else this.constructionPreview = undefined;
        const preview = state.buildMode === 'bridge'
            ? (constructionPlan?.cells ?? []).filter(cell => { const tile = tileAt(w, cell.x, cell.y); return !!tile && WATER.has(tile.terrain); })
            : rawPreview;
        const valid = new Set(constructionPlan?.cells.filter(cell => cell.ok).map(cell => tileKey(cell.x, cell.y)));
        const ghosts = (this.constructionGhosts ??= new ConstructionGhostCache()).get(w, buildingIndex, previewKind, playerFaction(state),
            preview.map(point => ({ ...point, valid: valid.has(tileKey(point.x, point.y)),
                skip: previewKind === 'road' && isFord(tileAt(w, point.x, point.y)) && !hasGateWall(state, point.x, point.y) })), point => {
                const building: Building = { id: -1, kind: previewKind!, x: point.x, y: point.y, faction: playerFaction(state), hp: 100, maxHp: 100, capacity: 0 };
                if (building.kind === 'dock') building.dockFacing = dockPlacement(state, point.x, point.y, playerFaction(state))?.facing;
                return building;
            }, previewKind === 'dock' ? w.revision : undefined);
        const previewIndex = ghosts.index, previewPlans = ghosts.plans, validPreviewCells = ghosts.validCells;
        // Remains lie on the ground: roads and new buildings can cover them.
        for (const stump of state.treeStumps ?? []) if (stump.expiresAt > time && visible(stump) && pointExplored(fog, stump.x, stump.y))
            bake(`stump:${JSON.stringify(stump)}`, ox + stump.x * s, oy + stump.y * s, 32, 32, c => drawTreeStump(c, stump, 0, 0, 32));
        // Salt beds are terrain work, beneath roads, ditches and working civilians.
        for (const [cell, resource] of resources) {
            if (resource.resource !== 'salt' || !resource.developed) continue;
            const x = cell % w.width, y = Math.floor(cell / w.width);
            if (x < left || x >= right || y < top || y >= bottom || !pointExplored(fog, x, y)) continue;
            const key = tileKey(x, y), occupants = buildingIndex.get(key);
            if (fields.has(key) || occupants?.some(b => !['road', 'bridge', 'irrigation'].includes(b.kind))) continue;
            scene.sprite(art.resource(resource), (ox + x * s), (oy + y * s), scale);
        }
        const harvestMarkers = farmHarvestMarkers(state);
        // Roads remain below every crop stage, sack, and harvest warning.
        const irrigationIndex = state.buildMode === 'irrigation' ? previewIndex : buildingIndex;
        const ground = (b: Building) => b.kind === 'road' || b.kind === 'bridge' || b.kind === 'irrigation';
        const linksKey = (links?: Connections) => connectionsJsonKey(buildingIndex, w, linkEpoch, links);
        const linksOf = (b: Building, index: BuildingIndex) => structureLinks(b, index, w, linkEpoch, knownWater).network;
        const bridge = (x: number, y: number, road: Connections, ditch: Connections, alpha = 1) =>
            bake(`crossing:${linksKey(road)}:${linksKey(ditch)}`, ox + x * s, oy + y * s, 32, 32, c => drawIrrigationBridge(c, 0, 0, 32, road, ditch), alpha);
        const inlet = (x: number, y: number, side: 0 | 1 | 2 | 3, alpha = 1) =>
            bake(`inlet:${side}:${Math.floor(time * 3) % 4}`, ox + x * s, oy + y * s, 32, 32, c => drawIrrigationInlet(c, 0, 0, 32, time, side), alpha);
        const crop = (field: FarmField, fieldTime: number, ditch?: Connections, road?: Connections) => {
            const key = `${landKey(field.x, field.y)}:${linksKey(ditch)}:${linksKey(road)}`;
            const picture = art.field(field, fieldTime, key, c => {
                clipFarmToLand(c, this.terrain, field.x, field.y, 0, 0, 32);
                // Irrigation cuts a gap in ground crops, never through a tree's
                // trunk or crown. Orchards sit above the channel by footing.
                if (ditch && !field.orchard) clipFarmAroundIrrigation(c, 0, 0, 32, ditch, road);
            }, fieldJoins(field, fieldTime));
            scene.sprite(picture, ox + field.x * s, oy + field.y * s, scale);
        };
        for (const b of structures.filter(b => ground(b) && (b.kind !== 'irrigation' || !buildingReady(b)))) building(b);
        const ditchOnGround = (b: Building, alpha = 1) => {
            building(b, irrigationIndex, alpha);
            for (const [i, [, dx, dy]] of directions.entries()) {
                const x = b.x + dx, y = b.y + dy, tile = tileAt(w, x, y);
                if (tile && WATER.has(tile.terrain) && pointExplored(fog, x, y)) inlet(x, y, ((i + 1) % 4) as 0 | 1 | 2 | 3, alpha);
            }
        };
        for (const b of structures) if (b.kind === 'irrigation' && buildingReady(b)) ditchOnGround(b);
        // Placement water shares the ground layer too. The late planning pass
        // only adds tile highlights, so its water cannot paint over tree crowns.
        if (previewKind === 'irrigation') for (const plan of previewPlans.values())
            if (plan.valid && plan.building.id === -1) ditchOnGround(plan.building, .55);
        const expiry = (x: number, y: number) => scene.sprite(art.paint(`expiry:${s}`,
            { x: -16, y: -16, width: 32, height: 32 }, c => drawFoodExpiryClock(c, 0, 0, s, 0)), (x), Math.round(y - Math.abs(Math.sin(time * 5)) * 3 * Math.max(1, Math.round(s / 36))));
        for (let y = top; y < bottom; y++)
            for (let x = left; x < right; x++) {
                if (!pointExplored(fog, x, y)) continue;
                const t = w.tiles[y * w.width + x], px = ox + x * s, py = oy + y * s;
                if (t.geothermal && t.geothermalAnchor !== undefined && !geothermalSeen.has(t.geothermalAnchor)) {
                    const gx = t.geothermalAnchor % w.width, gy = Math.floor(t.geothermalAnchor / w.width);
                    geothermalSeen.add(t.geothermalAnchor);
                    let mask = 0;
                    for (let bit = 0; bit < 4; bit++) if (pointExplored(fog, gx + bit % 2, gy + Math.floor(bit / 2))) mask |= 1 << bit;
                    if (!buildingIndex.get(tileKey(gx, gy))?.some(b => b.kind === 'thermalBath' && buildingPresent(b)))
                        objects.push({ depth: gy + 1.9, geothermal: { x: gx, y: gy, variant: t.geothermal, mask } });
                }
                const occupants = cellBuildings[y * w.width + x];
                const rubble = this.resourceMemory.looseRocks.get(y * w.width + x);
                if (rubble && !occupants?.length && !fields.has(tileKey(x, y)) && !t.resource && t.overlay === 'none'
                    && !WATER.has(t.terrain) && !t.creek && !t.palm && !t.marsh && !t.villageTrail)
                    bake(`outcrop-rubble:${rubble.key}`, px, py, 32, 32, c => drawLooseRocks(c, rubble));
                if (t.desertStone !== undefined && t.terrain === 'desert' && !occupants?.length && !fields.has(tileKey(x, y)) && !t.resource && !t.villageTrail)
                    bake(`desert-stone:${t.desertStone}:${Math.floor(t.variation * 16)}`, px, py, 32, 32,
                        c => drawDesertStone(c, t.desertStone!, Math.floor(t.variation * 16) / 16));
                if (t.villageTrail && !WATER.has(t.terrain) && !roadCells.has(y * w.width + x)) {
                    const links = villageTrailLinks(w, x, y, roadCells);
                    bake(`village-trail:${dirtRoadArtKey(links, x, y, 'trail')}`, ox + x * s, oy + y * s, 32, 32,
                        c => drawDirtRoad(c, links, x, y, 'trail'));
                }
                const ditch = (irrigationIndex === buildingIndex ? occupants : irrigationIndex.get(tileKey(x, y)))?.find(b => b.kind === 'irrigation' && buildingReady(b));
                const ditchLinks = ditch && linksOf(ditch, irrigationIndex);
                const ditchAlpha = ditch?.id === -1 ? .55 : 1;
                const crossingRoad = ditch && occupants?.find(b => b.kind === 'road' && buildingReady(b));
                const crossingLinks = crossingRoad && linksOf(crossingRoad, buildingIndex);
                const field = cellFields[y * w.width + x];
                const resource = resources.get(y * w.width + x);
                // Decoration consumes the same constant-time observed occupancy
                // indices as crops and roads. No simulation or entity scan.
                if (!field && !occupants?.length && !resource && !rubble)
                    for (const tuft of this.meadowPlacements.get(w, x, y))
                        objects.push({ depth: y + tuft.y, meadow: { x, y, tuft } });
                const resourceCovered = !!field || occupants?.some(b => !['road', 'bridge', 'irrigation'].includes(b.kind));
                if (resource && !resourceCovered) {
                    const color = resourceInteractionColor(state, x, y, fog), patch = resourcePatches.get(y * w.width + x);
                    if (color && patch && !outlinedPatches.has(patch)) {
                        outlinedPatches.add(patch);
                        objects.push({ depth: patch.y - .01, resourceOutline: { patch, color } });
                    }
                    if (resource.road && !roadCells.has(y * w.width + x))
                        bake(`resource-road:${resource.road}:${trailArtVariant(x, y)}`, px, py, 32, 32, c => drawResourceRoad(c, resource, x, y));
                    // Any explored member in view may emit the shared iron
                    // mountain; its first member can be outside the camera.
                    const iron = resource.resource === 'iron' ? resource.ore : undefined;
                    if (resource.resource === 'salt' || (iron ? !drawnIronOutcrops.has(iron) : resourceHasObject(resource))) {
                        if (iron) drawnIronOutcrops.add(iron);
                        const rx = resource.ore?.x ?? x, ry = resource.ore?.y ?? y;
                        objects.push({ depth: ry + (resource.ore?.height ?? 1) - 1 / 16, resource: { x: rx, y: ry, art: resource } });
                    }
                    if (resource.fences) {
                        scene.sprite(art.resourceFence(resource, false), Math.round(px), Math.round(py), scale);
                        if (resource.fences & 4) objects.push({ depth: y + 1.01, resource: { x, y, art: resource, fence: true } });
                    }
                }
                if (field) {
                    const viewed = pointInSight(fog, x + .5, y + .5), fieldTime = viewed ? time : field.observedAt;
                    if (field.orchard) objects.push({ depth: vegetationRenderDepth(y), orchard: { field, time: fieldTime, ditchLinks, crossingLinks } });
                    else crop(field, fieldTime, ditchLinks, crossingLinks);
                    if (crossingLinks && ditchLinks) bridge(x, y, crossingLinks, ditchLinks, ditchAlpha);
                    const harvest = harvestMarkers.get(field.id);
                    if (harvest && viewed) {
                        bake('food-crate-pixelhole', px, py, 32, 32, c => drawGrainCrate(c, 16, 20));
                        if (harvest.expiresAt > time && harvest.expiresAt - time <= FIELD_SPOIL_WARNING_SECONDS) expiry(px + s * .5, py + s * .13);
                    }
                }
                else {
                    const path = occupants?.find(b => b.kind === 'road');
                    // Keep a readable clearing through wooded tiles occupied by a road.
                    const clearedPath = !!path && ['forest', 'jungle'].includes(t.overlay);
                    const foliageOccupied = occupants?.some(b => b.kind !== 'irrigation');
                    const palm = t.palm && !foliageOccupied;
                    const marsh = t.marsh && !WATER.has(t.terrain) && !foliageOccupied;
                    const bridgedFord = t.overlay === 'ford' && occupants?.some(b => b.kind === 'bridge' && buildingReady(b));
                    if (!t.geothermal && !resource && (!t.marsh || marsh) && ((t.overlay !== 'none' && !clearedPath && !bridgedFord) || palm || marsh)) {
                        const feature = { x, y, tile: t.palm && foliageOccupied ? { ...t, palm: false } : t };
                        if ((!t.palm || !foliageOccupied) && vegetationVariant(t))
                            objects.push({ depth: vegetationRenderDepth(y), feature });
                        else scenery.push({ depth: y + .9, feature });
                    }
                    if (crossingLinks && ditchLinks) bridge(x, y, crossingLinks, ditchLinks, ditchAlpha);
                }
                if (this.showGrid) scene.graphics().rect(Math.round(px), Math.round(py), s, s).stroke({ color: '#29412b', alpha: .1, width: 1 });
            }
        const enclosures = checks.enclosures;
        if (enclosures.cells.length) scene.rasterLayer('enclosure-shimmer',
            [enclosures, fog, fog.revision, screenOx, screenOy, s, time], this.width, this.height, shimmer => {
                shimmer.fillStyle = '#aaffce';
                forEachEnclosureShimmerSpan(state, fog, screenOx, screenOy, s, time, { width: this.width, height: this.height },
                    (x, y, width, height, alpha) => { shimmer.globalAlpha = alpha; shimmer.fillRect(x, y, width, height); }, enclosures);
            }, -screenOx, -screenOy);
        // Low terrain details belong on the ground. Tree crowns join the same
        // footing-depth sort as units and buildings, including tall trees.
        // The terrain traversal already emits scenery in increasing row/depth.
        for (const { feature: { x, y, tile } } of scenery)
            scene.sprite(art.overlay(tile,
                tile.overlay === 'ford' ? fordCrossingAxis(w, x, y) : undefined), (ox + x * s), (oy + y * s), scale);
        const villageOwners = checks.villageOwners;
        const drawBorders = () => { for (const path of checks.borders.paths) {
            const edge = path.edge;
            if (!visible(edge)) continue;
            const owners = edge.neighborFaction !== undefined ? [edge.faction, edge.neighborFaction].sort((a, b) => a - b) : [edge.faction];
            const colors = owners.map(owner => colorFor(owner, '#191b22'));
            const villageBorder = owners.some(owner => villageOwners.has(owner));
            const known = (cell: number | undefined): boolean => cell !== undefined && !!(fog.explored[cell] || fog.visible[cell]);
            // Draw only segments touching discovered land. Current sight also
            // qualifies on the first frame before exploration is committed.
            if (!known(edge.cell) && !known(edge.neighborCell)) continue;
            let shape = borderShapeKeys.get(path);
            if (shape === undefined) {
                shape = [path.start, path.end, path.from?.control, path.from?.tangent, path.to?.control, path.to?.tangent]
                    .map(p => p ? `${(p.x - edge.x).toFixed(3)},${(p.y - edge.y).toFixed(3)}` : '-').join(';');
                borderShapeKeys.set(path, shape);
            }
            const border = art.paint(`border:${s}:${villageBorder ? 'village-white' : colors.join(',')}:${shape}`, { x: -s * .25, y: -s * .25, width: s * 1.5, height: s * 1.5 }, c => {
                const x = (p: Point) => (p.x - edge.x) * s, y = (p: Point) => (p.y - edge.y) * s;
                c.lineWidth = Math.max(2, Math.round(s / 8)) * .75; c.lineJoin = 'round'; c.globalAlpha = .75;
                c.beginPath(); c.moveTo(x(path.start), y(path.start));
                if (path.from) c.quadraticCurveTo(x(path.from.control), y(path.from.control), x(path.from.tangent), y(path.from.tangent));
                const end = path.to?.tangent ?? path.end; c.lineTo(x(end), y(end));
                if (path.to) c.quadraticCurveTo(x(path.to.control), y(path.to.control), x(path.end), y(path.end));
                if (villageBorder) { c.setLineDash([]); c.strokeStyle = '#ffffff'; c.stroke(); return; }
                c.setLineDash([s / 4, s / 4]); c.strokeStyle = '#fff8e5'; c.stroke();
                if (colors.length === 2) {
                    // One tile repeats white / first owner / white / second owner.
                    c.setLineDash([s / 4, s * 3 / 4]);
                    colors.forEach((color, index) => { c.lineDashOffset = -s * (index * 2 + 1) / 4; c.strokeStyle = color; c.stroke(); });
                } else { c.lineDashOffset = s / 4; c.strokeStyle = colors[0]; c.stroke(); }
            });
            scene.sprite(border, ox + edge.x * s, oy + edge.y * s);
        } };
        const atlas = punyWorldImage();
        // Live signposts obey sight, so rebuilding in explored fog cannot reveal
        // a new camp. They share the normal ground-footing depth order.
        if (atlas) for (const camp of state.raiderCamps ?? []) for (const [i, sign] of (camp.signs ?? []).entries())
            if (visible(sign) && pointInSight(fog, sign.x + .5, sign.y + .5))
                objects.push({ depth: sign.y + 15 / 16, sign: { ...sign, variant: i % 3 } });
        if (atlas) for (const chest of state.treasures ?? []) if (!chest.collected && visible(chest) && pointInSight(fog, chest.x + .5, chest.y + .5))
            bake('treasure', (ox + chest.x * s), (oy + chest.y * s), 32, 32,
                c => c.drawImage(atlas, TREASURE_SPRITE.x, TREASURE_SPRITE.y, 16, 16, 0, 0, 32, 32));
        for (const site of state.explorationSites ?? []) {
            if (site.status === 2) continue;
            const size = site.kind === 0 ? 2 : 1;
            if (!visible(site) || !pointExplored(fog, site.x + size / 2, site.y + size / 2)) continue;
            objects.push({ depth: site.y + size, exploration: site });
        }
        for (const h of state.hermits ?? []) {
            if (visible(h) && pointInSight(fog, h.x + .5, h.y + .5)) objects.push({ depth: h.y + 1, hermitHome: h });
            const p = hermitPosition(h);
            if (h.status !== 'gone' && visible(p) && pointInSight(fog, p.x, p.y)) objects.push({ depth: p.y, hermit: h });
        }
        const visibleUnits:Unit[]=[],vesselAlpha=new Map<number,number>(),vesselGhosts=new Set<number>(),ghostPassengers=new Map<number,Unit>();
        for(const u of state.units) {
            if(u.inside||u.hp<=0||u.kind!=='sailboat'&&!visible(u)||!isMapRevealed(state)&&!observationPostVisibleTo(u,playerFaction(state)))continue;
            const seen=isMapRevealed(state)||u.faction===playerFaction(state)||unitInSight(fog,u);
            if(seen) {
                if(!visible(u,u.kind==='sailboat'?4:2))continue;
                visibleUnits.push(u);
                if(u.kind==='sailboat'){
                    const passenger=entityStore(state).units.get(u.sailboat?.passenger??-1);
                    this.vesselSight.set(u,{time,passenger:passenger?{...passenger}:undefined,pose:{...u,
                        sailboat:u.sailboat?{...u.sailboat}:undefined,barbarianGalley:u.barbarianGalley?{...u.barbarianGalley}:undefined,
                        warship:u.warship?{...u.warship,guns:u.warship.guns?.map(g=>({...g,shot:undefined})),boarding:undefined}:undefined}});
                }
            } else if(u.kind==='sailboat') {
                const last=this.vesselSight.get(u),age=last?time-last.time:Infinity;
                // Match fog's return animation at the last observed position;
                // never track a hidden enemy's current transform.
                if(last&&visible(last.pose,4)&&age>=0&&age<FOG_RETURN_DELAY+FOG_RETURN_FADE) {
                    visibleUnits.push(last.pose);vesselGhosts.add(u.id);
                    if(last.passenger)ghostPassengers.set(u.id,last.passenger);
                    vesselAlpha.set(u.id,Math.min(1,(FOG_RETURN_DELAY+FOG_RETURN_FADE-age)/FOG_RETURN_FADE));
                }
            }
        }
        for (const post of checks.riverPosts) if (visible(post) && pointInSight(fog, post.x + .5, post.y + .5))
            objects.push({ depth: post.y + .6, riverPost: post });
        for (const fish of state.fishing?.fish ?? []) if (fishSurfaceFrame(fish, time) >= 0 && visible(fish) && pointInSight(fog, fish.x, fish.y))
            objects.push({ depth: fish.y, fish });
        for (const whale of state.fishing?.whales ?? []) if (whaleSurfaceFrame(whale, time) >= 0 && visible(whale) && pointInSight(fog, whale.x, whale.y))
            objects.push({ depth: whale.y + 1, whale });
        for (const boat of state.fishing?.boats ?? []) if (boat.hp > 0 && visible(boat) && pointInSight(fog, boat.x, boat.y))
            objects.push({ depth: boat.y + .2, fishingBoat: boat });
        for (const boat of state.harborTradeShips ?? []) if (visible(boat) && pointInSight(fog, boat.x, boat.y))
            objects.push({ depth: boat.y + .2, fishingBoat: boat });
        if (!this.buildingObjects || this.buildingObjects.structures !== structures || this.buildingObjects.index !== previewIndex)
            this.buildingObjects = { structures, index: previewIndex,
                objects: structures.filter(b => !ground(b)).map(b => ({ depth: buildingRenderDepth(b, previewIndex), b })) };
        objects.push(...this.buildingObjects.objects, ...visibleUnits.map(u => ({ depth: reliefFigureDepth(w, u.x, u.y, u.y + (u.wallPatrol?.wall !== undefined ? .65 : isPerson(u) ? 0 : .5)), u })));
        for (const sinking of state.shipSinkings ?? []) {
            const age = time - sinking.time;
            if (age < 0 || age >= 4 || !visible(sinking) || !pointInSight(fog, sinking.x, sinking.y)) continue;
            const picture = art.shipSinking(sinking, time, colorFor(sinking.faction));
            if (picture) scene.sprite(picture, ox + (sinking.x-.5)*s, oy + (sinking.y-.5)*s, scale, Math.min(1,(4-age)/.6));
        }
        for (const death of state.unitDeaths ?? []) {
            const age = time - death.time;
            if (age < 0 || age >= UNIT_DEATH_LIFETIME || !visible(death) || !pointInSight(fog, death.x, death.y)) continue;
            // Remains participate in tree/building depth and wheat occlusion,
            // but never health bars, selection, sight, collision or targeting.
            objects.push({ depth: reliefFigureDepth(w, death.x, death.y, death.y - .01), u: death.unit, death });
        }
        for (const effect of state.buildingDestructions ?? []) {
            const pose = buildingDestructionPose(effect, time);
            if (!pose || effect.x + effect.width < left || effect.x > right
                || effect.y + effect.height < top || effect.y > bottom) continue;
            let inSight = false;
            for (let dy = 0; dy < effect.height && !inSight; dy++) for (let dx = 0; dx < effect.width; dx++)
                if (pointInSight(fog, effect.x + dx + .5, effect.y + dy + .5)) { inSight = true; break; }
            if (inSight) objects.push({ depth: pose.rubble ? -Infinity : effect.y + effect.height + .001, destruction: effect });
        }
        for (const effect of state.shellImpacts ?? []) {
            if (effect.x + 1 < left || effect.x - 1 > right || effect.y + 1 < top || effect.y - 1 > bottom
                || !pointInSight(fog, effect.x, effect.y)) continue;
            const frame = shellImpactFrame(effect.time, time);
            if (frame >= 0) objects.push({ depth: reliefFigureDepth(w, effect.x, effect.y, effect.renderDepth ?? effect.y + .001), shellImpact: { effect, frame } });
        }
        for (const smoke of state.observationSmoke ?? []) {
            const age = time - smoke.startedAt;
            if (age < 0 || age >= 5 || smoke.faction === playerFaction(state) || !visible(smoke) || !pointInSight(fog, smoke.x, smoke.y)) continue;
            const phase = Math.floor(age * 8 / 5) % 8;
            bake(`observation-smoke:${phase}`, (ox + (smoke.x - .5) * s), (oy + (smoke.y - 1) * s),
                32, 32, c => drawObservationSmoke(c, phase));
        }
        const distantRelief: ReliefStamp[] = [], landmarkVisible = landmarkSight(fog);
        for (const relief of visibleReliefStamps(w, left, top, right, bottom)) {
            const x = relief.cell % w.width, y = Math.floor(relief.cell / w.width);
            if (pointExplored(fog, x, y)) objects.push({ depth: relief.depth, relief });
            if (!pointInSight(fog, x, y) && landmarkVisible(relief.cell)) distantRelief.push(relief);
        }
        for (const stamp of this.presentationStamps) {
            if (stamp.x + stamp.width < left || stamp.x > right || stamp.y + stamp.height < top || stamp.y > bottom) continue;
            objects.push({ depth: stamp.depth ?? stamp.y + stamp.height, presentationStamp: stamp });
        }
        objects.sort((a, b) => a.depth - b.depth);
        for (const object of objects) {
            if (object.meadow) {
                const { x, y, tuft } = object.meadow;
                const picture = art.meadow(tuft.variant, meadowFrame(tuft.variant, time, tuft.phase));
                if (picture) scene.sprite(picture, ox + (x + tuft.x) * s, oy + (y + tuft.y) * s, scale);
            } else if (object.presentationStamp) {
                const stamp = object.presentationStamp;
                bake(`presentation-stamp:${stamp.id}`, ox + stamp.x * s, oy + stamp.y * s,
                    stamp.width * 32, stamp.height * 32,
                    c => c.drawImage(stamp.image, 0, 0, stamp.width * 32, stamp.height * 32));
            } else if (object.relief) {
                const stamp = object.relief, picture = art.relief(stamp);
                if (picture) scene.sprite(picture, ox + stamp.x * s, oy + stamp.y * s, scale * stamp.width);
            } else if (object.exploration) {
                const site = object.exploration, size = site.kind === 0 ? 2 : 1;
                bake(`exploration:${site.kind}:${site.variant}`, ox + site.x * s, oy + site.y * s, size * 32, size * 32,
                    c => { c.scale(2, 2); drawExplorationSite(c, site.kind, site.variant); });
            } else if (object.hermitHome) {
                const h = object.hermitHome, frame = Math.floor(time * 7) % 6;
                bake(`hermit-home:${h.status === 'home'}:${frame}`, (ox + h.x * s), (oy + h.y * s), 32, 40,
                    c => drawHermitCabin(c, frame, h.status === 'home'));
            } else if (object.hermit) {
                const h = object.hermit, p = hermitPosition(h), highlight = hermitAvailable(state, h, playerFaction(state), fog), frame = Math.floor(time * 7) % 6;
                bake(`hermit:${highlight}:${h.status}:${frame}`, (ox + (p.x - .42) * s), (oy + (p.y - .72) * s), 28, 28,
                    c => drawHermit(c, highlight, h.status === 'fleeing', frame));
            } else if (object.resourceOutline) {
                const { patch, color } = object.resourceOutline;
                scene.sprite(art.resourcePatchOutline(patch, color), ox + patch.x * s, oy + patch.y * s, scale);
            } else if (object.resource) {
                const resource = object.resource;
                const x = (ox + resource.x * s), y = (oy + resource.y * s);
                if (resource.fence || resource.art.resource !== 'salt')
                    scene.sprite(resource.fence ? art.resourceFence(resource.art, true) : art.resource(resource.art), x, y, scale);
            }
            else if (object.riverPost) {
                const post = object.riverPost;
                bake('river-trading-post', (ox + post.x * s), (oy + post.y * s),
                    32, 32, c => drawRiverTradingPost(c, 0, 0, 32));
            }
            else if (object.fish) {
                const fish = object.fish;
                bake(`fish:${fishArtKey(fish, time)}`, (ox + (fish.x - .5) * s), (oy + (fish.y - .5) * s),
                    32, 32, c => drawFish(c, fish, 0, 0, 32, time));
            }
            else if (object.whale) {
                const whale = object.whale, frame = whaleSurfaceFrame(whale, time);
                bake(`whale:${frame}`, ox + (whale.x - 1) * s, oy + (whale.y - 1) * s, 64, 64, c => drawWhale(c, frame));
            }
            else if (object.fishingBoat) {
                const boat = object.fishingBoat;
                if ('village' in boat) scene.sprite(art.merchantShip(boat, time), ox + (boat.x - .5) * s, oy + (boat.y - .5) * s, scale);
                else if (maritimeArtApproved()) {
                    const height = boat.kind === 'whaling' ? 96 : 64;
                    const picture = art.paint(`maritime:${vesselArtKey(boat, time)}`, { x: -16, y: -height / 2, width: 32, height }, c => drawMaritimeVessel(c, boat, time));
                    scene.sprite({ ...picture, rotation: boat.facing + Math.PI / 2, rotationPivot: { x: 0, y: 0 } }, ox + boat.x * s, oy + boat.y * s, scale);
                }
                else bake(`fishing-boat:${fishingBoatArtKey(boat, time)}`, (ox + (boat.x - .5) * s), (oy + (boat.y - .5) * s),
                    32, 32, c => drawFishingBoat(c, boat, 0, 0, 32, time));
            }
            else if (object.sign && atlas) {
                const sign = object.sign;
                bake(`warcamp-sign:${sign.variant}`, (ox + sign.x * s), (oy + sign.y * s), 32, 32,
                    c => c.drawImage(atlas, 112 + sign.variant * 16, 480, 16, 16, 0, 0, 32, 32));
            }
            else if (object.geothermal) {
                const { x, y, variant, mask } = object.geothermal, frame = geothermalFrame(variant, time, x, y);
                bake(`geothermal:centered:${variant}:${frame}:${mask}`, ox + x * s, oy + y * s + geothermalArtOffsetY(variant) * scale, 64, 64,
                    c => drawGeothermal(c, variant, frame, mask));
            }
            else if (object.feature) {
                const { x, y, tile } = object.feature;
                scene.sprite(art.vegetation(tile), (ox + x * s), (oy + y * s), scale);
            }
            else if (object.orchard) {
                const { field, time: fieldTime, ditchLinks, crossingLinks } = object.orchard;
                crop(field, fieldTime, ditchLinks, crossingLinks);
            }
            else if (object.shellImpact) {
                const { effect, frame } = object.shellImpact, picture = art.shellImpact(frame);
                if (picture) scene.sprite(picture, ox + effect.x * s, oy + effect.y * s, scale);
            }
            else if (object.destruction) {
                const effect = object.destruction, pose = buildingDestructionPose(effect, time);
                if (!pose) continue;
                if (pose.showBuilding && effect.building) building(effect.building, previewIndex);
                const picture = art.buildingDestruction(pose.size, pose.frame, pose.rubble);
                if (picture) for (let dy = 0; dy < effect.height; dy += pose.size)
                    for (let dx = 0; dx < effect.width; dx += pose.size)
                        scene.sprite(picture, ox + (effect.x + dx) * s, oy + (effect.y + dy) * s, scale, pose.alpha);
            }
            else if (object.b) {
                const b = object.b;
                let highlight = checks.highlights.get(b.id);
                if (!highlight || now >= highlight.nextRefreshAt) {
                    highlight = { active: buildingInteractionHighlighted(state, b, fog), nextRefreshAt: now + CHECK_INTERVAL_MS };
                    checks.highlights.set(b.id, highlight);
                }
                if (highlight.active && buildingInSight(fog, b))
                    scene.sprite(art.paint(`activity:${buildingKey(b, time, colorFor(b.faction))}`, { x: -32, y: -64, width: (buildingWidth(b) + 2) * 32, height: (buildingHeight(b) + 3) * 32 },
                        c => drawBuildingActivityOutline(c, b, 0, 0, 32, colorFor(b.faction))), ox + b.x * s, oy + b.y * s, scale);
                building(b, previewIndex);
            }
            else if (object.u) {
                const u = object.u;
                const onWall = u.wallPatrol?.wall !== undefined;
                const x = ox + (u.x - (onWall ? .3 : .5)) * s, y = oy + (unitTop(u) - (onWall ? .25 : 0)) * s;
                const figureScale = scale * (onWall ? .6 : 1);
                const feet = u.y + (isPerson(u) ? 0 : .5), color = object.death?.color
                    ?? (u.seaInvasion !== undefined ? '#a4a8ad' : undefined) ?? colorFor(u.faction, (u.marauderPack === undefined ? undefined : checks.packColors.get(u.marauderPack)) ?? (u.faction === -2 ? RAIDER_COLOR : '#ad8c57'));
                // Keep the same native figure texture inside and outside grain.
                // Re-baking it into a fractional-position mask changes nearest-
                // pixel sampling and makes its whole silhouette shimmer.
                if (object.death) {
                    const age = time - object.death.time;
                    const deathArt = art.death(age, u, color);
                    if (deathArt) scene.sprite(deathArt, (x), (y), scale);
                } else {
                    if (u.observationPost && !u.observationPost.retreating)
                        bake(`observation-campfire:${observationFireFrame(time)}`, (x), (y), 40, 32, c => drawObservationCampfire(c, time));
                    const passenger = vesselGhosts.has(u.id)?ghostPassengers.get(u.id):u.sailboat?.passenger !== undefined ? entityStore(state).units.get(u.sailboat.passenger) : undefined;
                    if (u.warship?.boarding !== undefined) {
                        const other = entityStore(state).units.get(u.warship.boarding), plank = boardingPlankImage();
                        if (other?.warship && other.hp > 0 && plank && (u.id < other.id || other.warship.boarding !== u.id)) {
                            const near = galleyClosestPoint(u, other), far = galleyClosestPoint(other, u);
                            const dx = far.x - near.x, dy = far.y - near.y, length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
                            if (length > .03 && length < 3) for (const offset of [-.35, .35]) {
                                const px = near.x - Math.sin(angle) * offset, py = near.y + Math.cos(angle) * offset;
                                const picture = art.boardingPlank(plank, length);
                                scene.sprite({ ...picture, rotation: angle, rotationPivot: { x: 0, y: 0 } }, ox + px * s, oy + py * s, scale);
                            }
                        }
                    }
                    const animationTime = this.mountedAnimation.forUnit(u.kind, time);
                    const firearm = (passenger ?? u).kind === 'leader' && usesFirearm(state, passenger ?? u);
                    const equipment = passenger || firearm ? { passenger, firearm } : undefined;
                    scene.sprite(art.unit(u, animationTime, color, equipment), (x), (y), figureScale,vesselAlpha.get(u.id)??1);
                    const flash = damageFlashWeight(time - (u.damageFlashAt ?? -Infinity));
                    if (flash > 0) scene.sprite(art.unit(u, animationTime, color, { damageMask: true, passenger, firearm }), (x), (y), figureScale, flash);
                }
                // Restore only low foreground wheat. The strips are anchored to
                // field pixels, shared by animation frames, and include the row
                // behind the feet so adjoining plots have no visibility seam.
                for (let row = Math.floor(feet - .28); row <= Math.floor(feet); row++) for (let column = Math.floor(u.x - .55); column <= Math.floor(u.x + .55); column++) {
                    const field = fieldAt(column, row);
                    if (!field) continue;
                    const fieldTime = pointInSight(fog, column + .5, row + .5) ? time : field.observedAt;
                    if (!farmOcclusionHeight(field, fieldTime)) continue;
                    const south = fieldAt(column, row + 1);
                    const continuesSouth = !!south && farmOcclusionHeight(south, pointInSight(fog, column + .5, row + 1.5) ? time : south.observedAt) > 0;
                    if (feet >= row + 1 && !continuesSouth) continue;
                    const occupants = cellBuildings[field.y * w.width + field.x], ditch = (irrigationIndex === buildingIndex ? occupants : irrigationIndex.get(tileKey(field.x, field.y)))?.find(b => b.kind === 'irrigation' && buildingReady(b));
                    const road = ditch && occupants?.find(b => b.kind === 'road' && buildingReady(b));
                    const ditchLinks = ditch && linksOf(ditch, irrigationIndex), roadLinks = road && linksOf(road, buildingIndex);
                    const footColumn = Math.round((u.x - column) * 16), footRow = Math.round((feet - row) * 16);
                    const joins = fieldJoins(field, fieldTime);
                    const key = `wheat-front:${fieldKey(field, fieldTime, joins)}:${footColumn},${footRow}:${continuesSouth}:${landKey(column, row)}:${linksKey(ditchLinks)}:${linksKey(roadLinks)}`;
                    const foreground = art.paint(key, { x: 0, y: 0, width: 32, height: 32 }, c => {
                        c.save(); clipFarmToLand(c, this.terrain, column, row, 0, 0, 32);
                        if (ditchLinks) clipFarmAroundIrrigation(c, 0, 0, 32, ditchLinks, roadLinks);
                        drawFarmOcclusion(c, 0, 0, 32, fieldTime, field, footColumn * 2, footRow * 2, continuesSouth, joins); c.restore();
                    });
                    scene.sprite(foreground, ox + column * s, oy + row * s, scale);
                }
            }
        }
        const blood = scene.graphics();
        for (const effect of state.bloodEffects ?? []) {
            if (effect.elapsed >= BLOOD_EFFECT_DURATION || !pointInSight(fog, effect.x, effect.y)) continue;
            const progress = Math.max(0, effect.elapsed / BLOOD_EFFECT_DURATION), pixel = Math.max(1, Math.round(s * .035));
            for (let i = 0; i < 5; i++) {
                const angle = effect.angle + (i - 2) * .63, travel = s * (.025 + progress * (.12 + (i % 2) * .045));
                const x = Math.round(ox + effect.x * s + Math.cos(angle) * travel);
                const y = Math.round(oy + (effect.y - effect.height) * s + Math.sin(angle) * travel * .65 - Math.sin(progress * Math.PI) * s * .06);
                blood.rect(x, y, pixel * (i === 2 ? 2 : 1), pixel).fill({ color: i % 2 ? '#7d2024' : '#cf4440', alpha: Math.min(1, (1 - progress) * 2) });
            }
        }
        // Damaged health bars stay readable; selection never draws a ground ring.
        for (const b of structures) if (b.hp > 0 && !isFarmKind(b.kind) && !['road', 'bridge', 'irrigation'].includes(b.kind)
            && !(b.kind === 'fort' && b.fort?.destroyed) && b.hp < b.maxHp && buildingInSight(fog, b)) {
            const anchor = buildingImageAnchor(b, wellAttachedToHouse(b, previewIndex));
            this.healthBar(scene, ox + (b.x + anchor.x) * s, oy + (b.y + anchor.y) * s - 5, b.hp / b.maxHp, s * .65);
        }
        const warning = (x: number, y: number, color: string, stroke: string, fontSize = 17, lineWidth = 3, camp = false) => {
            if (!this.overlays) return;
            scene.sprite(art.paint(`warning:${color}:${stroke}:${fontSize}:${lineWidth}:${camp}`, { x: -fontSize, y: -fontSize * 1.5, width: fontSize * 2, height: fontSize * 2 }, c => {
                c.font = gameFont(fontSize, 700); c.textAlign = 'center'; c.lineWidth = lineWidth;
                c.textBaseline = camp ? 'bottom' : 'alphabetic';
                c.strokeStyle = stroke; c.strokeText('!', 0, 0); c.fillStyle = color; c.fillText('!', 0, 0);
            }), x, y);
        };
        for (const b of structures) if (b.kind === 'house' && b.houseUpgradeAt !== undefined && buildingInSight(fog, b)) {
            const pulse = .65 + .35 * Math.sin(time * 5), pixel = Math.max(1, Math.round(s / 20));
            const icon = art.paint(`house-upgrade:${pixel}`, { x: -10 * pixel, y: -10 * pixel, width: 20 * pixel, height: 20 * pixel }, c => {
                c.shadowColor = '#65ff86'; c.shadowBlur = 5 * pixel; c.fillStyle = '#70ff91';
                // Two crisp upward chevrons surrounded by a soft green glow.
                for (const offset of [-3, 2]) for (let x = -3; x <= 3; x++)
                    c.fillRect(x * pixel, (Math.abs(x) + offset) * pixel, pixel, 2 * pixel);
            });
            scene.sprite(icon, ox + (b.x + .5) * s, oy + (b.y + buildingArtTop(b) - .22) * s - pulse * s * .08, 1, pulse);
        }
        for (const b of structures) if (b.kind === 'house' && b.houseDowngradeAt !== undefined && buildingInSight(fog, b))
            warning(ox + (b.x + .5) * s, oy + (b.y + buildingArtTop(b)) * s - s * (.25 + Math.abs(Math.sin(time * 4)) * .16), '#ffeaa0', '#5f422b');
        for (const ship of visibleUnits) if (ship.warship?.boarding !== undefined && (ship.warship.marine === 'warrior' || ship.warship.marine === 'spearman')) {
            const enemy = entityStore(state).units.get(ship.warship.boarding);
            if (!enemy || enemy.hp <= 0) continue;
            const from = galleyClosestPoint(ship, enemy), to = galleyClosestPoint(enemy, ship);
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            for (let i = 0; i < Math.min(2, Math.ceil(ship.warship.crewHp / 100)); i++) {
                const phase = (time * .6 + i * .5) % 1, offset = i ? .35 : -.35;
                const px = from.x + (to.x - from.x) * phase - Math.sin(angle) * offset;
                const py = from.y + (to.y - from.y) * phase + Math.cos(angle) * offset;
                const marine = { ...ship, kind: ship.warship.marine, warship: undefined, sailboat: undefined, inside: false, facing: angle, moving: true, attackTime: phase > .8 ? .2 : 0 };
                scene.sprite(art.unit(marine, time, colorFor(ship.faction)), ox + (px - .4) * s, oy + (py - .68) * s, scale * .8);
            }
        }
        for (const u of visibleUnits) {
            if(vesselGhosts.has(u.id))continue;
            const onWall = u.wallPatrol?.wall !== undefined;
                const x = ox + (u.x - (onWall ? .3 : .5)) * s, y = oy + (unitTop(u) - (onWall ? .25 : 0)) * s;
                const figureScale = scale * (onWall ? .6 : 1);
            if ((u.cargo ?? 0) > 0 && u.cargoExpiresAt !== undefined && u.cargoExpiresAt > time && u.cargoExpiresAt - time <= FIELD_SPOIL_WARNING_SECONDS) expiry(x + s * .5, y - s * .2);
            if ((u.brace?.defense ?? 0) > 0) scene.sprite(art.paint(`brace:${s}`, { x: -s * .3, y: -s * .3, width: s * .6, height: s * .6 }, c => drawBraceShield(c, s)), x + s * .5, y - s * (.18 + Math.sin(time * 2) * .025));
            if ((u.kills ?? 0) >= 10) scene.sprite(art.paint(`veterancy:${veterancy(u)}:${s}`, { x: 0, y: -s * .5, width: s, height: s }, c => drawVeterancy(c, u, 0, 0, s)), x, y);
            if (u.warship) {
                const label = u.warship.name;
                const width = nameplateWidth(label), color = colorFor(u.faction, u.faction === -2 ? RAIDER_COLOR : '#ad8c57');
                const card = art.paint(`nameplate:${label}:${color}`, { x: -width / 2, y: -NAMEPLATE_HEIGHT / 2, width, height: NAMEPLATE_HEIGHT },
                    c => drawNameplate(c, label, width, color));
                scene.sprite(card, Math.round(x + s * .5), Math.round(y - s * 2.3 - NAMEPLATE_HEIGHT / 2));
                this.healthBar(scene, x + s * .5, y - s * 2, u.hp / unitMaxHp(u), s * 2);
            }
            if (u.hp < unitMaxHp(u) && !u.warship) {
                const top = u.kind === 'sailboat' ? -.85 : u.kind === 'worker' ? .04 : u.kind === 'leader' || (u.kind === 'levyInfantry' || u.kind === 'slinger') || u.kind === 'skirmisher' || u.kind === 'supplyCart' || isRetinueMember(u) || u.kind === 'militia' ? -.035 : -.13;
                this.healthBar(scene, x + s * .5, y + s * top, u.hp / unitMaxHp(u), s * (u.kind === 'sailboat' ? 1.2 : .72));
            }
            if (u.hp > 0 && (u.lastDamagedAt ?? -Infinity) < (u.healerHealingAt ?? -Infinity) && state.time - (u.healerHealingAt ?? -Infinity) < .2) {
                const pixel = Math.max(1, Math.round(s / 24)), cx = Math.round(x + s * .5), cy = Math.round(y - s * (u.warship ? 2.8 : .35));
                const pulse = .6 + .35 * Math.sin(time * 5 + u.id);
                scene.sharedGraphics(`healing:${pixel}`, context => context.rect(-pixel, -3 * pixel, 2 * pixel, 6 * pixel)
                    .rect(-3 * pixel, -pixel, 6 * pixel, 2 * pixel).fill('#83ef91'), cx, cy, pulse);
            }
            if (u.morale < 35 || u.order === 'flee') warning(x + s * .5 + Math.sin(time * 30) * 2, y - s * .3, '#fffbe9', '#5f5544');
            // Hold stays on the opposite side from the compact rank emblem.
            if (u.order === 'hold' && u.kind !== 'militia' && u.kind !== 'sailboat') {
                const spacing = Math.round(s * .12);
                scene.sharedGraphics(`hold:${spacing}`,
                    context => context.rect(0, 0, 3, 8).rect(spacing, 0, 3, 8).fill('#fff0ba'), x + s * .04, y + s * .24);
            }
        }
        if (this.showYields) for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const tile = w.tiles[y * w.width + x];
            if (!pointInSight(fog, x + .5, y + .5)) continue;
            if (WATER.has(tile.terrain) && !tile.resource) continue;
            const marks = scene.graphics(); let start = ox + x * s + s * .18;
            if (tile.resource) marks.circle(ox + (x + .5) * s, oy + (y + .5) * s, Math.max(2, s * .10))
                .fill(RESOURCE_COLORS[tile.resource]).stroke({ color: '#17221c', width: 1 });
            if (WATER.has(tile.terrain)) continue;
            for (const [n, color] of [[tile.food, '#f9f2c7'], [tile.gold, '#ebc456']] as const) {
                for (let j = 0; j < Math.min(3, n); j++, start += 4) marks.rect(start, oy + y * s + s * .88, 2.5, 3).fill({ color, alpha: .5 });
                start += 3;
            }
        }
        if (state.buildMode && leader) {
            const radius = 10 * s, x = ox + leader.x * s, y = oy + leader.y * s;
            // Only the ring's position changes as the Leader and camera move.
            // Reusing its tessellation avoids rebuilding hundreds of arc strokes
            // on every placement frame.
            scene.retainedGraphics(['construction-range', s], circle => {
                for (let angle = 0; angle < Math.PI * 2; angle += 12 / radius)
                    circle.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius).arc(0, 0, radius, angle, Math.min(Math.PI * 2, angle + 6 / radius))
                        .stroke({ color: '#fffada', alpha: .6, width: 1.5 });
            }).position.set(x, y);
        }
        for (const ship of visibleUnits) if (ship.warship) for (let slot = 0; slot < 12; slot++) {
            const shot = ship.warship.guns?.[slot]?.shot; if (!shot || shot.projectile) continue;
            const age = time - shot.time; if (age < 0 || age > .55) continue;
            const t = age / .55, dx = shot.to.x - shot.from.x, dy = shot.to.y - shot.from.y, angle = Math.atan2(dy, dx);
            const kind = slot < 4 ? ship.warship.weapons[slot] : ship.warship.marine;
            const projectile = art.paint(`naval-projectile:${kind}:${s}`, { x: -s * .5, y: -s * .5, width: s, height: s }, c => {
                if (kind === 'ballista') drawBallistaBolt(c, s);
                else if (kind === 'archer') drawArrow(c, s);
                else if (kind === 'musketman') drawMusketBullet(c, s);
                else { c.fillStyle = '#302e2b'; c.fillRect(-s * .1, -s * .1, s * .2, s * .2); }
            });
            scene.sprite({ ...projectile, rotation: angle, rotationPivot: { x: 0, y: 0 } }, ox + (shot.from.x + dx * t) * s, oy + (shot.from.y + dy * t) * s);
        }
        for (const shot of state.projectiles ?? []) {
            if (shot.elapsed >= shot.duration || !pointInSight(fog, shot.x, shot.y)) continue;
            const progress = shot.elapsed / shot.duration, height = (shot.startHeight ?? .48) * (1 - progress) + .48 * progress + Math.sin(progress * Math.PI) * (shot.kind === 'bullet' ? 0 : .25);
            const projectile = art.paint(`projectile:${shot.kind}:${s}`, { x: -s, y: -s, width: s * 2, height: s * 2 }, c => {
                if (shot.kind === 'stone') { const p = Math.max(1, Math.round(s / 32)); c.fillStyle = '#403d31'; c.fillRect(-p, -p, p * 2, p * 2); c.fillStyle = '#c4b990'; c.fillRect(-p, -p, p, p); return; }
                if (shot.kind === 'cannonball') { c.fillStyle = '#262a29'; c.beginPath(); c.arc(0, 0, s * .12, 0, Math.PI * 2); c.fill(); c.fillStyle = '#8b9289'; c.fillRect(-s * .06, -s * .06, s * .07, s * .05); return; }
                if (shot.kind === 'bullet') { drawMusketBullet(c, s); return; }
                if (shot.kind === 'arrow') { drawArrow(c, s); return; }
                if (shot.kind === 'ballistaBolt') { drawBallistaBolt(c, s); return; }
                const length = s * .42, tip = length * .5;
                c.fillStyle = '#34261a'; c.fillRect(-tip, -1.6, length, 3.2); c.fillStyle = '#cfaa6e'; c.fillRect(-tip, -.7, length * .85, 1.4);
                c.beginPath(); c.moveTo(tip + s * .1, 0); c.lineTo(tip - 2, -2.8); c.lineTo(tip - 2, 2.8); c.closePath(); c.fillStyle = '#dae9d7'; c.fill();
            });
            const sprite = scene.sprite(projectile, 0, 0); sprite.pivot.set(-projectile.x, -projectile.y);
            sprite.position.set(ox + shot.x * s, oy + (shot.y - height) * s); sprite.rotation = Math.atan2(shot.end.y - shot.start.y, shot.end.x - shot.start.x);
        }
        scene.drawFog(ox, oy, w.width * s, w.height * s);
        if (distantRelief.length) {
            // Distant slopes and their ground form one terrain-only patch.
            // Mask it to fogged pixels so it cannot paint over visible units.
            distantRelief.sort((a, b) => a.depth - b.depth);
            const revisions = worldRevisions(w);
            scene.rasterLayer('distant-relief', [w, revisions.geometry, revisions.appearance, fog.sources, this.fogRevision, left, top, right, bottom, s],
                (right - left) * s, (bottom - top) * s, c => {
                    c.imageSmoothingEnabled = false;
                    const reveal = this.reliefFogArt.mask(w, fog, left, top, right, bottom, landmarkVisible);
                    c.drawImage(this.terrain, left * TILE_SIZE, top * TILE_SIZE, (right - left) * TILE_SIZE, (bottom - top) * TILE_SIZE,
                        0, 0, (right - left) * s, (bottom - top) * s);
                    for (const stamp of distantRelief) {
                        const image = reliefImage(stamp.style, stamp.slot, stamp.palette);
                        if (image) c.drawImage(image, (stamp.x - left) * s, (stamp.y - top) * s, stamp.width * s, stamp.height * s);
                    }
                    c.globalCompositeOperation = 'destination-in';
                    this.reliefFogArt.paintMask(c, reveal, s);
                    // Fade the completed patch once so overlapping slopes and
                    // their ground retain the same distant-terrain brightness.
                    c.globalAlpha = .65; c.globalCompositeOperation = 'destination-in';
                    const fogScale = this.fogCanvas.width / w.width;
                    c.imageSmoothingEnabled = true;
                    c.drawImage(this.fogCanvas, left * fogScale, top * fogScale, (right - left) * fogScale, (bottom - top) * fogScale,
                        0, 0, (right - left) * s, (bottom - top) * s);
                    c.globalCompositeOperation = 'source-over';
                }, ox + left * s, oy + top * s);
        }
        // Political boundaries stay legible while terrain, units and structures
        // retain their ordinary fog visibility.
        for (const site of siteViews(state, now)) {
            if (!site.showBrackets || !visible(site)) continue;
            if (buildingIndex.get(tileKey(site.x, site.y))?.some(b => b.hp > 0)
                || !site.available && pointInSight(fog, site.x + 1, site.y + 1)) continue;
            let mask = 0;
            for (let bit = 0; bit < 4; bit++) if (pointExplored(fog, site.x + bit % 2, site.y + Math.floor(bit / 2))) mask |= 1 << bit;
            if (mask) scene.sharedGraphics(`site-brackets:${s}:${site.near}:${mask}`, g => drawSiteBrackets(g, site.width * s, site.height * s, site.near, mask),
                ox + site.x * s, oy + site.y * s);
        }
        drawBorders();
        if (this.overlays) {
            const offensive = state.offensives?.find(order => order.faction === playerFaction(state));
            const preview = this.offensivePreview;
            const rally = preview ? preview.rally : offensive?.rally;
            const objective = preview ? preview.rally ? this.hover : undefined : offensive?.objective;
            if (offensive && offensive.phase !== 'captured' && !preview && !state.gameOver) {
                const dx = offensive.objective.x - offensive.rally.x, dy = offensive.objective.y - offensive.rally.y;
                const length = Math.hypot(dx, dy), span = length - 2;
                if (span >= 1.3) {
                    const count = Math.min(128, Math.max(1, Math.floor(span / 1.9)));
                    const heading = Math.atan2(dy, dx), step = span / count;
                    for (let index = 0; index < count; index++) {
                        const along = 1 + (index + .5) * step;
                        const x = (offensive.rally.x + dx / length * along) * s;
                        const y = (offensive.rally.y + dy / length * along) * s;
                        if (x + screenOx < -s || x + screenOx > this.width + s
                            || y + screenOy < -s || y + screenOy > this.height + s) continue;
                        const alpha = .38 + .12 * (.5 + .5 * Math.sin(this.designationTime * Math.PI * 2 / 3.2 - index * .55));
                        const arrow = scene.sharedGraphics('offensive-route-arrow', g => g
                            .poly([-20, -6, 3, -6, 3, -14, 22, 0, 3, 14, 3, 6, -20, 6])
                            .fill('#fff1bd').stroke({ color: '#513b20', alpha: .8, width: 1.5 }), x, y, alpha);
                        arrow.rotation = heading; arrow.scale.set(s / TILE_SIZE);
                    }
                }
            }
            if (objective) scene.sharedGraphics(`offensive-radius:${s}`, g => g.circle(0, 0, 6 * s)
                .fill({ color: '#d75f49', alpha: .035 }).stroke({ color: '#ed9476', alpha: .6, width: 1.5 }),
                ox + objective.x * s, oy + objective.y * s);
            for (const [point, kind] of [[rally, 'Rally'], [objective, 'Objective']] as const) {
                if (!point) continue;
                const x = ox + point.x * s, y = oy + point.y * s;
                if (x + screenOx < -100 || x + screenOx > this.width + 100
                    || y + screenOy < -100 || y + screenOy > this.height + 100) continue;
                const color = kind === 'Rally' ? '#f2cc70' : offensive?.phase === 'captured' && !preview ? '#90cd86' : '#ed806c';
                scene.sharedGraphics(`offensive-flag:${color}`, g => {
                    g.circle(0, 0, 5).fill({ color, alpha: .35 }).stroke({ color, width: 1 });
                    g.moveTo(0, 1).lineTo(0, -30).stroke({ color: '#201c16', width: 5 });
                    g.moveTo(0, 1).lineTo(0, -30).stroke({ color: '#f0dfb0', width: 2 });
                    g.poly([1, -29, 21, -29, 15, -22, 21, -15, 1, -15]).fill(color).stroke({ color: '#35251c', width: 1.5 });
                }, x, y);
                const caption = art.paint(`offensive-label:${kind}:${color}`, { x: -50, y: -49, width: 100, height: 18 }, c => {
                    c.font = gameFont(15); c.textAlign = 'center'; c.textBaseline = 'middle';
                    c.lineWidth = 3; c.strokeStyle = '#1d211a'; c.strokeText(kind, 0, -40);
                    c.fillStyle = color; c.fillText(kind, 0, -40);
                });
                scene.sprite(caption, x, y);
            }
            if (preview && !preview.rally && this.hover) scene.sharedGraphics('offensive-rally-preview', g => g.circle(0, 0, 9)
                .stroke({ color: '#f2cc70', alpha: .8, width: 2 }), ox + this.hover.x * s, oy + this.hover.y * s);
        }
        if (leader && visible(leader)) {
            const alpha = infantryRotationAlpha(leader, time), form = leader.infantryFormation;
            if (alpha > 0 && form) {
                const ahead = Math.max(.85, ...form.slots.map(slot => slot.x)) + .35;
                const arrow = art.paint('infantry-advance-arrow', { x: 0, y: -14, width: 46, height: 28 }, drawInfantryAdvanceArrow);
                const sprite = scene.sprite(arrow, 0, 0, scale, alpha);
                sprite.pivot.set(-arrow.x, -arrow.y);
                sprite.position.set(ox + (leader.x + Math.cos(form.heading) * ahead) * s,
                    oy + (leader.y + Math.sin(form.heading) * ahead) * s);
                sprite.rotation = form.heading;
            }
        }
        // Player designations remain visible over fog without revealing anything
        // below. Only viewport cells are visited, and 16 edge variants share art.
        const forbidden = forbiddenCells(state);
        if (forbidden.size) {
            for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
                const cell = y * w.width + x;
                if (!forbidden.has(cell)) continue;
                const edges = Number(y === 0 || !forbidden.has(cell - w.width))
                    | Number(x === w.width - 1 || !forbidden.has(cell + 1)) << 1
                    | Number(y === w.height - 1 || !forbidden.has(cell + w.width)) << 2
                    | Number(x === 0 || !forbidden.has(cell - 1)) << 3;
                bake(`forbidden-cell:${edges}`, ox + x * s, oy + y * s, 32, 32, c => drawForbiddenCell(c, edges));
            }
        }
        const questCells=questAreaCells(state);
        if(this.overlays&&questCells.size){
            for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
                const cell=y*w.width+x;if(!questCells.has(cell))continue;
                const edges=Number(y===0||!questCells.has(cell-w.width))|Number(x===w.width-1||!questCells.has(cell+1))<<1
                    |Number(y===w.height-1||!questCells.has(cell+w.width))<<2|Number(x===0||!questCells.has(cell-1))<<3;
                bake(`quest-cell:subtle:${edges}`,ox+x*s,oy+y*s,32,32,c=>drawQuestCell(c,edges));
            }
        }
        // Owned orders remain reviewable without revealing anything beneath fog.
        // Draw the countdown above crops and people, including ditches in fields.
        for (const b of entityStore(state).buildings.query('construction')) if (b.faction === playerFaction(state) && b.hp > 0 && b.construction && visible(b)) {
            if (!buildingIndex.get(tileKey(b.x, b.y))?.some(observed => observed.id === b.id)) building(b);
            const progress = constructionProgress(state, b);
            // Queued sites need actual work before a timer.
            if (progress <= 0) continue;
            const frame = Math.ceil((1 - progress) * CONSTRUCTION_TIMER_STEPS);
            const offset = wellAttachedToHouse(b, buildingIndex) ? HOUSE_WELL_OFFSET : { x: 0, y: 0 };
            const radius = CONSTRUCTION_TIMER_RADIUS;
            const footprint = b.kind === 'dock' ? dockFootprint(b) : { x: 0, y: 0, width: buildingWidth(b), height: buildingHeight(b) };
            const timer = art.paint(`construction-timer:${frame}`, { x: -radius, y: -radius, width: radius * 2, height: radius * 2 },
                c => drawConstructionTimer(c, frame));
            scene.sprite(timer, (ox + (b.x + footprint.x + footprint.width / 2 + offset.x) * s),
                (oy + (b.y + footprint.y + footprint.height / 2 + offset.y) * s), scale);
        }
        // Planning overlays remain visible in fog, without changing visibility.
        const effectCulture = preview.length && (state.buildMode === 'monument' || state.buildMode === 'house')
            ? borderCultureAt(state, 0, preview[0].x + .5, preview[0].y + .5) : 0;
        const effect = buildingPlacementEffect(state.buildMode, effectCulture);
        if (effect && preview.length) {
            const origins = state.buildMode === 'irrigation' ? preview.filter(p => validPreviewCells.has(tileKey(p.x, p.y)))
                : state.buildMode === 'granary' ? preview.map(p => ({ x: p.x + .5, y: p.y + .5 })) : preview;
            const cells = (this.constructionEffects ??= new ConstructionEffectCache()).get(w, origins, effect.radius,
                { left, right, top, bottom }, state.buildMode === 'irrigation' || state.buildMode === 'granary' ? fog : undefined);
            scene.retainedGraphics(['construction-effect', cells, effect.beneficial, s, ox, oy], effectArt => {
                for (const { x, y, field } of cells) {
                    const px = Math.round(ox + x * s), py = Math.round(oy + y * s), width = Math.round(ox + (x + 1) * s) - px, height = Math.round(oy + (y + 1) * s) - py;
                    effectArt.rect(px + 1, py + 1, width - 2, height - 2).fill({ color: effect.beneficial ? '#5ee182' : '#f45b51', alpha: field ? .32 : .12 });
                    effectArt.rect(px + .5, py + .5, width - 1, height - 1).stroke({ color: field ? '#b1ff9b' : effect.beneficial ? '#90f4a9' : '#ff9180', alpha: field ? .8 : .24, width: 1 });
                }
            });
        }
        for (const { x, y } of preview) {
            if (x >= 0 && y >= 0 && x < w.width && y < w.height) {
                if (previewKind === 'road' && isFord(tileAt(w, x, y)) && !hasGateWall(state, x, y)) continue;
                const px = ox + x * s, py = oy + y * s;
                const plan = previewPlans.get(tileKey(x, y));
                const valid = !state.buildMode || validPreviewCells.has(tileKey(x, y));
                const marks = scene.graphics();
                const footprint = previewKind ? buildingWidth({ kind: previewKind }) : 1;
                const footprintHeight = previewKind ? buildingHeight({ kind: previewKind }) : 1;
                for (let dy = 0; dy < footprintHeight; dy++) for (let dx = 0; dx < footprint; dx++) {
                    const field = !!previewKind && isFarmKind(previewKind);
                    marks.rect(px + dx * s, py + dy * s, s, s).fill({ color: valid ? '#91e88c' : '#e04f43', alpha: valid ? field ? .12 : .22 : field ? .18 : .28 });
                    marks.rect(Math.floor(px + dx * s) + .5, Math.floor(py + dy * s) + .5, s - 1, s - 1).stroke({ color: valid ? '#b4e7a0' : '#ef7867', width: 1 });
                }
                if (previewKind && valid && !isFarmKind(previewKind)) {
                    const b = plan!.building;
                    // Unexplored ground has no remembered trees to occlude a
                    // ghost; keep that planning image visible above black fog.
                    if (b.kind !== 'irrigation' || !pointExplored(fog, x, y)) building(b, previewIndex, .55);
                    if (b.kind === 'dock') {
                        const berth = dockBerth(b);
                        marks.rect(ox + (berth.x - .5) * s, oy + (berth.y - .5) * s, s, s)
                            .fill({ color: '#7fcce9', alpha: .18 }).stroke({ color: '#a6e4ff', width: 1 });
                    }
                    if (b.kind === 'road') {
                        const channel = previewIndex.get(tileKey(x, y))?.find(other => other.kind === 'irrigation' && buildingReady(other));
                        if (channel) bridge(x, y, buildingConnections(b, previewIndex, w), buildingConnections(channel, previewIndex, w), .55);
                    }
                    // A house ghost is painted late. Restore its real well in
                    // front, rather than tinting or hiding it beneath the roof.
                    const well = sharedWellForHouse(b, buildingIndex.get(tileKey(x, y)) ?? []);
                    if (well) building(well, previewIndex);
                    // A wall ghost belongs behind its existing tower even
                    // though placement previews are painted after structures.
                    const tower = sharedTowerForWall(b, buildingIndex.get(tileKey(x, y)) ?? []);
                    if (tower) building(tower, previewIndex);
                }
            }
        }
        if (this.areaPreview) {
            const { start, end, tool, erase } = this.areaPreview;
            const x = Math.max(0, Math.min(start.x, end.x)), y = Math.max(0, Math.min(start.y, end.y));
            const width = Math.min(w.width - 1, Math.max(start.x, end.x)) - x + 1;
            const height = Math.min(w.height - 1, Math.max(start.y, end.y)) - y + 1;
            if (width > 0 && height > 0) {
                const marks = scene.graphics();
                const fill = tool === 'forbid' ? erase ? '#9ce7c7' : '#ffffff' : tool === 'clear' ? '#ee7440' : '#ef5151';
                const stroke = tool === 'forbid' ? erase ? '#bcf5dc' : '#ffffff' : tool === 'clear' ? '#f2a473' : '#ff8a86';
                marks.rect(ox + x * s, oy + y * s, width * s, height * s).fill({ color: fill, alpha: tool === 'forbid' ? .10 : tool === 'clear' ? .16 : .14 });
                marks.rect(ox + x * s + 1, oy + y * s + 1, width * s - 2, height * s - 2).stroke({ color: stroke, width: 2 });
            }
        }
        // One icon per connected component, including merged/irregular zones.
        // The UI clock keeps the gentle hop independent of simulation speed.
        for (const region of forbiddenRegions(state)) {
            if (!visible(region.center, 2)) continue;
            const hop = Math.pow(Math.max(0, Math.sin(this.designationTime * 2.2 + region.id * .37)), 2) * 3;
            scene.sprite(art.paint('forbidden-zone-marker', { x: -12, y: -12, width: 24, height: 24 }, drawForbiddenMarker),
                ox + region.center.x * s, oy + region.center.y * s - s * .3 - hop, Math.max(.85, Math.min(1.3, scale)));
        }
        if(this.overlays)for(const q of state.quests??[]){
            if(q.actor!==playerFaction(state)||!q.discovered||q.state>=3)continue;
            const markerScale=Math.max(.85,Math.min(1.25,scale));
            if(q.kind===2&&q.state>=1&&q.radius>0&&visible(q,q.radius+1)){
                const search=scene.graphics();
                search.circle(ox+q.x*s,oy+q.y*s,q.radius*s).fill({color:'#f2c94c',alpha:.008});
                search.circle(ox+q.x*s,oy+q.y*s,q.radius*s).stroke({color:'#f2c94c',alpha:.12,width:.75});
            }
            const giver=questGiverPosition(state,q);
            if(giver&&visible(giver,2)&&questMarkerRevealed(fog,giver))scene.sprite(art.paint(`quest-giver:routing:${q.state}`,{x:-QUEST_MARKER_SIZE/2,y:-QUEST_MARKER_SIZE,width:QUEST_MARKER_SIZE,height:QUEST_MARKER_SIZE},c=>drawQuestMarker(c,q.state)),
                ox+giver.x*s,oy+(giver.y-.65)*s,markerScale);
            if((q.state===1||q.state===2)&&visible(q,2)&&questMarkerRevealed(fog,q)
                &&(!giver||Math.hypot(q.x-giver.x,q.y-giver.y)>2)){
                const pulse=Math.sin(this.designationTime*2.2+q.kind)*1.5;
                scene.sprite(art.paint(`quest-target:routing:${q.state}`,{x:-QUEST_MARKER_SIZE/2,y:-QUEST_MARKER_SIZE,width:QUEST_MARKER_SIZE,height:QUEST_MARKER_SIZE},c=>drawQuestMarker(c,q.state===2?2:0)),
                    ox+q.x*s,oy+q.y*s-pulse,markerScale);
            }
        }
        if (this.overlays) for (const fort of structures) {
            if (fort.kind !== 'fort' || !buildingPresent(fort) || fort.fort?.destroyed || !buildingInSight(fog, fort)) continue;
            const name = fortName(fort), width = nameplateWidth(name), color = colorFor(fort.faction, fort.faction === -2 ? RAIDER_CAMP_COLOR : '#9c9d80');
            const card = art.paint(`nameplate:${name}:${color}`, { x: -width / 2, y: -NAMEPLATE_HEIGHT / 2, width, height: NAMEPLATE_HEIGHT },
                c => drawNameplate(c, name, width, color));
            scene.sprite(card, Math.round(ox + (fort.x + buildingWidth(fort) / 2) * s),
                Math.round(oy + (fort.y + buildingArtTop(fort)) * s - 12 - NAMEPLATE_HEIGHT / 2));
        }
        // Only visible player ribbons need economic statistics; foreign ribbons
        // display their names alone. Keep the full faction ledger for population
        // and shared costs, without preparing every other realm's farm routes.
        const labelFaction = playerFaction(state), labelOwners = new Map(state.factions.map(faction => [faction.id, faction]));
        const labelPalaces = !this.overlays ? [] : entityStore(state).buildings.query('palace').filter(palace => palace.faction >= 0
            && labelOwners.has(palace.faction) && !labelOwners.get(palace.faction)!.defeated
            && buildingReady(palace) && buildingInSight(fog, palace) && visible(palace, 6));
        if (labelPalaces.some(palace => palace.faction === labelFaction)
            && (!this.citySummaryCache || !samePresentationSession(this.citySummaryCache.state, state) || this.citySummaryCache.world !== w
                || this.citySummaryCache.faction !== labelFaction || now >= this.citySummaryCache.nextRefreshAt)) {
            this.citySummaryCache = { state, world: w, faction: labelFaction, nextRefreshAt: now + 1000,
                values: citySummariesForFaction(state, labelFaction) };
        }
        for (const palace of labelPalaces) {
            const city: CitySummary | undefined = palace.faction === labelFaction
                ? this.citySummaryCache?.values.find(city => city.palace === palace)
                : { palace, name: palace.cityName ?? labelOwners.get(palace.faction)!.name, population: 0, housing: 0, food: 0, gold: 0 };
            if (!city) continue;
            const height = city.palace.faction === playerFaction(state) ? CITY_RIBBON_HEIGHT : CITY_NAME_RIBBON_HEIGHT;
            const x = ox + (city.palace.x + buildingWidth(city.palace) / 2) * s, y = oy + city.palace.y * s - 6 - height / 2;
            const loyalty = loyaltyOf(state, city.palace);
            const key = `city:${playerFaction(state)}:${city.name}:${city.palace.faction}:${city.population}:${city.housing}:${Math.round(city.food)}:${Math.round(city.gold)}:${Math.round(loyalty.value)}:${loyalty.warning}`;
            // Use screen-sized clearance around the ribbon so the player stays
            // visible at every zoom level. This only changes sprite opacity.
            let proximityAlpha = 1;
            if (leader && leader.hp > 0 && !leader.inside) {
                const dx = Math.max(0, Math.abs(ox + leader.x * s - x) - CITY_RIBBON_MAX_WIDTH / 2);
                const dy = Math.max(0, Math.abs(oy + (leader.y - .5) * s - y) - height / 2);
                const clearance = Math.min(1, Math.hypot(dx, dy) / 48);
                proximityAlpha = .3 + .7 * clearance * clearance * (3 - 2 * clearance);
            }
            scene.sprite(art.paint(key, { x: -CITY_RIBBON_MAX_WIDTH / 2, y: -height / 2 - 1, width: CITY_RIBBON_MAX_WIDTH, height: height + 2 }, c => drawCityRibbon(c, city, 0, 0, Math.max(180, this.width - 16), playerFaction(state), loyalty)), x, y, 1,
                proximityAlpha * loyaltyPanelAlpha(state, city.palace, playerFaction(state), now));
        }
        for (const { camp, center } of checks.alliedCamps) {
            if (!buildingReady(camp) || !buildingInSight(fog, camp) || !visible(camp, 2)) continue;
            const x = ox + (center.x + .5) * s;
            const y = oy + center.y * s - 22 - Math.sin(time * 2 + camp.id) * 2;
            scene.sprite(art.paint('village-alliance', { x: -16, y: -16, width: 32, height: 32 }, drawAllianceMarker), x, y);
        }
        const research = checks.research;
        if (this.overlays && !state.gameOver && research?.library && !research.completed && research.required > research.progress)
            for (const b of structures) if (b.kind === 'library' && b.faction === playerFaction(state) && buildingReady(b) && buildingInSight(fog, b)) {
                const x = Math.round(ox + (b.x + buildingWidth(b) / 2) * s - RESEARCH_BAR_WIDTH / 2), y = Math.round(oy + (b.y + buildingArtTop(b)) * s - RESEARCH_BAR_GAP - RESEARCH_BAR_HEIGHT);
                const marks = scene.graphics().roundRect(x + .5, y + .5, RESEARCH_BAR_WIDTH - 1, RESEARCH_BAR_HEIGHT - 1, 2)
                    .fill({ color: '#000', alpha: .76 }).stroke({ color: '#e8c56f', alpha: .48, width: 1 });
                if (research.progress > 0) marks.rect(x + 1, y + 1, (RESEARCH_BAR_WIDTH - 2) * research.progress / research.required, RESEARCH_BAR_HEIGHT - 2).fill('#e8c56f');
            }
        for (const camp of checks.warnings) {
            const center = raiderCampCenter(camp);
            if (!pointExplored(fog, center.x, center.y) || !visible(center)) continue;
            warning(ox + center.x * s, oy + (camp.y - .2) * s - Math.abs(Math.sin(time * 6)) * s * .35, '#ff3b30', '#1a1010', Math.max(18, s * 1.1), Math.max(3, s * .12), true);
        }
        const discoveryRows = new Map<number, number>();
        for (const particle of this.overlays ? state.particles : []) {
            if (particle.kind === 'exploration') {
                if (particle.life <= 0 || particle.faction !== playerFaction(state)) continue;
                const leader = entityStore(state).units.get(particle.followUnit ?? -1), position = leader ?? particle;
                if (!pointInSight(fog, position.x, position.y)) continue;
                const width = 620;
                const labelArt = art.paint(`exploration-message:${particle.text}`, { x: -width / 2, y: -116, width, height: 120 }, c => {
                    paintExplorationMessage(c, particle.text);
                });
                const row = discoveryRows.get(particle.followUnit ?? 0) ?? 0; discoveryRows.set(particle.followUnit ?? 0, row + 1);
                scene.sprite(labelArt, ox + position.x * s, oy + (position.y - 1.1) * s - row * 124, 1, .78 * particle.life / (particle.duration ?? 12));
                continue;
            }
            const damage = particle.kind === 'damage', healing = particle.kind === 'healing', gold = /^[+−-]\d+(?:\.\d+)? gold$/.test(particle.text);
            const food = /^[+−-]\d+(?:\.\d+)? food$/.test(particle.text)
                && (particle.kind === 'hunt' || particle.kind === 'food' || /^[−-]/.test(particle.text));
            if (particle.life <= 0 || !damage && !healing && !gold && !food || !pointInSight(fog, particle.x, particle.y)) continue;
            if (damage && !damageNumberVisible(state, particle)) continue;
            const damageStyle = damage ? damageNumberStyle(state, particle) : undefined;
            const amount = Math.round(Number(particle.text.replace(/ (?:gold|food)$/, '').replace('−', '-')));
            const label = healing ? particle.text : damageStyle?.text ?? `${amount > 0 ? '+' : ''}${amount}`, color = damageStyle?.color ?? (gold ? '#ffe33d' : particle.color);
            const font = Math.round(Math.max(11, Math.min(16, s * .32)));
            const labelArt = art.paint(`reward:${label}:${color}:${font}`, { x: -60, y: -24, width: 120, height: 28 }, c => {
                c.font = gameFont(font, 700); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.strokeStyle = '#1d211a'; c.lineWidth = 3; c.lineJoin = 'round';
                c.strokeText(label, 0, 0); c.fillStyle = color; c.fillText(label, 0, 0);
            });
            const pose = damage ? damageNumberPose(particle.life, particle.direction) : gold || healing ? goldNumberPose(particle.life, particle.duration) : undefined;
            scene.sprite(labelArt, (ox + (particle.x + (pose?.offset ?? 0)) * s),
                (oy + (particle.y - .8 - (pose?.rise ?? Math.max(0, 1.6 - particle.life) * .3)) * s), 1,
                pose?.alpha ?? Math.min(1, particle.life / .5));
        }
        // Player orders sit above fog; they disclose no terrain or rival plans.
        for (const order of this.pendingConstruction ?? []) for (const point of order.points) {
            if (point.x < 0 || point.y < 0 || point.x >= w.width || point.y >= w.height || !visible(point)) continue;
            bake(`pending-construction:${order.kind}`, ox + point.x * s, oy + point.y * s, 32, 32, c => {
                c.strokeStyle = order.kind === 'irrigation' ? '#80d8ed' : '#edce88'; c.lineWidth = 2;
                c.setLineDash([4, 3]); c.strokeRect(2, 2, 28, 28);
            }, .9);
        }
        const requested = sharedGesture?.requestedEnd, lastPreview = sharedGesture?.points.at(-1);
        if (requested && visible(requested) && requested.x >= 0 && requested.y >= 0 && requested.x < w.width && requested.y < w.height
            && (!lastPreview || requested.x !== lastPreview.x || requested.y !== lastPreview.y
                || !sharedGesture!.plan.cells.some(cell => cell.x === requested.x && cell.y === requested.y && cell.ok))) {
            bake('construction-requested-end', ox + requested.x * s, oy + requested.y * s, 32, 32, c => {
                c.strokeStyle = '#ef7867'; c.lineWidth = 2; c.strokeRect(2, 2, 28, 28);
                c.beginPath(); c.moveTo(11, 11); c.lineTo(21, 21); c.moveTo(21, 11); c.lineTo(11, 21); c.stroke();
            });
        }
        for (const order of state.treeClearings ?? []) if (order.faction === playerFaction(state) && visible(order)) {
            scene.sprite(art.paint('tree-clearing', { x: -8, y: -8, width: 18, height: 18 }, c => {
                c.strokeStyle = '#5e452b'; c.lineWidth = 4; c.beginPath(); c.moveTo(-5, 6); c.lineTo(4, -5); c.stroke();
                c.strokeStyle = '#efd9a2'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#d7d6bc';
                c.beginPath(); c.moveTo(0, -6); c.lineTo(8, -2); c.lineTo(5, 2); c.lineTo(1, -1); c.closePath(); c.fill();
            }), ox + (order.x + .78) * s, oy + (order.y + .18) * s);
        }
        if (this.movementModeMarker) {
            const marker = this.movementModeMarker;
            if (leader) scene.sprite(art.paint(`mode:${marker.mode}`, { x: -16, y: -16, width: 32, height: 32 }, c => drawMovementModeIcon(c, marker.mode, 0, 0)),
                ox + leader.x * s, oy + (leader.y - 1.25) * s, 1, Math.min(1, (1.1 - marker.elapsed) / .25));
            marker.elapsed += dt; if (marker.elapsed >= 1.1) this.movementModeMarker = null;
        }
        if (this.moveMarker) {
            const marker = this.moveMarker, phase = marker.elapsed / COMMAND_MARKER_SECONDS;
            const x = (ox + marker.x * s), y = (oy + marker.y * s - phase * 5);
            scene.sprite(art.paint(`command-check:${!!marker.attack}`, { x: -6, y: -5, width: 12, height: 10 },
                c => drawCommandCheck(c, marker.attack)), x, y, Math.max(1, Math.round(s / 16)), Math.max(0, 1 - phase));
            marker.elapsed += dt; if (marker.elapsed >= COMMAND_MARKER_SECONDS) this.moveMarker = null;
        }
        scene.finishFrame();
        this.drawMinimap(state, fog);
    }
    private healthBar(scene: PixiScene, x: number, y: number, value: number, width: number) {
        if (!this.overlays) return;
        const marks = scene.graphics().rect(Math.floor(x - width / 2) - 1, y - 1, width + 2, 5).fill('#354e39');
        for (let i = 0; i < 5; i++) marks.rect(Math.floor(x - width / 2 + i * width / 5), y, width / 5 - 1, 3)
            .fill(i / 5 < value ? value < .3 ? '#df8265' : '#c4d78a' : '#5a6651');
    }
    private prepareFog(fog: FogView) {
        const mask = fogRenderMask(fog), { width, height } = mask;
        if (this.fogView !== fog || this.fogCanvas.width !== width || this.fogCanvas.height !== height) {
            this.fogView = fog;
            this.fogCanvas.width = width; this.fogCanvas.height = height;
            this.fogPixels = undefined;
            this.fogRevision = -1;
        }
        if (this.fogRevision === mask.revision) return;
        const c = this.fogCanvas.getContext('2d')!, pixels = this.fogPixels ??= c.createImageData(width, height);
        if (this.fogRevision === mask.previousRevision && mask.dirtyCells) {
            // Upload at most one span per tile row. Scattered changing edges
            // no longer force an alpha copy and texture upload for the world.
            const columns = width / mask.scale, rows = new Map<number, [number, number]>();
            for (const cell of mask.dirtyCells) {
                const x = cell % columns, y = Math.floor(cell / columns);
                for (let sy = 0; sy < mask.scale; sy++) {
                    const offset = (y * mask.scale + sy) * width + x * mask.scale;
                    for (let sx = 0; sx < mask.scale; sx++) pixels.data[(offset + sx) * 4 + 3] = mask.alpha[offset + sx];
                }
                const span = rows.get(y);
                if (span) { span[0] = Math.min(span[0], x); span[1] = Math.max(span[1], x); }
                else rows.set(y, [x, x]);
            }
            for (const [y, [left, right]] of rows)
                c.putImageData(pixels, 0, 0, left * mask.scale, y * mask.scale, (right - left + 1) * mask.scale, mask.scale);
        } else {
            for (let i = 0; i < mask.alpha.length; i++) pixels.data[i * 4 + 3] = mask.alpha[i];
            c.putImageData(pixels, 0, 0);
        }
        this.fogRevision = mask.revision!;
        this.gpu?.updateFog(this.fogCanvas);
    }
    private prepareMinimapTerritory(state: GameState, fog: FogView) {
        const { world } = state, canvas = this.minimapTerritory;
        if (this.minimapClaimWorld !== world || canvas.width !== world.width || canvas.height !== world.height) {
            canvas.width = world.width; canvas.height = world.height;
            this.minimapClaims = new MinimapTerritoryMemory(); this.minimapClaimWorld = world;
        }
        const palette = state.factions.map(faction => `${faction.id}:${faction.color}`).join(';');
        const changed = this.minimapClaims.update(territory(state), fog, palette !== this.minimapClaimPalette);
        this.minimapClaimPalette = palette;
        if (!changed.length) return;
        const c = canvas.getContext('2d')!, colors = new Map(state.factions.map(faction => [faction.id, faction.color]));
        for (const cell of changed) {
            const x = cell % world.width, y = Math.floor(cell / world.width), owner = this.minimapClaims.owners[cell];
            c.clearRect(x, y, 1, 1);
            if (owner === UNCLAIMED) continue;
            c.fillStyle = colors.get(owner) ?? '#b5a587';
            c.globalAlpha = this.minimapClaims.boundary[cell] ? .58 : .22;
            c.fillRect(x, y, 1, 1);
        }
        c.globalAlpha = 1;
    }
    private drawMinimapContent(state: GameState, fog: FogView, width: number, height: number, dpr: number) {
        const c = this.minimapContent.getContext('2d')!, canvas = this.minimap, w = state.world;
        c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
        c.fillStyle = '#000'; c.fillRect(0, 0, width, height);
        const previous = this.minimapProjection;
        if (!previous || this.minimapExploration !== fog.explored || this.minimapExplorationRevision !== fog.explorationRevision
            || Math.abs(previous.width + previous.x * 2 - width) > .01 || Math.abs(previous.height + previous.y * 2 - height) > .01) {
            // Fit the discovered rectangle inside the circular viewport so its corners
            // remain visible; CSS clips only the surrounding black canvas.
            const inset = Math.min(width, height) * (1 - Math.SQRT1_2) / 2;
            this.minimapProjection = createMinimapProjection(fog.explored, w.width, w.height, width - inset * 2, height - inset * 2, 2, fog.explorationRevision);
            this.minimapProjection.x += inset; this.minimapProjection.y += inset;
            this.minimapExploration = fog.explored; this.minimapExplorationRevision = fog.explorationRevision;
        }
        const projection = this.minimapProjection!, bounds = projection.world;
        c.save(); c.beginPath(); c.rect(projection.x, projection.y, projection.width, projection.height); c.clip();
        c.drawImage(this.miniature, bounds.x, bounds.y, bounds.width, bounds.height, projection.x, projection.y, projection.width, projection.height);
        this.prepareMinimapTerritory(state, fog);
        for (const camp of state.raiderCamps ?? []) {
            const center = raiderCampCenter(camp);
            if (camp.destroyed || !pointExplored(fog, center.x, center.y)) continue;
            const p = worldToMinimap(center, projection);
            c.fillStyle = RAIDER_COLOR; c.strokeStyle = '#c8bba2'; c.lineWidth = 1;
            c.fillRect(p.x - 3, p.y - 3, 6, 6); c.strokeRect(p.x - 3, p.y - 3, 6, 6);
        }
        for (const u of state.units) if (!u.inside && u.hp > 0 && (isMapRevealed(state) || observationPostVisibleTo(u, playerFaction(state))) && (u.faction >= 0 || u.faction === -2) && (u.faction === playerFaction(state) || pointInSight(fog, u.x, u.y))) {
            const p = worldToMinimap(u, projection);
            c.fillStyle = u.faction === playerFaction(state) && u.kind === 'leader' ? '#fff8c8' : unitColor(state, u);
            const size = u.kind === 'leader' ? 3 : 2;
            c.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        }
        c.imageSmoothingEnabled = true;
        const fogScale = this.fogCanvas.width / w.width;
        c.drawImage(this.fogCanvas, bounds.x * fogScale, bounds.y * fogScale, bounds.width * fogScale, bounds.height * fogScale, projection.x, projection.y, projection.width, projection.height);
        c.imageSmoothingEnabled = false;
        c.drawImage(this.minimapTerritory, bounds.x, bounds.y, bounds.width, bounds.height, projection.x, projection.y, projection.width, projection.height);
        // The HUD scales this canvas twice with CSS transforms. Size icons in
        // displayed pixels, so their pale battlements remain readable in the
        // real minimap rather than shrinking to two or three screen pixels.
        const rect = canvas.getBoundingClientRect();
        const markerPixelX = width / (rect.width || width), markerPixelY = height / (rect.height || height);
        if(this.overlays)for(const q of state.quests??[]){
            if(q.actor!==playerFaction(state)||!q.discovered||q.state>=3)continue;
            const giver=questGiverPosition(state,q);
            if(!giver||!questMarkerRevealed(fog,giver))continue;
            const p=worldToMinimap(giver,projection),size=10.5*markerPixelX;
            drawQuestMarker(c,q.state,p.x-size/2,p.y-size,size);
        }
        // Known palaces remain legible above fog and troop dots. A compact
        // battlement silhouette distinguishes cities from ordinary units/camps.
        for (const b of fog.buildings) {
            if (b.kind !== 'palace' || !buildingReady(b) || b.faction < 0) continue;
            const p = worldToMinimap({ x: b.x + 1, y: b.y + 1 }, projection);
            const x = (Math.round(rect.left + p.x / markerPixelX) - rect.left) * markerPixelX;
            const y = (Math.round(rect.top + p.y / markerPixelY) - rect.top) * markerPixelY;
            const pixelRect = (dx: number, dy: number, width: number, height: number): void =>
                c.fillRect(x + dx * markerPixelX, y + dy * markerPixelY, width * markerPixelX, height * markerPixelY);
            c.save();
            c.globalAlpha = b.faction === playerFaction(state) || buildingInSight(fog, b) ? 1 : .75;
            c.fillStyle = '#161b17'; pixelRect(-5, -5, 10, 10);
            c.fillStyle = '#fff4d1'; pixelRect(-4, -2, 8, 6);
            for (const dx of [-4, -1, 2]) pixelRect(dx, -4, 2, 3);
            c.fillStyle = factionColor(state, b.faction, '#fff'); pixelRect(-3, -1, 6, 4);
            c.fillStyle = '#161b17'; pixelRect(-1, 1, 2, 3);
            c.restore();
        }
        c.restore();
    }
    private drawMinimap(state: GameState, fog: FogView) {
        const c = this.mini, canvas = this.minimap;
        const width = canvas.clientWidth, height = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
        const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
        if (!pixelWidth || !pixelHeight) return;
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
        if (this.minimapContent.width !== pixelWidth || this.minimapContent.height !== pixelHeight) {
            this.minimapContent.width = pixelWidth; this.minimapContent.height = pixelHeight;
        }
        const now = performance.now(), old = this.minimapFrame, faction = playerFaction(state);
        // Presentation wall time is independent of game speed. The camera box
        // stays responsive, while scans and map composition happen at most 3 Hz.
        if (!old || !samePresentationSession(old.state, state) || old.world !== state.world || old.faction !== faction
            || old.fog !== fog || old.width !== width || old.height !== height || old.dpr !== dpr || now >= old.nextRefreshAt) {
            this.drawMinimapContent(state, fog, width, height, dpr);
            this.minimapFrame = { state, world: state.world, fog, faction, width, height, dpr, nextRefreshAt: now + CHECK_INTERVAL_MS };
        }
        c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = false;
        c.drawImage(this.minimapContent, 0, 0, width, height);
        const projection = this.minimapProjection!;
        c.save(); c.beginPath(); c.rect(projection.x, projection.y, projection.width, projection.height); c.clip();
        const vw = this.width / (32 * this.zoom), vh = this.height / (32 * this.zoom);
        const topLeft = worldToMinimap({ x: this.camera.x - vw / 2, y: this.camera.y - vh / 2 }, projection);
        const bottomRight = worldToMinimap({ x: this.camera.x + vw / 2, y: this.camera.y + vh / 2 }, projection);
        const x = Math.max(projection.x + .5, topLeft.x), y = Math.max(projection.y + .5, topLeft.y);
        const right = Math.min(projection.x + projection.width - .5, bottomRight.x), bottom = Math.min(projection.y + projection.height - .5, bottomRight.y);
        c.strokeStyle = 'rgba(255,253,220,.9)'; c.lineWidth = 1;
        if (right > x && bottom > y) c.strokeRect(x, y, right - x, bottom - y);
        c.restore();
    }
}
