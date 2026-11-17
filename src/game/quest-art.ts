let markers: HTMLImageElement | undefined;
export const QUEST_MARKER_SIZE = 18;
/** Original imagegen atlas; runtime cropping preserves the generated artwork. */
export async function loadQuestArt(): Promise<void> {
    markers = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `${import.meta.env.BASE_URL}assets/runtime/ui/quest-markers-routing.webp`;
    });
}
export function drawQuestMarker(c: CanvasRenderingContext2D, state: number, x = -QUEST_MARKER_SIZE / 2, y = -QUEST_MARKER_SIZE, size = QUEST_MARKER_SIZE): void {
    if (!markers)
        return;
    const cell = markers.width / 3, row = state === 0 ? 0 : state === 2 ? 2 : 1;
    c.save();
    c.imageSmoothingEnabled = true;
    c.drawImage(markers, 0, row * cell, cell, cell, x, y, size, size);
    c.restore();
}
/** Area geometry only; the marker itself always uses generated art. */
export function drawQuestCell(c: CanvasRenderingContext2D, edges: number): void {
    c.save();
    c.fillStyle = '#f2c94c';
    c.globalAlpha = .018;
    c.fillRect(0, 0, 32, 32);
    c.strokeStyle = '#f7d764';
    c.globalAlpha = .14;
    c.lineWidth = .75;
    c.beginPath();
    if (edges & 1) {
        c.moveTo(.5, .5);
        c.lineTo(31.5, .5);
    }
    if (edges & 2) {
        c.moveTo(31.5, .5);
        c.lineTo(31.5, 31.5);
    }
    if (edges & 4) {
        c.moveTo(31.5, 31.5);
        c.lineTo(.5, 31.5);
    }
    if (edges & 8) {
        c.moveTo(.5, 31.5);
        c.lineTo(.5, .5);
    }
    c.stroke();
    c.restore();
}
