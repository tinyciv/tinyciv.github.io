/**
 * The three base scenarios. Each is a fixed seed + real game constructors +
 * real simulation, so the result is deterministic and node-buildable.
 */
import type { GameState, Point } from '../../src/game/types';
import { buildScenario, scenarioTools, type ScenarioOptions } from './scenario';

export interface ScenarioView { camera: Point; zoom: number }
export interface ScenarioDefinition {
  id: string;
  title: string;
  options: ScenarioOptions;
  /** Where the camera looks once the state is built. */
  view(state: GameState): ScenarioView;
}

/** 1. River basin with an established (advanced-start) player capital. */
export const RIVER_CITY: ScenarioDefinition = {
  id: 'river-city',
  title: 'River plains and a developed city',
  options: {
    seed: 'Storybook-River-1',
    world: { landformFamily: 'river-basin' },
    game: { advancedStart: 'complete' },
    simulateSeconds: 3,
    revealMap: true,
  },
  view: state => ({ camera: scenarioTools(state).centerOf(scenarioTools(state).playerPalace()), zoom: .8 }),
};

/** 2. Stone-walled capital; one side is still being built by its builders. */
export const WALLED_CITY: ScenarioDefinition = {
  id: 'walled-city',
  title: 'Walled city at work',
  options: {
    seed: 'Storybook-Walls-1',
    game: { advancedStart: 'complete' },
    mutate: (_state, tools) => {
      const center = tools.centerOf(tools.playerPalace()), cx = Math.floor(center.x), cy = Math.floor(center.y);
      const r = tools.ringRadius(center, 12, 18, 1);
      const corners = [{ x: cx - r, y: cy - r }, { x: cx + r, y: cy - r }, { x: cx + r, y: cy + r }, { x: cx - r, y: cy + r }];
      for (let i = 0; i < 4; i++) tools.build('wall', tools.line(corners[i], corners[(i + 1) % 4]));
      // Finish three sides; the southern course stays a live construction site.
      tools.completeConstruction(building => building.kind !== 'wall' || building.y !== cy + r);
    },
    simulateSeconds: 5,
  },
  view: state => {
    // Frame the whole ring: three finished sides and the southern work site.
    return { camera: scenarioTools(state).centerOf(scenarioTools(state).playerPalace()), zoom: .72 };
  },
};

/** 3. Two armies engaged on open ground beside the player's capital. */
export const FIELD_BATTLE: ScenarioDefinition = {
  id: 'field-battle',
  title: 'Battle beside a settlement',
  options: {
    seed: 'Storybook-Battle-1',
    game: { advancedStart: 'complete' },
    mutate: (_state, tools) => {
      const enemy = tools.hostileFaction();
      const field = tools.openField(tools.centerOf(tools.playerPalace()), 6, 3, 8, 24, [0, enemy]);
      const ours = tools.army(0), theirs = tools.army(enemy);
      theirs.push(...tools.reinforce(enemy, Math.max(0, ours.length - theirs.length)));
      tools.formation(ours, { x: field.x - 2.6, y: field.y }, 3);
      tools.formation(theirs, { x: field.x + 2.6, y: field.y }, 3);
    },
    simulateSeconds: 4,
    step: 1 / 30,
  },
  view: state => {
    // Centre on the melee: the mean position of both armies' living soldiers.
    const tools = scenarioTools(state), soldiers = [...tools.army(0, false), ...tools.army(tools.hostileFaction(), false)];
    const x = soldiers.reduce((sum, unit) => sum + unit.x, 0) / soldiers.length;
    const y = soldiers.reduce((sum, unit) => sum + unit.y, 0) / soldiers.length;
    return { camera: { x, y }, zoom: 1.6 };
  },
};

export const SCENARIOS = [RIVER_CITY, WALLED_CITY, FIELD_BATTLE] as const;

export function buildDefinition(definition: ScenarioDefinition): { state: GameState; view: ScenarioView } {
  const state = buildScenario(definition.options);
  return { state, view: definition.view(state) };
}
