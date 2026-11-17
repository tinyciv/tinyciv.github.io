import { runtimeArtUrl } from './runtime-art';

/** Approved PixelLab 1C, kept at its original native frame dimensions. */
export const SHELL_IMPACT_FRAME_SIZE = 32;
export const SHELL_IMPACT_FRAME_COUNT = 9;
export const SHELL_IMPACT_FRAME_SECONDS = .1;
export const SHELL_IMPACT_SECONDS = SHELL_IMPACT_FRAME_COUNT * SHELL_IMPACT_FRAME_SECONDS;
export const SHELL_IMPACT_BOUNDS = Object.freeze({ x: -32, y: -32, width: 64, height: 64 });
let image: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;

export function loadShellImpactArt(): Promise<void> {
  return loading ??= (async () => {
    const sheet = new Image();
    sheet.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/effects/shell-impact/black-powder-1c.png`);
    await sheet.decode();
    if (sheet.naturalWidth !== SHELL_IMPACT_FRAME_SIZE * SHELL_IMPACT_FRAME_COUNT || sheet.naturalHeight !== SHELL_IMPACT_FRAME_SIZE)
      throw new Error('Invalid black-powder shell impact artwork');
    image = sheet;
  })();
}

export const shellImpactImage = (): HTMLImageElement | undefined => image;

/** Only interpolate a native impact event's drawing frame; lifetime and
 * ground position remain owned by the Rust simulation. */
export function shellImpactFrame(startedAt: number, time: number): number {
  const age = time - startedAt;
  return !Number.isFinite(age) || age < 0 || age >= SHELL_IMPACT_SECONDS ? -1
    : Math.min(SHELL_IMPACT_FRAME_COUNT - 1, Math.floor((age + 1e-7) / SHELL_IMPACT_FRAME_SECONDS));
}
