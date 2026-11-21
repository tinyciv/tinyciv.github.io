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

export function fitGameHud(area: HTMLElement): void {
  // Size the HUD from the visible game area so page zoom scales its layout and
  // display in opposite directions. The world canvas uses viewport coordinates.
  const observer = new ResizeObserver(([{ contentRect: { width, height } }]) => {
    if (!area.isConnected) { observer.disconnect(); return; }
    if (!width || !height) return;
    const desktopScale = Math.min(width / 360, height / 900);
    const touchScale = width >= height
      ? Math.min(width / 780, height / 360)
      : Math.min(width / 360, height / 640);
    area.style.setProperty('--desktop-hud-scale', String(desktopScale));
    area.style.setProperty('--touch-hud-scale', String(touchScale));
  });
  observer.observe(area);
}
