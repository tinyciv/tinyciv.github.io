import { vi } from 'vitest';
import { Renderer } from '../../src/game/renderer';
import { deathAnimationFrame } from '../../src/game/combat-effect-art';
import { ResourceArtMemory, resourceObjectKey, type ResourceCellArt } from '../../src/game/resource-art';
import * as fogModule from '../../src/game/fog';
import type { GameState, Point } from '../../src/game/types';

interface Text { key: string; text: string; x: number; y: number; color: string; alpha: number }
interface Rect { key: string; x: number; y: number; width: number; height: number; color: string; alpha: number }
interface ImageRect { key: string; x: number; y: number; width: number; height: number; source: number[] }
interface Stroke { key: string; color: string; width: number; opacity: number; dash: number[]; offset: number; commands: number[][] }
interface Picture { key: string; texts?: Text[]; rects?: Rect[]; images?: ImageRect[]; strokes?: Stroke[] }
interface Shape { rect(...args: number[]): Shape; roundRect(...args: number[]): Shape; fill(style: string | { color: string; alpha?: number }): Shape }

/** Exercise the real world compositor without a browser/GPU. Only the final
 * Pixi display list and offscreen text/path baking are replaced by recorders. */
export function recordNativeFrame(state: GameState, options: { fog?: fogModule.FogView; size?: number; ox?: number; oy?: number; width?: number; height?: number;
    buildPreview?: Point[]; paintFieldMasks?: boolean } = {}) {
    const texts: Text[] = [], rects: Rect[] = [], images: ImageRect[] = [], strokes: Stroke[] = [], sprites: { key: string; x: number; y: number; scale: number; alpha: number }[] = [], drawOrder: string[] = [];
    const paint = (key: string, _bounds: unknown, draw: (c: CanvasRenderingContext2D) => void): Picture => {
        const picture = { key, texts: [] as Text[], rects: [] as Rect[], images: [] as ImageRect[], strokes: [] as Stroke[] };
        let commands: number[][] = [], dash: number[] = [];
        const context = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1, lineDashOffset: 0,
            measureText: (text: string) => ({ width: text.length * 7 }),
            fillText(text: string, x: number, y: number) { picture.texts.push({ key, text, x, y, color: this.fillStyle, alpha: this.globalAlpha }); },
            fillRect(x: number, y: number, width: number, height: number) { picture.rects.push({ key, x, y, width, height, color: this.fillStyle, alpha: this.globalAlpha }); },
            roundRect(x: number, y: number, width: number, height: number) { this.fillRect(x, y, width, height); },
            drawImage(_image: unknown, sx: number, sy: number, sw: number, sh: number, x: number, y: number, width: number, height: number) {
                if (height !== undefined) picture.images.push({ key, x, y, width, height, source: [sx, sy, sw, sh] });
            },
            beginPath() { commands = []; }, moveTo(...args: number[]) { commands.push([0, ...args]); },
            lineTo(...args: number[]) { commands.push([1, ...args]); }, quadraticCurveTo(...args: number[]) { commands.push([2, ...args]); },
            setLineDash(value: number[]) { dash = value; },
            stroke() { picture.strokes.push({ key, color: this.strokeStyle, width: this.lineWidth, opacity: this.globalAlpha,
                dash: [...dash], offset: this.lineDashOffset, commands: commands.map(command => [...command]) }); } };
        draw(new Proxy(context, { get: (target, property) => property in target ? Reflect.get(target, property) : () => {} }) as unknown as CanvasRenderingContext2D);
        return picture;
    };
    const sprite = (picture: Picture, x: number, y: number, scale = 1, alpha = 1) => {
        drawOrder.push(picture.key);
        sprites.push({ key: picture.key, x, y, scale, alpha });
        for (const text of picture.texts ?? []) texts.push({ ...text, x: x + text.x * scale, y: y + text.y * scale, alpha: text.alpha * alpha });
        for (const rect of picture.rects ?? []) rects.push({ ...rect, x: x + rect.x * scale, y: y + rect.y * scale, width: rect.width * scale, height: rect.height * scale, alpha: rect.alpha * alpha });
        for (const image of picture.images ?? []) images.push({ ...image, x: x + image.x * scale, y: y + image.y * scale, width: image.width * scale, height: image.height * scale });
        for (const stroke of picture.strokes ?? []) strokes.push({ ...stroke, opacity: stroke.opacity * alpha,
            commands: stroke.commands.map(command => command.map((value, i) => i === 0 ? value : value * scale + (i % 2 ? x : y))) });
        return { pivot: { set() {} }, position: { set() {} }, rotation: 0 };
    };
    const graphics = () => {
        let pending: number[][] = [];
        let proxy: Shape;
        const shape: Shape = { rect(...args: number[]) { pending.push(args); return proxy; }, roundRect(...args: number[]) { return shape.rect(...args); },
            fill(style: string | { color: string; alpha?: number }) {
                for (const [x, y, width, height] of pending) rects.push({ key: '', x, y, width, height,
                    color: typeof style === 'string' ? style : style.color, alpha: typeof style === 'string' ? 1 : style.alpha ?? 1 });
                pending = []; return proxy;
            } };
        return proxy = new Proxy(shape, { get: (target, property) => property in target ? Reflect.get(target, property) : () => proxy });
    };
    const { size = 32, ox = 0, oy = 0, width = 3000, height = 2000 } = options;
    const art = { paint, building: () => ({ key: 'building' }),
        field: (_field: unknown, _time: number, _key: string, mask: (c: CanvasRenderingContext2D) => void) =>
            options.paintFieldMasks ? paint('field', {}, mask) : ({ key: 'field' }),
        unit: (_unit: unknown, _time: number, _color: string, effect?: { damageMask?: boolean }) => ({
            key: effect?.damageMask ? 'unit-damage' : 'unit' }),
        death: (age: number) => deathAnimationFrame(age) < 0 ? undefined : ({ key: `unit-death:${deathAnimationFrame(age)}` }),
        vegetation: () => ({ key: 'vegetation' }), overlay: () => ({ key: 'overlay' }),
        resource: (resource: ResourceCellArt) => ({ key: `resource:${resourceObjectKey(resource)}` }),
        resourceOutline: (resource: ResourceCellArt, color: string) => ({ key: `resource-outline:${resourceObjectKey(resource)}:${color}` }),
        resourceFence: (resource: ResourceCellArt, front: boolean) => ({ key: `resource-fence:${resource.fences}:${resource.gate}:${front}` }) };
    const renderer = Object.assign(Object.create(Renderer.prototype), {
        gpu: { art, beginFrame() {}, terrain() {}, sprite, graphics,
            retainedGraphics(_key: unknown, draw: (shape: Shape) => void) { const shape = graphics(); draw(shape); return shape; },
            drawFog() { drawOrder.push('fog'); }, finishFrame() {} },
        width, height, zoom: size / 32, camera: { x: (width / 2 - ox) / size, y: (height / 2 - oy) / size }, follow: false,
        terrain: {}, fogCanvas: {}, resourceMemory: new ResourceArtMemory(), buildPreview: options.buildPreview ?? [], hover: null, areaPreview: null, prepare() {}, prepareFog() {}, drawMinimap() {},
    }) as Renderer;
    const fog = options.fog && vi.spyOn(fogModule, 'presentationFog').mockReturnValue(options.fog);
    try { renderer.draw(state, 0); } finally { fog?.mockRestore(); }
    return { renderer, sprites, texts, rects, images, strokes, drawOrder };
}
