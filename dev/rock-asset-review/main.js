const data = JSON.parse(document.querySelector('#catalog-data').textContent);
const $ = selector => document.querySelector(selector);
const labels = { rock: 'Rocks & boulders', outcrop: 'Rocky outcrops', cliff: 'Cliffs & ledges', mountain: 'Mountains', hill: 'Hills', cave: 'Caves', ore: 'Ore & minerals', sheet: 'Complete source sheets' };
const backgrounds = { grass: '#647449', sand: '#b1a16e', dark: '#222a2a', checker: '#69716d' };
const images = {}, favorites = new Set();
try { for (const id of JSON.parse(localStorage.getItem('btv-rock-favorites') || '[]')) if (data.entries.some(e => e.id === id)) favorites.add(id); } catch {}
let shown = [], current = null, sheetMode = false, favoritesOnly = false;
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const packRank = name => ['Puny World','Puny World · paid atlas','Puny Dungeon','Puny World · desert variant'].includes(name)
  ? ['Puny World','Puny World · paid atlas','Puny Dungeon','Puny World · desert variant'].indexOf(name)
  : /mini.?world/i.test(name)?4:/tiny overworld/i.test(name)?5:/^LPC/.test(name)?6:7;
const packs = [...new Set(data.entries.map(entry => entry.pack))].sort((a,b) => packRank(a)-packRank(b)||a.localeCompare(b));
const categories = [...new Set(data.entries.map(entry => entry.category))].sort((a,b) => (a === 'sheet') - (b === 'sheet') || (labels[a] || a).localeCompare(labels[b] || b));
for (const pack of packs) $('#pack').add(new Option(pack, pack));
for (const category of categories) $('#category').add(new Option(labels[category] || category, category));
$('#totals').textContent = `${data.entries.filter(e=>e.category !== 'sheet').length} asset views · ${packs.length} packs · ${Object.keys(data.images).length} original image files`;
function saveFavorites() { try { localStorage.setItem('btv-rock-favorites', JSON.stringify([...favorites])); } catch {} $('#favorite-count').textContent = favorites.size; }
function toggleFavorite(entry) { favorites.has(entry.id) ? favorites.delete(entry.id) : favorites.add(entry.id); saveFavorites(); render(); if (current) updateDetailFavorite(); }
function updateDetailFavorite() { $('#detail-star').setAttribute('aria-pressed', String(favorites.has(current.id))); $('#detail-star').textContent = favorites.has(current.id) ? '★ Favorited' : '☆ Favorite'; }
function draw(canvas, entry, scale) {
  // Large reference sheets use a bounded thumbnail; their inspector retains
  // the complete source resolution. Small sprites stay at native resolution.
  const thumbnail = Math.min(1, 512 / entry.width, 384 / entry.height);
  canvas.width = Math.max(1,Math.round(entry.width*thumbnail)); canvas.height = Math.max(1,Math.round(entry.height*thumbnail));
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(images[entry.image], entry.x, entry.y, entry.width, entry.height, 0, 0, canvas.width, canvas.height);
  canvas.style.width = `${entry.width * scale}px`; canvas.style.height = `${entry.height * scale}px`;
}
function render() {
  const term = $('#search').value.toLowerCase().trim(), pack = $('#pack').value, category = $('#category').value;
  shown = data.entries.filter(entry => (!pack || entry.pack === pack) && (!category || entry.category === category)
    && (!favoritesOnly || favorites.has(entry.id)) && (!term || [entry.id,entry.label,entry.pack,entry.category,entry.note || '',entry.source].join(' ').toLowerCase().includes(term)));
  const catalog = $('#catalog'); catalog.replaceChildren();
  $('#result-count').textContent = `${shown.length} of ${data.entries.length} views`;
  if (!shown.length) { catalog.append(text('p','No matching assets. Try another pack or clear the filters.','empty')); return; }
  for (const pack of packs) {
    const entries = shown.filter(entry => entry.pack === pack).sort((a,b)=>(a.category==='sheet')-(b.category==='sheet')); if (!entries.length) continue;
    const section = document.createElement('section'); section.className = 'group';
    const heading = document.createElement('div'); heading.className = 'group-title';
    heading.append(text('h2',pack),text('span',`${entries.length} views`)); section.append(heading);
    const credit = entries.find(entry => entry.author || entry.license);
    if (credit) section.append(text('p',[credit.author,credit.license].filter(Boolean).join(' · '),'group-credit'));
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const entry of entries) {
      const card = document.createElement('article'); card.className = 'card'; card.dataset.id = entry.id;
      const preview = document.createElement('button'); preview.className = 'preview'; preview.setAttribute('aria-label',`Inspect ${entry.id}: ${entry.label}`);
      const canvas = document.createElement('canvas'); const scale = Number($('#scale').value);
      draw(canvas,entry,scale); canvas.setAttribute('aria-label', entry.label);
      preview.append(canvas,text('span',entry.category==='sheet'?'Sheet overview':`Up to ${scale}×`,'zoom-note')); preview.onclick = () => openEntry(entry);
      const body = document.createElement('div'); body.className = 'card-body';
      const row = document.createElement('div'); row.className = 'card-top';
      const star = document.createElement('button'); star.className = 'star'; star.textContent = favorites.has(entry.id) ? '★' : '☆';
      star.setAttribute('aria-label',`Favorite ${entry.id}`); star.setAttribute('aria-pressed',String(favorites.has(entry.id))); star.onclick = () => toggleFavorite(entry);
      row.append(text('span',entry.id,'asset-id'),star);
      body.append(row,text('h3',entry.label),text('p',`${entry.width} × ${entry.height} px · ${labels[entry.category] || entry.category}`));
      card.append(preview,body); grid.append(card);
    }
    section.append(grid); catalog.append(section);
  }
}
function openEntry(entry) {
  current = entry; sheetMode = entry.category === 'sheet';
  $('#detail-scale').value = sheetMode ? 'fit' : '3';
  if (!$('#inspector').open) $('#inspector').showModal();
  updateDetail();
}
function updateDetail() {
  $('#detail-title').textContent = `${current.id} · ${current.label}`; $('#detail-pack').textContent = current.pack;
  $('#crop-mode').setAttribute('aria-pressed',String(!sheetMode)); $('#sheet-mode').setAttribute('aria-pressed',String(sheetMode));
  updateDetailFavorite(); const info = $('#detail-info'); info.replaceChildren();
  function item(label, content, code=false) { const p=document.createElement('p'); p.append(text('span',label,'meta-label'),text(code?'code':'span',content)); info.append(p); }
  item('Native dimensions',`${current.width} × ${current.height} pixels`);
  item('Source rectangle',`x ${current.x}, y ${current.y}, width ${current.width}, height ${current.height}`,true);
  item('Original file',current.source,true);
  if(current.author) item('Creator',current.author);
  if(current.license) item('Source license',current.license);
  if(current.url && /^https?:\/\//.test(current.url)){const p=document.createElement('p'),a=text('a','Pack / source page');a.href=current.url;a.target='_blank';a.rel='noreferrer';p.append(a);info.append(p);}
  if(current.note) info.append(text('p',current.note,'detail-note'));
  drawDetail();
}
function drawDetail() {
  if (!current) return;
  const image=data.images[current.image], width=sheetMode?image.width:current.width, height=sheetMode?image.height:current.height;
  const canvas=$('#detail-canvas'), space=$('#image-space'); canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
  if(sheetMode){ctx.drawImage(images[current.image],0,0);ctx.save();ctx.strokeStyle='#ffe586';ctx.lineWidth=1;ctx.strokeRect(current.x+.5,current.y+.5,current.width-1,current.height-1);ctx.restore();}
  else ctx.drawImage(images[current.image],current.x,current.y,current.width,current.height,0,0,width,height);
  const value=$('#detail-scale').value;
  const fit=Math.min((space.clientWidth-56)/width,Math.max(200,Math.min(innerHeight*.62,650)-56)/height);
  const scale=value==='fit' ? Math.max(.05,fit >= 1 ? Math.floor(fit) : fit) : Number(value);
  canvas.style.width=`${width*scale}px`;canvas.style.height=`${height*scale}px`;
  space.scrollTop=0;space.scrollLeft=0;
  $('#detail-status').textContent=`${sheetMode?'Original sheet; gold outline marks the selected crop.':'Original pixels; no recoloring or resampling.'} Display ${scale.toFixed(scale%1?2:0)}×. Escape closes; arrow keys browse.`;
}
function step(direction){const list=shown.length?shown:data.entries;const i=list.findIndex(entry=>entry.id===current.id);openEntry(list[(i+direction+list.length)%list.length]);}
for(const selector of ['#pack','#category','#scale']) $(selector).addEventListener('change',render);
$('#search').addEventListener('input',render);
$('#background').addEventListener('change',()=>{document.documentElement.style.setProperty('--surface',backgrounds[$('#background').value]);document.body.classList.toggle('checker',$('#background').value==='checker');});
$('#favorites-only').onclick=()=>{favoritesOnly=!favoritesOnly;$('#favorites-only').setAttribute('aria-pressed',String(favoritesOnly));render();};
$('#export').onclick=()=>{const selected=data.entries.filter(entry=>favorites.has(entry.id)).map(({image,...entry})=>entry);const blob=new Blob([JSON.stringify({catalog:'BTV rocks and outcrops',selected},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='rock-asset-favorites.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
$('#close').onclick=()=>$('#inspector').close();
$('#inspector').addEventListener('click',event=>{if(event.target===$('#inspector')){const r=$('#inspector').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#inspector').close();}});
$('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);
$('#crop-mode').onclick=()=>{sheetMode=false;updateDetail();};$('#sheet-mode').onclick=()=>{sheetMode=true;$('#detail-scale').value='fit';updateDetail();};
$('#detail-scale').onchange=drawDetail;$('#detail-star').onclick=()=>toggleFavorite(current);
document.addEventListener('keydown',event=>{if(!$('#inspector').open||event.target.matches('input,select'))return;if(event.key==='ArrowRight')step(1);if(event.key==='ArrowLeft')step(-1);});
window.addEventListener('resize',()=>{if($('#inspector').open)drawDetail();});
for(const credit of data.credits){const details=document.createElement('details');details.append(text('summary',credit.path),text('pre',credit.text));$('#credits').append(details);}
$('#coverage').append(text('p',`Cataloged packs: ${packs.join('; ')}.`));
for(const notes of Object.values(data.inventory || {})){
  if(notes.scope)$('#coverage').append(text('p',notes.scope));
  if(notes.excluded?.length){const d=document.createElement('details');d.append(text('summary','Preview-only and unrelated files excluded from this catalog'));const list=document.createElement('ul');
    for(const item of notes.excluded)list.append(text('li',`${(item.sources||[]).map(s=>s.split('/').pop()).join(', ')} — ${item.reason}`));d.append(list);$('#coverage').append(d);}
  if(notes.duplicates?.length)$('#coverage').append(text('p',`${notes.duplicates.length} duplicate source files are represented by their matching original once.`));
}
window.__rockReview={data,get shown(){return shown},get current(){return current},get sheetMode(){return sheetMode},images};
Promise.all(Object.entries(data.images).map(([key,source])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{images[key]=image;resolve();};image.onerror=()=>reject(new Error(`Cannot load ${key}`));image.src=source.data;}))).then(()=>{saveFavorites();render();document.documentElement.dataset.ready='true';}).catch(error=>{$('#catalog').textContent=`Could not prepare catalog: ${error.message}`;console.error(error);});
