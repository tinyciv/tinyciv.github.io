import { mkdir } from 'node:fs/promises';

/** Capture retained frontend forms over the paused initial world; no request is sent. */
export async function captureFeedbackPreview(page) {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.evaluate(async () => {
    window.__game.state.paused = true;
    const { Frontend } = await import('/src/ui/frontend.ts');
    const host = document.createElement('div'); document.body.append(host);
    const frontend = new Frontend(host, () => { throw new Error('Feedback preview must not send requests'); });
    frontend.show('main');
    frontend.openFeedback();
    await Promise.all([...host.querySelectorAll('img')].map(image => image.decode()));
    window.__feedbackReview = { frontend, host, time: window.__game.state.time };
  });
  await mkdir('output/startup', { recursive: true });
  await page.screenshot({ path: 'output/startup/help-feedback.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'output/startup/help-feedback-mobile.png' });
  await page.evaluate(() => {
    if (!window.__game.state.paused || window.__game.state.time !== window.__feedbackReview.time)
      throw new Error('Feedback preview must remain frozen');
    window.__feedbackReview.host.remove();
  });
}
