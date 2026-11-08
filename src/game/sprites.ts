import { drawSupplyDepot } from './supply-depot-art';
import { drawEngineerEquipment } from './leader-ability-art';
import { drawObservationCampfire, drawObservationPost } from './observation-post-art';
import { buildingWidth, buildingHeight, isFarmKind, type Building, type Overlay, type Unit } from './types';
import { drawDirtRoad, type RoadLinks } from './road-sprites';
import { drawPerson } from './unit-sprites';
import { drawAuxiliary } from './auxiliary-art';
import { drawPuny, punyWorldImage } from './puny-world';
import { drawFordStones, type FordAxis } from './ford-art';
import { drawPalace } from './palace-sprite';
import { drawFort } from './fort-art';
import { drawPunyWall } from './wall-sprites';
import { drawPalisade } from './palisade-art';
import { drawFarmField } from './farm-art';
import { drawIrrigation } from './irrigation-art';
import { drawCoveredWell, drawWoodenHouse, drawWoodenTower } from './wooden-building-art';
import { drawMonument } from './monument-art';
import { drawLibrary } from './library-art';
import { drawVillageTent } from './village-art';
import { drawArcheryRange } from './archery-art';
import { drawScoutsLodge } from './scout-art';
import { drawBlacksmith } from './blacksmith-art';
import { drawHealerShack } from './healer-art';
import { drawStable } from './cavalry-art';
import { drawBallista } from './siege-art';
import { drawGuardPost } from './guard-post-art';
import { drawWildlife } from './wildlife-art';
import { drawMerchant } from './merchant-art';
import { HOUSE_WELL_OFFSET } from './house-wells';
import { drawDock, drawSailboat } from './naval-art';
import { dockFootprint } from './dock';
import { drawLeaderGalley } from './galley-art';
export { buildingArtTop } from './types';

/** Original Puny scenery and buildings, with shared faction-color masks. */
type Ctx = CanvasRenderingContext2D;
export interface Connections extends RoadLinks {}
export const NO_CONNECTIONS: Connections = { north: false, east: false, south: false, west: false };

function setup(c: Ctx, x: number, y: number, size: number): void {
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(size / 32, size / 32);
  c.imageSmoothingEnabled = false;
}
function tile(c: Ctx, column: number, row: number, x = 0, y = 0, width = 32, height = 32): void {
  drawPuny(c, column * 16, row * 16, 16, 16, x, y, width, height);
}

export function drawUnit(c: Ctx, unit: Unit, x: number, y: number, size: number, time: number, color: string, passenger?: Unit): void {
  if (unit.kind === 'levyInfantry' || unit.kind === 'skirmisher' || unit.kind === 'supplyCart') {
    setup(c, x, y, size);
    drawAuxiliary(c, unit, time, color);
    c.restore(); return;
  }
  if (unit.kind === 'sailboat') { if (!unit.inside) drawLeaderGalley(c, unit, passenger, x, y, size, time, color); return; }
  if (unit.aboardRiverTrade) { if (!unit.inside) drawSailboat(c, unit, x, y, size); return; }
  if (unit.kind !== 'leader' && unit.kind !== 'warrior' && unit.kind !== 'swordsman' && unit.kind !== 'spearman' && unit.kind !== 'horseman' && unit.kind !== 'horseArcher' && unit.kind !== 'knight' && unit.kind !== 'archer' && unit.kind !== 'scout' && unit.kind !== 'militia' && unit.kind !== 'slinger' && unit.kind !== 'worker' && unit.kind !== 'boar' && unit.kind !== 'marshBird' && unit.kind !== 'merchant') return;
  setup(c, x, y, size);
  if (unit.observationPost && !unit.observationPost.retreating) drawObservationCampfire(c, time);
  if (unit.kind === 'boar' || unit.kind === 'marshBird') drawWildlife(c, unit, time);
  else if (unit.kind === 'merchant') drawMerchant(c, unit, time);
  else drawPerson(c, unit, time, color);
  if (unit.engineer && !unit.inside) drawEngineerEquipment(c, unit.facing, unit.attackTime > 0);
  c.restore();
}


function bridge(c: Ctx, links: Connections): void {
  // The atlas's plank bridge is already shaded for this top-down view.
  // Clip arms at their junction so all combinations retain the same deck.
  const arm = (rotation: number, start: number, length: number) => {
    c.save(); c.translate(16, 16); c.rotate(rotation); c.translate(-16, -16);
    c.beginPath(); c.rect(9, start, 14, length); c.clip();
    tile(c, 21, 27, 9, 0, 14, 32);
    c.restore();
  };
  if (links.north) arm(0, 0, 23);
  if (links.south) arm(0, 9, 23);
  if (links.east) arm(Math.PI / 2, 0, 23);
  if (links.west) arm(Math.PI / 2, 9, 23);
  tile(c, 23, 27, 9, 9, 14, 14);
}

function guardTower(c: Ctx): void {
  // Keep the native battlements and doorway proportions, adding masonry
  // courses between them instead of stretching the entire little turret.
  drawPuny(c, 18 * 16, 29 * 16, 16, 8, 0, -24, 32, 16);
  for (let y = -8; y < 24; y += 8)
    drawPuny(c, 18 * 16, 29 * 16 + 4, 16, 4, 0, y, 32, 8);
  drawPuny(c, 18 * 16, 29 * 16 + 12, 16, 4, 0, 24, 32, 8);
}

export function drawFarm(c: Ctx, x: number, y: number, size: number, time: number, _variation: number, _overlay: Overlay = 'none', planted = true): void {
  drawFarmField(c, x, y, size, time, { id: 0, camp: 0, faction: 0, x: Math.floor(x / size), y: Math.floor(y / size), planted, food: 0, nextHarvest: time + 30 });
}

/** Native provision crate, shared by waiting harvests and returning peasants. */
export function drawFoodCrate(c: Ctx, x: number, y: number, size: number): void {
  drawPuny(c, 9 * 16 + 2, 31 * 16 + 5, 12, 10, x - size / 2, y - size / 2, size, size * 10 / 12);
}

function constructionSite(c: Ctx, b: Building): void {
  const bounds = b.kind === 'dock' ? dockFootprint(b) : { x: 0, y: 0, width: buildingWidth(b), height: buildingHeight(b) };
  const width = bounds.width * 32, height = bounds.height * 32;
  // The same four native wooden pegs mark every site from reservation to
  // completion. The renderer adds a small countdown over the clear interior.
  for (const x of [3, width - 7]) for (const y of [2, height - 10])
    drawPuny(c, 22 * 16, 26 * 16 + 8, 3, 8, x + bounds.x * 32, y + bounds.y * 32, 4, 8);
}

/** Attached wells use their front-left overlay; attached wooden towers use
 * short supports above the wall. Both retain their logical cell and pixel scale. */
export function drawBuilding(c: Ctx, b: Building, x: number, y: number, size: number, time: number, color: string, links: Connections = NO_CONNECTIONS, gate?: Connections, attached = false): void {
  // Farms are four real crop plots. Their bookkeeping anchor has no house,
  // tent, or other solid artwork sitting over the middle field.
  if (isFarmKind(b.kind) && !b.construction) return;
  setup(c, x, y, size);
  const overlay = b.kind === 'well' && attached;
  if (overlay) c.translate(HOUSE_WELL_OFFSET.x * 32, HOUSE_WELL_OFFSET.y * 32);
  if (b.construction) {
    constructionSite(c, b);
    c.restore(); return;
  }
  switch (b.kind) {
    case 'fort':
      if (b.fort?.destroyed) {
        for (const dx of [0, 32]) for (const dy of [0, 32]) {
          c.save(); c.beginPath(); c.rect(dx, dy + 22, 32, 10); c.clip();
          c.translate(dx, dy); drawPunyWall(c, NO_CONNECTIONS, undefined); c.restore();
        }
      } else drawFort(c, 0, 0, 64, color);
      break;
    case 'supplyDepot': drawSupplyDepot(c, 0, 0, 32); break;
    case 'dock': drawDock(c, b, 0, 0, 32); break;
    case 'palace':
      drawPalace(c, 0, 0, 64, color, b.palaceLevel);
      break;
    case 'villageTent': drawVillageTent(c, 0, 0, 32, color); break;
    case 'camp': case 'shack': case 'cottage': break; // Farm aliases render their fields separately.
    case 'house': drawWoodenHouse(c, b, 0, 0, 32, color); break;
    case 'tower':
      guardTower(c);
      break;
    case 'woodenTower':
      drawWoodenTower(c, 0, -24, 32, color, attached);
      break;
    case 'well':
      drawCoveredWell(c, 0, 0, 32, time, color);
      break;
    case 'monument': drawMonument(c, 0, 0, 32); break;
    case 'archeryRange': drawArcheryRange(c, 0, 0, 32); break;
    case 'stable': drawStable(c, 0, 0, 32, color); break;
    case 'observationPost': drawObservationPost(c, time, color); break;
    case 'scoutLodge': drawScoutsLodge(c, 0, 0, 32, color); break;
    case 'library': drawLibrary(c, 0, 0, 32, time, color); break;
    case 'blacksmith': drawBlacksmith(c, 0, 0, 32); break;
    case 'healerShack': drawHealerShack(c, 0, 0, 32); break;
    case 'ballista': drawBallista(c, b, 0, 0, 32, time); break;
    case 'guardPost': drawGuardPost(c, 0, 0, 32, color); break;
    case 'road': drawDirtRoad(c, links, b.x, b.y, b.roadStyle); break;
    case 'irrigation': drawIrrigation(c, 0, 0, 32, time, links); break;
    case 'bridge': bridge(c, links); break;
    case 'wall': drawPunyWall(c, links, gate); break;
    case 'palisade': drawPalisade(c, links, gate); break;
    case 'ruin': break; // Unsupported legacy objects are removed during migration.
  }
  c.restore();
}

export function drawOverlay(c: Ctx, overlay: Overlay, x: number, y: number, size: number, _time: number, variation: number, fordAxis: FordAxis = 'vertical'): void {
  if (!['forest', 'jungle', 'ford'].includes(overlay)) return;
  setup(c, x, y, size);
  const variant = Math.floor(variation * 65536);
  if (overlay === 'ford') {
    drawFordStones(c, punyWorldImage(), 0, 0, 32, fordAxis, variation);
  } else {
    const column = variant % 4 === 0 ? 17 : 8;
    const row = 7 + (variant >>> 3) % 3;
    tile(c, column, row, variant % 3 - 1, -3, 32, 32);
    if (variant % 5 === 0) tile(c, column, row, 18, 14, 18, 18);
  }
  c.restore();
}
