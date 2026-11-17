//! Incremental 8×8-tile sector census of armed actors. The movement engine
//! updates it on every actor publish/move/remove, so settlement sensing reads
//! only overlapping sectors and never scans every unit.
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

pub const SECTOR: i32 = 8;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Member { pub id: i64, pub x: f64, pub y: f64, pub kind: u32, pub faction: f64 }

#[derive(Default)]
pub struct SectorCensus {
    sectors_x: i64,
    members: FxHashMap<i64, Vec<i64>>,
    of_actor: FxHashMap<i64, (i64, Member)>,
}

/// Military actor kinds (leader through skirmisher), alive and outside buildings.
pub fn counted(kind: u32, hp: f64, inside: bool) -> bool { ((5..=16).contains(&kind) || kind == 18) && hp > 0.0 && !inside }

impl SectorCensus {
    pub fn new(width: i32) -> Self { Self { sectors_x: ((width.max(1) + SECTOR - 1) / SECTOR) as i64, ..Self::default() } }
    fn sector(&self, x: f64, y: f64) -> Option<i64> {
        if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 { return None; }
        let (sx, sy) = ((x / SECTOR as f64).floor() as i64, (y / SECTOR as f64).floor() as i64);
        (sx < self.sectors_x).then_some(sy * self.sectors_x + sx)
    }
    /// O(1) amortized: sector lists change only when membership or sector changes.
    pub fn update(&mut self, member: Member, counted: bool) {
        let next = if counted { self.sector(member.x, member.y) } else { None };
        let previous = self.of_actor.get(&member.id).map(|(sector, _)| *sector);
        if previous != next {
            if let Some(sector) = previous { self.detach(sector, member.id); }
            match next {
                Some(sector) => { self.members.entry(sector).or_default().push(member.id); self.of_actor.insert(member.id, (sector, member)); }
                None => { self.of_actor.remove(&member.id); }
            }
        } else if let Some(entry) = self.of_actor.get_mut(&member.id) { entry.1 = member; }
    }
    pub fn moved(&mut self, id: i64, x: f64, y: f64) {
        let Some(&(_, member)) = self.of_actor.get(&id) else { return; };
        self.update(Member { x, y, ..member }, true);
    }
    pub fn remove(&mut self, id: i64) {
        if let Some((sector, _)) = self.of_actor.remove(&id) { self.detach(sector, id); }
    }
    fn detach(&mut self, sector: i64, id: i64) {
        if let Some(ids) = self.members.get_mut(&sector) {
            if let Some(index) = ids.iter().position(|&candidate| candidate == id) { ids.swap_remove(index); }
            if ids.is_empty() { self.members.remove(&sector); }
        }
    }
    pub fn len(&self) -> usize { self.of_actor.len() }
    /// Visits counted actors whose position lies inside [x0,x1]×[y0,y1], in
    /// ascending actor id order within each sector row-major sweep.
    pub fn for_each_in_rect(&self, x0: f64, y0: f64, x1: f64, y1: f64, mut visit: impl FnMut(&Member)) {
        let low_x = (x0.max(0.0) / SECTOR as f64).floor() as i64;
        let low_y = (y0.max(0.0) / SECTOR as f64).floor() as i64;
        let high_x = ((x1 / SECTOR as f64).floor() as i64).min(self.sectors_x - 1);
        let high_y = (y1 / SECTOR as f64).floor() as i64;
        if x1 < 0.0 || y1 < 0.0 { return; }
        let mut ids: SmallVec<[i64; 32]> = SmallVec::new();
        for sy in low_y..=high_y { for sx in low_x..=high_x {
            if let Some(list) = self.members.get(&(sy * self.sectors_x + sx)) {
                ids.clear(); ids.extend_from_slice(list); ids.sort_unstable();
                for id in &ids {
                    let member = &self.of_actor[id].1;
                    if member.x >= x0 && member.x <= x1 && member.y >= y0 && member.y <= y1 { visit(member); }
                }
            }
        } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct SplitMix(u64);
    impl SplitMix {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
            ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    #[test]
    fn census_tracks_move_remove_faction_kind_inside_and_death() {
        let mut census = SectorCensus::new(64);
        let member = Member { id: 1, x: 3.5, y: 3.5, kind: 7, faction: 2.0 };
        census.update(member, counted(7, 10.0, false));
        assert_eq!(census.len(), 1);
        census.moved(1, 20.5, 3.5);
        let mut seen = Vec::new();
        census.for_each_in_rect(16.0, 0.0, 24.0, 8.0, |m| seen.push(m.id));
        assert_eq!(seen, vec![1]);
        census.update(Member { faction: 3.0, x: 20.5, ..member }, true);
        census.for_each_in_rect(16.0, 0.0, 24.0, 8.0, |m| assert_eq!(m.faction, 3.0));
        census.update(member, counted(7, 10.0, true));
        assert_eq!(census.len(), 0);
        census.update(member, counted(1, 10.0, false));
        assert_eq!(census.len(), 0);
        census.update(member, counted(7, 10.0, false));
        census.update(member, counted(7, 0.0, false));
        assert_eq!(census.len(), 0);
        census.update(member, true); census.remove(1);
        assert_eq!(census.len(), 0);
    }

    #[test]
    fn census_query_matches_bruteforce() {
        let mut random = SplitMix(7);
        let mut census = SectorCensus::new(120);
        let mut actors = Vec::new();
        for id in 0..500 {
            let member = Member { id, x: random.next() * 120.0, y: random.next() * 90.0, kind: 5 + (random.next() * 12.0) as u32, faction: (random.next() * 4.0).floor() };
            census.update(member, true); actors.push(member);
        }
        for actor in actors.iter_mut().step_by(3) { actor.x = random.next() * 120.0; census.moved(actor.id, actor.x, actor.y); }
        for actor in actors.iter().step_by(7) { census.remove(actor.id); }
        let alive: Vec<Member> = actors.iter().enumerate().filter(|(index, _)| index % 7 != 0).map(|(_, member)| *member).collect();
        for _ in 0..50 {
            let (x0, y0) = (random.next() * 130.0 - 10.0, random.next() * 100.0 - 10.0);
            let (x1, y1) = (x0 + random.next() * 40.0, y0 + random.next() * 40.0);
            let mut found = Vec::new();
            census.for_each_in_rect(x0, y0, x1, y1, |m| found.push(m.id));
            found.sort_unstable();
            let mut expected: Vec<i64> = alive.iter().filter(|m| m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1).map(|m| m.id).collect();
            expected.sort_unstable();
            assert_eq!(found, expected);
        }
    }
}
