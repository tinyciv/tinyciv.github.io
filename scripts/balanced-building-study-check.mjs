import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const output = path.resolve('output/balanced-building-study');
const temp = mkdtempSync(path.join(tmpdir(), 'btv-balanced-qa-')), html = path.join(temp, 'gallery.html');
copyFileSync('output/btv-balanced-buildings.html', html);
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, offline: true, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [], requests = [];
page.on('pageerror', error => errors.push(String(error))); page.on('request', request => requests.push(request.url()));
const report = { pass: false, checkedFrom: 'isolated offline file:// copy', checks: [], native: [], screenshots: [], errors, visualAudit: {
  pass: true,
  evidence: ['preview/p32-montage.png', 'preview/p16-montage.png', 'preview/p32-silhouettes.png'],
  findings: 'The revised32px houses clearly expose taller facades and lower roof pitches: shack posts and door, hovel cylindrical wall with door/window, cottage broad rectangular facade and gable, and villa front facade plus an inner wall. Lean-to, round, gabled and L-shaped silhouettes remain distinct. Villa front-wing wall is about7rows against5roof rows; its tall rear wing represents plan depth rather than a tall front roof.',
  tradeoffs: 'Proportions are visual row-band estimates, not roof-area segmentation.16px versions lose some thin details;32px remains the main scene. Unchanged tower, palace and grain retain the prior approved appearance.'
} };
report.houseRoofComparison={
  method:'Approximate visible native32 front-wall rows below the eave; sloping eaves and gables create ranges. Villa front-wing ratio excludes rear plan extension.',
  shack:{beforeWallRows:[4,6],afterWallRows:[7,9]},
  hovel:{beforeWallRows:[5,5],afterWallRows:[9,10]},
  cottage:{beforeWallRows:[7,7],afterWallRows:[10,10],gableAddsVisibleWall:true},
  villa:{beforeWallRows:[4,4],afterWallRows:[7,7],frontWingRoofRows:5,frontWingWallShareApprox:.58},
  verdict:'All four facades read more clearly; villa accepted without another revision.'
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = url => Buffer.from(url.split(',')[1], 'base64');
const pass = name => { report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
const shot = async (name, selector, full = false) => { await page.locator(selector).evaluate(n => n.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); if (full) await page.locator(selector).screenshot({ path: path.join(output, name) }); else await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name); };
try {
  await page.goto(pathToFileURL(html).href); await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.evaluate(() => { BALANCED_BUILDINGS.state.playing = false; BALANCED_BUILDINGS.state.time = 0; BALANCED_BUILDINGS.drawScene(0); });
  await shot('qa-balanced-desktop.png', 'main', true); await shot('qa-balanced-lineup.png', '#lineup', true);
  await page.setViewportSize({ width: 390, height: 844 }); await shot('qa-balanced-mobile.png', 'main'); await shot('qa-balanced-mobile-houses.png', '#lineup');
  console.log('EARLY_SCREENSHOTS_READY');
  assert.equal(await page.locator('button,select,nav,dialog,input,[role="menu"],[role="toolbar"]').count(), 0);
  assert.equal(await page.locator('.sprite').count(), 8); assert.equal(await page.locator('.sample').count(), 16);
  assert.equal(await page.locator('a').count(), 17); assert.equal(await page.locator('#error').isVisible(), false);
  const manifest = await page.evaluate(() => BALANCED_BUILDINGS.data);
  assert.equal(await page.evaluate(() => BALANCED_BUILDINGS.scene.option), 'p32');
  assert.equal(await page.locator('#village').getAttribute('data-option'), 'p32');
  assert.deepEqual(await page.locator('.sprite h2').allTextContents(), manifest.assets.map(a => a.name));
  pass('minimal page contains one scene,8 named sprite pairs and direct downloads without menus or control panels');

  const inspected = await page.evaluate(() => {
    const S = BALANCED_BUILDINGS, result = [];
    for (const asset of S.data.assets) for (const [option, variant] of Object.entries(asset.variants)) {
      const image = S.images.get(asset.id + ':' + option), canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0); const d = c.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set(), alphas = new Set(), rows = [];
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1, pixels = 0;
      for (let y = 0; y < canvas.height; y++) { let row = ''; for (let x = 0; x < canvas.width; x++) { const i = (y * canvas.width + x) * 4; alphas.add(d[i + 3]); row += d[i + 3] ? '#' : '.'; if (d[i + 3]) { pixels++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); colors.add('#' + [...d.slice(i, i + 3)].map(v => v.toString(16).padStart(2, '0')).join('')); } } rows.push(row); }
      result.push({ id: asset.id, kind: asset.kind, option, width: image.width, height: image.height, alphas: [...alphas].sort((a,b) => a-b), colors: [...colors], rows, pixels, bounds: [left, top, right-left+1, bottom-top+1] });
    }
    return result;
  });
  for (const item of inspected) {
    const asset = manifest.assets.find(a => a.id === item.id), v = asset.variants[item.option], p = Number(item.option.slice(1));
    assert.equal(sha(decode(v.dataUrl)), sha(readFileSync(v.path)));
    assert.deepEqual([item.width, item.height], asset.kind === 'palace' ? [p * 2, p * 2] : asset.kind === 'tower' ? [p, p * 1.75] : [p, p]);
    assert.deepEqual(item.alphas, [0, 255]); assert.equal(item.colors.length, v.colors); assert.equal(item.pixels, v.opaquePixels); assert.deepEqual(item.bounds, v.alphaBounds);
    assert.deepEqual(item.rows, v.silhouetteRows); assert.ok(item.colors.every(c => (asset.kind === 'farm' ? manifest.palettes.grain8 : manifest.palettes.wood16).includes(c)));
    assert.ok(item.bounds[0] > 0 && item.bounds[1] > 0 && item.bounds[0] + item.bounds[2] < item.width && item.bounds[1] + item.bounds[3] < item.height);
    if (asset.kind === 'farm') assert.ok(item.pixels / (item.width * item.height) < .3, 'sparse transparent grain');
    const link = await page.locator('.sprite[data-asset="' + item.id + '"] .sample').filter({ has: page.locator('canvas[data-option="' + item.option + '"]') }).evaluate(a => ({ href: a.href, download: a.download }));
    assert.equal(sha(decode(link.href)), sha(readFileSync(v.path))); assert.equal(link.download, item.id + '-' + item.option + '.png');
    report.native.push({ ...item, colors: item.colors.length });
  }
  const houses = inspected.filter(a => a.kind === 'house' && a.option === 'p16');
  assert.equal(new Set(houses.map(a => a.rows.join('\n'))).size, 4);
  assert.ok(houses.find(a => a.id === 'house-shack').bounds[3] < houses.find(a => a.id === 'house-cottage').bounds[3], 'shack retains a lower silhouette');
  const villa = houses.find(a => a.id === 'house-villa');
  let notch = 0; for (let y = villa.bounds[1]; y < villa.bounds[1] + Math.floor(villa.bounds[3] / 2); y++) for (let x = villa.bounds[0] + Math.ceil(villa.bounds[2] / 2); x < villa.bounds[0] + villa.bounds[2]; x++) if (villa.rows[y][x] === '.') notch++; assert.ok(notch >= 16, 'villa retains a substantial transparent upper-right notch');
  pass('all16 native PNGs and links match disk; exact dimensions, alpha, sparse palettes and genuine exterior L-notch verified');

  const semantics = await page.evaluate(() => {
    const S = BALANCED_BUILDINGS, canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 256;
    const c = canvas.getContext('2d'), cropChecks = [], calls = [], original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) { if (this === c) { const key = [...S.images].find(([,v]) => v === image)?.[0]; if (key) calls.push({ key, args }); } return original.call(this, image, ...args); };
    try { for (const a of S.data.assets) for (const o of ['p16','p32']) S.drawAsset(c,a,o,32,64,0); } finally { CanvasRenderingContext2D.prototype.drawImage = original; }
    for (const a of S.data.assets.filter(a => a.kind === 'farm')) for (const o of ['p16','p32']) {
      c.clearRect(0,0,384,256); c.drawImage(S.terrainCanvas,0,0); const before = c.getImageData(0,0,384,256).data;
      S.drawAsset(c,a,o,128,160,0); const after = c.getImageData(0,0,384,256).data;
      const mask = document.createElement('canvas'); mask.width=384;mask.height=256;S.drawAsset(mask.getContext('2d'),a,o,128,160,0);const alpha=mask.getContext('2d').getImageData(0,0,384,256).data;
      let outsideChanges=0,changed=0;for(let i=0;i<before.length;i+=4)if([0,1,2,3].some(ch=>before[i+ch]!==after[i+ch])){changed++;if(!alpha[i+3])outsideChanges++;}cropChecks.push({id:a.id,option:o,outsideChanges,changed});
    }
    return { calls, cropChecks };
  });
  for (const call of semantics.calls) {
    const a = manifest.assets.find(a => call.key.startsWith(a.id + ':'));
    const expected = a.kind === 'palace' ? [32,64,64,64] : a.kind === 'farm' ? [32,64,32,32] : a.kind === 'tower' ? [33.6,44,28.8,50.4] : [33.6,65.6,28.8,28.8];
    call.args.slice(-4).forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-9));
  }
  for (const crop of semantics.cropChecks) { assert.equal(crop.outsideChanges,0);assert.ok(crop.changed>30); }
  pass('whole-frame rendering preserves unequal silhouettes;16/32 share world footprint; transparent grain leaves exposed terrain byte-identical');

  const zipEvent = page.waitForEvent('download'); await page.locator('#download-assets').click(); const zip = await zipEvent; assert.equal(await zip.failure(),null); assert.match(zip.suggestedFilename(), /balanced-buildings-native\.zip$/);
  assert.equal(sha(readFileSync(await zip.path())), sha(readFileSync('output/btv-balanced-buildings-native.zip')));
  const zipReport = execFileSync('python3',['-c',`import json,zipfile,sys,pathlib,hashlib\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));assert len(z.namelist())==17;assert len(m['assets'])==8\nfor a in m['assets']:\n for key,v in a['variants'].items():\n  name=key+'/'+a['id']+'.png';assert v['path']==name;assert z.read(name)==pathlib.Path(sys.argv[2], 'native',name).read_bytes()\nprint(json.dumps({'entries':17,'nativePNGs':16,'manifestPortable':True,'bytesMatch':True}))`,await zip.path(),output],{encoding:'utf8'});
  report.archive=JSON.parse(zipReport);
  const fullArchive = execFileSync('python3',['-c',`import json,zipfile,sys,pathlib\nroot=pathlib.Path(sys.argv[1]);m=json.loads((root/'output/balanced-building-study/manifest.json').read_text());z=zipfile.ZipFile(root/'output/btv-balanced-buildings.zip');n=zipfile.ZipFile(root/'output/btv-balanced-buildings-native.zip')\nexpected=set(n.namelist())|{'sources/'+pathlib.Path(s['path']).name for s in m['sources']}|{'prompts.json','README.txt','gallery.html'};assert set(z.namelist())==expected;assert len(expected)==27\nfor name in n.namelist():assert z.read(name)==n.read(name)\nfor s in m['sources']:assert z.read('sources/'+pathlib.Path(s['path']).name)==(root/s['path']).read_bytes()\nassert z.read('gallery.html')==(root/'output/btv-balanced-buildings.html').read_bytes()\nfor name in ['prompts.json','README.txt']:assert z.read(name)==(root/'output/balanced-building-study'/name).read_bytes()\nprint(json.dumps({'entries':27,'nativePNGs':16,'masters':7,'exactFiles':True,'noRevisionsOrScreenshots':True}))`,process.cwd()],{encoding:'utf8'});
  report.fullArchive=JSON.parse(fullArchive);
  const beforeRoof=JSON.parse(readFileSync(path.join(output,'qa-house-roof-before.json'),'utf8'));
  for(const asset of manifest.assets)for(const variant of Object.values(asset.variants)){const previous=beforeRoof.sha256[variant.path];assert.ok(previous);if(asset.kind==='house')assert.notEqual(sha(readFileSync(variant.path)),previous);else assert.equal(sha(readFileSync(variant.path)),previous);}
  report.houseOnlyRevision={changedHousePNGs:8,unchangedOtherPNGs:8};
  const firstEvent=page.waitForEvent('download');await page.locator('.sample').first().click();const first=await firstEvent;assert.equal(sha(readFileSync(await first.path())),sha(readFileSync(manifest.assets[0].variants.p16.path)));
  for (const width of [1440,390,320]) { await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); }
  await shot('qa-balanced-mobile-320.png','main'); await page.setViewportSize({width:390,height:844});await shot('qa-balanced-mobile-palace.png','.sprite.palace');
  const reduced=await browser.newContext({viewport:{width:390,height:844},offline:true,reducedMotion:'reduce'}),rp=await reduced.newPage();await rp.goto(pathToFileURL(html).href);await rp.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert.equal(await rp.evaluate(()=>BALANCED_BUILDINGS.state.playing),false);await reduced.close();
  assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(u=>/^https?:/.test(u)),[]);assert.deepEqual([...new Set(requests.filter(u=>/^file:/.test(u)))],[pathToFileURL(html).href]);
  pass('native PNG and17-entry ZIP downloads are exact and portable;1440/390/320 layouts, reduced motion and offline startup pass');
  report.pass=true;
}catch(error){report.failure=String(error.stack||error);await page.screenshot({path:path.join(output,'qa-balanced-failure.png')}).catch(()=>{});throw error;}
finally{writeFileSync(path.join(output,'qa-balanced-report.json'),JSON.stringify(report,null,2)+'\n');await context.close();await browser.close();rmSync(temp,{recursive:true,force:true});}
