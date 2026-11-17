use bevy_ecs::prelude::*;
use super::SimClock;

#[derive(Resource, Default)]
pub struct Cheats { last_gold_tick: Option<f64> }

/// Called by the native 30-second economy scheduler. Cheat gold goes straight
/// into the treasury, without difficulty scaling or a research allocation.
pub fn gold_tick(world: &mut World, enabled: bool, multiplayer: bool, gold: f64) -> [f64; 2] {
    let tick = world.resource::<SimClock>().tick;
    let mut cheats = world.resource_mut::<Cheats>();
    let amount = if enabled && !multiplayer && cheats.last_gold_tick != Some(tick) { 5000.0 } else { 0.0 };
    cheats.last_gold_tick = Some(tick);
    [gold + amount, amount]
}
