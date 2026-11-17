/** Transport only. Rust/Bevy owns region selection and all relief policies. */
import { rustEngine } from '../game/rust-engine';
import { WATER, type World } from '../game/types';
import type { LandformPlan } from './landforms';
import type { LandscapeParameters } from './options';
import { LANDFORM_KINDS } from './options';
import { markWorldChanged } from '../game/world-revisions';
import { resetReliefArtPlan, visibleReliefStamps } from '../game/relief-art';

/** Transport art geometry once at world creation. Rust rasterizes its opaque
 * pixels into the smallest enclosing navigation/building grid cells. */
export function applyReliefFootprints(world: World): void {
  resetReliefArtPlan(world);
  const stamps = visibleReliefStamps(world, 0, 0, world.width, world.height);
  const pointer = rustEngine.relief_input(stamps.length * 7);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, stamps.length * 7);
  stamps.forEach((stamp, i) => {
    input.set([stamp.x, stamp.y, stamp.width, stamp.height, world.tiles[stamp.cell].relief === 'mountains' ? 2 : 1,
      stamp.style, stamp.slot], i * 7);
  });
  const output = rustEngine.relief_footprints(world.width, world.height, stamps.length);
  const rows = new Float64Array(rustEngine.memory.buffer, output, world.tiles.length * 3).slice();
  const changed: number[] = [];
  world.tiles.forEach((tile, cell) => {
    if (!tile.relief) return;
    const at = cell * 3;
    if (tile.reliefFlags !== rows[at] || tile.reliefLevel !== rows[at + 1] || tile.reliefSpeed !== rows[at + 2]) changed.push(cell);
    tile.reliefFlags = rows[at]; tile.reliefLevel = rows[at + 1]; tile.reliefSpeed = rows[at + 2];
  });
  if (changed.length) markWorldChanged(world, 'geometry', changed);
}

/** Offline transport of the native patch-removal rule, without regenerating terrain. */
export function removeSmallMountainPatches(world: World): number {
  const n = world.tiles.length, pointer = rustEngine.relief_input(n);
  const input = new Float64Array(rustEngine.memory.buffer, pointer, n);
  world.tiles.forEach((tile, cell) => { input[cell] = tile.relief === 'mountains' ? 2 : tile.relief === 'hills' ? 1 : 0; });
  const output = rustEngine.relief_prune_mountains(world.width, world.height);
  const count = new Float64Array(rustEngine.memory.buffer, output, 1)[0];
  const removed = new Float64Array(rustEngine.memory.buffer, output + 8, count).slice();
  for (const cell of removed) {
    const tile = world.tiles[cell];
    delete tile.relief; delete tile.reliefRegion; delete tile.reliefFlags;
    delete tile.reliefLevel; delete tile.reliefSpeed; delete tile.reliefRuggedness; delete tile.reliefStyle;
  }
  if (removed.length) markWorldChanged(world, 'geometry', removed);
  return removed.length;
}

export function generateRelief(world: World, plan: LandformPlan | undefined, p: LandscapeParameters): void {
  const ridges=plan?.ridges??[],provinces=plan?.provinces??[],n=world.tiles.length;
  const length=3+n*8+ridges.reduce((sum,r)=>sum+4+r.points.length*2,0)+provinces.length*6;
  const ptr=rustEngine.relief_input(length),input=new Float64Array(rustEngine.memory.buffer,ptr,length);
  input.set([n,ridges.length,provinces.length]);let at=3;
  for(const tile of world.tiles){input.set([tile.elevation,Number(WATER.has(tile.terrain)||!!tile.creek),tile.temperature??.5,tile.moisture,tile.rockResistance??.5,Number(!!tile.beach||!!tile.marsh||!!tile.geothermal||tile.overlay==='volcano'||tile.overlay==='glacier'),0,tile.variation],at);at+=8;}
  for(const r of ridges){input.set([Number(r.kind==='mountains'),r.width,r.prominence,r.points.length],at);at+=4;for(const point of r.points){input.set([point.x,point.y],at);at+=2;}}
  for(const province of provinces){input.set([LANDFORM_KINDS.indexOf(province.kind),province.center.x,province.center.y,province.radiusX,province.radiusY,province.angle],at);at+=6;}
  let seed=2166136261;for(const ch of world.seed)seed=Math.imul(seed^ch.charCodeAt(0),16777619);
  const output=rustEngine.relief_generate(world.width,world.height,seed>>>0,p.reliefCoverage,p.mountainShare,p.hillSize,p.hillClustering,p.hillSpacing,p.mountainClumpShare,p.mountainStringShare,p.mountainLengthMin,p.mountainLengthMax,p.mountainWidth,p.mountainBend);
  const rows=new Float64Array(rustEngine.memory.buffer,output,n*8).slice();
  world.tiles.forEach((tile,i)=>{
    const at=i*8,kind=rows[at];delete tile.ridge;delete tile.ridgeTier;delete tile.stair;delete tile.mountainPass;delete tile.hillBiome;delete tile.canyon;
    if(!kind){delete tile.relief;delete tile.reliefRegion;delete tile.reliefFlags;delete tile.reliefLevel;delete tile.reliefSpeed;delete tile.reliefRuggedness;delete tile.reliefStyle;return;}
    tile.relief=kind===2?'mountains':'hills';tile.reliefRegion=rows[at+1];tile.reliefLevel=rows[at+2];tile.reliefFlags=rows[at+3];tile.reliefSpeed=rows[at+4];tile.reliefRuggedness=rows[at+5];tile.elevation=rows[at+6];tile.reliefStyle=rows[at+7] as 0|1|2;
    if(kind===2){tile.overlay='none';delete tile.palm;delete tile.treeClass;}
  });
}
