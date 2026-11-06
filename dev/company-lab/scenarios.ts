import type { LabWorld, ScenarioId } from './types';
export type { ScenarioId } from './types';
export const SCENARIOS: { id: ScenarioId; name: string; description: string }[] = [
  { id: 'plain', name: 'Open Plain', description: 'Open ground tests deployment, shared targets, and large battle fronts.' },
  { id: 'river', name: 'Winding River', description: 'A one-cell bridge and a broad crossing divide a meandering river.' },
  { id: 'forest', name: 'Forest Passages', description: 'Wooded ridges funnel companies into branching, uneven passages.' },
  { id: 'town', name: 'Fortified Town', description: 'One-cell gates lead through walls into a town with several courtyards.' },
  { id: 'urban', name: 'Crowded Streets', description: 'Dense blocks create narrow streets, corners, and alternate routes.' },
  { id: 'hills', name: 'Terraced Hills', description: 'Two raised terraces can only be entered through their oriented ramps.' },
];

/** Deterministic topology leaves both deployment areas spacious even at 720 soldiers. */
export function createWorld(id: ScenarioId, stress = false): LabWorld {
  const width = stress ? 96 : 80, height = stress ? 64 : 52;
  const world: LabWorld = { width, height, tiles: new Uint8Array(width * height),
    elevations: new Int8Array(width * height), stairDir: new Int8Array(width * height).fill(-1),
    scenario: id, name: SCENARIOS.find(scenario => scenario.id === id)?.name, revision: 1,
    bases: [{ x: 9.5, y: height / 2 + .5 }, { x: width - 10.5, y: height / 2 + .5 }] };
  const { tiles, elevations, stairDir } = world;
  const set = (x: number, y: number, tile: number, elevation = 0) => {
    if (x >= 0 && y >= 0 && x < width && y < height) { tiles[y * width + x] = tile; elevations[y * width + x] = elevation; }
  };
  const rect = (x: number, y: number, w: number, h: number, tile: number, elevation = 0) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, tile, elevation);
  };
  const horizontalRoad = (y: number, thickness = 2) => rect(1, y, width - 2, thickness, 1);
  const midX = Math.floor(width / 2), midY = Math.floor(height / 2);

  if (id === 'plain') {
    horizontalRoad(midY - 1);
    for (let y = 8; y < height - 7; y++) for (let x = 20; x < width - 20; x++) {
      if (Math.abs(y - midY) > 8 && (x * 11 + y * 17) % 113 < 3) set(x, y, 2);
    }
  } else if (id === 'river') {
    const narrow = Math.floor(height * .28), broad = Math.floor(height * .70);
    for (let y = 0; y < height; y++) {
      const center = midX + Math.round(Math.sin(y * .14) * 5 + Math.sin(y * .31) * 2);
      const radius = 2 + (Math.sin(y * .22) > .25 ? 1 : 0);
      rect(center - radius, y, radius * 2 + 1, 1, 3);
    }
    for (const [y, thickness] of [[narrow, 1], [broad, 3]]) {
      for (let row = y; row < y + thickness; row++) for (let x = 1; x < width - 1; x++) {
        set(x, row, tiles[row * width + x] === 3 ? 6 : 1);
      }
    }
    // Curved wooded banks add cover without blocking the approaches.
    for (let y = 5; y < height - 5; y++) if (Math.abs(y - narrow) > 3 && Math.abs(y - broad) > 5) {
      const x = midX - 10 + Math.round(Math.sin(y * .14) * 4);
      if (y % 3 !== 0) { set(x, y, 2); set(x + 18, y, 2); }
    }
  } else if (id === 'forest') {
    const first = midX - 10, second = midX + 7;
    rect(first, 1, 6, height - 2, 2); rect(second, 1, 6, height - 2, 2);
    // Alternating gaps force turns; central gap is only one tile wide.
    for (const [x, gaps] of [[first, [10, midY, height - 11]], [second, [15, midY + 6, height - 8]]] as const) {
      for (const y of gaps) rect(x - 2, y, 10, y === midY ? 1 : 3, 1);
    }
    rect(first + 6, 6, 3, height - 12, 1);
    rect(second - 3, 6, 3, height - 12, 1);
    for (let y = 5; y < height - 4; y++) for (let x = first + 10; x < second - 4; x++) {
      if ((x * 3 + y * 7) % 31 < 2 && Math.abs(y - midY) > 3) set(x, y, 2);
    }
  } else if (id === 'town') {
    const left = midX - 13, right = midX + 13, top = 8, bottom = height - 9;
    rect(left, top, right - left + 1, 1, 4); rect(left, bottom, right - left + 1, 1, 4);
    rect(left, top, 1, bottom - top + 1, 4); rect(right, top, 1, bottom - top + 1, 4);
    horizontalRoad(midY);
    // Restore side walls except for one-cell entrances on the main street.
    for (let y = top; y <= bottom; y++) if (y !== midY) { set(left, y, 4); set(right, y, 4); }
    rect(midX - 1, top + 1, 3, bottom - top - 1, 1);
    for (const x of [left + 3, midX + 5]) for (const y of [top + 4, midY - 7, midY + 4]) rect(x, y, 5, 4, 5);
    // Back courtyards link around the blocks and cannot become sealed spawn pockets.
    rect(left + 1, top + 1, right - left - 1, 2, 1);
    rect(left + 1, bottom - 2, right - left - 1, 2, 1);
  } else if (id === 'urban') {
    horizontalRoad(midY - 1, 3);
    const first = 22, last = width - 22;
    for (let x = first; x < last; x += 8) {
      rect(x + 5, 3, 2, height - 6, 1);
      for (let y = 5; y < height - 6; y += 8) {
        if (y + 5 >= midY - 2 && y <= midY + 3) continue;
        // Different block widths leave both one- and two-cell alleys.
        rect(x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 6 : 5, 5, 5);
      }
    }
    // Offset obstacles on the main avenue produce genuine right-angle detours.
    rect(midX - 9, midY - 1, 3, 3, 5); rect(midX + 6, midY, 3, 3, 5);
    for (const y of [12, height - 13]) rect(first - 2, y, last - first + 4, 2, 1);
  } else if (id === 'hills') {
    const left = midX - 15, right = midX + 2, top = 0, bottom = height - 1;
    rect(left, top, 12, bottom - top + 1, 7, 1);
    rect(right, top, 12, bottom - top + 1, 7, 1);
    const ramp = (x: number, y: number, direction: number, thickness: number) => {
      for (let dy = 0; dy < thickness; dy++) { set(x, y + dy, 8, 1); stairDir![(y + dy) * width + x] = direction; }
    };
    // West/east ramps run uphill into each terrace. One is intentionally single file.
    ramp(left, 13, 1, 1); ramp(left + 11, midY + 4, 3, 2);
    ramp(right, midY + 4, 1, 2); ramp(right + 11, 13, 3, 1);
    for (let y = 15; y < midY + 3; y++) { set(left + 5, y, 2, 1); set(right + 6, y, 2, 1); }
    // Terrain under the ramps remains elevated; the navigator checks oriented edges.
  }

  return world;
}
