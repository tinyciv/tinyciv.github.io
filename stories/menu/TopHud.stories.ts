import type { Meta, StoryObj } from '@storybook/html-vite';
import '../../src/ui/game-font.css';
import '../../src/style.css';
import '../../src/ui/forged-hud.css';
import '../../src/ui/research-toolbar.css';
import '../../src/ui/faction-diplomacy.css';
import '../../src/ui/mobile-controls.css';
import '../../src/ui/reference-buttons.css';

interface Args { activeResearch: boolean; diplomacyOffers: number }

const meta: Meta<Args> = {
  title: 'Menu/Top HUD',
  args: { activeResearch: false, diplomacyOffers: 2 },
  parameters: { layout: 'fullscreen' },
};
export default meta;

/** Production HUD markup and artwork, with no world or running simulation. */
export const NeedsLibrary: StoryObj<Args> = {
  render: args => {
    const host = document.createElement('main');
    host.className = 'game-area';
    host.style.background = '#101719';
    const label = args.activeResearch ? 'Metal tools' : 'Build a library';
    const status = args.activeResearch ? `${label} · 110 game seconds remaining` : label;
    const researchIcon = args.activeResearch ? 'metalTools' : 'woodenTower';
    const diplomacy = args.diplomacyOffers > 0 ? `Diplomacy (${args.diplomacyOffers})` : 'Diplomacy';
    host.innerHTML = `<header class="resource-bar" aria-label="Resources">
      <div class="resources">
        <div class="resource food" title="Food · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/runtime/ui/resources/food.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="food">484</strong><span id="food-yield">(+4)</span></div></div>
        <div class="resource gold" title="Gold · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/runtime/ui/resources/gold.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="gold">483</strong><span id="gold-yield">(+70)</span></div></div>
        <div class="resource population" title="Population / housing"><img class="resource-icon" src="/assets/runtime/ui/resources/population.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="population">20</strong><span id="capacity">/ 20</span></div></div>
        <div class="resource culture" aria-label="Culture"><img id="culture-icon" class="resource-icon" src="/assets/runtime/ui/resources/culture.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="culture">7</strong><span id="culture-next"></span><span id="culture-rate">(+6)</span></div></div>
      </div>
      <div id="research-toolbar" class="research-toolbar" role="group" aria-label="${status}" title="${status}">
        <img class="research-toolbar-icon" alt="" data-research="${researchIcon}" src="/assets/runtime/ui/research/forged/${researchIcon}.webp">
        <strong class="research-toolbar-name">${label}</strong>
        ${args.activeResearch ? '<span class="research-toolbar-eta" aria-hidden="true">110s</span>' : ''}
      </div>
      <div class="time-controls">
        <button type="button" id="diplomacy-menu" aria-haspopup="dialog">${diplomacy}</button>
        <button type="button" id="menu" aria-haspopup="dialog" title="Game menu"><span aria-hidden="true" class="menu-glyph"></span> Menu</button>
        <button type="button" id="pause" title="Resume (Space)" aria-label="Resume"><span aria-hidden="true" class="icon control-symbol symbol-play"></span></button>
        <button type="button" id="speed" title="Simulation speed" aria-label="Change simulation speed"><span class="speed-value">1×</span></button>
      </div>
    </header>`;
    host.dataset.ready = 'true';
    return host;
  },
};

export const ActiveResearch: StoryObj<Args> = { ...NeedsLibrary, args: { activeResearch: true } };
