//! World-generation-only glacial cuts and their low shore and rock bands.
const FJORD_WATER: u8 = 1;
const FJORD_SHORE: u8 = 2;
const FJORD_ROCK: u8 = 3;
const CHANNELS: [(f64, f64, f64, f64); 5] = [
    (-28.0, 27.0, 3.6, -7.0),
    (-14.0, 41.0, 5.6, -3.0),
    (1.0, 33.0, 4.5, 2.0),
    (15.0, 36.0, 4.9, 6.0),
    (30.0, 24.0, 3.2, 10.0),
];
const MAX_SITES_PER_SCALE: usize = 6;

#[derive(Default)]
pub struct CoastDraft {
    land: Vec<u8>,
    tags: Vec<u8>,
}

impl CoastDraft {
    pub fn prepare(&mut self, count: usize) -> *mut u8 {
        self.land.resize(count, 0);
        self.land.as_mut_ptr()
    }

    pub fn generate(
        &mut self,
        width: usize,
        height: usize,
        seed: u32,
        polar_lane: usize,
    ) -> *const u8 {
        let grid = Grid {
            width,
            height,
            polar_lane,
        };
        self.tags.resize(width * height, 0);
        self.tags.fill(0);
        if self.tags.len() == self.land.len() && width >= 24 && height >= 24 {
            select_coast(grid, &self.land, seed, &mut self.tags);
        }
        self.tags.as_ptr()
    }
}

#[derive(Clone, Copy)]
struct Grid {
    width: usize,
    height: usize,
    polar_lane: usize,
}

impl Grid {
    fn offset(self, x: i32, y: i32) -> Option<usize> {
        (x >= 0 && y >= 0 && x < self.width as i32 && y < self.height as i32)
            .then(|| y as usize * self.width + x as usize)
    }

    fn interior(self, cell: usize) -> bool {
        let x = cell % self.width;
        let y = cell / self.width;
        x >= 2
            && x + 2 < self.width
            && y >= self.polar_lane.max(2)
            && y + self.polar_lane.max(2) < self.height
    }

    fn neighbors(self, cell: usize) -> impl Iterator<Item = usize> {
        let x = cell % self.width;
        let y = cell / self.width;
        [
            (x > 0).then(|| cell - 1),
            (x + 1 < self.width).then(|| cell + 1),
            (y > 0).then(|| cell - self.width),
            (y + 1 < self.height).then(|| cell + self.width),
        ]
        .into_iter()
        .flatten()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Face {
    North,
    South,
    West,
    East,
}

impl Face {
    fn across(self, grid: Grid) -> i32 {
        match self {
            Self::North | Self::South => grid.width as i32,
            Self::West | Self::East => grid.height as i32,
        }
    }

    fn depth(self, grid: Grid) -> i32 {
        match self {
            Self::North | Self::South => grid.height as i32,
            Self::West | Self::East => grid.width as i32,
        }
    }

    fn position(self, grid: Grid, across: i32, depth: i32) -> (i32, i32) {
        match self {
            Self::North => (across, depth),
            Self::South => (across, grid.height as i32 - 1 - depth),
            Self::West => (depth, across),
            Self::East => (grid.width as i32 - 1 - depth, across),
        }
    }

    fn cell(self, grid: Grid, across: i32, depth: i32) -> Option<usize> {
        let (x, y) = self.position(grid, across, depth);
        grid.offset(x, y)
    }
}

#[derive(Clone, Copy, Debug)]
struct Channel {
    across: i32,
    mouth: i32,
    length: i32,
    radius: f64,
    drift: f64,
    phase: f64,
}

impl Channel {
    fn shape(self, advance: i32) -> (f64, f64) {
        let progress = (advance as f64 / self.length as f64).clamp(0.0, 1.0);
        let bend = ((progress * 5.5 + self.phase).sin() - self.phase.sin()) * self.radius * 0.51;
        let center = self.across as f64 + self.drift * progress + bend;
        let width_variation = 0.92
            + 0.22 * (progress * 3.77 + self.phase * 0.25).sin()
            + 0.12 * (progress * 12.0 + self.phase).sin();
        let cap_length = (self.radius * 1.65).max(2.0);
        let cap = ((advance - self.length) as f64 / cap_length + 0.68).max(0.0);
        let radius = self.radius * width_variation * (1.0 - cap * cap).max(0.09).sqrt();
        (center, radius.max(1.05))
    }
}

#[derive(Debug)]
struct Site {
    face: Face,
    center: i32,
    score: f64,
    channels: Vec<Channel>,
}

fn largest_land(grid: Grid, land: &[u8]) -> Vec<usize> {
    let mut visited = vec![false; land.len()];
    let mut largest = Vec::new();
    let mut cells = Vec::new();
    for start in 0..land.len() {
        if land[start] == 0 || visited[start] {
            continue;
        }
        visited[start] = true;
        cells.clear();
        cells.push(start);
        let mut head = 0;
        while head < cells.len() {
            let cell = cells[head];
            head += 1;
            for next in grid.neighbors(cell) {
                if land[next] == 0 || visited[next] {
                    continue;
                }
                visited[next] = true;
                cells.push(next);
            }
        }
        if cells.len() > largest.len() {
            std::mem::swap(&mut largest, &mut cells);
        }
    }
    largest
}

fn open_sea(grid: Grid, land: &[u8]) -> Vec<bool> {
    let mut ocean = vec![false; land.len()];
    let mut cells = Vec::new();
    for (cell, &dry) in land.iter().enumerate() {
        let x = cell % grid.width;
        let y = cell / grid.width;
        if dry == 0 && (x == 0 || x + 1 == grid.width || y == 0 || y + 1 == grid.height) {
            ocean[cell] = true;
            cells.push(cell);
        }
    }
    let mut head = 0;
    while head < cells.len() {
        let cell = cells[head];
        head += 1;
        for next in grid.neighbors(cell) {
            if ocean[next] || land[next] != 0 {
                continue;
            }
            ocean[next] = true;
            cells.push(next);
        }
    }
    ocean
}

fn noise(seed: u32, index: u32) -> f64 {
    let mut n = seed ^ index.wrapping_mul(0x9e37_79b9);
    n = (n ^ n >> 16).wrapping_mul(0x7feb_352d);
    n = (n ^ n >> 15).wrapping_mul(0x846c_a68b);
    (n ^ n >> 16) as f64 / u32::MAX as f64
}

fn choose_sites(grid: Grid, mainland: &[bool], ocean: &[bool], scale: f64, seed: u32) -> Vec<Site> {
    let mut sites = Vec::new();
    for (face_number, face) in [Face::South, Face::North, Face::East, Face::West]
        .into_iter()
        .enumerate()
    {
        let across = face.across(grid);
        let depth = face.depth(grid);
        let mut coast = vec![-1; across as usize];
        let mut depth_run = vec![0; across as usize];
        for column in 0..across {
            let at = column as usize;
            let mut depth_start = None;
            for row in 1..depth {
                let cell = face.cell(grid, column, row).unwrap();
                if !mainland[cell] {
                    continue;
                }
                let previous = face.cell(grid, column, row - 1).unwrap();
                if grid.interior(cell) && ocean[previous] {
                    depth_start = Some(row);
                }
                break;
            }
            let Some(shore) = depth_start else { continue };
            // A nearly continuous interior run estimates useful inlet depth.
            let mut misses = 0;
            for row in shore..depth {
                let cell = face.cell(grid, column, row).unwrap();
                if !grid.interior(cell) {
                    break;
                }
                if !mainland[cell] {
                    misses += 1;
                }
                if misses >= 4 {
                    break;
                }
                depth_run[at] += 1;
            }
            coast[at] = shore;
        }
        let margin = (34.0 * scale).ceil() as i32 + 2;
        for center in margin..across - margin {
            let mut channels = Vec::with_capacity(CHANNELS.len());
            let mut score = 0.0;
            let mut nearest = depth;
            let mut farthest = 0;
            let mut latitude = 0.0;
            for (index, &(offset, length, radius, drift)) in CHANNELS.iter().enumerate() {
                let column = center + (offset * scale).round() as i32;
                let mouth = coast[column as usize];
                let run = depth_run[column as usize];
                let target = (length * scale).round() as i32;
                let length = target.min(run - 3);
                if mouth < 0 || length < 6 || length * 3 < target * 2 {
                    continue;
                }
                let seed_index = (index as u32 + 1) ^ ((face_number as u32) << 24);
                let channel = Channel {
                    across: column,
                    mouth,
                    length,
                    radius: (radius * scale).max(1.45),
                    drift: drift * scale,
                    phase: index as f64 * 2.4 + noise(seed, seed_index) * 0.8,
                };
                let centroid =
                    face.position(grid, column, mouth + length / 3).1 as f64 / grid.height as f64;
                latitude += centroid;
                nearest = nearest.min(mouth);
                farthest = farthest.max(mouth);
                score += 32.0 + length as f64 / target.max(1) as f64 * 8.0;
                channels.push(channel);
            }
            if channels.len() < 3 {
                continue;
            }
            let span = farthest - nearest;
            if span as f64 > 31.0 * scale + 5.0 {
                continue;
            }
            let latitude = latitude / channels.len() as f64;
            // Prefer modestly curved, cool-temperate shores to an extreme polar
            // or tropical site. The existing continent still chooses the coast.
            score -= (span as f64 - 8.0 * scale).abs() * 1.25;
            score -= (latitude - 0.39).abs() * 17.0;
            score += noise(seed, center as u32 ^ ((face_number as u32 + 11) << 16)) * 2.2;
            sites.push(Site {
                face,
                center,
                score,
                channels,
            });
        }
    }
    sites.sort_unstable_by(|a, b| b.score.total_cmp(&a.score));
    sites
}

fn trace_channel(
    grid: Grid,
    face: Face,
    channel: Channel,
    land: &[u8],
    mainland: &[bool],
    ocean: &[bool],
    touched: &mut [u8],
    footprint: &mut Vec<usize>,
    wet: &mut Vec<usize>,
) -> bool {
    footprint.clear();
    wet.clear();
    for advance in -3..=channel.length + 2 {
        let (center, radius) = channel.shape(advance);
        let depth = channel.mouth + advance;
        for across in (center - radius - 1.0).floor() as i32..=(center + radius + 1.0).ceil() as i32
        {
            let Some(cell) = face.cell(grid, across, depth) else {
                continue;
            };
            // Ocean outside the reserve can feed the trace. Do not cut or
            // tag protective polar sea lanes or unrelated islets.
            if land[cell] != 0 && (!grid.interior(cell) || !mainland[cell]) {
                continue;
            }
            let roughness = (across as f64 * 1.2 + depth as f64 * 0.83).sin() * 0.32
                + (across as f64 * 0.29 + depth as f64 * 0.31).cos() * 0.48;
            if (across as f64 - center).abs() > radius + roughness {
                continue;
            }
            footprint.push(cell);
            if advance <= 2 && ocean[cell] {
                touched[cell] = 2;
                wet.push(cell);
            } else {
                touched[cell] = 1;
            }
        }
    }
    let mut head = 0;
    let mut excavated = 0;
    while head < wet.len() {
        let cell = wet[head];
        head += 1;
        excavated += usize::from(mainland[cell]);
        for next in grid.neighbors(cell) {
            if touched[next] != 1 {
                continue;
            }
            touched[next] = 2;
            wet.push(next);
        }
    }
    for &cell in footprint.iter() {
        touched[cell] = 0;
    }
    excavated >= (channel.length as usize * 2).max(12)
}

fn mainland_connected(
    grid: Grid,
    mainland: &[bool],
    tags: &[u8],
    expected: usize,
    visited: &mut [bool],
    cells: &mut Vec<usize>,
) -> bool {
    cells.clear();
    visited.fill(false);
    let Some(start) = mainland
        .iter()
        .zip(tags)
        .position(|(&land, &tag)| land && tag != FJORD_WATER)
    else {
        return false;
    };
    cells.push(start);
    visited[start] = true;
    let mut head = 0;
    while head < cells.len() {
        let cell = cells[head];
        head += 1;
        for next in grid.neighbors(cell) {
            if visited[next] || !mainland[next] || tags[next] == FJORD_WATER {
                continue;
            }
            visited[next] = true;
            cells.push(next);
        }
    }
    cells.len() == expected
}

fn distance_from(
    grid: Grid,
    count: usize,
    sources: impl Iterator<Item = usize>,
    limit: u8,
) -> Vec<u8> {
    let mut distance = vec![u8::MAX; count];
    let mut queue = Vec::new();
    for source in sources {
        distance[source] = 0;
        queue.push(source);
    }
    let mut head = 0;
    while head < queue.len() {
        let cell = queue[head];
        head += 1;
        let next_distance = distance[cell] + 1;
        if next_distance > limit {
            continue;
        }
        for next in grid.neighbors(cell) {
            if distance[next] != u8::MAX {
                continue;
            }
            distance[next] = next_distance;
            queue.push(next);
        }
    }
    distance
}

fn finish_banks(grid: Grid, land: &[u8], tags: &mut [u8], harbors: &[(i32, i32)], seed: u32) {
    let fjord_distance = distance_from(
        grid,
        land.len(),
        (0..land.len()).filter(|&i| tags[i] == FJORD_WATER),
        11,
    );
    let water_distance = distance_from(
        grid,
        land.len(),
        (0..land.len()).filter(|&i| land[i] == 0 || tags[i] == FJORD_WATER),
        6,
    );
    for (cell, tag) in tags.iter_mut().enumerate() {
        if *tag != 0 || land[cell] == 0 || !grid.interior(cell) || fjord_distance[cell] > 11 {
            continue;
        }
        let x = (cell % grid.width) as i32;
        let y = (cell / grid.width) as i32;
        let pocket = harbors
            .iter()
            .any(|&(hx, hy)| (x - hx).pow(2) + (y - hy).pow(2) <= 25);
        // Weight broad alternating patches rather than scattering isolated
        // buildable cells among the rocks that define the headlands.
        let broad = ((x as f64 + seed as f64 * 0.00001) * 0.22 + (y as f64 * 0.16).sin()).sin();
        let shore_depth = if pocket {
            5
        } else if broad > 0.72 {
            3
        } else if broad < -0.24 {
            1
        } else {
            2
        };
        if water_distance[cell] <= shore_depth {
            *tag = FJORD_SHORE;
        } else if fjord_distance[cell] <= 9 + u8::from(broad > 0.0) {
            *tag = FJORD_ROCK;
        }
    }
}

fn select_coast(grid: Grid, land: &[u8], seed: u32, tags: &mut [u8]) {
    let ocean = open_sea(grid, land);
    let main = largest_land(grid, land);
    if main.len() < 120 {
        return;
    }
    let mut mainland = vec![false; land.len()];
    for &cell in &main {
        mainland[cell] = true;
    }
    let mut touched = vec![0; land.len()];
    let mut visited = vec![false; land.len()];
    let mut cells = Vec::with_capacity(main.len());
    let mut footprint = Vec::new();
    let mut wet = Vec::new();
    let mut drafted = Vec::new();
    let mut harbors = Vec::new();
    let scale = (grid.width.min(grid.height) as f64 / 154.0).clamp(0.28, 1.06);
    for scale_factor in [1.0, 0.79, 0.60] {
        let scale = (scale * scale_factor).max(0.25);
        let mut tested: Vec<(Face, i32)> = Vec::new();
        for site in choose_sites(grid, &mainland, &ocean, scale, seed) {
            if tested.iter().any(|&(face, center)| {
                face == site.face && (center - site.center).abs() < (12.0 * scale) as i32
            }) {
                continue;
            }
            if tested.len() >= MAX_SITES_PER_SCALE {
                break;
            }
            tested.push((site.face, site.center));
            drafted.clear();
            harbors.clear();
            let mut carved_count = 0;
            let mut accepted = 0;
            for (index, channel) in site.channels.into_iter().enumerate() {
                if !trace_channel(
                    grid,
                    site.face,
                    channel,
                    land,
                    &mainland,
                    &ocean,
                    &mut touched,
                    &mut footprint,
                    &mut wet,
                ) {
                    continue;
                }
                let mut added = 0;
                let first_new = drafted.len();
                for &cell in &wet {
                    if !grid.interior(cell) || tags[cell] == FJORD_WATER {
                        continue;
                    }
                    tags[cell] = FJORD_WATER;
                    drafted.push(cell);
                    added += usize::from(mainland[cell]);
                }
                if added < (channel.length as usize).max(10)
                    || carved_count + added > main.len() / 9
                    || !mainland_connected(
                        grid,
                        &mainland,
                        tags,
                        main.len() - carved_count - added,
                        &mut visited,
                        &mut cells,
                    )
                {
                    for cell in drafted.drain(first_new..) {
                        tags[cell] = 0;
                    }
                    continue;
                }
                carved_count += added;
                accepted += 1;
                if index % 2 == 1 {
                    let advance = channel.length / 2;
                    let (center, radius) = channel.shape(advance);
                    let side = if index == 1 { -1.0 } else { 1.0 };
                    harbors.push(site.face.position(
                        grid,
                        (center + side * (radius + 2.5)).round() as i32,
                        channel.mouth + advance,
                    ));
                }
            }
            if accepted >= 3 {
                finish_banks(grid, land, tags, &harbors, seed);
                return;
            }
            for &cell in &drafted {
                tags[cell] = 0;
            }
        }
    }
}
