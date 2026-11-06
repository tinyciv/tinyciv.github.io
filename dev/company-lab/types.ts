export interface Point { x: number; y: number }
export type Team = 0 | 1;
export type SoldierKind = 'infantry' | 'archer';
export type CompanyOrder = 'move' | 'attack' | 'defend' | 'escort' | 'regroup' | 'retreat';
export type ScenarioId = 'plain' | 'river' | 'forest' | 'town' | 'urban' | 'hills';
export type BattleSize = 'small' | 'medium' | 'large' | 'stress';
/** Ground, road, tree, water, wall, house, bridge, plateau, stairs. */
export type TileKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface LabWorld {
  width: number; height: number; tiles: Uint8Array; elevations: Int8Array;
  bases: [Point, Point]; stairDir?: Int8Array; revision?: number;
  scenario?: ScenarioId; name?: string; homes?: Point[];
}
export interface Soldier extends Point {
  id: number; company: number; team: Team; kind: SoldierKind;
  hp: number; maxHp: number; speed: number; moving: boolean;
  facing: number; cooldown: number; attackUntil: number; damageFlash: number;
  targetId?: number; deadAt?: number; traveled: number; lastProgressAt: number;
  fromX: number; fromY: number; toX: number; toY: number; progress: number; duration: number;
  slot: Point; waitSince?: number; previousCell?: number;
}
export interface Company extends Point {
  id: number; team: Team; kind: SoldierKind; order: CompanyOrder; status: string;
  soldierIds: number[]; goal: Point; rally: Point; selected: boolean;
  veterancy: number; kills: number; experience: number;
  mode: 'line' | 'column' | 'combat';
  engagementGoal?: Point; targetCompany?: number; lastTargetScan?: number; lastCombatAt: number;
  lastAssignedAt: number; replenishAt: number;
}
export interface Projectile extends Point { targetX: number; targetY: number; team: Team; bornAt: number; life: number; }
export interface BattleEvent extends Point { text: string; team: Team; bornAt: number; }
export interface CombatMetrics { damageEvents: number; shots: number; kills: number; }
export interface CombatContext {
  canStep?: (ax: number, ay: number, bx: number, by: number) => boolean;
  world: LabWorld; companies: Company[]; soldiers: Soldier[]; time: number; combatEnabled: boolean;
  projectiles: Projectile[]; events: BattleEvent[]; combatMetrics: CombatMetrics;
}
export interface LabOptions { scenario: ScenarioId; size: BattleSize; seed?: number; combat?: boolean; }
export interface LabStats {
  stepMs: number; p95StepMs: number; frameMs: number; pathMs: number; maxPathMs: number;
  searches: number; cacheHits: number; expanded: number; alive: number; moving: number; waiting: number;
  stuckUnits: number; idleDrift: number; cohesionP95: number; maxOverlap: number;
  arrivals: number; routeFailures: number; kills: number; damageEvents: number;
}
