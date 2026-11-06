import { observationUnitsForViewer } from '../src/game/observation-visibility';
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { generateWorld } from '../src/world/generator';
import { createDuelGame, updateGame, updateLeaderRespawns } from '../src/game/simulation';
import { installNavigationWasm } from '../src/game/navigation-wasm';
import { updateFog } from '../src/game/fog';
import { playerControl, withPlayerFaction } from '../src/game/player-context';
import { applyGameCommand } from '../src/multiplayer/commands';
import { NO_INPUT, validatedInput } from '../src/multiplayer/input';
import type { GameState, InputState, Tile } from '../src/game/types';
import type { LobbyPlayer, MatchOptions, ServerMessage } from '../src/multiplayer/protocol';

const port = parentPort!;
const data = workerData as { options: MatchOptions; players: LobbyPlayer[] };
const emptyInput: InputState = { ...NO_INPUT };
let state: GameState;
let sequence = 0, previousRevision = -1, previousTiles: string[] = [];
let playing = true, initialized = false;
let clock: ReturnType<typeof setInterval> | undefined;
const lastInput = [0, 0];
const send = (faction: number, message: ServerMessage) => port.postMessage({ type: 'send', faction, messageType: message.type, payload: JSON.stringify(message) });
const broadcast = (message: ServerMessage) => { for (let faction = 0; faction < 2; faction++) send(faction, message); };

function view(faction: number): GameState {
  return withPlayerFaction(state, faction, () => {
    updateFog(state, faction);
    const control = playerControl(state, faction);
    return { ...state, units: observationUnitsForViewer(state.units, faction), playerFaction: faction, selected: null, selectedType: null, buildMode: null, diplomacy: null,
      victory: state.multiplayer!.winner === faction,
      multiplayer: { ...state.multiplayer!, inputs: {}, controls: { [faction]: { ...control, fog: state.fog } } } };
  });
}
function snapshot(faction: number): void { send(faction, { type: 'snapshot', sequence, state: view(faction) }); }
function frames(): void {
  sequence++;
  let tiles: [number, Tile][] | undefined;
  const worldChanged = (state.world.revision ?? 0) !== previousRevision;
  if (worldChanged) {
    tiles = [];
    state.world.tiles.forEach((tile, index) => {
      const serialized = JSON.stringify(tile);
      if (serialized !== previousTiles[index]) { tiles!.push([index, tile]); previousTiles[index] = serialized; }
    });
    previousRevision = state.world.revision ?? 0;
  }
  for (let faction = 0; faction < 2; faction++) {
    const { world: _world, ...dynamic } = view(faction);
    send(faction, { type: 'frame', sequence, state: dynamic, ...(worldChanged ? { worldRevision: previousRevision } : {}), ...(tiles?.length ? { tiles } : {}) });
  }
}
port.on('message', message => {
  if (!initialized) return;
  if (message.type === 'connection') {
    playing = message.playing;
    state.paused = !playing;
    if (!playing) state.multiplayer!.inputs = { 0: { ...emptyInput }, 1: { ...emptyInput } };
  } else if (message.type === 'input' && (message.faction === 0 || message.faction === 1)) {
    const input = validatedInput(message.input);
    if (!input) return;
    state.multiplayer!.inputs[message.faction] = input;
    lastInput[message.faction] = performance.now();
  } else if (message.type === 'command') {
    const result = playing ? applyGameCommand(state, message.faction, message.command) : { ok: false, message: 'Waiting for the other player to reconnect.' };
    send(message.faction, { type: 'result', seq: message.seq, result });
  } else if (message.type === 'sync') snapshot(message.faction);
  else if (message.type === 'forfeit' && state.multiplayer!.winner === null) {
    state.multiplayer!.winner = 1 - message.faction; state.gameOver = true;
    state.factions[message.faction].defeated = true;
    frames(); clearInterval(clock); port.postMessage({ type: 'finished', winner: 1 - message.faction });
  }
});

async function initialize(): Promise<void> {
  broadcast({ type: 'loading', message: 'Preparing the battlefield...', progress: .15 });
  await installNavigationWasm(await readFile(new URL('./navigation.wasm', import.meta.url)));
  // This size leaves room for two realms while keeping snapshots and pathfinding modest.
  const world = generateWorld(data.options.seed, 128, 104, data.options);
  broadcast({ type: 'loading', message: 'Founding the two realms...', progress: .7 });
  state = createDuelGame(world, data.players.map(player => player.name), data.players.map(player => player.color));
  state.paused = false; state.speed = 1;
  previousTiles = world.tiles.map(tile => JSON.stringify(tile)); previousRevision = world.revision ?? 0;
  initialized = true;
  port.postMessage({ type: 'ready' });
  snapshot(0); snapshot(1);
  let previous = performance.now(), lastFrame = previous;
  let reportedFinish = false;
  clock = setInterval(() => {
    const now = performance.now(), dt = Math.min(.15, (now - previous) / 1000); previous = now;
    for (let faction = 0; faction < 2; faction++) if (now - lastInput[faction] > 750) state.multiplayer!.inputs[faction] = { ...emptyInput };
    if (playing) updateGame(state, dt, emptyInput);
    else updateLeaderRespawns(state);
    if (now - lastFrame >= 125) { lastFrame = now; frames(); }
    if (state.gameOver && !reportedFinish) { reportedFinish = true; frames(); clearInterval(clock); port.postMessage({ type: 'finished', winner: state.multiplayer!.winner }); }
  }, 50);
}
void initialize().catch(error => { port.postMessage({ type: 'failure', message: error instanceof Error ? error.message : 'Unable to prepare the match.' }); });
