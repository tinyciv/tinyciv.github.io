import { drawMilitaryAcademy } from './military-academy-art';
import { drawFieldCannon, drawFoundry } from './field-cannon-art';
import { constructionSiteLayout, drawConstructionSite } from './construction-art';
import { drawWhalingPost } from './maritime-art';
import { drawWarship, drawShipyard } from './warship-art';
import { drawPavedRoad } from './paved-road-art';
import { drawSupplyDepot } from './supply-depot-art';
import { drawEngineerEquipment } from './leader-ability-art';
import { drawObservationCampfire, drawObservationPost } from './observation-post-art';
import { buildingArtTop, buildingWidth, buildingHeight, isFarmKind, type Building, type Overlay, type Unit } from './types';
import { drawDirtRoad, type RoadLinks } from './road-sprites';
import { drawPerson } from './unit-sprites';
import { drawAuxiliary } from './auxiliary-art';
import { drawPuny, punyWorldImage } from './puny-world';
import { drawFordStones, type FordAxis } from './ford-art';
import { drawPalace } from './palace-sprite';
import { drawFort } from './fort-art';
import { drawPunyWall } from './wall-sprites';
import { drawStoneBridge } from './stone-bridge-art';
import { drawPalisade } from './palisade-art';
import { drawFarmField } from './farm-art';
import { drawIrrigation } from './irrigation-art';
import { drawCoveredWell, drawWoodenHouse } from './wooden-building-art';
import { drawStoneWallTower } from './stone-wall-tower-art';
import { drawPalisadeTower } from './palisade-tower-art';
import type { TowerWallKind } from './wall-towers';
import { drawMonument } from './monument-art';
import { drawLibrary } from './library-art';
import { drawVillageTent } from './village-art';
import { drawArcheryRange } from './archery-art';
import { drawScoutsLodge } from './scout-art';
import { drawBlacksmith } from './blacksmith-art';
import { drawHealerShack } from './healer-art';
import { drawStable } from './cavalry-art';
import { drawBallista } from './siege-art';
import { drawCannon } from './cannon-art';
import { drawGuardPost } from './guard-post-art';
import { drawWildlife } from './wildlife-art';
import { drawMerchant } from './merchant-art';
import { HOUSE_WELL_OFFSET } from './house-wells';
import { dockArtBounds, drawDock, drawRowboat, rowboatOccupant } from './naval-art';
import { dockFootprint } from './dock';
import { drawLeaderGalley, drawTradingBoat } from './galley-art';
import { drawBarbarianGalley } from './barbarian-galley-art';
import { drawBarracks, drawForum, drawColosseum, drawGranary, drawThermalBath } from './civic-art';
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

export function drawUnit(c: Ctx, unit: Unit, x: number, y: number, size: number, time: number, color: string, passenger?: Unit, firearm = false): void {
  if (unit.kind === 'fieldCannon') { setup(c, x, y, size); drawFieldCannon(c, unit, time); c.restore(); return; }
  if (unit.aboardRowboat) {
    if (!unit.inside) {
      drawRowboat(c,unit,x,y,size);
      drawUnit(c,rowboatOccupant(unit),
        x+size*.2,y-size*.03,size*.6,time,color,undefined,firearm);
    }
    return;
  }
  if (unit.kind === 'levyInfantry' || unit.kind === 'skirmisher' || unit.kind === 'supplyCart') {
    setup(c, x, y, size);
    drawAuxiliary(c, unit, time, color);
    c.restore(); return;
  }
  if (unit.warship) { if (!unit.inside) drawWarship(c, unit, passenger, x, y, size, time, color, firearm); return; }
  if (unit.barbarianGalley) { if (!unit.inside) drawBarbarianGalley(c,unit,passenger,x,y,size,time,color,firearm);return; }
  if (unit.kind === 'sailboat') { if (!unit.inside) drawLeaderGalley(c, unit, passenger, x, y, size, time, color, firearm); return; }
  if (unit.aboardRiverTrade) { if (!unit.inside) drawTradingBoat(c, unit, x, y, size, time); return; }
  if (unit.kind !== 'leader' && unit.kind !== 'warrior' && unit.kind !== 'swordsman' && unit.kind !== 'spearman' && unit.kind !== 'pikeman' && unit.kind !== 'musketman' && unit.kind !== 'horseman' && unit.kind !== 'horseArcher' && unit.kind !== 'knight' && unit.kind !== 'archer' && unit.kind !== 'scout' && unit.kind !== 'militia' && unit.kind !== 'slinger' && unit.kind !== 'worker' && unit.kind !== 'boar' && unit.kind !== 'marshBird' && unit.kind !== 'merchant') return;
  setup(c, x, y, size);
  if (unit.observationPost && !unit.observationPost.retreating) drawObservationCampfire(c, time);
  if (unit.kind === 'boar' || unit.kind === 'marshBird') drawWildlife(c, unit, time);
  else if (unit.kind === 'merchant') drawMerchant(c, unit, time);
  else drawPerson(c, unit, time, color, firearm);
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
  drawConstructionSite(c, bounds);
}

/** Match the displayed artwork, including centered sites and rotated docks. */
export function buildingImageAnchor(b: Building, attachedWell = false): { x: number; y: number } {
  if (b.construction && b.kind !== 'well') {
    const footprint = b.kind === 'dock' ? dockFootprint(b) : { x: 0, y: 0, width: buildingWidth(b), height: buildingHeight(b) };
    const site = constructionSiteLayout(footprint);
    return { x: site.x + site.size / 2, y: site.y };
  }
  if (b.kind === 'dock') {
    const bounds = dockArtBounds(b);
    return { x: (bounds.x + bounds.width / 2) / 32, y: bounds.y / 32 };
  }
  return { x: buildingWidth(b) / 2 + (attachedWell ? HOUSE_WELL_OFFSET.x : 0),
    y: buildingArtTop(b) + (attachedWell ? HOUSE_WELL_OFFSET.y : 0) };
}

/** Attached wells use their front-left overlay. Watchtowers use the approved
 * timber artwork unless supported by a completed stone wall. */
export function drawBuilding(c: Ctx, b: Building, x: number, y: number, size: number, time: number, color: string, links: Connections = NO_CONNECTIONS, gate?: Connections, attached = false, towerWall?: TowerWallKind): void {
  // Farms are four real crop plots. Their bookkeeping anchor has no house,
  // tent, or other solid artwork sitting over the middle field.
  if (isFarmKind(b.kind) && !b.construction) return;
  setup(c, x, y, size);
  const overlay = b.kind === 'well' && attached;
  if (overlay) c.translate(HOUSE_WELL_OFFSET.x * 32, HOUSE_WELL_OFFSET.y * 32);
  if (b.construction && b.kind !== 'well') {
    constructionSite(c, b);
    c.restore(); return;
  }
  switch (b.kind) {
    case 'fort':
      if (!b.fort?.destroyed) drawFort(c, 0, 0, 96, color, b.fortLevel ?? 1);
      break;
    case 'supplyDepot': drawSupplyDepot(c, 0, 0, 32); break;
    case 'shipyard': drawShipyard(c, b, 0, 0, 32); break;
    case 'whalingPost': if (!drawWhalingPost(c)) drawWoodenHouse(c, b, 0, 0, 64, color); break;
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
      if (towerWall === 'wall') drawStoneWallTower(c, 0, 0, 32, color);
      else drawPalisadeTower(c, 0, 0, 32, color);
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
    case 'forum': drawForum(c, 0, 0, 32); break;
    case 'militaryAcademy': drawMilitaryAcademy(c); break;
    case 'foundry': drawFoundry(c); break;
    case 'granary': drawGranary(c, 0, 0, 32); break;
    case 'thermalBath': drawThermalBath(c, 0, 0, 32, time); break;
    case 'colosseum': drawColosseum(c, 0, 0, 32); break;
    case 'barracks': drawBarracks(c, 0, 0, 32); break;
    case 'blacksmith': drawBlacksmith(c, 0, 0, 32); break;
    case 'healerShack': drawHealerShack(c, 0, 0, 32); break;
    case 'ballista': drawBallista(c, b, 0, 0, 32, time); break;
    case 'siegeCannon': drawCannon(c, b, 0, 0, 32, time); break;
    case 'guardPost': drawGuardPost(c, 0, 0, 32, color); break;
    case 'road': if (!b.roadPaved || !drawPavedRoad(c, links)) drawDirtRoad(c, links, b.x, b.y, b.roadStyle); break;
    case 'irrigation': drawIrrigation(c, 0, 0, 32, time, links); break;
    // For bridges the renderer passes bank sides in the `gate` slot.
    case 'bridge': if (!drawStoneBridge(c, links, gate)) bridge(c, links); break;
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
