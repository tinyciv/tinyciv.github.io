import type { Meta, StoryObj } from '@storybook/html-vite';
import '../../src/ui/game-font.css';
import '../../src/style.css';
import { campaignReportMarkup } from '../../src/ui/campaign-report';

const meta: Meta = { title: 'Menu/Victory', parameters: { layout: 'fullscreen' } };
export default meta;

/** The actual report markup, with fixture numbers and no running simulation. */
export const Campaign: StoryObj = {
  render: () => {
    const host = document.createElement('div');
    host.innerHTML = `<div class="dialog-backdrop"><div class="dialog" role="dialog" aria-labelledby="dialog-title"><h2 id="dialog-title">Victory</h2>${campaignReportMarkup({
      civilization: 'Roma', goldGathered: 128640, enemiesKilled: 846, unitsLost: 127,
      technologiesResearched: 23, maximumPopulation: 612, cities: 7, treasury: 18450,
      culture: 9040, elapsedSeconds: 4472,
    })}<div class="dialog-actions"><button class="primary">Keep playing</button><button>Main menu</button></div></div></div>`;
    host.dataset.ready = 'true';
    return host;
  },
};
