/**
 * Scenario harness: builds a real, in-memory GameState with the game's own
 * world generator and constructors, then advances the real simulation.
 *
 * This module is DOM-free, so the same scenario can be built in Node
 * (vite-node / vitest) for determinism checks and in Storybook for rendering.
 * Nothing here draws or fakes game state; the helpers only call the same
 * entry points the game, its tests and its check scripts use.
 */
import { generateWorld } from '../../src/world/generator';
import type { WorldGenerationOptions } from '../../src/world/options';
import { createDuelGame, createGame, getLeader, updateGame } from '../../src/game/simulation';
import { buildStroke } from '../../src/game/construction';
import { entityStore } from '../../src/game/entity-store';
import { forgetNativeConstruction } from '../../src/game/construction-native';
import { canWalk, invalidateNavigation } from '../../src/game/pathfinding';
import { markWorldChanged } from '../../src/game/world-revisions';
import { updateWallStats } from '../../src/game/wall-stats';
import { setSoldierRole, type RetinueRole } from '../../src/game/archery';
import { setMapRevealed } from '../../src/game/fog';
import { playerFaction } from '../../src/game/player-context';
import { buildingHeight, buildingWidth, isSoldier, type Building, type BuildSelection, type GameState, type InputState, type Point, type Unit } from '../../src/game/types';

export const IDLE_INPUT: InputState = Object.freeze({ up: false, down: false, left: false, right: false });

export interface ScenarioWorldOptions extends WorldGenerationOptions {
  /** Tiles; defaults to the game's default world size. */
  width?: number;
  height?: number;
}

export interface ScenarioGameOptions {
  advancedStart?: import('../../src/game/advanced-start').AdvancedStartPhase;
  banditIntensity?: number;
  enemyStrength?: number;
  /** Two human capitals via createDuelGame (multiplayer-shaped state). */
  duel?: boolean;
}

export interface ScenarioOptions {
  /** World seed. Every scenario is deterministic for a fixed seed + options. */
  seed: string;
  world?: ScenarioWorldOptions;
  game?: ScenarioGameOptions;
  /** Edit the fresh state with the real game APIs before simulation. */
  mutate?: (state: GameState, tools: ScenarioTools) => void;
  /** Real simulated seconds to advance after `mutate` (default 0). */
  simulateSeconds?: number;
  /** Simulation step in seconds (default 0.1, the game's largest safe step). */
  step?: number;
  /** In-game development "Reveal map" view (fog hidden for the player). */
  revealMap?: boolean;
}

/** Build a GameState from a seed using generateWorld + createGame. */
export function buildScenario(options: ScenarioOptions): GameState {
  const world = generateWorld(options.seed, options.world?.width, options.world?.height, options.world);
  const game = options.game ?? {};
  const state = game.duel ? createDuelGame(world)
    : createGame(world, undefined, { advancedStart: game.advancedStart, banditIntensity: game.banditIntensity, enemyStrength: game.enemyStrength });
  options.mutate?.(state, scenarioTools(state));
  if (options.simulateSeconds) simulate(state, options.simulateSeconds, options.step);
  if (options.revealMap) setMapRevealed(state, true);
  return state;
}

/** Advance the real simulation in fixed steps (non-interactive, deterministic). */
export function simulate(state: GameState, seconds: number, step = .1): void {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) updateGame(state, step, IDLE_INPUT);
}

export interface ScenarioTools {
  readonly state: GameState;
  /** The player's first (initial) city. */
  playerPalace(faction?: number): Building;
  /** Centre of a building footprint, in world tiles. */
  centerOf(building: Building): Point;
  leader(faction?: number): Unit;
  /** Living soldiers (and optionally the leader) of a faction. */
  army(faction: number, includeLeader?: boolean): Unit[];
  /** The first rival faction at war with the player. */
  hostileFaction(): number;
  /**
   * Place construction through the real player build path (buildStroke).
   * Long strokes are split so the Leader's 10-tile build range is honored;
   * the Leader is moved along and returned. Gold is topped up first.
   */
  build(kind: BuildSelection, points: Point[], faction?: number): { placed: number; skipped: number };
  /** Straight cardinal/diagonal line of cells from `a` to `b`, inclusive. */
  line(a: Point, b: Point): Point[];
  /** Finish queued construction sites instantly (all, or those matching `filter`). */
  completeConstruction(filter?: (building: Building) => boolean): number;
  /** Smallest centered square ring of cells with at most `maxBlocked` occupied cells. */
  ringRadius(center: Point, min: number, max: number, maxBlocked?: number): number;
  /** Centre of an open rectangle (walkable for every faction given) near `around`. */
  openField(around: Point, halfWidth: number, halfHeight: number, minRadius?: number, maxRadius?: number, factions?: number[]): Point;
  /** Copy a faction's soldier `count` times (real entity IDs) with the given roles. */
  reinforce(faction: number, count: number, roles?: readonly RetinueRole[]): Unit[];
  /** Arrange units in a block of `columns` columns centred on `center`. */
  formation(units: readonly Unit[], center: Point, columns?: number, spacing?: number): void;
}

const ROLE_MIX: readonly RetinueRole[] = ['warrior', 'spearman', 'archer', 'swordsman', 'horseman', 'spearman', 'archer', 'warrior'];

export function scenarioTools(state: GameState): ScenarioTools {
  const store = () => entityStore(state);
  const tools: ScenarioTools = {
    state,
    playerPalace(faction = playerFaction(state)) {
      const palaces = state.buildings.filter(b => b.kind === 'palace' && b.faction === faction && b.hp > 0);
      const palace = palaces.find(b => b.initialCity) ?? palaces[0];
      if (!palace) throw new Error(`Faction ${faction} has no city.`);
      return palace;
    },
    centerOf(building) {
      return { x: building.x + buildingWidth(building) / 2, y: building.y + buildingHeight(building) / 2 };
    },
    leader(faction = playerFaction(state)) {
      const leader = getLeader(state, faction);
      if (!leader) throw new Error(`Faction ${faction} has no leader.`);
      return leader;
    },
    army(faction, includeLeader = true) {
      return state.units.filter(unit => unit.faction === faction && unit.hp > 0 && !unit.inside
        && (isSoldier(unit) || includeLeader && unit.kind === 'leader'));
    },
    hostileFaction() {
      const player = playerFaction(state);
      const enemy = state.factions.find(faction => faction.id !== player && !faction.defeated
        && (state.multiplayer ? true : faction.relation === 'war'));
      if (!enemy) throw new Error('No hostile faction in this scenario.');
      return enemy.id;
    },
    build(kind, points, faction = playerFaction(state)) {
      const leader = tools.leader(faction), home = { x: leader.x, y: leader.y };
      const owner = state.factions.find(candidate => candidate.id === faction)!;
      owner.gold = Math.max(owner.gold, 1e6);
      let placed = 0, skipped = 0;
      try {
        for (let i = 0; i < points.length; i += 12) {
          const chunk = points.slice(i, i + 12), middle = chunk[chunk.length >> 1];
          leader.x = middle.x + .5; leader.y = middle.y + .5;
          const result = buildStroke(state, kind, chunk);
          placed += result.placed; skipped += result.skipped;
        }
      } finally { leader.x = home.x; leader.y = home.y; }
      return { placed, skipped };
    },
    line(a, b) {
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)), points: Point[] = [];
      for (let i = 0; i <= n; i++) points.push({ x: a.x + Math.sign(b.x - a.x) * Math.min(i, Math.abs(b.x - a.x)),
        y: a.y + Math.sign(b.y - a.y) * Math.min(i, Math.abs(b.y - a.y)) });
      return points;
    },
    completeConstruction(filter = () => true) {
      // Mirrors the completion branch of updateConstruction (structures.ts).
      let done = 0;
      for (const building of state.buildings) {
        if (!building.construction || !filter(building)) continue;
        delete building.construction;
        forgetNativeConstruction(state, building.id);
        store().buildings.updateRoles(building);
        done++;
      }
      if (done) { invalidateNavigation(state); markWorldChanged(state.world); updateWallStats(state, true); }
      return done;
    },
    ringRadius(center, min, max, maxBlocked = 0) {
      const occupied = new Set<number>(), width = state.world.width;
      for (const b of state.buildings) if (b.hp > 0 && b.kind !== 'road' && b.kind !== 'camp') {
        for (let y = b.y; y < b.y + buildingHeight(b); y++) for (let x = b.x; x < b.x + buildingWidth(b); x++) occupied.add(y * width + x);
      }
      const cx = Math.floor(center.x), cy = Math.floor(center.y);
      for (let r = min; r <= max; r++) {
        let blocked = 0;
        for (let i = -r; i <= r; i++) for (const [x, y] of [[cx + i, cy - r], [cx + i, cy + r], [cx - r, cy + i], [cx + r, cy + i]])
          if (occupied.has(y * width + x)) blocked++;
        if (blocked <= maxBlocked) return r;
      }
      return max;
    },
    openField(around, halfWidth, halfHeight, minRadius = 6, maxRadius = 24, factions = [playerFaction(state)]) {
      for (let r = minRadius; r <= maxRadius; r++) for (let a = 0; a < 48; a++) {
        const cx = Math.round(around.x + Math.cos(a / 48 * Math.PI * 2) * r), cy = Math.round(around.y + Math.sin(a / 48 * Math.PI * 2) * r);
        let ok = true;
        for (let dy = -halfHeight; dy <= halfHeight && ok; dy++) for (let dx = -halfWidth; dx <= halfWidth && ok; dx++)
          ok = factions.every(faction => canWalk(state, cx + dx + .5, cy + dy + .5, faction))
            && !state.units.some(unit => unit.hp > 0 && !unit.inside && Math.floor(unit.x) === cx + dx && Math.floor(unit.y) === cy + dy && !isSoldier(unit) && unit.kind !== 'leader');
        if (ok) return { x: cx + .5, y: cy + .5 };
      }
      throw new Error('No open field near the requested point.');
    },
    reinforce(faction, count, roles = ROLE_MIX) {
      const template = tools.army(faction, false)[0];
      if (!template) throw new Error(`Faction ${faction} has no soldier to reinforce from.`);
      const added: Unit[] = [];
      for (let i = 0; i < count; i++) {
        const unit = structuredClone(template);
        unit.id = store().allocateId();
        delete unit.path; delete unit.destination; delete unit.target; delete unit.forcedAttack;
        setSoldierRole(unit, roles[i % roles.length]);
        store().units.add(unit);
        added.push(unit);
      }
      return added;
    },
    formation(units, center, columns = 4, spacing = .9) {
      const rows = Math.ceil(units.length / columns);
      units.forEach((unit, index) => {
        unit.x = center.x + (index % columns - (columns - 1) / 2) * spacing;
        unit.y = center.y + (Math.floor(index / columns) - (rows - 1) / 2) * spacing;
        delete unit.path; delete unit.destination; delete unit.target;
        unit.moving = false;
      });
    },
  };
  return tools;
}
