/** Presentation only: calculations retain their full precision. */
export const wholeNumber = (value: number): string => String(Math.round(value));
export const constructionGoldText = (value: number): string => String(Number(value.toFixed(3)));

/** Percentages preserve useful fractional multipliers without decimal labels. */
export const multiplierPercent = (value: number): string => `${Math.round(value * 100)}%`;
