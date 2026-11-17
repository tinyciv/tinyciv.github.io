import { buildingEffectCells } from './building-aoe';
import { pointInSight, type FogView } from './fog';
import type { BuildingIndex } from './presentation-index';
import type { Building, Point, World } from './types';

const key = (point: Point) => `${point.x},${point.y}`;
export interface ConstructionGhostCell extends Point { valid: boolean; skip?: boolean }
export interface ConstructionGhostView {
  index: BuildingIndex;
  plans: ReadonlyMap<string, { building: Building; valid: boolean }>;
  validCells: ReadonlySet<string>;
}

/** Presentation snapshots are immutable. Copy their occupancy map only when
 * the actual ghost footprint/validity changes, keeping depth caches reusable. */
export class ConstructionGhostCache {
  private previous?: { world: World; base: BuildingIndex; signature: string; extra: unknown; view: ConstructionGhostView };

  get(world: World, base: BuildingIndex, kind: Building['kind'] | undefined, faction: number,
    cells: readonly ConstructionGhostCell[], create: (point: Point) => Building, extra?: unknown): ConstructionGhostView {
    const signature = `${kind}:${faction}|${cells.map(cell => `${key(cell)},${Number(cell.valid)},${Number(!!cell.skip)}`).join(';')}`;
    const old = this.previous;
    if (old?.world === world && old.base === base && old.signature === signature && old.extra === extra) return old.view;
    let overlay: Map<string, readonly Building[]> | undefined;
    const plans = new Map<string, { building: Building; valid: boolean }>(), validCells = new Set<string>();
    for (const cell of cells) {
      const at = key(cell);
      if (cell.valid) validCells.add(at);
      if (!kind || cell.skip) continue;
      const occupants = base.get(at) ?? [], existing = occupants.find(building => building.kind === kind && building.faction === faction);
      const building = existing ?? create(cell);
      plans.set(at, { building, valid: cell.valid });
      if (cell.valid && !existing) (overlay ??= new Map(base)).set(at, [...occupants, building]);
    }
    const view = { index: overlay ?? base, plans, validCells };
    this.previous = { world, base, signature, extra, view };
    return view;
  }
}

interface CellBounds { left: number; right: number; top: number; bottom: number }
export interface ConstructionEffectCell extends Point { field?: boolean }

/** Keep coverage geometry independent of camera pixels. Only observed fields
 * and current visibility decide which irrigation cells receive stronger ink. */
export class ConstructionEffectCache {
  private geometry?: { world: World; width: number; height: number; signature: string; cells: Point[] };
  private observed?: { fields: FogView['fields']; cells: ReadonlySet<string> };
  private highlighted?: { cells: readonly Point[]; fog: FogView; visible: Uint8Array; revision: number;
    fields: FogView['fields']; values: ConstructionEffectCell[] };

  get(world: World, origins: readonly Point[], radius: number, bounds: CellBounds, fog?: FogView): readonly ConstructionEffectCell[] {
    const signature = `${radius}:${bounds.left},${bounds.right},${bounds.top},${bounds.bottom}|${origins.map(key).join(';')}`;
    let geometry = this.geometry;
    if (!geometry || geometry.world !== world || geometry.width !== world.width || geometry.height !== world.height || geometry.signature !== signature)
      geometry = this.geometry = { world, width: world.width, height: world.height, signature,
        cells: buildingEffectCells(world, origins, radius, bounds) };
    const old = this.highlighted;
    if (fog && old?.cells === geometry.cells && old.fog === fog && old.visible === fog.visible
      && old.revision === fog.revision && old.fields === fog.fields) return old.values;
    if (!fog) return geometry.cells;
    if (this.observed?.fields !== fog.fields) this.observed = { fields: fog.fields, cells: new Set(fog.fields.map(key)) };
    const values = geometry.cells.map(point => ({ ...point,
      field: this.observed!.cells.has(key(point)) && pointInSight(fog, point.x + .5, point.y + .5) }));
    this.highlighted = { cells: geometry.cells, fog, visible: fog.visible, revision: fog.revision, fields: fog.fields, values };
    return values;
  }
}
