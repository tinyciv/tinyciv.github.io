import type { InputState } from '../game/types';

export const INPUT_KEYS = ['up', 'down', 'left', 'right', 'turnLeft', 'turnRight'] as const;
export const NO_INPUT: Required<InputState> = { up: false, down: false, left: false, right: false, turnLeft: false, turnRight: false };

/** Accept only boolean controls; ownership always comes from the socket session. */
export function validatedInput(value: unknown): Required<InputState> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (['up', 'down', 'left', 'right'].some(key => typeof input[key] !== 'boolean')) return;
  if (['turnLeft', 'turnRight'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) return;
  return Object.fromEntries(INPUT_KEYS.map(key => [key, input[key] === true])) as Required<InputState>;
}
