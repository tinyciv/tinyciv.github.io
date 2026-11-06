import { drawPerson } from './unit-sprites';
import type { Unit } from './types';

/** Exact two-frame log campfire from Puny World Medieval. The original pack
 * has separate candle sprites; neither those nor generated drafts are used. */
let campfire: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
export function loadObservationPostArt(): Promise<void> {
  return loading ??= (async () => {
    const image = new Image(); image.src = `${import.meta.env.BASE_URL}assets/medieval/Village-Campfire.png`;
    await image.decode();
    if (image.naturalWidth !== 32 || image.naturalHeight !== 16) throw new Error('Invalid observation campfire artwork.');
    campfire = image;
  })();
}
export const observationFireFrame = (time: number): number => Math.floor(time * 4) % 2;
export function drawObservationCampfire(c: CanvasRenderingContext2D, time: number): void {
  if (!campfire) return;
  c.save(); c.imageSmoothingEnabled = false;
  c.drawImage(campfire, observationFireFrame(time) * 16, 0, 16, 16, 24, 16, 16, 16);
  c.restore();
}
const previewScout: Unit = { id: -1, kind: 'scout', faction: 0, x: 0, y: 0, hp: 100, maxHp: 100,
  morale: 100, attack: 0, defense: 4, speed: 0, range: 0, order: 'hold', cooldown: 0, lastCombat: -60,
  facing: Math.PI / 2, moving: false, attackTime: 0 };
export function drawObservationPost(c: CanvasRenderingContext2D, time: number, color: string): void {
  drawObservationCampfire(c, time); drawPerson(c, previewScout, time, color);
}
/** Eight cached phases: thin, low-opacity pixels rising and gently drifting. */
export function drawObservationSmoke(c: CanvasRenderingContext2D, phase: number): void {
  c.fillStyle = '#eef2e8';
  for (let i = 0; i < 5; i++) {
    const progress = (phase / 8 + i / 5) % 1;
    c.globalAlpha = .14 * Math.sin(progress * Math.PI);
    c.fillRect(15 + Math.round(Math.sin(progress * 6 + i) * 2), 26 - Math.round(progress * 24), 1, 3);
  }
  c.globalAlpha = 1;
}
