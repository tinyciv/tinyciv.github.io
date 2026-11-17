import type { Meta, StoryObj } from '@storybook/html-vite';
import { createScenarioGame } from '../../src/game/scenario-loader';
import { mountGameState } from '../harness/mount';

export default { title: 'Scenarios/Tutorial', parameters: { layout: 'fullscreen' } } satisfies Meta;

/** The shipped start, rendered at time zero without running the simulation. */
export const Overview: StoryObj = {
  render: () => {
    const host=document.createElement('div');
    void createScenarioGame('tutorial').then(state=>mountGameState(host,state,{
      play:false,controls:false,width:1792,height:760,camera:{x:40,y:15},zoom:.65,
    })).then(()=>{host.dataset.ready='true';}).catch(error=>{
      host.dataset.error=String(error);host.textContent=String(error);
    });
    return host;
  },
};

export const PlayerCity: StoryObj = {
  render: () => {
    const host=document.createElement('div');
    void createScenarioGame('tutorial').then(state=>{
      const city=state.buildings.find(building=>building.kind==='palace'&&building.faction===0)!;
      return mountGameState(host,state,{
        play:false,controls:false,width:1280,height:800,camera:{x:city.x+1,y:city.y+1},zoom:1.3,
      });
    }).then(()=>{host.dataset.ready='true';}).catch(error=>{
      host.dataset.error=String(error);host.textContent=String(error);
    });
    return host;
  },
};
