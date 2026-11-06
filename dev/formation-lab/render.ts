import { FormationLab, type Point, type Soldier } from './engine';
declare global { interface Window { FORMATION_ASSETS: Record<string, string>; } }

export class Renderer {
  readonly c: CanvasRenderingContext2D; images: Record<string, HTMLImageElement | HTMLCanvasElement> = {};
  ground?: HTMLCanvasElement; world?: FormationLab['world']; scale = 24; left = 0; top = 0; width = 0; height = 0;
  zoom = 1; camera: Point = { x: 22, y: 14 };
  debug = false; marker?: { point: Point; at: number };
  constructor(readonly canvas: HTMLCanvasElement) { this.c = canvas.getContext('2d', { alpha: false })!; }
  async load() {
    await Promise.all(Object.entries(window.FORMATION_ASSETS).filter(([name]) => name !== 'font').map(async ([name, data]) => {
      const image = new Image(); image.src = data; await image.decode(); this.images[name] = image;
    }));
    const source = this.images.soldier as HTMLImageElement, sheet = document.createElement('canvas'); sheet.width = source.width; sheet.height = source.height;
    const c = sheet.getContext('2d')!; c.drawImage(source, 0, 0); const data = c.getImageData(0, 0, sheet.width, sheet.height), p = data.data;
    const shades = new Map([[46 * 256 + 39, .3], [75 * 256 + 63, .48], [79 * 256 + 67, .52], [121 * 256 + 102, .78], [180 * 256 + 157, 1]]);
    for (let i = 0; i < p.length; i += 4) if (p[i] === 0 && p[i + 3]) { const shade = shades.get(p[i + 1] * 256 + p[i + 2]); if (shade !== undefined) { p[i] = 215 * shade; p[i + 1] = 76 * shade; p[i + 2] = 65 * shade; } }
    c.putImageData(data, 0, 0); this.images.soldier = sheet;
  }
  resize(lab: FormationLab) {
    const box = this.canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); this.width = box.width; this.height = box.height;
    this.canvas.width = Math.round(box.width * dpr); this.canvas.height = Math.round(box.height * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0); this.scale = Math.min(box.width / lab.world.width, box.height / lab.world.height) * this.zoom;
    this.left = box.width / 2 - this.camera.x * this.scale; this.top = box.height / 2 - this.camera.y * this.scale;
  }
  fit(lab: FormationLab) { this.zoom = 1; this.camera = { x: lab.world.width / 2, y: lab.world.height / 2 }; this.resize(lab); }
  zoomAt(lab: FormationLab, factor: number, pixel = this.screen(lab.leader)) {
    const anchor = this.point(pixel); this.zoom = Math.max(1, Math.min(3, this.zoom * factor)); this.resize(lab);
    const after = this.point(pixel); this.camera.x += anchor.x - after.x; this.camera.y += anchor.y - after.y; this.resize(lab);
    if (this.zoom === 1) this.fit(lab);
  }
  screen(p: Point): Point { return { x: this.left + p.x * this.scale, y: this.top + p.y * this.scale }; }
  point(p: Point): Point { return { x: (p.x - this.left) / this.scale, y: (p.y - this.top) / this.scale }; }
  private bake(lab: FormationLab) {
    this.world = lab.world; const { width, height, cells } = lab.world, ground = this.ground = document.createElement('canvas'); ground.width = width * 16; ground.height = height * 16;
    const c = ground.getContext('2d')!, atlas = this.images.world; c.imageSmoothingEnabled = false;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const variation = (x * 13 + y * 7 + x * y) % 9, kind = cells[y * width + x];
      c.drawImage(atlas, variation % 3 * 16, Math.floor(variation / 3) * 16, 16, 16, x * 16, y * 16, 16, 16);
      if (kind === 2) c.drawImage(atlas, 128, 176, 16, 16, x * 16, y * 16, 16, 16);
      if (kind === 1) c.drawImage(atlas, 288, 432, 16, 16, x * 16, y * 16, 16, 16);
      if (kind === 3) { c.fillStyle = '#3b4236'; c.fillRect(x * 16, y * 16, 16, 16); }
      if (kind === 4) c.drawImage(atlas, 16, 112, 16, 32, x * 16, (y - 1) * 16, 16, 32);
    }
    // Connected urban blocks retain one native roof silhouette, with masonry
    // foundations filling their actual collision footprint.
    const visited = new Set<number>();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (cells[y * width + x] !== 3 || visited.has(y * width + x)) continue;
      let w = 1, h = 1; while (x + w < width && cells[y * width + x + w] === 3) w++;
      while (y + h < height && cells[(y + h) * width + x] === 3) h++;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) visited.add(yy * width + xx);
      for (let dy = 0; dy < h;) {
        const size = Math.min(w, h - dy);
        if (size >= 2) { c.drawImage(atlas, 192, 416, 32, 32, x * 16, (y + dy) * 16, w * 16, size * 16); dy += size; }
        else { for (let dx = 0; dx < w; dx++) c.drawImage(atlas, 64, 432, 16, 16, (x + dx) * 16, (y + dy) * 16, 16, 16); dy++; }
      }
    }
  }
  draw(lab: FormationLab) {
    const c = this.c, s = this.scale; if (this.world !== lab.world) this.bake(lab);
    c.fillStyle = '#131b16'; c.fillRect(0, 0, this.width, this.height); c.imageSmoothingEnabled = false;
    c.drawImage(this.ground!, this.left, this.top, lab.world.width * s, lab.world.height * s);
    if (this.debug) {
      c.strokeStyle = '#ddd9b75a'; c.lineWidth = 1; c.setLineDash([3, 5]); c.beginPath();
      lab.spine.forEach((p, i) => { const q = this.screen(p); if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y); }); c.stroke(); c.setLineDash([]);
      for (let i = 0; i < lab.troops.length; i++) { const target = this.screen(lab.targetFor(i)); c.strokeStyle = '#fff3c298'; c.strokeRect(target.x - 3, target.y - 3, 6, 6); }
    }
    const leader = this.screen(lab.leader), bounds = lab.mode === 'column' ? .9 : lab.count <= 6 ? 1.7 : 2.5;
    c.save(); c.translate(leader.x, leader.y); c.rotate(lab.heading);
    if (lab.formation) { c.fillStyle = '#f8dc6030'; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, bounds * s, -Math.PI / 3, Math.PI / 3); c.closePath(); c.fill();
      c.strokeStyle = '#ffe78a'; c.lineWidth = 2; c.beginPath(); c.moveTo(bounds * s + 8, -5); c.lineTo(bounds * s + 14, 0); c.lineTo(bounds * s + 8, 5); c.stroke(); }
    c.restore();
    const goal = lab.goal ?? lab.world.goal, destination = this.screen(goal);
    c.strokeStyle = '#e8e2c56b'; c.lineWidth = 1.5; c.setLineDash([3, 3]); c.beginPath(); c.arc(destination.x, destination.y, s * .4, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    if (this.marker && lab.time - this.marker.at < 1) { const p = this.screen(this.marker.point); c.globalAlpha = 1 - (lab.time - this.marker.at); c.strokeStyle = '#fff2bb'; c.beginPath(); c.arc(p.x, p.y, s * (.4 + lab.time - this.marker.at), 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
    const units = [{ unit: lab.leader, role: 'leader' }, ...lab.troops.map(unit => ({ unit, role: 'soldier' })), ...lab.enemies.map(unit => ({ unit, role: 'enemy' }))].sort((a, b) => a.unit.y - b.unit.y);
    for (const { unit, role } of units) this.unit(unit, role, lab);
    for (const spark of lab.sparks) { const a = this.screen(spark.from), b = this.screen(spark.to); c.globalAlpha = 1 - (lab.time - spark.at) / .23; c.strokeStyle = spark.boosted ? '#ffeca2' : '#f18f72'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(a.x, a.y - s * .3); c.lineTo(b.x, b.y - s * .3); c.stroke(); c.globalAlpha = 1; }
    const groupTop = Math.min(lab.leader.y, ...lab.troops.filter(unit => unit.hp > 0).map(unit => unit.y));
    c.font = '16px "Pixel Operator"'; c.textAlign = 'center'; c.fillStyle = '#fff1be'; c.shadowColor = '#000'; c.shadowBlur = 3; c.fillText('LEADER', leader.x, this.screen({ x: lab.leader.x, y: groupTop - 1.15 }).y); c.shadowBlur = 0;
  }
  private unit(unit: Soldier, role: string, lab: FormationLab) {
    const c = this.c, p = this.screen(unit), s = this.scale;
    if (unit.hp <= 0) { c.strokeStyle = '#6c392c'; c.lineWidth = 2; c.beginPath(); c.moveTo(p.x - 3, p.y - 3); c.lineTo(p.x + 3, p.y + 3); c.moveTo(p.x + 3, p.y - 3); c.lineTo(p.x - 3, p.y + 3); c.stroke(); return; }
    c.fillStyle = '#16201466'; c.beginPath(); c.ellipse(p.x, p.y, s * .28, s * .13, 0, 0, Math.PI * 2); c.fill();
    if (role === 'leader') { c.strokeStyle = '#ffe087'; c.lineWidth = 1.4; c.beginPath(); c.ellipse(p.x, p.y, s * .35, s * .18, 0, 0, Math.PI * 2); c.stroke(); }
    // Native perspectives are S, SE, E, NE, N, NW, W, SW.
    const row = ((10 - Math.round(unit.facing / (Math.PI / 4))) % 8 + 8) % 8;
    const frame = unit.cooldown > lab.time + .7 ? role === 'leader' ? 16 : 5 : unit.moving ? 1 + Math.floor(lab.time * 9) % 3 : 0;
    const size = s * 1.8; c.drawImage(this.images[role], frame * 32, row * 32, 32, 32, Math.round(p.x - size / 2), Math.round(p.y - size * .77), size, size);
    if (unit.hp < 120) { c.fillStyle = '#1d221b'; c.fillRect(p.x - s * .25, p.y - s * .93, s * .5, 3); c.fillStyle = role === 'enemy' ? '#e27b66' : '#b7d676'; c.fillRect(p.x - s * .25, p.y - s * .93, s * .5 * unit.hp / 120, 3); }
  }
}
