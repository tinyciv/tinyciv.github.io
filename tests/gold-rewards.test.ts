import { describe, expect, it } from 'vitest';
import { recordNativeFrame } from './helpers/native-renderer';
import type { FogView } from '../src/game/fog';
import type { GameState, Particle } from '../src/game/types';
const fog: FogView = { width: 20, height: 20, visible: Uint8Array.from({ length: 400 }, (_, i) => Math.hypot(i % 20 + .5 - 5, Math.floor(i / 20) + .5 - 5) <= 2.35 ? 1 : 0), explored: Array(400).fill(1), sources: [{ x: 5, y: 5, radius: 3 }], buildings: [], fields: [], revision: 1, explorationRevision: 1 };
const reward = (options: Partial<Particle> = {}): Particle => ({ x: 5, y: 5, text: '+8 gold', color: '#f6e1a2', life: 1.6, ...options });
function render(particles: Particle[]) {
  const state = { world: { width: 20, height: 20, seed: 'reward', tiles: Array.from({ length: 400 }, () => ({ terrain: 'grassland', overlay: 'none', variation: .5 })) },
    units: [], buildings: [], fields: [], factions: [], particles, time: 0 } as unknown as GameState;
  return recordNativeFrame(state, { fog }).texts.filter(label => label.key.startsWith('reward:'));
}

describe('gold reward feedback', () => {
  it('shows whole-number gold gains and losses in bright yellow, never untagged damage numbers or expired events', () => {
    const labels = render([reward(), reward({ text: '−25.6 gold' }), reward({ text: '-25' }), reward({ text: '−10' }), reward({ life: 0 })]);
    expect(labels).toHaveLength(2);
    expect(labels).toMatchObject([{ text: '+8', color: '#ffe33d', alpha: 1 }, { text: '-26', color: '#ffe33d', alpha: 1 }]);
  });

  it('shows the full treasure reward and marauder leader bounty', () => {
    expect(render([reward({ text: '+200 gold' }), reward({ text: '+50 gold' })]).map(label => label.text)).toEqual(['+200', '+50']);
  });

  it('shows tagged hunting and delivered food as whole numbers but hides unrelated untagged food', () => {
    expect(render([reward({ text: '+5 food', kind: 'hunt', color: '#b9df85' }), reward({ text: '+100.6 food', kind: 'food', color: '#b9df85' }), reward({ text: '+100 food' })]))
      .toMatchObject([{ text: '+5', color: '#b9df85' }, { text: '+101', color: '#b9df85' }]);
  });

  it('rounds spoiled food labels in red without changing the amount or revealing losses outside sight', () => {
    const spoil = reward({ text: '−1.2 food', color: '#f46b63' });
    expect(render([spoil])[0]).toMatchObject({ text: '-1', color: '#f46b63' });
    expect(spoil.text).toBe('−1.2 food');
    expect(render([{ ...spoil, x: 15, y: 15 }])).toEqual([]);
  });

  it('hides rewards outside current sight even if the map was explored and their label rises into sight', () => {
    for (const particle of [reward(), reward({ text: '−25 gold' }), reward({ text: '+100 food', kind: 'food' })]) {
      expect(render([{ ...particle, x: 5, y: 7.5, life: .2 }])).toHaveLength(0);
      expect(render([{ ...particle, x: 15, y: 15 }])).toHaveLength(0);
    }
  });

  it('glides upward without lateral bounce and gently fades while keeping the reward location fixed for visibility', () => {
    const particle = reward();
    const frames = [1.6, 1.2, .8, .4, .25].map(life => {
      particle.life = life;
      return render([particle])[0];
    });
    expect(frames[0].alpha).toBe(1);
    expect(frames[1].alpha).toBe(1);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].x).toBe(frames[0].x);
      expect(frames[i].y).toBeLessThanOrEqual(frames[i - 1].y);
      expect(frames[i].alpha).toBeLessThanOrEqual(frames[i - 1].alpha);
    }
    expect(frames.at(-1)!.y).toBeLessThan(frames[0].y);
    expect(frames.at(-1)!.alpha).toBeGreaterThan(0);
    expect(frames.at(-1)!.alpha).toBeLessThan(.2);
    expect(particle).toMatchObject({ x: 5, y: 5 });
    particle.life = 0;
    expect(render([particle])).toEqual([]);
  });
});
