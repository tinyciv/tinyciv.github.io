import { Container, Graphics, GraphicsContext, Sprite, Texture, WebGLRenderer } from 'pixi.js';
import { NativeArt, type BakedArt } from './native-art';
import type { TerrainChunkSource } from './terrain';

const TERRAIN_CHUNK_EDGE = 1024;
const NATIVE_TERRAIN_SCALE = .5;
const RESIDENT_TERRAIN_CHUNKS = 64;

/** The world is a native Pixi display list. Canvas is used only to bake art. */
export class PixiScene {
    readonly art = new NativeArt();
    readonly stage = new Container();
    private world = this.stage.addChild(new Container({ isRenderGroup: true }));
    private renderer = new WebGLRenderer();
    private sprites: Sprite[] = [];
    private shapes: Graphics[] = [];
    private sharedShapes: Graphics[] = [];
    private contexts = new Map<string, GraphicsContext>();
    private sharedShapeCount = 0;
    private spriteCount = 0;
    private shapeCount = 0;
    private childCount = 0;
    private sceneMutations = 0;
    private shapeKeys = new WeakMap<Graphics, readonly unknown[]>();
    private terrainRevision = 0;
    private chunks = new Map<string, { canvas: HTMLCanvasElement; texture: Texture; revision: number }>();
    private fog?: Texture;
    private rasterLayers = new Map<string, { canvas: HTMLCanvasElement; texture: Texture; key?: readonly unknown[] }>();
    private layerUploads = 0;
    private terrainUploads = 0;
    get stats() { return { ...this.art.stats, atlasPages: this.art.atlasPages, sprites: this.spriteCount, directImages: this.spriteCount,
        textureUploads: this.art.stats.textureUploads + this.terrainUploads + this.layerUploads, sceneMutations: this.sceneMutations }; }
    async initialize(canvas: HTMLCanvasElement, width: number, height: number, resolution: number) {
        await this.renderer.init({ canvas, width, height, resolution, antialias: false, background: '#000' });
    }
    resize(width: number, height: number, resolution: number) { this.renderer.resize(width, height, resolution); }
    /** Camera motion changes one group transform, leaving world geometry local. */
    setCamera(x: number, y: number): void { this.world.position.set(x, y); }
    beginFrame() {
        this.sceneMutations = 0;
        // Atlas eviction is exceptional. Detach before pruning its textures so
        // retained batches cannot refer to destroyed sources. Ordinary frames
        // retain their child order and Pixi's scene structure.
        for (const source of this.art.prune(() => {
            if (this.world.children.length) { this.world.removeChildren(); this.sceneMutations++; }
        })) source.destroy();
        this.art.beginFrame(); this.spriteCount = this.shapeCount = this.sharedShapeCount = this.childCount = this.terrainUploads = this.layerUploads = 0;
    }
    private place(child: Sprite | Graphics): void {
        if (this.world.children[this.childCount] !== child) { this.world.addChildAt(child, this.childCount); this.sceneMutations++; }
        this.childCount++;
    }
    image(texture: Texture, x: number, y: number, width: number, height: number, alpha = 1): Sprite {
        const sprite = this.sprites[this.spriteCount] ??= new Sprite({ roundPixels: true }); this.spriteCount++;
        sprite.texture = texture; sprite.position.set(x, y); sprite.width = width; sprite.height = height;
        sprite.alpha = alpha; sprite.rotation = 0; sprite.anchor.set(0); sprite.pivot.set(0); this.place(sprite); return sprite;
    }
    sprite(art: BakedArt, x: number, y: number, scale = 1, alpha = 1): Sprite {
        const sprite = this.image(art.texture, x + art.x * scale, y + art.y * scale, art.width * scale, art.height * scale, alpha);
        if (art.rotation !== undefined && art.rotationPivot) {
            // Pivot is expressed in logical world-art pixels; sheet frames may be
            // drawn at2× native scale, so convert it to texture-local pixels.
            sprite.pivot.set((art.rotationPivot.x - art.x) * art.texture.width / art.width,
                (art.rotationPivot.y - art.y) * art.texture.height / art.height);
            sprite.position.set(x + art.rotationPivot.x * scale, y + art.rotationPivot.y * scale);
            sprite.rotation = art.rotation;
        }
        for (const overlay of art.overlays ?? []) this.sprite(overlay, x, y, scale, alpha);
        return sprite;
    }
    graphics(): Graphics {
        const graphics = this.shapes[this.shapeCount] ??= new Graphics(); this.shapeCount++;
        this.shapeKeys.delete(graphics); graphics.clear(); graphics.position.set(0); this.place(graphics); return graphics;
    }
    /** Shared immutable vectors: changing a pose never rebuilds geometry. */
    sharedGraphics(key: string, draw: (context: GraphicsContext) => void, x: number, y: number, alpha = 1): Graphics {
        let context = this.contexts.get(key);
        if (!context) { context = new GraphicsContext(); draw(context); this.contexts.set(key, context); }
        const graphics = this.sharedShapes[this.sharedShapeCount] ??= new Graphics({ context }); this.sharedShapeCount++;
        graphics.context = context; graphics.position.set(x, y); graphics.alpha = alpha;
        // Pooled shapes can switch from posed route arrows to ordinary markers.
        graphics.rotation = 0; graphics.scale.set(1); graphics.pivot.set(0); graphics.skew.set(0);
        this.place(graphics); return graphics;
    }
    /** Keep expensive immutable geometry until its declared inputs change. */
    retainedGraphics(key: readonly unknown[], draw: (graphics: Graphics) => void): Graphics {
        const graphics = this.shapes[this.shapeCount] ??= new Graphics(); this.shapeCount++;
        const previous = this.shapeKeys.get(graphics);
        if (!previous || previous.length !== key.length || key.some((value, index) => value !== previous[index])) {
            graphics.clear(); draw(graphics); this.shapeKeys.set(graphics, key);
        }
        graphics.position.set(0); this.place(graphics); return graphics;
    }
    /** Dense pixel effects use one reusable texture instead of thousands of
     * transient vector rectangles and their per-frame GPU tessellation. */
    rasterLayer(name: string, key: readonly unknown[], width: number, height: number, draw: (context: CanvasRenderingContext2D) => void, x = 0, y = 0, scale = 1): void {
        width = Math.max(1, Math.ceil(width)); height = Math.max(1, Math.ceil(height));
        let layer = this.rasterLayers.get(name);
        if (layer && (layer.canvas.width !== width || layer.canvas.height !== height)) {
            layer.texture.destroy(true); this.rasterLayers.delete(name); layer = undefined;
        }
        if (!layer) {
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
            const texture = Texture.from(canvas); texture.source.scaleMode = 'nearest';
            layer = { canvas, texture }; this.rasterLayers.set(name, layer);
        }
        if (!layer.key || layer.key.length !== key.length || key.some((value, index) => value !== layer!.key![index])) {
            const context = layer.canvas.getContext('2d')!;
            context.clearRect(0, 0, width, height); context.save(); draw(context); context.restore();
            layer.texture.source.update(); layer.key = key; this.layerUploads++;
        }
        this.image(layer.texture, x, y, width * scale, height * scale);
    }
    invalidateTerrain(region?: { x: number; y: number; width: number; height: number }) {
        if (!region) { this.terrainRevision++; return; }
        // Keep clean resident chunks, including those outside the viewport.
        // Dirty offscreen chunks upload lazily when the camera reaches them.
        const left = Math.max(0, Math.floor(region.x / TERRAIN_CHUNK_EDGE));
        const top = Math.max(0, Math.floor(region.y / TERRAIN_CHUNK_EDGE));
        const right = Math.ceil((region.x + region.width) / TERRAIN_CHUNK_EDGE);
        const bottom = Math.ceil((region.y + region.height) / TERRAIN_CHUNK_EDGE);
        for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
            const chunk = this.chunks.get(`${column},${row}`);
            if (chunk) chunk.revision = -1;
        }
    }
    terrain(source: HTMLCanvasElement | TerrainChunkSource, x: number, y: number, scale: number, width: number, height: number) {
        const edge = TERRAIN_CHUNK_EDGE;
        const left = Math.max(0, Math.floor(-x / scale / edge)), top = Math.max(0, Math.floor(-y / scale / edge));
        const right = Math.min(Math.ceil(source.width / edge), Math.ceil((width - x) / scale / edge));
        const bottom = Math.min(Math.ceil(source.height / edge), Math.ceil((height - y) / scale / edge));
        const backingScale = 'paint' in source ? NATIVE_TERRAIN_SCALE : 1;
        for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
            const key = `${column},${row}`, sx = column * edge, sy = row * edge;
            let chunk = this.chunks.get(key);
            if (!chunk) {
                const width = Math.min(edge, source.width - sx), height = Math.min(edge, source.height - sy);
                const tile = document.createElement('canvas'); tile.width = width * backingScale; tile.height = height * backingScale;
                const texture = Texture.from(tile); texture.source.scaleMode = 'nearest';
                chunk = { canvas: tile, texture, revision: -1 }; this.chunks.set(key, chunk);
            }
            const logicalWidth = chunk.canvas.width / backingScale, logicalHeight = chunk.canvas.height / backingScale;
            if (chunk.revision !== this.terrainRevision) {
                const context = chunk.canvas.getContext('2d')!;
                if ('paint' in source) source.paint(context, sx, sy, logicalWidth, logicalHeight);
                else context.drawImage(source, sx, sy, logicalWidth, logicalHeight, 0, 0, logicalWidth, logicalHeight);
                chunk.texture.source.update(); chunk.revision = this.terrainRevision; this.terrainUploads++;
            }
            this.image(chunk.texture, x - this.world.x + sx * scale, y - this.world.y + sy * scale, logicalWidth * scale, logicalHeight * scale);
        }
        if (this.chunks.size > RESIDENT_TERRAIN_CHUNKS) for (const [key, chunk] of this.chunks) {
            const [column, row] = key.split(',').map(Number);
            if (column >= left && column < right && row >= top && row < bottom) continue;
            chunk.texture.destroy(true);
            this.chunks.delete(key);
            if (this.chunks.size <= RESIDENT_TERRAIN_CHUNKS) break;
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
        if (this.world.children.length > this.childCount) { this.world.removeChildren(this.childCount); this.sceneMutations++; }
        this.art.flush(); this.renderer.render(this.stage);
    }
    snapshot() {
        this.art.flush();
        return this.renderer.extract.canvas({ target: this.stage, frame: this.renderer.screen, resolution: this.renderer.resolution, clearColor: '#000' }) as HTMLCanvasElement;
    }
    resetWorld() {
        this.world.removeChildren();
        this.shapeKeys = new WeakMap();
        for (const source of this.art.clear()) source.destroy();
        for (const chunk of this.chunks.values()) chunk.texture.destroy(true);
        this.chunks.clear(); this.fog?.destroy(true); this.fog = undefined;
        for (const layer of this.rasterLayers.values()) layer.texture.destroy(true);
        this.rasterLayers.clear();
        // Shared Graphics do not own their contexts. Release users first and
        // destroy each context once at the world boundary (including zoom keys).
        for (const shape of this.sharedShapes) shape.destroy({ context: false });
        this.sharedShapes = [];
        for (const context of this.contexts.values()) context.destroy();
        this.contexts.clear();
    }
    destroy() {
        this.resetWorld(); this.art.destroy();
        for (const sprite of this.sprites) sprite.destroy();
        for (const shape of this.shapes) shape.destroy();
        this.world.destroy(); this.stage.destroy(); this.renderer.destroy();
    }
}
