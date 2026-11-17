//! Culture purchases are sparse ECS commands. Faction snapshots mirror these
//! accounts for ordinary saves and multiplayer replication, as research does.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;
use super::kinds::building;

pub const COSTS: [f64; 19] = [60.0, 100.0, 120.0, 180.0, 80.0, 180.0, 260.0,
    360.0, 360.0, 360.0, 520.0, 520.0, 520.0, 750.0, 750.0, 750.0, 1100.0, 1100.0, 1100.0];
pub const OWNED_MASK: u32 = (1 << COSTS.len()) - 1;
// Superstition -> Creation story -> Ancestor worship; Storytelling ->
// Hunting legend -> Heroism; both traditions meet in Redemption Arc.
pub const PREREQUISITES: [u32; 19] = [0, 1 << 4, 1, 1 << 2, 0, 1 << 1, (1 << 3) | (1 << 5),
    1 << 6, 1 << 6, 1 << 6, 1 << 7, 1 << 8, 1 << 9, 1 << 10, 1 << 11, 1 << 12,
    1 << 13, 1 << 14, 1 << 15];
const HOUSEHOLD: u32 = 1 << 7;
const CUSTOMARY_LAW: u32 = 1 << 8;
const OATHS: u32 = 1 << 9;
const CRAFT: u32 = 1 << 10;
const PROPERTY: u32 = 1 << 11;
const HONOR: u32 = 1 << 12;
const GUILDS: u32 = 1 << 13;
const LIBERTIES: u32 = 1 << 14;
const MILITIA: u32 = 1 << 15;
const STEWARDSHIP: u32 = 1 << 16;
const TRADITION: u32 = 1 << 17;
const HOMELAND: u32 = 1 << 18;
// Combat contexts: own ground, Leader/retinue, militia. Host supplies facts;
// eligibility and all bonus amounts remain native.
pub const HOME: u32 = 1;
pub const RETINUE: u32 = 2;
pub const CITY_MILITIA: u32 = 4;
pub const DEFENDER: u32 = 8;
#[derive(Component, Default)]
pub struct Account { pub culture: f64, pub spent: f64, pub owned: u32 }
#[derive(Resource, Default)]
pub struct Accounts { entities: BTreeMap<u32, Entity>, pub input: [f64; 20], pub output: [f64; 4] }
fn amount(value: f64) -> f64 { if value.is_finite() { value.max(0.0) } else { 0.0 } }
pub fn earned(culture: f64, spent: f64) -> f64 { amount(culture) + amount(spent) }
/// 0 available, 1 owned, 2 missing prerequisite, 3 insufficient culture, 4 invalid.
pub fn status(mask: u32, culture: f64, id: usize) -> u32 {
    if id >= COSTS.len() { 4 }
    else if mask & (1 << id) != 0 { 1 }
    else if mask & PREREQUISITES[id] != PREREQUISITES[id] { 2 }
    else if !culture.is_finite() || culture < COSTS[id] { 3 }
    else { 0 }
}
/// Input: culture,spent,owned,actor,buildingFaction,buildingKind,hp,construction,
/// leaderHp,leaderFaction,leaderX,leaderY,buildingX,buildingY,tech,gameOver,
/// defeated,present,leaderInside,leaderEmbarked. Output: error,culture,spent,owned.
pub fn purchase(world: &mut World, id: usize) -> *const f64 {
    let v = world.resource::<Accounts>().input;
    let faction = v[3] as u32;
    let entity = if let Some(&entity) = world.resource::<Accounts>().entities.get(&faction) { entity }
        else { let entity = world.spawn(Account::default()).id(); world.resource_mut::<Accounts>().entities.insert(faction, entity); entity };
    let width = building::width(building::FORUM);
    let dx = (v[12] - v[10]).max(0.0).max(v[10] - v[12] - width);
    let dy = (v[13] - v[11]).max(0.0).max(v[11] - v[13] - width);
    let error = if v[3] < 0.0 || v[4] != v[3] || v[5] as u32 != building::FORUM || v[6] <= 0.0 || v[7] != 0.0
        || v[8] <= 0.0 || v[9] != v[3] || v[15] != 0.0 || v[16] != 0.0 || v[17] == 0.0 || v[18] != 0.0 || v[19] != 0.0
        || !v[10..14].iter().all(|x| x.is_finite()) || dx.hypot(dy) > 3.0 { 5 }
        else if v[14] < 1.0 { 6 } else { status(v[2] as u32, v[0], id) };
    let result;
    {
        let mut account = world.get_mut::<Account>(entity).expect("culture account");
        account.culture = amount(v[0]); account.spent = amount(v[1]); account.owned = v[2] as u32 & OWNED_MASK;
        if error == 0 { account.culture -= COSTS[id]; account.spent += COSTS[id]; account.owned |= 1 << id; }
        result = [error as f64, account.culture, account.spent, account.owned as f64];
    }
    let mut accounts = world.resource_mut::<Accounts>(); accounts.output = result; accounts.output.as_ptr()
}
/// Effects apply only at existing event or sampled-work boundaries.
pub fn effect(mask: u32, effect: u32, value: f64, context: u32) -> f64 {
    match effect {
        0 if mask & (1 << 1) != 0 => value + 25.0, // Hunting legend: food per animal.
        1 if mask & (1 << 2) != 0 => value * 1.20, // Creation story: town culture.
        2 if mask & (1 << 3) != 0 && context & 1 != 0 => value * 1.40, // Ancestor worship: home healing.
        3 if mask & (1 << 4) != 0 => value * 1.20, // Storytelling: science efficiency.
        4 if mask & HOUSEHOLD != 0 => value + 0.25, // Growth multiplier.
        5 if mask & CRAFT != 0 => value + 0.35, // Construction/repair multiplier.
        6 if mask & PROPERTY != 0 => value * 1.35, // Gross town taxes only.
        7 if mask & GUILDS != 0 && context & 1 != 0 => value + 0.50, // Domestic trade multiplier.
        8 => value + if context & 1 != 0 && mask & (1 << 2) != 0 { 0.20 } else { 0.0 }
            + if mask & TRADITION != 0 { 0.65 } else { 0.0 }, // Culture multiplier; context = town.
        9 if mask & STEWARDSHIP != 0 && context & 1 != 0 => value + 0.65, // Mature orchard yield multiplier.
        10 if mask & HOMELAND != 0 && context & HOME != 0 => value + 0.65, // Stationary defense damage multiplier.
        11 if mask & CUSTOMARY_LAW != 0 => value + 4.0, // Governance contribution to loyalty target.
        12 if mask & LIBERTIES != 0 => value * 0.50, // Owned-town threat penalty.
        13 => if mask & (OATHS | HONOR | HOMELAND) != 0 { 1.0 } else { 0.0 }, // Needs sampled territory.
        _ => value,
    }
}
/// Add culture to the existing equipment multiplier, rather than multiplying
/// upgraded stats. Used identically by attack previews and actual hits.
pub fn combat_bonus(mask: u32, context: u32, attack: bool) -> f64 {
    let mut bonus = 0.0;
    if mask & MILITIA != 0 && context & CITY_MILITIA != 0 { bonus += 0.50; }
    if !attack && mask & HONOR != 0 && context & (HOME | RETINUE) == (HOME | RETINUE) { bonus += 0.35; }
    bonus
}
pub fn defense_damage_multiplier(mask: u32, context: u32, value: f64) -> f64 {
    if context & (HOME | DEFENDER) == (HOME | DEFENDER) { effect(mask, 10, value, HOME) } else { value }
}
/// Domestic gold keeps the existing young-city cap and population curve.
/// Culture adds half the unmodified receipt, including for capped small towns;
/// foreign civilization and village deliveries never receive Guild Charters.
#[allow(clippy::too_many_arguments)]
pub fn domestic_trade_payout(seconds: f64, origin: f64, partner: f64, bonus: f64,
    origin_residents: f64, partner_residents: f64, mask: u32, domestic: bool) -> f64 {
    if [seconds, origin, partner, bonus, origin_residents, partner_residents].iter().any(|v| !v.is_finite() || *v <= 0.0) { return 0.0; }
    let smaller = origin.min(partner); let larger = origin.max(partner);
    let harmonic = smaller / (0.5 + 0.5 * smaller / larger);
    let factor = harmonic / (harmonic + 50.0);
    let population = origin_residents.min(partner_residents);
    let payout = |multiplier: f64| {
        let full = 0.5 * 3.0 * 1.15 * 1.3 * seconds * factor * multiplier;
        let small = full.min(seconds * (2.0 * 3.0 * 1.15) / 30.0);
        if population <= 20.0 { small }
        else if population >= 30.0 { full }
        else { let growth = (population - 20.0) / 10.0; small + (full - small) * (1.0 - (1.0 - growth).powi(2)) }
    };
    payout(bonus) + (effect(mask, 7, 1.0, domestic as u32) - 1.0) * payout(1.0)
}
pub fn morale_recovery(mask: u32, change: f64, enemies: f64, near_leader: bool, fleeing: bool, home: bool) -> f64 {
    if change <= 0.0 { return change; }
    let mut bonus = 0.0;
    if enemies == 0.0 && mask & 1 != 0 { bonus += 0.20; }
    if enemies > 0.0 && near_leader && mask & (1 << 5) != 0 { bonus += 0.20; }
    if fleeing && mask & (1 << 6) != 0 { bonus += 0.80; }
    if home && mask & OATHS != 0 { bonus += 0.25; }
    change * (1.0 + bonus)
}
