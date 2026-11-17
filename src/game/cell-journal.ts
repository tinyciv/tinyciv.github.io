export interface CellChanges { revision: number; full: boolean; cells: readonly number[] }

/** Bounded journals have independent reader cursors. A late reader refreshes
 * once; it cannot retain history or make other consumers replay old changes. */
export class CellJournal {
  revision = 0;
  private fullAt = 0;
  private history: { revision: number; cells: readonly number[] }[] = [];
  private start = 0;
  private retained = 0;
  constructor(private capacity = 65536) {}
  publish(cells?: Iterable<number>): void {
    if (cells === undefined) {
      this.fullAt = ++this.revision; this.history = []; this.start = 0; this.retained = 0; return;
    }
    const values = [...new Set(cells)];
    if (!values.length) return;
    this.history.push({ revision: ++this.revision, cells: values }); this.retained += values.length;
    while (this.history.length - this.start > 256 || this.retained > this.capacity) {
      const removed = this.history[this.start++];
      this.fullAt = removed.revision; this.retained -= removed.cells.length; removed.cells = [];
    }
    if (this.start >= 256) { this.history = this.history.slice(this.start); this.start = 0; }
  }
  since(cursor?: number): CellChanges {
    if (cursor === undefined || !Number.isSafeInteger(cursor) || cursor < this.fullAt || cursor > this.revision)
      return { revision: this.revision, full: true, cells: [] };
    if (cursor === this.revision) return { revision: cursor, full: false, cells: [] };
    const cells = new Set<number>();
    for (let i = this.history.length - 1; i >= this.start && this.history[i].revision > cursor; i--)
      for (const cell of this.history[i].cells) cells.add(cell);
    return { revision: this.revision, full: false, cells: [...cells] };
  }
}

const arrays = new WeakMap<object, CellJournal>();
export function arrayJournal(array: object): CellJournal | undefined { return arrays.get(array); }
export function trackArray(array: object): CellJournal {
  let journal = arrays.get(array);
  if (!journal) { journal = new CellJournal(); arrays.set(array, journal); }
  return journal;
}
