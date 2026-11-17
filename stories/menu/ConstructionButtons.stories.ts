import type { Meta, StoryObj } from '@storybook/html-vite';
import '../../src/ui/game-font.css';
import '../../src/style.css';
import '../../src/ui/forged-hud.css';
import '../../src/ui/mobile-controls.css';
import '../../src/ui/reference-buttons.css';
import type { BuildSelection } from '../../src/game/types';
import { buildMenuForSelection, type BuildMenu } from '../../src/ui/build-controls';
import { constructionActionsMarkup, buildingButtonsMarkup } from '../../src/ui/build-controls-view';

interface Args { menu: BuildMenu; interactionStates: boolean }

const meta: Meta<Args> = {
  title: 'Menu/Construction Buttons',
  args: { menu: 'build', interactionStates: false },
  argTypes: { menu: { control: 'select', options: ['build', 'fortifications'] } },
  parameters: { layout: 'fullscreen' },
};
export default meta;

/** Actual construction controls, with no world creation or running simulation. */
export const Civilian: StoryObj<Args> = {
  render: args => {
    const host = document.createElement('main');
    host.className = 'game-area';
    host.style.background = '#101719';
    host.innerHTML = `<footer class="hud" aria-label="Game controls">
      <section class="special-actions" aria-label="Actions">${constructionActionsMarkup({
        build: 'Build', fortifications: 'Fortify', clear: 'Clear', forbid: 'Forbid',
      })}</section>
      <section class="build-panel${args.menu === 'build' ? ' is-building-menu' : ''}" id="build-panel" role="region" aria-label="${args.menu === 'build' ? 'Leader buildings' : 'Leader fortifications'}" data-menu="${args.menu}">
        <button id="close-build" aria-label="Close construction menu" title="Close (Esc)">×</button>
        <div class="build-actions">${buildingButtonsMarkup(() => '')}</div>
      </section>
    </footer>`;
    host.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => {
      button.hidden = buildMenuForSelection(button.dataset.build as BuildSelection) !== args.menu;
      const selected = args.interactionStates && button.dataset.build === (args.menu === 'build' ? 'road' : 'palisade');
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = args.interactionStates && button.dataset.build === (args.menu === 'build' ? 'house' : 'wall');
    });
    const openAction = host.querySelector<HTMLButtonElement>(`[data-action="${args.menu}"]`)!;
    openAction.classList.add('active');
    openAction.setAttribute('aria-expanded', 'true');
    host.dataset.ready = 'true';
    return host;
  },
};

export const Fortifications: StoryObj<Args> = { ...Civilian, args: { menu: 'fortifications' } };
export const InteractionStates: StoryObj<Args> = { ...Civilian, args: { interactionStates: true } };
