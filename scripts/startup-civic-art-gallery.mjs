import { mkdir } from 'node:fs/promises';

/** Photograph the standalone art review; no simulation or input events. */
export async function captureCivicArtGallery(page) {
  const gallery = await page.context().browser().newPage({ viewport: { width: 1200, height: 1000 } });
  try {
    await gallery.goto(new URL('/scratch/2026-11-17-civic-industry/index.html', page.url()).href, { waitUntil: 'load' });
    await gallery.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
    });
    await mkdir('output/startup', { recursive: true });
    await gallery.screenshot({ path: 'output/startup/civic-art-gallery.png', fullPage: true });
  } finally { await gallery.close(); }
}
