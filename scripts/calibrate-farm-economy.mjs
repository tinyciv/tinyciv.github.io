import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
// Physical courier calibration; no population cap or palace intake cap.
// Run: node scripts/calibrate-farm-economy.mjs
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sourceRoot = path.resolve(root, argument('source', root));
const output = path.resolve(root, argument('out', 'benchmarks/farm-economy-balance.json'));
const temporary = await mkdtemp(path.join(tmpdir(), 'btv-farm-economy-'));
const bundle = path.join(temporary, 'simulation.mjs');
await build({ stdin: { contents: `export { updateGame } from './src/game/simulation.ts'; export { synchronizeFarms, ensureCollectors, FIELD_HARVEST_SECONDS, FIELD_HARVEST_FOOD, FIELD_SPOIL_SECONDS } from './src/game/farms.ts';`, resolveDir: sourceRoot }, bundle: true, platform: 'node', format: 'esm', outfile: bundle });
const { updateGame, synchronizeFarms, ensureCollectors, FIELD_HARVEST_SECONDS: harvestSeconds, FIELD_HARVEST_FOOD: yieldFood, FIELD_SPOIL_SECONDS: shelf } = await import(pathToFileURL(bundle));
function fixture(pop, farmCount, detour = false, roads){const width=64,height=64,palace={id:1,kind:'palace',faction:0,x:31,y:31,hp:650,maxHp:650,capacity:0,populationGrowth:-10000,governorPermissions:{farms:false,housing:false}};
 const s={world:{width,height,seed:'calibrate',source:'test',spawns:[],tiles:Array.from({length:width*height},()=>({terrain:'grassland',overlay:'none',elevation:.3,moisture:.5,food:3,production:1,gold:0,variation:.5}))},buildings:[palace],units:[{id:2,kind:'leader',faction:0,x:59.5,y:59.5,hp:100,morale:100,attack:25,defense:5,speed:3.6,range:4,order:'hold',cooldown:0,lastCombat:-60,moving:false,facing:0,attackTime:0}],factions:[{id:0,name:'Test',color:'#f43',affinity:100,relation:'self',food:1e6,gold:0,production:0,population:pop,yields:{food:0,production:0,gold:0},nextRaid:1e9,nextRetinueAt:1e9,defeated:false}],time:0,tick:0,paused:false,speed:1,events:[],particles:[],fields:[],selected:2,selectedType:'unit',buildMode:null,diplomacy:null,gameOver:false,victory:false,seed:'calibrate',rngState:1,marauderPacks:[],raiderCamps:[],roamingMaraudersVersion:1,fogRaids:{nextAt:1e9,waves:0,pressureVersion:1},wildlife:{herds:[],nextRespawnAt:1e9,sequence:0,targetHerds:0}};
 if (detour) for (let y = 12; y <= 51; y++) s.world.tiles[y * width + 35].terrain = 'lake';
 const sites=[];for(let y=2;y<62;y+=2)for(let x=2;x<62;x+=2){const r=Math.hypot(x+1-32,y+1-32);if(r>=4&&r<=25 && [0,1].every(dy => [0,1].every(dx => s.world.tiles[(y+dy)*width+x+dx].terrain !== 'lake')))sites.push({x,y,r});}sites.sort((a,b)=>a.r-b.r||a.y-b.y||a.x-b.x);
 for(const p of sites.slice(0,farmCount))s.buildings.push({id:s.buildings.length+10,kind:'camp',faction:0,x:p.x,y:p.y,hp:100,maxHp:100,capacity:0});
 if (roads) {
   const roadCells = new Set();
   for (let y = 30; y <= 33; y++) for (let x = 30; x <= 33; x++) if (x === 30 || x === 33 || y === 30 || y === 33) roadCells.add(y * width + x);
   if (roads === 'arteries') for (let n = 2; n < 62; n++) {
     if (n < 30) { roadCells.add(31 * width + n); roadCells.add(n * width + 32); }
     if (n > 33) { roadCells.add(32 * width + n); roadCells.add(n * width + 31); }
   }
   for (const cell of roadCells) s.buildings.push({ id: s.buildings.length + 1000, kind: 'road', faction: 0, x: cell % width, y: Math.floor(cell / width), hp: 60, maxHp: 60, capacity: 0 });
 }
 synchronizeFarms(s);ensureCollectors(s);return s;}
const scenarios = [
  { population: 20, farmCount: 15, roads: 'ring' },
  { population: 60, farmCount: 45, roads: 'ring' },
  { population: 100, farmCount: 150, roads: 'ring' },
  { population: 140, farmCount: 150, roads: 'ring' },
  { population: 140, farmCount: 150, noDecay: true, roads: 'ring' },
  { population: 100, farmCount: 150, detour: true, roads: 'ring' },
  { population: 100, farmCount: 150 },
  { population: 100, farmCount: 150, roads: 'arteries' },
];
const rows = [];
try {
  for (const scenario of scenarios) {
    const s = fixture(scenario.population, scenario.farmCount, scenario.detour, scenario.roads);
    let baseline = 0;
    for (let step = 0; step < 4500; step++) {
      if (scenario.noDecay) {
        for (const field of s.fields) {
          for (const batch of field.foodBatches ?? []) batch.expiresAt = 1e9;
          if (field.foodBatches?.length) field.expiresAt = 1e9;
        }
        for (const unit of s.units) {
          for (const batch of unit.cargoBatches ?? []) batch.expiresAt = 1e9;
          if (unit.cargoBatches?.length) unit.cargoExpiresAt = 1e9;
        }
      }
      updateGame(s, .1, { up: false, down: false, left: false, right: false });
      if (step === 1499) baseline = s.buildings[0].foodDelivered ?? 0;
    }
    const deliveredPer30 = ((s.buildings[0].foodDelivered ?? 0) - baseline) / 10;
    const row = { ...scenario, plots: s.fields.length, deliveredPer30, consumedPer30: scenario.population, balancePer30: deliveredPer30 - scenario.population };
    rows.push(row); console.log(JSON.stringify(row));
  }
  const report = { assumptions: '64x64 flat fertile grassland, no irrigation/bonuses; roads absent unless specified, 4-tile-radius urban core, farms packed around all 360 degrees. Real courier dispatch/pathfinding/speed/collection/expiry/delivery. 150s warmup then 300s measured. Population and housing growth held fixed; food reserve prevents starvation changes.', harvestSeconds, yieldPerTile: yieldFood, spoilSeconds: shelf, rows };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  const balanced = rows.find(row => row.population === 100 && row.roads === 'ring');
  if (!(balanced.deliveredPer30 >= 90 && balanced.deliveredPer30 <= 110)) throw new Error('Road-ring baseline escaped the 100-person target band');
  if (!(rows[3].balancePer30 < -20 && rows[4].balancePer30 > 0)) throw new Error('Distance/decay must cause the large-city deficit');
} finally { await rm(temporary, { recursive: true, force: true }); }
