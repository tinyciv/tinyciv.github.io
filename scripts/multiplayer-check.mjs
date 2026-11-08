import { ClientStateReplica, PROTOCOL_VERSION } from './multiplayer-wire.mjs';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
const endpoint = process.env.MULTIPLAYER_URL || 'http://127.0.0.1:8787';
const wsUrl = new URL('/api/ws', endpoint); wsUrl.protocol = endpoint.startsWith('https:') ? 'wss:' : 'ws:';
const checks = [];
const check = message => { checks.push(message); console.log(`PASS ${message}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Peer {
  messages = []; state; token = ''; seq = 0; room = null; socket;
  async open() {
    this.socket = new WebSocket(wsUrl, { handshakeTimeout: 15000, ...(process.env.MULTIPLAYER_ORIGIN ? { origin: process.env.MULTIPLAYER_ORIGIN } : {}) });
    this.socket.on('message', data => {
      const message = JSON.parse(data); this.messages.push(message);
      if (message.type === 'welcome') { this.token = message.token; this.seq = message.commandSequence; }
      if (message.type === 'room') this.room = message.room;
      if (message.type === 'snapshot') { this.state = message.state; this.replica = new ClientStateReplica(this.state); }
      if (message.type === 'frame' && this.state) {
        for (const [index, tile] of message.tiles || []) this.state.world.tiles[index] = tile;
        if (message.worldRevision !== undefined) this.state.world.revision = message.worldRevision;
        this.replica.apply(message.delta);
      }
    });
    await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); });
    this.send({ type: 'hello', version: PROTOCOL_VERSION, ...(this.token ? { token: this.token } : {}) });
    await this.wait(message => message.type === 'welcome');
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  async wait(predicate, timeout = 45000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(25);
    }
    throw new Error(`Timed out waiting for message. Recent: ${JSON.stringify(this.messages.filter(message => !['snapshot', 'frame'].includes(message.type)).slice(-5))}`);
  }
  async until(predicate, timeout = 15000) { const start = Date.now(); while (!predicate()) { if (Date.now() - start > timeout) throw new Error('State did not converge.'); await delay(50); } }
  async command(command) { const seq = ++this.seq; this.send({ type: 'command', seq, command }); return (await this.wait(message => message.type === 'result' && message.seq === seq)).result; }
  close() { this.socket?.close(); }
}
const a = new Peer(), b = new Peer(), extra = new Peer();
try {
  const healthResponse = await fetch(new URL('/api/health', endpoint), { signal: AbortSignal.timeout(15000), headers: process.env.MULTIPLAYER_ORIGIN ? { Origin: process.env.MULTIPLAYER_ORIGIN } : {} });
  assert.equal(healthResponse.status, 200);
  if (process.env.MULTIPLAYER_ORIGIN) assert.equal(healthResponse.headers.get('access-control-allow-origin'), process.env.MULTIPLAYER_ORIGIN);
  const health = await healthResponse.json(); assert.equal(health.ok, true);
  await Promise.all([a.open(), b.open(), extra.open()]); check('AWS/local HTTPS and independent authenticated sockets');
  a.send({ type: 'create', name: 'E2E duel', playerName: 'Blue Tester', color: '#4f9ee8', options: { seed: 'BTV-E2E-1V1', style: 'pangaea', landformFamily: 'mixed' } });
  const created = await a.wait(message => message.type === 'room' && message.room?.name === 'E2E duel');
  b.send({ type: 'join', roomId: created.room.id, name: 'Red Tester', color: '#df6262' });
  await b.wait(message => message.type === 'room' && message.room?.players.length === 2);
  extra.send({ type: 'join', roomId: created.room.id, name: 'Third player', color: '#e5b94e' });
  assert.match((await extra.wait(message => message.type === 'error')).message, /full/); check('Room capacity is exactly two players');
  b.send({ type: 'start' }); assert.match((await b.wait(message => message.type === 'error')).message, /host/);
  a.send({ type: 'start' }); assert.match((await a.wait(message => message.type === 'error')).message, /ready/); check('Only host starts, after both players are ready');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.wait(message => message.type === 'room' && message.room?.players.length === 2 && message.room.players.every(player => player.ready));
  a.send({ type: 'start' });
  await Promise.all([a.wait(message => message.type === 'snapshot', 120000), b.wait(message => message.type === 'snapshot', 120000)]);
  assert.equal(a.state.playerFaction, 0); assert.equal(b.state.playerFaction, 1);
  assert.equal(a.state.factions.length, 2); assert.equal(b.state.factions.length, 2);
  assert.equal(a.state.seed, b.state.seed); assert.deepEqual(a.state.world.spawns, b.state.world.spawns);
  assert.equal(a.state.factions[0].gold, a.state.factions[1].gold);
  assert.notDeepEqual(a.state.fog.explored, b.state.fog.explored); check('Shared generated world, two equal human factions, independent fog');
  const leaders = a.state.units.filter(unit => unit.kind === 'leader').sort((x,y) => x.faction - y.faction);
  assert.equal(leaders.length, 2);
  const before = leaders.map(unit => ({ id: unit.id, x: unit.x, y: unit.y }));
  for (let count = 0; count < 8; count++) {
    a.send({ type: 'input', input: { right: true, left: false, up: false, down: false } });
    b.send({ type: 'input', input: { right: false, left: false, up: false, down: true } }); await delay(150);
  }
  for (const peer of [a,b]) peer.send({ type: 'input', input: { right: false, left: false, up: false, down: false } });
  await a.until(() => before.every(initial => { const unit = a.state.units.find(unit => unit.id === initial.id); return Math.hypot(unit.x - initial.x, unit.y - initial.y) > .2; }));
  check('Both players independently move their own Leaders');
  assert.equal((await a.command({ type: 'stance', stance: 'defensive' })).ok, true);
  assert.equal((await b.command({ type: 'stance', stance: 'hold' })).ok, true);
  await a.until(() => a.state.retinueStance === 'defensive' && b.state.retinueStance === 'hold');
  assert.equal((await a.command({ type: 'recall' })).ok, true); assert.equal((await b.command({ type: 'recall' })).ok, true);
  check('Stance and Recall commands remain faction-specific');
  assert.equal((await b.command({ type: 'governor', buildingId: a.state.buildings.find(item => item.kind === 'palace' && item.faction === 0).id, permission: 'housing', enabled: false })).ok, false);
  assert.equal((await b.command({ type: 'move', x: Infinity, y: 1 })).ok, false);
  check('Opponent-building mutations and invalid coordinates rejected');
  const palace = b.state.buildings.find(building => building.kind === 'palace' && building.faction === 1);
  let road;
  for (let y = palace.y - 3; y <= palace.y + 4 && !road; y++) for (let x = palace.x - 3; x <= palace.x + 4 && !road; x++) {
    if ((await b.command({ type: 'build', kind: 'road', points: [{x,y}] })).ok) road = {x,y};
  }
  assert.ok(road, 'Player 2 can construct in its own realm');
  await a.until(() => [a,b].every(peer => peer.state.buildings.some(building => building.kind === 'road' && building.faction === 1 && building.x === road.x && building.y === road.y)));
  check('Player 2 construction is authoritative and replicated to both clients');
  b.close(); await a.wait(message => message.type === 'status' && /disconnected/.test(message.message));
  await a.until(() => a.state.paused);
  await delay(100); b.messages = []; await b.open();
  await b.wait(message => message.type === 'snapshot');
  await a.until(() => !a.state.paused && !b.state.paused);
  assert.equal(b.state.playerFaction, 1); assert.equal((await b.command({ type: 'stance', stance: 'aggressive' })).ok, true);
  check('Disconnect pauses the match; authenticated reconnect restores faction and command sequence');
  b.send({ type: 'leave' });
  await a.until(() => a.state.gameOver && a.state.victory);
  check('Leaving an active match awards victory to the remaining player');
  a.send({ type: 'leave' }); await delay(200);
  const directory = await (await fetch(new URL('/api/lobbies', endpoint))).json();
  assert.ok(!directory.rooms.some(room => room.id === created.room.id)); check('Empty match releases its room and worker');
  await mkdir('scratch/2026-11-01-multiplayer', { recursive: true });
  await writeFile('scratch/2026-11-01-multiplayer/network-report.json', JSON.stringify({ endpoint, checks, passed: true }, null, 2));
  console.log(`Passed ${checks.length} multiplayer checks.`);
} finally { for (const peer of [a,b,extra]) { if (peer.socket?.readyState === WebSocket.OPEN) peer.send({ type: 'leave' }); peer.close(); } }
