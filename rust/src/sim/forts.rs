//! Event-driven fort improvements on the existing building entity.
use bevy_ecs::prelude::*;
use super::entities::EntityTables;

#[derive(Component, Clone, Copy)]
pub struct Fortification { pub level: u32, pub hp: f64, pub maximum: f64 }

pub fn upkeep(brigade_capacity: u32) -> f64 {
    20.0 + f64::from(brigade_capacity)
}

pub fn health_multiplier(level: u32) -> f64 {
    match level { 2 => 3.0, _ => 1.0 }
}
pub fn upgrade_cost(level: u32) -> f64 {
    match level { 1 => 1000.0, _ => 0.0 }
}

/// Flags: realm active, owned fort, leader nearby, completed.
/// Output: error, current level, next level, cost, next multiplier, HP, max HP, gold.
pub fn upgrade(world: &mut World, id: i64, level: u32, gold: f64, hp: f64, maximum: f64, flags: u32, commit: bool) -> [f64; 8] {
    let entity = world.resource::<EntityTables>().buildings.locate(id).map(|v| v.0);
    let next = if level == 1 { 2 } else { 0 };
    let cost = upgrade_cost(level);
    let error = if flags & 1 == 0 { 1 } else if flags & 2 == 0 || entity.is_none() { 2 }
        else if flags & 4 == 0 { 3 } else if flags & 8 == 0 || !hp.is_finite() || !maximum.is_finite() || hp <= 0.0 || maximum <= 0.0 { 4 }
        else if level != 1 { 5 } else if !gold.is_finite() || gold < cost { 6 } else { 0 };
    let mut result = [error as f64, level as f64, next as f64, cost, health_multiplier(if next == 0 { level } else { next }), hp, maximum, gold];
    if let Some(entity) = entity {
        world.entity_mut(entity).insert(Fortification { level, hp, maximum });
        if error == 0 && commit {
            let mut fort = world.get_mut::<Fortification>(entity).unwrap();
            let fraction = (fort.hp / fort.maximum).clamp(0.0, 1.0);
            fort.maximum = fort.maximum / health_multiplier(fort.level) * health_multiplier(next);
            fort.hp = fort.maximum * fraction;
            fort.level = next;
            result[1] = next as f64; result[5] = fort.hp; result[6] = fort.maximum; result[7] = gold - cost;
        }
    }
    result
}
