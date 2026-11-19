import type { BuildSelection } from '../game/types';
import { BUILD_OPTIONS, buildMenuForSelection } from './build-controls';

/** Construction control markup shared by the game and isolated UI previews. */
export function constructionActionsMarkup(titles: Record<'build' | 'fortifications' | 'clear' | 'forbid', string>): string {
  return `<button data-action="build" aria-keyshortcuts="B" aria-expanded="false" aria-controls="build-panel" title="${titles.build}"><span class="action-label">Build</span></button>
    <button data-action="fortifications" aria-keyshortcuts="F" aria-expanded="false" aria-controls="build-panel" title="${titles.fortifications}"><span class="action-label">Fortify</span></button>
    <button data-action="clear" aria-keyshortcuts="C" title="${titles.clear}"><span class="action-label">Clear</span></button>
    <button data-action="forbid" title="${titles.forbid}"><span class="action-label">Forbid</span></button>`;
}

export function buildingButtonsMarkup(titleForOption: (kind: Exclude<BuildSelection, 'clearTrees'>) => string): string {
  return BUILD_OPTIONS.map(({ kind, key, label }) => {
    const menuKey = buildMenuForSelection(kind) === 'fortifications' ? 'F' : 'B';
    const letter = key?.toUpperCase();
    return `<button data-build="${kind}" aria-label="${label}"${letter ? ` aria-keyshortcuts="${menuKey} ${letter}"` : ''} title="${titleForOption(kind)}">${letter ? `<kbd>${letter}</kbd>` : ''}<span class="action-label">${label}</span></button>`;
  }).join('');
}
