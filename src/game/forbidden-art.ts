/** Native-size planning marks; baked once into the shared UI atlas. */
export function drawForbiddenCell(c: CanvasRenderingContext2D, exposedEdges: number): void {
    c.fillStyle = '#ffffff'; c.globalAlpha = .055; c.fillRect(0, 0, 32, 32);
    c.globalAlpha = .12; c.lineWidth = .6; c.strokeStyle = '#ffffff';
    c.strokeRect(.5, .5, 31, 31);
    c.globalAlpha = .48; c.lineWidth = 1.1; c.beginPath();
    if (exposedEdges & 1) { c.moveTo(.5, .5); c.lineTo(31.5, .5); }
    if (exposedEdges & 2) { c.moveTo(31.5, .5); c.lineTo(31.5, 31.5); }
    if (exposedEdges & 4) { c.moveTo(31.5, 31.5); c.lineTo(.5, 31.5); }
    if (exposedEdges & 8) { c.moveTo(.5, 31.5); c.lineTo(.5, .5); }
    c.stroke(); c.globalAlpha = 1;
}

/** A white prohibition circle with a diagonal stroke and a quiet dark halo. */
export function drawForbiddenMarker(c: CanvasRenderingContext2D): void {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2);
    c.fillStyle = '#1d282d55'; c.fill();
    c.strokeStyle = '#182226bb'; c.lineWidth = 4.8; c.stroke();
    c.strokeStyle = '#ffffff'; c.lineWidth = 2.4; c.stroke();
    c.beginPath(); c.moveTo(-5.7, 5.7); c.lineTo(5.7, -5.7); c.stroke();
    c.restore();
}
