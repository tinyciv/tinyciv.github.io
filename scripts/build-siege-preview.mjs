import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const output = 'scratch/2026-11-02-siege-spears';
mkdirSync(output, { recursive: true });
const embed = (file, mime = 'image/png') => `data:${mime};base64,${readFileSync(file).toString('base64')}`;
const assets = {
  ballista: embed('public/assets/miniworld/Ballista.png'), bolt: embed('public/assets/miniworld/BallistaBolt.png'),
  spear: embed('public/assets/miniworld/Spearman-Red.png'), enemy: embed('public/assets/miniworld/Spearman-Cyan.png'),
  world: embed('public/assets/puny-world/overworld.png'),
};
const font = embed('public/assets/fonts/pixel-operator/PixelOperator.ttf', 'font/ttf');
const script = `
import { ballistaFrame, spearmanPose, spearmanBounds } from './src/game/siege-art.ts';
import { BALLISTA_RANGE, BALLISTA_COOLDOWN, BALLISTA_COST, BALLISTA_BUILD_SECONDS } from './src/game/ballista.ts';
import { SPEAR_PIERCE_DAMAGE_MULTIPLIER, SPEARMAN_DEFENSE_MULTIPLIER } from './src/game/spearmen.ts';
const sources = ${JSON.stringify(assets)};
const images = {};
await Promise.all(Object.entries(sources).map(async ([key, src]) => { const image = new Image(); image.src = src; await image.decode(); images[key] = image; }));
await document.fonts.ready;
document.querySelector('#ballista-sheet').src = sources.ballista;
document.querySelector('#spear-sheet').src = sources.spear;
document.querySelector('#ballista-price').textContent = BALLISTA_COST + ' gold · ' + BALLISTA_BUILD_SECONDS + 's build';
document.querySelector('#spear-defense').textContent = SPEARMAN_DEFENSE_MULTIPLIER + '× defense';
document.querySelector('#pierce-damage').textContent = Math.round(SPEAR_PIERCE_DAMAGE_MULTIPLIER * 100) + '% to each secondary target';
const ranged = document.querySelector('#ranged'), melee = document.querySelector('#melee'), lineup = document.querySelector('#lineup');
const canvases = [ranged, melee, lineup];
const contexts = canvases.map(canvas => { const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; return c; });
let time = 0, playing = !matchMedia('(prefers-reduced-motion: reduce)').matches, speed = 1, last = performance.now();
const play = document.querySelector('#play');
function syncPlay() { play.textContent = playing ? 'Pause' : 'Play'; play.setAttribute('aria-pressed', String(playing)); }
play.onclick = () => { playing = !playing; syncPlay(); }; syncPlay();
document.querySelector('#restart').onclick = () => { time = 0; render(); };
document.querySelector('#speed').onchange = event => { speed = Number(event.target.value); };
function ground(c, width, height) {
  c.clearRect(0, 0, width, height);
  for (let y = 0; y < height; y += 32) for (let x = 0; x < width; x += 32) {
    const variant = ((x / 32) * 7 + (y / 32) * 5) % 9;
    c.drawImage(images.world, variant % 3 * 16, Math.floor(variant / 3) * 16, 16, 16, x, y, 32, 32);
  }
  c.fillStyle = '#0b182a25'; c.fillRect(0, 0, width, height);
}
function label(c, text, x, y, color = '#fff7df', align = 'center') {
  c.font = '16px "Pixel Operator"'; c.textAlign = align; c.textBaseline = 'middle';
  c.fillStyle = '#102020ce'; const w = c.measureText(text).width;
  c.fillRect(x - (align === 'center' ? w / 2 : 0) - 5, y - 10, w + 10, 20);
  c.fillStyle = color; c.fillText(text, x, y);
}
function health(c, x, y, fraction, color) {
  c.fillStyle = '#17211c'; c.fillRect(x - 15, y, 30, 5);
  c.fillStyle = color; c.fillRect(x - 14, y + 1, 28 * fraction, 3);
}
function person(c, x, y, facing, attackTime = 0, enemy = false, moving = false, id = 1, scale = 1) {
  const pose = spearmanPose({ id, facing, moving, attackTime }, time), bounds = spearmanBounds(pose);
  c.save(); c.translate(x - 16 * scale, y - 27.2 * scale); c.scale(scale, scale);
  c.drawImage(enemy ? images.enemy : images.spear, ...pose.rect, bounds.x, bounds.y, bounds.width, bounds.height); c.restore();
}
function ballista(c, x, y, facing, shotAge, scale = 1) {
  const frame = ballistaFrame({ siegeFacing: facing, siegeShotAt: time - shotAge }, time);
  c.drawImage(images.ballista, frame.column * 16, frame.row * 16, 16, 16, x - 16 * scale, y - 32 * scale, 32 * scale, 32 * scale);
}
function rangedScene() {
  const c = contexts[0]; ground(c, 480, 300);
  const cycle = time % BALLISTA_COOLDOWN, launch = .45, flight = BALLISTA_RANGE / 12;
  const progress = (cycle - launch) / flight, hit = progress >= 1;
  const x = 48, pitch = 384 / BALLISTA_RANGE, target = x + BALLISTA_RANGE * pitch, feet = 195;
  c.strokeStyle = '#f6e8ad61'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, 75); c.lineTo(target, 75); c.stroke();
  for (let n = 0; n <= BALLISTA_RANGE; n++) { c.beginPath(); c.moveTo(x + n * pitch, 70); c.lineTo(x + n * pitch, 80); c.stroke(); }
  label(c, BALLISTA_RANGE + ' tiles', 240, 53);
  const shotAge = cycle >= launch ? cycle - launch : Infinity;
  ballista(c, x, feet, 0, shotAge);
  // Native Puny wall cells represent the siege target.
  for (const dy of [-32, 0, 32]) c.drawImage(images.world, 272, 432, 16, 16, target - 16, feet - 32 + dy, 32, 32);
  health(c, target, 119, hit ? .67 : 1, hit ? '#ea9b70' : '#d4d8c6');
  if (progress >= 0 && progress < 1) {
    const px = x + (target - x) * progress, py = feet - 17 - Math.sin(progress * Math.PI) * 8;
    c.drawImage(images.bolt, 16, 0, 16, 16, px - 14.4, py - 14.4, 28.8, 28.8);
  }
  if (hit && cycle < launch + flight + .6) {
    const age = cycle - launch - flight; c.globalAlpha = 1 - age / .6;
    c.strokeStyle = '#f8e8bb'; c.strokeRect(target - 12 - age * 8, feet - 27 - age * 8, 24 + age * 16, 24 + age * 16); c.globalAlpha = 1;
  }
  label(c, 'Ballista', x, 241); label(c, 'Fortification', target - 5, 257);
  const loaded = Math.max(0, Math.min(1, cycle / BALLISTA_COOLDOWN));
  c.fillStyle = '#101c1ddd'; c.fillRect(152, 239, 176, 30); c.fillStyle = '#cfb370'; c.fillRect(158, 261, 164 * loaded, 2);
  label(c, progress < 0 ? 'Ready' : progress < 1 ? 'Bolt in flight' : 'Reloading', 240, 248);
  document.querySelector('#ranged-state').textContent = 'One shot every ' + BALLISTA_COOLDOWN + ' seconds. ' + (progress >= 0 && progress < 1 ? 'Bolt in flight.' : 'Winding the next shot.');
}
function meleeScene() {
  const c = contexts[1]; ground(c, 480, 300);
  const cycle = time % 2.6, strike = cycle >= 1 && cycle < 1.28, hit = cycle >= 1.1;
  const x = 150, feet = 181, targets = [196, 229, 262];
  c.fillStyle = '#e7d4a51f'; c.fillRect(184, 161, 105, 26);
  c.strokeStyle = '#e7d4a576'; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(177, 174); c.lineTo(286, 174); c.stroke(); c.setLineDash([]);
  // Nearby flank remains outside the thrust corridor.
  person(c, 247, 112, Math.PI, 0, true); health(c, 247, 76, 1, '#72cecb'); label(c, 'Outside the line', 302, 46);
  person(c, x, feet, 0, strike ? 1.28 - cycle : 0); health(c, x, 142, 1, '#e27872');
  targets.forEach((tx, i) => {
    person(c, tx, feet, Math.PI, 0, true, false, i + 2);
    health(c, tx, 142, hit ? 1 - (i ? .21 : .35) : 1, '#72cecb');
    if (hit && cycle < 1.8) {
      c.globalAlpha = Math.min(1, (1.8 - cycle) * 2);
      label(c, i ? '60%' : '100%', tx, 122 - (cycle - 1.1) * 17, '#ffe5a4'); c.globalAlpha = 1;
    }
  });
  label(c, 'Spearman', x, 224);
  label(c, 'Primary', targets[0], 251); label(c, '+2 ranks', targets[2], 224);
  document.querySelector('#melee-state').textContent = hit ? 'Three aligned targets struck; the flanking soldier is unharmed.' : 'Thrust hits the primary target and up to two enemies behind it.';
}
function poseLineup() {
  const c = contexts[2], compact = matchMedia('(max-width:760px)').matches;
  const width = compact ? 480 : 960, height = compact ? 340 : 190;
  if (lineup.width !== width || lineup.height !== height) { lineup.width = width; lineup.height = height; c.imageSmoothingEnabled = false; }
  ground(c, width, height);
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((direction, i) => {
    const x = compact ? 105 + i % 2 * 240 : 110 + i * 245, feet = compact ? 105 + Math.floor(i / 2) * 165 : 123, phase = time % 1.8;
    person(c, x - 26, feet, direction, phase > 1 ? .28 - (phase - 1) % .28 : 0, false, phase < 1, i + 1, 1.6);
    ballista(c, x + 54, feet, direction, time % 4, 1.3);
    label(c, ['East', 'South', 'West', 'North'][i], x + 5, feet + 32);
  });
}
function render() { rangedScene(); meleeScene(); poseLineup(); }
window.__siegePreview = { setTime: value => { time = value; playing = false; syncPlay(); render(); },
  get state() { return { time, playing, speed, assets: Object.keys(images) }; } };
document.documentElement.dataset.ready = 'true';
function frame(now) { if (playing) time += Math.min(.05, (now - last) / 1000) * speed; last = now; render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
`;
const bundled = await build({ stdin: { contents: script, resolveDir: process.cwd(), sourcefile: 'siege-preview.ts', loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  define: { 'import.meta.env.BASE_URL': '""' } });
const css = `@font-face{font-family:'Pixel Operator';src:url('${font}') format('truetype');font-display:block}*{box-sizing:border-box}body{margin:0;background:#111a1e;color:#e8ecdf;font-family:'Pixel Operator',monospace;font-size:19px;line-height:1.35}main{max-width:1120px;margin:auto;padding:44px 28px 32px}.eyebrow{color:#a7bdad;letter-spacing:2px;font-size:15px;text-transform:uppercase}h1{font-size:48px;line-height:1;margin:12px 0}h2{font-size:27px;margin:0}p{margin:8px 0}.intro{color:#b4c1b7;max-width:680px;font-size:20px}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:26px 0 24px}button,select{font:inherit;color:#e8ecdf;background:#243139;border:1px solid #69756d;border-radius:7px;padding:8px 17px;min-height:42px;cursor:pointer}button:hover,select:hover{background:#34464e}button:focus-visible,select:focus-visible{outline:2px solid #edcd84;outline-offset:3px}#play{background:#b69a60;color:#141f22;min-width:86px}.toolbar label{margin-left:auto;color:#b8c3b7;display:flex;gap:10px;align-items:center}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{border:1px solid #526156;border-radius:13px;overflow:hidden;background:#1b272c;box-shadow:0 15px 40px #0002}.heading{padding:18px 20px 15px}.heading p{color:#abb8af;font-size:17px}.chips{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}.chip{font-size:16px;border:1px solid #526353;border-radius:5px;padding:3px 8px;color:#edd49c;background:#25352e}canvas{display:block;width:100%;height:auto;image-rendering:pixelated}.caption{padding:15px 20px;color:#c0cabe;min-height:88px}.caption p{margin:0}.small{font-size:16px;color:#8ea397}.lineup{margin-top:22px}.lineup .heading{display:flex;justify-content:space-between;gap:18px;align-items:center}.lineup .heading p{max-width:500px;margin:0}.source{margin-top:24px;border-top:1px solid #3a4c46;padding-top:22px;color:#b4c1b7}a{color:#dcc58f}details{margin-top:18px;background:#1b272c;border:1px solid #40524a;border-radius:9px;padding:13px 16px}summary{cursor:pointer;color:#e8ecdf}.sheets{display:grid;grid-template-columns:1fr 1fr;gap:25px;padding:18px 0 8px}.sheet{background:#263a30;padding:16px;border-radius:8px}.sheet img{image-rendering:pixelated;max-width:100%;height:auto;display:block;margin:12px auto}.sheet:first-child img{width:336px}.sheet:last-child img{width:160px}.path{font-size:14px;overflow-wrap:anywhere;color:#a3b5a8}footer{font-size:15px;color:#82988b;margin-top:28px}@media(max-width:760px){main{padding:28px 16px}h1{font-size:38px}.grid{grid-template-columns:1fr}.lineup .heading{display:block}.lineup .heading p{margin-top:8px}.toolbar label{margin-left:0}.sheets{grid-template-columns:1fr}.caption{min-height:0}.panel canvas{min-width:0}}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Siege & Spear — Native Asset Combat Preview</title><style>${css}</style></head><body><main>
<div class="eyebrow">TinyCiv · Combat preview</div><h1>Siege & spear</h1><p class="intro">Long-range pressure from the ballista. A compact spear line that can strike through the front rank.</p>
<div class="toolbar" aria-label="Preview playback"><button id="play" aria-pressed="true">Pause</button><button id="restart">Replay</button><label for="speed">Playback <select id="speed"><option value=".5">½ speed</option><option value="1" selected>1× speed</option><option value="2">2× speed</option></select></label></div>
<div class="grid"><section class="panel"><div class="heading"><h2>Ballista</h2><p id="ballista-price"></p><div class="chips"><span class="chip">18-tile range</span><span class="chip">4s reload</span><span class="chip">Siege support</span></div></div><canvas id="ranged" width="480" height="300" aria-label="Ballista fires its native bolt eighteen tiles into a fortification"></canvas><div class="caption"><p id="ranged-state"></p><p class="small">Heavy bolts; sustained damage comparable to an archer.</p></div></section>
<section class="panel"><div class="heading"><h2>Spearman</h2><p>Armored infantry · same movement as warriors</p><div class="chips"><span class="chip" id="spear-defense"></span><span class="chip">1.4-tile reach</span><span class="chip">Pierce 2 ranks behind</span></div></div><canvas id="melee" width="480" height="300" aria-label="A spear thrust damages the primary target and two aligned enemies behind it; a flanking soldier is unharmed"></canvas><div class="caption"><p id="melee-state"></p><p class="small" id="pierce-damage"></p></div></section></div>
<section class="panel lineup"><div class="heading"><h2>Native animations</h2><p>Four authored directions. Complete spear extensions and ballista firing frames, shared with the game.</p></div><canvas id="lineup" width="960" height="190" aria-label="East, south, west and north native walking, spear attack and ballista firing animations"></canvas></section>
<div class="source"><p>Artwork by <a href="https://merchant-shade.itch.io/16x16-mini-world-sprites">Shade · MiniWorld Sprites</a>, CC0. Terrain from <a href="https://merchant-shade.itch.io/16x16-puny-world">Puny World</a>. These are the existing native sprites; the source sheets are unchanged.</p><p class="small">The preview shares frame selection with the game. Health bars and impact highlights explain targeting; this is an animation study, not a full battle simulation.</p>
<details><summary>Inspect the original sprite sheets</summary><div class="sheets"><div class="sheet"><strong>Ballista</strong><img id="ballista-sheet" alt="Original 112 by64 pixel MiniWorld ballista sprite sheet"><span class="path">Characters/Soldiers/Ranged/Ballista.png</span></div><div class="sheet"><strong>Spearman</strong><img id="spear-sheet" alt="Original80by224pixel MiniWorld red spearman sprite sheet"><span class="path">Characters/Soldiers/Melee/RedMelee/SpearmanRed.png</span></div></div></details></div><footer>Offline, self-contained HTML · Pixel Operator · No external runtime dependencies</footer>
</main><script type="module">${bundled.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
writeFileSync(`${output}/index.html`, html);
console.log(`${output}/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KiB)`);
