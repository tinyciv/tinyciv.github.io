import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, FACTION_COLORS, type LobbyRoom, type LobbyPlayer, type ServerMessage, type MatchOptions } from '../src/multiplayer/protocol';
import { LANDFORM_KINDS, WORLD_GENERATION_STYLES } from '../src/world/options';
import { validatedInput } from '../src/multiplayer/input';
import { ReplicationFlow } from './replication-flow';

const port = Number(process.env.PORT || 8080);
const maxRooms = Number(process.env.MAX_ROOMS || 4);
const grace = Number(process.env.RECONNECT_GRACE_MS || 60000);
const origins = new Set((process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value => value.trim()));
const originSecret = process.env.ORIGIN_SECRET;
const appDirectory = process.env.APP_DIR ? resolve(process.env.APP_DIR) : undefined;
interface Session { token: string; id: string; socket?: WebSocket; roomId?: string; lastSeen: number; seq: number; syncAt: number; }
interface Room { info: LobbyRoom; worker?: Worker; abandonedAt?: number; finishedAt?: number; }
const sessions = new Map<string, Session>();
const rooms = new Map<string, Room>();
const sockets = new Set<WebSocket>();
const replication = new ReplicationFlow();
const counters = { matchesStarted: 0, commands: 0 };
const safeText = (value: unknown, fallback: string, length = 24): string => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f<>]/g, '').trim().slice(0, length) || fallback : fallback;
const color = (value: unknown): string => FACTION_COLORS.includes(value as typeof FACTION_COLORS[number]) ? value as string : FACTION_COLORS[0];
const getSession = (id: string) => [...sessions.values()].find(session => session.id === id);
const publicRooms = () => [...rooms.values()].map(room => room.info);
function send(socket: WebSocket | undefined, message: ServerMessage): void { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function directory(): void { for (const session of sessions.values()) if (!session.roomId) send(session.socket, { type: 'rooms', rooms: publicRooms() }); }
function roomChanged(room: Room): void {
  for (const player of room.info.players) send(getSession(player.id)?.socket, { type: 'room', room: room.info, faction: player.faction });
  directory();
}
function error(session: Session, message: string): void { send(session.socket, { type: 'error', message }); }
function leave(session: Session): void {
  const room = rooms.get(session.roomId ?? '');
  session.roomId = undefined; session.seq = 0;
  send(session.socket, { type: 'room', room: null, faction: null });
  if (!room) return;
  const player = room.info.players.find(player => player.id === session.id);
  if (room.info.phase === 'loading') {
    const worker = room.worker; room.worker = undefined; room.info.phase = 'waiting'; void worker?.terminate();
  } else if (player && room.worker && room.info.phase !== 'finished') room.worker.postMessage({ type: 'forfeit', faction: player.faction });
  room.info.players = room.info.players.filter(player => player.id !== session.id);
  if (!room.info.players.length) { void room.worker?.terminate(); rooms.delete(room.info.id); }
  else {
    if (room.info.phase === 'waiting') {
      room.info.hostId = room.info.players[0].id;
      room.info.players.forEach(player => { player.faction = 0; player.ready = false; });
    }
    roomChanged(room);
  }
  directory();
}
function connectionChanged(room: Room): void {
  const connected = room.info.players.length === 2 && room.info.players.every(player => player.connected);
  room.worker?.postMessage({ type: 'connection', playing: connected });
  if (room.info.phase === 'playing') for (const player of room.info.players)
    send(getSession(player.id)?.socket, { type: 'status', message: connected ? '' : 'Opponent disconnected. Waiting for reconnection...' });
  roomChanged(room);
}
function validOptions(value: unknown): MatchOptions | undefined {
  if (!value || typeof value !== 'object') return;
  const options = value as MatchOptions;
  if (typeof options.seed !== 'string' || !options.seed.trim() || options.seed.length > 64
    || !(WORLD_GENERATION_STYLES as readonly string[]).includes(options.style)
    || options.landformFamily !== 'mixed' && !(LANDFORM_KINDS as readonly string[]).includes(options.landformFamily)) return;
  return { seed: safeText(options.seed, 'TinyCiv-DUEL', 64), style: options.style, landformFamily: options.landformFamily };
}
function startMatch(room: Room): void {
  room.info.phase = 'loading'; roomChanged(room); counters.matchesStarted++;
  const worker = room.worker = new Worker(new URL('./match-worker.mjs', import.meta.url), {
    workerData: { options: room.info.options, players: room.info.players }, resourceLimits: { maxOldGenerationSizeMb: 384 },
  });
  worker.on('message', message => {
    if (room.worker !== worker) return;
    if (message.type === 'send') {
      const player = room.info.players.find(player => player.faction === message.faction);
      const socket = player && getSession(player.id)?.socket;
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (message.messageType !== 'frame' && message.messageType !== 'snapshot') { socket.send(message.payload); return; }
      replication.send(socket, message.messageType, message.payload, () => worker.postMessage({ type: 'sync', faction: player!.faction }));
    } else if (message.type === 'ready') { room.info.phase = 'playing'; connectionChanged(room); }
    else if (message.type === 'finished') { room.info.phase = 'finished'; room.finishedAt = Date.now(); roomChanged(room); }
    else if (message.type === 'failure') failMatch(room, message.message);
  });
  worker.on('error', failure => { console.error('Match worker failed:', failure instanceof Error ? failure.message : 'Unknown error'); failMatch(room, 'The match server stopped. Please create a new game.'); });
  worker.on('exit', code => { if (code && rooms.has(room.info.id) && room.worker === worker && room.info.phase === 'playing') failMatch(room, 'The match server stopped. Please create a new game.'); });
}
function failMatch(room: Room, message: string): void {
  const worker = room.worker; room.worker = undefined; void worker?.terminate(); room.info.phase = 'waiting';
  for (const player of room.info.players) { player.ready = false; send(getSession(player.id)?.socket, { type: 'error', message }); }
  roomChanged(room);
}
function handle(session: Session, message: any): void {
  const room = rooms.get(session.roomId ?? '');
  const player = room?.info.players.find(player => player.id === session.id);
  if (message.type === 'ping' && Number.isFinite(message.nonce)) { send(session.socket, { type: 'pong', nonce: message.nonce }); return; }
  if (message.type === 'list') { send(session.socket, { type: 'rooms', rooms: publicRooms() }); return; }
  if (message.type === 'leave') { leave(session); return; }
  if (message.type === 'create') {
    if (room) { error(session, 'Leave your current game first.'); return; }
    if (rooms.size >= maxRooms) { error(session, 'All match servers are busy. Please try again shortly.'); return; }
    const options = validOptions(message.options);
    if (!options) { error(session, 'Choose a valid map and seed.'); return; }
    const id = randomBytes(4).toString('hex').toUpperCase();
    const created: Room = { info: { id, name: safeText(message.name, 'New game', 40), location: process.env.SERVER_LOCATION || 'Oregon',
      phase: 'waiting', hostId: session.id, options, players: [{ id: session.id, name: safeText(message.playerName, 'Player 1'),
        faction: 0, color: color(message.color), ready: false, connected: true }] } };
    rooms.set(id, created); session.roomId = id; session.seq = 0; roomChanged(created); return;
  }
  if (message.type === 'join') {
    if (room) { error(session, 'Leave your current game first.'); return; }
    const target = rooms.get(message.roomId);
    if (!target || target.info.phase !== 'waiting') { error(session, 'This game is no longer available.'); return; }
    if (target.info.players.length >= 2) { error(session, 'This game is full.'); return; }
    let selectedColor = color(message.color);
    if (target.info.players.some(player => player.color === selectedColor)) selectedColor = FACTION_COLORS.find(value => !target.info.players.some(player => player.color === value))!;
    target.info.players.push({ id: session.id, name: safeText(message.name, 'Player 2'), faction: 1, color: selectedColor, ready: false, connected: true });
    target.info.players.forEach(player => player.ready = false); session.roomId = target.info.id; session.seq = 0; roomChanged(target); return;
  }
  if (!room || !player) { error(session, 'Join a game first.'); return; }
  if (message.type === 'profile' && room.info.phase === 'waiting') {
    const selectedColor = color(message.color);
    if (room.info.players.some(other => other.id !== player.id && other.color === selectedColor)) { error(session, 'That color is already selected.'); return; }
    player.name = safeText(message.name, `Player ${player.faction + 1}`); player.color = selectedColor;
    room.info.players.forEach(player => player.ready = false); roomChanged(room); return;
  }
  if (message.type === 'ready' && room.info.phase === 'waiting' && typeof message.ready === 'boolean') { player.ready = message.ready; roomChanged(room); return; }
  if (message.type === 'start') {
    if (room.info.hostId !== session.id) { error(session, 'Only the host can start the match.'); return; }
    if (room.info.phase !== 'waiting' || room.info.players.length !== 2 || room.info.players.some(player => !player.connected || !player.ready)) {
      error(session, 'Both players must be ready.'); return;
    }
    startMatch(room); return;
  }
  if (message.type === 'sync' && room.worker && Date.now() - session.syncAt > 1000) { session.syncAt = Date.now(); room.worker.postMessage({ type: 'sync', faction: player.faction }); return; }
  if (room.info.phase !== 'playing') return;
  if (message.type === 'input') {
    const input = validatedInput(message.input);
    if (input) room.worker?.postMessage({ type: 'input', faction: player.faction, input });
    return;
  }
  if (message.type === 'command') {
    if (!Number.isSafeInteger(message.seq) || message.seq <= session.seq || message.seq > session.seq + 1000) return;
    session.seq = message.seq; counters.commands++;
    room.worker?.postMessage({ type: 'command', faction: player.faction, seq: message.seq, command: message.command });
  }
}
function secretMatches(value: unknown): boolean {
  if (!originSecret) return true;
  if (typeof value !== 'string') return false;
  const expected = Buffer.from(originSecret), supplied = Buffer.from(value);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = createServer(async (request, response) => {
  if (!secretMatches(request.headers['x-tinyciv-origin']) && request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1') { response.writeHead(403).end(); return; }
  if (request.headers.origin && origins.has(request.headers.origin)) response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
  response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json');
  const path = request.url?.split('?')[0];
  if (request.method === 'GET' && (path === '/health' || path === '/api/health')) {
    response.end(JSON.stringify({ ok: true, game: 'tinyciv', protocol: PROTOCOL_VERSION, rooms: rooms.size, connections: sockets.size }));
  } else if (request.method === 'GET' && path === '/api/lobbies') response.end(JSON.stringify({ rooms: publicRooms() }));
  else if (appDirectory && (request.method === 'GET' || request.method === 'HEAD')) {
    try {
      const decoded = decodeURIComponent(path || '/');
      const file = resolve(appDirectory, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!file.startsWith(appDirectory + sep) || !Object.hasOwn(contentTypes, extname(file))) { response.writeHead(404).end(); return; }
      const metadata = await stat(file);
      if (!metadata.isFile()) { response.writeHead(404).end(); return; }
      response.setHeader('Content-Type', contentTypes[extname(file)]);
      response.setHeader('Content-Length', metadata.size);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', extname(file) === '.html' ? 'no-store' : 'public, max-age=3600');
      if (request.method === 'HEAD') response.end();
      else { const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response); }
    } catch { response.writeHead(404).end(); }
  } else response.writeHead(404).end(JSON.stringify({ error: 'Not found.' }));
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: { threshold: 512, serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 4 } });
server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  if (request.url !== '/api/ws' || !secretMatches(request.headers['x-tinyciv-origin']) || origin && !origins.has(origin) || sockets.size >= 100) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
  }
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', socket => {
  sockets.add(socket);
  let session: Session | undefined, count = 0, windowAt = Date.now(), alive = true;
  const helloDeadline = setTimeout(() => { if (!session) socket.close(4000, 'Hello required'); }, 5000);
  const heartbeat = setInterval(() => { if (!alive) { socket.terminate(); return; } alive = false; socket.ping(); }, 10000);
  socket.on('pong', () => { alive = true; });
  socket.on('error', () => {});
  socket.on('message', bytes => {
    const now = Date.now();
    if (now - windowAt >= 1000) { windowAt = now; count = 0; }
    if (++count > 80) { socket.close(4008, 'Too many messages'); return; }
    let message: any; try { message = JSON.parse(bytes.toString()); } catch { socket.close(4002, 'Invalid message'); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (!session) {
      if (message.type !== 'hello' || message.version !== PROTOCOL_VERSION) { send(socket, { type: 'error', message: 'Reload the game to update multiplayer.', fatal: true }); socket.close(); return; }
      session = typeof message.token === 'string' ? sessions.get(message.token) : undefined;
      if (session?.socket?.readyState === WebSocket.OPEN) { send(socket, { type: 'error', message: 'This player is already connected.', fatal: true }); session = undefined; socket.close(); return; }
      if (!session) { const token = randomBytes(32).toString('hex'); session = { token, id: randomUUID(), lastSeen: now, seq: 0, syncAt: 0 }; sessions.set(token, session); }
      session.socket = socket; session.lastSeen = now; clearTimeout(helloDeadline);
      send(socket, { type: 'welcome', version: PROTOCOL_VERSION, token: session.token, playerId: session.id, commandSequence: session.seq });
      const room = rooms.get(session.roomId ?? '');
      const player = room?.info.players.find(player => player.id === session!.id);
      if (room && player) { player.connected = true; connectionChanged(room); room.worker?.postMessage({ type: 'sync', faction: player.faction }); }
      else { session.roomId = undefined; send(socket, { type: 'room', room: null, faction: null }); send(socket, { type: 'rooms', rooms: publicRooms() }); }
      return;
    }
    session.lastSeen = now;
    try { handle(session, message); } catch (failure) { console.error('Command failed:', failure instanceof Error ? failure.message : 'Unknown error'); error(session, 'The request could not be completed.'); }
  });
  socket.on('close', () => {
    replication.close(socket);
    sockets.delete(socket); clearTimeout(helloDeadline); clearInterval(heartbeat);
    if (!session || session.socket !== socket) return;
    session.socket = undefined; session.lastSeen = Date.now();
    const room = rooms.get(session.roomId ?? ''), player = room?.info.players.find(player => player.id === session!.id);
    if (room && player) { player.connected = false; connectionChanged(room); }
  });
});
setInterval(() => {
  const now = Date.now();
  // Finished matches stop ticking. A congested socket still needs its terminal
  // snapshot once it drains, even when no later frame arrives to trigger sync.
  for (const session of sessions.values()) if (session.socket) replication.drain(session.socket, () => {
    const room = rooms.get(session.roomId ?? ''), player = room?.info.players.find(player => player.id === session.id);
    if (player) room?.worker?.postMessage({ type: 'sync', faction: player.faction });
  });
  for (const [token, session] of sessions) if (!session.socket && now - session.lastSeen > (session.roomId ? grace : 300000)) { leave(session); sessions.delete(token); }
  for (const room of rooms.values()) if (room.finishedAt && now - room.finishedAt > 300000) {
    for (const player of [...room.info.players]) { const session = getSession(player.id); if (session) leave(session); }
  }
}, 1000).unref();
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`TinyCiv multiplayer listening on ${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  for (const socket of sockets) { send(socket, { type: 'error', message: 'The server is restarting. Please reconnect.', fatal: true }); socket.close(1012); }
  for (const room of rooms.values()) void room.worker?.terminate();
  server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref();
});
