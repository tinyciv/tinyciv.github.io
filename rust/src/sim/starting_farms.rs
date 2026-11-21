use bevy_ecs::prelude::Resource;
use rustc_hash::{FxHashMap, FxHashSet};

const SHAPES: [(i32, i32); 12] = [
    (4, 4), (4, 3), (3, 4), (3, 3), (3, 2), (2, 3),
    (2, 2), (3, 1), (1, 3), (2, 1), (1, 2), (1, 1),
];
const SITE_STRIDE: usize = 3;

#[derive(Clone, Copy)]
struct Parcel {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    production: f64,
    travel: f64,
}

impl Parcel {
    fn area(self) -> i32 { self.width * self.height }

    fn bounds(self) -> (i32, i32, i32, i32) {
        (self.x, self.y, self.x + self.width, self.y + self.height)
    }

    fn cells(self, stride: i32) -> impl Iterator<Item = i32> {
        let (left, top, right, bottom) = self.bounds();
        (top..bottom).flat_map(move |y| (left..right).map(move |x| y * stride + x))
    }

    fn reserve(self, width: i32, height: i32, reserved: &mut FxHashSet<i32>) {
        let (left, top, right, bottom) = self.bounds();
        reserved.extend(self.cells(width));
        for y in top..bottom {
            if left > 0 { reserved.insert(y * width + left - 1); }
            if right < width { reserved.insert(y * width + right); }
        }
        for x in left..right {
            if top > 0 { reserved.insert((top - 1) * width + x); }
            if bottom < height { reserved.insert(bottom * width + x); }
        }
    }
}

#[derive(Default)]
struct Layout {
    cells: Vec<i32>,
    supply: f64,
}

#[derive(Default, Resource)]
pub struct StartingFarms {
    input: Vec<f64>,
    output: Vec<f64>,
    parcels: Vec<Parcel>,
}

impl StartingFarms {
    pub fn input(&mut self, sites: usize, existing: usize) -> *mut f64 {
        self.input.resize(sites * SITE_STRIDE + existing, 0.0);
        self.input.as_mut_ptr()
    }

    /// Score legal rectangles once, then reserve whole parcels with one tile
    /// of space around their edges. Each anchor checks a fixed set of shapes.
    /// Output is [count, production, ...cells] in deterministic planting order.
    pub fn plan(&mut self, width: i32, height: i32, sites: usize, target: f64) -> *const f64 {
        let (sites, existing) = self.input.split_at(sites * SITE_STRIDE);
        let mut blocked = FxHashSet::default();
        for &value in existing {
            let cell = value as i32;
            let parcel = Parcel { x: cell % width, y: cell / width, width: 1, height: 1, production: 0.0, travel: 0.0 };
            parcel.reserve(width, height, &mut blocked);
        }
        let available: FxHashMap<i32, (f64, f64)> = sites.chunks_exact(SITE_STRIDE)
            .filter_map(|site| {
                let cell = site[0] as i32;
                (!blocked.contains(&cell)).then_some((cell, (site[1], site[2])))
            }).collect();
        self.parcels.clear();
        for &cell in available.keys() {
            let (x, y) = (cell % width, cell / width);
            for (columns, rows) in SHAPES {
                if x + columns > width || y + rows > height { continue; }
                let mut parcel = Parcel { x, y, width: columns, height: rows, production: 0.0, travel: 0.0 };
                let fits = parcel.cells(width).all(|tile| {
                    let Some(&(production, travel)) = available.get(&tile) else { return false; };
                    parcel.production += production;
                    parcel.travel += travel;
                    true
                });
                if fits { self.parcels.push(parcel); }
            }
        }

        self.parcels.sort_unstable_by(|a, b| {
            b.area().cmp(&a.area()).then(b.production.total_cmp(&a.production))
                .then(a.travel.total_cmp(&b.travel)).then(a.y.cmp(&b.y)).then(a.x.cmp(&b.x)).then(a.width.cmp(&b.width))
        });
        let mut layout = fit_parcels(&self.parcels, &blocked, width, height, target);
        if layout.supply + 1e-7 < target {
            // A strict size-first layout can spend scarce ground on poorer
            // land. Keep the better-yielding rectangular plan if necessary.
            let score = |parcel: &Parcel| {
                let area = f64::from(parcel.area());
                parcel.production / area * (1.0 + 0.2 * (area - 1.0) / 15.0)
            };
            self.parcels.sort_unstable_by(|a, b| {
                (a.area() == 1).cmp(&(b.area() == 1)).then(score(b).total_cmp(&score(a)))
                    .then(b.area().cmp(&a.area())).then(a.travel.total_cmp(&b.travel))
                    .then(a.y.cmp(&b.y)).then(a.x.cmp(&b.x)).then(a.width.cmp(&b.width))
            });
            let alternative = fit_parcels(&self.parcels, &blocked, width, height, target);
            if alternative.supply > layout.supply { layout = alternative; }
        }
        self.output.clear();
        self.output.extend([layout.cells.len() as f64, layout.supply]);
        self.output.extend(layout.cells.into_iter().map(f64::from));
        self.output.as_ptr()
    }
}

fn fit_parcels(parcels: &[Parcel], blocked: &FxHashSet<i32>, width: i32, height: i32, target: f64) -> Layout {
    let mut reserved = blocked.clone();
    let mut layout = Layout::default();
    let mut planted = 0;
    let mut singles = 0;
    for &parcel in parcels {
        if layout.supply + 1e-7 >= target || singles >= (planted / 12).max(1) { break; }
        if parcel.cells(width).any(|cell| reserved.contains(&cell)) { continue; }
        parcel.reserve(width, height, &mut reserved);
        layout.cells.extend(parcel.cells(width));
        layout.supply += parcel.production;
        if parcel.area() == 1 { singles += 1; } else { planted += 1; }
    }
    layout
}
