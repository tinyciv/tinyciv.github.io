use crate::relief::{hash, noise};

const REACH: i32 = 3;
const POND_SPACING: i32 = 22;

/// Site small closed basins in moist woodland habitat. All four shore samples
/// must support woodland, so a pond does not sit on the edge of a grass patch.
pub(crate) fn plan(
    width: usize,
    height: usize,
    seed: u32,
    density: f64,
    input: &[f64],
    cover: &mut [u8],
) {
    let count = width * height;
    if width < 10 || height < 10 || input.len() != count * 2 || cover.len() != count {
        return;
    }
    let eligible = |cell: usize| input[cell * 2] > 0.0;
    let eligible_count = (0..count).filter(|&cell| eligible(cell)).count();
    let target = ((eligible_count as f64 / 2_800.0 * density).round() as usize).max(1);
    let mut candidates = Vec::new();
    for y in 4..height - 4 {
        for x in 4..width - 4 {
            let cell = y * width + x;
            let center = input[cell * 2];
            let shore = [cell - 4, cell + 4, cell - width * 4, cell + width * 4];
            if center < 1.05 || shore.iter().any(|&next| !eligible(next)) {
                continue;
            }
            let habitat = shore.iter().map(|&next| input[next * 2]).sum::<f64>() / 4.0;
            if habitat < 1.04 {
                continue;
            }
            let elevation = input[cell * 2 + 1];
            let rim = shore.iter().map(|&next| input[next * 2 + 1]).sum::<f64>() / 4.0;
            let basin = (rim - elevation).clamp(-0.10, 0.10);
            let score = center + habitat + basin * 4.0 + hash(seed, x as i32, y as i32) * 0.22;
            candidates.push((cell, score));
        }
    }
    candidates.sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut reserved = vec![false; count];
    let mut placed = 0;
    let mut basin = Vec::new();
    for (cell, _) in candidates {
        if reserved[cell] {
            continue;
        }
        let (x, y) = ((cell % width) as i32, (cell / width) as i32);
        basin.clear();
        pond_shape(seed, x, y, width, &mut basin);
        if basin.len() < 6 || basin.iter().any(|&next| !eligible(next)) {
            continue;
        }
        for &next in &basin {
            cover[next] = 1;
        }
        placed += 1;
        if placed == target {
            break;
        }
        for dy in -POND_SPACING..=POND_SPACING {
            for dx in -POND_SPACING..=POND_SPACING {
                let (nx, ny) = (x + dx, y + dy);
                if nx >= 0 && ny >= 0 && nx < width as i32 && ny < height as i32
                    && dx * dx + dy * dy <= POND_SPACING * POND_SPACING {
                    reserved[ny as usize * width + nx as usize] = true;
                }
            }
        }
    }
}

fn pond_shape(seed: u32, x: i32, y: i32, width: usize, basin: &mut Vec<usize>) {
    let major = 1.85 + hash(seed ^ 0x875e, x, y) * 1.06;
    let minor = major * (0.70 + hash(seed ^ 0xba17, x, y) * 0.25);
    let angle = hash(seed ^ 0x572a, x, y) * std::f64::consts::TAU;
    let (sin, cos) = angle.sin_cos();
    let inside = |dx: i32, dy: i32| {
        let u = (f64::from(dx) * cos + f64::from(dy) * sin) / major;
        let v = (f64::from(dy) * cos - f64::from(dx) * sin) / minor;
        let shore = 0.90 + noise(seed ^ 0x813f, f64::from(x + dx) * 0.47, f64::from(y + dy) * 0.47) * 0.22;
        u * u + v * v <= shore * shore
    };
    // Start at the pond center and grow only through adjacent submerged cells.
    // Ripples in the shore field can never leave a detached water pixel.
    let mut seen = [[false; 7]; 7];
    seen[REACH as usize][REACH as usize] = true;
    let mut queue = [(0_i32, 0_i32); 49];
    let mut len = 1;
    let mut head = 0;
    while head < len {
        let (dx, dy) = queue[head];
        head += 1;
        basin.push((y + dy) as usize * width + (x + dx) as usize);
        for (nx, ny) in [(dx - 1, dy), (dx + 1, dy), (dx, dy - 1), (dx, dy + 1)] {
            if nx.abs() > REACH || ny.abs() > REACH {
                continue;
            }
            let visited = &mut seen[(ny + REACH) as usize][(nx + REACH) as usize];
            if *visited {
                continue;
            }
            *visited = true;
            if inside(nx, ny) {
                queue[len] = (nx, ny);
                len += 1;
            }
        }
    }
}
