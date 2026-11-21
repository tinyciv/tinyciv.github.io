//! City birth clocks, home assignment, and shared-food spending run as an
//! ordered Bevy ECS schedule. This batch executes once per economy tick.
//! Imported row entities and transfer buffers are retained between ticks.
use bevy_ecs::prelude::*;

pub const CITY_STRIDE: usize = 10;
pub const HOUSE_STRIDE: usize = 6;
pub const CITY_OUTPUT_STRIDE: usize = 3;
pub const GROWTH_SPEED: f64 = 3.0;
pub const MAX_BIRTHS: u32 = 10;

pub fn constant(index: u32) -> f64 {
    match index { 0 => GROWTH_SPEED, 1 => MAX_BIRTHS as f64, _ => f64::NAN }
}

#[derive(Component, Default)]
struct City {
    id: i64,
    row: usize,
    x: f64,
    y: f64,
    population: f64,
    net_food: f64,
    credit: f64,
    capacity: f64,
    unhoused: f64,
    // 0 = absent, 1 = false, 2 = true. Preserve an absent host property.
    depopulated: u32,
    population_limit: f64,
    eligible: bool,
}

impl City {
    fn remaining_population_slots(&self) -> f64 {
        (self.population_limit - self.population).floor().max(0.0)
    }
}

#[derive(Component, Default)]
struct Home {
    x: f64,
    y: f64,
    residents: f64,
    capacity: f64,
    required: f64,
}

/// Input order is authoritative for shared food and filling vacant homes;
/// ECS archetype iteration order must never decide which city gets a birth.
#[derive(Resource, Default)]
struct Rows { cities: Vec<Entity>, homes: Vec<Entity> }

#[derive(Resource, Default)]
struct HomesByCity(Vec<Vec<Entity>>);

#[derive(Resource, Default)]
struct BirthTick {
    food: f64,
    population: f64,
    hunting: f64,
    growth: f64,
    unfed: f64,
    stocked: bool,
    births: u32,
    opening: Option<OpeningCapital>,
}

pub struct OpeningCapital {
    pub id: i64,
    pub peak: f64,
}

impl OpeningCapital {
    fn observe(&mut self, residents: f64) {
        self.peak = self.peak.max(residents).min(32.0);
    }

    fn multiplier(&self) -> f64 {
        1.0 + 0.8 * ((32.0 - self.peak) / 12.0).clamp(0.0, 1.0)
    }
}

fn js_max(a: f64, b: f64) -> f64 { if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) } }

fn assign_homes(rows: Res<Rows>, cities: Query<&City>, homes: Query<&Home>, mut groups: ResMut<HomesByCity>) {
    while groups.0.len() < rows.cities.len() { groups.0.push(Vec::new()); }
    for group in &mut groups.0 { group.clear(); }
    for entity in &rows.homes {
        let home = homes.get(*entity).expect("imported home");
        let mut nearest = None;
        let mut best = f64::INFINITY;
        let mut nearest_id = i64::MAX;
        for entity in &rows.cities {
            let city = cities.get(*entity).expect("imported city");
            let dx = home.x + 0.5 - city.x - 1.0;
            let dy = home.y + 0.5 - city.y - 1.0;
            let distance = dx * dx + dy * dy;
            if distance < best || (distance == best && city.id < nearest_id) {
                nearest = Some(city.row); best = distance; nearest_id = city.id;
            }
        }
        if let Some(row) = nearest { groups.0[row].push(*entity); }
    }
}

/// Credit every city before any birth consumes the shared treasury of food.
fn credit_cities(rows: Res<Rows>, mut tick: ResMut<BirthTick>, mut cities: Query<&mut City>) {
    for entity in &rows.cities {
        let mut city = cities.get_mut(*entity).expect("imported city");
        let multiplier = tick.opening.as_mut().filter(|opening| opening.id == city.id)
            .map_or(1.0, |opening| {
                opening.observe(city.population);
                opening.multiplier()
            });
        city.eligible = false;
        if city.population > 0.0 { city.depopulated = 0; }
        let slots = city.remaining_population_slots();
        if slots == 0.0 || (city.depopulated == 2 && city.population <= 0.0) { city.credit = 0.0; continue; }
        if city.net_food > 0.0 && tick.stocked {
            city.credit += GROWTH_SPEED * (0.14 + city.net_food / 13.0).min(2.4) * (tick.hunting + tick.growth - 1.0) * multiplier;
            city.eligible = true;
        } else if tick.unfed > 1e-7 { city.credit = js_max(0.0, city.credit - 0.3); }
        city.credit = city.credit.min(slots);
    }
}

fn release_births(rows: Res<Rows>, groups: Res<HomesByCity>, mut tick: ResMut<BirthTick>,
    mut cities: Query<&mut City>, mut homes: Query<&mut Home>) {
    for entity in &rows.cities {
        let mut city = cities.get_mut(*entity).expect("imported city");
        if !city.eligible { continue; }
        let vacant = &groups.0[city.row];
        let slots = city.remaining_population_slots();
        let allowance = ((MAX_BIRTHS as f64 * tick.growth).floor().min(slots)) as u32;
        let mut births = 0;
        let mut cursor = 0;
        while births < allowance && tick.food + 1e-7 >= 4.0 {
            while let Some(entity) = vacant.get(cursor) {
                let home = homes.get(*entity).expect("assigned home");
                if !(home.residents >= home.capacity) { break; }
                cursor += 1;
            }
            let required;
            if let Some(entity) = vacant.get(cursor) {
                let mut home = homes.get_mut(*entity).expect("assigned home");
                required = home.required;
                if city.credit + 1e-9 < required { break; }
                home.residents += 1.0;
            } else {
                let palace_vacancy = js_max(0.0, city.capacity - city.unhoused);
                if palace_vacancy == 0.0 || palace_vacancy.is_nan() { break; }
                required = 1.0;
                if city.credit + 1e-9 < required { break; }
                city.unhoused += 1.0;
            }
            tick.population += 1.0;
            tick.food = js_max(0.0, tick.food - 4.0);
            city.credit = js_max(0.0, city.credit - required);
            births += 1;
            tick.births += 1;
        }
        // Discard credit beyond the remaining civic capacity, even if an
        // enclosed home used less than one credit for the last birth.
        city.credit = city.credit.min(slots - f64::from(births));
        if let Some(opening) = tick.opening.as_mut().filter(|opening| opening.id == city.id) {
            opening.observe(city.population + f64::from(births));
        }
    }
}

pub struct PopulationEngine {
    world: World,
    schedule: Schedule,
    city_entities: Vec<Entity>,
    home_entities: Vec<Entity>,
    city_count: usize,
    home_count: usize,
    input: Vec<f64>,
    output: Vec<f64>,
}

impl Default for PopulationEngine {
    fn default() -> Self {
        let mut world = World::new();
        world.init_resource::<Rows>();
        world.init_resource::<HomesByCity>();
        world.init_resource::<BirthTick>();
        let mut schedule = Schedule::default();
        schedule.add_systems((assign_homes, credit_cities, release_births).chain());
        Self { world, schedule, city_entities: Vec::new(), home_entities: Vec::new(), city_count: 0,
            home_count: 0, input: Vec::new(), output: Vec::new() }
    }
}

impl PopulationEngine {
    /// Input: city rows [ID,x,y,population,net food,credit,capacity,unhoused,depopulation tag,population limit],
    /// followed by home rows [ID,x,y,residents,capacity,required credit].
    /// Row entities form a reusable pool: imports change components in place,
    /// and inactive rows never participate in a system query.
    pub fn configure(&mut self, cities: usize, homes: usize) -> *mut f64 {
        self.city_count = cities; self.home_count = homes;
        self.input.resize(cities * CITY_STRIDE + homes * HOUSE_STRIDE, 0.0);
        self.output.resize(3 + cities * CITY_OUTPUT_STRIDE + homes, 0.0);
        while self.city_entities.len() < cities { self.city_entities.push(self.world.spawn(City::default()).id()); }
        while self.home_entities.len() < homes { self.home_entities.push(self.world.spawn(Home::default()).id()); }
        self.input.as_mut_ptr()
    }

    #[cfg(test)]
    pub fn run(&mut self, food: f64, population: f64, hunting: f64, unfed: f64) -> *const f64 {
        self.run_with_growth(food, population, hunting, unfed, 1.0, None)
    }

    pub fn opening_peak(&self) -> f64 {
        self.world.resource::<BirthTick>().opening.as_ref().map_or(0.0, |opening| opening.peak)
    }

    pub fn run_with_growth(&mut self, food: f64, population: f64, hunting: f64, unfed: f64, growth: f64,
        opening: Option<OpeningCapital>) -> *const f64 {
        for row in 0..self.city_count {
            let values = &self.input[row * CITY_STRIDE..];
            *self.world.get_mut::<City>(self.city_entities[row]).expect("city pool") = City {
                id: values[0] as i64, row, x: values[1], y: values[2], population: values[3], net_food: values[4],
                credit: values[5], capacity: values[6], unhoused: values[7], depopulated: values[8] as u32,
                population_limit: values[9], eligible: false,
            };
        }
        for row in 0..self.home_count {
            let values = &self.input[self.city_count * CITY_STRIDE + row * HOUSE_STRIDE..];
            *self.world.get_mut::<Home>(self.home_entities[row]).expect("home pool") = Home {
                x: values[1], y: values[2], residents: values[3], capacity: values[4], required: values[5],
            };
        }
        {
            let mut rows = self.world.resource_mut::<Rows>();
            rows.cities.clear(); rows.cities.extend_from_slice(&self.city_entities[..self.city_count]);
            rows.homes.clear(); rows.homes.extend_from_slice(&self.home_entities[..self.home_count]);
        }
        *self.world.resource_mut::<BirthTick>() = BirthTick { food, population, hunting, growth, unfed, stocked: food >= 6.0, births: 0, opening };
        self.schedule.run(&mut self.world);
        let tick = self.world.resource::<BirthTick>();
        self.output[..3].copy_from_slice(&[tick.food, tick.population, tick.births as f64]);
        for row in 0..self.city_count {
            let city = self.world.get::<City>(self.city_entities[row]).expect("city result");
            let offset = 3 + row * CITY_OUTPUT_STRIDE;
            self.output[offset..offset + CITY_OUTPUT_STRIDE].copy_from_slice(&[city.credit, city.unhoused, city.depopulated as f64]);
        }
        let offset = 3 + self.city_count * CITY_OUTPUT_STRIDE;
        for row in 0..self.home_count {
            self.output[offset + row] = self.world.get::<Home>(self.home_entities[row]).expect("home result").residents;
        }
        self.output.as_ptr()
    }
}

/// One engine per game (owned by the simulation core's engine table).
#[derive(Default)]
pub struct Engines { next_handle: u32, engines: std::collections::BTreeMap<u32, PopulationEngine> }
impl Engines {
    pub fn create(&mut self) -> u32 {
        self.next_handle = self.next_handle.checked_add(1).expect("population handle overflow");
        self.engines.insert(self.next_handle, PopulationEngine::default());
        self.next_handle
    }
    pub fn drop_engine(&mut self, handle: u32) { self.engines.remove(&handle); }
    pub fn get_mut(&mut self, handle: u32) -> &mut PopulationEngine { self.engines.get_mut(&handle).expect("unknown population engine") }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CITY: [f64; CITY_STRIDE] = [1.0, 10.0, 20.0, 0.0, 24.0, 0.0, 0.0, 0.0, 0.0, f64::INFINITY];
    const HOME: [f64; HOUSE_STRIDE] = [10.0, 9.0, 20.0, 0.0, 20.0, 1.0];
    fn import(engine: &mut PopulationEngine, cities: &[[f64; CITY_STRIDE]], homes: &[[f64; HOUSE_STRIDE]]) {
        engine.configure(cities.len(), homes.len());
        for (row, city) in cities.iter().enumerate() { engine.input[row * CITY_STRIDE..(row + 1) * CITY_STRIDE].copy_from_slice(city); }
        for (row, home) in homes.iter().enumerate() {
            let start = cities.len() * CITY_STRIDE + row * HOUSE_STRIDE;
            engine.input[start..start + HOUSE_STRIDE].copy_from_slice(home);
        }
    }
    fn close(a: f64, b: f64) { assert!((a - b).abs() < 1e-9, "{a} differs from {b}"); }
    fn rate(surplus: f64) -> f64 { GROWTH_SPEED * (0.14 + surplus / 13.0).min(2.4) }

    #[test]
    fn independent_city_clocks_fill_local_homes_and_spend_shared_food() {
        let mut engine = PopulationEngine::default();
        let mut second = CITY; second[0] = 2.0; second[1] = 50.0;
        let mut second_home = HOME; second_home[0] = 11.0; second_home[1] = 49.0;
        import(&mut engine, &[CITY, second], &[HOME, second_home]);
        engine.run(1000.0, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[960.0, 10.0, 10.0]);
        close(engine.output[3], rate(24.0) - 5.0); close(engine.output[6], rate(24.0) - 5.0);
        assert_eq!(&engine.output[9..], &[5.0, 5.0]);
    }

    #[test]
    fn credits_all_cities_before_ordered_births_exhaust_shared_food() {
        let mut engine = PopulationEngine::default();
        let mut first = CITY; first[5] = 10.0;
        let mut second = first; second[0] = 2.0; second[1] = 50.0;
        let mut second_home = HOME; second_home[1] = 49.0;
        import(&mut engine, &[second, first], &[HOME, second_home]);
        engine.run(6.0, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[2.0, 1.0, 1.0]);
        close(engine.output[3], 10.0 + rate(24.0) - 1.0); close(engine.output[6], 10.0 + rate(24.0));
        assert_eq!(&engine.output[9..], &[0.0, 1.0]);
    }

    #[test]
    fn equidistant_house_chooses_lower_city_id_despite_input_order() {
        let mut engine = PopulationEngine::default();
        let mut first = CITY; first[1] = 49.0; first[0] = 2.0;
        let mut home = HOME; home[1] = 30.0;
        import(&mut engine, &[first, CITY], &[home]);
        engine.run(100.0, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[80.0, 5.0, 5.0]);
        close(engine.output[3], rate(24.0)); close(engine.output[6], rate(24.0) - 5.0);
    }

    #[test]
    fn city_ties_preserve_negative_and_full_safe_integer_ids() {
        let mut engine = PopulationEngine::default();
        let mut first = CITY; first[1] = 49.0; first[0] = 9_007_199_254_740_991.0;
        let mut second = CITY; second[0] = -1.0;
        let mut home = HOME; home[1] = 30.0;
        import(&mut engine, &[first, second], &[home]); engine.run(100.0, 0.0, 1.0, 0.0);
        close(engine.output[3], rate(24.0)); close(engine.output[6], rate(24.0) - 5.0);
        assert_eq!(engine.output[2], 5.0);
    }

    #[test]
    fn preserves_depopulation_and_clears_it_only_after_resettlement() {
        let mut engine = PopulationEngine::default();
        let mut city = CITY; city[5] = 100.0; city[6] = 4.0; city[8] = 2.0;
        import(&mut engine, &[city], &[]); engine.run(100.0, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output, &[100.0, 0.0, 0.0, 0.0, 0.0, 2.0]);
        city[3] = 1.0; city[7] = 1.0;
        import(&mut engine, &[city], &[]); engine.run(100.0, 1.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[88.0, 4.0, 3.0]);
        assert_eq!(&engine.output[4..], &[4.0, 0.0]);
    }

    #[test]
    fn enclosure_costs_and_house_input_order_remain_local() {
        let mut engine = PopulationEngine::default();
        let mut enclosed = HOME; enclosed[4] = 20.0; enclosed[5] = 1.0 / 1.3;
        let mut outside = HOME; outside[1] = 49.0;
        let mut second = CITY; second[0] = 2.0; second[1] = 50.0;
        import(&mut engine, &[CITY, second], &[enclosed, outside]);
        engine.run(1000.0, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[952.0, 12.0, 12.0]);
        assert_eq!(&engine.output[9..], &[7.0, 5.0]);
        close(engine.output[3], rate(24.0) - 7.0 / 1.3);
    }

    #[test]
    fn caps_banked_births_per_city_and_keeps_all_unspent_credit() {
        let mut engine = PopulationEngine::default();
        let mut city = CITY; city[5] = 100.0;
        import(&mut engine, &[city], &[HOME]); engine.run(1000.0, 0.0, 1.1, 0.0);
        assert_eq!(&engine.output[..3], &[960.0, 10.0, 10.0]);
        close(engine.output[3], 100.0 + rate(24.0) * 1.1 - 10.0);
        import(&mut engine, &[city], &[]); engine.run(1000.0, 0.0, 1.0, 0.0);
        assert_eq!(engine.output[2], 0.0); close(engine.output[3], 100.0 + rate(24.0));
    }

    #[test]
    fn civic_cap_limits_growth_and_preserves_existing_residents() {
        let mut engine = PopulationEngine::default();
        let mut city = CITY;
        city[3] = 79.0;
        city[5] = 100.0;
        city[9] = 80.0;
        let mut home = HOME;
        home[5] = 1.0 / 1.3;
        import(&mut engine, &[city], &[home]);
        engine.run(100.0, 79.0, 1.0, 0.0);
        assert_eq!(&engine.output, &[96.0, 80.0, 1.0, 0.0, 0.0, 0.0, 1.0]);

        city[3] = 81.0;
        home[3] = 1.0;
        import(&mut engine, &[city], &[home]);
        engine.run(100.0, 81.0, 1.0, 0.0);
        assert_eq!(&engine.output, &[100.0, 81.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn shortage_decay_and_food_epsilon_match_the_economy_rules() {
        let mut engine = PopulationEngine::default();
        let mut city = CITY; city[5] = 0.2;
        import(&mut engine, &[city], &[HOME]); engine.run(0.0, 0.0, 1.0, 3.0);
        assert_eq!(engine.output[3], 0.0);
        city[5] = 100.0;
        import(&mut engine, &[city], &[HOME]); engine.run(8.0 - 5e-8, 0.0, 1.0, 0.0);
        assert_eq!(&engine.output[..3], &[0.0, 2.0, 2.0]);
    }

    #[test]
    fn reuses_ecs_entities_and_excludes_rows_from_an_earlier_larger_batch() {
        let mut engine = PopulationEngine::default();
        import(&mut engine, &[CITY, CITY], &[HOME, HOME, HOME]);
        engine.run(1000.0, 0.0, 1.0, 0.0);
        let entities = engine.world.entities().len();
        for _ in 0..5 {
            import(&mut engine, &[CITY], &[]); engine.run(100.0, 0.0, 1.0, 0.0);
            assert_eq!(engine.output[2], 0.0);
            assert_eq!(engine.world.entities().len(), entities);
        }
    }
}
