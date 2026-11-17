//! World terrain bookkeeping: classified revisions and bounded change journals.
//!
//! A world (the tile grid shared by a game, its previews and its clones) is
//! addressed by its own handle because several game states can share one.
//! The host classifies each edit (structure, appearance, sight, geometry) and
//! names the changed cells; consumers keep independent cursors into the
//! journals, and a slow reader falls back to one full refresh instead of
//! keeping an unbounded edit log alive.
use std::collections::{BTreeMap, VecDeque};

/// Journal entries kept before the oldest is folded into a full refresh.
pub const HISTORY_LIMIT: usize = 1024;

pub const STRUCTURE: u32 = 0;
pub const APPEARANCE: u32 = 1;
pub const SIGHT: u32 = 2;
pub const GEOMETRY: u32 = 3;

struct Entry { revision: u64, cells: Vec<u32> }

/// Changed cells per revision with a full-refresh watermark.
#[derive(Default)]
pub struct CellJournal {
    journal: u64,
    /// Cursors older than this revision must refresh everything.
    full_at: u64,
    history: VecDeque<Entry>,
    history_cells: usize,
    /// Per-cell stamp used to report each changed cell once per query.
    seen: Vec<u32>,
    stamp: u32,
}
impl CellJournal {
    pub fn revision(&self) -> u64 { self.journal }
    /// An unlocated change: every reader refreshes everything.
    pub fn full_reset(&mut self) {
        self.journal += 1;
        self.full_at = self.journal;
        self.history.clear();
        self.history_cells = 0;
    }
    /// Located changes. An empty list records nothing.
    pub fn record(&mut self, tile_count: usize, cells: &[u32]) {
        if cells.is_empty() { return; }
        self.journal += 1;
        self.history.push_back(Entry { revision: self.journal, cells: cells.to_vec() });
        self.history_cells += cells.len();
        let capacity = 4096.max(tile_count * 2);
        while self.history.len() > HISTORY_LIMIT || self.history_cells > capacity {
            let Some(removed) = self.history.pop_front() else { break; };
            self.full_at = removed.revision;
            self.history_cells -= removed.cells.len();
        }
    }
    /// Writes `[revision, full, count, cells...]`: the cells changed after
    /// `cursor`, newest edit first, each cell once. A missing, stale or
    /// future cursor asks for a full refresh.
    pub fn since(&mut self, tile_count: usize, cursor: Option<u64>, output: &mut Vec<f64>) {
        output.clear();
        output.extend_from_slice(&[self.journal as f64, 0.0, 0.0]);
        let Some(cursor) = cursor.filter(|cursor| *cursor >= self.full_at && *cursor <= self.journal) else {
            output[1] = 1.0;
            return;
        };
        if cursor == self.journal { return; }
        if self.seen.len() != tile_count { self.seen = vec![0; tile_count]; self.stamp = 0; }
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 { self.seen.fill(0); self.stamp = 1; }
        for entry in self.history.iter().rev() {
            if entry.revision <= cursor { break; }
            for &cell in &entry.cells {
                let seen = &mut self.seen[cell as usize];
                if *seen != self.stamp { *seen = self.stamp; output.push(cell as f64); }
            }
        }
        output[2] = (output.len() - 3) as f64;
    }
}

/// Revisions and journals of one world.
#[derive(Default)]
pub struct WorldRecord {
    /// [appearance, sight, geometry, structure].
    revisions: [f64; 4],
    changes: CellJournal,
    /// Sight consumers keep their own bounded history: a tree edit must not
    /// replay every unrelated harvest or road-wear cell since their last read.
    sight_changes: CellJournal,
    input: Vec<f64>,
    output: Vec<f64>,
}
impl WorldRecord {
    pub fn revisions(&self) -> &[f64; 4] { &self.revisions }
    /// Buildings and roads change navigation (structure) without changing the
    /// terrain image; appearance, sight and geometry each imply the broader
    /// revisions that depend on them.
    fn advance(&mut self, change: u32) {
        if change == STRUCTURE || change == GEOMETRY { self.revisions[3] += 1.0; }
        if change != STRUCTURE { self.revisions[0] += 1.0; }
        if change == SIGHT || change == GEOMETRY { self.revisions[1] += 1.0; }
        if change == GEOMETRY { self.revisions[2] += 1.0; }
    }
    /// An unknown raw edit (replaced tiles, a foreign revision bump): be
    /// conservative everywhere.
    pub fn reset(&mut self) -> &[f64; 4] {
        self.advance(GEOMETRY);
        self.changes.full_reset();
        self.sight_changes.full_reset();
        &self.revisions
    }
    pub fn cells_input(&mut self, count: usize) -> *mut f64 { self.input.clear(); self.input.resize(count, 0.0); self.input.as_mut_ptr() }
    /// In-range integral cells of the host input, in order.
    fn input_cells(&self, tile_count: usize, count: usize) -> Vec<u32> {
        self.input[..count.min(self.input.len())].iter()
            .filter(|cell| cell.is_finite() && cell.fract() == 0.0 && **cell >= 0.0 && **cell < tile_count as f64)
            .map(|cell| *cell as u32).collect()
    }
    /// A classified edit. `located` says whether the host named its cells
    /// (the first `count` input values). A structural edit changes entities,
    /// not tiles, unless its caller supplies a footprint; other unlocated
    /// edits require a conservative refresh.
    pub fn mark(&mut self, tile_count: usize, change: u32, located: bool, count: usize) -> &[f64; 4] {
        self.advance(change);
        if located || change != STRUCTURE {
            let sight = change == SIGHT || change == GEOMETRY;
            if located {
                let cells = self.input_cells(tile_count, count);
                self.changes.record(tile_count, &cells);
                if sight { self.sight_changes.record(tile_count, &cells); }
            } else {
                self.changes.full_reset();
                if sight { self.sight_changes.full_reset(); }
            }
        }
        &self.revisions
    }
    /// Tile-only metadata changes that carry their own semantic invalidation.
    pub fn record_tiles(&mut self, tile_count: usize, count: usize) {
        let cells = self.input_cells(tile_count, count);
        self.changes.record(tile_count, &cells);
    }
    /// `[revision, full, count, cells...]` for the general (0) or sight (1) journal.
    pub fn changes_since(&mut self, sight: bool, tile_count: usize, cursor: Option<u64>) -> *const f64 {
        let mut output = std::mem::take(&mut self.output);
        if sight { self.sight_changes.since(tile_count, cursor, &mut output); } else { self.changes.since(tile_count, cursor, &mut output); }
        self.output = output;
        self.output.as_ptr()
    }
}

#[derive(Default)]
pub struct Worlds { next_handle: u32, records: BTreeMap<u32, WorldRecord> }
impl Worlds {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("world handle overflow");
        self.records.insert(self.next_handle, WorldRecord::default());
        self.next_handle
    }
    pub fn drop_world(&mut self, handle: u32) { self.records.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut WorldRecord { self.records.get_mut(&handle).expect("unknown world") }
    pub fn get(&self, handle: u32) -> &WorldRecord { self.records.get(&handle).expect("unknown world") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mark(world: &mut WorldRecord, tiles: usize, change: u32, cells: Option<&[f64]>) {
        let count = cells.map_or(0, |cells| {
            let pointer = world.cells_input(cells.len());
            unsafe { std::ptr::copy_nonoverlapping(cells.as_ptr(), pointer, cells.len()); }
            cells.len()
        });
        world.mark(tiles, change, cells.is_some(), count);
    }
    fn since(world: &mut WorldRecord, sight: bool, tiles: usize, cursor: Option<u64>) -> (u64, bool, Vec<f64>) {
        let pointer = world.changes_since(sight, tiles, cursor);
        unsafe {
            let count = *pointer.add(2) as usize;
            (*pointer as u64, *pointer.add(1) != 0.0, std::slice::from_raw_parts(pointer.add(3), count).to_vec())
        }
    }

    #[test]
    fn each_change_kind_advances_the_revisions_that_depend_on_it() {
        let mut world = WorldRecord::default();
        mark(&mut world, 4, STRUCTURE, None);
        assert_eq!(world.revisions(), &[0.0, 0.0, 0.0, 1.0]);
        mark(&mut world, 4, APPEARANCE, Some(&[1.0]));
        assert_eq!(world.revisions(), &[1.0, 0.0, 0.0, 1.0]);
        mark(&mut world, 4, SIGHT, Some(&[1.0]));
        assert_eq!(world.revisions(), &[2.0, 1.0, 0.0, 1.0]);
        mark(&mut world, 4, GEOMETRY, Some(&[1.0]));
        assert_eq!(world.revisions(), &[3.0, 2.0, 1.0, 2.0]);
        assert_eq!(world.reset(), &[4.0, 3.0, 2.0, 3.0]);
    }

    #[test]
    fn journals_report_each_changed_cell_once_newest_first_and_keep_sight_separate() {
        let mut world = WorldRecord::default();
        let (all, _, _) = since(&mut world, false, 4, None);
        let (sight, _, _) = since(&mut world, true, 4, None);
        // An unlocated structural edit touches no tiles.
        mark(&mut world, 4, STRUCTURE, None);
        assert_eq!(since(&mut world, false, 4, Some(all)), (all, false, vec![]));
        mark(&mut world, 4, APPEARANCE, Some(&[2.0]));
        mark(&mut world, 4, SIGHT, Some(&[1.0, 1.0]));
        mark(&mut world, 4, GEOMETRY, Some(&[0.0, 9.0, -1.0, 1.5, f64::NAN]));
        assert_eq!(since(&mut world, false, 4, Some(all)), (all + 3, false, vec![0.0, 1.0, 2.0]));
        assert_eq!(since(&mut world, true, 4, Some(sight)), (sight + 2, false, vec![0.0, 1.0]));
        // Only out-of-range cells: nothing is recorded.
        mark(&mut world, 4, APPEARANCE, Some(&[7.0]));
        assert_eq!(since(&mut world, false, 4, Some(all + 3)), (all + 3, false, vec![]));
        let pointer = world.cells_input(1);
        unsafe { *pointer = 3.0; }
        world.record_tiles(4, 1);
        assert_eq!(since(&mut world, false, 4, Some(all + 3)), (all + 4, false, vec![3.0]));
        assert_eq!(since(&mut world, true, 4, Some(sight + 2)), (sight + 2, false, vec![]));
    }

    #[test]
    fn unlocated_edits_and_overflow_force_one_full_refresh() {
        let mut world = WorldRecord::default();
        let (cursor, full, _) = since(&mut world, true, 4, None);
        assert!(full);
        mark(&mut world, 4, APPEARANCE, None);
        assert_eq!(since(&mut world, true, 4, Some(cursor)), (cursor, false, vec![]), "appearance leaves the sight journal alone");
        assert!(since(&mut world, false, 4, Some(0)).1);
        mark(&mut world, 4, SIGHT, None);
        assert!(since(&mut world, true, 4, Some(cursor)).1);
        let (cursor, _, _) = since(&mut world, true, 4, None);
        for index in 0..1100 { mark(&mut world, 4, SIGHT, Some(&[(index % 4) as f64])); }
        assert!(since(&mut world, true, 4, Some(cursor)).1, "a slow reader refreshes once");
        let (fresh, _, _) = since(&mut world, true, 4, None);
        assert_eq!(since(&mut world, true, 4, Some(fresh)), (fresh, false, vec![]));
        assert!(since(&mut world, true, 4, Some(fresh + 1)).1, "a future cursor is not trusted");
        // The most recent HISTORY_LIMIT edits remain readable.
        assert_eq!(since(&mut world, true, 4, Some(fresh - 2)), (fresh, false, vec![3.0, 2.0]));
        // One oversized edit cannot be retained: it becomes a full refresh.
        let cells: Vec<f64> = (0..5000).map(|cell| (cell % 4) as f64).collect();
        mark(&mut world, 4, SIGHT, Some(&cells));
        assert!(since(&mut world, true, 4, Some(fresh)).1);
        world.reset();
        assert!(since(&mut world, false, 4, Some(fresh)).1);
    }
}
