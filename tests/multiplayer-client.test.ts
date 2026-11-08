import { afterEach, describe, expect, it, vi } from 'vitest';
import { MultiplayerClient } from '../src/multiplayer/client';
import type { GameState, Unit } from '../src/game/types';
import { PROTOCOL_VERSION, type LobbyRoom, type ServerMessage } from '../src/multiplayer/protocol';
import { StateDeltaEncoder } from '../src/multiplayer/state-delta';
import { entityStore } from '../src/game/entity-store';
import { NO_INPUT } from '../src/multiplayer/input';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  sent: unknown[] = [];
  constructor(_url: string) { Socket.instances.push(this); }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.readyState = 3; queueMicrotask(() => this.onclose?.()); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(message: ServerMessage): void { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const room = (phase: LobbyRoom['phase']): LobbyRoom => ({ id: 'ABC', name: 'Test', phase, location: 'Oregon', hostId: 'one', players: [],
  options: { seed: 'same-seed', style: 'pangaea', landformFamily: 'mixed' } });
const state = (): GameState => ({ seed: 'same-seed', playerFaction: 0, world: { tiles: [], revision: 0 } } as unknown as GameState);
function setup() {
  vi.stubGlobal('WebSocket', Socket); Socket.instances = [];
  const events = { onRooms: vi.fn(), onRoom: vi.fn(), onState: vi.fn(), onStatus: vi.fn(), onError: vi.fn() };
  return { client: new MultiplayerClient(events, 'http://localhost:8787'), events };
}
async function connected() {
  const result = setup(), pending = result.client.connect(), socket = Socket.instances[0];
  socket.open(); socket.receive({ type: 'welcome', version: PROTOCOL_VERSION, playerId: 'one', token: 'session', commandSequence: 14 });
  await pending; return { ...result, socket };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('multiplayer client lifecycle', () => {
  it('transmits held rotation changes, deduplicates repeats, and immediately sends release', async () => {
    const { client, socket } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 1 });
    client.input({ ...NO_INPUT, turnLeft: true });
    expect(socket.sent.at(-1)).toEqual({ type: 'input', input: { ...NO_INPUT, turnLeft: true } });
    const count = socket.sent.length; client.input({ ...NO_INPUT, turnLeft: true }); expect(socket.sent.length).toBe(count);
    client.input({ ...NO_INPUT, turnLeft: true, turnRight: true });
    expect(socket.sent.at(-1)).toEqual({ type: 'input', input: { ...NO_INPUT, turnLeft: true, turnRight: true } });
    client.input({ up: false, down: false, left: false, right: false });
    expect(socket.sent.at(-1)).toEqual({ type: 'input', input: NO_INPUT });
    client.disconnect();
  });
  it('enters a new match once, preserves a resync, and enters a restarted room again', async () => {
    const { client, socket, events } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    socket.receive({ type: 'snapshot', sequence: 1, state: state() });
    const world = events.onState.mock.calls[0][0].world;
    socket.receive({ type: 'snapshot', sequence: 5, state: state() });
    expect(events.onState.mock.calls.map(call => call[1])).toEqual([true, false]);
    expect(events.onState.mock.calls[1][0].world).toBe(world);
    socket.receive({ type: 'room', room: room('waiting'), faction: 0 });
    socket.receive({ type: 'room', room: room('loading'), faction: 0 });
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    socket.receive({ type: 'snapshot', sequence: 0, state: state() });
    expect(events.onState.mock.calls.at(-1)?.[1]).toBe(true);
    client.disconnect();
  });
  it('requests a full sync on a sequence gap and never applies an out-of-order frame', async () => {
    const { client, socket, events } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    socket.receive({ type: 'snapshot', sequence: 2, state: state() });
    socket.receive({ type: 'frame', sequence: 4, delta: {} });
    expect(socket.sent.at(-1)).toEqual({ type: 'sync' });
    socket.receive({ type: 'frame', sequence: 1, delta: {} });
    expect(events.onState).toHaveBeenCalledTimes(1);
    client.disconnect();
  });
  it('resumes the server command sequence after reconnect', async () => {
    const { client, socket } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    expect(client.command({ type: 'recall' })).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ type: 'command', seq: 15, command: { type: 'recall' } });
    client.disconnect();
  });
  it('sends Learn commands without a client-selected faction and retains progression through snapshots, frames and resyncs', async () => {
    const { client, socket, events } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 1 });
    const leader = { id: 2, faction: 1, kind: 'leader', x: 5, y: 6,
      leaderProgression: { level: 2, xp: 25, skillPoints: 1, skills: { power: 0, guard: 0, command: 0 } } } as Unit;
    const initial = { ...state(), playerFaction: 1, units: [leader] };
    const encoder = new StateDeltaEncoder(initial);
    socket.receive({ type: 'snapshot', sequence: 0, state: initial });
    expect(events.onState.mock.calls.at(-1)![0].units[0].leaderProgression).toEqual(leader.leaderProgression);
    expect(client.command({ type: 'learnLeaderSkill', skill: 'power' })).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ type: 'command', seq: 15, command: { type: 'learnLeaderSkill', skill: 'power' } });
    const learned = { ...leader, x: 5.5,
      leaderProgression: { level: 2, xp: 25, skillPoints: 0, skills: { power: 1, guard: 0, command: 0 } } };
    socket.receive({ type: 'frame', sequence: 1, delta: encoder.encode({ ...state(), playerFaction: 1, units: [learned] }) });
    client.updatePresentation(performance.now() + 1000);
    expect(events.onState.mock.calls.at(-1)![0].units[0].leaderProgression).toEqual(learned.leaderProgression);
    socket.receive({ type: 'snapshot', sequence: 5, state: { ...state(), playerFaction: 1, units: [learned] } });
    expect(events.onState.mock.calls.at(-1)![0].units[0].leaderProgression).toEqual(learned.leaderProgression);
    expect(events.onState.mock.calls.map(call => call[1])).toEqual([true, false, false]);
    client.disconnect();
  });
  it('cancels a pending connection and ignores late messages from the old socket', async () => {
    const { client, events } = setup(), pending = client.connect(), socket = Socket.instances[0];
    const rejected = expect(pending).rejects.toThrow('cancelled');
    client.disconnect(); await rejected;
    socket.open(); socket.receive({ type: 'snapshot', sequence: 0, state: state() });
    expect(events.onState).not.toHaveBeenCalled(); expect(socket.sent).toEqual([]);
    const next = client.connect(), newSocket = Socket.instances[1]; newSocket.open();
    newSocket.receive({ type: 'welcome', version: PROTOCOL_VERSION, playerId: 'one', token: 'session', commandSequence: 0 });
    await next; expect(client.connected).toBe(true); client.disconnect();
  });
  it('smooths display positions between samples without changing resources or overshooting', async () => {
    let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { client, socket, events } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    const initial = { ...state(), units: [{ id: 1, x: 2, y: 3 } as Unit] };
    const encoder = new StateDeltaEncoder(initial);
    socket.receive({ type: 'snapshot', sequence: 0, state: initial });
    now = 225;
    socket.receive({ type: 'frame', sequence: 1, delta: encoder.encode({ ...state(), units: [{ id: 1, x: 3, y: 3 } as Unit], time: 5 }) });
    const display = events.onState.mock.calls.at(-1)![0] as GameState;
    expect(display.units[0].x).toBe(2); expect(display.time).toBe(5);
    client.updatePresentation(287.5); expect(display.units[0].x).toBe(2.5);
    client.updatePresentation(1000); expect(display.units[0].x).toBe(3);
    expect(display.time).toBe(5); client.disconnect();
  });
  it('applies sparse movement against authoritative targets and retains interpolation across non-position deltas', async () => {
    let now = 100; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { client, socket, events } = await connected();
    socket.receive({ type: 'room', room: room('playing'), faction: 0 });
    const live = { ...state(), units: [{ id: 1, kind: 'worker', faction: 0, x: 2, y: 3, hp: 100, maxHp: 100 } as Unit] };
    const encoder = new StateDeltaEncoder(live);
    socket.receive({ type: 'snapshot', sequence: 0, state: live });
    const display = events.onState.mock.calls.at(-1)![0] as GameState, unit = display.units[0], store = entityStore(display);
    let sequence = 0;
    const frame = () => socket.receive({ type: 'frame', sequence: ++sequence, delta: encoder.encode(live) });
    now = 225; live.units[0].x = 3; live.units[0].y = 4; frame();
    client.updatePresentation(287.5); expect([unit.x, unit.y]).toEqual([2.5, 3.5]);
    now = 300; live.units[0].hp = 90; frame();
    expect([unit.x, unit.y, unit.hp]).toEqual([2.5, 3.5, 90]);
    client.updatePresentation(350); expect([unit.x, unit.y]).toEqual([3, 4]);
    now = 400; live.units[0].y = 5; frame();
    client.updatePresentation(450); expect([unit.x, unit.y]).toEqual([3, 4.5]);
    now = 450; live.units[0].hp = 80; frame();
    client.updatePresentation(500); expect([unit.x, unit.y]).toEqual([3, 5]);
    expect(events.onState.mock.calls.at(-1)![0]).toBe(display); expect(entityStore(display)).toBe(store);
    expect(store.units.get(1)).toBe(unit);
    now = 600; live.units[0].x = 20; frame(); expect(unit.x).toBe(20);
    client.updatePresentation(1000); expect(unit.x).toBe(20);
    client.disconnect();
  });
  it('clears identity only when explicitly abandoning a match', async () => {
    const { client } = await connected(); client.abandon(); await Promise.resolve();
    const pending = client.connect(), socket = Socket.instances.at(-1)!; socket.open();
    expect(socket.sent[0]).toEqual({ type: 'hello', version: PROTOCOL_VERSION });
    socket.receive({ type: 'welcome', version: PROTOCOL_VERSION, playerId: 'new', token: 'fresh-session', commandSequence: 0 });
    await pending; client.disconnect();
  });
});
