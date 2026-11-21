use super::kinds::building::*;

// Tiers are the unlocked civic capacity. Houses still provide the actual beds.
const CAPACITY: [f64; 4] = [80.0, 150.0, 300.0, f64::INFINITY];
const COST: [f64; 4] = [0.0, 500.0, 1250.0, 3000.0];
const BUILDINGS: [u32; 4] = [0, 3, 6, 10];

pub fn term(tier: usize, field: u32) -> f64 {
    if tier >= CAPACITY.len() { return f64::NAN; }
    match field {
        0 => CAPACITY[tier],
        1 => COST[tier],
        2 => f64::from(BUILDINGS[tier]),
        _ => f64::NAN,
    }
}

pub fn for_population(population: f64) -> u32 {
    CAPACITY.iter().position(|&capacity| population <= capacity).unwrap_or(CAPACITY.len() - 1) as u32
}

pub fn upgrade(tier: usize, buildings: u32, gold: f64) -> u32 {
    let Some(next) = tier.checked_add(1).filter(|&next| next < CAPACITY.len()) else { return 1; };
    if buildings < BUILDINGS[next] { return 2; }
    if !(gold >= COST[next]) { return 3; }
    0
}

pub fn civic(kind: u32) -> bool {
    matches!(kind, DOCK | WELL | MONUMENT | BLACKSMITH | ARCHERY_RANGE | SCOUT_LODGE | HEALER_SHACK |
        STABLE | LIBRARY | COLOSSEUM | BARRACKS | FORUM | GRANARY | THERMAL_BATH | SHIPYARD |
        WHALING_POST | FOUNDRY | MILITARY_ACADEMY | FACTORY | MARKETPLACE | FOUNTAIN)
}
