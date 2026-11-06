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
  it('shows positive gold rewards only, never saved damage numbers or expired events', () => {
    const labels = render([reward(), reward({ text: '-25' }), reward({ text: '−10' }), reward({ text: '+100 food' }), reward({ life: 0 })]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ text: '+8', alpha: 1 });
  });

  it('shows the full treasure reward and marauder leader bounty', () => {
    expect(render([reward({ text: '+200 gold' }), reward({ text: '+50 gold' })]).map(label => label.text)).toEqual(['+200', '+50']);
  });

  it('shows the tagged hunting food reward without reviving unrelated saved food labels', () => {
    expect(render([reward({ text: '+5 food', kind: 'hunt', color: '#b9df85' }), reward({ text: '+100 food' })]))
      .toMatchObject([{ text: '+5', color: '#b9df85' }]);
  });

  it('shows the exact spoiled amount in red without revealing losses outside sight', () => {
    const spoil = reward({ text: '−1.2 food', color: '#f46b63' });
    expect(render([spoil])[0]).toMatchObject({ text: '-1.2', color: '#f46b63' });
    expect(spoil.text).toBe('−1.2 food');
    expect(render([{ ...spoil, x: 15, y: 15 }])).toEqual([]);
  });

  it('hides rewards outside current sight even if the map was explored and their label rises into sight', () => {
    expect(render([reward({ x: 5, y: 7.5, life: .2 })])).toHaveLength(0);
    expect(render([reward({ x: 15, y: 15 })])).toHaveLength(0);
  });

  it('briefly rises and fades while keeping the death location fixed for visibility', () => {
    const particle = reward(), initial = render([particle])[0];
    particle.life = .25;
    const final = render([particle])[0];
    expect(final.y).toBeLessThan(initial.y);
    expect(final.alpha).toBe(.5);
    expect(particle).toMatchObject({ x: 5, y: 5 });
  });
});
