import type { Building } from './types';

export const LOYALTY_START = 75;
export const LOYALTY_GRACE = 120;
export const LOYALTY_INTERVAL = 5;
export const LOYALTY_TRAUMA_HALF_LIFE = 120;
export interface CityLoyalty {
  value: number; target: number; rate: number; trauma: number; traumaAt: number; graceUntil: number;
  pressure: number; support: number; advanced: number; monument: number; guards: number;
}
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
export function initialCityLoyalty(time: number, value = LOYALTY_START): CityLoyalty {
  return { value, target: 70, rate: 0, trauma: 0, traumaAt: time, graceUntil: time + LOYALTY_GRACE,
    pressure: 0, support: 0, advanced: 0, monument: 0, guards: 0 };
}
export function loyaltyTarget(input: Pick<CityLoyalty, 'pressure' | 'support' | 'advanced' | 'monument' | 'guards' | 'trauma'>): number {
  return clamp(70 + input.support + Math.min(20, input.advanced * 4) + (input.monument ? 12 : 0)
    + input.guards * 3 - 55 * Math.sqrt(clamp(input.pressure, 0, 1)) - input.trauma, -40, 100);
}
export function citySupport(distance: number | undefined): number {
  return distance === undefined ? 0 : clamp(12 - Math.max(0, distance - 20) * .6, -24, 12);
}
export function advanceLoyalty(loyalty: CityLoyalty, elapsed: number, time: number): void {
  loyalty.trauma *= 2 ** (-Math.max(0, time - loyalty.traumaAt) / LOYALTY_TRAUMA_HALF_LIFE); loyalty.traumaAt = time;
  loyalty.target = loyaltyTarget(loyalty);
  loyalty.rate = clamp((loyalty.target - loyalty.value) / 180, -.3, .2);
  if (time < loyalty.graceUntil && loyalty.rate < 0) loyalty.rate = 0;
  loyalty.value = clamp(loyalty.value + loyalty.rate * elapsed, 0, 100);
}
export const loyaltyWarning = (city: Building): boolean => !!city.loyalty && city.loyalty.rate < -.01
  && (city.loyalty.target < 25 || city.loyalty.value < 30);


export function loyaltyPanelAlpha(city: Building, viewer: number, now: number): number {
  return city.faction === viewer && loyaltyWarning(city) ? .72 + .14 * (1 + Math.cos(now * 2 * Math.PI / 3000)) : 1;
}
