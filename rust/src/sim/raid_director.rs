//! Bandit raid director. Every civilization has its own pacing cycle:
//! Calm → Build-up → Raid → Respite. Pressure adapts to how much a faction is
//! hurting (stress from raider-caused losses, halving every 90 seconds), never
//! to the size of its army. Raider strength follows a progress era instead, so
//! investment lets a realm outgrow the bandits. The host reports losses and
//! once-per-second facts; spawning, routing and unit behavior stay there.
use bevy_ecs::prelude::*;
use std::collections::BTreeMap;

pub const CALM: u32 = 0;
pub const BUILDUP: u32 = 1;
pub const RAID: u32 = 2;
pub const RESPITE: u32 = 3;

pub const ASSAULT: u32 = 0;
pub const HARASS: u32 = 1;
pub const THEFT: u32 = 2;
pub const SIEGE: u32 = 3;
pub const SEA: u32 = 4;

pub const STRESS_HALF_LIFE: f64 = 90.0;
pub const MAX_RAID_SECONDS: f64 = 300.0;
pub const MAX_ERA: f64 = 6.0;
/// Burning a camp buys this much quiet for the realm that burned it.
pub const PACIFIED_RESPITE: f64 = 180.0;
/// Replacement camps keep away from that realm's towns for this long.
pub const PACIFIED_REGION_SECONDS: f64 = 600.0;
/// `choose` rows: camp id, city id, route seconds, local defense, loot, keep, camp waves.
pub const CANDIDATE_WORDS: usize = 7;
pub const VIEW_WORDS: usize = 20;
const ROW_WORDS: usize = 29;

/// Bandit intensity sets the target stress band rather than spawn speed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    /// Initial Calm before the first raid can build up.
    pub opening: f64,
    /// Stress above this skips Build-up and lengthens Respite.
    pub stress_high: f64,
    /// Multiplies Calm/Respite lengths and divides Build-up speed.
    pub pace: f64,
    /// Raids that may be underway against one realm at once.
    pub concurrent: f64,
    /// Multiplies the era raid size.
    pub size: f64,
}
pub fn settings(intensity: f64) -> Settings {
    let i = if intensity.is_finite() { intensity.clamp(0.25, 3.0) } else { 1.0 };
    Settings {
        opening: (150.0 / i.powf(0.75)).clamp(60.0, 420.0),
        stress_high: 9.0 + 6.0 * i,
        pace: i.powf(-0.5).clamp(0.5, 1.6),
        concurrent: if i >= 2.0 { 2.0 } else { 1.0 },
        size: i.powf(0.32),
    }
}

/// Progress era 0–6: the larger of technology/population progress and a slow
/// time floor (one era per ten minutes), so turtling cannot freeze bandits.
pub fn era(now: f64, techs: f64, population: f64) -> f64 {
    let floor = now.max(0.0) / 600.0;
    let progress = techs.max(0.0) / 12.0 + population.max(0.0) / 200.0;
    floor.max(progress).clamp(0.0, MAX_ERA)
}
/// Raw raider [hp, attack, defense] before the host's marauder halving.
pub fn profile(era: f64) -> [f64; 3] {
    let e = era.clamp(0.0, MAX_ERA);
    [(40.0 + 30.0 * e).min(110.0).round(), (6.0 + 6.0 * e).min(17.0).round(), (1.0 + e).min(3.0).floor()]
}
/// Visible equipment steps: +10% per whole era, at most ×1.6.
pub fn equipment(era: f64) -> f64 { 1.0 + 0.1 * era.clamp(0.0, MAX_ERA).floor() }
pub fn archer_fraction(era: f64) -> f64 { 0.2 * (era / 2.0).clamp(0.0, 1.0) }
/// Raiders in one raid. `relief` shrinks the raid after a painful one.
pub fn raid_size(era: f64, settings: &Settings, relief: f64) -> f64 {
    ((3.0 + 4.5 * era.clamp(0.0, MAX_ERA)) * settings.size * relief.clamp(0.5, 1.0)).round().clamp(2.0, 60.0)
}
/// Rich, thinly defended realms attract raids sooner.
pub fn attraction(gold: f64, population: f64, soldiers: f64, towers: f64) -> f64 {
    let exposure = gold.max(0.0) / 200.0 + population.max(0.0) / 20.0;
    let defense = soldiers.max(0.0) + 2.0 * towers.max(0.0);
    (0.6 + 0.6 * exposure / (1.0 + defense)).clamp(0.6, 1.8)
}
/// (initial party, total with reinforcements, warning seconds).
pub fn motive_sizes(motive: u32, budget: f64) -> (f64, f64, f64) {
    match motive {
        HARASS => { let total = (budget / 2.0).round().clamp(2.0, 10.0); (total, total, 10.0) }
        THEFT => { let total = (budget / 3.0).round().clamp(1.0, 8.0); (total, total, 10.0) }
        SIEGE => { let total = (budget * 1.5).round().clamp(10.0, 60.0); (total.min(10.0), total, 45.0) }
        SEA => (budget, budget, 0.0),
        _ => (budget, budget, 20.0),
    }
}
pub fn sea_fleet(era: f64) -> f64 { (4.0 + era.clamp(0.0, MAX_ERA).floor()).clamp(4.0, 10.0) }
/// Reference [hp, attack, defense] for seaborne raiders.
pub fn sea_profile(era: f64) -> [f64; 3] { let k = equipment(era); [100.0, 17.0 * 0.7 * k, 4.0 * k] }

#[derive(Clone, Copy, Debug, PartialEq)]
struct Row {
    phase: f64, until: f64, last: f64, stress: f64, stress_at: f64, points: f64, era: f64,
    raid_started: f64, raid_launched: f64, raid_lost: f64, raid_stress: f64,
    fear: f64, streak: f64, size_relief: f64, vendetta: f64, pacified_until: f64, respite_floor: f64,
    raids: f64, last_motive: f64, motive_repeats: f64, sieges_since: f64,
    time: [f64; 4], total_launched: f64, total_lost: f64, total_stress: f64, peak_stress: f64,
}
impl Row {
    fn new(now: f64, opening: f64) -> Self {
        Self { phase: CALM as f64, until: if now < opening { opening } else { now + 60.0 }, last: now, stress: 0.0,
            stress_at: now, points: 0.0, era: 0.0, raid_started: 0.0, raid_launched: 0.0, raid_lost: 0.0, raid_stress: 0.0,
            fear: 0.0, streak: 0.0, size_relief: 1.0, vendetta: 0.0, pacified_until: 0.0, respite_floor: 0.0,
            raids: 0.0, last_motive: -1.0, motive_repeats: 0.0, sieges_since: 3.0,
            time: [0.0; 4], total_launched: 0.0, total_lost: 0.0, total_stress: 0.0, peak_stress: 0.0 }
    }
    fn words(&self) -> [f64; ROW_WORDS] {
        [self.phase, self.until, self.last, self.stress, self.stress_at, self.points, self.era,
            self.raid_started, self.raid_launched, self.raid_lost, self.raid_stress,
            self.fear, self.streak, self.size_relief, self.vendetta, self.pacified_until, self.respite_floor,
            self.raids, self.last_motive, self.motive_repeats, self.sieges_since,
            self.time[0], self.time[1], self.time[2], self.time[3],
            self.total_launched, self.total_lost, self.total_stress, self.peak_stress]
    }
    fn from_words(w: &[f64]) -> Option<Self> {
        if w.len() != ROW_WORDS || w.iter().any(|v| !v.is_finite()) || !(0.0..=3.0).contains(&w[0]) || w[0].fract() != 0.0 { return None; }
        Some(Self { phase: w[0], until: w[1], last: w[2], stress: w[3], stress_at: w[4], points: w[5], era: w[6],
            raid_started: w[7], raid_launched: w[8], raid_lost: w[9], raid_stress: w[10],
            fear: w[11], streak: w[12], size_relief: w[13], vendetta: w[14], pacified_until: w[15], respite_floor: w[16],
            raids: w[17], last_motive: w[18], motive_repeats: w[19], sieges_since: w[20],
            time: [w[21], w[22], w[23], w[24]], total_launched: w[25], total_lost: w[26], total_stress: w[27], peak_stress: w[28] })
    }
    fn phase(&self) -> u32 { self.phase as u32 }
    fn decay(&mut self, now: f64) {
        if now > self.stress_at { self.stress *= 0.5f64.powf((now - self.stress_at) / STRESS_HALF_LIFE); }
        self.stress_at = now;
    }
    fn respite(&mut self, now: f64, seconds: f64) {
        self.phase = RESPITE as f64; self.until = now + seconds.max(0.0); self.points = 0.0;
    }
    /// Calm varies by faction and raid count without consuming world RNG.
    fn calm_seconds(&self, faction: i32, settings: &Settings) -> f64 {
        let jitter = (f64::from(faction.max(0)) * 0.618_034 + self.raids * 0.414_214).fract();
        (40.0 + 20.0 * jitter) * settings.pace * if self.fear >= 2.0 { 1.5 } else { 1.0 }
    }
    fn end_raid(&mut self, now: f64, settings: &Settings) {
        if self.raid_launched <= 0.0 {
            // Every scheduled band was cancelled: no raid happened.
            self.phase = BUILDUP as f64; self.points = 0.5; self.respite_floor = 0.0; return;
        }
        let loss = self.raid_lost / self.raid_launched.max(1.0);
        let painful = self.raid_stress >= settings.stress_high;
        self.fear = if loss >= 0.7 && !painful { (self.fear + 1.0).min(3.0) } else { 0.0 };
        self.streak = if !painful && self.raid_stress < settings.stress_high * 0.35 { self.streak + 1.0 } else { 0.0 };
        self.size_relief = if painful { 0.7 } else { 1.0 };
        let seconds = ((45.0 + 3.0 * self.raid_lost.min(40.0) + if painful { 60.0 } else { 0.0 }) * settings.pace).min(300.0);
        let floor = (self.respite_floor - now).max(0.0);
        self.respite_floor = 0.0;
        self.respite(now, seconds.max(floor));
    }
}

/// Once-per-second observations of one realm.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Facts { pub techs: f64, pub population: f64, pub gold: f64, pub soldiers: f64, pub towers: f64, pub active: f64, pub alive: bool }

#[derive(Resource)]
pub struct RaidDirector { rows: BTreeMap<i32, Row>, input: Vec<f64>, output: [f64; VIEW_WORDS] }
impl Default for RaidDirector {
    fn default() -> Self { Self { rows: BTreeMap::new(), input: Vec::new(), output: [0.0; VIEW_WORDS] } }
}
impl RaidDirector {
    /// Advances one realm's cycle. Returns the raid size to launch now, or 0.
    /// The host answers a positive result with `launched` or `defer`.
    pub fn step(&mut self, faction: i32, now: f64, intensity: f64, facts: Facts) -> f64 {
        if !now.is_finite() { return 0.0; }
        let s = settings(intensity);
        let row = self.rows.entry(faction).or_insert_with(|| Row::new(now, s.opening));
        let dt = (now - row.last).clamp(0.0, 5.0);
        row.last = now;
        row.decay(now);
        row.era = era(now, facts.techs, facts.population);
        if !(intensity > 0.0) || !facts.alive { return 0.0; }
        row.time[row.phase() as usize & 3] += dt;
        match row.phase() {
            CALM => if now >= row.until { row.phase = BUILDUP as f64; row.points = 0.0; },
            BUILDUP => {
                if row.stress > s.stress_high { row.respite(now, 30.0 * s.pace); return 0.0; }
                let relief = (1.0 - row.stress / s.stress_high).clamp(0.2, 1.0);
                row.points += dt * attraction(facts.gold, facts.population, facts.soldiers, facts.towers) * relief / (45.0 * s.pace);
                if row.points >= 1.0 && facts.active < s.concurrent {
                    let relief = if row.vendetta > 0.0 { 1.0 } else { row.size_relief };
                    return raid_size(row.era, &s, relief);
                }
            }
            RAID => {
                let elapsed = now - row.raid_started;
                if facts.active <= 0.0 && elapsed >= 5.0 || elapsed > MAX_RAID_SECONDS { row.end_raid(now, &s); }
                else if facts.active < s.concurrent && elapsed >= 20.0 && row.stress < s.stress_high * 0.5 {
                    // Hard and above: a second, smaller band joins a raid that is going well.
                    row.points += dt * attraction(facts.gold, facts.population, facts.soldiers, facts.towers) / (120.0 * s.pace);
                    if row.points >= 1.0 { return (raid_size(row.era, &s, row.size_relief) * 0.6).round().max(2.0); }
                }
            }
            _ => if now >= row.until { row.phase = CALM as f64; row.until = now + row.calm_seconds(faction, &s); },
        }
        0.0
    }
    /// The host could not field the requested raid (no camp can reach the
    /// realm by land). Retry after about half a build-up; a realm reachable
    /// only by sea stays eligible for seaborne raids meanwhile.
    pub fn defer(&mut self, faction: i32) {
        if let Some(row) = self.rows.get_mut(&faction) { row.points = row.points.min(0.5); }
    }
    pub fn launched(&mut self, faction: i32, now: f64, raiders: f64, motive: u32, bands: f64) {
        let Some(row) = self.rows.get_mut(&faction) else { return; };
        let raiders = if raiders.is_finite() { raiders.max(0.0) } else { 0.0 };
        if row.phase() != RAID {
            row.phase = RAID as f64; row.raid_started = now;
            row.raid_launched = 0.0; row.raid_lost = 0.0; row.raid_stress = 0.0;
        }
        row.raid_launched += raiders; row.total_launched += raiders;
        row.points = 0.0; row.raids += 1.0;
        if f64::from(motive) == row.last_motive { row.motive_repeats += 1.0 } else { row.last_motive = f64::from(motive); row.motive_repeats = 1.0; }
        if motive == SIEGE { row.sieges_since = 0.0 } else { row.sieges_since += 1.0 }
        row.vendetta = 0.0; row.size_relief = 1.0;
        if bands > 1.0 { row.streak = 0.0; }
    }
    /// A scheduled band never departed (its camp fell or its target vanished).
    pub fn cancel(&mut self, faction: i32, raiders: f64) {
        let Some(row) = self.rows.get_mut(&faction) else { return; };
        let raiders = if raiders.is_finite() { raiders.max(0.0) } else { 0.0 };
        row.raid_launched = (row.raid_launched - raiders).max(0.0);
        row.total_launched = (row.total_launched - raiders).max(0.0);
    }
    /// A raider-caused loss: civilians 1, soldiers 1.5, buildings 3, towns and Leaders 10, stolen gold ÷ 50.
    pub fn loss(&mut self, faction: i32, now: f64, weight: f64) {
        let Some(row) = self.rows.get_mut(&faction) else { return; };
        if !(weight > 0.0) || !weight.is_finite() { return; }
        row.decay(now);
        row.stress += weight; row.total_stress += weight;
        row.peak_stress = row.peak_stress.max(row.stress);
        if row.phase() == RAID { row.raid_stress += weight; }
    }
    /// A raider sent against this realm died.
    pub fn raider_lost(&mut self, faction: i32) {
        let Some(row) = self.rows.get_mut(&faction) else { return; };
        row.total_lost += 1.0;
        if row.phase() == RAID { row.raid_lost += 1.0; }
    }
    /// This realm burned a camp: quiet now, a keep-away zone for replacements,
    /// and one announced retaliation once the quiet ends.
    pub fn pacify(&mut self, faction: i32, now: f64) {
        let Some(row) = self.rows.get_mut(&faction) else { return; };
        row.pacified_until = row.pacified_until.max(now + PACIFIED_REGION_SECONDS);
        row.vendetta = 1.0;
        match row.phase() {
            RAID => row.respite_floor = row.respite_floor.max(now + PACIFIED_RESPITE),
            RESPITE => row.until = row.until.max(now + PACIFIED_RESPITE),
            _ => row.respite(now, PACIFIED_RESPITE),
        }
    }
    /// Seaborne raids share the realm's cycle: allowed only while building up.
    pub fn claim_sea(&self, faction: i32, intensity: f64, active: f64) -> bool {
        self.rows.get(&faction).is_some_and(|row| intensity > 0.0 && row.phase() == BUILDUP
            && row.points >= 0.5 && active < settings(intensity).concurrent)
    }
    /// Independent bands may only pick targets from realms that are not resting.
    pub fn open(&self, faction: i32) -> bool { self.rows.get(&faction).is_some_and(|row| matches!(row.phase(), BUILDUP | RAID)) }
    pub fn pacified(&self, faction: i32, now: f64) -> bool { self.rows.get(&faction).is_some_and(|row| now < row.pacified_until) }
    pub fn era_of(&self, faction: i32) -> f64 { self.rows.get(&faction).map_or(0.0, |row| row.era) }
    pub fn input(&mut self, rows: usize) -> *mut f64 { self.input.clear(); self.input.resize(rows * CANDIDATE_WORDS, 0.0); self.input.as_mut_ptr() }
    /// Picks the weakest reachable city and the raid type.
    /// Output: [row index or -1, motive, initial, total, warning seconds, bands].
    pub fn choose(&mut self, faction: i32, budget: f64, gold: f64, soldiers: f64, rows: usize) -> *const f64 {
        self.output = [0.0; VIEW_WORDS];
        self.output[0] = -1.0;
        let Some(row) = self.rows.get(&faction).copied() else { return self.output.as_ptr(); };
        let mut best: Option<(usize, f64)> = None;
        for index in 0..rows.min(self.input.len() / CANDIDATE_WORDS) {
            let c = &self.input[index * CANDIDATE_WORDS..(index + 1) * CANDIDATE_WORDS];
            if !c[2].is_finite() || c[2] < 0.0 { continue; }
            let score = c[4].max(1.0) / (1.0 + c[3].max(0.0)) / (1.0 + c[2] / 60.0) / (1.0 + c[6].max(0.0) * 0.4);
            if best.is_none_or(|(_, top)| score > top + 1e-12) { best = Some((index, score)); }
        }
        let Some((index, _)) = best else { return self.output.as_ptr(); };
        let c = &self.input[index * CANDIDATE_WORDS..(index + 1) * CANDIDATE_WORDS];
        let (defense, keep) = (c[3].max(0.0), c[5] != 0.0);
        let mut motive = if row.vendetta > 0.0 { ASSAULT }
            else if row.era >= 2.0 && budget >= 10.0 && defense * 2.0 < budget && row.sieges_since >= 3.0 && gold >= 300.0 { SIEGE }
            else if row.era >= 1.0 && gold >= 400.0 && !keep && row.last_motive != f64::from(THEFT) { THEFT }
            else if row.era >= 1.0 && soldiers >= budget * 1.5 { HARASS }
            else { ASSAULT };
        // Never the same raid type three times running.
        if f64::from(motive) == row.last_motive && row.motive_repeats >= 2.0 { motive = if motive == ASSAULT { HARASS } else { ASSAULT }; }
        let (initial, total, warning) = motive_sizes(motive, budget);
        let warning = if row.vendetta > 0.0 { 45.0 } else { warning };
        // A realm that keeps winning easily gets variety, not bigger numbers.
        let bands = if row.streak >= 3.0 && motive != SIEGE { 2.0 } else { 1.0 };
        self.output[..6].copy_from_slice(&[index as f64, f64::from(motive), initial, total, warning, bands]);
        self.output.as_ptr()
    }
    /// [phase, until, stress, points, era, fear, streak, raids, pacified until, vendetta,
    ///  calm s, build-up s, raid s, respite s, raiders sent, raiders lost, total stress, peak stress, size relief, last motive].
    pub fn view(&mut self, faction: i32) -> *const f64 {
        self.output = [0.0; VIEW_WORDS];
        if let Some(r) = self.rows.get(&faction) {
            self.output = [r.phase, r.until, r.stress, r.points, r.era, r.fear, r.streak, r.raids, r.pacified_until, r.vendetta,
                r.time[0], r.time[1], r.time[2], r.time[3], r.total_launched, r.total_lost, r.total_stress, r.peak_stress, r.size_relief, r.last_motive];
        } else { self.output[0] = -1.0; }
        self.output.as_ptr()
    }
    pub fn snapshot(&self) -> Vec<f64> {
        let mut out = vec![self.rows.len() as f64];
        for (faction, row) in &self.rows { out.push(f64::from(*faction)); out.extend_from_slice(&row.words()); }
        out
    }
    pub fn restore(data: &[f64]) -> Option<Self> {
        let count = *data.first()?;
        if !count.is_finite() || count < 0.0 || count.fract() != 0.0 || data.len() != 1 + count as usize * (ROW_WORDS + 1) { return None; }
        let mut rows = BTreeMap::new();
        for chunk in data[1..].chunks_exact(ROW_WORDS + 1) {
            if !chunk[0].is_finite() || chunk[0].fract() != 0.0 { return None; }
            rows.insert(chunk[0] as i32, Row::from_words(&chunk[1..])?);
        }
        Some(Self { rows, ..Self::default() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(active: f64) -> Facts { Facts { techs: 0.0, population: 20.0, gold: 500.0, soldiers: 5.0, towers: 0.0, active, alive: true } }
    fn run(director: &mut RaidDirector, faction: i32, from: f64, to: f64, active: f64) -> Option<(f64, f64)> {
        let mut t = from;
        while t <= to {
            let size = director.step(faction, t, 1.0, facts(active));
            if size > 0.0 { return Some((t, size)); }
            t += 1.0;
        }
        None
    }

    #[test]
    fn opening_calm_then_a_small_first_raid() {
        let mut director = RaidDirector::default();
        assert_eq!(run(&mut director, 0, 0.0, 149.0, 0.0), None, "no raid during the opening");
        let (at, size) = run(&mut director, 0, 150.0, 600.0, 0.0).expect("a raid builds up after the opening");
        assert!(at > 175.0 && at < 240.0, "{at}");
        assert!((2.0..=6.0).contains(&size), "{size}");
    }

    #[test]
    fn high_stress_skips_build_up_and_painful_raids_earn_longer_respite() {
        let mut director = RaidDirector::default();
        let (at, size) = run(&mut director, 0, 0.0, 600.0, 0.0).unwrap();
        director.launched(0, at, size, ASSAULT, 1.0);
        assert_eq!(director.step(0, at + 1.0, 1.0, facts(1.0)), 0.0);
        director.loss(0, at + 10.0, 20.0);
        director.step(0, at + 60.0, 1.0, facts(0.0));
        let view = unsafe { std::slice::from_raw_parts(director.view(0), VIEW_WORDS) }.to_vec();
        assert_eq!(view[0], f64::from(RESPITE));
        // Painful: 45 + 60 seconds of Respite at normal intensity.
        assert!((view[1] - (at + 60.0 + 105.0)).abs() < 1e-9, "{view:?}");
        assert_eq!(view[18], 0.7, "the next raid is smaller");
    }

    #[test]
    fn bloody_defeats_for_bandits_build_fear_and_streaks_bring_variety() {
        let mut director = RaidDirector::default();
        let mut t = 0.0;
        for _ in 0..3 {
            let (at, size) = run(&mut director, 2, t, t + 900.0, 0.0).unwrap();
            director.launched(2, at, size, ASSAULT, 1.0);
            for _ in 0..size as usize { director.raider_lost(2); }
            director.step(2, at + 30.0, 1.0, facts(0.0));
            t = at + 31.0;
        }
        let view = unsafe { std::slice::from_raw_parts(director.view(2), VIEW_WORDS) }.to_vec();
        assert_eq!(view[5], 3.0, "fear");
        assert_eq!(view[6], 3.0, "streak");
        let input = director.input(1);
        unsafe { std::slice::from_raw_parts_mut(input, CANDIDATE_WORDS) }.copy_from_slice(&[0.0, 0.0, 30.0, 4.0, 3.0, 0.0, 0.0]);
        let out = unsafe { std::slice::from_raw_parts(director.choose(2, 8.0, 100.0, 4.0, 1), 6) }.to_vec();
        assert_eq!(out[5], 2.0, "two bands");
    }

    #[test]
    fn choose_prefers_weak_rich_nearby_cities_and_varies_raid_types() {
        let mut director = RaidDirector::default();
        director.step(1, 0.0, 1.0, facts(0.0));
        let input = director.input(3);
        unsafe { std::slice::from_raw_parts_mut(input, 3 * CANDIDATE_WORDS) }.copy_from_slice(&[
            0.0, 10.0, 30.0, 12.0, 6.0, 0.0, 0.0,
            0.0, 11.0, 40.0, 1.0, 4.0, 0.0, 0.0,
            1.0, 11.0, f64::INFINITY, 0.0, 9.0, 0.0, 0.0,
        ]);
        let out = unsafe { std::slice::from_raw_parts(director.choose(1, 6.0, 100.0, 2.0, 3), 6) }.to_vec();
        assert_eq!(out[0], 1.0);
        assert_eq!(out[1], f64::from(ASSAULT));
        director.launched(1, 1.0, 6.0, ASSAULT, 1.0);
        director.launched(1, 2.0, 6.0, ASSAULT, 1.0);
        let out = unsafe { std::slice::from_raw_parts(director.choose(1, 6.0, 100.0, 2.0, 3), 6) }.to_vec();
        assert_eq!(out[1], f64::from(HARASS), "no third assault in a row");
    }

    #[test]
    fn pacifying_a_realm_rests_it_and_arms_a_vendetta() {
        let mut director = RaidDirector::default();
        director.step(0, 400.0, 1.0, facts(0.0));
        director.pacify(0, 400.0);
        assert!(director.pacified(0, 999.0) && !director.pacified(0, 1001.0));
        let view = unsafe { std::slice::from_raw_parts(director.view(0), VIEW_WORDS) }.to_vec();
        assert_eq!(view[0], f64::from(RESPITE));
        assert_eq!(view[1], 580.0);
        let input = director.input(1);
        unsafe { std::slice::from_raw_parts_mut(input, CANDIDATE_WORDS) }.copy_from_slice(&[0.0, 0.0, 30.0, 0.0, 3.0, 0.0, 0.0]);
        let out = unsafe { std::slice::from_raw_parts(director.choose(0, 6.0, 900.0, 0.0, 1), 6) }.to_vec();
        assert_eq!((out[1], out[4]), (f64::from(ASSAULT), 45.0), "announced retaliation");
    }

    #[test]
    fn strength_follows_era_not_army_and_saves_round_trip() {
        assert!(era(0.0, 0.0, 20.0) < 0.2 && era(3600.0, 0.0, 0.0) == 6.0 && era(0.0, 24.0, 200.0) == 3.0);
        let mut last = [0.0; 3];
        for step in 0..=12 {
            let next = profile(f64::from(step) * 0.5);
            assert!(next.iter().zip(last).all(|(a, b)| *a >= b));
            last = next;
        }
        assert_eq!(equipment(5.9), 1.5);
        assert_eq!(raid_size(6.0, &settings(1.0), 1.0), 30.0);
        let mut director = RaidDirector::default();
        director.step(4, 10.0, 2.0, facts(0.0));
        director.loss(4, 11.0, 3.0);
        let restored = RaidDirector::restore(&director.snapshot()).unwrap();
        assert_eq!(restored.rows, director.rows);
        assert!(RaidDirector::restore(&[1.0, 4.0]).is_none());
    }
}
