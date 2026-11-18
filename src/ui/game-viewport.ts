export function fitGameViewport(area: HTMLElement): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  // The browser can zoom or pan the visible area without resizing its layout viewport.
  let frame = 0;
  const fit = () => {
    frame = 0;
    const { width, height, offsetLeft, offsetTop } = viewport;
    const fitsLayout = !offsetLeft && !offsetTop
      && Math.abs(width - window.innerWidth) < 1 && Math.abs(height - window.innerHeight) < 1;
    area.style.width = fitsLayout ? '' : `${width}px`;
    area.style.height = fitsLayout ? '' : `${height}px`;
    area.style.left = fitsLayout ? '' : `${offsetLeft}px`;
    area.style.top = fitsLayout ? '' : `${offsetTop}px`;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  fit();
}
