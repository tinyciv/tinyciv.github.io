import type { Territory } from './borders';

const PAGE_SIZE = 256;
/** Immutable published pages, copied only where a claim changes. Flat arrays
 * remain available lazily for export/debug callers; gameplay reads pages. */
export class TerritoryCells {
  private pages: (Int32Array | undefined)[];
  private owned = new Set<number>();
  private sealed = false;
  constructor(readonly length: number, private empty: number, previous?: TerritoryCells) {
    this.pages = previous ? previous.pages.slice() : new Array(Math.ceil(length / PAGE_SIZE));
  }
  get(cell: number, component = 0): number {
    return this.pages[Math.floor(cell / PAGE_SIZE)]?.[(cell % PAGE_SIZE) * 4 + component] ?? this.empty;
  }
  set(cell: number, values: readonly number[]): void {
    if (this.sealed) throw new Error('Published territory is immutable');
    const page = Math.floor(cell / PAGE_SIZE), offset = (cell % PAGE_SIZE) * 4;
    if (values.every((value, component) => value === this.get(cell, component))) return;
    if (!this.owned.has(page)) {
      this.pages[page] = this.pages[page]?.slice() ?? new Int32Array(PAGE_SIZE * 4).fill(this.empty);
      this.owned.add(page);
    }
    this.pages[page]!.set(values, offset);
  }
  seal(): this { this.sealed = true; this.owned.clear(); return this; }
  flatten(component: number): Int32Array {
    const values = new Int32Array(this.length).fill(this.empty);
    for (let p = 0; p < this.pages.length; p++) {
      const page = this.pages[p]; if (!page) continue;
      const end = Math.min(PAGE_SIZE, this.length - p * PAGE_SIZE);
      for (let i = 0; i < end; i++) values[p * PAGE_SIZE + i] = page[i * 4 + component];
    }
    return values;
  }
}

const components = ['owners', 'sourceIds', 'alternateOwners', 'alternateSourceIds'] as const;
export function territoryValue(view: Territory, cell: number, component?: number): number;
export function territoryValue(view: Territory | undefined, cell: number, component?: number): number | undefined;
export function territoryValue(view: Territory | undefined, cell: number, component = 0): number | undefined {
  if (!view) return;
  return view.cells ? view.cells.get(cell, component) : view[components[component]][cell];
}
