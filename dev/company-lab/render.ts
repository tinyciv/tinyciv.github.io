import type { Company, LabWorld, Point, Team } from './types';
import type { CompanyLab } from './engine';

export const TEAM_COLORS = ['#df7164', '#70aedb'] as const;
interface RenderOptions { debug: boolean; now: number; box?: { a: Point; b: Point }; marker?: { point: Point; at: number } }
declare global { interface Window { COMPANY_ASSETS: Record<string, string> } }
const native = 16;
const makeCanvas = (width: number, height: number) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };

/** Native Puny pixels are cached once; no per-frame recoloring or terrain work. */
export class LabRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly c: CanvasRenderingContext2D;
  private assets: Record<string, HTMLImageElement> = {};
  private characters = new Map<string, HTMLCanvasElement>();
  private ground?: HTMLCanvasElement;
  private world?: LabWorld;
  width = 1; height = 1; scale = 16; zoom = 1;
  camera: Point = { x: 0, y: 0 };
  private fitScale = 16;
  constructor(canvas: HTMLCanvasElement) { this.canvas = canvas; this.c = canvas.getContext('2d', { alpha: false })!; }
  async load(): Promise<void> {
    await Promise.all(Object.entries(window.COMPANY_ASSETS).map(async ([key, url]) => { const image = new Image(); image.src = url; await image.decode(); this.assets[key] = image; }));
    if (!this.assets.world || !this.assets.infantry || !this.assets.archer) throw new Error('Embedded Puny World artwork is missing.');
    for (const role of ['infantry', 'archer']) for (const team of [0, 1] as const) this.characters.set(`${role}:${team}`, this.teamSheet(this.assets[role], team));
  }
  resize(world: LabWorld): void {
    const rect = this.canvas.getBoundingClientRect(); this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fitScale = Math.min(this.width / world.width, this.height / world.height);
    this.scale = this.fitScale * this.zoom;
  }
  fit(world: LabWorld): void { this.zoom = 1; this.camera = { x: world.width / 2, y: world.height / 2 }; this.resize(world); }
  point(pixel: Point): Point { return { x: (pixel.x - this.width / 2) / this.scale + this.camera.x, y: (pixel.y - this.height / 2) / this.scale + this.camera.y }; }
  screen(point: Point): Point { return { x: (point.x - this.camera.x) * this.scale + this.width / 2, y: (point.y - this.camera.y) * this.scale + this.height / 2 }; }
  pan(dx: number, dy: number): void { this.camera.x -= dx / this.scale; this.camera.y -= dy / this.scale; }
  zoomAt(factor: number, pixel: Point = { x: this.width / 2, y: this.height / 2 }): void {
    const before = this.point(pixel); this.zoom = Math.min(5, Math.max(.8, this.zoom * factor)); this.scale = this.fitScale * this.zoom;
    const after = this.point(pixel); this.camera.x += before.x - after.x; this.camera.y += before.y - after.y;
  }
  invalidate(): void { this.world = undefined; }
  private teamSheet(source: HTMLImageElement, team: Team): HTMLCanvasElement {
    const canvas = makeCanvas(source.width, source.height), c = canvas.getContext('2d')!; c.drawImage(source, 0, 0);
    const image = c.getImageData(0, 0, canvas.width, canvas.height), p = image.data;
    const rgb = [1, 3, 5].map(i => parseInt(TEAM_COLORS[team].slice(i, i + 2), 16));
    const shades = new Map([[46 * 256 + 39, .30], [75 * 256 + 63, .48], [79 * 256 + 67, .52], [121 * 256 + 102, .78], [180 * 256 + 157, 1]]);
    const archerCloth = new Map([[48 * 65536 + 54 * 256, .30], [69 * 65536 + 80 * 256, .48], [98 * 65536 + 113 * 256 + 5, .68], [139 * 65536 + 158 * 256 + 15, 1]]);
    for (let i = 0; i < p.length; i += 4) if (p[i + 3]) {
      const shade = p[i] === 0 ? shades.get(p[i + 1] * 256 + p[i + 2]) : archerCloth.get(p[i] * 65536 + p[i + 1] * 256 + p[i + 2]);
      if (shade !== undefined) for (let k = 0; k < 3; k++) p[i + k] = Math.round(rgb[k] * shade);
    }
    // Match the game's faction tabard, clipped to each existing native torso.
    for (let row = 0; row < 8; row++) for (let frame = 0; frame < 19; frame++) {
      const ox = frame * 32, oy = row * 32, center = [15.5, 15.5, 15, 15, 15.5, 16, 16, 15.5][row];
      const width = row === 2 || row === 6 ? 3 : row % 2 ? 4 : 5, left = Math.round(center - (width - 1) / 2); let feet = 22;
      for (let y = 25; y >= 20; y--) { let n = 0; for (let x = 13; x <= 18; x++) if (p[((oy + y) * canvas.width + ox + x) * 4 + 3] > 200) n++; if (n >= 2) { feet = y; break; } }
      for (let y = feet - 4; y < feet; y++) for (let x = left; x < left + width; x++) {
        const i = ((oy + y) * canvas.width + ox + x) * 4, light = Math.max(p[i], p[i + 1], p[i + 2]);
        if (p[i + 3] < 200 || light < 25 || light > 215) continue;
        const shade = x === left || x === left + width - 1 ? .62 : y === feet - 4 ? 1.18 : y === feet - 1 ? .76 : 1;
        for (let k = 0; k < 3; k++) p[i + k] = Math.min(255, Math.round(rgb[k] * shade));
      }
    }
    c.putImageData(image, 0, 0); return canvas;
  }
  private bake(world: LabWorld): void {
    this.world = world; const canvas = this.ground = makeCanvas(world.width * native, world.height * native), c = canvas.getContext('2d')!;
    c.imageSmoothingEnabled = false; const sheet = this.assets.world;
    const tile = (x: number, y: number) => world.tiles[y * world.width + x];
    const at = (x: number, y: number, kinds: number[]) => x >= 0 && y >= 0 && x < world.width && y < world.height && kinds.includes(tile(x, y));
    const draw = (sx: number, sy: number, sw: number, sh: number, x: number, y: number, w = sw, h = sh) => c.drawImage(sheet, sx, sy, sw, sh, x, y, w, h);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x, kind = tile(x, y), px = x * native, py = y * native, variation = (x * 13 + y * 7 + x * y) % 9;
      draw(variation % 3 * 16, Math.floor(variation / 3) * 16, 16, 16, px, py);
      if (kind === 1) {
        // The atlas road's center is (80,16). Its authored 3×3 shoulders
        // connect in either direction instead of repeating a west-edge strip.
        for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
          const horizontal = at(x + (qx ? 1 : -1), y, [1, 6]);
          const vertical = at(x, y + (qy ? 1 : -1), [1, 6]);
          const diagonal = at(x + (qx ? 1 : -1), y + (qy ? 1 : -1), [1, 6]);
          // The crossroads tile has grass in its inner corners; broad roads
          // instead use the atlas's uninterrupted dirt interior at (128,16).
          const interior = horizontal && vertical && diagonal;
          draw((interior ? 128 : horizontal ? 80 : qx ? 96 : 64) + qx * 8,
            (interior ? 16 : vertical ? 16 : qy ? 32 : 0) + qy * 8, 8, 8, px + qx * 8, py + qy * 8);
        }
      }
      if (kind === 3 || kind === 6) {
        for (let qy = 0; qy < 2; qy++) for (let qx = 0; qx < 2; qx++) {
          const dx = qx ? 1 : -1, dy = qy ? 1 : -1;
          const h = at(x + dx, y, [3, 6]), v = at(x, y + dy, [3, 6]), diagonal = at(x + dx, y + dy, [3, 6]);
          const sx = h && v && !diagonal ? 10 + qx : 7 + (h ? 1 : qx * 2), sy = h && v && !diagonal ? 10 + qy : 10 + (v ? 1 : qy * 2);
          draw(sx * 16 + qx * 8, sy * 16 + qy * 8, 8, 8, px + qx * 8, py + qy * 8);
        }
        if (kind === 6) draw(352, 464, 16, 16, px, py);
      }
      if (kind === 7) {
        const level = world.elevations[index], same = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < world.width && ny < world.height && world.elevations[ny * world.width + nx] === level;
        const west = same(x - 1, y), east = same(x + 1, y), north = same(x, y - 1), south = same(x, y + 1);
        draw((west ? east ? 1 : 2 : 0) * 16, (4 + (north ? south ? 1 : 2 : 0)) * 16, 16, 16, px, py);
      }
      if (kind === 8) { const sources = [[96, 96], [80, 80], [96, 64], [112, 80]], src = sources[world.stairDir?.[index] ?? 0] ?? sources[0]; draw(src[0], src[1], 16, 16, px, py); }
    }
    // Render each connected rectangular building footprint as a whole native
    // house or hall. Repeating a tiny house once per blocked cell reads as crates.
    // Greedy rectangles also handle irregular future footprints without painting
    // outside any blocked cell. Sources match NATIVE_BUILDINGS in the game.
    const built = new Uint8Array(world.tiles.length);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      if (tile(x, y) !== 5 || built[y * world.width + x]) continue;
      let width = 1, height = 1;
      while (x + width < world.width && tile(x + width, y) === 5 && !built[y * world.width + x + width]) width++;
      rows: while (y + height < world.height) {
        for (let dx = 0; dx < width; dx++) if (tile(x + dx, y + height) !== 5 || built[(y + height) * world.width + x + dx]) break rows;
        height++;
      }
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) built[(y + dy) * world.width + x + dx] = 1;
      const variation = Math.floor(x / 5) + Math.floor(y / 4);
      const hall = width >= 4 && height >= 4 && variation % 5 === 0;
      const source = hall ? [192, 416, 32, 32] : [variation % 2 ? 80 : 64, 432, 16, 16];
      if (height === 1 && width > 1) {
        // Narrow residual blocks become continuous row-house facades: retain
        // native roof ends and repeat the authored windows/door section.
        draw(64, 432, 4, 16, x * native, y * native);
        for (let offset = 4; offset < width * native - 4; offset += 8) {
          const strip = Math.min(8, width * native - 4 - offset);
          draw(68, 432, strip, 16, x * native + offset, y * native);
        }
        draw(76, 432, 4, 16, (x + width) * native - 4, y * native);
      } else draw(source[0], source[1], source[2], source[3], x * native, y * native, width * native, height * native);
    }
    // Obstacles keep their exact occupied cells; canopy art may overhang north.
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const kind = tile(x, y), px = x * native, py = y * native;
      if (kind === 2) draw(16, 112, 16, 32, px, py - 16);
      if (kind === 4) { const vertical = at(x, y - 1, [4]) || at(x, y + 1, [4]); draw(vertical ? 288 : 304, vertical ? 432 : 416, 16, 16, px, py); }

    }
  }
  private brackets(x: number, y: number, width: number, height: number, opacity: number): void {
    const c = this.c, n = Math.min(5, width * .3); c.globalAlpha = opacity; c.strokeStyle = '#fff3cf'; c.lineWidth = 1.3;
    c.beginPath(); for (const [dx, dy] of [[0, 0], [width, 0], [0, height], [width, height]]) { const sx = dx ? -1 : 1, sy = dy ? -1 : 1; c.moveTo(x + dx + n * sx, y + dy); c.lineTo(x + dx, y + dy); c.lineTo(x + dx, y + dy + n * sy); } c.stroke(); c.globalAlpha = 1;
  }
  draw(lab: CompanyLab, options: RenderOptions): void {
    if (this.world !== lab.world || !this.ground) this.bake(lab.world);
    const c = this.c, s = this.scale, ox = this.width / 2 - this.camera.x * s, oy = this.height / 2 - this.camera.y * s;
    c.imageSmoothingEnabled = false; c.fillStyle = '#111b19'; c.fillRect(0, 0, this.width, this.height);
    c.drawImage(this.ground!, ox, oy, lab.world.width * s, lab.world.height * s);
    for (const team of [0, 1] as const) {
      const base = this.screen(lab.world.bases[team]);
      c.strokeStyle = `${TEAM_COLORS[team]}77`; c.lineWidth = 1; c.setLineDash([3, 4]);
      c.beginPath(); c.ellipse(base.x, base.y, s * 2.8, s * 1.7, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.font = '9px system-ui'; c.textAlign = 'center'; c.fillStyle = '#162223d9'; c.fillRect(base.x - 28, base.y + s * 2, 56, 15);
      c.fillStyle = TEAM_COLORS[team]; c.fillText(team ? 'Blue base' : 'Red base', base.x, base.y + s * 2 + 10);
    }
    const selected = new Set(lab.companies.filter(company => company.selected).map(company => company.id));
    if (options.debug) {
      c.strokeStyle = '#14221922'; c.lineWidth = .5; c.beginPath();
      for (let x = 0; x <= lab.world.width; x++) { c.moveTo(ox + x * s, oy); c.lineTo(ox + x * s, oy + lab.world.height * s); }
      for (let y = 0; y <= lab.world.height; y++) { c.moveTo(ox, oy + y * s); c.lineTo(ox + lab.world.width * s, oy + y * s); } c.stroke();
      for (const company of lab.companies) if (company.selected) { const a = this.screen(company), b = this.screen(company.goal); c.strokeStyle = `${TEAM_COLORS[company.team]}a0`; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); c.setLineDash([]); c.strokeRect(b.x - 4, b.y - 4, 8, 8); }
      for (const soldier of lab.soldiers) if (selected.has(soldier.company) && soldier.hp > 0) { const a = this.screen(soldier), slot = this.screen(soldier.slot); c.strokeStyle = '#efe2ad70'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(slot.x, slot.y); c.stroke(); c.strokeRect(slot.x - 2, slot.y - 2, 4, 4); }
    }
    for (const soldier of lab.soldiers) if (soldier.hp <= 0 && lab.time - (soldier.deadAt ?? lab.time) < 14) {
      const p = this.screen(soldier); c.fillStyle = '#392c2466'; c.fillRect(p.x - s * .25, p.y - s * .08, s * .5, s * .14);
    }
    const soldiers = lab.soldiers.filter(u => u.hp > 0).sort((a, b) => a.y - b.y || a.id - b.id);
    for (const soldier of soldiers) {
      const p = this.screen(soldier); if (p.x < -30 || p.y < -30 || p.x > this.width + 30 || p.y > this.height + 30) continue;
      const row = (10 - ((Math.round(soldier.facing / (Math.PI / 4)) % 8 + 8) % 8)) % 8;
      const attacking = soldier.attackUntil > lab.time, frame = attacking ? (soldier.kind === 'archer' ? 8 : 5) + Math.floor(lab.time * 12) % 3
        : soldier.moving ? 1 + Math.floor(lab.time * 9 + soldier.id * .37) % (soldier.kind === 'archer' ? 3 : 4) : 0;
      const picture = this.characters.get(`${soldier.kind}:${soldier.team}`)!, size = s * 2.2;
      c.fillStyle = '#17251570'; c.beginPath(); c.ellipse(p.x, p.y + s * .08, s * .27, s * .12, 0, 0, Math.PI * 2); c.fill();
      c.drawImage(picture, frame * 32, row * 32, 32, 32, Math.round(p.x - size / 2), Math.round(p.y - size * .78), size, size);
      const barWidth = Math.max(10, s * .8), top = p.y - s * 1.03;
      if (selected.has(soldier.company) || soldier.hp < soldier.maxHp || s > 18) {
        c.fillStyle = '#15201b'; c.fillRect(p.x - barWidth / 2 - 1, top - 1, barWidth + 2, 4);
        c.fillStyle = soldier.hp < soldier.maxHp * .3 ? '#e09662' : TEAM_COLORS[soldier.team]; c.fillRect(p.x - barWidth / 2, top, barWidth * soldier.hp / soldier.maxHp, 2);
      }
      if (selected.has(soldier.company)) this.brackets(p.x - s * .43, p.y - s * .92, s * .86, s * 1.08, .7 + Math.sin(options.now * 3.2) * .15);
      if (soldier.damageFlash > 0) { c.fillStyle = '#ffe7a68c'; c.fillRect(p.x - 2, p.y - s * .45, 4, 4); }
    }
    for (const shot of lab.projectiles) {
      const t = Math.min(1, Math.max(0, (lab.time - shot.bornAt) / shot.life));
      const p = this.screen({ x: shot.x + (shot.targetX - shot.x) * t, y: shot.y + (shot.targetY - shot.y) * t - .45 - Math.sin(t * Math.PI) * .4 });
      c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(shot.targetY - shot.y, shot.targetX - shot.x) - Math.PI / 2);
      if (this.assets.arrow) c.drawImage(this.assets.arrow, -s * .32, -s * .32, s * .64, s * .64); else { c.strokeStyle = '#ead394'; c.beginPath(); c.moveTo(0, -3); c.lineTo(0, 3); c.stroke(); } c.restore();
    }
    const livingCompanies = new Set(soldiers.map(unit => unit.company));
    for (const company of lab.companies) if (company.selected && livingCompanies.has(company.id)) this.companyLabel(company);
    for (const event of lab.events.slice(-20)) { const age = lab.time - event.bornAt; if (age < 0 || age > 2) continue; const p = this.screen(event); c.globalAlpha = Math.min(1, 2 - age); c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.fillStyle = '#fff0bd'; c.fillText(event.text, p.x, p.y - 15 - age * 12); c.globalAlpha = 1; }
    if (options.marker && options.now - options.marker.at < .85) { const p = this.screen(options.marker.point), t = (options.now - options.marker.at) / .85; c.strokeStyle = `rgba(255,235,180,${1 - t})`; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 6 + 16 * t, 0, Math.PI * 2); c.stroke(); }
    if (options.box) { const { a, b } = options.box; c.fillStyle = '#e9d49912'; c.strokeStyle = '#f3e4b5c9'; c.lineWidth = 1; c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); c.strokeRect(a.x + .5, a.y + .5, b.x - a.x, b.y - a.y); }
  }
  private companyLabel(company: Company): void {
    const c = this.c, p = this.screen(company), text = `${company.kind === 'archer' ? 'A' : 'I'}${company.id} ${'★'.repeat(Math.max(0, Math.min(3, Math.floor(company.veterancy))))}`.trim();
    c.font = '9px system-ui'; c.textAlign = 'center'; const width = c.measureText(text).width + 10;
    c.fillStyle = '#172222e8'; c.fillRect(p.x - width / 2, p.y - this.scale * 1.7, width, 15); c.fillStyle = '#f1ddb0'; c.fillText(text, p.x, p.y - this.scale * 1.7 + 10);
  }
}
