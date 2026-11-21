import { FIELD_CANNON_FRAME, fieldCannonPose } from './field-cannon-art';
import { barbarianGalleyImage,BARBARIAN_GALLEY_BOUNDS } from './barbarian-galley-art';
import { merchantShipImage, merchantShipFrame, MERCHANT_SHIP_BOUNDS, MERCHANT_SHIP_PIVOT } from './merchant-ship-art';
import { drawWarshipBase, drawWarshipMount, warshipFrame, sinkingFrame, sinkingImage, WARSHIP_BOUNDS, deckPoint } from './warship-art';
import { warshipGunPoint } from './warship-layout';
import type { ShipSinking } from './types';
import { pavedRoadArtRevision } from './paved-road-art';
import { handcartPose, handcartSheet } from './handcart-art';
import { galleyScale } from './galley-footprint';
import { buildingDestructionImage } from './building-destruction-art';
import { silhouetteOutline } from './silhouette-outline';
import type { ResourceInteractionPatch } from './resource-interaction-highlight';
import { drawEngineerEquipment } from './leader-ability-art';
import { CanvasSource, ImageSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { buildingArtTop, buildingHeight, buildingWidth, type Building, type FarmField, type Tile, type Unit } from './types';
import { drawBuilding, drawOverlay, drawUnit, NO_CONNECTIONS, type Connections } from './sprites';
import { factionSheet, personFrame } from './unit-sprites';
import { refugeeFrame, refugeeImage, REFUGEE_BOUNDS } from './refugee-art';
import { auxiliaryArtKey } from './auxiliary-art';
import { drawLivestockOutline, livestockOutlineBounds, wildlifeFrame, wildlifeImage, wildlifeKind, wildlifePose } from './wildlife-art';
import { merchantFrame, merchantImage } from './merchant-art';
import { drawFarmField, orchardAppearance, wheatFrame, wheatTile } from './farm-art';
import { drawVegetation, vegetationArtBounds, vegetationVariant } from './vegetation-art';
import type { MarshRushPlacement } from './marsh-rush-placement';
import { nativeHouseTier } from './puny-building-art';
import { nativeHouseVariant } from './house-variant-art';
import type { TowerWallKind } from './wall-towers';
import type { FordAxis } from './ford-art';
import { punyWorldImage } from './puny-world';
import { drawPalm } from './palm-art';
import { armorVisualLevel } from './armor-art';
import { horsemanBounds, horsemanPose, horsemanSheet } from './cavalry-art';
import { ballistaFrame, spearmanBounds, spearmanPose, spearmanSheet } from './siege-art';
import { cannonFrame, drawCannon } from './cannon-art';
import { cannonFireStamp, CANNON_FIRE_FRAME_SIZE, gunSmokeFrame } from './cannon-fire-art';
import { shellImpactImage, SHELL_IMPACT_FRAME_SIZE, SHELL_IMPACT_BOUNDS } from './shell-impact-art';
import { FOUNTAIN_ART_BOUNDS, FOUNTAIN_FRAME_SIZE, fountainFrame, fountainSheet, thermalBathFrame } from './civic-art';
import { dockArtBounds, dockConstructionBounds, rowboatFrame, drawRowboat, rowboatOccupant, warshipAnchorMarker } from './naval-art';
import { galleyPose, galleyHullImage, galleyRigImage, galleyAttachmentOffset, drawGalleyHull, drawGalleyRig, drawGalleyPassenger, GALLEY_ART_BOUNDS, GALLEY_PIVOT, TRADING_BOAT_SCALE } from './galley-art';
import { trailArtVariant } from './road-sprites';
import { drawResourceObject, drawResourceFence, resourceObjectBounds, resourceObjectKey, type FenceArt, type ResourceCellArt } from './resource-art';
import { damageMaskSheet, deathAnimationFrame, deathAnimationImage, decayAnimationImage, DEATH_FRAME_SIZE, DEATH_GROUND_ANCHOR,
    DEATH_FALL_FRAME_DURATIONS_MS, DECAY_FRAME_SIZE, DECAY_GROUND_ANCHOR } from './combat-effect-art';
import { MUSKETMAN_BOUNDS, musketmanPose, musketmanSheet, musketmanDeathPose } from './musketman-art';
import { PIKEMAN_BOUNDS, pikemanPose, pikemanSheet } from './pikeman-art';
import { BRIGAND_BOUNDS, brigandPose, brigandSheet, brigandDeathPose, usesBrigandArt } from './brigand-art';
import { MEADOW_SPRITES, meadowImage, type MeadowVariant } from './meadow-art';
import { FERTILITY_GRASS_CELL, FERTILITY_GRASS_VARIANTS, fertilityGrassImage } from './fertility-grass-art';
import type { RockPalette } from './rock-range-art';

export interface ArtBounds { x: number; y: number; width: number; height: number }
export interface BakedArt extends ArtBounds { texture: Texture; overlays?: BakedArt[]; rotation?: number; rotationPivot?: { x: number; y: number } }
interface Atlas { source: CanvasSource; context: CanvasRenderingContext2D; x: number; y: number; row: number; used: number; dirty: boolean; keys: string[]; resolution: number }
/** Frames an unused atlas page stays resident. Animation cycles revisit their
 * pages within a second or two; evicting them sooner re-rasterizes every loop. */
const ATLAS_RETENTION_FRAMES = 600;
/** Native 16-pixel tiles baked at half resolution occupy one texel per art pixel. */
export const NATIVE_TILE_RESOLUTION = .5;
interface CachedArt { art: BakedArt; atlas: Atlas }
const effectSheet = (image: HTMLImageElement | HTMLCanvasElement, mask = false) => mask ? damageMaskSheet(image) : image;
export const connectionsKey = (links?: Connections): number => links ?
    ['north', 'east', 'south', 'west', 'northeast', 'southeast', 'southwest', 'northwest']
        .reduce((mask, side, bit) => mask | Number(!!links[side as keyof Connections]) << bit, 0) : 0;

/** Keys describe pixels, not entity identity: every matching animation frame shares an atlas slot. */
export function unitKey(unit: Unit, time: number, color: string, passenger?: Unit, firearm = false): string {
    if (unit.kind === 'fieldCannon') return `field-cannon:${fieldCannonPose(unit, time).key}:${unit.facing}:${!!unit.inside}`;
    if (unit.aboardRowboat) return `rowboat:${rowboatFrame(unit)}:${unitKey(rowboatOccupant(unit),0,color,undefined,firearm)}:${!!unit.inside}`;
    if (usesBrigandArt(unit)) return `brigand:${!!unit.marauderLeader}:${brigandPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'levyInfantry' || unit.kind === 'skirmisher' || unit.kind === 'supplyCart') return auxiliaryArtKey(unit, time, color);
    if (unit.warship) return `warship:${unit.warship.class}:${warshipFrame(unit, time)}:${color}`;
    if(unit.barbarianGalley)return `barbarian-galley:${unit.facing}:${color}:${passenger?unitKey({...passenger,inside:false,moving:false,aboardRowboat:false},time,color,undefined,firearm):'empty'}`;
    if (unit.kind === 'sailboat') return `galley:${unit.seaInvasion !== undefined}:${galleyPose(unit, time).row}:${galleyPose(unit, time).frame}:${passenger ? `${personFrame({ ...passenger, facing: unit.facing, moving: false, attackTime: 0 }, 0, firearm).row}:${firearm}:${color}:${armorVisualLevel(passenger.armorLevel)}` : 'empty'}`;
    if (unit.aboardRiverTrade) return `trade-boat:${galleyPose(unit, time).row}:${galleyPose(unit, time).frame}`;
    if ((unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight')) return `${unit.kind}:${horsemanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'musketman') return `musketman:${musketmanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'pikeman') return `pikeman:${pikemanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'spearman') return `spearman:${spearmanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    const animal = wildlifeKind(unit);
    if (animal) { const { row, frame } = wildlifeFrame(unit, time); return `${animal}:${row}:${frame}`; }
    if (unit.kind === 'merchant') { const { row, column } = merchantFrame(unit, time); return `merchant:${row}:${column}:${!!unit.inside}`; }
    if (unit.explorationRefugee) return `refugee:${refugeeFrame(unit, time).join(':')}:${!!unit.inside}`;
    if (!['leader', 'warrior', 'swordsman', 'archer', 'scout', 'militia', 'levyInfantry', 'skirmisher', 'slinger', 'worker'].includes(unit.kind)) return `empty:${unit.kind}`;
    const { role, row, frame } = personFrame(unit, time, firearm);
    return `person:${role}:${row}:${frame}:${color}:${armorVisualLevel(unit.armorLevel)}:${(unit.cargo ?? 0) > 0}:${!!unit.inside}:${!!unit.engineer}`;
}

/** Kinds whose picture changes with the animation clock once built. */
export const ANIMATED_BUILDING_KINDS: ReadonlySet<Building['kind']> = new Set(['observationPost', 'ballista', 'siegeCannon', 'library', 'thermalBath', 'irrigation', 'fountain']);

export function buildingKey(b: Building, time: number, color: string, links = NO_CONNECTIONS, gate?: Connections, attached = false, towerWall?: TowerWallKind,
    minePalette: RockPalette = 'temperate'): string {
    if (b.construction && b.kind !== 'well' && b.kind !== 'road') return `construction:${buildingWidth(b)}:${buildingHeight(b)}${b.kind === 'dock' ? `:dock:${b.dockFacing ?? 2}` : ''}`;
    if (b.kind === 'fountain') return `fountain:${fountainFrame(time)}`;
    if (b.kind === 'goldMine') return `gold-mine:${b.faction >= 0}:${minePalette}`;
    const phase = b.kind === 'observationPost' ? Math.floor(time * 4) % 2 : b.kind === 'ballista' ? Object.values(ballistaFrame(b, time)).join(':')
        : b.kind === 'siegeCannon' ? Object.values(cannonFrame(b, time)).join(':')
        : b.kind === 'library' ? Math.floor(time * 5) % 4 : b.kind === 'thermalBath' ? thermalBathFrame(time) : b.kind === 'irrigation' ? Math.floor(time * 3) % 4 : 0;
    if (b.kind === 'palace') return `palace:${color}:${b.palaceLevel ?? 1}:${b.settlementTier ?? 0}`;
    return `building:${b.kind}:${b.fort?.destroyed ?? false}:${color}:${nativeHouseTier(b)}:${connectionsKey(links)}:${!!gate}:${connectionsKey(gate)}:${attached}:${phase}${b.kind === 'fort' ? `:${b.fortLevel ?? 1}` : b.kind === 'woodenTower' ? `:${towerWall ?? 'none'}` : b.kind === 'house' ? `:${nativeHouseVariant(b) ?? 'original'}` : b.kind === 'road' ? `:${Number(!!b.roadPaved)}:${links.pavedEnds ?? 0}:${pavedRoadArtRevision()}:${b.roadStyle ?? 'road'}${b.roadStyle === 'trail' ? `:${trailArtVariant(b.x, b.y)}` : ''}` : b.kind === 'dock' ? `:${b.dockFacing ?? 2}` : ''}`;
}

export function fieldKey(field: FarmField, time: number, joins = 0): string {
    const orchard = field.orchard && orchardAppearance(field, time);
    return orchard ? `orchard:${field.camp & 1}:${orchard.mature}:${orchard.fruit}`
        : `wheat:${wheatFrame(field, time)}:${joins}`;
}

/** Offscreen art baking only. World composition uses native Pixi sprites. Small
 * pictures share atlas sources so hundreds of figures still batch together. */
export class NativeArt {
    private cache = new Map<string, CachedArt>();
    private meadowFrames = new Map<MeadowVariant, BakedArt[]>();
    private fertilityGrassFrames: BakedArt[] = [];
    private resourcePatchDescriptions = new WeakMap<ResourceInteractionPatch, { key: string; bounds: ArtBounds; cells: ResourceInteractionPatch['cells'] }>();
    private atlases: Atlas[] = [];
    private images = new Map<HTMLImageElement | HTMLCanvasElement, { source: TextureSource; frames: Map<string, BakedArt> }>();
    private frame = 0;
    readonly stats = { rasterized: 0, rasterCacheHits: 0, textureUploads: 0 };
    constructor(readonly resolution = 4) {}
    beginFrame(): void { this.frame++; this.stats.rasterized = this.stats.rasterCacheHits = this.stats.textureUploads = 0; }
    get atlasPages(): number { return this.atlases.length; }

    /** CanvasSource.update uploads immediately once resident on the GPU. Wait
     * until all art is baked so later writes in this frame cannot stay blank. */
    flush(): void {
        for (const atlas of this.atlases) if (atlas.dirty) {
            atlas.source.update(); atlas.dirty = false; this.stats.textureUploads++;
        }
    }

    /** `resolution` selects the atlas density for this picture alone. Art copied
     * from native pixel sheets needs no more texels than its source has. */
    paint(key: string, bounds: ArtBounds, draw: (c: CanvasRenderingContext2D) => void, resolution = this.resolution): BakedArt {
        const existing = this.cache.get(key);
        if (existing) { existing.atlas.used = this.frame; this.stats.rasterCacheHits++; return existing.art; }
        const r = resolution, width = Math.ceil(bounds.width * r), height = Math.ceil(bounds.height * r), padding = 2;
        let atlas: Atlas | undefined;
        for (let index = this.atlases.length - 1; index >= 0; index--)
            if (this.atlases[index].resolution === r) { atlas = this.atlases[index]; break; }
        if (atlas && atlas.x + width + padding > atlas.source.pixelWidth) { atlas.x = padding; atlas.y += atlas.row + padding; atlas.row = 0; }
        if (!atlas || atlas.y + height + padding > atlas.source.pixelHeight || width + padding * 2 > atlas.source.pixelWidth) {
            const edge = r < 1 ? 1024 : 2048;
            const canvas = document.createElement('canvas'); canvas.width = Math.max(edge, width + padding * 2); canvas.height = Math.max(edge, height + padding * 2);
            const source = new CanvasSource({ resource: canvas, resolution: r, scaleMode: 'nearest' });
            atlas = { source, context: canvas.getContext('2d')!, x: padding, y: padding, row: 0, used: this.frame, dirty: false, keys: [], resolution: r };
            this.atlases.push(atlas);
        }
        const c = atlas.context, x = atlas.x, y = atlas.y;
        c.save(); c.beginPath(); c.rect(x, y, width, height); c.clip();
        c.setTransform(r, 0, 0, r, x - bounds.x * r, y - bounds.y * r); c.imageSmoothingEnabled = false;
        draw(c); c.restore();
        atlas.dirty = true;
        atlas.used = this.frame; atlas.keys.push(key);
        atlas.x += width + padding; atlas.row = Math.max(atlas.row, height);
        const art = { ...bounds, texture: new Texture({ source: atlas.source, frame: new Rectangle(x / r, y / r, width / r, height / r) }) };
        this.cache.set(key, { art, atlas }); this.stats.rasterized++;
        return art;
    }
    get(key: string, bounds: ArtBounds, draw: (c: CanvasRenderingContext2D) => void): BakedArt { return this.paint(key, bounds, draw); }


    tradingBoat(boat: Pick<Unit, 'facing' | 'moving'>, time: number, mask = false): BakedArt {
        const pose = galleyPose(boat, time), size = TRADING_BOAT_SCALE;
        const bounds = { x: 16 - 32 * size, y: 16 - 32 * size, width: 64 * size, height: 64 * size };
        const hullSheet = galleyHullImage(), rigSheet = galleyRigImage();
        const hull = hullSheet ? this.image(effectSheet(hullSheet, mask), pose.rect, GALLEY_ART_BOUNDS)
            : this.paint('trade-boat:empty', GALLEY_ART_BOUNDS, () => {});
        const rig = rigSheet ? this.image(effectSheet(rigSheet, mask), [0, pose.row * 32, 32, 32], GALLEY_ART_BOUNDS)
            : this.paint('trade-boat:empty', GALLEY_ART_BOUNDS, () => {});
        const offset = galleyAttachmentOffset(boat, 'rig');
        return { ...hull, ...bounds, rotation: pose.rotation, rotationPivot: GALLEY_PIVOT,
            overlays: [{ ...rig, ...bounds, x: bounds.x + offset.x * size, y: bounds.y + offset.y * size }] };
    }

    merchantShip(ship: Pick<Unit, 'facing' | 'moving'>, time: number): BakedArt {
        const image = merchantShipImage();
        if (!image) return this.tradingBoat(ship, time);
        const hull = this.image(image, [merchantShipFrame(ship, time) * 16, 0, 16, 32], MERCHANT_SHIP_BOUNDS);
        return { ...hull, rotation: ship.facing + Math.PI / 2, rotationPivot: MERCHANT_SHIP_PIVOT };
    }

    shipSinking(effect: ShipSinking, time: number, color: string): BakedArt | undefined {
        const image = sinkingImage(effect, color); if (!image) return;
        const frame = sinkingFrame(effect, time);
        return { ...this.image(image, [frame * 48, 0, 48, 80], WARSHIP_BOUNDS), rotation: effect.facing + Math.PI / 2, rotationPivot: { x: 16, y: 16 } };
    }

    warshipAnchor(): BakedArt | undefined {
        const marker = warshipAnchorMarker();
        return marker && this.image(marker, [0, 0, 16, 16], { x: -8, y: -8, width: 16, height: 16 });
    }

    gunSmoke(variant: number): BakedArt | undefined {
        const frame = gunSmokeFrame(variant);
        return frame && this.image(frame.image, frame.rect, { x: -16, y: -16, width: 32, height: 32 });
    }

    private cannonFire(shotAt: number | undefined, time: number, facing: number, centerX: number, centerY: number,
        size: number, muzzleDistance: number): BakedArt | undefined {
        const stamp = cannonFireStamp(shotAt, time, facing, centerX, centerY, size, muzzleDistance);
        if (!stamp) return;
        return { ...this.image(stamp.image, [stamp.frame * CANNON_FIRE_FRAME_SIZE, 0, CANNON_FIRE_FRAME_SIZE, CANNON_FIRE_FRAME_SIZE], stamp.bounds),
            ...stamp.bounds, rotation: stamp.rotation, rotationPivot: stamp.rotationPivot };
    }

    unit(unit: Unit, time: number, color: string, effect?: { damageMask?: boolean; passenger?: Unit; firearm?: boolean }): BakedArt {
        if (unit.aboardRiverTrade && !unit.inside) return this.tradingBoat(unit, time, effect?.damageMask);
        if (unit.aboardRowboat) {
          const hull=this.paint(`rowboat:${rowboatFrame(unit)}:${!!unit.inside}:${!!effect?.damageMask}`,
            { x: 0, y: 0, width: 32, height: 32 }, c => {
                if (!unit.inside) drawRowboat(c, unit, 0, 0, 32);
                if (effect?.damageMask) { c.globalCompositeOperation = 'source-in'; c.fillStyle = '#de3830'; c.fillRect(0, 0, 32, 32); }
            });
          if(unit.inside)return hull;
          const person=this.unit(rowboatOccupant(unit),0,color,effect);
          return {...hull,overlays:[{...person,x:16+(person.x-16)*.6,y:15.36+(person.y-27.2)*.6,width:person.width*.6,height:person.height*.6}]};
        }
        if (!unit.inside) {
            if (unit.kind === 'fieldCannon') {
                const pose = fieldCannonPose(unit, time);
                if (pose.image) {
                    const body = { ...this.image(effectSheet(pose.image, effect?.damageMask), [pose.frame * FIELD_CANNON_FRAME, 0, FIELD_CANNON_FRAME, FIELD_CANNON_FRAME], { x: 0, y: 0, width: 32, height: 32 }), rotation: unit.facing + Math.PI / 2, rotationPivot: { x: 16, y: 16 } };
                    const fire = !effect?.damageMask && this.cannonFire(unit.fieldCannon?.shotAt, time, unit.facing, 16, 16, 32, 14);
                    return fire ? { ...body, overlays: [fire] } : body;
                }
            }
            if (usesBrigandArt(unit)) {
                const sheet = brigandSheet(color, !!unit.marauderLeader), pose = brigandPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), pose.rect, { ...BRIGAND_BOUNDS });
            }
            if (unit.warship) {
                const w = unit.warship, mask = effect?.damageMask;
                const hull = this.paint(`${unitKey(unit, time, color)}:${!!mask}`, WARSHIP_BOUNDS, c => {
                    drawWarshipBase(c, unit, color, time, false);
                    if (mask) { c.globalCompositeOperation = 'source-in'; c.fillStyle = '#de3830'; c.fillRect(-32, -64, 96, 160); }
                });
                const overlays: BakedArt[] = [];
                for (let slot = 0; slot < (w.class === 'warGalley' ? 2 : w.class === 'caravel' ? 3 : 4); slot++) {
                    const kind = w.weapons[slot] ?? 'empty'; if (kind === 'empty') continue;
                    const gun = w.guns?.[slot], facing = gun?.facing ?? unit.facing;
                    const pose = { siegeFacing: facing, siegeShotAt: gun?.firedAt };
                    const cannon = cannonFrame(pose, time);
                    const phase = kind === 'ballista' ? Object.values(ballistaFrame(pose, time)).join(':') : `${cannon.direction}:${cannon.recoil}`;
                    const mount = this.paint(`naval-mount:${kind}:${phase}`, { x: -12, y: -12, width: 24, height: 24 }, c => drawWarshipMount(c, kind, facing, time, gun?.firedAt, false));
                    const p = warshipGunPoint(unit, slot);
                    overlays.push({ ...mount, x: 16 + (p.x-unit.x)*32 - 12, y: 16 + (p.y-unit.y)*32 - 12 });
                    const fire = kind === 'cannon' && !mask && this.cannonFire(gun?.firedAt, time, facing,
                        16 + (p.x-unit.x)*32, 16 + (p.y-unit.y)*32, 24, 9);
                    if (fire) overlays.push(fire);
                }
                const addPerson = (person: Unit, side: number, forward: number, size = .8, slot?: number): void => {
                    const p = deckPoint(unit, side, forward);
                    const art = this.unit({ ...person, warship: undefined, inside: false, aboardRowboat: false, aboardRiverTrade: false,
                        moving: false, facing: slot === undefined ? unit.facing : w.guns?.[slot]?.facing ?? unit.facing,
                        attackTime: slot === undefined ? 0 : Math.max(0, .28 - (time - (w.guns?.[slot]?.firedAt ?? -1000))) }, time, color, { damageMask: mask, firearm: effect?.firearm });
                    overlays.push({ ...art, x: 16 + p.x * 32 + (art.x - 16) * size,
                        y: 16 + p.y * 32 + (art.y - 27.2) * size, width: art.width * size, height: art.height * size });
                };
                for (let i = 0; i < Math.ceil(w.crewHp / 100); i++) addPerson({ ...unit, kind: w.marine }, i % 2 ? .65 : -.65, (Math.floor(i / 2) - 1.5) * .7, .8, 4+i);
                if (effect?.passenger) addPerson(effect.passenger, 0, -1.55, .9);
                return { ...hull, rotation: unit.facing + Math.PI / 2, rotationPivot: { x: 16, y: 16 }, overlays };
            }
            if(unit.barbarianGalley) {
                const image=barbarianGalleyImage();
                if(image) {
                    const hull=this.image(effectSheet(image,effect?.damageMask),[0,0,16,32],BARBARIAN_GALLEY_BOUNDS),overlays:BakedArt[]=[];
                    if(effect?.passenger){const person=this.unit({...effect.passenger,inside:false,aboardRowboat:false,moving:false,
                        attackTime:Math.max(0,.28-(time-(unit.barbarianGalley.firedAt??-1000)))},time,color,{damageMask:effect?.damageMask,firearm:effect?.firearm});
                        overlays.push({...person,x:16+(person.x-16)*.7,y:15.84+(person.y-27.2)*.7,width:person.width*.7,height:person.height*.7});}
                    return {...hull,rotation:unit.facing+Math.PI/2,rotationPivot:{x:16,y:16},overlays};
                }
            }
            if (unit.kind === 'sailboat') {
                const pose = galleyPose(unit, time), mask = effect?.damageMask;
                const size = galleyScale(unit), bounds = { x: 16 - 32 * size, y: 16 - 32 * size, width: 64 * size, height: 64 * size };
                const hullSheet = galleyHullImage(unit), rigSheet = galleyRigImage(unit.seaInvasion !== undefined);
                const hull = hullSheet ? this.image(effectSheet(hullSheet, mask), pose.rect, GALLEY_ART_BOUNDS)
                    : this.paint(`galley:hull:${pose.row}:${pose.frame}`, GALLEY_ART_BOUNDS,
                        c => drawGalleyHull(c, { ...unit, facing: pose.heading }, 0, 0, 32, time));
                const rig = rigSheet ? this.image(effectSheet(rigSheet, mask), [0, pose.row * 32, 32, 32], GALLEY_ART_BOUNDS)
                    : this.paint(`galley:rig:${pose.row}:${unit.seaInvasion !== undefined}`, GALLEY_ART_BOUNDS,
                        c => drawGalleyRig(c, { facing: pose.heading, seaInvasion: unit.seaInvasion }, 0, 0, 32));
                const overlays: BakedArt[] = [], passenger = effect?.passenger;
                if (passenger) {
                    const row = personFrame({ ...passenger, facing: unit.facing, moving: false, attackTime: 0 }, 0, effect?.firearm).row;
                    const person = this.paint(`galley:captain:${size}:${pose.row}:${row}:${!!effect?.firearm}:${color}:${armorVisualLevel(passenger.armorLevel)}:${!!mask}`,
                        { x: -16, y: -40, width: 64, height: 104 }, c => {
                            drawGalleyPassenger(c, unit, passenger, 0, 0, 32, color, false, effect?.firearm);
                            if (mask) { c.globalCompositeOperation = 'source-in'; c.fillStyle = '#de3830'; c.fillRect(-16, -40, 64, 104); }
                        });
                    const offset = galleyAttachmentOffset(unit, 'captain');
                    overlays.push({ ...person, x: person.x + offset.x * size, y: person.y + offset.y * size });
                }
                const offset = galleyAttachmentOffset(unit, 'rig');
                overlays.push({ ...rig, ...bounds, x: bounds.x + offset.x * size, y: bounds.y + offset.y * size });
                return { ...hull, ...bounds, rotation: pose.rotation, rotationPivot: GALLEY_PIVOT, overlays };
            }
            if ((unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight')) {
                const sheet = horsemanSheet(color, unit.kind), pose = horsemanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], horsemanBounds(pose));
            }
            if (unit.kind === 'supplyCart') {
                const sheet = handcartSheet(color), pose = handcartPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), pose.rect, pose.bounds);
            }
            if (unit.kind === 'musketman') {
                const sheet = musketmanSheet(color), pose = musketmanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], { ...MUSKETMAN_BOUNDS });
            }
            if (unit.kind === 'pikeman') {
                const sheet = pikemanSheet(color), pose = pikemanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], { ...PIKEMAN_BOUNDS });
            }
            if (unit.kind === 'spearman') {
                const sheet = spearmanSheet(color), pose = spearmanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], spearmanBounds(pose));
            }
            const animal = wildlifeKind(unit), sheet = animal && wildlifeImage(animal);
            if (sheet) {
                const { rect, bounds } = wildlifePose(unit, time);
                return this.image(effectSheet(sheet, effect?.damageMask), rect, bounds);
            }
            if (unit.kind === 'merchant' && !unit.aboardRiverTrade && merchantImage()) {
                const { row, column } = merchantFrame(unit, time);
                return this.image(effectSheet(merchantImage()!, effect?.damageMask), [column * 32, row * 32, 32, 32], { x: -8, y: -8, width: 48, height: 48 });
            }
            if (unit.explorationRefugee) {
                const sheet = refugeeImage();
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), refugeeFrame(unit, time), REFUGEE_BOUNDS);
            }
            if (['leader', 'warrior', 'swordsman', 'archer', 'scout', 'militia', 'levyInfantry', 'skirmisher', 'slinger', 'worker'].includes(unit.kind)) {
                const { role, row, frame } = personFrame(unit, time, effect?.firearm), sheet = factionSheet(role, color, unit.armorLevel);
                if (sheet) {
                    const art = this.image(effectSheet(sheet, effect?.damageMask), [frame * 32, row * 32, 32, 32], { x: -6.4, y: -4.44, width: 44.8, height: 44.8 });
                    if (unit.engineer) return { ...art, overlays: [this.paint(`engineer:${row}:${unit.attackTime > 0}`, { x: 0, y: 0, width: 32, height: 32 }, c => drawEngineerEquipment(c, unit.facing, unit.attackTime > 0))] };
                    const cargo = punyWorldImage();
                    return (unit.cargo ?? 0) > 0 && cargo ? { ...art, overlays: [this.image(effectSheet(cargo, effect?.damageMask), [146, 501, 12, 10],
                        { x: 12.5, y: 17.26, width: 9.8, height: 8.4 })] } : art;
                }
            }
        }
        return this.paint(unitKey(unit, time, color, effect?.passenger, effect?.firearm), { x: -8, y: -8, width: 50, height: 50 }, c => drawUnit(c, unit, 0, 0, 32, time, color, effect?.passenger, effect?.firearm));
    }
    /** Shared sheet frames at native scale, aligned to the same 16,27.2 foot anchor as people. */
    death(age: number, unit?: Unit, color?: string): BakedArt | undefined {
        const brigand = !!unit && usesBrigandArt(unit);
        const authoredFall = !!unit && (unit.kind === 'musketman' || brigand) && age >= 0;
        if (authoredFall && age < .8) {
            const sheet = brigand ? brigandSheet(color ?? '#ad8c57', !!unit.marauderLeader) : musketmanSheet(color ?? '#f34f59');
            if (sheet) return this.image(sheet, brigand ? brigandDeathPose(unit, age).rect : musketmanDeathPose(unit, age).rect,
                { ...(brigand ? BRIGAND_BOUNDS : MUSKETMAN_BOUNDS) });
        }
        const sharedFallSeconds = DEATH_FALL_FRAME_DURATIONS_MS.reduce((sum, ms) => sum + ms, 0) / 1000;
        const frame = deathAnimationFrame(authoredFall ? age - .8 + sharedFallSeconds : age);
        if (frame < 0) return undefined;
        const decay = frame >= DEATH_FALL_FRAME_DURATIONS_MS.length;
        const image = decay ? decayAnimationImage() : deathAnimationImage();
        const size = decay ? DECAY_FRAME_SIZE : DEATH_FRAME_SIZE;
        const anchor = decay ? DECAY_GROUND_ANCHOR : DEATH_GROUND_ANCHOR;
        const column = decay ? frame - DEATH_FALL_FRAME_DURATIONS_MS.length : frame;
        return image && this.image(image, [column * size, 0, size, size],
            { x: 16 - anchor[0], y: 27.2 - anchor[1], width: size, height: size });
    }
    buildingDestruction(size: 1 | 2, frame: number, rubble: boolean): BakedArt | undefined {
        const image = buildingDestructionImage(size, rubble), pixels = size * 16;
        return image && this.image(image, [frame * pixels, 0, pixels, pixels],
            { x: 0, y: 0, width: pixels * 2, height: pixels * 2 });
    }
    shellImpact(frame: number): BakedArt | undefined {
        const image = shellImpactImage();
        return image && this.image(image, [frame * SHELL_IMPACT_FRAME_SIZE, 0, SHELL_IMPACT_FRAME_SIZE, SHELL_IMPACT_FRAME_SIZE], SHELL_IMPACT_BOUNDS);
    }
    private image(image: HTMLImageElement | HTMLCanvasElement, rect: [number, number, number, number], bounds: ArtBounds): BakedArt {
        let entry = this.images.get(image);
        if (!entry) {
            const source = image instanceof HTMLCanvasElement ? new CanvasSource({ resource: image, resolution: 1, scaleMode: 'nearest' })
                : new ImageSource({ resource: image, scaleMode: 'nearest' });
            entry = { source, frames: new Map() }; this.images.set(image, entry); this.stats.textureUploads++;
        }
        const key = rect.join(':'); let art = entry.frames.get(key);
        if (!art) { art = { ...bounds, texture: new Texture({ source: entry.source, frame: new Rectangle(...rect) }) }; entry.frames.set(key, art); }
        else this.stats.rasterCacheHits++;
        return art;
    }
    /** `key`, when supplied, must describe the same art as the remaining arguments. */
    building(b: Building, time: number, color: string, links = NO_CONNECTIONS, gate?: Connections, attached = false, towerWall?: TowerWallKind,
        key?: string, minePalette?: RockPalette): BakedArt {
        if (b.kind === 'fountain' && !b.construction) {
            const sheet = fountainSheet();
            const size = FOUNTAIN_FRAME_SIZE;
            if (sheet) return this.image(sheet, [fountainFrame(time) * size, 0, size, size], FOUNTAIN_ART_BOUNDS);
        }
        if (b.kind === 'siegeCannon' && !b.construction) {
            const pose = cannonFrame(b, time);
            const body = this.paint(`siege-cannon-body:${pose.direction}:${pose.recoil}`,
                { x: -2, y: -2, width: 36, height: 36 }, c => drawCannon(c, b, 0, 0, 32, time, false));
            const fire = this.cannonFire(b.siegeShotAt, time, b.siegeFacing ?? -Math.PI / 2, 16, 16, 32, 12);
            return fire ? { ...body, overlays: [fire] } : body;
        }
        if (b.kind === 'dock') return this.paint(buildingKey(b, time, color), b.construction ? dockConstructionBounds(b) : dockArtBounds(b),
            c => drawBuilding(c, b, 0, 0, 32, time, color));
        const x = attached && b.kind === 'well' ? -12 : 0, y = buildingArtTop(b) * 32;
        const bottom = buildingHeight(b) * 32;
        return this.paint(key ?? buildingKey(b, time, color, links, gate, attached, towerWall, minePalette),
            { x, y, width: buildingWidth(b) * 32 - x, height: bottom - y + (attached && b.kind === 'well' ? 8 : 0) },
            c => drawBuilding(c, b, 0, 0, 32, time, color, links, gate, attached, towerWall, minePalette),
            b.kind === 'palace' && !b.construction ? NATIVE_TILE_RESOLUTION : undefined);
    }
    vegetation(tile: Tile, rush?: MarshRushPlacement): BakedArt {
        const source = vegetationVariant(tile, rush);
        const shoots = rush && (rush.left || rush.right) ? `:${Number(rush.left)}:${Number(rush.right)}:${rush.shootVariant}` : '';
        return this.paint(`vegetation:${source?.sheet}:${source?.x}:${source?.y}${shoots}`, vegetationArtBounds(tile, 32, rush, source),
            c => drawVegetation(c, tile, 0, 0, 32, rush), source?.sheet === 'rushes' ? .5 : undefined);
    }
    fertilityGrass(density: NonNullable<Tile['fertilityGrass']>, variation: number): BakedArt | undefined {
        const column = Math.min(FERTILITY_GRASS_VARIANTS - 1, Math.floor(variation * FERTILITY_GRASS_VARIANTS));
        const row = density - 1, frame = row * FERTILITY_GRASS_VARIANTS + column;
        const cached = this.fertilityGrassFrames[frame];
        if (cached) return cached;
        const image = fertilityGrassImage(), size = FERTILITY_GRASS_CELL;
        if (!image) return undefined;
        return this.fertilityGrassFrames[frame] = this.image(image, [column * size, row * size, size, size],
            { x: 0, y: 0, width: size * 2, height: size * 2 });
    }
    /** Every tuft of one pose shares its sheet texture and fixed native bounds. */
    meadow(variant: MeadowVariant, frame: number): BakedArt | undefined {
        let frames = this.meadowFrames.get(variant);
        const cached = frames?.[frame];
        if (cached) return cached;
        const image = meadowImage(variant);
        if (!image) return undefined;
        if (!frames) { frames = []; this.meadowFrames.set(variant, frames); }
        const spec = MEADOW_SPRITES[variant];
        return frames[frame] = this.image(image, [frame * spec.frameWidth, spec.row * 16, spec.frameWidth, 16],
            { x: -16, y: -32 * spec.anchorY, width: 32, height: 32 });
    }
    resource(resource: ResourceCellArt): BakedArt {
        return this.paint(`resource:${resourceObjectKey(resource)}`, resourceObjectBounds(resource),
            c => drawResourceObject(c, resource));
    }
    resourcePatchOutline(patch: ResourceInteractionPatch, color: string): BakedArt {
        const padding = 6;
        let description = this.resourcePatchDescriptions.get(patch);
        if (!description) {
            const anchors = new Set<number>();
            const cells = patch.cells.filter(({ art }) => {
                if (!art.ore) return true;
                if (anchors.has(art.ore.anchor)) return false;
                anchors.add(art.ore.anchor); return true;
            });
            let left = 0, top = 0, right = 0, bottom = 0;
            const key = cells.map(({ x, y, art }) => {
                const bounds = resourceObjectBounds(art), px = ((art.ore?.x ?? x) - patch.x) * 32, py = ((art.ore?.y ?? y) - patch.y) * 32;
                left = Math.min(left, px + bounds.x); top = Math.min(top, py + bounds.y);
                right = Math.max(right, px + bounds.x + bounds.width); bottom = Math.max(bottom, py + bounds.y + bounds.height);
                return `${x - patch.x},${y - patch.y}:${resourceObjectKey(art)}`;
            }).join(';');
            description = { key, bounds: { x: left, y: top, width: right - left, height: bottom - top }, cells };
            this.resourcePatchDescriptions.set(patch, description);
        }
        const { key, bounds, cells } = description, left = bounds.x, top = bounds.y;
        return this.paint(`resource-patch-outline:${key}:${color}`,
            { x: left - padding, y: top - padding, width: bounds.width + 2 * padding, height: bounds.height + 2 * padding }, c => {
                const sprite = document.createElement('canvas');
                sprite.width = bounds.width + 2 * padding; sprite.height = bounds.height + 2 * padding;
                const mask = sprite.getContext('2d')!;
                for (const { x, y, art } of cells) {
                    const px = ((art.ore?.x ?? x) - patch.x) * 32 + padding - left, py = ((art.ore?.y ?? y) - patch.y) * 32 + padding - top;
                    // Groves and salt beds contain gaps in their art. Their
                    // interaction boundary follows the joined patch footprint.
                    if (art.resource === 'salt' || art.resource === 'olives') mask.fillRect(px, py, 32, 32);
                    else drawResourceObject(mask, art, px, py, 32, true);
                }
                c.drawImage(silhouetteOutline(sprite, color), left - padding, top - padding);
            });
    }
    livestockOutline(unit: Unit, time: number): BakedArt {
        const { row, frame } = wildlifeFrame(unit, time);
        return this.paint(`livestock-outline:${unit.kind}:${row}:${frame}`,
            livestockOutlineBounds(unit), c => drawLivestockOutline(c, unit, time), NATIVE_TILE_RESOLUTION);
    }
    resourceFence(resource: FenceArt, front: boolean): BakedArt {
        return this.paint(`resource-fence:${resource.fences}:${resource.gate}:${front}`, { x: 0, y: -8, width: 32, height: 40 },
            c => drawResourceFence(c, resource, front));
    }
    field(field: FarmField, time: number, clipKey = '', clip?: (c: CanvasRenderingContext2D) => void, joins = 0): BakedArt {
        const bounds = { x: 0, y: 0, width: 32, height: 32 };
        if (!field.orchard && !clip) {
            const tile = wheatTile(wheatFrame(field, time), joins);
            if (tile) return this.image(tile.image, tile.rect, bounds);
        }
        return this.paint(`${fieldKey(field, time, joins)}:${clipKey}`, bounds,
            c => { clip?.(c); drawFarmField(c, 0, 0, 32, time, field, joins); },
            field.orchard ? this.resolution : NATIVE_TILE_RESOLUTION);
    }
    overlay(tile: Tile, axis: FordAxis = 'vertical'): BakedArt {
        if (tile.palm) return this.paint('palm', { x: 0, y: 0, width: 32, height: 32 }, c => drawPalm(c, 0, 0, 32));
        const variant = tile.overlay === 'ford' ? Math.min(5, Math.floor(tile.variation * 6)) : Math.floor(tile.variation * 65536);
        return this.paint(`overlay:${tile.overlay}:${axis}:${variant}`, { x: -2, y: -4, width: 40, height: 40 },
            c => drawOverlay(c, tile.overlay, 0, 0, 32, 0, tile.variation, axis));
    }

    /** Notify the caller before actual eviction so retained batches can detach. */
    prune(beforeEviction?: () => void): TextureSource[] {
        const retired: TextureSource[] = [];
        if (this.atlases.length <= 8) return retired;
        for (const atlas of [...this.atlases].sort((a, b) => a.used - b.used)) {
            if (this.atlases.length <= 8 || this.frame - atlas.used < ATLAS_RETENTION_FRAMES) break;
            // Retained scene batches must release their references before the
            // first actual eviction. A busy frame may legitimately use >8 pages.
            if (!retired.length) beforeEviction?.();
            this.atlases.splice(this.atlases.indexOf(atlas), 1);
            for (const key of atlas.keys) { this.cache.get(key)?.art.texture.destroy(); this.cache.delete(key); }
            retired.push(atlas.source);
        }
        return retired;
    }
    clear(): TextureSource[] {
        for (const { art } of this.cache.values()) art.texture.destroy();
        const sources: TextureSource[] = this.atlases.map(atlas => atlas.source);
        for (const { source, frames } of this.images.values()) { for (const art of frames.values()) art.texture.destroy(); sources.push(source); }
        this.images.clear(); this.meadowFrames.clear(); this.fertilityGrassFrames.length = 0;
        this.cache.clear(); this.atlases = []; return sources;
    }
    destroy(): void { for (const source of this.clear()) source.destroy(); }
}
