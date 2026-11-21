//! Versioned, sectioned native snapshot stored in `GameState.simCore`.
//!
//! Layout (f64 words, base64-encoded by the host):
//! `[MAGIC, VERSION, section count, (section id, length, payload...)*]`.
//! Sections appear in ascending id order; readers skip ids they do not know,
//! so later migration steps append sections without breaking older ones.

pub const MAGIC: f64 = 1_398_096_211.0; // "SIMS" as a big-endian u32
pub const VERSION: f64 = 1.0;

/// Clock and RNG: [time, tick, speed, paused, game over, victory, victory continued, rng state].
pub const CORE: u32 = 0;
/// The settlement engine export (`settlement::SettlementEngine::export`).
pub const SETTLEMENT: u32 = 1;
pub const RAIDER_AGGRESSION: u32 = 2;
pub const HARBOR_TRADE: u32 = 3;
pub const BUILDING_DESTRUCTION: u32 = 4;
pub const DIPLOMACY: u32 = 5;
pub const AI_POLICIES: u32 = 6;
pub const QUESTS: u32 = 7;
pub const CAMPAIGN: u32 = 8;
pub const OFFENSIVES: u32 = 9;
pub const OFFENSIVE_AI: u32 = 10;
pub const CIVIC_ECONOMY: u32 = 11;
/// Bandit raid director rows (`raid_director::RaidDirector::snapshot`).
pub const RAID_DIRECTOR: u32 = 12;
pub const CORE_LENGTH: usize = 8;

pub fn encode(sections: &[(u32, &[f64])], out: &mut Vec<f64>) {
    out.clear();
    out.extend_from_slice(&[MAGIC, VERSION, sections.len() as f64]);
    let mut previous = None;
    for (id, payload) in sections {
        assert!(previous.is_none_or(|last| last < *id), "save sections must be strictly ascending");
        previous = Some(*id);
        out.push(*id as f64);
        out.push(payload.len() as f64);
        out.extend_from_slice(payload);
    }
}

/// Validated section table: (id, payload range).
pub fn decode(data: &[f64]) -> Option<Vec<(u32, std::ops::Range<usize>)>> {
    if data.len() < 3 || data[0] != MAGIC || data[1] != VERSION { return None; }
    let count = whole(data[2])?;
    let mut sections = Vec::with_capacity(count);
    let mut cursor = 3;
    let mut previous: Option<u32> = None;
    for _ in 0..count {
        let id = whole(*data.get(cursor)?)? as u32;
        let length = whole(*data.get(cursor + 1)?)?;
        let start = cursor + 2;
        let end = start.checked_add(length)?;
        if end > data.len() || previous.is_some_and(|last| last >= id) { return None; }
        sections.push((id, start..end));
        previous = Some(id);
        cursor = end;
    }
    (cursor == data.len()).then_some(sections)
}

fn whole(value: f64) -> Option<usize> {
    (value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value < 4294967296.0).then_some(value as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_round_trip_and_skip_unknown_ids() {
        let mut out = Vec::new();
        let core = [12.5, 3.0, 2.0, 1.0, 0.0, 0.0, 1.0, 4242.0];
        encode(&[(CORE, &core), (SETTLEMENT, &[1.0, 2.0, 3.0]), (9, &[])], &mut out);
        let sections = decode(&out).expect("valid snapshot");
        assert_eq!(sections.len(), 3);
        assert_eq!(&out[sections[0].1.clone()], &core);
        assert_eq!(&out[sections[1].1.clone()], &[1.0, 2.0, 3.0]);
        assert!(sections[2].1.is_empty());
    }

    #[test]
    fn rejects_truncated_reordered_or_foreign_snapshots() {
        let mut out = Vec::new();
        encode(&[(CORE, &[1.0; CORE_LENGTH])], &mut out);
        assert!(decode(&out[..out.len() - 1]).is_none());
        let mut wrong = out.clone(); wrong[1] = 2.0;
        assert!(decode(&wrong).is_none());
        let mut padded = out.clone(); padded.push(0.0);
        assert!(decode(&padded).is_none());
        let reordered = [MAGIC, VERSION, 2.0, 1.0, 0.0, 0.0, 0.0];
        assert!(decode(&reordered).is_none());
        assert!(decode(&[]).is_none());
    }
}
