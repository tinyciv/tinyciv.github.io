import { runtimeArtUrl } from '../game/runtime-art';
import { RUINS_OFFER } from '../game/exploration-content';
import type { ExplorationSite } from '../game/exploration-native';
export function explorationDialogMarkup(site: ExplorationSite): string {
    return `<div class="exploration-dialog" data-exploration-id="${site.id}">
      <h2 id="dialog-title">The lost city</h2>
      <img class="exploration-portrait" src="${runtimeArtUrl(`${import.meta.env.BASE_URL}assets/exploration/ruins-${'abc'[site.variant]}.png`)}" alt="Ancient ruins" width="96" height="96" style="image-rendering:pixelated">
      <p>${RUINS_OFFER}</p>
      <div class="dialog-actions">
        <button id="ruins-accept" class="primary">Accept them</button>
        <button id="ruins-decline">Leave them</button>
      </div><p id="ruins-error" role="status"></p></div>`;
}
