import { describe, expect, it } from 'vitest';
import { createRiverDesignModel, type RiverDesignModel } from './model';

// Measure the receiver geometry rather than its drawing or construction knobs.
// Sampling every third cell suppresses raster stair-step noise; the lateral
// departure requirement rejects a diagonal line masquerading as a bend.
function reachShapes(model: RiverDesignModel, kind: number, steps: number) {
  const parents: number[][] = Array.from({ length: model.receiver.length }, () => []);
  model.receiver.forEach((next, cell) => { if (next >= 0 && model.channel[cell]) parents[next].push(cell); });
  const xy = (cell: number) => ({ x: cell % model.width, y: Math.floor(cell / model.width) });
  const shapes: { lateral: number; sinuosity: number }[] = [];
  for (let cell = 0; cell < model.channel.length; cell++) {
    if (model.channel[cell] !== kind) continue;
    const path = [cell]; let at = cell;
    while (path.length <= steps) {
      const next = model.receiver[at];
      // A tributary's entry angle is not evidence of a bend in the main stem.
      if (next < 0 || model.channel[next] !== kind || parents[next].some(p => model.flow[p] > model.flow[at])) break;
      path.push(next); at = next;
    }
    if (path.length !== steps + 1) continue;
    const a = xy(cell), b = xy(at), dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
    let lateral = 0, length = 0;
    for (let n = 0; n < path.length; n++) {
      const p = xy(path[n]);
      lateral = Math.max(lateral, Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / chord);
      if (n && n % 3 === 0) { const previous = xy(path[n - 3]); length += Math.hypot(p.x - previous.x, p.y - previous.y); }
    }
    shapes.push({ lateral, sinuosity: length / chord });
  }
  return shapes;
}

describe('interactive tributary design model', () => {
  it.each(['ALDER', 'CROWN', 'SILVER'])('mixes real bends with quiet connectors in every channel class in %s', seed => {
    const model = createRiverDesignModel({ seed });
    for (const kind of [1, 2, 3]) {
      const long = reachShapes(model, kind, 12), short = reachShapes(model, kind, 6);
      const bends = long.filter(shape => shape.lateral >= 1.8 && shape.sinuosity >= 1.1);
      const quiet = short.filter(shape => shape.lateral <= .6 && shape.sinuosity <= 1.035);
      expect(bends.length, `class ${kind} needs visible bends`).toBeGreaterThan(0);
      expect(quiet.length, `class ${kind} needs straighter connectors`).toBeGreaterThan(0);
      if (kind > 1) expect(bends.length / long.length, `class ${kind} must not be mostly ruler-straight`).toBeGreaterThan(.2);
    }
  });

  it('keeps winding networks connected, noncrossing and conservative throughout the review controls', () => {
    for (const seed of ['ALDER', 'CROWN', 'SILVER']) for (const density of [.6, 1, 1.6]) for (const rainfall of [.6, 1, 1.6]) {
      const model = createRiverDesignModel({ seed, density, rainfall }), count = model.receiver.length;
      const incoming = new Int32Array(count), runoff = Float64Array.from(model.localRunoff);
      let badEdges = 0, crossedChannels = 0;
      for (let cell = 0; cell < count; cell++) {
        const next = model.receiver[cell]; if (next < 0) continue;
        incoming[next]++;
        const x = cell % model.width, y = Math.floor(cell / model.width), nx = next % model.width, ny = Math.floor(next / model.width);
        if (next === cell || Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1 || model.elevation[cell] <= model.elevation[next]) badEdges++;
        if (!model.channel[cell]) continue;
        if (!model.channel[next]) badEdges++;
        if (x !== nx && y !== ny) {
          const a = y * model.width + nx, b = ny * model.width + x;
          if (model.channel[a] && model.channel[b] && (model.receiver[a] === b || model.receiver[b] === a)) crossedChannels++;
        }
      }
      const queue = Array.from(incoming).flatMap((degree, cell) => degree ? [] : [cell]);
      for (let n = 0; n < queue.length; n++) {
        const cell = queue[n], next = model.receiver[cell];
        if (next >= 0) { runoff[next] += runoff[cell]; if (--incoming[next] === 0) queue.push(next); }
      }
      expect({ badEdges, crossedChannels, visited: queue.length }).toEqual({ badEdges: 0, crossedChannels: 0, visited: count });
      expect(runoff[model.mouth.cell]).toBeCloseTo(model.localRunoff.reduce((total, rain) => total + rain, 0), 7);
      expect(model.sources.every(source => model.channel[source.cell] === 1 && !model.waterMask[source.cell])).toBe(true);
      for (const crossing of model.crossings.filter(crossing => crossing.kind === 'ford')) {
        expect(crossing.banks.every(bank => !model.waterMask[bank.cell])).toBe(true);
        expect(crossing.cells.every(cell => model.waterMask[cell] && model.fordMask[cell])).toBe(true);
        expect(crossing.cells.every(cell => model.channel[cell] !== 3 || model.widthTiles[cell] <= 2.5 && crossing.cells.length <= 3)).toBe(true);
      }
    }
  });

  it('builds a deterministic, merging watershed and conserves local runoff at every receiver', () => {
    const model = createRiverDesignModel(), again = createRiverDesignModel();
    expect(model).toEqual(again);
    expect(model.diagnostics.heads).toBeGreaterThanOrEqual(20);
    expect(model.diagnostics.heads).toBeLessThanOrEqual(40);
    expect(model.diagnostics.confluences).toBeGreaterThanOrEqual(20);
    const sum = Float64Array.from(model.localRunoff), indegree = new Int32Array(model.receiver.length);
    model.receiver.forEach(next => { if (next >= 0) indegree[next]++; });
    const queue = Array.from(indegree).flatMap((n, cell) => n ? [] : [cell]);
    for (let n = 0; n < queue.length; n++) {
      const cell = queue[n], next = model.receiver[cell];
      expect(model.flow[cell]).toBeCloseTo(sum[cell], 2);
      if (next >= 0) {
        expect(model.elevation[cell]).toBeGreaterThan(model.elevation[next]);
        sum[next] += sum[cell]; if (--indegree[next] === 0) queue.push(next);
      }
    }
    expect(queue).toHaveLength(model.receiver.length);
    expect(sum[model.mouth.cell]).toBeCloseTo(model.diagnostics.inputFlow, 7);
    for (const source of model.sources) {
      expect(model.channel[source.cell]).toBe(1);
      expect(model.flow[source.cell]).toBe(model.localRunoff[source.cell]);
      let cell = source.cell, steps = 0;
      while (model.receiver[cell] >= 0) {
        const next = model.receiver[cell];
        expect(model.channel[next]).toBeGreaterThanOrEqual(model.channel[cell]);
        expect(model.widthTiles[next] + 1e-7).toBeGreaterThanOrEqual(model.widthTiles[cell]);
        cell = next; expect(++steps).toBeLessThan(model.receiver.length);
      }
      expect(cell).toBe(model.mouth.cell);
    }
  });

  it('separates crossable ribbons, exact one-cell rivers and substantial main channels', () => {
    const m = createRiverDesignModel();
    for (let cell = 0; cell < m.channel.length; cell++) {
      if (m.channel[cell] === 1) {
        expect(m.widthTiles[cell]).toBeGreaterThanOrEqual(.125);
        expect(m.widthTiles[cell]).toBeLessThan(.4375);
      } else if (m.channel[cell] === 2) {
        expect(m.widthTiles[cell]).toBe(1);
        expect(m.waterMask[cell]).toBe(1);
      } else if (m.channel[cell] === 3) {
        expect(m.widthTiles[cell]).toBeGreaterThanOrEqual(2);
        expect(m.widthTiles[cell]).toBeLessThanOrEqual(5);
        expect(m.waterMask[cell]).toBe(1);
      }
    }
    expect(m.diagnostics.classCounts.slice(1).every(n => n > 50)).toBe(true);
    expect(m.widthTiles[m.mouth.cell]).toBe(5);
    expect(m.crossings.some(c => c.kind === 'stream' && !m.waterMask[c.cell])).toBe(true);
  });

  it('changes branch density without creating water, and rain increases discharge and width', () => {
    const sparse = createRiverDesignModel({ density: .4 }), dense = createRiverDesignModel({ density: 2 });
    expect(dense.diagnostics.heads).toBeGreaterThan(sparse.diagnostics.heads);
    expect(dense.localRunoff).toEqual(sparse.localRunoff);
    expect(dense.diagnostics.mouthFlow).toBe(sparse.diagnostics.mouthFlow);
    const dry = createRiverDesignModel({ rainfall: .4 }), wet = createRiverDesignModel({ rainfall: 1.6 });
    expect(dry.receiver).toEqual(wet.receiver);
    expect(wet.diagnostics.mouthFlow / dry.diagnostics.mouthFlow).toBeCloseTo(4, 5);
    for (const model of [sparse, dense, dry, wet, createRiverDesignModel({ rainfall: 2.5 })])
      for (const source of model.sources) expect(model.channel[source.cell]).toBe(1);
    for (let cell = 0; cell < wet.flow.length; cell++) {
      expect(wet.flow[cell]).toBeGreaterThanOrEqual(dry.flow[cell]);
      expect(wet.widthTiles[cell]).toBeGreaterThanOrEqual(dry.widthTiles[cell]);
    }
  });

  it('places complete bank-to-bank crossings and measures ford intervals along individual reaches', () => {
    const frequent = createRiverDesignModel({ fordSpacing: 6 }), sparse = createRiverDesignModel({ fordSpacing: 14 });
    expect(frequent.receiver).toEqual(sparse.receiver);
    expect(frequent.diagnostics.fordCount).toBeGreaterThan(sparse.diagnostics.fordCount);
    expect(frequent.diagnostics.fordGaps).toBe(0);
    expect(frequent.diagnostics.longestFordGap).toBeLessThanOrEqual(9);
    for (const ford of frequent.crossings.filter(c => c.kind === 'ford')) {
      for (const wet of ford.cells) if (frequent.channel[wet] === 3) {
        expect(frequent.widthTiles[wet]).toBeLessThanOrEqual(2.5);
        expect(ford.cells.length).toBeLessThanOrEqual(3);
      }
      expect(ford.banks.every(p => !frequent.waterMask[p.cell])).toBe(true);
      expect(ford.cells.every(cell => frequent.waterMask[cell] && frequent.fordMask[cell])).toBe(true);
      const step = ford.axis === 'horizontal' ? 1 : frequent.width;
      const first = Math.min(...ford.cells), last = Math.max(...ford.cells);
      for (let cell = first; cell <= last; cell += step) expect(frequent.fordMask[cell]).toBe(1);
      expect(frequent.waterMask[first - step]).toBe(0);
      expect(frequent.waterMask[last + step]).toBe(0);
    }
  });
});
