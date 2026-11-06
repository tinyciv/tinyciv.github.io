import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { WebSocket } from 'ws';

// Exercise the production server/worker transport with initial earned XP seeded
// only into this isolated test bundle. Production has no XP injection command.
const output = resolve('scratch/2026-11-02-leader-progression-implementation/multiplayer');
const port = Number(process.env.LEADER_SKILLS_TEST_PORT || 8796);
const endpoint = `http://127.0.0.1:${port}`;
const checks = [];
let server, serverLog = '';
const check = name => { checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(output, { recursive: true });
await build({ entryPoints: ['server/server.ts', 'server/match-worker.ts'], outdir: output,
  outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'leader-skills-earned-xp-fixture', setup(build) {
    build.onLoad({ filter: /server\/match-worker\.ts$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const marker = '  state.paused = false; state.speed = 1;';
      assert.ok(source.includes(marker), 'Worker fixture insertion point exists');
      return { contents: `import { awardLeaderXp } from '../src/game/leader-progression';\n${source.replace(marker,
        '  awardLeaderXp(state, 600, 0); awardLeaderXp(state, 600, 1);\n' + marker)}`,
        loader: 'ts', resolveDir: resolve('server') };
    });
  } }],
});
await copyFile('public/wasm/navigation.wasm', `${output}/navigation.wasm`);

class Peer {
  socket; messages = []; state; token = ''; seq = 0;
  async open() {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
    this.socket.on('message', data => {
      const message = JSON.parse(data); this.messages.push(message);
      if (message.type === 'welcome') { this.token = message.token; this.seq = message.commandSequence; }
      if (message.type === 'snapshot') this.state = message.state;
      if (message.type === 'frame' && this.state) {
        for (const [index, tile] of message.tiles || []) this.state.world.tiles[index] = tile;
        this.state = { ...message.state, world: this.state.world };
      }
    });
    await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); });
    this.send({ type: 'hello', version: 1, ...(this.token ? { token: this.token } : {}) });
    await this.wait(message => message.type === 'welcome');
  }
  send(message) { this.socket.send(JSON.stringify(message)); }
  async wait(predicate, timeout = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await delay(25);
    }
    throw new Error(`Message timeout: ${JSON.stringify(this.messages.filter(message => !['frame', 'snapshot'].includes(message.type)).slice(-5))}`);
  }
  async until(predicate, timeout = 15000) {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > timeout) throw new Error('State convergence timeout.'); await delay(25); }
  }
  async command(command) {
    const seq = ++this.seq; this.send({ type: 'command', seq, command });
    return (await this.wait(message => message.type === 'result' && message.seq === seq)).result;
  }
  leader(faction) { return this.state.units.find(unit => unit.kind === 'leader' && unit.faction === faction && unit.hp > 0); }
  close() { this.socket?.close(); }
}
const a = new Peer(), b = new Peer();
try {
  // Refuse to run against an existing service; this harness owns its process.
  try { await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) }); throw new Error(`Port ${port} already serves HTTP.`); }
  catch (error) { if (error.message.includes('already serves')) throw error; }
  server = spawn(process.execPath, [`${output}/server.mjs`], { env: { ...process.env, PORT: String(port), MAX_ROOMS: '1', ORIGIN_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => serverLog += String(data)); server.stderr.on('data', data => serverLog += String(data));
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${serverLog}`);
    try { ready = (await (await fetch(`${endpoint}/health`)).json()).ok; } catch { await delay(50); }
  }
  assert.ok(ready, 'Local test server starts');
  await Promise.all([a.open(), b.open()]);
  a.send({ type: 'create', name: 'Leader Skills E2E', playerName: 'Blue', color: '#4f9ee8',
    options: { seed: 'BTV-LEADER-SKILLS-E2E', style: 'pangaea', landformFamily: 'mixed' } });
  const created = await a.wait(message => message.type === 'room' && message.room?.name === 'Leader Skills E2E');
  b.send({ type: 'join', roomId: created.room.id, name: 'Red', color: '#df6262' });
  await b.wait(message => message.type === 'room' && message.room?.players.length === 2);
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.wait(message => message.type === 'room' && message.room?.players.length === 2 && message.room.players.every(player => player.ready));
  a.send({ type: 'start' });
  await Promise.all([a.wait(message => message.type === 'snapshot', 120000), b.wait(message => message.type === 'snapshot', 120000)]);
  for (const peer of [a, b]) for (const faction of [0, 1]) {
    assert.equal(peer.leader(faction).leaderProgression.level, 4);
    assert.equal(peer.leader(faction).leaderProgression.skillPoints, 3);
  }
  assert.equal(a.state.playerFaction, 0); assert.equal(b.state.playerFaction, 1);
  check('Both authenticated players receive initial Leader XP and points in snapshots');

  const baseAttack = a.leader(0).attack, opponentAttack = a.leader(1).attack;
  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: 'power', faction: 1, unitId: a.leader(1).id, skillPoints: 999 })).ok, true);
  await a.until(() => [a, b].every(peer => peer.leader(0).leaderProgression.skills.power === 1));
  assert.equal(a.leader(0).attack, baseAttack + 2); assert.equal(b.leader(0).attack, baseAttack + 2);
  assert.equal(a.leader(1).attack, opponentAttack); assert.equal(a.leader(1).leaderProgression.skills.power, 0);
  check('Learn uses the socket owner and replicates the exact stat/point change to both clients');
  const beforeInvalid = structuredClone(a.leader(0).leaderProgression);
  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: '__proto__' })).ok, false);
  assert.deepEqual(a.leader(0).leaderProgression, beforeInvalid);
  check('Malformed skills are rejected over the real transport');

  assert.equal((await b.command({ type: 'learnLeaderSkill', skill: 'guard' })).ok, true);
  assert.equal((await b.command({ type: 'learnLeaderSkill', skill: 'command' })).ok, true);
  await b.until(() => [a, b].every(peer => peer.leader(1).leaderProgression.skills.command === 1));
  assert.equal(a.leader(1).leaderProgression.skills.guard, 1); assert.equal(a.leader(1).leaderProgression.skillPoints, 1);
  assert.equal(a.leader(0).leaderProgression.skills.command, 0);
  check('Player two independently learns Guard and Command without affecting player one');

  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: 'power' })).ok, true);
  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: 'power' })).ok, true);
  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: 'power' })).ok, false);
  assert.equal((await a.command({ type: 'learnLeaderSkill', skill: 'guard' })).ok, false);
  await a.until(() => [a, b].every(peer => peer.leader(0).leaderProgression.skills.power === 3));
  assert.equal(a.leader(0).leaderProgression.skillPoints, 0); assert.equal(a.leader(0).attack, baseAttack + 6);
  check('Rank cap and exhausted points reject consecutive purchases without extra bonuses');

  const learned = structuredClone(b.leader(1).leaderProgression);
  b.close(); await a.wait(message => message.type === 'status' && /disconnected/.test(message.message));
  await a.until(() => a.state.paused);
  await delay(100); b.messages = []; await b.open(); await b.wait(message => message.type === 'snapshot');
  assert.equal(b.state.playerFaction, 1); assert.deepEqual(b.leader(1).leaderProgression, learned);
  await b.until(() => !b.state.paused);
  assert.equal((await b.command({ type: 'learnLeaderSkill', skill: 'guard' })).ok, true);
  await b.until(() => b.leader(1).leaderProgression.skills.guard === 2 && b.leader(1).leaderProgression.skillPoints === 0);
  check('Reconnect restores XP/ranks/points and the authenticated command sequence');
  console.log(`Passed ${checks.length} live Leader progression multiplayer checks.`);
  await writeFile(`${output}/report.json`, JSON.stringify({ endpoint, fixture: '600 earned XP per Leader before initial snapshot; no production injection endpoint', checks, passed: true }, null, 2));
} catch (error) {
  await writeFile(`${output}/report.json`, JSON.stringify({ endpoint, checks, passed: false, error: error.stack || String(error), serverLog }, null, 2));
  throw error;
} finally {
  for (const peer of [a, b]) { if (peer.socket?.readyState === WebSocket.OPEN) peer.send({ type: 'leave' }); peer.close(); }
  server?.kill('SIGTERM');
  await writeFile(`${output}/server.log`, serverLog);
}
