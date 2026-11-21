//! Entity kind codes shared by the host encoders and every native rule. The
//! host only translates enum names to these codes (the declaration order of
//! `UnitKind` and `BuildingKind`); what a kind means is decided here.

#[allow(dead_code)]
pub mod unit {
    pub const SLINGER: u32 = 0;
    pub const SKIRMISHER: u32 = 1;
    pub const LEVY_INFANTRY: u32 = 2;
    pub const SUPPLY_CART: u32 = 3;
    pub const LEADER: u32 = 4;
    pub const WARRIOR: u32 = 5;
    pub const SWORDSMAN: u32 = 6;
    pub const SPEARMAN: u32 = 7;
    pub const PIKEMAN: u32 = 8;
    pub const ARCHER: u32 = 9;
    pub const HORSEMAN: u32 = 10;
    pub const HORSE_ARCHER: u32 = 11;
    pub const KNIGHT: u32 = 12;
    pub const SCOUT: u32 = 13;
    pub const MILITIA: u32 = 14;
    pub const WORKER: u32 = 15;
    pub const MERCHANT: u32 = 16;
    pub const SAILBOAT: u32 = 17;
    pub const BOAR: u32 = 18;
    pub const MARSH_BIRD: u32 = 19;
    pub const DEER: u32 = 20;
    pub const BUFFALO: u32 = 21;
    pub const ELEPHANT: u32 = 22;
    pub const OSTRICH: u32 = 23;
    pub const MUSKETMAN: u32 = 24;
    pub const FIELD_CANNON: u32 = 25;
    pub const COW: u32 = 26;
    pub const SHEEP: u32 = 27;
    pub const HORSE: u32 = 28;

    pub fn livestock(kind: u32) -> bool { matches!(kind, COW | SHEEP | HORSE) }

    /// Combat retinue kinds that follow a Leader.
    pub fn retinue(kind: u32) -> bool { (WARRIOR..=KNIGHT).contains(&kind) || matches!(kind, MUSKETMAN | FIELD_CANNON) }
    pub fn soldier(kind: u32) -> bool { retinue(kind) || kind == FIELD_CANNON || matches!(kind, SLINGER | SKIRMISHER | LEVY_INFANTRY) }
    /// Civilians pass through other units unless they are engineers.
    pub fn civilian(kind: u32, engineer: bool) -> bool { !engineer && matches!(kind, WORKER | SCOUT | MERCHANT | SUPPLY_CART) }
    /// Hit points of a unit that carries no explicit maximum.
    pub fn default_max_hp(kind: u32) -> f64 { if kind == WORKER { 50.0 } else { 100.0 } }
}

#[allow(dead_code)]
pub mod building {
    pub const FORT: u32 = 0;
    pub const SUPPLY_DEPOT: u32 = 1;
    pub const PALACE: u32 = 2;
    pub const CAMP: u32 = 3;
    pub const HOUSE: u32 = 4;
    pub const SHACK: u32 = 5;
    pub const COTTAGE: u32 = 6;
    pub const ROAD: u32 = 7;
    pub const WALL: u32 = 8;
    pub const PALISADE: u32 = 9;
    pub const BRIDGE: u32 = 10;
    pub const DOCK: u32 = 11;
    pub const IRRIGATION: u32 = 12;
    pub const RUIN: u32 = 13;
    pub const TOWER: u32 = 14;
    pub const WOODEN_TOWER: u32 = 15;
    pub const WELL: u32 = 16;
    pub const MONUMENT: u32 = 17;
    pub const BLACKSMITH: u32 = 18;
    pub const GUARD_POST: u32 = 19;
    pub const ARCHERY_RANGE: u32 = 20;
    pub const SCOUT_LODGE: u32 = 21;
    pub const OBSERVATION_POST: u32 = 22;
    pub const HEALER_SHACK: u32 = 23;
    pub const BALLISTA: u32 = 24;
    pub const STABLE: u32 = 25;
    pub const LIBRARY: u32 = 26;
    pub const VILLAGE_TENT: u32 = 27;
    pub const COLOSSEUM: u32 = 28;
    pub const BARRACKS: u32 = 29;
    pub const SIEGE_CANNON: u32 = 30;
    pub const FORUM: u32 = 31;
    pub const GRANARY: u32 = 32;
    pub const THERMAL_BATH: u32 = 33;
    pub const SHIPYARD: u32 = 34;
    pub const WHALING_POST: u32 = 35;
    pub const FOUNDRY: u32 = 36;
    pub const MILITARY_ACADEMY: u32 = 37;

    pub const APARTMENTS: u32 = 39;
    pub const FACTORY: u32 = 40;
    pub const GOLD_MINE: u32 = 41;
    pub const MARKETPLACE: u32 = 42;
    pub const SCOUT_TOWER: u32 = 43;
    pub const FRONTIER_VILLAGE: u32 = 44;
    pub const FOUNTAIN: u32 = 46;
    pub const BARBARIAN_LAIR: u32 = 47;
    pub const SCOUT_TOWER_HP: f64 = 75.0;
    pub const SCOUT_TOWER_SIGHT: f64 = 13.0;

    pub fn width(kind: u32) -> f64 {
        match kind { SHIPYARD | FORT | BARBARIAN_LAIR => 3.0, PALACE | ARCHERY_RANGE | SUPPLY_DEPOT | LIBRARY | COLOSSEUM | BARRACKS | FORUM | GRANARY | THERMAL_BATH | WHALING_POST | FOUNDRY | MILITARY_ACADEMY | APARTMENTS | FACTORY | GOLD_MINE | MARKETPLACE | FRONTIER_VILLAGE => 2.0, _ => 1.0 }
    }
    pub fn height(kind: u32) -> f64 {
        match kind { ARCHERY_RANGE | SUPPLY_DEPOT | BARRACKS => 1.0, _ => width(kind) }
    }
    pub fn farm(kind: u32) -> bool { matches!(kind, CAMP | SHACK | COTTAGE) }
    pub fn route(kind: u32) -> bool { matches!(kind, ROAD | BRIDGE) }
    pub fn wall(kind: u32) -> bool { matches!(kind, WALL | PALISADE) }
    pub fn defensive(kind: u32) -> bool { matches!(kind, FORT | WOODEN_TOWER | TOWER | GUARD_POST) }
}
