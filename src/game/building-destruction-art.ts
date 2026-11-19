import { runtimeArtUrl } from './runtime-art';
import type { BuildingDestruction } from './types';

export const BUILDING_DESTRUCTION_SECONDS = 4 / 3;
export const BUILDING_RUBBLE_FADE_SECONDS = 10 / 3;
export const BUILDING_DESTRUCTION_LIFETIME = BUILDING_DESTRUCTION_SECONDS + BUILDING_RUBBLE_FADE_SECONDS;
const FRAME_COUNTS = { 1: 17, 2: 16 } as const;
const sheets = new Map<number, { animation: HTMLImageElement; rubble: HTMLImageElement }>();
let loading: Promise<void> | undefined;

export function loadBuildingDestructionArt(): Promise<void> {
    return loading ??= (async () => {
        await Promise.all(([1, 2] as const).map(async size => {
            const load = async (file: string, count: number) => {
                const image = new Image();
                image.src = runtimeArtUrl(`${import.meta.env.BASE_URL}assets/building-destruction/${size}x${size}/${file}`);
                await image.decode();
                if (image.naturalWidth !== size * 16 * count || image.naturalHeight !== size * 16)
                    throw new Error(`Invalid building destruction artwork: ${size}x${size}/${file}`);
                return image;
            };
            const [animation, rubble] = await Promise.all([load('destruction.png', FRAME_COUNTS[size]), load('rubble.png', 1)]);
            sheets.set(size, { animation, rubble });
        }));
    })();
}
export const buildingDestructionImage = (size: 1 | 2, rubble: boolean): HTMLImageElement | undefined =>
    rubble ? sheets.get(size)?.rubble : sheets.get(size)?.animation;

/** Rendering interpolation only. The ECS owns the underlying event lifetime. */
export function buildingDestructionPose(effect: BuildingDestruction, time: number):
    { size: 1 | 2; frame: number; rubble: boolean; alpha: number; showBuilding: boolean } | undefined {
    const kind = effect.kind ?? effect.building?.kind;
    if (kind === 'wall' || kind === 'palisade' || kind === 'tower' || kind === 'woodenTower' || kind === 'scoutTower') return;
    const age = time - effect.time;
    if (!Number.isFinite(age) || age < 0 || age >= BUILDING_DESTRUCTION_LIFETIME) return;
    const size = effect.width === 2 && effect.height === 2 ? 2 : 1;
    if (age >= BUILDING_DESTRUCTION_SECONDS)
        return { size, frame: 0, rubble: true, alpha: 1 - (age - BUILDING_DESTRUCTION_SECONDS) / BUILDING_RUBBLE_FADE_SECONDS, showBuilding: false };
    const count = FRAME_COUNTS[size];
    let frame = 0;
    while (frame < count - 1 && age * 3000 + 1e-7 >= Math.floor((frame + 1) * 4000 / count)) frame++;
    return { size, frame, rubble: false, alpha: 1, showBuilding: age < 2.5 / 3 };
}
