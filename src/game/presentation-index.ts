import { buildingHeight, buildingWidth, type Building, type FarmFieldMemory } from './types';
import type { FogView } from './fog';

export type BuildingIndex = ReadonlyMap<string, readonly Building[]>;
const cellKey = (x: number, y: number) => `${x},${y}`;

/** Preserve every layer of a shared tile and every cell of a large footprint. */
export function indexBuildings(buildings: readonly Building[]): Map<string, Building[]> {
    const index = new Map<string, Building[]>();
    for (const building of buildings) {
        if (building.hp <= 0) continue;
        for (let y = building.y; y < building.y + buildingHeight(building); y++)
            for (let x = building.x; x < building.x + buildingWidth(building); x++) {
                const key = cellKey(x, y), occupants = index.get(key);
                if (occupants) occupants.push(building);
                else index.set(key, [building]);
            }
    }
    return index;
}

/** Presentation indexes consume observed snapshots only. Fog replaces these
 * arrays when their contents change; hidden live entities never enter here. */
export class PresentationIndex {
    buildings = new Map<string, Building[]>();
    roads = new Set<number>();
    fields = new Map<string, FarmFieldMemory>();
    /** Numeric-cell views of `buildings` and `fields` for per-tile drawing loops. */
    cellBuildings: (Building[] | undefined)[] = [];
    cellFields: (FarmFieldMemory | undefined)[] = [];
    private buildingSnapshot?: readonly Building[];
    private fieldSnapshot?: readonly FarmFieldMemory[];
    private width = 0;
    private buckets = new Map<string, Building[]>();
    private order = new Map<Building, number>();
    private viewport?: { left: number; right: number; top: number; bottom: number; buildings: Building[] };

    update(fog: FogView): void {
        if (this.buildingSnapshot !== fog.buildings || this.width !== fog.width) {
            this.buildingSnapshot = fog.buildings; this.width = fog.width;
            this.buildings = indexBuildings(fog.buildings);
            this.cellBuildings = new Array(fog.width * fog.height);
            for (const building of fog.buildings) {
                if (building.hp <= 0) continue;
                for (let y = building.y; y < building.y + buildingHeight(building); y++)
                    for (let x = building.x; x < building.x + buildingWidth(building); x++) {
                        if (x < 0 || y < 0 || x >= fog.width || y >= fog.height) continue;
                        (this.cellBuildings[y * fog.width + x] ??= []).push(building);
                    }
            }
            this.roads.clear(); this.buckets.clear(); this.order.clear(); this.viewport = undefined;
            for (let i = 0; i < fog.buildings.length; i++) {
                const building = fog.buildings[i];
                this.order.set(building, i);
                if (building.hp > 0 && (building.kind === 'road' || building.kind === 'bridge'))
                    this.roads.add(building.y * fog.width + building.x);
                const key = cellKey(Math.floor(building.x / 8), Math.floor(building.y / 8));
                const bucket = this.buckets.get(key);
                if (bucket) bucket.push(building); else this.buckets.set(key, [building]);
            }
        }
        if (this.fieldSnapshot !== fog.fields || this.cellFields.length !== fog.width * fog.height) {
            this.fieldSnapshot = fog.fields;
            this.fields.clear(); this.cellFields = new Array(fog.width * fog.height);
            for (const field of fog.fields) {
                this.fields.set(cellKey(field.x, field.y), field);
                if (field.x >= 0 && field.y >= 0 && field.x < fog.width && field.y < fog.height) this.cellFields[field.y * fog.width + field.x] = field;
            }
        }
    }

    /** Camera movement within the same tile bounds does not repeat culling.
     * Preserve snapshot order for shared tiles and equal-depth tie breaks. */
    inViewport(left: number, right: number, top: number, bottom: number): readonly Building[] {
        const old = this.viewport;
        if (old && old.left === left && old.right === right && old.top === top && old.bottom === bottom) return old.buildings;
        const buildings: Building[] = [];
        for (let y = Math.floor(top / 8); y <= Math.floor(bottom / 8); y++)
            for (let x = Math.floor(left / 8); x <= Math.floor(right / 8); x++)
                for (const building of this.buckets.get(cellKey(x, y)) ?? [])
                    if (building.x >= left && building.x <= right && building.y >= top && building.y <= bottom) buildings.push(building);
        buildings.sort((a, b) => this.order.get(a)! - this.order.get(b)!);
        this.viewport = { left, right, top, bottom, buildings };
        return buildings;
    }
}
