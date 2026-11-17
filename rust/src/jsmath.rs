//! V8-exact `Math` functions for simulation and world-generation rules.
//!
//! V8 implements these with its fdlibm port (`src/base/ieee754.cc`), except
//! `Math.hypot`, which is a Torque builtin (normalized Kahan summation). The
//! reference Node/Chromium arm64 builds compile that C++ with clang's default
//! `-ffp-contract=on`: inside one C expression `a*b + c`, `a*b - c` and
//! `c - a*b` become a single fused multiply-add. Each `fma` below sits exactly
//! where clang fuses (left multiplication first, never across statements), so
//! results are bit-identical to the JavaScript reference on every platform,
//! including wasm32, where `mul_add` is a correctly rounded software fma.
//! `rust/fixtures/jsmath-golden.bin` (scripts/export-jsmath-golden.mjs) pins
//! the bits. Never replace these with `f64::sin` etc.: those use the host libm.

#[inline(always)]
fn fma(a: f64, b: f64, c: f64) -> f64 { a.mul_add(b, c) }
#[inline(always)]
fn high(x: f64) -> i32 { (x.to_bits() >> 32) as i32 }
#[inline(always)]
fn low(x: f64) -> u32 { x.to_bits() as u32 }
#[inline(always)]
fn words(high: u32, low: u32) -> f64 { f64::from_bits((high as u64) << 32 | low as u64) }
#[inline(always)]
fn with_high(x: f64, high: u32) -> f64 { words(high, low(x)) }
#[inline(always)]
fn with_low(x: f64, low: u32) -> f64 { words(high(x) as u32, low) }

/// Exact `x * 2^n` (fdlibm `scalbn`).
pub fn scalbn(x: f64, n: i32) -> f64 {
    const TWO54: f64 = 1.80143985094819840000e+16;
    const TWOM54: f64 = 5.55111512312578270212e-17;
    const HUGE: f64 = 1.0e+300;
    const TINY: f64 = 1.0e-300;
    let mut x = x;
    let mut hx = high(x);
    let lx = low(x);
    let mut k = (hx & 0x7ff00000) >> 20;
    if k == 0 {
        if (lx | (hx & 0x7fffffff) as u32) == 0 { return x; }
        x *= TWO54;
        hx = high(x);
        k = ((hx & 0x7ff00000) >> 20) - 54;
        if n < -50000 { return TINY * x; }
    }
    if k == 0x7ff { return x + x; }
    let k = k as i64 + n as i64;
    if k > 0x7fe { return HUGE * copysign(HUGE, x); }
    if k > 0 { return with_high(x, ((hx as u32) & 0x800fffff) | ((k as u32) << 20)); }
    if k <= -54 {
        if n > 50000 { return HUGE * copysign(HUGE, x); }
        return TINY * copysign(TINY, x);
    }
    let x = with_high(x, ((hx as u32) & 0x800fffff) | (((k + 54) as u32) << 20));
    x * TWOM54
}
fn copysign(x: f64, y: f64) -> f64 { f64::from_bits((x.to_bits() & !(1 << 63)) | (y.to_bits() & (1 << 63))) }

// ------------------------------------------------------------------ trig kernels

fn kernel_sin(x: f64, y: f64, iy: i32) -> f64 {
    const HALF: f64 = 5.00000000000000000000e-01;
    const S1: f64 = -1.66666666666666324348e-01;
    const S2: f64 = 8.33333333332248946124e-03;
    const S3: f64 = -1.98412698298579493134e-04;
    const S4: f64 = 2.75573137070700676789e-06;
    const S5: f64 = -2.50507602534068634195e-08;
    const S6: f64 = 1.58969099521155010221e-10;
    let ix = high(x) & 0x7fffffff;
    if ix < 0x3e400000 && x as i32 == 0 { return x; }
    let z = x * x;
    let v = z * x;
    let r = fma(z, fma(z, fma(z, fma(z, S6, S5), S4), S3), S2);
    if iy == 0 {
        fma(v, fma(z, r, S1), x)
    } else {
        x - fma(-v, S1, fma(z, fma(HALF, y, -(v * r)), -y))
    }
}

fn kernel_cos(x: f64, y: f64) -> f64 {
    const C1: f64 = 4.16666666666666019037e-02;
    const C2: f64 = -1.38888888888741095749e-03;
    const C3: f64 = 2.48015872894767294178e-05;
    const C4: f64 = -2.75573143513906633035e-07;
    const C5: f64 = 2.08757232129817482790e-09;
    const C6: f64 = -1.13596475577881948265e-11;
    let ix = high(x) & 0x7fffffff;
    if ix < 0x3e400000 && x as i32 == 0 { return 1.0; }
    let z = x * x;
    let r = z * fma(z, fma(z, fma(z, fma(z, fma(z, C6, C5), C4), C3), C2), C1);
    if ix < 0x3fd33333 {
        1.0 - fma(0.5, z, -fma(z, r, -(x * y)))
    } else {
        let qx = if ix > 0x3fe90000 { 0.28125 } else { words((ix - 0x00200000) as u32, 0) };
        let hz = fma(0.5, z, -qx);
        let a = 1.0 - qx;
        a - (hz - fma(z, r, -(x * y)))
    }
}

const T: [f64; 13] = [
    3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02,
    2.18694882948595424599e-02, 8.86323982359930005737e-03, 3.59207910759131235356e-03,
    1.45620945432529025516e-03, 5.88041240820264096874e-04, 2.46463134818469906812e-04,
    7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
    2.59073051863633712884e-05,
];

fn kernel_tan(x: f64, y: f64, iy: i32) -> f64 {
    const PIO4: f64 = 7.85398163397448278999e-01;
    const PIO4LO: f64 = 3.06161699786838301793e-17;
    let (mut x, mut y) = (x, y);
    let hx = high(x);
    let ix = hx & 0x7fffffff;
    if ix < 0x3e300000 && x as i32 == 0 {
        if ((ix as u32 | low(x)) | (iy + 1) as u32) == 0 { return 1.0 / x.abs(); }
        if iy == 1 { return x; }
        let w = x + y;
        let z = with_low(w, 0);
        let v = y - (z - x);
        let a = -1.0 / w;
        let t = with_low(a, 0);
        let s = fma(t, z, 1.0);
        return fma(a, fma(t, v, s), t);
    }
    if ix >= 0x3fe59428 {
        if hx < 0 { x = -x; y = -y; }
        let z = PIO4 - x;
        let w = PIO4LO - y;
        x = z + w;
        y = 0.0;
    }
    let z = x * x;
    let w = z * z;
    let r = fma(w, fma(w, fma(w, fma(w, fma(w, T[11], T[9]), T[7]), T[5]), T[3]), T[1]);
    let v = z * fma(w, fma(w, fma(w, fma(w, fma(w, T[12], T[10]), T[8]), T[6]), T[4]), T[2]);
    let s = z * x;
    let r = fma(z, fma(s, r + v, y), y);
    let r = fma(T[0], s, r);
    let w = x + r;
    if ix >= 0x3fe59428 {
        let v = iy as f64;
        return (1 - ((hx >> 30) & 2)) as f64 * fma(-2.0, x - (w * w / (w + v) - r), v);
    }
    if iy == 1 { return w; }
    let z = with_low(w, 0);
    let v = r - (z - x);
    let a = -1.0 / w;
    let t = with_low(a, 0);
    let s = fma(t, z, 1.0);
    fma(a, fma(t, v, s), t)
}

const TWO_OVER_PI: [i32; 66] = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7,
    0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C,
    0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11,
    0x8B5A0A, 0x6D1F6D, 0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7,
    0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E,
    0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B,
];
const NPIO2_HW: [i32; 32] = [
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A,
    0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC,
    0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];

/// Payne-Hanek reduction for |x| > 2^19 * pi/2 (fdlibm `__kernel_rem_pio2`, prec = 2).
fn kernel_rem_pio2(x: &[f64; 3], y: &mut [f64; 2], e0: i32, nx: usize) -> i32 {
    const PIO2: [f64; 8] = [
        1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22,
        1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51,
    ];
    const TWO24: f64 = 1.67772160000000000000e+07;
    const TWON24: f64 = 5.96046447753906250000e-08;
    let jk: i32 = 4; // init_jk[prec = 2]
    let jp = jk;
    let jx = nx as i32 - 1;
    let mut jv = (e0 - 3) / 24;
    if jv < 0 { jv = 0; }
    let mut q0 = e0 - 24 * (jv + 1);
    let (mut f, mut fq, mut q) = ([0.0f64; 20], [0.0f64; 20], [0.0f64; 20]);
    let mut iq = [0i32; 20];
    let mut j = jv - jx;
    let m = jx + jk;
    for i in 0..=m as usize {
        f[i] = if j < 0 { 0.0 } else { TWO_OVER_PI[j as usize] as f64 };
        j += 1;
    }
    for i in 0..=jk as usize {
        let mut fw = 0.0;
        for j in 0..=jx as usize { fw = fma(x[j], f[jx as usize + i - j], fw); }
        q[i] = fw;
    }
    let mut jz = jk;
    let mut z;
    let mut n;
    let mut ih;
    loop {
        // distill q[] into iq[] reversingly
        let mut i = 0usize;
        let mut j = jz as usize;
        z = q[jz as usize];
        while j > 0 {
            let fw = ((TWON24 * z) as i32) as f64;
            iq[i] = fma(-TWO24, fw, z) as i32;
            z = q[j - 1] + fw;
            i += 1;
            j -= 1;
        }
        z = scalbn(z, q0);
        z = fma(-8.0, (z * 0.125).floor(), z);
        n = z as i32;
        z -= n as f64;
        ih = 0;
        if q0 > 0 {
            let i = iq[jz as usize - 1] >> (24 - q0);
            n += i;
            iq[jz as usize - 1] -= i << (24 - q0);
            ih = iq[jz as usize - 1] >> (23 - q0);
        } else if q0 == 0 {
            ih = iq[jz as usize - 1] >> 23;
        } else if z >= 0.5 {
            ih = 2;
        }
        if ih > 0 {
            n += 1;
            let mut carry = 0;
            for i in 0..jz as usize {
                let j = iq[i];
                if carry == 0 {
                    if j != 0 { carry = 1; iq[i] = 0x1000000 - j; }
                } else {
                    iq[i] = 0xffffff - j;
                }
            }
            if q0 > 0 {
                match q0 {
                    1 => iq[jz as usize - 1] &= 0x7fffff,
                    2 => iq[jz as usize - 1] &= 0x3fffff,
                    _ => {}
                }
            }
            if ih == 2 {
                z = 1.0 - z;
                if carry != 0 { z -= scalbn(1.0, q0); }
            }
        }
        if z == 0.0 {
            let mut j = 0;
            let mut i = jz - 1;
            while i >= jk { j |= iq[i as usize]; i -= 1; }
            if j == 0 {
                let mut k = 1;
                while iq[(jk - k) as usize] == 0 { k += 1; }
                for i in (jz + 1)..=(jz + k) {
                    f[(jx + i) as usize] = TWO_OVER_PI[(jv + i) as usize] as f64;
                    let mut fw = 0.0;
                    for j in 0..=jx { fw = fma(x[j as usize], f[(jx + i - j) as usize], fw); }
                    q[i as usize] = fw;
                }
                jz += k;
                continue;
            }
        }
        break;
    }
    if z == 0.0 {
        jz -= 1;
        q0 -= 24;
        while iq[jz as usize] == 0 { jz -= 1; q0 -= 24; }
    } else {
        z = scalbn(z, -q0);
        if z >= TWO24 {
            let fw = ((TWON24 * z) as i32) as f64;
            iq[jz as usize] = fma(-TWO24, fw, z) as i32;
            jz += 1;
            q0 += 24;
            iq[jz as usize] = fw as i32;
        } else {
            iq[jz as usize] = z as i32;
        }
    }
    let mut fw = scalbn(1.0, q0);
    let mut i = jz;
    while i >= 0 {
        q[i as usize] = fw * iq[i as usize] as f64;
        fw *= TWON24;
        i -= 1;
    }
    let mut i = jz;
    while i >= 0 {
        let mut fw = 0.0;
        let mut k = 0;
        while k <= jp && k <= jz - i { fw = fma(PIO2[k as usize], q[(i + k) as usize], fw); k += 1; }
        fq[(jz - i) as usize] = fw;
        i -= 1;
    }
    let mut fw = 0.0;
    let mut i = jz;
    while i >= 0 { fw += fq[i as usize]; i -= 1; }
    y[0] = if ih == 0 { fw } else { -fw };
    fw = fq[0] - fw;
    for i in 1..=jz as usize { fw += fq[i]; }
    y[1] = if ih == 0 { fw } else { -fw };
    n & 7
}

fn rem_pio2(x: f64, y: &mut [f64; 2]) -> i32 {
    const TWO24: f64 = 1.67772160000000000000e+07;
    const INVPIO2: f64 = 6.36619772367581382433e-01;
    const PIO2_1: f64 = 1.57079632673412561417e+00;
    const PIO2_1T: f64 = 6.07710050650619224932e-11;
    const PIO2_2: f64 = 6.07710050630396597660e-11;
    const PIO2_2T: f64 = 2.02226624879595063154e-21;
    const PIO2_3: f64 = 2.02226624871116645580e-21;
    const PIO2_3T: f64 = 8.47842766036889956997e-32;
    let hx = high(x);
    let ix = hx & 0x7fffffff;
    if ix <= 0x3fe921fb { y[0] = x; y[1] = 0.0; return 0; }
    if ix < 0x4002d97c {
        if hx > 0 {
            let mut z = x - PIO2_1;
            if ix != 0x3ff921fb {
                y[0] = z - PIO2_1T;
                y[1] = (z - y[0]) - PIO2_1T;
            } else {
                z -= PIO2_2;
                y[0] = z - PIO2_2T;
                y[1] = (z - y[0]) - PIO2_2T;
            }
            return 1;
        }
        let mut z = x + PIO2_1;
        if ix != 0x3ff921fb {
            y[0] = z + PIO2_1T;
            y[1] = (z - y[0]) + PIO2_1T;
        } else {
            z += PIO2_2;
            y[0] = z + PIO2_2T;
            y[1] = (z - y[0]) + PIO2_2T;
        }
        return -1;
    }
    if ix <= 0x413921fb {
        let t = x.abs();
        let n = fma(t, INVPIO2, 0.5) as i32;
        let fn_ = n as f64;
        let mut r = fma(-fn_, PIO2_1, t);
        let mut w = fn_ * PIO2_1T;
        if n < 32 && ix != NPIO2_HW[(n - 1) as usize] {
            y[0] = r - w;
        } else {
            let j = ix >> 20;
            y[0] = r - w;
            let mut i = j - ((high(y[0]) >> 20) & 0x7ff);
            if i > 16 {
                let t = r;
                w = fn_ * PIO2_2;
                r = t - w;
                w = fma(fn_, PIO2_2T, -((t - r) - w));
                y[0] = r - w;
                i = j - ((high(y[0]) >> 20) & 0x7ff);
                if i > 49 {
                    let t = r;
                    w = fn_ * PIO2_3;
                    r = t - w;
                    w = fma(fn_, PIO2_3T, -((t - r) - w));
                    y[0] = r - w;
                }
            }
        }
        y[1] = (r - y[0]) - w;
        if hx < 0 { y[0] = -y[0]; y[1] = -y[1]; return -n; }
        return n;
    }
    if ix >= 0x7ff00000 { y[0] = x - x; y[1] = y[0]; return 0; }
    let e0 = (ix >> 20) - 1046;
    let mut z = words((ix - (e0 << 20)) as u32, low(x));
    let mut tx = [0.0f64; 3];
    for value in tx.iter_mut().take(2) {
        *value = (z as i32) as f64;
        z = (z - *value) * TWO24;
    }
    tx[2] = z;
    let mut nx = 3;
    while tx[nx - 1] == 0.0 { nx -= 1; }
    let n = kernel_rem_pio2(&tx, y, e0, nx);
    if hx < 0 { y[0] = -y[0]; y[1] = -y[1]; return -n; }
    n
}

/// `Math.sin`.
pub fn sin(x: f64) -> f64 {
    let ix = high(x) & 0x7fffffff;
    if ix <= 0x3fe921fb { return kernel_sin(x, 0.0, 0); }
    if ix >= 0x7ff00000 { return x - x; }
    let mut y = [0.0; 2];
    match rem_pio2(x, &mut y) & 3 {
        0 => kernel_sin(y[0], y[1], 1),
        1 => kernel_cos(y[0], y[1]),
        2 => -kernel_sin(y[0], y[1], 1),
        _ => -kernel_cos(y[0], y[1]),
    }
}

/// `Math.cos`.
pub fn cos(x: f64) -> f64 {
    let ix = high(x) & 0x7fffffff;
    if ix <= 0x3fe921fb { return kernel_cos(x, 0.0); }
    if ix >= 0x7ff00000 { return x - x; }
    let mut y = [0.0; 2];
    match rem_pio2(x, &mut y) & 3 {
        0 => kernel_cos(y[0], y[1]),
        1 => -kernel_sin(y[0], y[1], 1),
        2 => -kernel_cos(y[0], y[1]),
        _ => kernel_sin(y[0], y[1], 1),
    }
}

/// `Math.tan`.
pub fn tan(x: f64) -> f64 {
    let ix = high(x) & 0x7fffffff;
    if ix <= 0x3fe921fb { return kernel_tan(x, 0.0, 1); }
    if ix >= 0x7ff00000 { return x - x; }
    let mut y = [0.0; 2];
    let n = rem_pio2(x, &mut y);
    kernel_tan(y[0], y[1], 1 - ((n & 1) << 1))
}

// ------------------------------------------------------------------ inverse trig

/// `Math.atan`.
pub fn atan(x: f64) -> f64 {
    const ATANHI: [f64; 4] = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
    const ATANLO: [f64; 4] = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
    const AT: [f64; 11] = [
        3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
        9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
        4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02,
    ];
    let mut x = x;
    let hx = high(x);
    let ix = hx & 0x7fffffff;
    let id: i32;
    if ix >= 0x44100000 {
        if ix > 0x7ff00000 || (ix == 0x7ff00000 && low(x) != 0) { return x + x; }
        return if hx > 0 { ATANHI[3] + ATANLO[3] } else { -ATANHI[3] - ATANLO[3] };
    }
    if ix < 0x3fdc0000 {
        if ix < 0x3e400000 && 1.0e300 + x > 1.0 { return x; }
        id = -1;
    } else {
        x = x.abs();
        if ix < 0x3ff30000 {
            if ix < 0x3fe60000 { id = 0; x = fma(2.0, x, -1.0) / (2.0 + x); }
            else { id = 1; x = (x - 1.0) / (x + 1.0); }
        } else if ix < 0x40038000 {
            id = 2; x = (x - 1.5) / fma(1.5, x, 1.0);
        } else {
            id = 3; x = -1.0 / x;
        }
    }
    let z = x * x;
    let w = z * z;
    let s1 = z * fma(w, fma(w, fma(w, fma(w, fma(w, AT[10], AT[8]), AT[6]), AT[4]), AT[2]), AT[0]);
    let s2 = w * fma(w, fma(w, fma(w, fma(w, AT[9], AT[7]), AT[5]), AT[3]), AT[1]);
    if id < 0 { return fma(-x, s1 + s2, x); }
    let id = id as usize;
    let z = ATANHI[id] - (fma(x, s1 + s2, -ATANLO[id]) - x);
    if hx < 0 { -z } else { z }
}

/// `Math.atan2(y, x)`.
pub fn atan2(y: f64, x: f64) -> f64 {
    const TINY: f64 = 1.0e-300;
    const PI_O_4: f64 = 7.8539816339744827900E-01;
    const PI_O_2: f64 = 1.5707963267948965580E+00;
    const PI: f64 = 3.1415926535897931160E+00;
    const PI_LO: f64 = 1.2246467991473531772E-16;
    let (hx, lx) = (high(x), low(x));
    let ix = hx & 0x7fffffff;
    let (hy, ly) = (high(y), low(y));
    let iy = hy & 0x7fffffff;
    if (ix as u32 | ((lx | lx.wrapping_neg()) >> 31)) > 0x7ff00000 || (iy as u32 | ((ly | ly.wrapping_neg()) >> 31)) > 0x7ff00000 {
        return x + y;
    }
    if ((hx.wrapping_sub(0x3ff00000)) as u32 | lx) == 0 { return atan(y); }
    let mut m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
    if (iy as u32 | ly) == 0 {
        return match m { 0 | 1 => y, 2 => PI + TINY, _ => -PI - TINY };
    }
    if (ix as u32 | lx) == 0 { return if hy < 0 { -PI_O_2 - TINY } else { PI_O_2 + TINY }; }
    if ix == 0x7ff00000 {
        if iy == 0x7ff00000 {
            return match m { 0 => PI_O_4 + TINY, 1 => -PI_O_4 - TINY, 2 => fma(3.0, PI_O_4, TINY), _ => fma(-3.0, PI_O_4, -TINY) };
        }
        return match m { 0 => 0.0, 1 => -0.0, 2 => PI + TINY, _ => -PI - TINY };
    }
    if iy == 0x7ff00000 { return if hy < 0 { -PI_O_2 - TINY } else { PI_O_2 + TINY }; }
    let k = (iy - ix) >> 20;
    let z = if k > 60 {
        m &= 1;
        fma(0.5, PI_LO, PI_O_2)
    } else if hx < 0 && k < -60 {
        0.0
    } else {
        atan((y / x).abs())
    };
    match m { 0 => z, 1 => -z, 2 => PI - (z - PI_LO), _ => (z - PI_LO) - PI }
}

// ------------------------------------------------------------------ exponentials

/// `Math.exp`.
pub fn exp(x: f64) -> f64 {
    const HALF: [f64; 2] = [0.5, -0.5];
    const LN2HI: [f64; 2] = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
    const LN2LO: [f64; 2] = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
    const INVLN2: f64 = 1.44269504088896338700e+00;
    const P1: f64 = 1.66666666666666019037e-01;
    const P2: f64 = -2.77777777770155933842e-03;
    const P3: f64 = 6.61375632143793436117e-05;
    const P4: f64 = -1.65339022054652515390e-06;
    const P5: f64 = 4.13813679705723846039e-08;
    const O_THRESHOLD: f64 = 7.09782712893383973096e+02;
    const U_THRESHOLD: f64 = -7.45133219101941108420e+02;
    const TWOM1000: f64 = 9.33263618503218878990e-302;
    let mut x = x;
    let (mut hi, mut lo, mut k) = (0.0, 0.0, 0i32);
    let mut hx = high(x) as u32;
    let xsb = ((hx >> 31) & 1) as usize;
    hx &= 0x7fffffff;
    if hx >= 0x40862e42 {
        if hx >= 0x7ff00000 {
            if ((hx & 0xfffff) | low(x)) != 0 { return x + x; }
            return if xsb == 0 { x } else { 0.0 };
        }
        if x > O_THRESHOLD { return f64::INFINITY; }
        if x < U_THRESHOLD { return 0.0; }
    }
    if hx > 0x3fd62e42 {
        if hx < 0x3ff0a2b2 {
            // V8 special-cases exp(1) so that it returns Math.E exactly.
            if x == 1.0 { return core::f64::consts::E; }
            hi = x - LN2HI[xsb]; lo = LN2LO[xsb]; k = 1 - xsb as i32 - xsb as i32;
        } else {
            k = fma(INVLN2, x, HALF[xsb]) as i32;
            let t = k as f64;
            hi = fma(-t, LN2HI[0], x);
            lo = t * LN2LO[0];
        }
        x = hi - lo;
    } else if hx < 0x3e300000 {
        if 1.0e300 + x > 1.0 { return 1.0 + x; }
    } else {
        k = 0;
    }
    let t = x * x;
    let twopk = if k >= -1021 { words((0x3ff00000 + (k << 20)) as u32, 0) } else { words((0x3ff00000 + ((k + 1000) << 20)) as u32, 0) };
    let c = fma(-t, fma(t, fma(t, fma(t, fma(t, P5, P4), P3), P2), P1), x);
    if k == 0 { return 1.0 - ((x * c) / (c - 2.0) - x); }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 { return y * 2.0 * words(0x7fe00000, 0); }
        return y * twopk;
    }
    y * twopk * TWOM1000
}

/// fdlibm `expm1` (used by `tanh`; equals `Math.expm1`).
pub fn expm1(x: f64) -> f64 {
    const HUGE: f64 = 1.0e+300;
    const TINY: f64 = 1.0e-300;
    const O_THRESHOLD: f64 = 7.09782712893383973096e+02;
    const LN2_HI: f64 = 6.93147180369123816490e-01;
    const LN2_LO: f64 = 1.90821492927058770002e-10;
    const INVLN2: f64 = 1.44269504088896338700e+00;
    const Q1: f64 = -3.33333333333331316428e-02;
    const Q2: f64 = 1.58730158725481460165e-03;
    const Q3: f64 = -7.93650757867487942473e-05;
    const Q4: f64 = 4.00821782732936239552e-06;
    const Q5: f64 = -2.01099218183624371326e-07;
    let mut x = x;
    let mut hx = high(x) as u32;
    let xsb = hx & 0x80000000;
    hx &= 0x7fffffff;
    if hx >= 0x4043687a {
        if hx >= 0x40862e42 {
            if hx >= 0x7ff00000 {
                if ((hx & 0xfffff) | low(x)) != 0 { return x + x; }
                return if xsb == 0 { x } else { -1.0 };
            }
            if x > O_THRESHOLD { return HUGE * HUGE; }
        }
        if xsb != 0 && x + TINY < 0.0 { return TINY - 1.0; }
    }
    let k: i32;
    let mut c = 0.0;
    if hx > 0x3fd62e42 {
        let (hi, lo);
        if hx < 0x3ff0a2b2 {
            if xsb == 0 { hi = x - LN2_HI; lo = LN2_LO; k = 1; } else { hi = x + LN2_HI; lo = -LN2_LO; k = -1; }
        } else {
            k = fma(INVLN2, x, if xsb == 0 { 0.5 } else { -0.5 }) as i32;
            let t = k as f64;
            hi = fma(-t, LN2_HI, x);
            lo = t * LN2_LO;
        }
        x = hi - lo;
        c = (hi - x) - lo;
    } else if hx < 0x3c900000 {
        let t = HUGE + x;
        return x - (t - (HUGE + x));
    } else {
        k = 0;
    }
    let hfx = 0.5 * x;
    let hxs = x * hfx;
    let r1 = fma(hxs, fma(hxs, fma(hxs, fma(hxs, fma(hxs, Q5, Q4), Q3), Q2), Q1), 1.0);
    let t = fma(-r1, hfx, 3.0);
    let mut e = hxs * ((r1 - t) / fma(-x, t, 6.0));
    if k == 0 { return x - fma(x, e, -hxs); }
    let twopk = words((0x3ff00000 + (k << 20)) as u32, 0);
    e = fma(x, e - c, -c);
    e -= hxs;
    if k == -1 { return fma(0.5, x - e, -0.5); }
    if k == 1 {
        if x < -0.25 { return -2.0 * (e - (x + 0.5)); }
        return fma(2.0, x - e, 1.0);
    }
    if k <= -2 || k > 56 {
        let mut y = 1.0 - (e - x);
        if k == 1024 { y = y * 2.0 * words(0x7fe00000, 0); } else { y *= twopk; }
        return y - 1.0;
    }
    if k < 20 {
        let t = words((0x3ff00000 - (0x200000 >> k)) as u32, 0);
        let y = t - (e - x);
        y * twopk
    } else {
        let t = words(((0x3ff - k) << 20) as u32, 0);
        let mut y = x - (e + t);
        y += 1.0;
        y * twopk
    }
}

/// `Math.tanh`.
pub fn tanh(x: f64) -> f64 {
    const TINY: f64 = 1.0e-300;
    let jx = high(x);
    let ix = jx & 0x7fffffff;
    if ix >= 0x7ff00000 {
        return if jx >= 0 { 1.0 / x + 1.0 } else { 1.0 / x - 1.0 };
    }
    let z;
    if ix < 0x40360000 {
        if ix < 0x3e300000 && 1.0e300 + x > 1.0 { return x; }
        if ix >= 0x3ff00000 {
            let t = expm1(2.0 * x.abs());
            z = 1.0 - 2.0 / (t + 2.0);
        } else {
            let t = expm1(-2.0 * x.abs());
            z = -t / (t + 2.0);
        }
    } else {
        z = 1.0 - TINY;
    }
    if jx >= 0 { z } else { -z }
}

/// `Math.log` (natural logarithm).
pub fn log(x: f64) -> f64 {
    const LN2_HI: f64 = 6.93147180369123816490e-01;
    const LN2_LO: f64 = 1.90821492927058770002e-10;
    const TWO54: f64 = 1.80143985094819840000e+16;
    const LG1: f64 = 6.666666666666735130e-01;
    const LG2: f64 = 3.999999999940941908e-01;
    const LG3: f64 = 2.857142874366239149e-01;
    const LG4: f64 = 2.222219843214978396e-01;
    const LG5: f64 = 1.818357216161805012e-01;
    const LG6: f64 = 1.531383769920937332e-01;
    const LG7: f64 = 1.479819860511658591e-01;
    let mut x = x;
    let mut hx = high(x);
    let lx = low(x);
    let mut k = 0;
    if hx < 0x00100000 {
        if ((hx & 0x7fffffff) as u32 | lx) == 0 { return f64::NEG_INFINITY; }
        if hx < 0 { return f64::NAN; }
        k -= 54;
        x *= TWO54;
        hx = high(x);
    }
    if hx >= 0x7ff00000 { return x + x; }
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    let i = (hx + 0x95f64) & 0x100000;
    x = with_high(x, (hx | (i ^ 0x3ff00000)) as u32);
    k += i >> 20;
    let f = x - 1.0;
    if (0x000fffff & (2 + hx)) < 3 {
        if f == 0.0 {
            if k == 0 { return 0.0; }
            let dk = k as f64;
            return fma(dk, LN2_HI, dk * LN2_LO);
        }
        let r = f * f * fma(-0.33333333333333333, f, 0.5);
        if k == 0 { return f - r; }
        let dk = k as f64;
        return fma(dk, LN2_HI, -(fma(-dk, LN2_LO, r) - f));
    }
    let s = f / (2.0 + f);
    let dk = k as f64;
    let z = s * s;
    let mut i = hx - 0x6147a;
    let w = z * z;
    let j = 0x6b851 - hx;
    let t1 = w * fma(w, fma(w, LG6, LG4), LG2);
    let t2 = z * fma(w, fma(w, fma(w, LG7, LG5), LG3), LG1);
    i |= j;
    let r = t2 + t1;
    if i > 0 {
        let hfsq = 0.5 * f * f;
        if k == 0 { return f - fma(-s, hfsq + r, hfsq); }
        fma(dk, LN2_HI, -((hfsq - fma(s, hfsq + r, dk * LN2_LO)) - f))
    } else {
        if k == 0 { return fma(-s, f - r, f); }
        fma(dk, LN2_HI, -(fma(s, f - r, -(dk * LN2_LO)) - f))
    }
}

/// `Math.pow(x, y)` and `x ** y`.
///
/// Unlike the other functions here, V8 does not use fdlibm for `pow`: it
/// calls the host C library's `std::pow` after its own ECMAScript special
/// cases (`NaN` exponents, `(+-1) ** +-Infinity`) and `x ** 0.5 == sqrt(x)`
/// for `x >= +0`. The host libm differs by platform (Apple, glibc, MSVC), and
/// none of them is exactly reproducible, so JavaScript itself has no single
/// answer. This function returns the special cases exactly as V8 does and
/// otherwise the correctly rounded value of `x^y`, computed with 115-bit
/// fixed-point logarithm/exponential series. Every faithful libm returns
/// that value almost always (Apple's libm differs by one ulp in ~0.07% of
/// random arguments; see the golden test).
pub fn pow(x: f64, y: f64) -> f64 {
    let (hx, lx) = (high(x), low(x));
    let (hy, ly) = (high(y), low(y));
    let ix = hx & 0x7fffffff;
    let iy = hy & 0x7fffffff;
    if (iy as u32 | ly) == 0 { return 1.0; }
    if ix > 0x7ff00000 || (ix == 0x7ff00000 && lx != 0) || iy > 0x7ff00000 || (iy == 0x7ff00000 && ly != 0) { return x + y; }
    // yisint: 0 = not an integer, 1 = odd integer, 2 = even integer (only needed for x < 0).
    let mut yisint = 0;
    if hx < 0 {
        if iy >= 0x43400000 {
            yisint = 2;
        } else if iy >= 0x3ff00000 {
            let k = (iy >> 20) - 0x3ff;
            if k > 20 {
                let j = ly >> (52 - k);
                if (j << (52 - k)) == ly { yisint = 2 - (j & 1) as i32; }
            } else if ly == 0 {
                let j = iy >> (20 - k);
                if (j << (20 - k)) == iy { yisint = 2 - (j & 1); }
            }
        }
    }
    if ly == 0 {
        if iy == 0x7ff00000 {
            if ((ix - 0x3ff00000) as u32 | lx) == 0 { return y - y; }
            if ix >= 0x3ff00000 { return if hy >= 0 { y } else { 0.0 }; }
            return if hy < 0 { -y } else { 0.0 };
        }
        if iy == 0x3ff00000 { return if hy < 0 { 1.0 / x } else { x }; }
        if hy == 0x40000000 { return x * x; }
        if hy == 0x3fe00000 && hx >= 0 { return x.sqrt(); }
    }
    let ax = x.abs();
    if lx == 0 && (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000) {
        let mut z = ax;
        if hy < 0 { z = 1.0 / z; }
        if hx < 0 {
            if ((ix - 0x3ff00000) | yisint) == 0 { z = (z - z) / (z - z); }
            else if yisint == 1 { z = -z; }
        }
        return z;
    }
    if hx < 0 && yisint == 0 { return (x - x) / (x - x); }
    let sign = if hx < 0 && yisint == 1 { -1.0 } else { 1.0 };
    sign * fixed::exp_round(fixed::scaled_product(y, fixed::ln(ax)))
}

/// Correctly rounded `pow` core: `ln` and `exp` over i128 with FRACTION
/// fractional bits (error ~2^-110, far below the 2^-53 rounding step).
mod fixed {
    const FRACTION: u32 = 115;
    const LN2: i128 = 28792207424989415788323259614764952; // round(ln 2 * 2^115)
    const LIMIT: i128 = 1 << (FRACTION + 11);
    const MASK: u128 = u64::MAX as u128;

    fn wide(a: u128, b: u128) -> (u128, u128) {
        let (a1, a0, b1, b0) = (a >> 64, a & MASK, b >> 64, b & MASK);
        let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
        let middle = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
        ((p11 + (p01 >> 64) + (p10 >> 64) + (middle >> 64)), (p00 & MASK) | (middle << 64))
    }
    fn mul(a: i128, b: i128) -> i128 {
        let (high, low) = wide(a.unsigned_abs(), b.unsigned_abs());
        let value = ((high << (128 - FRACTION)) | (low >> FRACTION)) as i128;
        if (a < 0) != (b < 0) { -value } else { value }
    }
    /// `numerator / denominator * 2^FRACTION` for |numerator| < denominator < 2^60.
    fn ratio(numerator: i128, denominator: i128) -> i128 {
        let (mut quotient, mut remainder) = (0u128, numerator.unsigned_abs());
        let denominator = denominator as u128;
        for _ in 0..2 {
            let shifted = remainder << 64;
            quotient = (quotient << 64) | (shifted / denominator);
            remainder = shifted % denominator;
        }
        let value = (quotient >> (128 - FRACTION)) as i128;
        if numerator < 0 { -value } else { value }
    }
    /// Natural logarithm of a positive finite double.
    pub fn ln(x: f64) -> i128 {
        let bits = x.to_bits();
        let (mut mantissa, mut exponent) = ((bits & ((1 << 52) - 1)) as i128, ((bits >> 52) & 0x7ff) as i32);
        if exponent == 0 {
            let shift = mantissa.leading_zeros() as i32 - (128 - 53);
            mantissa <<= shift;
            exponent = 1 - shift;
        } else {
            mantissa |= 1 << 52;
        }
        // x = mantissa * 2^(exponent - 1075) with mantissa in [2^52, 2^53).
        let mut power = exponent - 1075 + 52;
        let mut unit: i128 = 1 << 52;
        if mantissa > 6369051672525773 { unit <<= 1; power += 1; } // mantissa/2^52 > sqrt(2)
        let s = ratio(mantissa - unit, mantissa + unit);
        let s2 = mul(s, s);
        let (mut sum, mut term, mut k) = (s, s, 3);
        loop {
            term = mul(term, s2);
            if term == 0 { break; }
            sum += term / k;
            k += 2;
        }
        2 * sum + power as i128 * LN2
    }
    /// `y * ln`, saturated to +-LIMIT (far beyond the overflow thresholds).
    pub fn scaled_product(y: f64, ln: i128) -> i128 {
        let bits = y.to_bits();
        let (fraction, exponent) = ((bits & ((1 << 52) - 1)) as u128, ((bits >> 52) & 0x7ff) as i32);
        let (mantissa, scale) = if exponent == 0 { (fraction, -1074) } else { (fraction | 1 << 52, exponent - 1075) };
        let (high, low) = wide(mantissa, ln.unsigned_abs());
        let magnitude: Option<u128> = if scale >= 0 {
            if high != 0 || scale >= 128 || (low >> (127 - scale as u32)) != 0 { None } else { Some(low << scale) }
        } else {
            let shift = (-scale) as u32;
            if shift >= 256 { Some(0) }
            else if shift >= 128 { Some(high >> (shift - 128)) }
            else if (high >> shift) != 0 { None }
            else { Some((low >> shift) | if shift == 0 { 0 } else { high << (128 - shift) }) }
        };
        let magnitude = match magnitude { Some(value) if value < LIMIT as u128 => value as i128, _ => LIMIT };
        if (y < 0.0) != (ln < 0) { -magnitude } else { magnitude }
    }
    /// Nearest double to `exp(t)` (ties to even).
    pub fn exp_round(t: i128) -> f64 {
        if t > 710 << FRACTION { return f64::INFINITY; }
        if t < -746 << FRACTION { return 0.0; }
        let mut k = (t + LN2 / 2).div_euclid(LN2);
        let mut r = t - k * LN2;
        if r * 2 > LN2 { k += 1; r -= LN2; }
        let (mut sum, mut term, mut n) = (1i128 << FRACTION, 1i128 << FRACTION, 1);
        loop {
            term = mul(term, r) / n;
            if term == 0 { break; }
            sum += term;
            n += 1;
        }
        // value = sum * 2^(k - FRACTION), sum in (2^(FRACTION-1), 2^(FRACTION+1)).
        let width = 128 - sum.leading_zeros() as i64;
        let exponent = width - 1 + k as i64 - FRACTION as i64;
        if exponent > 1023 { return f64::INFINITY; }
        let mut shift = width - 53;
        if exponent < -1022 { shift += -1022 - exponent; }
        if shift >= 127 { return 0.0; }
        let shift = shift as u32;
        let mut mantissa = (sum >> shift) as u64;
        let remainder = sum - ((mantissa as i128) << shift);
        let half = 1i128 << (shift - 1);
        if remainder > half || (remainder == half && mantissa & 1 == 1) { mantissa += 1; }
        super::scalbn(mantissa as f64, (shift as i64 + k as i64 - FRACTION as i64) as i32)
    }
}

/// `Math.cbrt`.
pub fn cbrt(x: f64) -> f64 {
    const B1: u32 = 715094163;
    const B2: u32 = 696219795;
    const P0: f64 = 1.87595182427177009643;
    const P1: f64 = -1.88497979543377169875;
    const P2: f64 = 1.621429720105354466140;
    const P3: f64 = -0.758397934778766047437;
    const P4: f64 = 0.145996192886612446982;
    let mut hx = high(x) as u32;
    let lx = low(x);
    let sign = hx & 0x80000000;
    hx ^= sign;
    if hx >= 0x7ff00000 { return x + x; }
    let mut t;
    if hx < 0x00100000 {
        if (hx | lx) == 0 { return x; }
        t = words(0x43500000, 0);
        t *= x;
        let high_t = high(t) as u32;
        t = words(sign | ((high_t & 0x7fffffff) / 3 + B2), 0);
    } else {
        t = words(sign | (hx / 3 + B1), 0);
    }
    let r = (t * t) * (t / x);
    t *= fma((r * r) * r, fma(r, P4, P3), fma(r, fma(r, P2, P1), P0));
    t = f64::from_bits((t.to_bits().wrapping_add(0x80000000)) & 0xffffffffc0000000);
    let s = t * t;
    let mut r = x / s;
    let w = t + t;
    r = (r - t) / (w + r);
    fma(t, r, t)
}

/// `Math.hypot(...values)`: V8 normalizes by the largest magnitude and uses
/// Kahan summation (Torque builtin, strict IEEE operations, no fusion).
pub fn hypot(values: &[f64]) -> f64 {
    if values.is_empty() { return 0.0; }
    let mut nan = false;
    let mut max = 0.0f64;
    for &value in values {
        if value.is_nan() { nan = true; } else if value.abs() > max { max = value.abs(); }
    }
    if max == f64::INFINITY { return f64::INFINITY; }
    if nan { return f64::NAN; }
    if max == 0.0 { return 0.0; }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for &value in values {
        let n = value.abs() / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// `Math.hypot(x, y)`.
pub fn hypot2(x: f64, y: f64) -> f64 { hypot(&[x, y]) }

#[cfg(test)]
mod tests {
    use super::*;

    const GOLDEN: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/jsmath-golden.bin"));

    /// Mirrors FUNCTIONS in scripts/export-jsmath-golden.mjs.
    type Ranges = &'static [(i32, i32, bool, i32, i32)];
    const FUNCTIONS: [(&str, usize, Ranges); 11] = [
        ("sin", 1, &[(-30, 30, false, -3, 4)]),
        ("cos", 1, &[(-30, 30, false, -3, 4)]),
        ("tan", 1, &[(-30, 30, false, -3, 4)]),
        ("atan", 1, &[(-30, 30, false, -3, 3)]),
        ("atan2", 2, &[(-20, 20, false, -3, 6), (-20, 20, false, -3, 6)]),
        ("exp", 1, &[(-30, 9, false, -3, 5)]),
        ("log", 1, &[(-1022, 1023, true, -3, 12)]),
        ("pow", 2, &[(-10, 10, false, -2, 4), (-6, 6, false, -2, 3)]),
        ("hypot", 2, &[(-40, 40, false, -3, 8), (-40, 40, false, -3, 8)]),
        ("cbrt", 1, &[(-1022, 1023, false, -3, 12)]),
        ("tanh", 1, &[(-30, 5, false, -3, 2)]),
    ];

    fn evaluate(name: &str, args: &[f64]) -> f64 {
        match name {
            "sin" => sin(args[0]), "cos" => cos(args[0]), "tan" => tan(args[0]), "atan" => atan(args[0]),
            "atan2" => atan2(args[0], args[1]), "exp" => exp(args[0]), "log" => log(args[0]),
            "pow" => pow(args[0], args[1]), "hypot" => hypot2(args[0], args[1]), "cbrt" => cbrt(args[0]),
            "tanh" => tanh(args[0]), _ => unreachable!(),
        }
    }

    struct Generator(u32);
    impl Generator {
        fn next(&mut self) -> u32 {
            self.0 = self.0.wrapping_add(0x6D2B79F5);
            let mut t = self.0;
            t = (t ^ (t >> 15)).wrapping_mul(t | 1);
            t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
            t ^ (t >> 14)
        }
    }

    fn argument(next: &mut Generator, range: (i32, i32, bool, i32, i32), mode: usize, name: &str, index: usize) -> f64 {
        let (a, b, c) = (next.next(), next.next(), next.next());
        if mode == 7 { return words(a, c); }
        if name == "pow" && index == 1 && mode == 5 { return (a % 41) as f64 - 20.0; }
        let (emin, emax, positive, typical_min, typical_max) = range;
        let (lo, hi) = if mode == 6 { (typical_min, typical_max) } else { (emin, emax) };
        let exponent = lo + ((a & 0x7fffffff) % (hi - lo + 1) as u32) as i32;
        let sign = if positive { 0 } else { a >> 31 };
        words(sign << 31 | ((1023 + exponent) as u32) << 20 | (b & 0xfffff), c)
    }

    fn same(a: f64, b: f64) -> bool { a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan()) }
    fn ulps(a: f64, b: f64) -> u64 { (a.to_bits() as i64).abs_diff(b.to_bits() as i64) }

    /// Every function is bit-equal to V8 on 10k generated inputs per function
    /// plus edge cases. `pow` is bit-equal to the stored correctly rounded
    /// reference, and V8 (the host libm) may differ from it by one ulp in at
    /// most 0.2% of cases (Apple's libm: 9 of 10361).
    #[test]
    fn matches_v8_for_generated_and_edge_inputs() {
        let values: Vec<f64> = GOLDEN.chunks_exact(8).map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap())).collect();
        assert_eq!(values[0], 0x4a534d41 as f64, "jsmath golden magic");
        assert_eq!(values[1], 1.0);
        assert_eq!(values[2] as usize, FUNCTIONS.len());
        let generated = values[3] as usize;
        assert!(generated >= 10_000);
        let mut cursor = 4;
        let mut failures = Vec::new();
        for (index, (name, arity, ranges)) in FUNCTIONS.iter().enumerate() {
            assert_eq!(values[cursor] as usize, *arity, "{name} arity");
            let edges = values[cursor + 1] as usize;
            cursor += 2;
            let mut next = Generator(0x9E3779B9 ^ ((index as u32 + 1).wrapping_mul(0x85EBCA6B)));
            let mut cases: Vec<(Vec<f64>, f64)> = (0..generated).map(|row| {
                let args = ranges.iter().enumerate().map(|(i, range)| argument(&mut next, *range, row % 8, name, i)).collect();
                (args, values[cursor + row])
            }).collect();
            cursor += generated;
            let inputs = cursor;
            cursor += edges * arity;
            for row in 0..edges { cases.push((values[inputs + row * arity..inputs + (row + 1) * arity].to_vec(), values[cursor + row])); }
            cursor += edges;
            let reference: Option<&[f64]> = (*name == "pow").then(|| &values[cursor..cursor + cases.len()]);
            if reference.is_some() { cursor += cases.len(); }
            let (mut mismatches, mut host_differences) = (0, 0);
            for (row, (args, expected)) in cases.iter().enumerate() {
                let actual = evaluate(name, args);
                let wanted = reference.map(|values| values[row]).filter(|value| !value.is_nan()).unwrap_or(*expected);
                if !same(wanted, actual) {
                    if mismatches < 4 { failures.push(format!("{name}{args:?}: wanted {wanted:e} ({:#x}) Rust {actual:e} ({:#x})", wanted.to_bits(), actual.to_bits())); }
                    mismatches += 1;
                } else if !same(*expected, actual) {
                    assert!(ulps(*expected, actual) <= 1, "{name}{args:?}: V8 {expected:e} differs from the correctly rounded {actual:e} by more than one ulp");
                    host_differences += 1;
                }
            }
            if mismatches > 0 { failures.push(format!("{name}: {mismatches} mismatches")); }
            assert!(host_differences * 500 <= cases.len(), "{name}: {host_differences} host-libm differences");
        }
        assert_eq!(cursor, values.len());
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn hypot_follows_v8_argument_rules() {
        assert_eq!(hypot(&[]), 0.0);
        assert!(hypot(&[f64::NAN, 1.0]).is_nan());
        assert_eq!(hypot(&[f64::NAN, f64::NEG_INFINITY]), f64::INFINITY);
        assert_eq!(hypot(&[3.0, 4.0]), 5.0);
        assert_eq!(hypot(&[-0.0, 0.0]).to_bits(), 0.0f64.to_bits());
    }
}
