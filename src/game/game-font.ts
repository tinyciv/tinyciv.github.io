/** The same family is used by DOM controls and cached canvas artwork. */
export const GAME_FONT_FAMILY = 'Pixel Operator';

export function gameFont(size: number, weight = 400): string {
  return `${weight} ${size}px "${GAME_FONT_FAMILY}"`;
}

let loading: Promise<void> | undefined;

/** Finish loading both real weights before any canvas text is rasterized. */
export function loadGameFonts(): Promise<void> {
  return loading ??= Promise.all([400, 700].map(async weight => {
    const faces = await document.fonts.load(gameFont(16, weight), 'Masonry 0123456789');
    if (!faces.length) throw new Error(`Pixel Operator ${weight} failed to load`);
  })).then(() => { document.documentElement.dataset.fonts = 'ready'; });
}
