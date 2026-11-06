import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const output = 'scratch/2026-10-31-river-sinuosity';
await mkdir(output, { recursive: true });
const checks = [], errors = [], network = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  assert.ok(pass, `${name}: ${JSON.stringify(detail)}`);
};

/** Reconstruct the graph independently from receiver edges; no implementation diagnostics are trusted. */
function inspectNetwork(m) {
  const count = m.width * m.height;
  const incoming = Array.from({ length: count }, () => []);
  let invalid = 0, uphill = 0;
  for (let i = 0; i < count; i++) {
    const target = m.receiver[i];
    if (target >= 0 && target < count && target !== i) incoming[target].push(i);
    else if (target >= 0) invalid++;
    if (target >= 0 && m.channel[i] && m.channel[target] && m.elevation[target] > m.elevation[i] + 1e-7) uphill++;
  }
  const degree = incoming.map(values => values.length), queue = [];
  for (let i = 0; i < count; i++) if (!degree[i]) queue.push(i);
  const computed = Float64Array.from(m.localRunoff);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], target = m.receiver[i];
    if (target < 0 || target >= count || target === i) continue;
    computed[target] += computed[i];
    if (--degree[target] === 0) queue.push(target);
  }
  let maxRelativeError = 0, sources = 0, junctions = 0, broken = 0, reversed = 0;
  const channelCounts = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    maxRelativeError = Math.max(maxRelativeError, Math.abs(computed[i] - m.flow[i]) / Math.max(1, computed[i]));
    channelCounts[m.channel[i]]++;
    if (!m.channel[i]) continue;
    const upstream = incoming[i].filter(j => m.channel[j]);
    if (!upstream.length) sources++;
    if (upstream.length > 1) junctions++;
    const target = m.receiver[i];
    if (target >= 0 && !m.channel[target] && !m.seaMask[target]) broken++;
    if (target >= 0 && m.channel[target] && m.flow[target] + 1e-7 < m.flow[i]) reversed++;
  }
  return { count, invalid, visited: queue.length, maxRelativeError, sources, junctions, broken, reversed, uphill, channelCounts };
}

const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
const waitDraw = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const snapshot = () => page.evaluate(() => {
  const { model } = window.__riverNetworkDesign;
  const data = { width: model.width, height: model.height, mouth: model.mouth, sources: model.sources, crossings: model.crossings, diagnostics: model.diagnostics };
  for (const key of ['receiver', 'flow', 'localRunoff', 'elevation', 'streamOrder', 'channel', 'widthTiles', 'waterMask', 'fordMask', 'seaMask']) data[key] = Array.from(model[key]);
  return data;
});

try {
  await page.goto(pathToFileURL(resolve('output/river-network-design.html')).href);
  await page.waitForFunction(() => !!window.__riverNetworkDesign?.model && document.documentElement.dataset.ready === 'true', null, { timeout: 30000 });
  await waitDraw();
  const model = await snapshot(), topology = inspectNetwork(model);
  check('standalone initializes a complete review basin', model.width > 20 && model.height > 20 && model.flow.length === model.width * model.height, { width: model.width, height: model.height });
  check('receiver graph is valid and has no cycles', topology.invalid === 0 && topology.visited === topology.count, topology);
  check('discharge equals independently accumulated local runoff', topology.maxRelativeError < 1e-5, topology.maxRelativeError);
  check('many headwaters merge into tributaries', topology.sources >= 10 && topology.junctions >= 8, { sources: topology.sources, junctions: topology.junctions });
  check('all three river classes are represented', topology.channelCounts.slice(1).every(count => count > 0), topology.channelCounts);
  check('river channels remain connected to downstream channels or the sea', topology.broken === 0, topology.broken);
  check('discharge never shrinks downstream', topology.reversed === 0, topology.reversed);
  check('channel elevation falls or stays level downstream', topology.uphill === 0, topology.uphill);
  const rendered = await page.locator('#map').evaluate(canvas => {
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height), colors = new Set(); let opaque = 0;
    for (let i = 0; i < image.data.length; i += 16) { colors.add(Array.from(image.data.slice(i, i + 3)).join(',')); if (image.data[i + 3] === 255) opaque++; }
    return { colors: colors.size, opaque: opaque / (image.data.length / 16) };
  });
  check('canvas contains rendered terrain and channel artwork', rendered.colors > 40 && rendered.opaque > .99, rendered);
  const stageAlignment = await page.evaluate(() => ['stage-stream', 'stage-tributary'].map(id => {
    const c = document.getElementById(id), pixels = c.getContext('2d').getImageData(0, 37, c.width, 1).data, water = [];
    for (let x = 0; x < c.width; x++) if (pixels[x * 4] === 51 && pixels[x * 4 + 1] === 185 && pixels[x * 4 + 2] === 187) water.push(x);
    return { id, left: Math.min(...water), right: Math.max(...water), pixels: water.length };
  }));
  check('width diagrams align stream and one-tile water inside one grid cell', stageAlignment.every(a => Math.floor(a.left / 16) === Math.floor(a.right / 16)) && stageAlignment[0].pixels < 8 && stageAlignment[1].pixels >= 14, stageAlignment);
  check('sub-tile streams, one-cell tributaries and broad target widths follow the discharge bands', model.channel.every((kind, i) => !kind || (kind === 1 ? model.widthTiles[i] > 0 && model.widthTiles[i] < .5 : kind === 2 ? model.widthTiles[i] === 1 : model.widthTiles[i] >= 2 && model.widthTiles[i] <= 5)));
  const movement = await page.evaluate(() => {
    const api = window.__riverNetworkDesign, m = api.model;
    let dryStreams = 0, crossableStreams = 0, blockedRiver = 0, wetRiver = 0, blockedMain = 0;
    for (let i = 0; i < m.channel.length; i++) {
      if (m.channel[i] === 1 && !m.waterMask[i]) { dryStreams++; if (api.passable(i)) crossableStreams++; }
      if (m.channel[i] === 2 && !m.fordMask[i]) { wetRiver++; if (!api.passable(i)) blockedRiver++; }
      if (m.channel[i] === 3 && !m.fordMask[i] && !api.passable(i)) blockedMain++;
    }
    return { dryStreams, crossableStreams, blockedRiver, wetRiver, blockedMain };
  });
  check('streams remain walkable ground and unforded rivers remain barriers', movement.dryStreams > 40 && movement.crossableStreams === movement.dryStreams && movement.blockedRiver === movement.wetRiver && movement.blockedMain > 20, movement);
  const fordCells = new Set(); let invalidCrossings = 0;
  for (const crossing of model.crossings.filter(c => c.kind === 'ford')) {
    const [a, b] = crossing.banks, step = crossing.axis === 'horizontal' ? 1 : model.width;
    const expected = [];
    for (let i = Math.min(a.cell, b.cell) + step; i < Math.max(a.cell, b.cell); i += step) expected.push(i);
    if (model.waterMask[a.cell] || model.waterMask[b.cell] || expected.length !== crossing.cells.length || expected.some(i => !crossing.cells.includes(i) || !model.waterMask[i] || !model.fordMask[i])) invalidCrossings++;
    crossing.cells.forEach(i => fordCells.add(i));
  }
  check('every ford spans the complete water channel between two dry banks', invalidCrossings === 0 && fordCells.size > 20, { invalidCrossings, fordCells: fordCells.size });
  check('no isolated walkable ford cells exist outside crossing records', model.fordMask.every((marked, i) => !marked || fordCells.has(i)));
  check('fords never cross a broad main-river spine through an adjacent tributary', model.crossings.filter(c => c.kind === 'ford').every(c => { const main = c.cells.filter(i => model.channel[i] === 3); return !main.length || c.cells.length <= 3 && main.every(i => model.widthTiles[i] <= 2.5); }));
  check('all visible headwaters begin as crossable sub-tile streams', model.sources.every(s => model.channel[s.cell] === 1 && !model.waterMask[s.cell]));
  const initialUpstream = await page.evaluate(() => ({ cell: window.__riverNetworkDesign.selectedCell, upstream: window.__riverNetworkDesign.upstream }));
  const reversedEdges = Array.from({ length: model.receiver.length }, () => []);
  model.receiver.forEach((to, from) => { if (to >= 0) reversedEdges[to].push(from); });
  const expectedUpstream = new Set([initialUpstream.cell]), upstreamQueue = [initialUpstream.cell];
  for (let cursor = 0; cursor < upstreamQueue.length; cursor++) for (const from of reversedEdges[upstreamQueue[cursor]]) if (!expectedUpstream.has(from)) { expectedUpstream.add(from); upstreamQueue.push(from); }
  const upstreamRunoff = [...expectedUpstream].reduce((sum, i) => sum + model.localRunoff[i], 0);
  check('selected highlight is exactly the upstream contributor basin', initialUpstream.upstream.length === expectedUpstream.size && initialUpstream.upstream.every(i => expectedUpstream.has(i)));
  check('highlighted runoff sums to the selected discharge', Math.abs(upstreamRunoff - model.flow[initialUpstream.cell]) / upstreamRunoff < 1e-5, { upstreamRunoff, flow: model.flow[initialUpstream.cell] });
  check('inspector distinguishes upstream, hillslope and local contributions', /upstream channels/.test(await page.locator('#selected-formula').textContent()) && /hillslope drainage/.test(await page.locator('#selected-formula').textContent()));
  const canvasData = () => page.locator('#map').evaluate(canvas => canvas.toDataURL());
  await page.screenshot({ path: `${output}/design-desktop.png`, fullPage: true });
  for (const [id, kind] of [['headwaters', 1], ['tributary', 2], ['main', 3]]) {
    await page.locator(`#jump-${id}`).click(); await waitDraw();
    const selected = await page.evaluate(() => { const a = window.__riverNetworkDesign; return { cell: a.selectedCell, kind: a.model.channel[a.selectedCell], zoom: a.zoom, center: a.center, x: a.selectedCell % a.model.width, y: Math.floor(a.selectedCell / a.model.width) }; });
    check(`${id} jump focuses the expected channel class`, selected.kind === kind && Math.abs(selected.center.x - selected.x - .5) < .01 && Math.abs(selected.center.y - selected.y - .5) < .01, selected);
    await page.locator('#probe').click(); await waitDraw();
    const route = await page.evaluate(() => { const a = window.__riverNetworkDesign; return { path: a.probePath, valid: a.probePath.every(i => a.passable(i)), width: a.model.width }; });
    check(`${id} walking probe follows a contiguous traversable path`, route.path.length > 1 && route.valid && route.path.every((i, n) => !n || Math.abs(i % route.width - route.path[n - 1] % route.width) + Math.abs(Math.floor(i / route.width) - Math.floor(route.path[n - 1] / route.width)) === 1), { length: route.path.length, valid: route.valid });
    await page.locator('.playground').screenshot({ path: `${output}/design-${id}.png` });
    const withRoute = await canvasData(); await page.locator('#show-routes').uncheck(); await waitDraw();
    check(`${id} route toggle hides the drawn route`, withRoute !== await canvasData());
  }
  await page.locator('#jump-confluence').click(); await waitDraw();
  check('confluence jump selects an actual merging junction', await page.evaluate(() => { const a = window.__riverNetworkDesign; return [...a.model.receiver].filter((target, i) => target === a.selectedCell && a.model.channel[i]).length >= 2; }));
  for (const id of ['show-grid', 'show-crossings', 'show-catchment', 'show-flow']) {
    const before = await canvasData(), wasChecked = await page.locator(`#${id}`).isChecked();
    await page.locator(`#${id}`).setChecked(!wasChecked); await waitDraw();
    check(`${id} changes the rendered view`, before !== await canvasData());
    await page.locator(`#${id}`).setChecked(wasChecked); await waitDraw();
  }
  const natural = await canvasData(); await page.locator('#view').selectOption('network'); await waitDraw();
  check('channel-class diagnostic changes the map presentation', natural !== await canvasData());
  await page.screenshot({ path: `${output}/design-network.png` });
  await page.locator('#view').selectOption('natural'); await page.locator('#fit').click(); await waitDraw();
  const clickTarget = await page.evaluate(() => { const a = window.__riverNetworkDesign, r = document.querySelector('#map').getBoundingClientRect(); const cell = [...a.model.channel].findIndex((kind, i) => kind === 2 && i !== a.selectedCell); return { cell, x: r.x + r.width / 2 + (cell % a.model.width + .5 - a.center.x) * 16 * a.zoom, y: r.y + r.height / 2 + (Math.floor(cell / a.model.width) + .5 - a.center.y) * 16 * a.zoom }; });
  await page.mouse.click(clickTarget.x, clickTarget.y); await waitDraw();
  check('clicking an actual reach changes the selected inspector cell', await page.evaluate(() => window.__riverNetworkDesign.selectedCell) === clickTarget.cell);
  const box = await page.locator('#map').boundingBox(), beforePan = await page.evaluate(() => ({ ...window.__riverNetworkDesign.center }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up(); await waitDraw();
  check('drag pans the map', await page.evaluate(before => Math.abs(window.__riverNetworkDesign.center.x - before.x) > 1, beforePan));
  const beforeZoom = await page.evaluate(() => window.__riverNetworkDesign.zoom); await page.locator('#zoom-in').click(); await waitDraw();
  check('zoom-in changes scale', await page.evaluate(() => window.__riverNetworkDesign.zoom) > beforeZoom);
  await page.locator('#zoom-out').click(); await waitDraw();
  check('zoom-out reverses the scale change', Math.abs(await page.evaluate(() => window.__riverNetworkDesign.zoom) - beforeZoom) < 1e-7);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -100); await waitDraw();
  check('mouse wheel zoom works', await page.evaluate(() => window.__riverNetworkDesign.zoom) > beforeZoom);
  const setRange = async (id, key, value) => {
    await page.locator(id).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await page.waitForFunction(({ key, value }) => window.__riverNetworkDesign.model.parameters[key] === value, { key, value }); await waitDraw(); return snapshot();
  };
  const rainLow = await setRange('#rainfall', 'rainfall', .6), rainHigh = await setRange('#rainfall', 'rainfall', 1.6);
  check('rainfall increases real discharge and broad-water coverage', rainHigh.flow[rainHigh.mouth.cell] > rainLow.flow[rainLow.mouth.cell] * 2 && rainHigh.waterMask.reduce((s, wet) => s + wet, 0) > rainLow.waterMask.reduce((s, wet) => s + wet, 0), { lowQ: rainLow.flow[rainLow.mouth.cell], highQ: rainHigh.flow[rainHigh.mouth.cell] });
  await setRange('#rainfall', 'rainfall', 1);
  const densityLow = await setRange('#density', 'density', .6), densityHigh = await setRange('#density', 'density', 1.6), lowTopology = inspectNetwork(densityLow), highTopology = inspectNetwork(densityHigh);
  check('density adds merging feeders without creating runoff', highTopology.sources > lowTopology.sources && highTopology.junctions > lowTopology.junctions && Math.abs(densityHigh.flow[densityHigh.mouth.cell] - densityLow.flow[densityLow.mouth.cell]) < .01, { lowHeads: lowTopology.sources, highHeads: highTopology.sources });
  await setRange('#density', 'density', 1);
  const fordClose = await setRange('#ford-spacing', 'fordSpacing', 4), fordFar = await setRange('#ford-spacing', 'fordSpacing', 12);
  check('ford spacing changes actual crossing count', fordClose.crossings.filter(c => c.kind === 'ford').length > fordFar.crossings.filter(c => c.kind === 'ford').length, { close: fordClose.crossings.length, far: fordFar.crossings.length });
  await setRange('#ford-spacing', 'fordSpacing', 8);
  const seedShapes = [];
  for (const seed of ['ALDER', 'CROWN', 'SILVER']) {
    await page.locator('#seed').selectOption(seed); await page.waitForFunction(seed => window.__riverNetworkDesign.model.parameters.seed === seed, seed); await waitDraw();
    const m = await snapshot(), info = inspectNetwork(m); seedShapes.push(JSON.stringify(m.receiver));
    check(`${seed} preserves connected, conserving, branching drainage`, info.invalid === 0 && info.visited === info.count && info.maxRelativeError < 1e-5 && info.broken === 0 && info.junctions >= 8, { sources: info.sources, junctions: info.junctions, error: info.maxRelativeError });
    await page.locator('#show-catchment').uncheck(); await page.locator('#fit').click(); await waitDraw();
    await page.locator('.playground').screenshot({ path: `${output}/basin-${seed.toLowerCase()}.png` });
  }
  check('example watersheds have distinct drainage geometry', new Set(seedShapes).size === 3);
  await page.locator('#seed').selectOption('ALDER'); await page.locator('#show-catchment').check(); await waitDraw(); await page.locator('#fit').click(); await waitDraw();

  await page.screenshot({ path: `${output}/design-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true'); await waitDraw();
  check('fresh mobile load frames the entire basin', await page.evaluate(() => { const a = window.__riverNetworkDesign, r = document.querySelector('#map').getBoundingClientRect(); return a.model.width * 16 * a.zoom <= r.width + 1 && a.model.height * 16 * a.zoom <= r.height + 1; }));
  check('mobile has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/design-mobile.png`, fullPage: true });
  await page.locator('#jump-headwaters').click(); await waitDraw();
  check('mobile channel controls still focus a stream', await page.evaluate(() => { const a = window.__riverNetworkDesign; return a.model.channel[a.selectedCell] === 1; }));
  await page.locator('.playground').screenshot({ path: `${output}/design-mobile-detail.png` });
  check('standalone requests no online resources', network.length === 0, network);
  check('browser reports no runtime errors', errors.length === 0, errors);
} finally {
  await writeFile(`${output}/design-checks.json`, JSON.stringify({ checks, errors, network }, null, 2));
  console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length, errors, network }, null, 2));
  await browser.close();
}
