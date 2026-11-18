//! Weighted A*, multi-source Dijkstra, and nearest-city fields. Queries reuse
//! all search buffers. Topology, terrain, and masks live in WASM linear memory.
const ROOT2: f64 = std::f64::consts::SQRT_2;
const DIRECTIONS: [(i32, i32); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];

#[derive(Default)]
pub struct Navigation {
    count: usize,
    width: usize,
    pub edges: Vec<u8>,
    pub terrain: Vec<f64>,
    /// Ground/ford/bridge cells for civilian route preference; never water-only cells.
    pub land: Vec<u8>,
    amphibious_route: Vec<i32>,
    land_component: Vec<u32>,
    pub land_origins: Vec<i32>,
    pub land_goals: Vec<i32>,
    pub blocked: Vec<u8>,
    pub soft: Vec<u8>,
    pub penalty: Vec<f64>,
    pub costs: Vec<f64>,
    pub previous: Vec<i32>,
    seen: Vec<u32>,
    closed: Vec<u32>,
    pub output: Vec<i32>,
    heap_indices: Vec<usize>,
    heap_scores: Vec<f64>,
    heap_length: usize,
    stamp: u32,
}

fn heuristic(x: i32, y: i32, gx: i32, gy: i32, cardinal: bool) -> f64 {
    let dx = (x - gx).abs() as f64;
    let dy = (y - gy).abs() as f64;
    if cardinal { (dx + dy) / 1.5 } else { (dx.max(dy) + (ROOT2 - 1.0) * dx.min(dy)) / 1.5 }
}

impl Navigation {
    pub fn configure(&mut self, cells: usize, columns: usize) {
        assert!(columns > 0 && cells % columns == 0);
        self.count = cells; self.width = columns;
        self.edges = vec![0; cells]; self.terrain = vec![0.0; cells];
        self.land = vec![1; cells]; self.amphibious_route = Vec::with_capacity(cells);
        self.land_component = vec![0; cells];
        self.land_origins = vec![0; cells]; self.land_goals = vec![0; cells];
        self.blocked = vec![0; cells]; self.soft = vec![0; cells]; self.penalty = vec![0.0; cells];
        self.costs = vec![0.0; cells]; self.previous = vec![0; cells];
        self.seen = vec![0; cells]; self.closed = vec![0; cells]; self.output = vec![0; cells];
        // The frontier is usually a small fraction of the map. Retain the
        // high-water storage for subsequent searches without reserving eight
        // entries per world cell up front on every navigation profile.
        self.heap_indices.clear(); self.heap_scores.clear();
        self.heap_length = 0; self.stamp = 0;
    }

    fn push(&mut self, index: usize, score: f64) {
        let mut i = self.heap_length; self.heap_length += 1;
        if i == self.heap_indices.len() {
            self.heap_indices.push(0); self.heap_scores.push(0.0);
        }
        while i > 0 {
            let parent = (i - 1) >> 1;
            let parent_score = self.heap_scores[parent];
            if parent_score <= score { break; }
            self.heap_indices[i] = self.heap_indices[parent]; self.heap_scores[i] = parent_score;
            i = parent;
        }
        self.heap_indices[i] = index; self.heap_scores[i] = score;
    }

    fn pop(&mut self) -> (usize, f64) {
        let first = (self.heap_indices[0], self.heap_scores[0]);
        self.heap_length -= 1;
        if self.heap_length == 0 { return first; }
        let last = self.heap_indices[self.heap_length]; let score = self.heap_scores[self.heap_length];
        let mut i = 0;
        while i * 2 + 1 < self.heap_length {
            let mut child = i * 2 + 1;
            if child + 1 < self.heap_length && self.heap_scores[child + 1] < self.heap_scores[child] { child += 1; }
            if self.heap_scores[child] >= score { break; }
            self.heap_indices[i] = self.heap_indices[child]; self.heap_scores[i] = self.heap_scores[child]; i = child;
        }
        self.heap_indices[i] = last; self.heap_scores[i] = score;
        first
    }

    fn begin_search(&mut self) {
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 { self.seen.fill(0); self.closed.fill(0); self.stamp = 1; }
        self.heap_length = 0;
    }

    fn next(&self, current: usize, direction: usize) -> usize {
        let (dx, dy) = DIRECTIONS[direction];
        (current as i32 + dy * self.width as i32 + dx) as usize
    }

    fn edge_cost(&self, current: usize, next: usize, direction: usize) -> f64 {
        let (dx, dy) = DIRECTIONS[direction];
        (if dx != 0 && dy != 0 { ROOT2 } else { 1.0 }) * (self.terrain[current] + self.terrain[next]) * 0.5
    }

    pub fn travel_map(&mut self, origins: usize, speed: f64, max_seconds: f64) {
        self.heap_length = 0; self.costs.fill(f64::INFINITY);
        for i in 0..origins {
            let start = self.output[i] as usize;
            self.costs[start] = 0.0; self.push(start, 0.0);
        }
        while self.heap_length > 0 {
            let (current, score) = self.pop();
            if score > self.costs[current] { continue; }
            for direction in 0..8 {
                if self.edges[current] & (1 << direction) == 0 { continue; }
                let next = self.next(current, direction);
                let cost = score + self.edge_cost(current, next, direction) / speed;
                if cost > max_seconds || cost >= self.costs[next] { continue; }
                self.costs[next] = cost; self.push(next, cost);
            }
        }
    }

    pub fn nearest_map(&mut self, origins: usize) {
        self.heap_length = 0; self.previous.fill(-1); self.costs.fill(f64::INFINITY);
        for i in 0..origins {
            let start = self.output[i] as usize;
            self.costs[start] = 0.0; self.previous[start] = self.penalty[start] as i32; self.push(start, 0.0);
        }
        while self.heap_length > 0 {
            let (current, score) = self.pop();
            if score > self.costs[current] { continue; }
            let owner = self.previous[current];
            for direction in 0..8 {
                if self.edges[current] & (1 << direction) == 0 { continue; }
                let next = self.next(current, direction);
                let cost = score + self.edge_cost(current, next, direction);
                if cost < self.costs[next] {
                    self.costs[next] = cost; self.previous[next] = owner; self.push(next, cost);
                } else if cost == self.costs[next] && owner < self.previous[next] { self.previous[next] = owner; }
            }
        }
    }

    fn reconstruct(&mut self, start: i32, end: usize) -> i32 {
        let mut size = 0;
        let mut step = end as i32;
        while step != start && step != -1 {
            self.output[size] = step; size += 1; step = self.previous[step as usize];
        }
        self.output[..size].reverse();
        size as i32
    }

    pub fn search_many(&mut self, origins: usize, min_x: i32, min_y: i32, max_x: i32, max_y: i32) -> i32 {
        self.begin_search();
        for i in 0..origins {
            let start = self.output[i] as usize;
            let x = (start % self.width) as i32; let y = (start / self.width) as i32;
            self.costs[start] = 0.0; self.seen[start] = self.stamp; self.previous[start] = -1;
            self.push(start, heuristic(x, y, x.clamp(min_x, max_x), y.clamp(min_y, max_y), false));
        }
        while self.heap_length > 0 {
            let (current, _) = self.pop();
            if self.closed[current] == self.stamp { continue; }
            if self.blocked[current] != 0 { return self.reconstruct(-1, current); }
            self.closed[current] = self.stamp;
            let x = (current % self.width) as i32; let y = (current / self.width) as i32;
            for (direction, (dx, dy)) in DIRECTIONS.iter().enumerate() {
                if self.edges[current] & (1 << direction) == 0 { continue; }
                let next = self.next(current, direction);
                if self.closed[next] == self.stamp { continue; }
                let cost = self.costs[current] + self.edge_cost(current, next, direction);
                if self.seen[next] == self.stamp && cost >= self.costs[next] { continue; }
                self.costs[next] = cost; self.previous[next] = current as i32; self.seen[next] = self.stamp;
                let nx = x + dx; let ny = y + dy;
                self.push(next, cost + heuristic(nx, ny, nx.clamp(min_x, max_x), ny.clamp(min_y, max_y), false));
            }
        }
        -1
    }

    /// Rebuilt only on navigation access revisions, never for cost-only edits.
    /// The output buffer is free between queries and doubles as the flood queue.
    pub fn index_land(&mut self) {
        self.land_component.fill(0);
        let mut component = 0;
        for start in 0..self.count {
            if self.land[start] == 0 || self.land_component[start] != 0 { continue; }
            component += 1; self.land_component[start] = component; self.output[0] = start as i32;
            let mut head = 0; let mut tail = 1;
            while head < tail {
                let current = self.output[head] as usize; head += 1;
                for direction in 0..8 {
                    if self.edges[current] & (1 << direction) == 0 { continue; }
                    let next = self.next(current, direction);
                    if self.land[next] == 0 || self.land_component[next] != 0 { continue; }
                    self.land_component[next] = component; self.output[tail] = next as i32; tail += 1;
                }
            }
        }
    }

    /// A boat journey is justified only when its land/ford alternative is at
    /// least ten times as long. Compare physical lengths, independent of road
    /// speeds. Run only after a route actually uses water; A* stops at the
    /// strict length limit and reuses the resident search buffers.
    pub fn route_is_ground(&self, start: usize, size: usize) -> bool {
        size > 0 && self.land[start] != 0 && self.output[..size].iter().all(|&cell| self.land[cell as usize] != 0)
    }
    pub fn prefer_land(&mut self, start: usize, size: usize, includes_start: bool) -> i32 {
        if size == 0 { return 0; }
        self.land_origins[0] = start as i32; self.land_goals[0] = self.output[size - 1];
        self.prefer_land_many(1, 1, size, includes_start)
    }
    pub fn prefer_land_many(&mut self, origins: usize, goals: usize, size: usize, includes_start: bool) -> i32 {
        if size == 0 || !self.output[..size].iter().any(|&cell| self.land[cell as usize] == 0) { return size as i32; }
        let start = if includes_start { self.output[0] as usize } else { self.land_origins[0] as usize };
        let goal = self.output[size - 1] as usize;
        let mut min_x = self.width as i32; let mut min_y = (self.count / self.width) as i32;
        let mut max_x = 0; let mut max_y = 0;
        let mut usable_goals = 0;
        for i in 0..goals {
            let cell = self.land_goals[i] as usize;
            if self.land[cell] == 0 { continue; }
            usable_goals += 1;
            let x = (cell % self.width) as i32; let y = (cell / self.width) as i32;
            min_x = min_x.min(x); max_x = max_x.max(x); min_y = min_y.min(y); max_y = max_y.max(y);
        }
        if usable_goals == 0 { return size as i32; }
        let mut previous = start; let mut length = 0.0;
        for &cell in &self.output[..size] {
            let cell = cell as usize;
            let dx = (cell % self.width) as f64 - (previous % self.width) as f64;
            let dy = (cell / self.width) as f64 - (previous / self.width) as f64;
            length += dx.hypot(dy); previous = cell;
        }
        let limit = length * 10.0; let weighted_cost = self.costs[goal];
        self.amphibious_route.clear(); self.amphibious_route.extend_from_slice(&self.output[..size]);
        self.begin_search();
        let estimate = |cell: usize, width: usize| {
            let x = (cell % width) as i32; let y = (cell / width) as i32;
            let dx = (x - x.clamp(min_x, max_x)).abs() as f64;
            let dy = (y - y.clamp(min_y, max_y)).abs() as f64;
            dx.max(dy) + (ROOT2 - 1.0) * dx.min(dy)
        };
        for i in 0..origins {
            let origin = self.land_origins[i] as usize;
            if self.land[origin] == 0 || !self.land_goals[..goals].iter().any(|&target|
                self.land_component[origin] == self.land_component[target as usize] && self.land[target as usize] != 0) { continue; }
            self.costs[origin] = 0.0; self.previous[origin] = -1; self.seen[origin] = self.stamp;
            self.push(origin, estimate(origin, self.width));
        }
        while self.heap_length > 0 {
            let (current, score) = self.pop();
            if score >= limit { break; }
            if self.closed[current] == self.stamp { continue; }
            if self.land_goals[..goals].contains(&(current as i32)) {
                let mut size = self.reconstruct(-1, current) as usize;
                let mut weighted_cost = 0.0;
                for pair in self.output[..size].windows(2) {
                    let a = pair[0] as usize; let b = pair[1] as usize;
                    let dx = (b % self.width) as f64 - (a % self.width) as f64;
                    let dy = (b / self.width) as f64 - (a / self.width) as f64;
                    weighted_cost += dx.hypot(dy) * (self.terrain[a] + self.terrain[b]) * 0.5;
                }
                self.costs[current] = weighted_cost;
                if !includes_start { self.output.copy_within(1..size, 0); size -= 1; }
                return size as i32;
            }
            self.closed[current] = self.stamp;
            for direction in 0..8 {
                if self.edges[current] & (1 << direction) == 0 { continue; }
                let next = self.next(current, direction);
                if self.land[next] == 0 || self.closed[next] == self.stamp || next != start && self.blocked[next] != 0 { continue; }
                let (dx, dy) = DIRECTIONS[direction];
                let cost = self.costs[current] + if dx != 0 && dy != 0 { ROOT2 } else { 1.0 };
                let score = cost + estimate(next, self.width);
                if score >= limit || self.seen[next] == self.stamp && cost >= self.costs[next] { continue; }
                self.costs[next] = cost; self.previous[next] = current as i32; self.seen[next] = self.stamp;
                self.push(next, score);
            }
        }
        self.output[..size].copy_from_slice(&self.amphibious_route); self.costs[goal] = weighted_cost;
        size as i32
    }

    pub fn search(&mut self, start: usize, gx: i32, gy: i32, goal_open: bool, partial: bool, cardinal: bool, nearest: f64) -> i32 {
        self.begin_search();
        let sx = (start % self.width) as i32; let sy = (start / self.width) as i32;
        let goal = gy * self.width as i32 + gx;
        let mut closest = start; let mut closest_distance = heuristic(sx, sy, gx, gy, cardinal);
        self.costs[start] = 0.0; self.seen[start] = self.stamp; self.previous[start] = -1;
        self.push(start, closest_distance);
        while self.heap_length > 0 {
            let (current, _) = self.pop();
            if self.closed[current] == self.stamp { continue; }
            if current as i32 == goal && goal_open { return self.reconstruct(start as i32, current); }
            self.closed[current] = self.stamp;
            let x = (current % self.width) as i32; let y = (current / self.width) as i32;
            let remaining = heuristic(x, y, gx, gy, cardinal);
            if nearest < f64::INFINITY && remaining <= nearest + 1e-8 { return self.reconstruct(start as i32, current); }
            if remaining < closest_distance || remaining == closest_distance && self.costs[current] < self.costs[closest] {
                closest = current; closest_distance = remaining;
            }
            let mask = self.edges[current] & if cardinal { 90 } else { 255 };
            for (direction, (dx, dy)) in DIRECTIONS.iter().enumerate() {
                if mask & (1 << direction) == 0 { continue; }
                let next = self.next(current, direction);
                if self.closed[next] == self.stamp || next != start && self.blocked[next] != 0 { continue; }
                let cost = self.costs[current] + self.edge_cost(current, next, direction)
                    + if self.soft[next] != 0 { 2.0 } else { 0.0 } + self.penalty[next];
                if self.seen[next] == self.stamp && cost >= self.costs[next] { continue; }
                self.costs[next] = cost; self.previous[next] = current as i32; self.seen[next] = self.stamp;
                self.push(next, cost + heuristic(x + dx, y + dy, gx, gy, cardinal));
            }
        }
        if !cardinal && partial && closest != start { self.reconstruct(start as i32, closest) } else { -1 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corridor() -> Navigation {
        let mut navigation = Navigation::default(); navigation.configure(5, 5);
        navigation.terrain.fill(1.0);
        for cell in 0..5 { navigation.edges[cell] = if cell > 0 { 8 } else { 0 } | if cell < 4 { 16 } else { 0 }; }
        navigation
    }
    #[test]
    fn narrow_route_and_blocked_partial_search() {
        let mut nav = corridor();
        assert_eq!(nav.search(0, 4, 0, true, false, false, f64::INFINITY), 4);
        assert_eq!(&nav.output[..4], &[1, 2, 3, 4]);
        nav.blocked[3] = 1;
        assert_eq!(nav.search(0, 4, 0, true, true, false, f64::INFINITY), 2);
        assert_eq!(&nav.output[..2], &[1, 2]);
    }
    fn boat_detour(height: usize) -> Navigation {
        let mut nav = Navigation::default(); nav.configure(3 * height, 3);
        nav.terrain.fill(1.0); nav.land.fill(0);
        // A two-tile water crossing at the top; the ground corridor goes all
        // the way around the bottom, with no diagonal corner shortcuts.
        for y in 0..height { nav.land[y * 3] = 1; nav.land[y * 3 + 2] = 1; }
        nav.land[(height - 1) * 3 + 1] = 1;
        for cell in 0..3 * height {
            if nav.land[cell] == 0 && cell != 1 { continue; }
            let x = cell % 3; let y = cell / 3;
            for (direction, (dx, dy)) in DIRECTIONS.iter().enumerate() {
                if *dx != 0 && *dy != 0 { continue; }
                let nx = x as i32 + dx; let ny = y as i32 + dy;
                if nx < 0 || nx >= 3 || ny < 0 || ny >= height as i32 { continue; }
                let next = ny as usize * 3 + nx as usize;
                if nav.land[next] != 0 || next == 1 { nav.edges[cell] |= 1 << direction; }
            }
        }
        nav.index_land(); nav
    }
    #[test]
    fn civilians_prefer_land_below_ten_times_the_boat_journey() {
        let mut nav = boat_detour(9);
        let size = nav.search(0, 2, 0, true, false, false, f64::INFINITY);
        assert_eq!(size, 2); assert_eq!(&nav.output[..2], &[1, 2]);
        let size = nav.prefer_land(0, size as usize, false) as usize;
        assert_eq!(size, 18);
        assert!(nav.output[..size].iter().all(|&cell| nav.land[cell as usize] != 0));
    }
    #[test]
    fn civilians_may_row_at_the_ten_times_boundary_or_without_land_access() {
        let mut nav = boat_detour(10);
        let size = nav.search(0, 2, 0, true, false, false, f64::INFINITY);
        assert_eq!(nav.prefer_land(0, size as usize, false), 2);
        assert_eq!(&nav.output[..2], &[1, 2]);
        nav.land[3] = 0; nav.index_land();
        let size = nav.search(0, 2, 0, true, false, false, f64::INFINITY);
        assert_eq!(nav.prefer_land(0, size as usize, false), 2);
        nav.land[1] = 1; // A ford is already a ground route.
        assert_eq!(nav.prefer_land(0, 2, false), 2);
    }
    #[test]
    fn travel_and_nearest_fields_share_weighted_topology() {
        let mut nav = corridor(); nav.output[0] = 0;
        nav.travel_map(1, 2.0, f64::INFINITY);
        assert_eq!(nav.costs, vec![0.0, 0.5, 1.0, 1.5, 2.0]);
        nav.output[0] = 0; nav.output[1] = 4; nav.penalty[0] = 8.0; nav.penalty[4] = 2.0;
        nav.nearest_map(2);
        assert_eq!(nav.previous, vec![8, 8, 2, 2, 2]);
    }
}
