//! Land-market quotes and route changes. The host supplies city and navigation
//! observations and applies arrival receipts through the shared economy ledger.
use bevy_ecs::prelude::*;

use super::achievements::domestic_trade_payout;
use crate::ore::grape_trade_multiplier;

const PAID_TILES: f64 = 60.0;
const MERCHANT_SPEED: f64 = 1.3;
const TURNAROUND: f64 = 1.5;

#[derive(Resource, Default)]
pub struct LandTrade {
    input: [f64; 16],
    quote: [f64; 6],
}

impl LandTrade {
    pub fn input(&mut self) -> *mut f64 { self.input.as_mut_ptr() }

    /// [distance, origin residents, partner residents, origin degree,
    /// partner degree, origin goods, partner goods, endpoint libraries,
    /// recipient libraries, gold multiplier, achievements, domestic,
    /// outbound ETA, return ETA, origin grape tiles, partner grape tiles].
    pub fn quote(&mut self) -> *const f64 {
        let [tiles, origin, partner, origin_degree, partner_degree, origin_goods,
            partner_goods, libraries, recipients, bonus, achievements, domestic,
            outbound_eta, return_eta, origin_grapes, partner_grapes] = self.input;
        let origin_goods = origin_goods as u32;
        let partner_goods = partner_goods as u32;
        let one_way = tiles.min(PAID_TILES) / MERCHANT_SPEED;
        let origin_share = origin / origin_degree.max(1.0);
        let partner_share = partner / partner_degree.max(1.0);
        let gold = |multiplier, mask| domestic_trade_payout(one_way, origin_share,
            partner_share, multiplier, origin, partner, mask, domestic != 0.0);
        let export_bonus = |goods: u32| 1.0 + 0.08 * goods.count_ones().min(3) as f64;
        let outbound = gold(bonus * export_bonus(origin_goods & !partner_goods), achievements as u32)
            * grape_trade_multiplier(origin_grapes > 0.0);
        let inbound = gold(bonus * export_bonus(partner_goods & !origin_goods), achievements as u32)
            * grape_trade_multiplier(partner_grapes > 0.0);
        let exchange = 0.05 + 0.04 * (origin_goods ^ partner_goods).count_ones().min(4) as f64
            + if libraries == 2.0 { 0.05 } else { 0.0 };
        let science = gold(1.0, 0) * exchange;
        let recipients = recipients as u32;
        let owner_science = if recipients & 1 != 0 { science } else { 0.0 };
        let partner_science = if domestic == 0.0 && recipients & 2 != 0 { science } else { 0.0 };
        let cycle = outbound_eta + return_eta + 2.0 * TURNAROUND;
        let trips = if cycle.is_finite() && cycle > 0.0 { 60.0 / cycle } else { 0.0 };
        self.quote = [outbound, inbound, owner_science, partner_science,
            (outbound + inbound) * trips, 2.0 * owner_science * trips];
        self.quote.as_ptr()
    }
}

/// A direct order takes effect only after the caravan completes its circuit.
/// Decisions: 0 retain, 1 wait for return, 2 replace endpoint, 3 change mode.
pub fn route_change(end_matches: bool, mode_matches: bool, home: bool) -> u32 {
    match (end_matches, mode_matches, home) {
        (true, true, _) => 0,
        (_, _, false) => 1,
        (false, _, true) => 2,
        (true, false, true) => 3,
    }
}
