import type { BuildingKind, Point } from './types';

export type SiteKind = 1;
export interface SiteView extends Point {
    id: number; kind: SiteKind; width: number; height: number; near: boolean; available: boolean;
}
export const SITE_DEFINITIONS = {
    1: { label: 'Thermal bath', building: 'thermalBath' as BuildingKind, portrait: 'thermal-bath.png',
        benefit: '+30% house capacity in the nearest friendly town. Does not stack.' },
} as const;
export const isSiteBuilding = (kind: string): boolean => Object.values(SITE_DEFINITIONS).some(site => site.building === kind);
