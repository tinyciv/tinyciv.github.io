//! Shared recurring charges for actual payments and committed AI budgets.
const WATCHTOWER_UPKEEP: f64 = 5.0;

pub fn watchtower(human: bool) -> f64 {
    if human { WATCHTOWER_UPKEEP } else { 0.0 }
}
