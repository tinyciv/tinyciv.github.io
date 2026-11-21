import { SITE_DEFINITIONS, type SiteView } from '../game/site-types';
import { BUILD_COSTS } from '../game/simulation';
import { icon } from './icons';
import { runtimeArtUrl } from '../game/runtime-art';

export function siteDialogMarkup(site: SiteView): string {
    const definition = SITE_DEFINITIONS[site.kind], kind = definition.building;
    return `<div class="site-dialog" data-site-id="${site.id}">
      <h2 id="dialog-title">${definition.label} site</h2>
      <img class="site-portrait" src="${runtimeArtUrl(`${import.meta.env.BASE_URL}assets/ui/${definition.portrait}`)}" alt="">
      <div class="dialog-actions"><button id="site-build" class="primary">Build <span class="upgrade-price"><span class="site-gold">${BUILD_COSTS[kind].gold}</span>${icon('gold')}</span></button><button id="site-later">Later</button></div>
      <p id="site-error" role="status"></p></div>`;
}
