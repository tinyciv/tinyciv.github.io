import type { Building } from './types';

type UpgradedTier = Exclude<NonNullable<Building['settlementTier']>, 0>;
type Defenses = NonNullable<Building['palaceLevel']>;

export const SETTLEMENT_SPRITE_WIDTH = 32;
export const SETTLEMENT_TIER_ART = {
    1: {
        1: { file: 'town-timber.webp', height: 42 },
        2: { file: 'city-timber.webp', height: 47 },
        3: { file: 'metropolis-timber.webp', height: 62 },
    },
    2: {
        1: { file: 'town-stone.webp', height: 42 },
        2: { file: 'city-stone.webp', height: 47 },
        3: { file: 'metropolis-stone.webp', height: 61 },
    },
} satisfies Record<Defenses, Record<UpgradedTier, { file: string; height: number }>>;

export function settlementSpriteHeight(level: Building['palaceLevel'], tier: Building['settlementTier']): number {
    return tier ? SETTLEMENT_TIER_ART[level ?? 1][tier].height : SETTLEMENT_SPRITE_WIDTH;
}
