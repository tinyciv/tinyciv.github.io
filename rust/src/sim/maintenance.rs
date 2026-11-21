//! Shared recurring charges for actual payments and committed AI budgets.
const WATCHTOWER_UPKEEP: f64 = 5.0;
pub const SETTLEMENT_UPKEEP: f64 = 5.0;
pub const SETTLEMENT_UPKEEP_GRACE: f64 = 180.0;
const FIRST_TOWN_RESIDENTS: u32 = 4;

pub fn watchtower(human: bool) -> f64 {
    if human { WATCHTOWER_UPKEEP } else { 0.0 }
}

pub fn founding_residents(available: bool) -> u32 {
    if available { FIRST_TOWN_RESIDENTS } else { 0 }
}
