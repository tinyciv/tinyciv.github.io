import { runtimeArtUrl } from './runtime-art';
import configuration from './maritime.json';
import type { FishingBoat, WhaleResource } from './fishing';
const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | undefined;
const ROOT = 'assets/fishing/';
export const maritimeArtApproved = (): boolean => configuration.approved;
/** Approved sheets only. Proposal pixels remain in the scratch review gallery. */
export function loadMaritimeArt(): Promise<void> {
  if (!configuration.approved) return Promise.resolve();
  return loading ??= Promise.all(['fishing-move', 'fishing-load', 'fishing-unload', 'whaling-move', 'whaling-harvest', 'whale', 'whaling-post'].map(async name => {
    const im = new Image(); im.src = runtimeArtUrl(`${import.meta.env.BASE_URL}${ROOT}${name}.png`); await im.decode();
    const width = name.startsWith('fishing-') || name.startsWith('whaling-') && name !== 'whaling-post' ? 16 : 32;
    const height = name.startsWith('fishing-') ? 32 : name.startsWith('whaling-') && name !== 'whaling-post' ? 48 : 32;
    if (im.naturalHeight !== height || !im.naturalWidth || im.naturalWidth % width) throw new Error(`Invalid maritime sprite sheet: ${name}`);
    images.set(name, im);
  })).then(() => {});
}
export function vesselFrame(boat: Pick<FishingBoat, 'kind' | 'phase' | 'moving'>, time: number): { name: string; frame: number; width: number; height: number } {
  const whaler = boat.kind === 'whaling';
  const action = boat.phase === 'loading' ? whaler ? 'harvest' : 'load' : boat.phase === 'unloading' && !whaler ? 'unload' : 'move';
  const name = `${whaler ? 'whaling' : 'fishing'}-${action}`, width = 16, height = whaler ? 48 : 32;
  const count = Math.max(1, Math.floor((images.get(name)?.naturalWidth ?? width) / width));
  const frameSeconds = whaler ? configuration.frameSeconds : configuration.fishing.frameSeconds;
  return { name, frame: boat.moving || action !== 'move' ? Math.floor(time / frameSeconds) % count : 0, width, height };
}
export const vesselArtKey = (boat: Pick<FishingBoat, 'kind' | 'phase' | 'moving'>, time: number): string => {
  const { name, frame } = vesselFrame(boat, time); return `${name}:${frame}`;
};
/** North-facing pixels are retained once per frame; the renderer rotates the GPU sprite. */
export function drawMaritimeVessel(c: CanvasRenderingContext2D, boat: Pick<FishingBoat, 'kind' | 'phase' | 'moving'>, time: number): boolean {
  const { name, frame, width, height } = vesselFrame(boat, time), im = images.get(name); if (!im) return false;
  c.drawImage(im, frame * width, 0, width, height, -16, -height, 32, height * 2); return true;
}
export function whaleSurfaceFrame(whale: WhaleResource, time: number): number {
  if (time < whale.readyAt || !images.has('whale')) return -1;
  const period = 10 + whale.id % 5, age = ((time + whale.id * .731) % period + period) % period;
  const frame = Math.floor(age / configuration.frameSeconds), count = images.get('whale')!.naturalWidth / 32;
  return frame < count ? frame : -1;
}
export function drawWhale(c: CanvasRenderingContext2D, frame: number): void {
  const im = images.get('whale'); if (im && frame >= 0) c.drawImage(im, frame * 32, 0, 32, 32, 0, 0, 64, 64);
}
export function drawWhalingPost(c: CanvasRenderingContext2D): boolean {
  const im = images.get('whaling-post'); if (!im) return false;
  c.drawImage(im, 0, 0, 32, 32, 0, 0, 64, 64); return true;
}
