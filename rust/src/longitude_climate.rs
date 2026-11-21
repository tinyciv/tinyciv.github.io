//! Broad, overlapping climate preferences for procedural land.
use bevy_ecs::prelude::*;

#[derive(Resource, Default)]
struct Columns(Vec<[f64; 3]>);

fn generate(mut columns: ResMut<Columns>) {
    let width = columns.0.len() as f64;
    for (x, column) in columns.0.iter_mut().enumerate() {
        let longitude = (x as f64 + 0.5) / width;
        let westward = 1.0 - 2.0 * longitude;
        let tundra_edge = westward * 0.035;
        // Dry ground becomes more likely east of center, with the driest
        // preference farther east than the plains transition.
        let eastward = (-westward).max(0.0);
        let terrain_moisture = westward * 0.09 - eastward.powi(2) * 0.075;
        let forest_belt = (1.0 - ((longitude - 0.28) / 0.40).powi(2)).max(0.0);
        let woodland = forest_belt * 0.11 - 0.025;
        *column = [tundra_edge, terrain_moisture, woodland];
    }
}

pub struct LongitudeClimate {
    world: World,
    schedule: Schedule,
}

impl Default for LongitudeClimate {
    fn default() -> Self {
        let mut world = World::new();
        world.init_resource::<Columns>();
        let mut schedule = Schedule::default();
        schedule.add_systems(generate);
        Self { world, schedule }
    }
}

impl LongitudeClimate {
    pub fn generate(&mut self, width: usize) -> *const f64 {
        self.world
            .resource_mut::<Columns>()
            .0
            .resize(width, [0.0; 3]);
        self.schedule.run(&mut self.world);
        self.world.resource::<Columns>().0.as_ptr().cast()
    }
}
