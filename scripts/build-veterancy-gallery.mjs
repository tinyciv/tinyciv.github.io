import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd(), out = resolve(root, 'scratch/2026-10-31-veterancy-bolts');
const files = ['overworld.png', 'desert-ledges.png', ...['Warrior-Blue.png', 'Archer-Green.png', 'Scout.png', 'Human-Soldier-Cyan.png', 'Human-Worker-Cyan.png', 'Orc-Grunt.png'].map(file => `characters/${file}`)];
const assets = Object.fromEntries(await Promise.all(files.map(async file => [file, `data:image/png;base64,${(await readFile(resolve(root, 'public/assets/puny-world', file))).toString('base64')}`])));
const script = `
import { THUNDERBOLT_VARIANTS, DEFAULT_THUNDERBOLT, drawThunderbolt, drawRankMarker } from './src/game/veterancy-art.ts';
import { loadPunyCharacters, drawPerson } from './src/game/unit-sprites.ts';
import { loadPunyWorld, drawPuny } from './src/game/puny-world.ts';
let choice = DEFAULT_THUNDERBOLT, moving = false, sand = false, animationFrame = 0;
const names = ['Untrained', 'Regular', 'Veteran', 'Hardened', 'Elite'];
const kills = [0, 10, 100, 250, 500];
const css = (id) => document.getElementById(id);
const cards = css('options');
const activeStyle = THUNDERBOLT_VARIANTS.find(option => option.id === choice);
css('current-style').textContent = choice + ' · ' + activeStyle.name + ' is the current in-game style';
css('chosen').textContent = choice + ' · ' + activeStyle.name;
for (const option of THUNDERBOLT_VARIANTS) {
  const button = document.createElement('button'); button.className = 'option'; button.type = 'button'; button.dataset.variant = option.id;
  button.setAttribute('aria-pressed', String(option.id === choice));
  button.innerHTML = '<div class="option-title"><strong>' + option.id + ' <span>' + option.name + '</span></strong><small>' + (option.id === DEFAULT_THUNDERBOLT ? 'In game' : 'Preview') + '</small></div><canvas width="360" height="178" aria-label="' + option.name + ' beside native game units"></canvas><p>' + option.description + '</p>';
  button.onclick = () => { choice = option.id; document.querySelectorAll('.option').forEach(card => card.setAttribute('aria-pressed', String(card.dataset.variant === choice))); css('chosen').textContent = option.id + ' · ' + option.name; render(performance.now()); };
  cards.append(button);
}
css('animate').onchange = e => { moving = e.target.checked; render(performance.now()); };
css('sand').onchange = e => { sand = e.target.checked; render(performance.now()); };
css('zoom').oninput = e => { css('zoom-value').textContent = Number(e.target.value).toFixed(1) + '×'; render(performance.now()); };
function ground(c, w, h, sandy = sand) {
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) {
    const variant = (x / 32 * 7 + y / 32 * 3) % 9;
    drawPuny(c, sandy ? 23 * 16 : variant % 3 * 16, sandy ? 16 : Math.floor(variant / 3) * 16, 16, 16, x, y, 32, 32);
  }
}
function person(c, x, y, size, rank, time, variant = choice, hurt = false, hold = false, role = 'warrior', facing = Math.PI / 2) {
  const unit = { id: rank + Math.floor(x), kind: role, hp: hurt ? 63 : 100, maxHp: 100, kills: kills[rank], facing, attackTime: 0, moving: moving && !hold, order: hold ? 'hold' : 'follow' };
  c.save(); c.translate(x, y); c.scale(size / 32, size / 32); drawPerson(c, unit, time, '#e84d4d'); c.restore();
  drawRankMarker(c, rank, x, y, size, variant);
  if (hurt) {
    const top = y - size * .035, width = size * .72;
    c.fillStyle = '#354e39'; c.fillRect(x + size * .5 - width / 2 - 1, top - 1, width + 2, 5);
    for (let i = 0; i < 5; i++) { c.fillStyle = i < 3 ? '#c4d78a' : '#5a6651'; c.fillRect(x + size * .5 - width / 2 + i * width / 5, top, width / 5 - 1, 3); }
  }
  if (hold) { c.fillStyle = '#fff0ba'; c.fillRect(x + size * .04, y + size * .24, 3, 8); c.fillRect(x + size * .16, y + size * .24, 3, 8); }
}
function label(c, text, x, y, color = '#f4ecd5', size = 13) { c.font = size + 'px system-ui'; c.fillStyle = color; c.textAlign = 'center'; c.fillText(text, x, y); }
function render(now) {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  if (!window.__ready) return;
  const time = now / 1000;
  for (const button of cards.children) {
    const canvas = button.querySelector('canvas'), c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height); ground(c, 360, 178);
    c.fillStyle = '#0a111cd9'; c.fillRect(0, 0, 126, 178);
    const variant = THUNDERBOLT_VARIANTS.find(option => option.id === button.dataset.variant);
    const iconW = Math.max(...variant.pixels.map(row => row.length)), iconH = variant.pixels.length;
    drawThunderbolt(c, (126 - iconW * 5) / 2, 30 + (14 - iconH) * 2.5, 5, variant.id);
    label(c, '5× detail', 63, 145, '#baa981', 12);
    person(c, 155, 56, 64, 4, time, variant.id, false, false, 'warrior');
    person(c, 260, 56, 64, 4, time, variant.id, true, true, 'leader');
    c.fillStyle = '#0a111cbd'; c.fillRect(126, 138, 234, 40);
    label(c, 'Warrior', 187, 162); label(c, 'Leader · Hold', 292, 162);
  }
  const lineup = css('lineup'), lc = lineup.getContext('2d'); lc.clearRect(0, 0, lineup.width, lineup.height); ground(lc, lineup.width, lineup.height);
  for (let i = 0; i < 5; i++) {
    const center = 110 + i * 215; person(lc, center - 32, 46, 64, i, time, choice, i > 0, i === 2 || i === 4);
    lc.fillStyle = '#101816dc'; lc.fillRect(center - 92, 128, 184, 61);
    label(lc, names[i], center, 151, '#fff3cd', 17); label(lc, i ? kills[i] + ' kills' : '0–9 kills', center, 173, '#d5c7a6', 13);
  }
  const crowd = css('crowd'), c = crowd.getContext('2d'); c.clearRect(0, 0, crowd.width, crowd.height); ground(c, crowd.width, crowd.height);
  const scale = Number(css('zoom').value), size = 32 * scale;
  const units = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 10; column++) units.push({ x: 90 + column * 87 + (row % 2) * 24, y: 47 + row * 77, rank: (row * 3 + column) % 5, row, column });
  for (const unit of units) person(c, unit.x - size / 2, unit.y, size, unit.rank, time, choice, unit.column % 3 === 1, unit.column % 4 === 0, unit.column % 5 === 0 ? 'leader' : unit.column % 3 === 0 ? 'archer' : 'warrior', Math.PI / 2 + (unit.column % 3 - 1) * Math.PI / 4);
  if (moving) animationFrame = requestAnimationFrame(render);
}
Promise.all([loadPunyCharacters(), loadPunyWorld()]).then(() => { window.__ready = true; document.documentElement.dataset.assets = 'ready'; render(performance.now()); }).catch(error => { document.documentElement.dataset.assets = 'error'; css('loading').textContent = 'Could not load the embedded artwork.'; console.error(error); });
window.__boltPreview = { get choice() { return choice; }, render, variants: THUNDERBOLT_VARIANTS };
`;
const bundle = await build({ stdin: { contents: script, resolveDir: root, loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', define: { 'import.meta.env.BASE_URL': '""' }, plugins: [{ name: 'embedded-native-art', setup(b) {
  b.onLoad({ filter: /\/unit-sprites\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents: (await readFile(path, 'utf8')).replace('image.src = `${base}assets/puny-world/characters/${definition.file}`;', 'image.src = window.__embeddedArt[`characters/${definition.file}`];') }));
  b.onLoad({ filter: /\/puny-world\.ts$/ }, async ({ path }) => ({ loader: 'ts', contents: (await readFile(path, 'utf8')).replace('image.src = `${import.meta.env.BASE_URL}assets/puny-world/${file}`;', 'image.src = window.__embeddedArt[file];') }));
} }] });
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thunderbolt rank marks · TinyCiv</title><style>
*{box-sizing:border-box}body{margin:0;background:#101718;color:#eee5cb;font:15px/1.5 system-ui,-apple-system,sans-serif}main{max-width:1190px;margin:auto;padding:40px 24px 54px}header{display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:26px}h1{font:600 34px/1.1 Georgia,serif;color:#fff1cb;margin:6px 0 12px}p{margin:0;color:#bdbba8}.eyebrow{letter-spacing:.15em;text-transform:uppercase;color:#d2b26a;font-size:11px}.tag{padding:7px 11px;border:1px solid #5d563a;border-radius:6px;white-space:nowrap;color:#e5c877;background:#27291f;font-size:12px}.panel{overflow:hidden;border:1px solid #665739;border-radius:10px;background:#1a2425;box-shadow:0 6px 25px #0004;margin-bottom:24px}.panel-head{display:flex;gap:15px;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid #4f4934}.panel-head strong{font:500 18px Georgia,serif}.panel-head span{font-size:12px;color:#bdbba8}.panel canvas{display:block;width:100%;image-rendering:pixelated}.controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid #4f4934;color:#dad4be;font-size:13px}.controls label{display:flex;align-items:center;gap:7px}input{accent-color:#d1ad59}input[type=range]{width:100px}#zoom-value{min-width:30px}#options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:28px}.option{padding:0;text-align:left;overflow:hidden;border:1px solid #4d5147;border-radius:9px;background:#1a2425;color:inherit;cursor:pointer;font:inherit;transition:border-color .15s,transform .15s,box-shadow .15s}.option:hover{border-color:#bca16c;transform:translateY(-2px)}.option[aria-pressed=true]{border-color:#edcf80;box-shadow:0 0 0 2px #d1b76b55}.option-title{min-height:57px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:12px 13px}.option-title strong{color:#e6bd64;font-size:14px}.option-title strong span{margin-left:7px;color:#eee2bf}.option-title small{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9b9e8c}.option[aria-pressed=true] .option-title small{color:#f2d58c}.option canvas{display:block;width:100%;image-rendering:pixelated}.option p{font-size:12px;padding:12px 13px;min-height:62px}#loading{display:none}html[data-assets=error] #loading{display:block;color:#e6ac90}.note{font-size:12px;color:#929b91;margin:10px 0 22px}.footer{font-size:12px;color:#9caa9e;margin-top:18px}@media(max-width:900px){#options{grid-template-columns:repeat(2,minmax(0,1fr))}header{align-items:start}.tag{display:none}}@media(max-width:560px){main{padding:24px 14px}h1{font-size:28px}#options{grid-template-columns:1fr}.panel-head{flex-wrap:wrap}.controls{gap:12px}.panel{overflow-x:auto}#lineup{width:920px;max-width:none}#crowd{width:920px;max-width:none}}
</style></head><body><main><header><div><div class="eyebrow">TinyCiv · Rank insignia</div><h1>A new mark for Elite</h1><p>Hardened keeps three chevrons. Elite wears a thunderbolt.<br>Choose a style below to compare it beside the actual game units.</p></div><div id="current-style" class="tag"></div></header><p id="loading"></p>
<section class="panel"><div class="panel-head"><strong>The five ranks</strong><span>Closer to the helmet · health bars stay clear</span></div><canvas id="lineup" width="1100" height="205" aria-label="Untrained Regular Veteran Hardened and Elite with closer rank markers"></canvas></section>
<div class="controls" style="border:1px solid #4f4934;border-radius:8px;margin-bottom:18px"><label><input id="animate" type="checkbox"> Walking animation</label><label><input id="sand" type="checkbox"> Desert ground</label><span style="margin-left:auto;color:#a9ae9b">Click any option to update the previews</span></div>
<section id="options" aria-label="Thunderbolt options"></section>
<section class="panel"><div class="panel-head"><strong id="chosen"></strong><span>Mixed ranks · wounded units · Hold indicators</span></div><div class="controls"><label>Unit scale <input id="zoom" type="range" min="1" max="2.5" step=".5" value="1.5"><output id="zoom-value">1.5×</output></label><span>The same emblem placement used in game.</span></div><canvas id="crowd" width="1100" height="310" aria-label="Crowded army with selected thunderbolt variation"></canvas></section>
<p class="footer">Regular: 10 kills · Veteran: 100 · Hardened: 250 · Elite: 500. All artwork is embedded; this page works offline.</p></main><script>window.__embeddedArt=${JSON.stringify(assets)};</script><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
await mkdir(out, { recursive: true }); await writeFile(resolve(out, 'index.html'), html); console.log(`Built ${out}/index.html (${html.length.toLocaleString()} characters)`);
