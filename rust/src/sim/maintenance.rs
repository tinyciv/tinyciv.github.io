//! Shared recurring charges for actual payments and committed AI budgets.
const WATCHTOWER_UPKEEP: f64 = 5.0;
const TOWN_UPKEEP: f64 = 25.0;
const TOWN_UPKEEP_GROWTH: f64 = 0.25;
const FIRST_TOWN_UPKEEP_DISCOUNT: f64 = 20.0;
const FIRST_TOWN_RESIDENTS: u32 = 4;

pub fn watchtower(human: bool) -> f64 {
    if human { WATCHTOWER_UPKEEP } else { 0.0 }
}

pub fn town(cities: u32, discounted: bool) -> f64 {
    let upkeep = TOWN_UPKEEP * (1.0 + TOWN_UPKEEP_GROWTH * f64::from(cities.saturating_sub(2)));
    upkeep - if discounted { FIRST_TOWN_UPKEEP_DISCOUNT } else { 0.0 }
}

pub fn founding_residents(available: bool) -> u32 {
    if available { FIRST_TOWN_RESIDENTS } else { 0 }
}
