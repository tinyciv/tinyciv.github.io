//! Research accounts are resident Bevy components. Static content is installed
//! once; dependency choice, funding, time integration and completion events are
//! simulation systems. No treasury is charged by advancing an account.
use bevy_ecs::prelude::*;
use bevy_ecs::schedule::SingleThreadedExecutor;
use std::collections::BTreeMap;
use std::sync::Arc;

pub const INPUT_HEADER: usize = 15;
pub const OUTPUT_HEADER: usize = 20;
pub const CREATED: u32 = 1;
pub const FOCUS: u32 = 2;
pub const CREDIT: u32 = 4;
pub const RESERVED: u32 = 8;
pub const FUNDING: u32 = 16;
pub const RECEIPTS: u32 = 32;
pub const PRIORITIES: u32 = 64;
pub const ALLOCATION: u32 = 128;
pub const PROGRESS: u32 = 256;

pub fn constant(index: u32) -> f64 { match index { 0 => 0.25, 1 | 2 => 30.0, 3 => 5.0, _ => panic!("unknown research constant") } }
fn minimum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) } }
fn maximum(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }
fn or_zero(value: f64) -> f64 { if value.is_nan() { 0.0 } else { value } }
pub fn level(value: f64) -> f64 { maximum(0.0, minimum(1.0, or_zero(value).floor())) }
pub fn allocation(value: f64) -> f64 { if value.is_finite() { maximum(0.0, minimum(1.0, value)) } else { constant(0) } }
pub fn library_multiplier(cities: usize) -> f64 {
    let bonuses = [0.30, 0.20, 0.14, 0.09, 0.06]; let mut multiplier = 1.0;
    for extra in 0..cities.saturating_sub(1) {
        multiplier += bonuses.get(extra).copied().unwrap_or_else(|| 0.06 * (2.0_f64 / 3.0).powi(extra as i32 - 4));
    }
    multiplier
}

#[derive(Clone, Default)]
struct Node { points: f64, prerequisites: u64 }
#[derive(Clone, Default)]
pub struct Graph { nodes: Vec<Node> }
impl Graph { pub fn cost(&self, branch: usize, bonus: f64, tutorial: bool) -> f64 { self.nodes[branch].points * if tutorial {0.1} else {1.0} / (1.0 + maximum(0.0, bonus)) } }

/// Tech cost rises linearly with tree depth: roots cost 1.2x their listed
/// points and the deepest tier 5x. Depth is the longest prerequisite chain.
const ROOT_COST_SCALE: f64 = 1.2;
const DEEPEST_COST_SCALE: f64 = 5.0;
fn depth_scaled(mut nodes: Vec<Node>) -> Vec<Node> {
    let count = nodes.len();
    let mut depth = vec![0usize; count];
    // Longest-path relaxation; prerequisite chains are acyclic and at most `count` long.
    for _ in 0..count {
        let mut changed = false;
        for id in 0..count {
            let deepest = (0..count).filter(|&p| nodes[id].prerequisites & (1u64 << p) != 0).map(|p| depth[p] + 1).max().unwrap_or(0);
            if deepest > depth[id] { depth[id] = deepest; changed = true; }
        }
        if !changed { break; }
    }
    let max_depth = depth.iter().copied().max().unwrap_or(0);
    for (node, &d) in nodes.iter_mut().zip(&depth) {
        let t = if max_depth == 0 { 0.0 } else { d as f64 / max_depth as f64 };
        node.points *= ROOT_COST_SCALE + (DEEPEST_COST_SCALE - ROOT_COST_SCALE) * t;
    }
    nodes
}
#[derive(Resource)]
struct Content(Arc<Graph>);
#[derive(Clone, Copy, Default)]
struct Funding { points: f64, remaining: f64 }
#[derive(Clone, Copy, Default)]
struct Receipt { time: f64, points: f64 }
#[derive(Component, Default)]
struct Account {
    exists: bool, tutorial:bool, focus: i32, allocation: f64, credit: f64, reserved_gold: f64, bonus: f64,
    levels: Vec<f64>, progress: Vec<f64>, priorities: Vec<i32>, funding: Vec<Funding>, receipts: Vec<Receipt>,
    funding_present: bool, receipts_present: bool, priorities_present: bool,
}
#[derive(Component, Default)]
struct Context { library: bool, defeated: bool, game_over: bool, paused: bool, faction: bool }
#[derive(Resource, Default)]
struct Step {
    mode: u32, now: f64, dt: f64, gross: f64, efficiency: f64, target: f64,
    flags: u32, error: u32, refund: f64, diverted: f64, completions: Vec<usize>,
    level_changes: u64, progress_changes: u64,
}

fn learned(account: &Account) -> u64 {
    account.levels.iter().enumerate().fold(0, |mask, (index, value)| if level(*value) > 0.0 { mask | (1_u64 << index) } else { mask })
}
fn normalized_priorities(account: &Account, count: usize) -> Vec<usize> {
    let mut seen = 0; let known = learned(account); let mut result = Vec::new();
    for &value in &account.priorities {
        if value < 0 || value as usize >= count { continue; }
        let bit = 1_u64 << value;
        if (known | seen) & bit == 0 { result.push(value as usize); seen |= bit; }
    }
    result
}
fn clean_priorities(account: &mut Account, count: usize) {
    let mut seen = 0; let known = learned(account);
    account.priorities.retain(|&value| {
        if value < 0 || value as usize >= count { return false; }
        let bit = 1_u64 << value;
        if (known | seen) & bit != 0 { false } else { seen |= bit; true }
    });
}
fn mark_needed(id: usize, graph: &Graph, known: u64, needed: &mut u64) {
    let bit = 1_u64 << id;
    if (known | *needed) & bit != 0 { return; }
    *needed |= bit;
    let prerequisites = graph.nodes[id].prerequisites;
    for id in 0..graph.nodes.len() { if prerequisites & (1_u64 << id) != 0 { mark_needed(id, graph, known, needed); } }
}
fn focus(account: &Account, graph: &Graph) -> Option<usize> {
    let known = learned(account);
    let requested = account.priorities.iter().find(|&&id| id >= 0 && (id as usize) < graph.nodes.len() && known & (1_u64 << id) == 0);
    let mut needed = 0;
    if let Some(&id) = requested { mark_needed(id as usize, graph, known, &mut needed); }
    let mut best = None;
    for (id, node) in graph.nodes.iter().enumerate() {
        if known & (1_u64 << id) != 0 || requested.is_some() && needed & (1_u64 << id) == 0
            || node.prerequisites & known != node.prerequisites { continue; }
        if best.is_none_or(|previous| graph.cost(id, account.bonus, account.tutorial) < graph.cost(previous, account.bonus, account.tutorial)) { best = Some(id); }
    }
    best
}
fn reserved(account: &Account) -> f64 {
    maximum(0.0, or_zero(account.credit)) + account.funding.iter().map(|receipt| receipt.points).sum::<f64>()
}
fn remaining(account: &Account, graph: &Graph) -> f64 {
    graph.nodes.iter().enumerate().map(|(id, _)| if level(account.levels[id]) > 0.0 { 0.0 }
        else { maximum(0.0, graph.cost(id, account.bonus, account.tutorial) - or_zero(account.progress[id])) }).sum()
}
fn ensure(account: &mut Account, step: &mut Step) { if !account.exists { account.exists = true; account.focus = 0; step.flags |= CREATED; } }

fn control_account(content: Res<Content>, mut step: ResMut<Step>, mut accounts: Query<&mut Account>) {
    if step.mode < 3 { return; }
    let graph = &content.0;
    for mut account in &mut accounts {
        if step.mode == 5 {
            if !step.target.is_finite() || step.target < 0.0 || step.target > 1.0 { step.error = 2; continue; }
            ensure(&mut account, &mut step); account.allocation = step.target; step.flags |= ALLOCATION; continue;
        }
        let id = step.target as i32;
        if !step.target.is_finite() || id < 0 || id as usize >= graph.nodes.len() {
            step.error = if step.mode == 3 { 1 } else { 3 }; continue;
        }
        if step.mode == 6 {
            let id = id as usize;
            if level(account.levels[id]) > 0.0 || graph.nodes[id].prerequisites & learned(&account) != graph.nodes[id].prerequisites {
                step.error = 3; continue;
            }
            ensure(&mut account, &mut step);
            complete(&mut account, graph, id, &mut step);
            if let Some(next) = focus(&account, graph) { account.focus = next as i32; step.flags |= FOCUS; }
            continue;
        }
        if step.mode == 3 && level(account.levels[id as usize]) > 0.0 { step.error = 1; continue; }
        ensure(&mut account, &mut step); clean_priorities(&mut account, graph.nodes.len());
        account.priorities.retain(|value| *value != id);
        if step.mode == 3 { account.priorities.insert(0, id); }
        account.priorities_present = true; step.flags |= PRIORITIES;
        if let Some(id) = focus(&account, graph) { account.focus = id as i32; step.flags |= FOCUS; }
    }
}

fn refund_excess(content: Res<Content>, mut step: ResMut<Step>, mut accounts: Query<(&mut Account, &Context)>) {
    if step.mode != 6 && (step.mode != 2 || !step.dt.is_finite() || step.dt <= 0.0) { return; }
    for (mut account, context) in &mut accounts {
        if !account.exists || context.defeated || (context.paused && step.mode != 6) || context.game_over { continue; }
        let reserve = reserved(&account); if reserve <= 1e-9 { continue; }
        let excess = reserve - remaining(&account, &content.0); if excess <= 1e-8 { continue; }
        let mut left = excess;
        let credit = minimum(left, or_zero(account.credit));
        account.credit = maximum(0.0, or_zero(account.credit) - credit); left -= credit;
        step.flags |= CREDIT;
        let mut index = account.funding.len();
        while index > 0 && left > 1e-9 {
            index -= 1;
            let receipt = &mut account.funding[index]; let removed = minimum(left, receipt.points);
            receipt.points -= removed; left -= removed;
            if receipt.points <= 1e-9 { account.funding.remove(index); }
            step.flags |= FUNDING;
        }
        let paid = if account.reserved_gold.is_nan() { reserve } else { account.reserved_gold };
        let gold = paid * (excess - left) / reserve;
        account.reserved_gold = maximum(0.0, paid - gold); step.refund += gold; step.flags |= RESERVED;
    }
}

fn allocate_income(content: Res<Content>, mut step: ResMut<Step>, mut accounts: Query<(&mut Account, &Context)>) {
    if step.mode != 1 { return; }
    for (mut account, context) in &mut accounts {
        if !step.gross.is_finite() || step.gross <= 0.0 || context.defeated || context.game_over || !context.library { continue; }
        let offered = step.gross * allocation(account.allocation); if offered == 0.0 { continue; }
        let Some(focus) = focus(&account, &content.0) else { continue; };
        ensure(&mut account, &mut step);
        let reserve = reserved(&account);
        let diverted = minimum(offered, maximum(0.0, remaining(&account, &content.0) - reserve) / step.efficiency);
        if diverted <= 1e-9 { continue; }
        account.reserved_gold = (if account.reserved_gold.is_nan() { reserve } else { account.reserved_gold }) + diverted;
        let science = diverted * step.efficiency;
        account.focus = focus as i32; step.flags |= FOCUS | RESERVED | FUNDING | RECEIPTS;
        let funding_seconds=constant(2)*if account.tutorial {0.1} else {1.0};
        if let Some(previous) = account.funding.last_mut().filter(|receipt| receipt.remaining == funding_seconds) { previous.points += science; }
        else { account.funding.push(Funding { points: science, remaining: funding_seconds }); }
        account.funding_present = true;
        account.receipts.retain(|receipt| receipt.time > step.now - constant(1));
        let second = step.now.floor();
        if let Some(previous) = account.receipts.last_mut().filter(|receipt| receipt.time == second) { previous.points += science; }
        else { account.receipts.push(Receipt { time: second, points: science }); }
        account.receipts_present = true; step.diverted += diverted;
    }
}

fn complete(account: &mut Account, graph: &Graph, id: usize, step: &mut Step) {
    account.levels[id] = 1.0; account.progress[id] = graph.cost(id, account.bonus, account.tutorial);
    clean_priorities(account, graph.nodes.len()); account.priorities_present = true;
    step.flags |= PROGRESS | PRIORITIES; step.completions.push(id);
    step.level_changes |= 1_u64 << id; step.progress_changes |= 1_u64 << id;
}

fn advance_funded(content: Res<Content>, mut step: ResMut<Step>, mut accounts: Query<(&mut Account, &Context)>) {
    if step.mode != 2 || !step.dt.is_finite() || step.dt <= 0.0 { return; }
    let graph = &content.0;
    for (mut account, context) in &mut accounts {
        if !account.exists || context.defeated || context.paused || context.game_over { continue; }
        let mut selected = focus(&account, graph);
        let Some(id) = selected else { continue; };
        account.focus = id as i32; step.flags |= FOCUS;
        if !context.library { continue; }
        let reserved_before = reserved(&account);
        let mut credit = maximum(0.0, or_zero(account.credit));
        for receipt in &mut account.funding {
            let elapsed = minimum(step.dt, receipt.remaining);
            let released = if receipt.remaining > 0.0 { receipt.points * elapsed / receipt.remaining } else { receipt.points };
            credit += released; receipt.points -= released; receipt.remaining -= elapsed;
        }
        if account.funding_present { account.funding.retain(|receipt| receipt.points > 1e-9 && receipt.remaining > 1e-9); step.flags |= FUNDING; }
        let mut elapsed = step.dt;
        for _ in 0..graph.nodes.len() {
            let Some(id) = selected else { break; }; if !(elapsed > 1e-9) { break; }
            account.focus = id as i32;
            let required = graph.cost(id, account.bonus, account.tutorial); let previous = or_zero(account.progress[id]);
            if previous + 1e-8 >= required { complete(&mut account, graph, id, &mut step); selected = focus(&account, graph); continue; }
            if credit <= 1e-9 { break; }
            // Keep the absolute Science processing rate: a tenth-cost Tutorial
            // technology completes in a tenth of the ordinary minimum time.
            let rate = graph.cost(id, account.bonus, false) * constant(3) / 100.0;
            let spent = minimum(minimum(credit, maximum(0.0, required - previous)), rate * elapsed);
            account.progress[id] = previous + spent; credit -= spent; elapsed -= spent / rate; step.flags |= PROGRESS;
            step.progress_changes |= 1_u64 << id;
            if account.progress[id] + 1e-8 < required { break; }
            complete(&mut account, graph, id, &mut step); selected = focus(&account, graph);
        }
        account.credit = maximum(0.0, credit);
        account.reserved_gold = if reserved_before > 0.0 {
            (if account.reserved_gold.is_nan() { reserved_before } else { account.reserved_gold }) * reserved(&account) / reserved_before
        } else { 0.0 };
        step.flags |= CREDIT | RESERVED;
        if let Some(id) = selected { account.focus = id as i32; }
    }
}

pub struct ResearchEngine {
    world: World, schedule: Schedule, entity: Entity, graph: Arc<Graph>, input: Vec<f64>, output: Vec<f64>,
    priorities: usize, funding: usize, receipts: usize,
}
impl ResearchEngine {
    pub fn new(graph: Arc<Graph>) -> Self {
        let mut world = World::new(); world.insert_resource(Content(graph.clone())); world.init_resource::<Step>();
        let entity = world.spawn((Account::default(), Context::default())).id();
        let mut schedule = Schedule::default(); schedule.set_executor(SingleThreadedExecutor::new());
        schedule.add_systems((control_account, refund_excess, allocate_income, advance_funded).chain());
        Self { world, schedule, entity, graph, input: Vec::new(), output: Vec::new(), priorities: 0, funding: 0, receipts: 0 }
    }
    pub fn prepare(&mut self, priorities: usize, funding: usize, receipts: usize) -> *mut f64 {
        self.priorities = priorities; self.funding = funding; self.receipts = receipts;
        let length = INPUT_HEADER + 2 * self.graph.nodes.len() + priorities + 2 * funding + 2 * receipts;
        if self.input.len() < length { self.input.resize(length, 0.0); }
        self.input.as_mut_ptr()
    }
    pub fn run(&mut self, mode: u32, now: f64, dt: f64, gross: f64, efficiency: f64, target: f64) -> *const f64 {
        let count = self.graph.nodes.len();
        {
            let mut account = self.world.get_mut::<Account>(self.entity).expect("research account");
            let input = &self.input;
            account.exists = input[0] != 0.0; account.focus = input[1] as i32; account.allocation = input[2];
            account.credit = input[3]; account.reserved_gold = input[4]; account.bonus = input[5]; account.tutorial = input[14] == 2.0;
            account.funding_present = input[10] != 0.0; account.receipts_present = input[11] != 0.0; account.priorities_present = input[12] != 0.0;
            account.levels.resize(count, f64::NAN); account.progress.resize(count, f64::NAN);
            for id in 0..count { account.levels[id] = input[INPUT_HEADER + id * 2]; account.progress[id] = input[INPUT_HEADER + id * 2 + 1]; }
            let mut offset = INPUT_HEADER + 2 * count;
            account.priorities.clear(); account.priorities.extend(input[offset..offset + self.priorities].iter().map(|value| *value as i32)); offset += self.priorities;
            account.funding.resize(self.funding, Funding::default());
            for row in 0..self.funding { account.funding[row] = Funding { points: input[offset], remaining: input[offset + 1] }; offset += 2; }
            account.receipts.resize(self.receipts, Receipt::default());
            for row in 0..self.receipts { account.receipts[row] = Receipt { time: input[offset], points: input[offset + 1] }; offset += 2; }
        }
        *self.world.get_mut::<Context>(self.entity).expect("research context") = Context { library: self.input[6] != 0.0,
            defeated: self.input[7] != 0.0, game_over: self.input[8] != 0.0, paused: self.input[9] != 0.0, faction: self.input[13] != 0.0 };
        {
            let mut step = self.world.resource_mut::<Step>();
            step.mode = mode; step.now = now; step.dt = dt; step.gross = gross; step.efficiency = efficiency; step.target = target;
            step.flags = 0; step.error = 0; step.refund = 0.0; step.diverted = 0.0; step.completions.clear();
            step.level_changes = 0; step.progress_changes = 0;
        }
        self.schedule.run(&mut self.world);
        let account = self.world.get::<Account>(self.entity).expect("research result");
        let context = self.world.get::<Context>(self.entity).expect("research context");
        let step = self.world.resource::<Step>(); let resolved = focus(account, &self.graph);
        let priorities = normalized_priorities(account, count); let reserve = reserved(account);
        let rate = account.receipts.iter().filter(|receipt| receipt.time > now - constant(1) && receipt.time <= now).map(|receipt| receipt.points).sum::<f64>() / constant(1);
        let active = context.faction && !context.defeated && !context.game_over && !context.paused && context.library
            && resolved.is_some() && (allocation(account.allocation) > 0.0 || reserve > 0.0);
        self.output.clear(); self.output.extend_from_slice(&[step.flags as f64, step.error as f64,
            resolved.map_or(-1.0, |value| value as f64), account.focus as f64, allocation(account.allocation),
            account.credit, account.reserved_gold, reserve, step.refund, step.diverted, account.exists as u32 as f64,
            priorities.len() as f64, account.funding.len() as f64, account.receipts.len() as f64, step.completions.len() as f64,
            rate, remaining(account, &self.graph), active as u32 as f64, step.level_changes as f64, step.progress_changes as f64]);
        for id in 0..count { self.output.extend_from_slice(&[account.levels[id], account.progress[id], level(account.levels[id]), self.graph.cost(id, account.bonus, account.tutorial)]); }
        self.output.extend(priorities.iter().map(|id| *id as f64));
        for receipt in &account.funding { self.output.extend_from_slice(&[receipt.points, receipt.remaining]); }
        for receipt in &account.receipts { self.output.extend_from_slice(&[receipt.time, receipt.points]); }
        self.output.extend(step.completions.iter().map(|id| *id as f64)); self.output.as_ptr()
    }
}

#[derive(Default)]
pub struct Engines { next: u32, engines: BTreeMap<u32, ResearchEngine>, graph: Arc<Graph>, metadata: Vec<f64> }
impl Engines {
    pub fn prepare_graph(&mut self, count: usize) -> *mut f64 {
        assert!(count > 0 && count <= 53, "research graph supports at most 53 safe mask bits");
        self.metadata.resize(count * 2, 0.0); self.metadata.as_mut_ptr()
    }
    pub fn commit_graph(&mut self, count: usize) {
        assert!(self.engines.is_empty(), "research metadata must be installed before accounts");
        assert!(count > 0 && count <= 53 && count * 2 <= self.metadata.len(), "invalid research graph");
        let nodes: Vec<Node> = (0..count).map(|id| Node { points: self.metadata[id * 2], prerequisites: self.metadata[id * 2 + 1] as u64 }).collect();
        self.graph = Arc::new(Graph { nodes: depth_scaled(nodes) });
    }
    pub fn cost(&self, branch: usize, bonus: f64, tutorial:bool) -> f64 { self.graph.cost(branch, bonus, tutorial) }
    pub fn create(&mut self) -> u32 {
        assert!(!self.graph.nodes.is_empty(), "research content not installed");
        self.next = self.next.checked_add(1).expect("research handle overflow");
        self.engines.insert(self.next, ResearchEngine::new(self.graph.clone())); self.next
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut ResearchEngine { self.engines.get_mut(&handle).expect("unknown research account") }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine() -> ResearchEngine {
        ResearchEngine::new(Arc::new(Graph { nodes: vec![Node { points: 24.0, prerequisites: 0 },
            Node { points: 28.0, prerequisites: 1 }, Node { points: 50.0, prerequisites: 2 }, Node { points: 30.0, prerequisites: 0 }] }))
    }
    fn import(engine: &mut ResearchEngine, exists: bool) {
        engine.prepare(0, 0, 0); engine.input.fill(f64::NAN);
        engine.input[0] = exists as u32 as f64; engine.input[1] = 0.0; engine.input[5] = 0.0;
        for index in [6, 13] { engine.input[index] = 1.0; }
        for index in [7,8,9,10,11,12] { engine.input[index] = 0.0; }
    }
    #[test]
    fn queries_do_not_initialize_research_or_materialize_absent_fields() {
        let mut engine = engine(); import(&mut engine, false);
        engine.run(0, 0.0, 0.0, 0.0, 1.0, 0.0);
        assert_eq!(engine.output[0], 0.0); assert_eq!(engine.output[10], 0.0);
        assert!(engine.output[5].is_nan()); assert!(engine.output[6].is_nan()); assert_eq!(engine.output[2], 0.0);
    }
    #[test]
    fn prerequisites_and_cheapest_eligible_order_are_resolved_in_the_ecs() {
        let mut engine = engine(); import(&mut engine, false);
        engine.run(3, 0.0, 0.0, 0.0, 1.0, 2.0);
        assert_eq!(engine.output[2], 0.0); assert_eq!(engine.output[11], 1.0);
        let account = engine.world.get::<Account>(engine.entity).unwrap(); assert_eq!(account.priorities, vec![2]);
        assert_eq!(focus(account, &engine.graph), Some(0));
    }
    #[test]
    fn actual_income_is_reserved_once_without_spending_existing_treasury() {
        let mut engine = engine(); import(&mut engine, false);
        engine.run(1, 0.0, 0.0, 100.0, 1.0, 0.0);
        assert_eq!(engine.output[9], 25.0); assert_eq!(engine.output[7], 25.0); assert_eq!(engine.output[6], 25.0);
        let account = engine.world.get::<Account>(engine.entity).unwrap();
        assert_eq!(account.funding.len(), 1); assert_eq!(account.funding[0].points, 25.0); assert_eq!(account.funding[0].remaining, 30.0);
        assert_eq!(account.receipts[0].points, 25.0);
    }
    #[test]
    fn completion_events_follow_dependencies_and_release_only_paid_credit() {
        let mut engine = engine(); import(&mut engine, true);
        engine.input[3] = 102.0; engine.input[4] = 102.0;
        engine.prepare(1, 0, 0); engine.input[INPUT_HEADER + 8] = 2.0;
        engine.run(2, 0.0, 1000.0, 0.0, 1.0, 0.0);
        let step = engine.world.resource::<Step>(); assert_eq!(step.completions, vec![0,1,2]);
        let account = engine.world.get::<Account>(engine.entity).unwrap(); assert_eq!(account.credit, 0.0);
        assert_eq!(account.levels[..3], [1.0,1.0,1.0]); assert_eq!(account.focus, 3);
    }
    #[test]
    fn progress_rate_is_capped_and_funding_pauses_without_a_library() {
        let mut engine = engine(); import(&mut engine, true); engine.input[3] = 100.0; engine.input[4] = 100.0;
        engine.run(2, 0.2, 0.2, 0.0, 1.0, 0.0);
        let account = engine.world.get::<Account>(engine.entity).unwrap(); assert!((account.progress[0] - 0.24).abs() < 1e-12);
        import(&mut engine, true); engine.input[3] = 20.0; engine.input[6] = 0.0;
        engine.run(2, 1.0, 30.0, 0.0, 1.0, 0.0);
        assert_eq!(engine.output[5], 20.0); assert!(engine.output[OUTPUT_HEADER + 1].is_nan());
    }
    #[test]
    fn tech_cost_scales_linearly_with_depth() {
        let scaled = depth_scaled(vec![Node { points: 10.0, prerequisites: 0 }, Node { points: 10.0, prerequisites: 1 }, Node { points: 10.0, prerequisites: 2 }]);
        assert!((scaled[0].points - 12.0).abs() < 1e-9);
        assert!((scaled[1].points - 31.0).abs() < 1e-9);
        assert!((scaled[2].points - 50.0).abs() < 1e-9);
    }
    #[test]
    fn reduced_costs_refund_actual_gold_not_bonus_science() {
        let mut engine = engine(); import(&mut engine, true);
        engine.input[3] = 66.0; engine.input[4] = 50.0; engine.input[5] = 1.0;
        engine.input[INPUT_HEADER + 2] = 1.0; engine.input[INPUT_HEADER + 4] = 1.0; engine.input[INPUT_HEADER + 6] = 1.0;
        engine.input[6] = 0.0; engine.run(2, 1.0, 0.1, 0.0, 1.0, 0.0);
        assert!((engine.output[8] - 50.0 * 54.0 / 66.0).abs() < 1e-12);
        assert_eq!(engine.output[5], 12.0);
    }
    #[test]
    fn metadata_masks_preserve_dependencies_above_bit_thirty_one() {
        let mut graph = Graph { nodes: vec![Node { points: 1.0, prerequisites: 0 }; 40] };
        graph.nodes[39].prerequisites = 1_u64 << 35;
        let mut account = Account::default(); account.levels.resize(40, f64::NAN); account.progress.resize(40, f64::NAN); account.priorities.push(39);
        assert_eq!(focus(&account, &graph), Some(35)); account.levels[35] = 1.0;
        assert_eq!(focus(&account, &graph), Some(39));
    }
}
