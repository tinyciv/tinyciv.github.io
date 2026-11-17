//! The simulation's single random stream: a bit-exact port of the mulberry32
//! generator TypeScript used (`state += 0x6D2B79F5`, then the 15/7/14 shift
//! mix), so draw sequences and the mirrored `GameState.rngState` are unchanged.

pub const INCREMENT: u32 = 0x6D2B79F5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mulberry32 { pub state: u32 }

impl Mulberry32 {
    pub const fn new(state: u32) -> Self { Self { state } }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(INCREMENT);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    /// A draw in [0, 1): the u32 output divided by 2^32 (exact in f64).
    pub fn next_f64(&mut self) -> f64 { self.next_u32() as f64 / 4294967296.0 }
}

/// Fishing zones keep an independent per-zone stream (they never drew from
/// the game stream): a 32-bit LCG whose draw is (state + 0.5) / 2^32.
pub fn lcg_draw(state: f64) -> (u32, f64) {
    let next = to_uint32(state).wrapping_mul(1664525).wrapping_add(1013904223);
    (next, (next as f64 + 0.5) / 4294967296.0)
}

/// ECMAScript ToUint32.
pub fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() { return 0; }
    value.trunc().rem_euclid(4294967296.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOLDEN: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/mulberry32-golden.bin"));

    #[test]
    fn sequence_equals_the_javascript_golden() {
        let words: Vec<u32> = GOLDEN.chunks_exact(4).map(|chunk| u32::from_le_bytes(chunk.try_into().unwrap())).collect();
        let draws = 10_000;
        assert_eq!(words.len(), 3 * (draws + 1), "three seeds x 10k draws");
        for row in words.chunks_exact(draws + 1) {
            let mut generator = Mulberry32::new(row[0]);
            for (index, expected) in row[1..].iter().enumerate() {
                let value = generator.next_f64();
                assert_eq!(value * 4294967296.0, *expected as f64, "seed {:#x} draw {index}", row[0]);
            }
            assert_eq!(generator.state, row[0].wrapping_add(INCREMENT.wrapping_mul(draws as u32)));
        }
    }

    #[test]
    fn zone_stream_matches_the_javascript_lcg() {
        // (Math.imul(s, 1664525) + 1013904223) >>> 0 from s = 12.75 (scores seed zones).
        let (first, draw) = lcg_draw(12.75);
        assert_eq!(first, 1033878523);
        assert_eq!(draw, (1033878523.0 + 0.5) / 4294967296.0);
        assert_eq!(lcg_draw(first as f64).0, 1576304926);
    }

    #[test]
    fn seeds_coerce_like_javascript() {
        assert_eq!(to_uint32(-1.0), u32::MAX);
        assert_eq!(to_uint32(4294967297.0), 1);
        assert_eq!(to_uint32(12.9), 12);
        assert_eq!(to_uint32(f64::NAN), 0);
    }
}
