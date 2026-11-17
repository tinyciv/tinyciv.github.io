//! Shared 8-tile sector bucketing used by census, settlement civics and morale
//! casualty history. All three divide world coordinates into the same fixed
//! sector size, so the constant and the floor-division live here once.
pub const SECTOR: i32 = 8;

/// Sector coordinate for a non-negative-finite position. Callers that accept
/// negative or non-finite input guard before calling; this mirrors the existing
/// `(value / SECTOR).floor()` contract exactly.
pub fn sector_of(x: f64, y: f64) -> (i32, i32) {
    ((x / SECTOR as f64).floor() as i32, (y / SECTOR as f64).floor() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sector_floor_divides_both_axes() {
        assert_eq!(sector_of(0.0, 0.0), (0, 0));
        assert_eq!(sector_of(7.9, 8.0), (0, 1));
        assert_eq!(sector_of(-1.0, 16.5), (-1, 2));
    }
}