import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder='scratch/2026-10-30-rock-assets'; await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1050}}), checks=[], errors=[], network=[];
page.on('pageerror',error=>errors.push(String(error)));
page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url());});
function check(name,pass,detail){checks.push({name,pass,...(detail===undefined?{}:{detail})});assert.ok(pass,`${name}: ${JSON.stringify(detail)}`);}
try {
  await page.goto(pathToFileURL(resolve('output/rock-asset-review.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  const metrics=await page.evaluate(()=>{
    const {data,images}=window.__rockReview,blank=[],invalid=[];
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    for(const entry of data.entries){const image=images[entry.image];if(entry.x+entry.width>image.width||entry.y+entry.height>image.height)invalid.push(entry.id);
      canvas.width=entry.width;canvas.height=entry.height;ctx.drawImage(image,entry.x,entry.y,entry.width,entry.height,0,0,entry.width,entry.height);
      const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let visible=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i])visible++;if(!visible)blank.push(entry.id);}
    return{entries:data.entries.length,packs:new Set(data.entries.map(e=>e.pack)).size,images:Object.keys(images).length,blank,invalid};
  });
  check('all embedded images load directly from disk',metrics.images>0&&await page.locator('.card').count()===metrics.entries,metrics);
  check('all crop rectangles are valid and contain visible pixels',!metrics.blank.length&&!metrics.invalid.length,metrics);
  await page.screenshot({path:`${folder}/catalog-desktop.png`});
  const packs=await page.evaluate(()=>[...new Set(window.__rockReview.data.entries.map(e=>e.pack))]);
  for(const [index,pack]of packs.entries()){
    await page.locator('#pack').selectOption(pack);
    check(`${pack}: filter shows exact catalog subset`,await page.evaluate(pack=>window.__rockReview.shown.every(e=>e.pack===pack)&&window.__rockReview.shown.length===window.__rockReview.data.entries.filter(e=>e.pack===pack).length,pack));
    if(/Puny|LPC Rocks|MiniWorld|Scob|Large rocks/i.test(pack))await page.screenshot({path:`${folder}/pack-${index+1}.png`});
  }
  await page.locator('#pack').selectOption('');
  const first=await page.evaluate(()=>window.__rockReview.data.entries.find(e=>e.category!=='sheet'));
  await page.locator('#search').fill(first.id);
  check('search finds a source asset by ID',await page.locator(`.card[data-id="${first.id}"]`).count()===1);
  await page.locator(`.card[data-id="${first.id}"] .star`).click();
  await page.locator('#favorites-only').click();
  check('favorites filter retains the selected asset',await page.locator(`.card[data-id="${first.id}"]`).count()===1);
  const downloadEvent=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadEvent;
  const stream=await download.createReadStream(),buffers=[];for await(const buffer of stream)buffers.push(buffer);
  const exported=JSON.parse(Buffer.concat(buffers).toString());
  check('favorites export preserves original source and rectangle',exported.selected.some(e=>e.id===first.id&&e.source===first.source&&e.x===first.x&&e.width===first.width));
  await page.locator(`.card[data-id="${first.id}"] .preview`).click();
  check('asset inspector opens the selected source crop',await page.evaluate(id=>document.querySelector('#inspector').open&&window.__rockReview.current.id===id&&!window.__rockReview.sheetMode,first.id));
  check('inspector pixels exactly match the original source crop',await page.evaluate(()=>{
    const e=window.__rockReview.current,c=document.createElement('canvas');c.width=e.width;c.height=e.height;
    const ctx=c.getContext('2d');ctx.drawImage(window.__rockReview.images[e.image],e.x,e.y,e.width,e.height,0,0,e.width,e.height);
    const a=ctx.getImageData(0,0,e.width,e.height).data,b=document.querySelector('#detail-canvas').getContext('2d').getImageData(0,0,e.width,e.height).data;return a.every((n,i)=>n===b[i]);
  }));
  await page.locator('#detail-scale').selectOption('4');
  check('integer zoom keeps exact native proportions',await page.evaluate(()=>{const c=document.querySelector('#detail-canvas');return parseFloat(c.style.width)===c.width*4&&parseFloat(c.style.height)===c.height*4;}));
  await page.screenshot({path:`${folder}/asset-detail.png`});
  await page.locator('#sheet-mode').click();
  check('original sheet view shows full image dimensions',await page.evaluate(()=>{const r=window.__rockReview,s=r.data.images[r.current.image],c=document.querySelector('#detail-canvas');return r.sheetMode&&c.width===s.width&&c.height===s.height;}));
  await page.screenshot({path:`${folder}/source-sheet.png`});
  await page.keyboard.press('Escape');check('escape closes the inspector',await page.locator('#inspector').evaluate(e=>!e.open));
  await page.locator('#favorites-only').click();await page.locator('#search').fill('');
  await page.locator('#category').selectOption('sheet');check('complete sheets are independently filterable',await page.evaluate(()=>window.__rockReview.shown.length>0&&window.__rockReview.shown.every(e=>e.category==='sheet')));
  await page.locator('#category').selectOption('');await page.locator('#background').selectOption('checker');
  check('transparency grid can be selected',await page.locator('body').evaluate(e=>e.classList.contains('checker')));
  await page.setViewportSize({width:390,height:844});
  check('mobile gallery has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${folder}/catalog-mobile.png`});
  await page.locator('.preview').first().click();
  check('mobile inspector fits viewport',await page.evaluate(()=>{const r=document.querySelector('#inspector').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight;}));
  await page.screenshot({path:`${folder}/detail-mobile.png`});
  check('standalone performs no network requests',network.length===0,network);
  check('no browser runtime errors',errors.length===0,errors);
}finally{await writeFile(`${folder}/browser-checks.json`,JSON.stringify({checks,errors,network},null,2));console.log(JSON.stringify({checks:checks.length,passed:checks.filter(c=>c.pass).length,errors,network},null,2));await browser.close();}
