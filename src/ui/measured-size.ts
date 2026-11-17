/** Border-box size kept current by a ResizeObserver, so per-frame positioning
 * never forces a synchronous layout after the frame's DOM writes. A hidden
 * element observes as 0×0; the first read after it reappears measures once. */
export class MeasuredSize {
  private width = 0;
  private height = 0;
  private readonly observer?: ResizeObserver;

  constructor(private readonly element: HTMLElement) {
    if (typeof ResizeObserver !== 'function') return;
    this.observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1], box = entry?.borderBoxSize?.[0];
      if (box) { this.width = box.inlineSize; this.height = box.blockSize; }
      else { this.width = 0; this.height = 0; }
    });
    this.observer.observe(element);
  }

  read(): { width: number; height: number } {
    if (!this.observer || !this.width && !this.height) {
      this.width = this.element.offsetWidth; this.height = this.element.offsetHeight;
    }
    return { width: this.width, height: this.height };
  }
}
