import { runtimeArtUrl } from './runtime-art';
import { gameFont } from './game-font';
const spriteNames = [
    ['ruins-a', 'ruins-b', 'ruins-c'],
    ['hut-a', 'hut-b'],
    ['fossil-a', 'fossil-b', 'fossil-c'],
];
let sprites: HTMLImageElement[][] = [];
export async function loadExplorationArt(): Promise<void> {
    const load = (name: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = reject;
        image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/exploration/${name}.png`);
    });
    sprites = await Promise.all(spriteNames.map(group => Promise.all(group.map(load))));
}
export function drawExplorationSite(c: CanvasRenderingContext2D, kind: number, variant: number): void {
    const image = sprites[kind]?.[variant];
    c.imageSmoothingEnabled = false;
    if (image) c.drawImage(image, 0, 0);
}

/** Shared by the retained renderer texture and isolated visual preview. */
export function paintExplorationMessage(c: CanvasRenderingContext2D, text: string): void {
    c.font = gameFont(24); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillStyle = '#fff';
    c.strokeStyle = '#1d211a'; c.lineWidth = 4; c.lineJoin = 'round';
    const lines: string[] = []; let line = '';
    for (const word of text.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && c.measureText(next).width > 600) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
    lines.forEach((text, i) => { const y = (i - lines.length + 1) * 28; c.strokeText(text, 0, y); c.fillText(text, 0, y); });
}
