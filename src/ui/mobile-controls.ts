import type { InputState } from '../game/types';
import './mobile-controls.css';

/** Touch controls reuse the keyboard input protocol, including authoritative
 * multiplayer movement and formation/boat steering. */
export class MobileControls {
  readonly element = document.createElement('div');
  private stick: HTMLElement;
  private knob: HTMLElement;
  private pointer: number | undefined;
  private enabled = false;
  private turnPointers = new Map<HTMLButtonElement, number>();
  private media = matchMedia('(pointer: coarse)');
  constructor(parent: HTMLElement, private input: InputState, private changed: () => void, private follow: () => void) {
    this.element.className = 'mobile-controls';
    this.element.innerHTML = `<div class="mobile-stick" role="group" aria-label="Move Leader"><span class="mobile-stick-cross" aria-hidden="true"></span><span class="mobile-stick-knob" aria-hidden="true"></span></div><div class="mobile-turns" hidden><button data-turn="left" aria-label="Turn left">↶</button><button data-turn="right" aria-label="Turn right">↷</button></div><button class="mobile-center" aria-label="Follow Leader">Center</button><span class="mobile-rotate-hint">Rotate your device for a wider view</span>`;
    parent.append(this.element);
    this.stick = this.element.querySelector('.mobile-stick')!;
    this.knob = this.element.querySelector('.mobile-stick-knob')!;
    this.stick.addEventListener('pointerdown', event => {
      if (!this.enabled || this.pointer !== undefined) return;
      event.preventDefault(); this.pointer = event.pointerId;
      this.stick.setPointerCapture(event.pointerId); this.follow(); this.move(event);
    });
    this.stick.addEventListener('pointermove', event => { if (event.pointerId === this.pointer) this.move(event); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.stick.addEventListener(type, event => { if (event.pointerId === this.pointer) this.reset(true); });
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-turn]')) {
      const field = button.dataset.turn === 'left' ? 'turnLeft' : 'turnRight';
      button.addEventListener('pointerdown', event => {
        if (!this.enabled || this.turnPointers.has(button)) return;
        event.preventDefault(); this.turnPointers.set(button, event.pointerId); button.setPointerCapture(event.pointerId); this.input[field] = true; this.changed();
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) button.addEventListener(type, event => {
        if (this.turnPointers.get(button) !== event.pointerId) return;
        this.turnPointers.delete(button); this.input[field] = false;
        if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
        this.changed();
      });
    }
    this.element.querySelector<HTMLButtonElement>('.mobile-center')!.onclick = this.follow;
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    this.media.addEventListener('change', () => this.reset());
  }
  private move(event: PointerEvent) {
    event.preventDefault();
    const rect = this.stick.getBoundingClientRect(), radius = rect.width * .32;
    const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(x, y), scale = Math.min(1, radius / Math.max(1, distance));
    this.knob.style.transform = `translate(${x * scale}px,${y * scale}px)`;
    const active = distance > 11, threshold = distance * .38;
    this.input.left = active && x < -threshold; this.input.right = active && x > threshold;
    this.input.up = active && y < -threshold; this.input.down = active && y > threshold;
    this.changed();
  }
  reset(stickOnly = false) {
    const hadPointer = this.pointer !== undefined, turning = this.input.turnLeft || this.input.turnRight;
    const pointer = this.pointer; this.pointer = undefined; this.knob.style.transform = '';
    if (pointer !== undefined && this.stick.hasPointerCapture(pointer)) this.stick.releasePointerCapture(pointer);
    if (!stickOnly) {
      for (const [button, id] of this.turnPointers) if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
      this.turnPointers.clear();
    }
    if (hadPointer) this.input.up = this.input.down = this.input.left = this.input.right = false;
    if (!stickOnly) this.input.turnLeft = this.input.turnRight = false;
    if (hadPointer || turning) this.changed();
  }
  update(enabled: boolean, steering: boolean) {
    enabled = enabled && this.media.matches;
    if (this.enabled && !enabled) this.reset();
    this.enabled = enabled; this.element.hidden = !enabled;
    if (!steering && (this.input.turnLeft || this.input.turnRight)) { this.input.turnLeft = this.input.turnRight = false; this.changed(); }
    this.element.querySelector<HTMLElement>('.mobile-turns')!.hidden = !steering;
  }
}
