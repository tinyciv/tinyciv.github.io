import { Container, Graphics, Sprite, Texture, WebGLRenderer } from 'pixi.js';
import { NativeArt, type BakedArt } from './native-art';

/** The world is a native Pixi display list. Canvas is used only to bake art. */
export class PixiScene {
    readonly art = new NativeArt();
    readonly stage = new Container();
    private renderer = new WebGLRenderer();
    private sprites: Sprite[] = [];
    private shapes: Graphics[] = [];
    private spriteCount = 0;
    private shapeCount = 0;
    private childCount = 0;
    private sceneMutations = 0;
    private shapeKeys = new WeakMap<Graphics, readonly unknown[]>();
    private terrainRevision = 0;
    private chunks = new Map<string, { canvas: HTMLCanvasElement; texture: Texture; revision: number }>();
    private fog?: Texture;
    private terrainUploads = 0;
    get stats() { return { ...this.art.stats, atlasPages: this.art.atlasPages, sprites: this.spriteCount, directImages: this.spriteCount,
        textureUploads: this.art.stats.textureUploads + this.terrainUploads, sceneMutations: this.sceneMutations }; }
    async initialize(canvas: HTMLCanvasElement, width: number, height: number, resolution: number) {
        await this.renderer.init({ canvas, width, height, resolution, antialias: false, background: '#000' });
    }
    resize(width: number, height: number, resolution: number) { this.renderer.resize(width, height, resolution); }
    beginFrame() {
        this.sceneMutations = 0;
        // Atlas eviction is exceptional. Detach before pruning its textures so
        // retained batches cannot refer to destroyed sources. Ordinary frames
        // retain their child order and Pixi's scene structure.
        if (this.art.atlasPages > 8 && this.stage.children.length) { this.stage.removeChildren(); this.sceneMutations++; }
        for (const source of this.art.prune()) source.destroy();
        this.art.beginFrame(); this.spriteCount = this.shapeCount = this.childCount = this.terrainUploads = 0;
    }
    private place(child: Sprite | Graphics): void {
        if (this.stage.children[this.childCount] !== child) { this.stage.addChildAt(child, this.childCount); this.sceneMutations++; }
        this.childCount++;
    }
    image(texture: Texture, x: number, y: number, width: number, height: number, alpha = 1): Sprite {
        const sprite = this.sprites[this.spriteCount] ??= new Sprite(); this.spriteCount++;
        sprite.texture = texture; sprite.position.set(x, y); sprite.width = width; sprite.height = height;
        sprite.alpha = alpha; sprite.rotation = 0; sprite.anchor.set(0); sprite.pivot.set(0); this.place(sprite); return sprite;
    }
    sprite(art: BakedArt, x: number, y: number, scale = 1, alpha = 1): Sprite {
        const sprite = this.image(art.texture, x + art.x * scale, y + art.y * scale, art.width * scale, art.height * scale, alpha);
        if (art.rotation !== undefined && art.rotationPivot) {
            sprite.pivot.set(art.rotationPivot.x - art.x, art.rotationPivot.y - art.y);
            sprite.position.set(x + art.rotationPivot.x * scale, y + art.rotationPivot.y * scale);
            sprite.rotation = art.rotation;
        }
        for (const overlay of art.overlays ?? []) this.sprite(overlay, x, y, scale, alpha);
        return sprite;
    }
    graphics(): Graphics {
        const graphics = this.shapes[this.shapeCount] ??= new Graphics(); this.shapeCount++;
        this.shapeKeys.delete(graphics); graphics.clear(); this.place(graphics); return graphics;
    }
    /** Keep expensive immutable geometry until its declared inputs change. */
    retainedGraphics(key: readonly unknown[], draw: (graphics: Graphics) => void): Graphics {
        const graphics = this.shapes[this.shapeCount] ??= new Graphics(); this.shapeCount++;
        const previous = this.shapeKeys.get(graphics);
        if (!previous || previous.length !== key.length || key.some((value, index) => value !== previous[index])) {
            graphics.clear(); draw(graphics); this.shapeKeys.set(graphics, key);
        }
        this.place(graphics); return graphics;
    }
    invalidateTerrain(region?: { x: number; y: number; width: number; height: number }) {
        if (!region) { this.terrainRevision++; return; }
        // Keep clean resident chunks, including those outside the viewport.
        // Dirty offscreen chunks upload lazily when the camera reaches them.
        for (const [key, chunk] of this.chunks) {
            const [column, row] = key.split(',').map(Number), x = column * 1024, y = row * 1024;
            if (x < region.x + region.width && x + chunk.canvas.width > region.x
                && y < region.y + region.height && y + chunk.canvas.height > region.y) chunk.revision = -1;
        }
    }
    terrain(canvas: HTMLCanvasElement, x: number, y: number, scale: number, width: number, height: number) {
        const edge = 1024;
        const left = Math.max(0, Math.floor(-x / scale / edge)), top = Math.max(0, Math.floor(-y / scale / edge));
        const right = Math.min(Math.ceil(canvas.width / edge), Math.ceil((width - x) / scale / edge));
        const bottom = Math.min(Math.ceil(canvas.height / edge), Math.ceil((height - y) / scale / edge));
        for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
            const key = `${column},${row}`, sx = column * edge, sy = row * edge;
            let chunk = this.chunks.get(key);
            if (!chunk) {
                const tile = document.createElement('canvas'); tile.width = Math.min(edge, canvas.width - sx); tile.height = Math.min(edge, canvas.height - sy);
                const texture = Texture.from(tile); texture.source.scaleMode = 'nearest';
                chunk = { canvas: tile, texture, revision: -1 }; this.chunks.set(key, chunk);
            }
            if (chunk.revision !== this.terrainRevision) {
                chunk.canvas.getContext('2d')!.drawImage(canvas, sx, sy, chunk.canvas.width, chunk.canvas.height, 0, 0, chunk.canvas.width, chunk.canvas.height);
                chunk.texture.source.update(); chunk.revision = this.terrainRevision; this.terrainUploads++;
            }
            this.image(chunk.texture, x + sx * scale, y + sy * scale, chunk.canvas.width * scale, chunk.canvas.height * scale);
        }
    }
    updateFog(canvas: HTMLCanvasElement) {
        if (!this.fog || this.fog.source.width !== canvas.width || this.fog.source.height !== canvas.height) {
            this.fog?.destroy(true); this.fog = Texture.from(canvas); this.fog.source.scaleMode = 'linear';
        }
        this.fog.source.update();
    }
    drawFog(x: number, y: number, width: number, height: number) { if (this.fog) this.image(this.fog, x, y, width, height); }
    finishFrame() {
        if (this.stage.children.length > this.childCount) { this.stage.removeChildren(this.childCount); this.sceneMutations++; }
        this.art.flush(); this.renderer.render(this.stage);
    }
    snapshot() {
        this.art.flush();
        return this.renderer.extract.canvas({ target: this.stage, frame: this.renderer.screen, resolution: this.renderer.resolution, clearColor: '#000' }) as HTMLCanvasElement;
    }
    resetWorld() {
        this.stage.removeChildren();
        this.shapeKeys = new WeakMap();
        for (const source of this.art.clear()) source.destroy();
        for (const chunk of this.chunks.values()) chunk.texture.destroy(true);
        this.chunks.clear(); this.fog?.destroy(true); this.fog = undefined;
    }
    destroy() {
        this.resetWorld(); this.art.destroy();
        for (const sprite of this.sprites) sprite.destroy();
        for (const shape of this.shapes) shape.destroy();
        this.stage.destroy(); this.renderer.destroy();
    }
}
