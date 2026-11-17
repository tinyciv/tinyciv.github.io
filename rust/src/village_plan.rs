//! Static village layout templates (design section 8.3): parsing, the eight
//! orientations, fit scoring for founding, slot lists with alternates and the
//! frontage/connectivity rules used to skip dependent slots. No ECS state.
use std::collections::{BTreeMap, BTreeSet, VecDeque};

pub const FAMILY_NONE: u8 = 0;
pub const ROADSIDE: u8 = 1;
pub const MARKET_CROSS: u8 = 2;
pub const RIVERSIDE: u8 = 3;
pub const HILL_CLUSTER: u8 = 4;
pub const FAMILIES: [u8; 4] = [ROADSIDE, MARKET_CROSS, RIVERSIDE, HILL_CLUSTER];
pub const PATCH: i32 = 25;
pub const PATCH_HALF: i32 = 12;
pub const OPEN: u32 = 1;
pub const WATER: u32 = 2;
pub const FORD: u32 = 4;
pub const BLOCKED: u32 = 8;
pub const CLEARABLE: u32 = 16;

struct Source { family: u8, lot: (i32, i32), kind: &'static [&'static str], stage: &'static [&'static str] }

const SOURCES: [Source; 4] = [
    Source { family: ROADSIDE, lot: (10, 0), kind: &[
        "..BB......PP...AA.....",
        "T.BB.G.hhHPPhWhAAhhT..",
        "======================",
        "..DDhh.hh.hhh=hh.GCC.T",
        "..DD.........=....CC..",
        "............h=h.......",
        "............h=h.......",
    ], stage: &[
        "..33......00...22.....",
        "4.33.2.1100002222333..",
        "4433222111111112223344",
        "..4444.22.011433.344.4",
        "..44.........4....44..",
        "............444.......",
        "............444.......",
    ] },
    Source { family: MARKET_CROSS, lot: (7, 6), kind: &[
        ".......=........",
        ".......=T.......",
        ".......=h.......",
        "......h=h.......",
        "......h=h.AA....",
        "......H==hAAhh..",
        "..hhhh=PP======T",
        "T======PP=.G....",
        "DDhhBB===h......",
        "DD..BBhW=h......",
        ".......h=h......",
        ".......G=CC.....",
        ".......h=CC.....",
        ".......h=.......",
        "........T.......",
    ], stage: &[
        ".......4........",
        ".......33.......",
        ".......33.......",
        "......223.......",
        "......223.22....",
        "......01102244..",
        "..44111002223344",
        "4433111002.2....",
        "4433331110......",
        "44..331112......",
        ".......112......",
        ".......3344.....",
        ".......4344.....",
        ".......44.......",
        "........4.......",
    ] },
    Source { family: RIVERSIDE, lot: (10, 3), kind: &[
        "~~~~~~~~~~~~~~~~~~~~~~",
        "T...........Q......T.T",
        "======================",
        ".hhGhh=hWHPPhhh=hhhhG.",
        "....BB=h..PP..h=AA....",
        "....BB=h......h=AA....",
        "....DD=.......h=h.....",
        "....DD=.......h=h.....",
        "..............h=CC....",
        "................CC....",
    ], stage: &[
        "......................",
        "4...........2......3.4",
        "4332222111111111223344",
        ".44222311000001222334.",
        "....3333..00..3222....",
        "....3333......3222....",
        "....444.......334.....",
        "....444.......444.....",
        "..............4444....",
        "................44....",
    ] },
    Source { family: HILL_CLUSTER, lot: (7, 5), kind: &[
        "..h=h..........",
        ".Th=hh......T..",
        "...====AA.h===.",
        "...hh.=AA.h=hCC",
        "......======hCC",
        ".....H=PP=.....",
        "......=PP=h....",
        ".....G======h..",
        "DD...W=hh.h=h.T",
        "DD=====h.BB===h",
        "..G.hh...BB.hh.",
    ], stage: &[
        "..444..........",
        ".44433......3..",
        "...333322.2244.",
        "...33.322.22244",
        "......222222244",
        ".....01001.....",
        "......10010....",
        ".....21111333..",
        "44...1110.333.4",
        "44441111.333444",
        "..4.11...33.44.",
    ] },
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SlotKind { Road, House, Well, GuardPost, Lot(u8), Quay, Tower, Hub, Tent }
impl SlotKind {
    fn order(self) -> u8 {
        match self { SlotKind::Road => 0, SlotKind::House => 1, SlotKind::Well => 2, SlotKind::GuardPost => 3,
            SlotKind::Lot(_) => 4, SlotKind::Quay => 5, SlotKind::Tower => 6, SlotKind::Hub | SlotKind::Tent => 7 }
    }
}

/// Cells are template-local: the civic lot occupies (0,0)-(1,1).
#[derive(Clone, Debug)]
pub struct Slot { pub kind: SlotKind, pub stage: u8, pub cells: Vec<(i32, i32)>, pub alternates: Vec<Vec<(i32, i32)>> }

#[derive(Clone, Debug)]
pub struct Template {
    pub family: u8,
    pub slots: Vec<Slot>,
    pub water: Vec<(i32, i32)>,
    /// Template symbol per local cell (P lot, ~ water, = road, ...).
    pub symbols: BTreeMap<(i32, i32), char>,
    pub stages: BTreeMap<(i32, i32), u8>,
}

fn digit(c: char) -> Option<u8> { c.to_digit(10).map(|d| d as u8) }
const NEIGHBORS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

pub fn parse(source_index: usize) -> Template {
    let source = &SOURCES[source_index];
    assert_eq!(source.kind.len(), source.stage.len(), "template layers must have equal rows");
    let mut symbols = BTreeMap::new(); let mut stages = BTreeMap::new();
    for (row, (kind, stage)) in source.kind.iter().zip(source.stage.iter()).enumerate() {
        assert_eq!(kind.len(), stage.len(), "template layers must have equal columns");
        for (col, (k, s)) in kind.chars().zip(stage.chars()).enumerate() {
            let cell = (col as i32 - source.lot.0, row as i32 - source.lot.1);
            if k == '.' { assert_eq!(s, '.', "empty cell has a stage"); continue; }
            symbols.insert(cell, k);
            if k == '~' { assert_eq!(s, '.', "water has no stage"); continue; }
            stages.insert(cell, digit(s).unwrap_or_else(|| panic!("missing stage at {cell:?}")));
        }
    }
    let mut slots = Vec::new(); let mut water = Vec::new();
    let mut seen: BTreeSet<(i32, i32)> = BTreeSet::new();
    // Roads in BFS order from the lot (ties by row then column).
    let mut queue = VecDeque::new(); let mut road_order = Vec::new();
    let mut starts: Vec<(i32, i32)> = symbols.iter().filter(|(cell, symbol)| **symbol == '='
        && NEIGHBORS.iter().any(|(dx, dy)| symbols.get(&(cell.0 + dx, cell.1 + dy)) == Some(&'P'))).map(|(cell, _)| *cell).collect();
    starts.sort_by_key(|&(x, y)| (y, x));
    let mut visited = BTreeSet::new();
    for start in starts { if visited.insert(start) { queue.push_back(start); } }
    while let Some(cell) = queue.pop_front() {
        road_order.push(cell);
        let mut next: Vec<(i32, i32)> = NEIGHBORS.iter().map(|(dx, dy)| (cell.0 + dx, cell.1 + dy))
            .filter(|n| symbols.get(n) == Some(&'=') && !visited.contains(n)).collect();
        next.sort_by_key(|&(x, y)| (y, x));
        for n in next { visited.insert(n); queue.push_back(n); }
    }
    for cell in road_order { slots.push(Slot { kind: SlotKind::Road, stage: stages[&cell], cells: vec![cell], alternates: vec![] }); seen.insert(cell); }
    let ordered: Vec<((i32, i32), char)> = {
        let mut cells: Vec<_> = symbols.iter().map(|(c, s)| (*c, *s)).collect();
        cells.sort_by_key(|&((x, y), _)| (y, x)); cells
    };
    for &(cell, symbol) in &ordered {
        if seen.contains(&cell) { continue; }
        let stage = stages.get(&cell).copied().unwrap_or(0);
        match symbol {
            '~' => { water.push(cell); }
            'P' => {}
            'H' => slots.push(Slot { kind: SlotKind::Hub, stage: 0, cells: vec![cell], alternates: vec![] }),
            'h' | 'W' if stage == 0 => slots.push(Slot { kind: SlotKind::Tent, stage: 0, cells: vec![cell], alternates: vec![] }),
            'h' | 'W' => {
                // A house group: 4-connected houses first built in the same stage.
                let mut group = vec![cell]; let mut index = 0; seen.insert(cell);
                while index < group.len() {
                    let c = group[index]; index += 1;
                    for (dx, dy) in NEIGHBORS {
                        let n = (c.0 + dx, c.1 + dy);
                        if !seen.contains(&n) && matches!(symbols.get(&n), Some('h') | Some('W')) && stages.get(&n) == Some(&stage) {
                            seen.insert(n); group.push(n);
                        }
                    }
                }
                group.sort_by_key(|&(x, y)| (y, x));
                slots.push(Slot { kind: SlotKind::House, stage, cells: group, alternates: vec![] });
            }
            'G' => slots.push(Slot { kind: SlotKind::GuardPost, stage, cells: vec![cell], alternates: vec![] }),
            'T' => slots.push(Slot { kind: SlotKind::Tower, stage, cells: vec![cell], alternates: vec![] }),
            'Q' => slots.push(Slot { kind: SlotKind::Quay, stage, cells: vec![cell], alternates: vec![] }),
            'A'..='D' => {
                let lot = symbol as u8 - b'A';
                let cells = vec![cell, (cell.0 + 1, cell.1), (cell.0, cell.1 + 1), (cell.0 + 1, cell.1 + 1)];
                for c in &cells { assert_eq!(symbols.get(c), Some(&symbol), "adoption lots are 2x2"); seen.insert(*c); }
                slots.push(Slot { kind: SlotKind::Lot(lot), stage, cells, alternates: vec![] });
            }
            '=' => {}
            other => panic!("unknown template symbol {other}"),
        }
        seen.insert(cell);
    }
    for &(cell, symbol) in &ordered {
        if symbol == 'W' {
            let stage = stages[&cell].max(2);
            slots.push(Slot { kind: SlotKind::Well, stage, cells: vec![cell], alternates: vec![] });
        }
    }
    // Request order: stage, then kind order, then template order (stable sort).
    slots.sort_by_key(|slot| (slot.stage, slot.kind.order(), if let SlotKind::Lot(l) = slot.kind { l } else { 0 }));
    let mut template = Template { family: source.family, slots, water, symbols, stages };
    let alternates: Vec<Vec<Vec<(i32, i32)>>> = template.slots.iter().map(|slot| alternates_for(&template, slot)).collect();
    for (slot, alternates) in template.slots.iter_mut().zip(alternates) { slot.alternates = alternates; }
    template
}

fn frontage_cell(template: &Template, cell: (i32, i32), stage: u8) -> Option<(i32, i32)> {
    NEIGHBORS.iter().map(|(dx, dy)| (cell.0 + dx, cell.1 + dy)).find(|n| match template.symbols.get(n) {
        Some('=') => template.stages[n] <= stage, Some('P') => true, _ => false })
}
/// Two template-empty positions along the frontage road axis (1×1 and groups).
fn alternates_for(template: &Template, slot: &Slot) -> Vec<Vec<(i32, i32)>> {
    if !matches!(slot.kind, SlotKind::House | SlotKind::GuardPost | SlotKind::Tower) { return vec![]; }
    let Some((cell, road)) = slot.cells.iter().find_map(|&c| frontage_cell(template, c, 4).map(|r| (c, r))) else { return vec![]; };
    let axis = if road.0 != cell.0 { (0, 1) } else { (1, 0) };
    let own: BTreeSet<(i32, i32)> = slot.cells.iter().copied().collect();
    [1, -1].iter().filter_map(|&sign| {
        let shifted: Vec<(i32, i32)> = slot.cells.iter().map(|c| (c.0 + axis.0 * sign, c.1 + axis.1 * sign)).collect();
        shifted.iter().all(|c| own.contains(c) || !template.symbols.contains_key(c)).then_some(shifted)
    }).collect()
}

thread_local! { static TEMPLATES: Vec<Template> = (0..SOURCES.len()).map(parse).collect(); }
pub fn with_template<R>(family: u8, f: impl FnOnce(&Template) -> R) -> Option<R> {
    if family == FAMILY_NONE || family as usize > SOURCES.len() { return None; }
    Some(TEMPLATES.with(|templates| f(&templates[family as usize - 1])))
}

/// Eight orientations: four rotations about the lot center, then a mirror.
pub fn transform(cell: (i32, i32), t: u8) -> (i32, i32) {
    let (mut u, mut v) = (2 * cell.0 - 1, 2 * cell.1 - 1);
    for _ in 0..(t % 4) { (u, v) = (-v, u); }
    if t >= 4 { u = -u; }
    ((u + 1) / 2, (v + 1) / 2)
}
pub fn place(lot: (i32, i32), cell: (i32, i32), t: u8) -> (i32, i32) { let c = transform(cell, t); (lot.0 + c.0, lot.1 + c.1) }
/// World footprint of a slot: its top-left corner and size after transform.
pub fn footprint(lot: (i32, i32), cells: &[(i32, i32)], t: u8) -> Vec<(i32, i32)> { cells.iter().map(|&c| place(lot, c, t)).collect() }

pub fn splitmix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

pub struct Patch<'a> { pub cells: &'a [f64] }
impl Patch<'_> {
    pub fn code(&self, x: i32, y: i32) -> u32 {
        if x < 0 || y < 0 || x >= PATCH || y >= PATCH { return BLOCKED; }
        let value = self.cells[(y * PATCH + x) as usize];
        if value.is_finite() && value >= 0.0 { value as u32 } else { BLOCKED }
    }
    fn at(&self, local: (i32, i32)) -> u32 { self.code(local.0 + PATCH_HALF, local.1 + PATCH_HALF) }
    fn level(&self, local: (i32, i32)) -> u32 { (self.at(local) >> 8) & 15 }
    fn open(&self, local: (i32, i32)) -> bool { let c = self.at(local); c & OPEN != 0 && c & (BLOCKED | WATER) == 0 }
    fn buildable(&self, local: (i32, i32)) -> bool { let c = self.at(local); c & (OPEN | CLEARABLE) != 0 && c & (BLOCKED | WATER) == 0 }
    fn water(&self, local: (i32, i32)) -> bool { self.at(local) & WATER != 0 }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Choice { pub family: u8, pub transform: u8, pub score: f64, pub hub: (i32, i32), pub tents: [(i32, i32); 2] }

/// Small independent harbors need not fit the long riverside template. Keep
/// the civic lot and founding homes clear, and prefer the closest dry bank.
pub fn founding_dock(patch: &Patch, choice: &Choice) -> Option<(i32, i32)> {
    let reserved = |p: (i32, i32)| p == choice.hub || choice.tents.contains(&p)
        || (0..=1).contains(&p.0) && (0..=1).contains(&p.1);
    let mut candidates = Vec::new();
    for y in -8..=8 { for x in -8..=8 {
        let p = (x, y);
        if reserved(p) || !patch.buildable(p) { continue; }
        let water = NEIGHBORS.iter().any(|&(dx, dy)| {
            let n = (x + dx, y + dy);
            patch.at(n) & 32 != 0 && patch.level(n) == patch.level(p)
        });
        let approach = NEIGHBORS.iter().any(|&(dx, dy)| {
            let n = (x + dx, y + dy);
            !reserved(n) && patch.open(n) && patch.level(n) == patch.level(p)
        });
        if water && approach { candidates.push((x * x + y * y, y, x)); }
    } }
    candidates.sort_unstable();
    candidates.first().map(|&(_, y, x)| (x, y))
}

fn stage_weight(stage: u8) -> f64 { match stage { 1 => 4.0, 2 => 3.0, 3 => 2.0, _ => 1.0 } }

/// Founding fit for one family and orientation (lot origin at the patch center).
pub fn fit(template: &Template, patch: &Patch, t: u8) -> Option<(f64, (i32, i32), [(i32, i32); 2])> {
    let at = |c: (i32, i32)| transform(c, t);
    if ![(0, 0), (1, 0), (0, 1), (1, 1)].iter().all(|&c| patch.open(at(c))) { return None; }
    let hub = template.slots.iter().find(|s| s.kind == SlotKind::Hub)?.cells[0];
    let tents: Vec<(i32, i32)> = template.slots.iter().filter(|s| s.kind == SlotKind::Tent).map(|s| s.cells[0]).collect();
    if tents.len() != 2 || !patch.open(at(hub)) || !tents.iter().all(|&c| patch.open(at(c))) { return None; }
    let structures: BTreeSet<(i32, i32)> = template.symbols.iter().filter(|(_, s)| !matches!(s, '=' | '~')).map(|(c, _)| at(*c)).collect();
    if !NEIGHBORS.iter().any(|(dx, dy)| { let door = (at(hub).0 + dx, at(hub).1 + dy); patch.open(door) && !structures.contains(&door) }) { return None; }
    if template.family == RIVERSIDE {
        let wet = template.water.iter().filter(|&&c| patch.water(at(c))).count();
        if (wet as f64) < 0.7 * template.water.len() as f64 { return None; }
    }
    let mut score = 0.0;
    for slot in &template.slots {
        let cells: Vec<(i32, i32)> = slot.cells.iter().map(|&c| at(c)).collect();
        let valid = match slot.kind {
            SlotKind::Quay => cells.iter().all(|&c| patch.buildable(c) && NEIGHBORS.iter().any(|(dx, dy)| patch.water((c.0 + dx, c.1 + dy)))),
            SlotKind::Road => cells.iter().all(|&c| patch.buildable(c) || patch.at(c) & FORD != 0),
            _ => cells.iter().all(|&c| patch.buildable(c))
                && (template.family != HILL_CLUSTER || slot.kind != SlotKind::House
                    || cells.iter().all(|&c| patch.level(c) == patch.level(cells[0]))),
        };
        if valid { score += stage_weight(slot.stage); }
    }
    score *= match template.family {
        RIVERSIDE => 1.5,
        HILL_CLUSTER if hilly(patch) => 1.4,
        ROADSIDE if long_run(patch) => 1.2,
        _ => 1.0,
    };
    Some((score, at(hub), [at(tents[0]), at(tents[1])]))
}

fn hilly(patch: &Patch) -> bool {
    let (mut edges, mut sum, mut squares) = (0usize, 0.0, 0.0);
    let total = (PATCH * PATCH) as f64;
    for y in 0..PATCH { for x in 0..PATCH {
        let level = (patch.code(x, y) >> 8) & 15;
        sum += level as f64; squares += (level * level) as f64;
        if NEIGHBORS.iter().any(|(dx, dy)| { let (nx, ny) = (x + dx, y + dy);
            nx >= 0 && ny >= 0 && nx < PATCH && ny < PATCH && (patch.code(nx, ny) >> 8) & 15 != level }) { edges += 1; }
    } }
    let mean = sum / total;
    edges as f64 >= 0.12 * total || (squares / total - mean * mean).max(0.0).sqrt() >= 0.6
}
fn long_run(patch: &Patch) -> bool {
    let open = |x: i32, y: i32| patch.code(x, y) & (OPEN | CLEARABLE) != 0 && patch.code(x, y) & (BLOCKED | WATER) == 0;
    let run = |dx: i32, dy: i32| {
        let mut count = 1; let (cx, cy) = (PATCH_HALF, PATCH_HALF);
        for sign in [1, -1] { let mut k = 1; while open(cx + dx * k * sign, cy + dy * k * sign) { count += 1; k += 1; } }
        count
    };
    open(PATCH_HALF, PATCH_HALF) && (run(1, 0) >= 17 || run(0, 1) >= 17)
}

/// Best family and orientation; ties go to the lower seeded hash.
pub fn choose(patch: &Patch, seed: u64, village: i64, force_family: u8) -> Option<Choice> {
    let mut best: Option<(Choice, u64)> = None;
    for family in FAMILIES {
        if force_family != FAMILY_NONE && family != force_family { continue; }
        with_template(family, |template| {
            for t in 0..8u8 {
                let Some((score, hub, tents)) = fit(template, patch, t) else { continue; };
                let hash = splitmix(seed ^ splitmix(village as u64 ^ ((family as u64) << 40) ^ ((t as u64) << 48)));
                let better = match &best { None => true, Some((choice, h)) => score > choice.score || score == choice.score && hash < *h };
                if better { best = Some((Choice { family, transform: t, score, hub, tents }, hash)); }
            }
        });
    }
    best.map(|(choice, _)| choice)
}

/// Template frontage rule for a slot's cells at a given stage.
#[cfg(test)]
pub fn has_frontage(template: &Template, cells: &[(i32, i32)], stage: u8) -> bool {
    cells.iter().any(|&c| frontage_cell(template, c, stage).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn all() -> Vec<Template> { (0..SOURCES.len()).map(parse).collect() }

    #[test]
    fn templates_parse_with_equal_layers() {
        for template in all() {
            assert!(template.slots.iter().any(|s| s.kind == SlotKind::Hub));
            assert_eq!(template.slots.iter().filter(|s| s.kind == SlotKind::Tent).count(), 2);
            for lot in 0..4u8 { assert!(template.slots.iter().any(|s| s.kind == SlotKind::Lot(lot)), "family {} lot {lot}", template.family); }
            assert_eq!(template.symbols.get(&(0, 0)), Some(&'P'));
            assert_eq!(template.symbols.get(&(1, 1)), Some(&'P'));
        }
    }

    #[test]
    fn no_overlaps_except_well_and_tent_conversion() {
        for template in all() {
            let mut used: BTreeMap<(i32, i32), SlotKind> = BTreeMap::new();
            for slot in &template.slots { for &c in &slot.cells {
                if let Some(previous) = used.insert(c, slot.kind) {
                    assert!(matches!((previous, slot.kind), (SlotKind::House, SlotKind::Well) | (SlotKind::Well, SlotKind::House)),
                        "family {} overlap at {c:?}", template.family);
                }
            } }
        }
    }

    #[test]
    fn roads_connected_to_lot_at_every_stage() {
        for template in all() { for stage in 0..=4u8 {
            let roads: BTreeSet<(i32, i32)> = template.slots.iter().filter(|s| s.kind == SlotKind::Road && s.stage <= stage).map(|s| s.cells[0]).collect();
            let mut reached = BTreeSet::new(); let mut queue: VecDeque<(i32, i32)> = roads.iter().copied()
                .filter(|c| NEIGHBORS.iter().any(|(dx, dy)| template.symbols.get(&(c.0 + dx, c.1 + dy)) == Some(&'P'))).collect();
            while let Some(c) = queue.pop_front() {
                if !reached.insert(c) { continue; }
                for (dx, dy) in NEIGHBORS { let n = (c.0 + dx, c.1 + dy); if roads.contains(&n) && !reached.contains(&n) { queue.push_back(n); } }
            }
            assert_eq!(reached.len(), roads.len(), "family {} stage {stage}", template.family);
        } }
    }

    #[test]
    fn every_building_has_frontage_at_its_stage() {
        for template in all() { for slot in &template.slots {
            if matches!(slot.kind, SlotKind::Road | SlotKind::Tower | SlotKind::Well) { continue; }
            // Founding tents and the hub front the first stage-1 lane.
            let stage = if matches!(slot.kind, SlotKind::Tent | SlotKind::Hub) { 1 } else { slot.stage };
            assert!(has_frontage(&template, &slot.cells, stage), "family {} {:?} at {:?}", template.family, slot.kind, slot.cells);
        } }
    }

    #[test]
    fn riverside_bank_row_reserved() {
        let template = parse(2);
        let bank = template.water[0].1 + 1;
        for (cell, symbol) in &template.symbols {
            if cell.1 == bank { assert!(matches!(symbol, 'Q' | 'T'), "bank holds {symbol}"); }
            if cell.1 < bank { assert_eq!(*symbol, '~'); }
        }
    }

    #[test]
    fn stage_counts_match_the_design_tables() {
        let houses = |t: &Template, s: u8| t.slots.iter().filter(|x| x.stage <= s && x.kind == SlotKind::House).map(|x| x.cells.len()).sum::<usize>()
            + if s >= 3 { 2 } else { 0 };
        let roads = |t: &Template, s: u8| t.slots.iter().filter(|x| x.stage <= s && x.kind == SlotKind::Road).count();
        let roadside = parse(0);
        assert_eq!((1..=4).map(|s| roads(&roadside, s)).collect::<Vec<_>>(), vec![8, 14, 18, 26]);
        assert_eq!(houses(&roadside, 4), 20);
        let market = parse(1);
        assert_eq!((1..=4).map(|s| roads(&market, s)).collect::<Vec<_>>(), vec![11, 17, 25, 29]);
    }

    #[test]
    fn transforms_preserve_validity() {
        let mut seen = BTreeSet::new();
        for t in 0..8u8 {
            for c in [(0, 0), (1, 0), (0, 1), (1, 1)] { assert!([(0, 0), (1, 0), (0, 1), (1, 1)].contains(&transform(c, t))); }
            seen.insert((transform((5, 2), t), transform((-3, 1), t)));
            // Distances between cells are preserved.
            let (a, b) = (transform((4, -2), t), transform((-1, 3), t));
            assert_eq!((a.0 - b.0).abs() + (a.1 - b.1).abs(), 10);
        }
        assert_eq!(seen.len(), 8);
    }

    fn flat_patch() -> Vec<f64> { vec![OPEN as f64; (PATCH * PATCH) as usize] }

    #[test]
    fn choice_is_deterministic_and_seed_sensitive() {
        let cells = flat_patch(); let patch = Patch { cells: &cells };
        let a = choose(&patch, 7, 1, 0).unwrap();
        assert_eq!(choose(&patch, 7, 1, 0).unwrap(), a);
        let distinct: BTreeSet<(u8, u8)> = (0..24u64).map(|seed| { let c = choose(&patch, seed, 1, 0).unwrap(); (c.family, c.transform) }).collect();
        assert!(distinct.len() > 1);
        assert_ne!(a.family, RIVERSIDE);
    }

    #[test]
    fn riverside_requires_water() {
        let mut cells = flat_patch();
        assert!(choose(&Patch { cells: &cells }, 1, 1, RIVERSIDE).is_none());
        for y in 0..10 { for x in 0..PATCH { cells[(y * PATCH + x) as usize] = WATER as f64; } }
        let choice = choose(&Patch { cells: &cells }, 1, 1, 0).unwrap();
        assert_eq!(choice.family, RIVERSIDE);
        with_template(RIVERSIDE, |t| for &c in &t.water {
            let p = transform(c, choice.transform); assert!(p.1 + PATCH_HALF < 10);
        });
    }

    #[test]
    fn hill_prefers_ridges() {
        let mut cells = flat_patch();
        for y in 0..PATCH { for x in 0..PATCH { if (x / 3 + y / 4) % 2 == 1 { cells[(y * PATCH + x) as usize] = (OPEN | (1 << 8)) as f64; } } }
        let patch = Patch { cells: &cells };
        assert!(hilly(&patch));
        let hill = with_template(HILL_CLUSTER, |t| (0..8).filter_map(|tr| fit(t, &patch, tr)).map(|f| f.0).fold(0.0, f64::max)).unwrap();
        assert!(hill > 0.0);
    }

    #[test]
    fn alternates_shift_along_the_frontage_axis() {
        let template = parse(0);
        let guard = template.slots.iter().find(|s| s.kind == SlotKind::GuardPost && s.stage == 2).unwrap();
        assert_eq!(guard.cells, vec![(-5, 1)]);
        assert!(guard.alternates.contains(&vec![(-6, 1)]) || guard.alternates.contains(&vec![(-4, 1)]));
        for slot in &template.slots { for alternate in &slot.alternates {
            for c in alternate { assert!(slot.cells.contains(c) || !template.symbols.contains_key(c)); }
        } }
    }
}
