import { runtimeArtUrl } from './runtime-art';
import type { Building, Unit, NavalWeapon, ShipSinking } from './types';
import { deckPoint, weaponPosition } from './warship-layout';
export { deckPoint, weaponPosition } from './warship-layout';
import { drawPerson } from './unit-sprites';
import { drawBallista } from './siege-art';
import { drawCannon } from './cannon-art';
import { loadNameplateArt } from './nameplate';
const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | undefined;
const colored = new Map<string, HTMLCanvasElement>();
const FILES = ['galley', 'caravel', 'frigate', 'shipyard', 'motion/galley-rowing', 'motion/galley-sinking', 'motion/caravel-sinking', 'motion/frigate-sinking'];
export const WARSHIP_BOUNDS = { x: -32, y: -64, width: 96, height: 160 };
export function loadWarshipArt(): Promise<void> {
  return loading ??= Promise.all([loadNameplateArt(), ...FILES.map(async name => {
    const image = new Image(); image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/naval/warships/${name}.png`); await image.decode();
    if (name.startsWith('motion/') && (image.naturalWidth !== 48 * (name.endsWith('rowing') ? 7 : 9) || image.naturalHeight !== 80))
      throw new Error(`Invalid ship motion artwork: ${name}`);
    images.set(name, image);
  })]).then(() => undefined);
}
export const warshipFrame = (ship: Unit, time: number): number => ship.warship?.class === 'warGalley' && ship.moving ? Math.floor(time / .14) % 7 : 0;
export function drawWarshipMount(c: CanvasRenderingContext2D, kind: NavalWeapon, facing: number, time: number, shotAt?: number, fireEffects = true): void {
  if (kind === 'ballista') drawBallista(c, { siegeFacing: facing, siegeShotAt: shotAt }, -12, -12, 24, time);
  else if (kind === 'cannon') drawCannon(c, { siegeFacing: facing, siegeShotAt: shotAt }, -12, -12, 24, time, fireEffects);
}
export function sinkingFrame(effect: ShipSinking, time: number): number {
  return Math.min(8, Math.max(0, Math.floor((time - effect.time) / 4 * 9)));
}
export function sinkingImage(effect: ShipSinking, color: string): HTMLImageElement | HTMLCanvasElement | undefined {
  return factionHull(`motion/${effect.class === 'warGalley' ? 'galley' : effect.class}-sinking`, color);
}
/** Hull frames retain faction colors. NativeArt keeps independently aimed
 * mounts and upright marine poses in separate shared textures. */
function factionHull(name: string, color: string): HTMLImageElement | HTMLCanvasElement | undefined {
  const source = images.get(name); if (!source || !/^#[0-9a-f]{6}$/i.test(color)) return source;
  const key = `${name}:${color}`, cached = colored.get(key); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const c = canvas.getContext('2d')!; c.drawImage(source, 0, 0); const pixels = c.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2], min = Math.min(g, b);
    if (!pixels.data[i + 3] || r < 65 || r <= Math.max(g, b) || r - min < 40 || Math.abs(g - b) / (r - min) > .28) continue;
    const shade = r / 200; for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] = Math.min(255, Math.round(rgb[channel] * shade));
  }
  c.putImageData(pixels, 0, 0); colored.set(key, canvas); return canvas;
}
export function drawWarshipBase(c: CanvasRenderingContext2D, ship: Unit, color = '#df6262', time = 0, mounts = true): void {
  const w = ship.warship; if (!w) return;
  const moving = w.class === 'warGalley' && ship.moving;
  const image = factionHull(moving ? 'motion/galley-rowing' : w.class === 'warGalley' ? 'galley' : w.class, color); if (!image) return;
  c.save(); c.imageSmoothingEnabled = false;
  if (moving) c.drawImage(image, warshipFrame(ship, time) * 48, 0, 48, 80, -32, -64, 96, 160);
  else c.drawImage(image, -32, -64, 96, 160);
  const count = w.class === 'warGalley' ? 2 : w.class === 'caravel' ? 3 : 4;
  if (mounts) for (let i = 0; i < count; i++) { const p = weaponPosition(i, count), gun = w.guns?.[i];
    c.save(); c.translate(p.x, p.y); drawWarshipMount(c, w.weapons[i] ?? 'empty', (gun?.facing ?? ship.facing) - ship.facing - Math.PI / 2, time, gun?.firedAt); c.restore(); }
  c.restore();
}
export function drawShipyard(c: CanvasRenderingContext2D, _building: Building, x: number, y: number, cell: number): void {
  const image = images.get('shipyard'); if (!image) return;
  c.save(); c.imageSmoothingEnabled = false; c.drawImage(image, x, y, cell * 3, cell * 3); c.restore();
}
export function drawWarship(c: CanvasRenderingContext2D, ship: Unit, passenger: Unit | undefined, x: number, y: number, cell: number, time: number, color: string, firearm = false): void {
  if (!ship.warship) return;
  c.save(); c.translate(x + cell / 2, y + cell / 2); c.scale(cell / 32, cell / 32); c.rotate(ship.facing + Math.PI / 2); c.translate(-16, -16);
  drawWarshipBase(c, ship, color, time); c.restore();
  const count = Math.ceil(ship.warship.crewHp / 100);
  for (let i = 0; i < count; i++) {
    const p = deckPoint(ship, i % 2 ? .65 : -.65, (Math.floor(i / 2) - 1.5) * .7);
    const gun = ship.warship.guns?.[i + 4];
    const marine: Unit = { ...ship, kind: ship.warship.marine, warship: undefined, inside: false, moving: false,
      facing: gun?.facing ?? ship.facing, attackTime: Math.max(0, .28 - (time - (gun?.firedAt ?? -1000))) };
    c.save(); c.translate(x + (p.x - .1) * cell, y + (p.y - .1) * cell); c.scale(cell / 32 * .8, cell / 32 * .8); drawPerson(c, marine, time, color); c.restore();
  }
  if (passenger) { const p = deckPoint(ship, 0, -1.5); c.save(); c.translate(x + p.x * cell, y + p.y * cell); c.scale(cell / 32, cell / 32); drawPerson(c, { ...passenger, inside: false, moving: false }, time, color, firearm); c.restore(); }
}
