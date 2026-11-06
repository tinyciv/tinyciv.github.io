// In the running development game's DevTools Console:
// (await import('/scripts/profile-live-console.js')).profileLive(60)
// Add { movement: true } for detailed movement timings (adds timing overhead).
// Records the real animation loop without replacing the world or camera.
// Pair with DevTools Performance recording for sampled function attribution.
export async function profileLive(seconds = 60, { delay = 5, captureUrl, movement = false } = {}) {
  const game = window.__game;
  if (!game) throw new Error('Open the development game first');
  if (window.__liveProfileRunning) throw new Error('A live profile is already running');
  window.__liveProfileRunning = true;
  const state = game.state, renderer = game.renderer;
  let modules;
  try {
    modules = await Promise.all(['navigation-wasm', 'courier-routes', 'farm-pickup-routes', 'movement-profile', 'city-ownership', 'governor'].map(async name => {
      const url = performance.getEntriesByType('resource').filter(entry => entry.name.includes(`/src/game/${name}.ts`)).at(-1)?.name;
      return url ? import(url) : {};
    }));
    if (movement && (!modules[3].setMovementProfiling || !modules[3].movementProfile))
      throw new Error('The loaded movement profiler module was not found. Reload the development game before profiling.');
  } catch (error) { window.__liveProfileRunning = false; throw error; }
  const counters = () => ({ activeUnits: game.entities(state).units.query('active').length,
    sleepingUnits: state.units.length - game.entities(state).units.query('active').length,
    navigation: modules[0].navigationWasmStatus?.(),
    routes: modules[1].courierRouteCacheStats?.(state), pickups: modules[2].farmPickupRouteStats?.(state),
    cityOwnership: modules[4].cityOwnershipStats?.(state), cityPlanning: modules[5].cityPlanningStats?.(state) });
  const originalRAF = window.requestAnimationFrame;
  const originalMethods = new Map();
  const frames = [];
  let current = null, started = 0, gameStarted = 0, previous = 0, before, timer, finished = false;
  const originalSpeed = state.speed;
  state.paused = true;
  const summary = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return { mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)],
      p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
  };
  return new Promise((resolve, reject) => {
    const finish = async error => {
      if (finished) return;
      const elapsed = started ? performance.now() - started : 0;
      performance.mark('btv-live-profile-end');
      finished = true; clearTimeout(timer);
      window.requestAnimationFrame = originalRAF;
      for (const [key, method] of originalMethods) renderer[key] = method;
      state.paused = true; state.speed = originalSpeed;
      window.__liveProfileRunning = false;
      let movementResult;
      if (movement) {
        try { movementResult = { ...modules[3].movementProfile(state) }; }
        finally { modules[3].setMovementProfiling(state, false); }
      }
      try { game.save(); } catch (saveError) { error ??= saveError; }
      const result = { seconds, elapsed, gameSeconds: state.time - gameStarted, frames: frames.length,
        fps: frames.length / (elapsed / 1000), speed: originalSpeed, startTime: gameStarted, endTime: state.time,
        backend: renderer.backend, viewport: [innerWidth, innerHeight, devicePixelRatio],
        units: state.units.length, buildings: state.buildings.length, fields: state.fields.length,
        populations: state.factions.map(f => ({ id: f.id, name: f.name, population: f.population })),
        before, after: counters(), movement: movementResult,
        metrics: Object.fromEntries(['total', 'sim', 'draw', 'other', 'prepare', 'prepareFog', 'drawMinimap', 'interval']
          .map(key => [key, summary(frames.slice(key === 'interval' ? 1 : 0).map(frame => frame[key] || 0))])),
        error: error ? String(error) : null, rawFrames: frames };
      window.__lastLiveProfile = result;
      console.log('Live profile complete; game paused', result);
      try {
        if (captureUrl) {
          for (const [endpoint, value] of [['metrics', result], ['after', state]]) {
            const response = await fetch(`${captureUrl}/${endpoint}`, { method: 'POST',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
            if (!response.ok) throw Error(`Capture failed: ${response.status}`);
          }
        }
        if (error) reject(error); else resolve(result);
      } catch (captureError) { reject(captureError); }
    };
    for (const key of ['draw', 'prepare', 'prepareFog', 'drawMinimap']) {
      const method = renderer[key];
      if (typeof method !== 'function') continue;
      originalMethods.set(key, method);
      renderer[key] = function (...args) {
        const time = performance.now();
        if (key === 'draw' && current) current.sim = time - current.started;
        try { return method.apply(this, args); }
        finally { if (current) current[key] = (current[key] || 0) + performance.now() - time; }
      };
    }
    window.requestAnimationFrame = function (callback) {
      if (callback.name !== 'frame') return originalRAF.call(window, callback);
      return originalRAF.call(window, now => {
        if (finished || !started) { callback(now); return; }
        if (game.state !== state) { void finish(Error('Game state changed during capture')); callback(now); return; }
        current = { started: performance.now(), interval: previous ? now - previous : 0 };
        previous = now;
        try { callback(now); }
        catch (error) { void finish(error); throw error; }
        finally {
          current.total = performance.now() - current.started;
          current.other = current.total - (current.sim || 0) - (current.draw || 0);
          delete current.started; frames.push(current); current = null;
        }
        if (performance.now() - started >= seconds * 1000) void finish();
      });
    };
    timer = setTimeout(() => {
      if (movement) modules[3].setMovementProfiling?.(state, true);
      started = performance.now(); gameStarted = state.time; before = counters(); state.paused = false;
      performance.mark('btv-live-profile-start');
      console.log('Live profile started', { seconds, speed: state.speed, time: state.time });
      timer = setTimeout(() => void finish(Error('Animation loop stopped or backgrounded')), (seconds + 10) * 1000);
    }, delay * 1000);
  });
}
