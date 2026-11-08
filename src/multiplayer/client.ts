import type { GameState, InputState, Unit } from '../game/types';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type LobbyRoom, type MatchOptions, type GameCommand, type CommandResult } from './protocol';
import { INPUT_KEYS, NO_INPUT, validatedInput } from './input';
import { ClientStateReplica } from './client-state';
import { recordWorldTileChanges, worldRevisions } from '../game/world-revisions';

interface ClientEvents {
  onRooms(rooms: LobbyRoom[]): void;
  onRoom(room: LobbyRoom | null, faction: number | null): void;
  onState(state: GameState, initial: boolean): void;
  onStatus(message: string): void;
  onError(message: string): void;
  onResult?(result: CommandResult): void;
  onLoading?(message: string, progress: number): void;
}
const TOKEN_KEY = 'tinyciv-multiplayer-session';

export function multiplayerEndpoint(): string {
  const configured = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined;
  // Development tests can use a local server without shipping a URL override in production.
  const local = import.meta.env.DEV && ['localhost', '127.0.0.1'].includes(location.hostname)
    ? new URLSearchParams(location.search).get('multiplayer') : null;
  return local || configured || (import.meta.env.PROD ? location.origin : '');
}

export class MultiplayerClient {
  connected = false;
  playerId = '';
  room: LobbyRoom | null = null;
  faction: number | null = null;
  ping = 0;
  private socket?: WebSocket;
  private token = '';
  private state?: GameState;
  private replica?: ClientStateReplica;
  private sequence = -1;
  private commandSequence = 0;
  private expectedClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pendingConnect?: Promise<void>;
  private cancelConnect?: () => void;
  private lastInput: InputState = { ...NO_INPUT };
  private pingSent = 0;
  private previousFrameAt = 0;
  private presentation = new Map<number, { unit: Unit; x: number; y: number; toX: number; toY: number; at: number; duration: number }>();
  private authoritative = new Map<number, { x: number; y: number; inside: Unit['inside'] }>();

  constructor(private readonly events: ClientEvents, private readonly origin = multiplayerEndpoint()) {
    try { this.token = sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { /* Private browsing still supports a live session. */ }
  }
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.pendingConnect) return this.pendingConnect;
    if (!this.origin) return Promise.reject(new Error('The multiplayer server has not been configured.'));
    let url: URL;
    try { url = new URL(this.origin); } catch { return Promise.reject(new Error('Invalid multiplayer server address.')); }
    if (!['https:', 'wss:'].includes(url.protocol) && !(['http:', 'ws:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      return Promise.reject(new Error('Multiplayer requires a secure connection.'));
    url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
    url.pathname = '/api/ws'; url.search = ''; url.hash = '';
    this.expectedClose = false;
    this.events.onStatus(this.reconnectAttempt ? 'Reconnecting...' : 'Connecting...');
    const promise = new Promise<void>((resolve, reject) => {
      const socket = this.socket = new WebSocket(url);
      let welcomed = false;
      const timer = setTimeout(() => { reject(new Error('Connection timed out.')); socket.close(); }, 12000);
      this.cancelConnect = () => { clearTimeout(timer); reject(new Error('Connection cancelled.')); };
      socket.onopen = () => { if (this.socket === socket) this.send({ type: 'hello', version: PROTOCOL_VERSION, ...(this.token ? { token: this.token } : {}) }); };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        let message: ServerMessage;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'welcome') {
          if (message.version !== PROTOCOL_VERSION) { reject(new Error('Reload the game to update multiplayer.')); socket.close(); return; }
          welcomed = true; clearTimeout(timer); this.connected = true; this.token = message.token; this.playerId = message.playerId;
          this.commandSequence = message.commandSequence;
          this.reconnectAttempt = 0;
          try { sessionStorage.setItem(TOKEN_KEY, this.token); } catch { /* Session stays available in memory. */ }
          this.events.onStatus(''); this.startHeartbeat(); resolve(); return;
        }
        if (message.type === 'error' && !welcomed) { clearTimeout(timer); reject(new Error(message.message)); socket.close(); return; }
        this.receive(message);
      };
      socket.onerror = () => { if (this.socket === socket && !welcomed) { clearTimeout(timer); reject(new Error('Unable to reach the multiplayer server.')); } };
      socket.onclose = () => {
        clearTimeout(timer); if (this.socket !== socket) return;
        this.connected = false; clearInterval(this.heartbeat); this.lastInput = { ...NO_INPUT };
        if (!welcomed) reject(new Error('Connection closed.'));
        if (this.expectedClose) return;
        if (this.room && this.reconnectAttempt < 8) {
          this.events.onStatus('Connection lost. Reconnecting...');
          const delay = Math.min(4000, 500 * 2 ** this.reconnectAttempt++);
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => { void this.connect().catch(() => {}); }, delay);
        } else {
          this.events.onStatus('Disconnected.');
          this.events.onError('Connection lost. Return to the lobby and try again.');
        }
      };
    });
    this.pendingConnect = promise.finally(() => { this.pendingConnect = undefined; this.cancelConnect = undefined; });
    return this.pendingConnect;
  }
  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'rooms': this.events.onRooms(message.rooms); break;
      case 'room': {
        const changedMatch = message.room?.id !== this.room?.id
          || message.room?.phase === 'loading' && this.room?.phase !== 'loading'
          || message.room?.phase === 'waiting' && this.room?.phase !== 'waiting';
        if (changedMatch) this.clearState();
        this.room = message.room; this.faction = message.faction;
        if (!message.room) { this.clearState(); this.commandSequence = 0; }
        this.events.onRoom(message.room, message.faction); break;
      }
      case 'loading':
        if (this.events.onLoading) this.events.onLoading(message.message, message.progress);
        else this.events.onStatus(message.message);
        break;
      case 'snapshot': {
        const initial = !this.state;
        // A resync keeps the renderer's world identity and the player's open UI.
        if (this.state && this.state.seed === message.state.seed) {
          Object.assign(this.state.world, message.state.world);
          message.state.world = this.state.world;
        }
        this.state = message.state; this.replica = new ClientStateReplica(this.state); this.sequence = message.sequence;
        this.presentation.clear(); this.authoritative.clear(); this.previousFrameAt = performance.now();
        for (const unit of this.state.units ?? []) this.authoritative.set(unit.id, { x: unit.x, y: unit.y, inside: unit.inside });
        this.events.onStatus(''); this.events.onState(this.state, initial); break;
      }
      case 'frame': {
        if (!this.state || message.sequence <= this.sequence) break;
        if (message.sequence !== this.sequence + 1) { this.send({ type: 'sync' }); break; }
        worldRevisions(this.state.world);
        if (message.tiles) for (const [index, tile] of message.tiles) this.state.world.tiles[index] = tile;
        if (message.worldRevision !== undefined) this.state.world.revision = message.worldRevision;
        if (message.tiles?.length) recordWorldTileChanges(this.state.world, message.tiles.map(([index]) => index));
        const now = performance.now(), duration = Math.max(60, Math.min(160, now - this.previousFrameAt));
        this.previousFrameAt = now;
        let displayX = 0, displayY = 0;
        this.replica!.apply(message.delta, {
          before: unit => {
            displayX = unit.x; displayY = unit.y;
            // A sparse patch may omit x/y. Apply it against the previous
            // authoritative target, never an unfinished interpolation sample.
            const previous = this.authoritative.get(unit.id)!;
            unit.x = previous.x; unit.y = previous.y;
          },
          after: (unit, added) => {
            const previous = this.authoritative.get(unit.id), x = unit.x, y = unit.y;
            this.authoritative.set(unit.id, { x, y, inside: unit.inside });
            if (added || !previous || previous.inside !== unit.inside || Math.hypot(displayX - x, displayY - y) > 3) {
              this.presentation.delete(unit.id); return;
            }
            if (previous.x !== x || previous.y !== y) this.presentation.set(unit.id,
              { unit, x: displayX, y: displayY, toX: x, toY: y, at: now, duration });
            unit.x = displayX; unit.y = displayY;
          },
          removed: id => { this.authoritative.delete(id); this.presentation.delete(id); },
        });
        this.sequence = message.sequence; this.events.onState(this.state, false); break;
      }
      case 'status': this.events.onStatus(message.message); break;
      case 'result': this.events.onResult?.(message.result); break;
      case 'error':
        if (message.fatal) this.disconnect();
        this.events.onError(message.message); break;
      case 'pong': this.ping = Math.max(0, Math.round(performance.now() - message.nonce)); break;
    }
  }
  private startHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (this.room?.phase === 'playing') this.send({ type: 'input', input: this.lastInput });
      if (performance.now() - this.pingSent > 3000) { this.pingSent = performance.now(); this.send({ type: 'ping', nonce: this.pingSent }); }
    }, 200);
  }
  private send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  list(): void { this.send({ type: 'list' }); }
  create(name: string, playerName: string, color: string, options: MatchOptions): void { this.send({ type: 'create', name, playerName, color, options }); }
  join(roomId: string, name: string, color: string): void { this.send({ type: 'join', roomId, name, color }); }
  profile(name: string, color: string): void { this.send({ type: 'profile', name, color }); }
  ready(ready: boolean): void { this.send({ type: 'ready', ready }); }
  start(): void { this.send({ type: 'start' }); }
  leave(): void { this.lastInput = { ...NO_INPUT }; this.send({ type: 'leave' }); }
  command(command: GameCommand): boolean {
    if (!this.connected || this.room?.phase !== 'playing') return false;
    return this.send({ type: 'command', seq: ++this.commandSequence, command });
  }
  input(input: InputState): void {
    const next = validatedInput(input);
    if (!next || INPUT_KEYS.every(key => next[key] === this.lastInput[key])) return;
    this.lastInput = next; if (this.room?.phase === 'playing') this.send({ type: 'input', input: this.lastInput });
  }
  updatePresentation(now: number): void {
    for (const [id, sample] of this.presentation) {
      const amount = Math.max(0, Math.min(1, (now - sample.at) / sample.duration));
      sample.unit.x = sample.x + (sample.toX - sample.x) * amount;
      sample.unit.y = sample.y + (sample.toY - sample.y) * amount;
      if (amount === 1) this.presentation.delete(id);
    }
  }
  /** Explicitly leave a disconnected match instead of resuming its reservation. */
  abandon(): void {
    this.disconnect(); this.token = '';
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* In-memory identity is already cleared. */ }
  }
  private clearState(): void {
    this.state = undefined; this.replica = undefined; this.sequence = -1;
    this.presentation.clear(); this.authoritative.clear();
  }
  disconnect(): void {
    this.expectedClose = true; clearTimeout(this.reconnectTimer); clearInterval(this.heartbeat);
    this.cancelConnect?.();
    this.socket?.close(); this.socket = undefined; this.connected = false;
    this.clearState(); this.room = null; this.faction = null; this.lastInput = { ...NO_INPUT };
    this.commandSequence = 0;
  }
}
