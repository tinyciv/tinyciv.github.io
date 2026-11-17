import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));

/** Asset review for the opt-in startup capture. The review document never loads
 * the game, advances its state, or changes the startup check's existing page. */
export async function captureRuntimeArtReview(browser, origin) {
  const startupPages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith(origin));
  const resources = (await Promise.all(startupPages.map(page => page.evaluate(() =>
    performance.getEntriesByType('resource').map(entry => ({
      url: entry.name, type: entry.initiatorType, encodedBytes: entry.encodedBodySize,
      decodedBytes: entry.decodedBodySize, transferredBytes: entry.transferSize,
    })))))).flat();
  const startupArtwork = resources.filter(entry => /\/assets\/.+\.(png|webp|svg)(?:\?|$)/i.test(entry.url));
  const [manifest, game, relief, icons, surfaces, cells, palettes] = await Promise.all([
    'tools/runtime-art/manifest.json', 'tools/runtime-art/game.json', 'tools/runtime-art/relief.json',
    'tools/runtime-art/ui-icons.json', 'tools/runtime-art/ui-surfaces.json',
    'src/game/relief-shapes.json', 'src/game/relief-palettes.json',
  ].map(readJson));
  const profiles = [...game, ...relief, ...icons, ...surfaces];
  const configured = new Map(profiles.map(profile => [profile.output, profile]));
  const unchanged = manifest.files.filter(entry => entry.sourceSize[0] === entry.size[0]
    && entry.sourceSize[1] === entry.size[1] && !configured.get(entry.output)?.transform
    && !configured.get(entry.output)?.crop);
  const selected = [
    'resources/food', 'resources/gold', 'resources/population', 'resources/culture',
    'research/forged/irrigation', 'research/forged/woodenTower', 'military-academy',
    'thermal-bath', 'naval/caravel', 'naval/anchor',
    'forged/retinue-actions-pixel', 'forged/action-symbols-pixel', 'forged/action-symbols',
    'forged/panel-frame-hud', 'forged/minimap-frame', 'main-menu/title', 'main-menu/button',
  ];
  const ui = selected.map(name => {
    const profile = [...icons, ...surfaces].find(entry => entry.output.replace(/\.(png|webp)$/, '') === `assets/runtime/ui/${name}`);
    if (!profile) throw new Error(`Missing runtime artwork review profile: ${name}`);
    const presentation = { width: 48, height: 48, rendering: 'pixelated' };
    if (name.startsWith('resources/')) Object.assign(presentation, { width: 28, height: 28, rendering: 'auto' });
    if (name.startsWith('research/')) Object.assign(presentation, { width: 40, height: 40 });
    if (name === 'thermal-bath') Object.assign(presentation, { width: 96, height: 96 });
    if (name === 'naval/anchor') Object.assign(presentation, { width: 32, height: 32 });
    if (name === 'naval/caravel') Object.assign(presentation, { width: 72, height: 72 });
    if (name === 'forged/retinue-actions-pixel') Object.assign(presentation, { width: 40, height: 40, backgroundSize: '200% 100%' });
    if (name === 'forged/action-symbols-pixel') Object.assign(presentation, { width: 46, height: 46, backgroundSize: '300% 100%' });
    if (name === 'forged/action-symbols') Object.assign(presentation, { width: 46, height: 46, backgroundSize: '200% 200%', rendering: 'auto' });
    if (name === 'forged/panel-frame-hud') Object.assign(presentation, { width: 250, height: 130, rendering: 'auto' });
    if (name === 'forged/minimap-frame') Object.assign(presentation, { width: 274, height: 274, rendering: 'auto' });
    if (name === 'main-menu/title') Object.assign(presentation, { width: 420, height: 115, rendering: 'auto' });
    if (name === 'main-menu/button') Object.assign(presentation, { width: 220, height: 56, rendering: 'auto' });
    const entry = manifest.files.find(entry => entry.output === profile.output);
    return { ...profile, ...presentation, name, sourceBytes: entry?.sourceBytes, bytes: entry?.bytes };
  });
  const reviewUrl = new URL('/__runtime-art-review', origin).href;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:PixelOperator;src:url('/assets/fonts/pixel-operator/PixelOperator.ttf')}
*{box-sizing:border-box}body{margin:0;padding:24px;width:1488px;background:#10191b;color:#eadfbd;font:18px/1.3 PixelOperator,monospace}
h1{margin:0 0 8px;font-size:30px}h2{font-size:24px;margin:22px 0 10px}p{margin:6px 0 12px;color:#b8c2af}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.card{padding:12px;background:#1d292b;border:1px solid #546251;min-width:0}
.card.wide{grid-column:span 2}.card strong{display:block;margin-bottom:3px;font-weight:400;font-size:18px}.meta{color:#aebca7;font-size:15px;margin-bottom:8px}
.pair{display:flex;gap:16px;align-items:flex-start}.variant{margin:0;min-width:0}.variant figcaption{margin-bottom:6px;font-size:15px;color:#cabd93}
.sample{display:block;background:#1d292b;object-fit:contain}.native{image-rendering:pixelated}.metric{font-size:14px;color:#c4d09d;margin-top:6px}
#summary{padding:12px 16px;background:#26362c;border:1px solid #7c9369}#summary.failure{background:#452b28}
</style></head><body><h1>Runtime artwork — original / optimized</h1><div id="summary">Comparing decoded native pixels…</div>
<h2>UI at its displayed size</h2><p>Original and optimized use the same CSS dimensions and image-rendering. Resized UI is measured, not treated as pixel-equivalent.</p><div class="grid" id="ui"></div>
<h2>Native game art</h2><p>Original runtime rasterization and optimized atlas extraction, displayed at 3× native pixels.</p><div class="grid" id="native"></div></body></html>`;
  const pages = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1488, height: 1100 }, deviceScaleFactor: 1 });
    pages.push(page);
    await page.route(reviewUrl, route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(reviewUrl, { waitUntil: 'domcontentloaded' });
    const report = await page.evaluate(async ({ manifest, unchanged, profiles, cells, palettes, ui }) => {
      const url = source => new URL(`/${source}`, location.href).href;
      const load = async source => { const image = new Image(); image.src = url(source); await image.decode(); return image; };
      const canvas = (width, height) => { const out = document.createElement('canvas'); out.width = width; out.height = height; return out; };
      const context = out => out.getContext('2d', { willReadFrequently: true });
      const pixels = out => context(out).getImageData(0, 0, out.width, out.height).data;
      const crop = (image, sx = 0, sy = 0, sw = image.width, sh = image.height, width = sw, height = sh) => {
        const out = canvas(width, height), c = context(out); c.imageSmoothingEnabled = false;
        c.drawImage(image, sx, sy, sw, sh, 0, 0, width, height); return out;
      };
      const diff = (a, b) => {
        if (a.length !== b.length) return { mismatchPixels: Math.max(a.length, b.length) / 4, maxChannelError: 255 };
        let mismatchPixels = 0, maxChannelError = 0;
        for (let i = 0; i < a.length; i += 4) {
          let changed = false;
          for (let c = 0; c < 4; c++) {
            const error = Math.abs((c < 3 && !a[i + 3] ? 0 : a[i + c]) - (c < 3 && !b[i + 3] ? 0 : b[i + c]));
            changed ||= error !== 0; maxChannelError = Math.max(maxChannelError, error);
          }
          mismatchPixels += Number(changed);
        }
        return { mismatchPixels, maxChannelError };
      };
      const cutoff = (out, threshold) => {
        const c = context(out), data = c.getImageData(0, 0, out.width, out.height);
        for (let i = 3; i < data.data.length; i += 4) data.data[i] = data.data[i] >= threshold ? 255 : 0;
        c.putImageData(data, 0, 0); return out;
      };
      const levels = { surface: [46, 72, 97, 123, 151, 185], rock: [43, 75, 109, 144, 180, 220] };
      const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const ramps = Object.fromEntries(Object.entries(palettes).filter(([, p]) => p.surface).map(([name, p]) =>
        [name, { surface: p.surface.map(rgb), rock: p.rock.map(rgb) }]));
      const paletteNames = ['grassland', ...Object.keys(ramps)];
      const recolor = (input, palette, ore) => {
        const out = crop(input), c = context(out), image = c.getImageData(0, 0, out.width, out.height), d = image.data;
        if (palette === 'grassland') return out;
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2], surface = g > r + 4 && g > b * 1.16;
          const mineral = !surface && (r > g * 1.13 && g > b * 1.2 || g > b * 1.65 && r > g
            || b > r * 1.08 && g > r * 1.025 || g > r * 1.1 && b > r * 1.1);
          if (ore && mineral) continue;
          const material = surface ? 'surface' : 'rock', light = r * .2126 + g * .7152 + b * .0722;
          let shade = 0;
          for (let n = 1; n < 6; n++) if (Math.abs(light - levels[material][n]) < Math.abs(light - levels[material][shade])) shade = n;
          [d[i], d[i + 1], d[i + 2]] = ramps[palette][material][shade];
        }
        c.putImageData(image, 0, 0); return out;
      };
      const failures = [], summary = { genericImages: 0, oreFrames: 0, reliefFrames: 0, paletteComparisons: 0 };
      const samples = [];
      const exact = (label, before, after) => {
        const result = diff(pixels(before), pixels(after));
        if (before.width !== after.width || before.height !== after.height || result.mismatchPixels) failures.push({ label, ...result });
      };
      // Decode in small batches, releasing large source images between batches.
      for (let offset = 0; offset < unchanged.length; offset += 4) {
        await Promise.all(unchanged.slice(offset, offset + 4).map(async entry => {
          const [before, after] = await Promise.all([load(entry.source), load(entry.output)]);
          exact(entry.source, crop(before), crop(after)); summary.genericImages++;
        }));
      }
      for (const profile of profiles.filter(profile => profile.transform === 'ore-atlas')) {
        const [image, atlas] = await Promise.all([load(profile.source), load(profile.output)]);
        const source = pixels(crop(image)), [w, h] = [[16, 16], [32, 32], [48, 32]][profile.family];
        if (atlas.width !== w * 3 || atlas.height !== h * 2) failures.push({ label: profile.output, error: 'Wrong atlas dimensions' });
        for (let slot = 0; slot < 6; slot++) {
          const sx = Math.round(slot % 3 * image.width / 3), sy = Math.round(Math.floor(slot / 3) * image.height / 2);
          const ex = Math.round((slot % 3 + 1) * image.width / 3), ey = Math.round((Math.floor(slot / 3) + 1) * image.height / 2);
          let x = ex, y = ey, right = sx, bottom = sy;
          for (let yy = sy; yy < ey; yy++) for (let xx = sx; xx < ex; xx++) if (source[(yy * image.width + xx) * 4 + 3] >= 224) {
            x = Math.min(x, xx); y = Math.min(y, yy); right = Math.max(right, xx); bottom = Math.max(bottom, yy);
          }
          if (x > right) throw new Error(`Empty original ore sprite: ${profile.family}:${slot}`);
          const before = canvas(w, h), c = context(before); c.imageSmoothingEnabled = false;
          const sw = right - x + 1, sh = bottom - y + 1, width = Math.min(w - 2, (h - 2) * sw / sh), height = Math.round(width * sh / sw);
          c.drawImage(image, x, y, sw, sh, Math.round((w - width) / 2), h - 1 - height, Math.round(width), height);
          cutoff(before, 224);
          const after = crop(atlas, slot % 3 * w, Math.floor(slot / 3) * h, w, h);
          for (const palette of paletteNames) {
            exact(`ore:${profile.family}:${slot}:${palette}`, recolor(before, palette, true), recolor(after, palette, true));
            summary.paletteComparisons++;
          }
          summary.oreFrames++;
          if (slot === 0) samples.push({ name: `Ore family ${profile.family + 1}`, before: before.toDataURL(), after: after.toDataURL(), width: w, height: h });
        }
      }
      for (const profile of profiles.filter(profile => profile.transform === 'relief-atlas')) {
        const [image, atlas] = await Promise.all([load(profile.source), load(profile.output)]);
        let top = 0;
        for (let slot = 0; slot < cells[profile.style].length; slot++) {
          const cell = cells[profile.style][slot], w = cell.nativeWidth ?? [32, 48, 64][profile.style];
          const h = Math.max(2, Math.round(w * cell.height / cell.width));
          const before = cutoff(crop(image, cell.x, cell.y, cell.width, cell.height, w, h), 192);
          const after = crop(atlas, 0, top, w, h); top += h;
          for (const palette of paletteNames) {
            exact(`relief:${profile.style}:${slot}:${palette}`, recolor(before, palette, false), recolor(after, palette, false));
            summary.paletteComparisons++;
          }
          summary.reliefFrames++;
          if (slot === 0 && [3, 5, 7].includes(profile.style)) samples.push({ name: `Relief style ${profile.style}`, before: before.toDataURL(), after: after.toDataURL(), width: w, height: h });
        }
        if (top !== atlas.height) failures.push({ label: profile.output, error: 'Wrong relief atlas height' });
      }
      const card = (name, meta, before, after, width, height, rendering, backgroundSize, target, id) => {
        const element = document.createElement('article'); element.className = `card${width > 190 ? ' wide' : ''}`;
        const title = document.createElement('strong'); title.textContent = name;
        const details = document.createElement('div'); details.className = 'meta'; details.textContent = meta;
        element.append(title, details);
        const pair = document.createElement('div'); pair.className = 'pair';
        for (const [label, src] of [['Original', before], ['Optimized', after]]) {
          const figure = document.createElement('figure'); figure.className = 'variant';
          const caption = document.createElement('figcaption'); caption.textContent = label;
          const image = backgroundSize ? document.createElement('div') : new Image(); image.className = 'sample';
          image.style.width = `${width}px`; image.style.height = `${height}px`; image.style.imageRendering = rendering;
          if (backgroundSize) Object.assign(image.style, { backgroundImage: `url("${src}")`, backgroundSize, backgroundRepeat: 'no-repeat' });
          else image.src = src;
          if (id !== undefined) { image.dataset.compare = String(id); image.dataset.variant = label; }
          figure.append(caption, image); pair.append(figure);
        }
        element.append(pair); target.append(element);
      };
      for (const [index, item] of ui.entries()) card(item.name,
        `${item.width}×${item.height} CSS px · ${item.rendering} · ${Math.round(item.sourceBytes / 1024)} → ${Math.round(item.bytes / 1024)} KB`,
        url(item.source), url(item.output), item.width, item.height, item.rendering, item.backgroundSize, document.querySelector('#ui'), index);
      for (const sample of samples) card(sample.name, `${sample.width}×${sample.height} native px · exact comparison`, sample.before, sample.after,
        sample.width * 3, sample.height * 3, 'pixelated', undefined, document.querySelector('#native'));
      const result = document.querySelector('#summary');
      result.classList.toggle('failure', failures.length > 0);
      result.textContent = `${summary.genericImages} unchanged-size images · ${summary.oreFrames} ore frames · ${summary.reliefFrames} relief frames · ${summary.paletteComparisons} palette comparisons · ${failures.length} exact-pixel failures`;
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      // Background images must finish decoding too before the screenshot.
      await Promise.all(ui.map(item => Promise.all([load(item.source), load(item.output)])));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { summary, failures, sampleCount: samples.length, ui: ui.map(item => ({ name: item.name, width: item.width, height: item.height, rendering: item.rendering })),
        reviewBody: document.body.innerHTML };
    }, { manifest, unchanged, profiles, cells, palettes, ui });
    const metrics = async (target, screenshot, dpr) => target.evaluate(async ({ data, dpr }) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d', { willReadFrequently: true }); c.drawImage(image, 0, 0);
      const results = [];
      for (const before of document.querySelectorAll('[data-variant="Original"][data-compare]')) {
        const after = document.querySelector(`[data-variant="Optimized"][data-compare="${before.dataset.compare}"]`);
        const a = before.getBoundingClientRect(), b = after.getBoundingClientRect();
        const w = Math.round(a.width * dpr), h = Math.round(a.height * dpr);
        const p = c.getImageData(Math.round(a.x * dpr), Math.round((a.y + scrollY) * dpr), w, h).data;
        const q = c.getImageData(Math.round(b.x * dpr), Math.round((b.y + scrollY) * dpr), w, h).data;
        let changed = 0, total = 0, square = 0, max = 0;
        for (let i = 0; i < p.length; i += 4) {
          let pixelChanged = false;
          for (let channel = 0; channel < 3; channel++) {
            const error = Math.abs(p[i + channel] - q[i + channel]); total += error; square += error * error;
            max = Math.max(max, error); pixelChanged ||= error > 1;
          }
          changed += Number(pixelChanged);
        }
        const mae = total / (w * h * 3), mse = square / (w * h * 3);
        results.push({ index: Number(before.dataset.compare), dpr, changedPixelsPercent: changed / (w * h) * 100,
          meanAbsoluteRgbError: mae, normalizedMeanAbsoluteRgbErrorPercent: mae / 255 * 100,
          maxChannelError: max, psnrDb: mse ? 10 * Math.log10(255 * 255 / mse) : null });
      }
      return results;
    }, { data: screenshot.toString('base64'), dpr });
    await mkdir(path.join(root, 'output/startup'), { recursive: true });
    const screenshot = await page.screenshot({ path: path.join(root, 'output/startup/runtime-art.png'), fullPage: true });
    await page.screenshot({ path: path.join(root, 'output/startup/runtime-art-preview.png'),
      clip: { x: 0, y: 0, width: 1480, height: 740 } });
    const at1x = await metrics(page, screenshot, 1);
    const highDensity = await browser.newPage({ viewport: { width: 1488, height: 1100 }, deviceScaleFactor: 2 });
    pages.push(highDensity);
    await highDensity.route(reviewUrl, route => route.fulfill({ contentType: 'text/html', body: html }));
    await highDensity.goto(reviewUrl, { waitUntil: 'domcontentloaded' });
    await highDensity.evaluate(async body => {
      document.body.innerHTML = body; await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      const backgrounds = [...document.querySelectorAll('.sample')].map(element => getComputedStyle(element).backgroundImage).filter(value => value.startsWith('url('));
      await Promise.all(backgrounds.map(async source => { const image = new Image(); image.src = source.slice(5, -2); await image.decode(); }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, report.reviewBody);
    const screenshot2x = await highDensity.screenshot({ path: path.join(root, 'output/startup/runtime-art-2x.png'), fullPage: true });
    const at2x = await metrics(highDensity, screenshot2x, 2);
    delete report.reviewBody;
    report.startup = {
      artworkRequests: startupArtwork.length,
      artworkEncodedBytes: startupArtwork.reduce((sum, entry) => sum + entry.encodedBytes, 0),
      artworkTransferredBytes: startupArtwork.reduce((sum, entry) => sum + entry.transferredBytes, 0),
      resources,
      note: 'Observed on the startup page before static artwork review. JavaScript is served by Vite without production bundling; artwork byte counts reflect actual requested files.',
    };
    report.ui = report.ui.map((item, index) => ({ ...item, measurements: [...at1x, ...at2x].filter(metric => metric.index === index) }));
    report.note = 'Only native game rasters and unchanged-size derivatives are required to match exactly. UI resize measurements compare actual CSS-rendered screenshots at device pixel ratios 1 and 2; changed pixels do not by themselves establish a visible regression.';
    await writeFile(path.join(root, 'output/startup/runtime-art.json'), JSON.stringify(report, null, 2) + '\n');
    if (report.failures.length) throw new Error(`Runtime artwork changed native pixels: ${JSON.stringify(report.failures.slice(0, 8))}; see output/startup/runtime-art.json`);
    console.log(`PASS runtime artwork: ${report.summary.genericImages} unchanged-size images, ${report.summary.oreFrames} ore frames, ${report.summary.reliefFrames} relief frames, ${report.summary.paletteComparisons} palette comparisons`);
    return report;
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
}
