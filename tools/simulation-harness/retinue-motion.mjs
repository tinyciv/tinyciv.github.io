// Host-only experiment: issue ordinary Leader move orders in an untouched
// generated landscape. All movement, traffic and formation rules stay native
// to the production game. Observations never change a soldier's position.
export function retinueMotion(engine, state, count = 40) {
  const leader = state.units.find(unit => unit.faction === 0 && unit.kind === 'leader');
  if (!leader) throw new Error('Retinue motion observation requires a player Leader');
  const origin = { x: leader.x, y: leader.y }, points = [];
  const width = state.world.width, height = state.world.height;
  const at = point => Math.floor(point.y) * width + Math.floor(point.x);
  const occupied = new Set();
  // Existing structure footprints remain intact, including natural city roads.
  for (const building of state.buildings) if (building.hp > 0 && !['road', 'bridge', 'farm', 'irrigation'].includes(building.kind)) {
    for (let y = building.y; y < building.y + engine.buildingHeight(building); y++)
      for (let x = building.x; x < building.x + engine.buildingWidth(building); x++) occupied.add(y * width + x);
  }
  const store = engine.entityStore(state);
  const original = state.units.filter(unit => unit.faction === 0 && engine.isRetinueMember(unit) && !unit.ranger);
  if (!original.length) throw new Error('Motion fixture has no starting escort');
  for (const unit of state.units) if (unit.hp > 0 && !unit.inside) occupied.add(at(unit));
  const muster = [];
  for (let y = Math.max(1, Math.floor(origin.y) - 12); y <= Math.min(height - 2, Math.ceil(origin.y) + 12); y++)
    for (let x = Math.max(1, Math.floor(origin.x) - 12); x <= Math.min(width - 2, Math.ceil(origin.x) + 12); x++) {
      const point = { x: x + .5, y: y + .5 };
      if (occupied.has(at(point)) || !engine.canWalk(state, point.x, point.y, 0)) continue;
      muster.push(point);
    }
  muster.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y)
    || a.y - b.y || a.x - b.x);
  let added = 0;
  for (const point of muster) {
    if (original.length + added >= count) break;
    if (!engine.hasStaticPath(state, origin, point, 0)) continue;
    const unit = { ...structuredClone(original[added % original.length]), ...point, id: store.allocateId(),
      retinueSquad: undefined, target: undefined, path: undefined, pathGoal: undefined, destination: undefined,
      joiningRetinue: false, training: undefined, recallIssuedAt: undefined, forcedAttack: undefined };
    store.units.add(unit); occupied.add(at(point)); added++;
  }
  state.factions.find(faction => faction.id === 0).bonusRetinueSlots = added;
  for (const angle of [.2, 2.3, 4.4]) {
    const desired = { x: origin.x + Math.cos(angle) * 18, y: origin.y + Math.sin(angle) * 18 };
    let best, score = Infinity;
    for (let y = Math.max(1, Math.floor(desired.y) - 8); y <= Math.min(height - 2, Math.ceil(desired.y) + 8); y++)
      for (let x = Math.max(1, Math.floor(desired.x) - 8); x <= Math.min(width - 2, Math.ceil(desired.x) + 8); x++) {
        const point = { x: x + .5, y: y + .5 }, distance = Math.hypot(point.x - desired.x, point.y - desired.y);
        if (distance >= score || occupied.has(at(point)) || !engine.canWalk(state, point.x, point.y, 0)
          || !engine.hasStaticPath(state, origin, point, 0)) continue;
        best = point; score = distance;
      }
    if (best) points.push(best);
  }
  if (points.length !== 3) throw new Error('Cannot find three reachable generated-world retinue waypoints');
  const initialRetinue = state.units.filter(unit => unit.faction === 0 && engine.isRetinueMember(unit) && !unit.ranger);
  const samples = new Map(), windows = new Map(), traces = [];
  let next = 0, lastLeader = origin, lastLeaderMotion = 0, traceAt = 0;
  const window = (name, unit) => {
    let value = windows.get(name);
    if (!value) windows.set(name, value = { name, unitSeconds: 0, movingUnitSeconds: 0, distance: 0,
      reversals: 0, units: new Set(), leaderDistance: 0, frames: 0 });
    value.units.add(unit.id); return value;
  };
  return {
    before(elapsed) {
      if (next < points.length && elapsed >= [1, 15, 30][next]) {
        leader.destination = { ...points[next++] };
        leader.path = undefined; leader.pathGoal = undefined; leader.repathAt = 0;
      }
    },
    sample(elapsed, dt) {
      if (Math.hypot(leader.x - lastLeader.x, leader.y - lastLeader.y) > .01) lastLeaderMotion = elapsed;
      lastLeader = { x: leader.x, y: leader.y };
      const quiet = elapsed - lastLeaderMotion;
      const calm = elapsed >= 55 && elapsed <= 90 && quiet >= 2;
      const afterStop = elapsed >= 4 && elapsed <= 90 && quiet >= .5 && quiet <= 8;
      let moving = 0, distance = 0, live = 0;
      for (const unit of initialRetinue) {
        const old = samples.get(unit.id), dx = old ? unit.x - old.x : 0, dy = old ? unit.y - old.y : 0;
        const d = Math.hypot(dx, dy), leaderDistance = Math.hypot(unit.x - leader.x, unit.y - leader.y);
        const reversal = old && d > .025 && Math.hypot(old.dx, old.dy) > .025
          && (old.dx * dx + old.dy * dy) / (Math.hypot(old.dx, old.dy) * d) < -.5;
        samples.set(unit.id, { x: unit.x, y: unit.y, dx, dy });
        if (unit.hp <= 0 || unit.inside || unit.order !== 'follow' || state.time - unit.lastCombat < 3) continue;
        live++; distance += d; moving += Number(d > .01);
        const names = [];
        if (calm) names.push(leaderDistance <= 8 ? 'near-stopped-leader' : 'catching-up');
        if (afterStop) names.push(leaderDistance <= 8 ? 'after-stop-near' : 'after-stop-catching-up');
        for (const name of names) {
          const value = window(name, unit);
          value.unitSeconds += dt; value.movingUnitSeconds += d > .01 ? dt : 0; value.distance += d;
          value.reversals += Number(reversal); value.leaderDistance += leaderDistance; value.frames++;
        }
      }
      if (elapsed >= traceAt && elapsed <= 90) {
        traces.push({ t: Number(elapsed.toFixed(2)), leader: [leader.x, leader.y], moving, live,
          distance, retinue: initialRetinue.filter(unit => unit.hp > 0).map(unit => [unit.id, unit.x, unit.y]) });
        traceAt += 1;
      }
    },
    finish() {
      return { origin, waypoints: points, initialRetinue: initialRetinue.length, leader: { x: leader.x, y: leader.y },
        windows: [...windows.values()].map(({ units, ...value }) => ({ ...value, units: units.size,
          movingFraction: value.movingUnitSeconds / Math.max(value.unitSeconds, 1e-9),
          distancePerUnitSecond: value.distance / Math.max(value.unitSeconds, 1e-9),
          meanLeaderDistance: value.leaderDistance / Math.max(value.frames, 1) })), traces };
    },
  };
}
