import { SITE_DEFINITIONS, type SiteView } from '../game/site-types';
import { BUILD_COSTS } from '../game/simulation';
import type { World } from '../game/types';
import { icon } from './icons';
import { runtimeArtUrl } from '../game/runtime-art';

/** Popup dismissal is local presentation state, rearmed from Rust's visit halo. */
export class SiteVisits {
    private world?: World;
    private readonly dismissed = new Set<number>();
    observe(world: World, sites: readonly SiteView[]): void {
        if (this.world !== world) { this.world = world; this.dismissed.clear(); }
        const remaining = new Set(sites.filter(s => s.available && s.withinVisit).map(s => s.id));
        for (const id of this.dismissed) if (!remaining.has(id)) this.dismissed.delete(id);
    }
    offer(site: SiteView): boolean { return site.available && site.near && !this.dismissed.has(site.id); }
    dismiss(site: SiteView): void { this.dismissed.add(site.id); }
}

export function siteDialogMarkup(site: SiteView): string {
    const definition = SITE_DEFINITIONS[site.kind], kind = definition.building;
    return `<div class="site-dialog" data-site-id="${site.id}">
      <h2 id="dialog-title">${definition.label} site</h2>
      <img class="site-portrait" src="${runtimeArtUrl(`${import.meta.env.BASE_URL}assets/ui/${definition.portrait}`)}" alt="">
      <div class="dialog-actions"><button id="site-build" class="primary">Build <span class="upgrade-price">${BUILD_COSTS[kind].gold}${icon('gold')}</span></button><button id="site-later">Later</button></div>
      <p id="site-error" role="status"></p></div>`;
}
