import { silhouetteOutline } from './silhouette-outline';
import { drawEngineerEquipment } from './leader-ability-art';
import { CanvasSource, ImageSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import { buildingArtTop, buildingHeight, buildingWidth, type Building, type FarmField, type Tile, type Unit } from './types';
import { drawBuilding, drawOverlay, drawUnit, NO_CONNECTIONS, type Connections } from './sprites';
import { factionSheet, personFrame } from './unit-sprites';
import { auxiliaryArtKey } from './auxiliary-art';
import { wildlifeFrame, wildlifeImage } from './wildlife-art';
import { merchantFrame, merchantImage } from './merchant-art';
import { drawFarmField, fieldStage, orchardAppearance } from './farm-art';
import { drawVegetation, vegetationArtBounds, vegetationVariant } from './vegetation-art';
import { nativeHouseTier } from './puny-building-art';
import { nativeHouseVariant } from './house-variant-art';
import type { FordAxis } from './ford-art';
import { punyWorldImage } from './puny-world';
import { palaceArtHeight } from './palace-sprite';
import { drawPalm } from './palm-art';
import { armorVisualLevel } from './armor-art';
import { horsemanBounds, horsemanPose, horsemanSheet } from './cavalry-art';
import { ballistaFrame, spearmanBounds, spearmanPose, spearmanSheet } from './siege-art';
import { dockArtBounds, dockConstructionBounds, sailboatMirrored } from './naval-art';
import { galleyPose, galleyHullImage, galleyRigImage, galleyAttachmentOffset, drawGalleyHull, drawGalleyRig, drawGalleyPassenger, GALLEY_ART_BOUNDS, GALLEY_PIVOT } from './galley-art';
import { trailArtVariant } from './road-sprites';
import { drawResourceObject, drawResourceFence, resourceObjectBounds, resourceObjectKey, type ResourceCellArt } from './resource-art';
import { damageMaskSheet, deathAnimationFrame, deathAnimationImage, decayAnimationImage, DEATH_FRAME_SIZE, DEATH_GROUND_ANCHOR,
    DEATH_FALL_FRAME_DURATIONS_MS, DECAY_FRAME_SIZE, DECAY_GROUND_ANCHOR } from './combat-effect-art';

export interface ArtBounds { x: number; y: number; width: number; height: number }
export interface BakedArt extends ArtBounds { texture: Texture; overlays?: BakedArt[]; rotation?: number; rotationPivot?: { x: number; y: number } }
interface Atlas { source: CanvasSource; context: CanvasRenderingContext2D; x: number; y: number; row: number; used: number; dirty: boolean; keys: string[] }
interface CachedArt { art: BakedArt; atlas: Atlas }
const effectSheet = (image: HTMLImageElement | HTMLCanvasElement, mask = false) => mask ? damageMaskSheet(image) : image;
export const connectionsKey = (links?: Connections): number => links ?
    ['north', 'east', 'south', 'west', 'northeast', 'southeast', 'southwest', 'northwest']
        .reduce((mask, side, bit) => mask | Number(!!links[side as keyof Connections]) << bit, 0) : 0;

/** Keys describe pixels, not entity identity: every matching animation frame shares an atlas slot. */
export function unitKey(unit: Unit, time: number, color: string, passenger?: Unit): string {
    if (unit.kind === 'levyInfantry' || unit.kind === 'skirmisher' || unit.kind === 'supplyCart') return auxiliaryArtKey(unit, time, color);
    if (unit.kind === 'sailboat') return `galley:${galleyPose(unit, time).row}:${galleyPose(unit, time).frame}:${passenger ? `${personFrame({ ...passenger, facing: unit.facing, moving: false, attackTime: 0 }, 0).row}:${color}:${armorVisualLevel(passenger.armorLevel)}` : 'empty'}`;
    if (unit.aboardRiverTrade) return `sailboat:${sailboatMirrored(unit)}`;
    if ((unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight')) return `${unit.kind}:${horsemanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'spearman') return `spearman:${spearmanPose(unit, time).rect.join(':')}:${color}:${!!unit.inside}`;
    if (unit.kind === 'boar' || unit.kind === 'marshBird') { const { row, frame } = wildlifeFrame(unit, time); return `${unit.kind}:${row}:${frame}`; }
    if (unit.kind === 'merchant') { const { row, column } = merchantFrame(unit, time); return `merchant:${row}:${column}:${!!unit.inside}`; }
    if (!['leader', 'warrior', 'swordsman', 'archer', 'scout', 'militia', 'levyInfantry', 'skirmisher', 'slinger', 'worker'].includes(unit.kind)) return `empty:${unit.kind}`;
    const { role, row, frame } = personFrame(unit, time);
    return `person:${role}:${row}:${frame}:${color}:${armorVisualLevel(unit.armorLevel)}:${(unit.cargo ?? 0) > 0}:${!!unit.inside}:${!!unit.engineer}`;
}

export function buildingKey(b: Building, time: number, color: string, links = NO_CONNECTIONS, gate?: Connections, attached = false): string {
    if (b.construction) return `construction:${buildingWidth(b)}:${buildingHeight(b)}:${attached && b.kind === 'well'}${b.kind === 'dock' ? `:dock:${b.dockFacing ?? 2}` : ''}`;
    const phase = b.kind === 'observationPost' ? Math.floor(time * 4) % 2 : b.kind === 'ballista' ? Object.values(ballistaFrame(b, time)).join(':')
        : b.kind === 'library' ? Math.floor(time * 5) % 4 : b.kind === 'irrigation' ? Math.floor(time * 3) % 4 : 0;
    return `building:${b.kind}:${b.fort?.destroyed ?? false}:${color}:${nativeHouseTier(b)}:${connectionsKey(links)}:${!!gate}:${connectionsKey(gate)}:${attached}:${phase}${b.kind === 'house' ? `:${nativeHouseVariant(b) ?? 'original'}` : b.kind === 'road' ? `:${b.roadStyle ?? 'road'}${b.roadStyle === 'trail' ? `:${trailArtVariant(b.x, b.y)}` : ''}` : b.kind === 'palace' ? `:${b.palaceLevel ?? 1}` : b.kind === 'dock' ? `:${b.dockFacing ?? 2}` : ''}`;
}

export function fieldKey(field: FarmField, time: number, joins = 0): string {
    const stage = fieldStage(field, time);
    const orchard = field.orchard && orchardAppearance(field, time);
    return orchard ? `orchard:${field.camp & 1}:${orchard.mature}:${orchard.fruit}`
        : `wheat:${stage}:${joins}`;
}

/** Offscreen art baking only. World composition uses native Pixi sprites. Small
 * pictures share atlas sources so hundreds of figures still batch together. */
export class NativeArt {
    private cache = new Map<string, CachedArt>();
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

    paint(key: string, bounds: ArtBounds, draw: (c: CanvasRenderingContext2D) => void): BakedArt {
        const existing = this.cache.get(key);
        if (existing) { existing.atlas.used = this.frame; this.stats.rasterCacheHits++; return existing.art; }
        const r = this.resolution, width = Math.ceil(bounds.width * r), height = Math.ceil(bounds.height * r), padding = 2;
        let atlas = this.atlases.at(-1);
        if (atlas && atlas.x + width + padding > atlas.source.pixelWidth) { atlas.x = padding; atlas.y += atlas.row + padding; atlas.row = 0; }
        if (!atlas || atlas.y + height + padding > atlas.source.pixelHeight || width + padding * 2 > atlas.source.pixelWidth) {
            const canvas = document.createElement('canvas'); canvas.width = Math.max(2048, width + padding * 2); canvas.height = Math.max(2048, height + padding * 2);
            const source = new CanvasSource({ resource: canvas, resolution: r, scaleMode: 'nearest' });
            atlas = { source, context: canvas.getContext('2d')!, x: padding, y: padding, row: 0, used: this.frame, dirty: false, keys: [] };
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

    unit(unit: Unit, time: number, color: string, effect?: { damageMask?: boolean; passenger?: Unit }): BakedArt {
        if (!unit.inside) {
            if (unit.kind === 'sailboat') {
                const pose = galleyPose(unit, time), mask = effect?.damageMask;
                const hullSheet = galleyHullImage(), rigSheet = galleyRigImage();
                const hull = hullSheet ? this.image(effectSheet(hullSheet, mask), pose.rect, GALLEY_ART_BOUNDS)
                    : this.paint(`galley:hull:${pose.row}:${pose.frame}`, GALLEY_ART_BOUNDS,
                        c => drawGalleyHull(c, { ...unit, facing: pose.heading }, 0, 0, 32, time));
                const rig = rigSheet ? this.image(effectSheet(rigSheet, mask), [0, pose.row * 32, 32, 32], GALLEY_ART_BOUNDS)
                    : this.paint(`galley:rig:${pose.row}`, GALLEY_ART_BOUNDS,
                        c => drawGalleyRig(c, { facing: pose.heading }, 0, 0, 32));
                const overlays: BakedArt[] = [], passenger = effect?.passenger;
                if (passenger) {
                    const row = personFrame({ ...passenger, facing: unit.facing, moving: false, attackTime: 0 }, 0).row;
                    const person = this.paint(`galley:captain:${pose.row}:${row}:${color}:${armorVisualLevel(passenger.armorLevel)}:${!!mask}`,
                        { x: -16, y: -40, width: 64, height: 104 }, c => {
                            drawGalleyPassenger(c, unit, passenger, 0, 0, 32, color, false);
                            if (mask) { c.globalCompositeOperation = 'source-in'; c.fillStyle = '#de3830'; c.fillRect(-16, -40, 64, 104); }
                        });
                    const offset = galleyAttachmentOffset(unit, 'captain');
                    overlays.push({ ...person, x: person.x + offset.x, y: person.y + offset.y });
                }
                const offset = galleyAttachmentOffset(unit, 'rig');
                overlays.push({ ...rig, x: rig.x + offset.x, y: rig.y + offset.y });
                return { ...hull, rotation: pose.rotation, rotationPivot: GALLEY_PIVOT, overlays };
            }
            if ((unit.kind === 'horseman' || unit.kind === 'horseArcher' || unit.kind === 'knight')) {
                const sheet = horsemanSheet(color, unit.kind), pose = horsemanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], horsemanBounds(pose));
            }
            if (unit.kind === 'spearman') {
                const sheet = spearmanSheet(color), pose = spearmanPose(unit, time);
                if (sheet) return this.image(effectSheet(sheet, effect?.damageMask), [...pose.rect], spearmanBounds(pose));
            }
            if ((unit.kind === 'boar' || unit.kind === 'marshBird') && wildlifeImage(unit.kind)) {
                const { row, frame } = wildlifeFrame(unit, time);
                return this.image(effectSheet(wildlifeImage(unit.kind)!, effect?.damageMask), [frame * 16, row * 16, 16, 16], { x: 0, y: 0, width: 32, height: 32 });
            }
            if (unit.kind === 'merchant' && !unit.aboardRiverTrade && merchantImage()) {
                const { row, column } = merchantFrame(unit, time);
                return this.image(effectSheet(merchantImage()!, effect?.damageMask), [column * 32, row * 32, 32, 32], { x: -8, y: -8, width: 48, height: 48 });
            }
            if (['leader', 'warrior', 'swordsman', 'archer', 'scout', 'militia', 'levyInfantry', 'skirmisher', 'slinger', 'worker'].includes(unit.kind)) {
                const { role, row, frame } = personFrame(unit, time), sheet = factionSheet(role, color, unit.armorLevel);
                if (sheet) {
                    const art = this.image(effectSheet(sheet, effect?.damageMask), [frame * 32, row * 32, 32, 32], { x: -6.4, y: -4.44, width: 44.8, height: 44.8 });
                    if (unit.engineer) return { ...art, overlays: [this.paint(`engineer:${row}:${unit.attackTime > 0}`, { x: 0, y: 0, width: 32, height: 32 }, c => drawEngineerEquipment(c, unit.facing, unit.attackTime > 0))] };
                    const cargo = punyWorldImage();
                    return (unit.cargo ?? 0) > 0 && cargo ? { ...art, overlays: [this.image(effectSheet(cargo, effect?.damageMask), [146, 501, 12, 10],
                        { x: 12.5, y: 17.26, width: 9.8, height: 8.4 })] } : art;
                }
            }
        }
        return this.paint(unitKey(unit, time, color, effect?.passenger), { x: -8, y: -8, width: 50, height: 50 }, c => drawUnit(c, unit, 0, 0, 32, time, color, effect?.passenger));
    }
    /** Shared sheet frames at native scale, aligned to the same 16,27.2 foot anchor as people. */
    death(age: number): BakedArt | undefined {
        const frame = deathAnimationFrame(age);
        if (frame < 0) return undefined;
        const decay = frame >= DEATH_FALL_FRAME_DURATIONS_MS.length;
        const image = decay ? decayAnimationImage() : deathAnimationImage();
        const size = decay ? DECAY_FRAME_SIZE : DEATH_FRAME_SIZE;
        const anchor = decay ? DECAY_GROUND_ANCHOR : DEATH_GROUND_ANCHOR;
        const column = decay ? frame - DEATH_FALL_FRAME_DURATIONS_MS.length : frame;
        return image && this.image(image, [column * size, 0, size, size],
            { x: 16 - anchor[0], y: 27.2 - anchor[1], width: size, height: size });
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
    building(b: Building, time: number, color: string, links = NO_CONNECTIONS, gate?: Connections, attached = false): BakedArt {
        if (b.kind === 'dock') return this.paint(buildingKey(b, time, color), b.construction ? dockConstructionBounds(b) : dockArtBounds(b),
            c => drawBuilding(c, b, 0, 0, 32, time, color));
        const x = attached && b.kind === 'well' ? -12 : 0, y = buildingArtTop(b) * 32;
        const bottom = b.kind === 'palace' && !b.construction ? palaceArtHeight(b.palaceLevel) : buildingHeight(b) * 32;
        return this.paint(buildingKey(b, time, color, links, gate, attached),
            { x, y, width: buildingWidth(b) * 32 - x, height: bottom - y + (attached && b.kind === 'well' ? 8 : 0) },
            c => drawBuilding(c, b, 0, 0, 32, time, color, links, gate, attached));
    }
    vegetation(tile: Tile): BakedArt {
        const source = vegetationVariant(tile);
        return this.paint(`tree:${source?.sheet}:${source?.x}:${source?.y}`, vegetationArtBounds(tile),
            c => drawVegetation(c, tile, 0, 0, 32));
    }
    resource(resource: ResourceCellArt): BakedArt {
        return this.paint(`resource:${resourceObjectKey(resource)}`, resourceObjectBounds(resource),
            c => drawResourceObject(c, resource));
    }
    resourceOutline(resource: ResourceCellArt, color: string): BakedArt {
        const bounds = resourceObjectBounds(resource), padding = 6;
        return this.paint(`resource-outline:${resourceObjectKey(resource)}:${color}`,
            { x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + 2 * padding, height: bounds.height + 2 * padding }, c => {
                const sprite = document.createElement('canvas');
                sprite.width = bounds.width + 2 * padding; sprite.height = bounds.height + 2 * padding;
                drawResourceObject(sprite.getContext('2d')!, { ...resource, developed: resource.resource === 'salt' || resource.developed }, padding - bounds.x, padding - bounds.y);
                c.drawImage(silhouetteOutline(sprite, color), bounds.x - padding, bounds.y - padding);
            });
    }
    resourceFence(resource: ResourceCellArt, front: boolean): BakedArt {
        return this.paint(`resource-fence:${resource.fences}:${resource.gate}:${front}`, { x: 0, y: -8, width: 32, height: 40 },
            c => drawResourceFence(c, resource, front));
    }
    field(field: FarmField, time: number, clipKey = '', clip?: (c: CanvasRenderingContext2D) => void, joins = 0): BakedArt {
        return this.paint(`${fieldKey(field, time, joins)}:${clipKey}`, { x: 0, y: 0, width: 32, height: 32 },
            c => { clip?.(c); drawFarmField(c, 0, 0, 32, time, field, joins); });
    }
    overlay(tile: Tile, axis: FordAxis = 'vertical'): BakedArt {
        if (tile.palm) return this.paint('palm', { x: 0, y: 0, width: 32, height: 32 }, c => drawPalm(c, 0, 0, 32));
        const variant = tile.overlay === 'ford' ? Math.min(5, Math.floor(tile.variation * 6)) : Math.floor(tile.variation * 65536);
        return this.paint(`overlay:${tile.overlay}:${axis}:${variant}`, { x: -2, y: -4, width: 40, height: 40 },
            c => drawOverlay(c, tile.overlay, 0, 0, 32, 0, tile.variation, axis));
    }

    /** Caller first detaches old scene children so Pixi rebuilds texture batches. */
    prune(): TextureSource[] {
        const retired: TextureSource[] = [];
        for (const atlas of [...this.atlases].sort((a, b) => a.used - b.used)) {
            if (this.atlases.length <= 8 || atlas.used === this.frame) break;
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
        this.images.clear(); this.cache.clear(); this.atlases = []; return sources;
    }
    destroy(): void { for (const source of this.clear()) source.destroy(); }
}
