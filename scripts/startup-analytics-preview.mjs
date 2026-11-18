import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** Static owner dashboard review with labeled fixture data; never touches live analytics. */
export async function captureAnalyticsPreview(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => sessionStorage.setItem('tinyciv-account-session', 'a'.repeat(64)));
    await page.route('**/api/analytics?days=7', route => route.fulfill({ json: {
      days: 7, generatedAt: '2026-11-17T19:00:00Z',
      summary: { players: 1248, sessions: 2815, play_sessions: 2270, worlds: 2637, attempts: 2781,
        play_seconds: 2458080, errors: 14, error_sessions: 12, frames: 13200000, frame_ms: 240000000, stalls: 87 },
      daily: [ ['11-11',132],['11-12',167],['11-13',141],['11-14',209],['11-15',246],['11-16',214],['11-17',279] ]
        .map(([day,players])=>({day:`2026-${day}`,players,worlds:players*2,play_seconds:players*1800,errors:2})),
      worlds: [
        {world_type:'continents',world_preset:'continents',landform:'mixed',scenario:'none',mode:'singleplayer',attempts:1082,starts:1048,players:782,play_seconds:1232100,frames:7000000,frame_ms:125000000,stalls:31,errors:3},
        {world_type:'fractal',world_preset:'archipelago',landform:'glacial-coast',scenario:'age-of-exploration',mode:'singleplayer',attempts:846,starts:810,players:604,play_seconds:718200,frames:4200000,frame_ms:80000000,stalls:42,errors:8},
        {world_type:'pangaea',world_preset:'pangaea',landform:'rolling-uplands',scenario:'none',mode:'multiplayer',attempts:0,starts:439,players:328,play_seconds:389880,frames:2000000,frame_ms:35000000,stalls:14,errors:3},
      ],
      performance: [{build:'7e4a129c80bd',sessions:2270,frames:13200000,frame_ms:240000000,worst_frame_ms:845,mean_p95_frame_ms:32,stalls:87,long_task_ms:5813}],
      errors: [{source:'asset',message:'Asset failed: building-preview.webp',build:'7e4a129c80bd',occurrences:8,last_seen:'2026-11-17T18:42:00Z'}],
      delivery: [{ga_state:'sent',events:14682},{ga_state:'pending',events:18}],
      gameAnalytics: {configured:true,enabled:true,lastSuccess:'2026-11-17T18:59:52Z'},
    } }));
    await page.goto(new URL('analytics.html', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator('#dashboard').waitFor({state:'visible'});
    await page.evaluate(async()=>{
      await document.fonts.ready;
      const badge=document.createElement('div');badge.textContent='PREVIEW · SAMPLE DATA';
      Object.assign(badge.style,{position:'fixed',right:'20px',bottom:'16px',zIndex:'999',padding:'7px 14px',background:'#d5b967',color:'#182b26',font:'18px "Pixel Operator"'});
      document.body.append(badge);
    });
    assert.deepEqual(errors,[],'Analytics dashboard must initialize without browser errors');
    await mkdir('output/startup',{recursive:true});
    await page.screenshot({path:'output/startup/analytics-dashboard.png',fullPage:true});
  } finally { await page.close(); }
}
