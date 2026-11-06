/** Small shared UI frames, independent of the static construction pegs. */
export const CONSTRUCTION_TIMER_STEPS = 64;
export const CONSTRUCTION_TIMER_RADIUS = 6;

/** Remaining work drains clockwise from twelve o'clock. No hands or text. */
export function drawConstructionTimer(c: CanvasRenderingContext2D, frame: number): void {
    const remaining = Math.max(0, Math.min(CONSTRUCTION_TIMER_STEPS, frame)) / CONSTRUCTION_TIMER_STEPS;
    const radius = CONSTRUCTION_TIMER_RADIUS - 1;
    c.save();
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fillStyle = '#302b25cc'; c.fill();
    if (remaining > 0) {
        c.beginPath(); c.moveTo(0, 0);
        c.arc(0, 0, radius, -Math.PI / 2 + (1 - remaining) * Math.PI * 2, Math.PI * 1.5);
        c.closePath(); c.fillStyle = '#e7d4a0'; c.fill();
    }
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2);
    c.strokeStyle = '#44392a'; c.lineWidth = 1; c.stroke();
    c.restore();
}
