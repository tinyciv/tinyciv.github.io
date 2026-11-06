/** Approved subtle hit pulse, 1A forward buckle, and 2A steady skeleton decay. */
export const DAMAGE_FLASH_DURATION = .16;
export const DAMAGE_FLASH_PEAK = .22;
export const DEATH_FRAME_SIZE = 40;
export const DEATH_GROUND_ANCHOR = [20, 30] as const;
export const DEATH_FALL_FRAME_DURATIONS_MS = [80, 95, 105, 95, 90, 100] as const;
export const DECAY_FRAME_SIZE = 48;
export const DECAY_GROUND_ANCHOR = [24, 34] as const;
export const DEATH_DECAY_FRAME_DURATIONS_MS = [200, 400, 600, 800, 950, 1050] as const;
export const DEATH_FRAME_DURATIONS_MS = [...DEATH_FALL_FRAME_DURATIONS_MS, ...DEATH_DECAY_FRAME_DURATIONS_MS] as const;
export const DEATH_ANIMATION_DURATION = DEATH_FRAME_DURATIONS_MS.reduce((sum, ms) => sum + ms, 0) / 1000;

let deathAnimation: HTMLImageElement | undefined;
let decayAnimation: HTMLImageElement | undefined;
let loading: Promise<void> | undefined;
const damageMasks = new WeakMap<HTMLImageElement | HTMLCanvasElement, HTMLCanvasElement>();

export function loadCombatEffectArt(): Promise<void> {
    return loading ??= (async () => {
        const loadSheet = async (file: string, size: number, count: number): Promise<HTMLImageElement> => {
            const image = new Image();
            image.src = `${import.meta.env.BASE_URL}assets/combat/${file}`;
            await image.decode();
            if (image.naturalWidth !== size * count || image.naturalHeight !== size)
                throw new Error(`Invalid shared death animation artwork: ${file}`);
            return image;
        };
        [deathAnimation, decayAnimation] = await Promise.all([
            loadSheet('forward-buckle.png', DEATH_FRAME_SIZE, DEATH_FALL_FRAME_DURATIONS_MS.length),
            loadSheet('steady-sink.png', DECAY_FRAME_SIZE, DEATH_DECAY_FRAME_DURATIONS_MS.length),
        ]);
    })();
}

export const deathAnimationImage = (): HTMLImageElement | undefined => deathAnimation;
export const decayAnimationImage = (): HTMLImageElement | undefined => decayAnimation;

/** One subtle red pulse, with no tint outside the hit's lifetime. */
export function damageFlashWeight(age: number): number {
    if (!Number.isFinite(age) || age <= 0 || age >= DAMAGE_FLASH_DURATION) return 0;
    return DAMAGE_FLASH_PEAK * Math.sin(Math.PI * age / DAMAGE_FLASH_DURATION);
}

/** Six fall poses followed immediately by six decay poses. -1 means no remains. */
export function deathAnimationFrame(age: number): number {
    if (!Number.isFinite(age) || age < 0) return -1;
    const elapsedMs = age * 1000;
    let endMs = 0;
    for (let frame = 0; frame < DEATH_FRAME_DURATIONS_MS.length; frame++) {
        endMs += DEATH_FRAME_DURATIONS_MS[frame];
        // Subtracting simulation timestamps can put an exact boundary just below its millisecond.
        if (elapsedMs + 1e-7 < endMs) return frame;
    }
    return -1;
}

/** A reusable flat red sheet retaining exactly the source alpha silhouette.
 * Runtime hit intensity is applied to the overlay, leaving the source intact. */
export function damageMaskSheet(source: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
    const cached = damageMasks.get(source);
    if (cached) return cached;
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!width || !height) throw new Error('Damage mask source has no decoded pixels.');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(source, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = '#de3830';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    damageMasks.set(source, canvas);
    return canvas;
}
