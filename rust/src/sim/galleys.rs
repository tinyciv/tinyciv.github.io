//! Native galley tuning shared by navigation, rendering and contact resolution.
//! Leader galleys are 15% smaller and 25% slower than the original transport.

pub const LEADER_SCALE: f64 = 0.85;
pub const LEADER_SPEED: f64 = 4.5 * 0.75;
pub const TRANSPORT_SPEED: f64 = 4.5;
/// A landing tests the destination, not a narrow water-to-bank segment.
pub fn landing(x:f64,y:f64,angle:f64,px:f64,py:f64)->bool {
    let(dx,dy)=(px-x,py-y);let forward=(dx*angle.cos()+dy*angle.sin()).abs();
    let side=(-dx*angle.sin()+dy*angle.cos()).abs();
    (side*side+(forward-0.5*LEADER_SCALE).max(0.0).powi(2)).sqrt()-LEADER_SCALE*0.5<=2.0
}

pub fn constant(index: u32, transport: bool) -> f64 {
    let scale = if transport { 1.0 } else { LEADER_SCALE };
    match index {
        0 => if transport { TRANSPORT_SPEED } else { LEADER_SPEED },
        1 => scale,
        2 => 2.0 * scale,
        3 => scale,
        _ => f64::NAN,
    }
}
