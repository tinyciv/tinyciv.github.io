import { rustEngine } from './rust-engine';

export function produceMineGold(cells: number, now: number, due: number, interval: number) {
  const pointer = rustEngine.ore_produce_gold(cells, now, due, interval);
  const [next, gold] = new Float64Array(rustEngine.memory.buffer, pointer, 2);
  return { next, gold };
}
