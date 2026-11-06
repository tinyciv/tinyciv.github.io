/** Scholar discounts retain exact math; labels stay within the compact HUD. */
export const formatResearchCost = (points: number): string => String(Number(points.toFixed(1)));
