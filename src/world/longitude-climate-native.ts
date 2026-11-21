import { rustEngine } from '../game/rust-engine';

interface ColumnClimate {
  readonly tundraEdge: number;
  readonly terrainMoisture: number;
  readonly woodland: number;
}

let columns: readonly ColumnClimate[] = [];

export function longitudeClimate(width: number): readonly ColumnClimate[] {
  if (columns.length === width) return columns;
  const pointer = rustEngine.longitude_climate_generate(width);
  const values = new Float64Array(rustEngine.memory.buffer, pointer, width * 3);
  columns = Array.from({ length: width }, (_, x) => ({
    tundraEdge: values[x * 3],
    terrainMoisture: values[x * 3 + 1],
    woodland: values[x * 3 + 2],
  }));
  return columns;
}
