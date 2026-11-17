import type { Meta, StoryObj } from '@storybook/html-vite';
import '../../src/ui/game-font.css';
import '../../src/style.css';
import '../../src/ui/forged-hud.css';
import { militaryActionIcon } from '../../src/ui/military-action-icons';

const meta: Meta = { title: 'Menu/Military Toolbar', parameters: { layout: 'fullscreen' } };
export default meta;

/** Production artwork and button styling, without creating a game. */
export const Approved: StoryObj = {
  render: () => {
    const host = document.createElement('div');
    host.style.cssText = 'min-height:100dvh;display:grid;place-content:center;gap:24px;background:#101b1e;font-family:var(--game-font)';
    host.innerHTML = `<h1 style="margin:0;text-align:center;font-size:28px;color:#f3db9c">Military toolbar</h1><div style="display:grid;grid-template-columns:repeat(2,100px);gap:12px">
      <button class="action-slot" data-hotbar-action="levy" aria-label="Mass levy"><kbd>4</kbd><span class="hotbar-art hotbar-auxiliary" aria-hidden="true">${militaryActionIcon('levy')}</span><span class="hotbar-label">Mass levy</span></button>
      <button class="action-slot" data-hotbar-action="garrison" aria-label="Garrison"><kbd>5</kbd><span class="hotbar-art hotbar-auxiliary" aria-hidden="true">${militaryActionIcon('garrison')}</span><span class="hotbar-label">Garrison</span></button>
    </div>`;
    host.dataset.ready = 'true';
    return host;
  },
};
