import { RespawnCamera } from './ui/respawn-camera';
import { researchLevel } from './game/research';
import { CHECK_INTERVAL_MS } from './game/work-cadence';
import { logEvent } from './game/simulation';
import { garrisonStatus, toggleGarrison } from './game/garrison';
import { levyDisplayStatus, levyPopulation, dismissLevy } from './game/mass-levy';
import { loadResearchIcons } from './ui/research-icons';
import { loadGameFonts } from './game/game-font';
import './ui/game-font.css';
import './style.css';
import './ui/forged-hud.css';
import { selectionSummary } from './ui/selection-summary';
import { LeaderActionFeedback } from './ui/leader-action-feedback';
import { LeaderProgressionUI } from './ui/leader-progression';
import { learnLeaderSkill } from './game/leader-progression';
import { resourceChanges } from './ui/resource-rates';
import { ResearchToolbar } from './ui/research-toolbar';
import { GoldTooltip } from './ui/gold-tooltip';
import { generateWorld, DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT } from './world/generator';
import { OPPOSING_FACTION_COUNT } from './game/civilizations';
import { DEFAULT_WORLD_STYLE, LANDFORM_NAMES, type LandformFamily, type WorldGenerationStyle } from './world/options';
import { BASE_BORDER_RADIUS } from './game/borders';
import { resolvePalaceCapture, continueAfterVictory } from './game/simulation';
import { createGame, updateGame, interactAt, selectAt, commandMove, commandAttackAt, warDeclarationTargetAt, toggleMovementMode, buildAt, diplomacyAction, getLeader, housingCapacity, migrateGame, recallRetinue, canRespawnLeader, respawnLeader, BUILD_COSTS, minimumBuildGold } from './game/simulation';
import { Renderer, MIN_ZOOM, MAX_ZOOM } from './game/renderer';
import { entityStore, resetEntities } from './game/entity-store';
import { isVisible } from './game/fog';
import { planConstruction, buildStroke } from './game/construction';
import { constructionRoute, isLinearPlacement } from './game/construction-route';
import { worldStructureRevision } from './game/world-revisions';
import { territory } from './game/borders';
import { forbiddenRevision } from './game/forbidden-zones';
import { type GameState, type BuildSelection, type InputState, type Point, WATER, isFarmKind, buildingKindForSelection } from './game/types';
import { icon } from './ui/icons';
import { isForbidden, setForbiddenRectangle } from './game/forbidden-zones';
import { BUILD_OPTIONS, buildMenuForSelection, buildSelectionForKey, type BuildMenu } from './ui/build-controls';
import { CONSTRUCTION_SECONDS } from './game/structures';
import { loadPalaceSprite } from './game/palace-sprite';
import { loadPunyCharacters } from './game/unit-sprites';
import { loadFarmArt } from './game/farm-art';
import { loadFoodArt } from './game/food-art';
import { loadNavalArt } from './game/naval-art';
import { boardedBoat } from './game/sailing';
import { loadFishingArt } from './game/fishing-art';
import { loadCityPanelArt } from './game/city-panel-art';
import { loadCombatEffectArt } from './game/combat-effect-art';
import { villageCamp, villageDiplomacyStatus } from './game/villages';
import { loadIrrigationArt } from './game/irrigation-art';
import { IRRIGATION_RADIUS, irrigationYieldMultiplier } from './game/irrigation';
import { loadTreasureArt } from './game/treasure';
import { loadMonumentArt } from './game/monument-art';
import { loadArcheryArt } from './game/archery-art';
import { loadLibraryArt } from './game/library-art';
import { loadScoutsLodgeArt } from './game/scout-art';
import { loadBlacksmithArt } from './game/blacksmith-art';
import { loadFortArt } from './game/fort-art';
import { loadPalisadeArt } from './game/palisade-art';
import { loadGuardPostArt } from './game/guard-post-art';
import { GUARD_POST_CAPACITY, GUARD_POST_UPKEEP, GUARD_POST_UPKEEP_INTERVAL } from './game/guard-posts';
import { SETTLEMENT_MAINTENANCE, WATCHTOWER_MAINTENANCE } from './game/maintenance';
import { HEALER_SHACK_RADIUS, HEALER_SHACK_MULTIPLIER } from './game/healer-shack';
import { enemyStrength, setEnemyStrength } from './game/enemy-strength';
import { DEFAULT_BANDIT_INTENSITY, banditIntensity, normalizeBanditIntensity, setBanditIntensity } from './game/bandit-intensity';
import { loadHealerShackArt } from './game/healer-art';
import { ECONOMY_INTERVAL } from './game/economy-constants';
import { loadWildlifeArt } from './game/wildlife-art';
import { loadMerchantArt } from './game/merchant-art';
import { WELL_RADIUS, WELL_POPULATION_REQUIREMENT } from './game/wells';
import { retinueCommand, toggleRetinueOrder } from './ui/retinue-controls';
import { infantryFormationControl, leaderHeldTurnForKey, leaderHotbarActionForKey } from './ui/infantry-formation-controls';
import { infantryFormationActive, toggleInfantryFormation } from './game/infantry-drill';
import { tilesInRectangle, clearArea } from './game/area-tools';
import { culturePerSecond, cultureLevel, nextCultureThreshold, MONUMENT_CULTURE_PER_SECOND, SETTLEMENT_CULTURE_PER_SECOND } from './game/culture';
import { BuildingActivityPopup } from './ui/building-activity';
import { buildingActivityAvailable } from './game/building-activity';
import { buildingAtPoint, neutralVillageEntityAt } from './game/hit-testing';
import { loadVegetationArt } from './game/vegetation-art';
import { buildingResearchRequirement, isBuildingUnlocked, RESEARCH_BRANCHES } from './game/research';
import { BIOME_NAMES, RESOURCE_NAMES, groundMovementMultiplier } from './game/geography';
import { fieldHarvestFoodForState } from './game/farms';
import { parseGameSave, serializeGameSave } from './game/game-save';
import { Frontend, type FrontendAction, type FrontendView } from './ui/frontend';
import { MultiplayerClient } from './multiplayer/client';
import type { GameCommand } from './multiplayer/protocol';
import { playerFaction } from './game/player-context';
import { automaticallyRebuildDefenses, setAutomaticallyRebuildDefenses } from './game/defense-rebuilding';
import { hasObservationLodge } from './game/observation-posts';
import { buildCostAt } from './game/simulation';
import { MobileControls } from './ui/mobile-controls';
import './ui/leader-respawn.css';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const freshSeed = () => `TinyCiv-${Math.floor(Math.random() * 900000 + 100000)}`;
// Terrain definitions changed; earlier worlds are replaced by a fresh game.
const STORAGE = 'tinyciv-save-v3';
const ENEMY_SETTING_STORAGE = 'tinyciv-enemy-strength';
let preferredEnemyStrength = 1;
const BANDIT_SETTING_STORAGE = 'tinyciv-bandit-intensity';
const REBUILD_SETTING_STORAGE = 'tinyciv-auto-rebuild-defenses';
let preferredAutoRebuildDefenses = true;
let preferredBanditIntensity = DEFAULT_BANDIT_INTENSITY;
try {
  preferredEnemyStrength = Math.max(.25, Math.min(3, Number(localStorage.getItem(ENEMY_SETTING_STORAGE) ?? 1) || 1));
  preferredAutoRebuildDefenses = localStorage.getItem(REBUILD_SETTING_STORAGE) !== 'false';
  const stored = localStorage.getItem(BANDIT_SETTING_STORAGE);
  if (stored !== null) preferredBanditIntensity = normalizeBanditIntensity(Number(stored));
} catch { /* Settings still work in memory when browser storage is unavailable. */ }
$('#app').innerHTML = '<div class="frontend-boot" role="status">Loading...</div>';
try { await loadGameFonts(); }
catch (error) {
  $('#app').innerHTML = '<div class="frontend-boot"><div><p>Unable to load the game font.</p><button id="boot-retry">Retry</button></div></div>';
  $('#boot-retry').onclick = () => location.reload();
  throw error;
}
await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let state: GameState;
let chooseInitialWorld = false;
// A one-shot development handoff preserves a large live session across a code
// reload without relying on the small localStorage quota. The name is restored
// after consumption (or explicit acknowledgement during a multi-file reload);
// production builds never read this channel.
let developmentHandoff: { state: GameState; name?: string; keepUntilAcknowledged?: boolean; camera?: Point; follow?: boolean; zoom?: number } | undefined;
if (import.meta.env.DEV && window.name.startsWith('tinyciv-development-handoff:')) {
  try {
    developmentHandoff = JSON.parse(window.name.slice('tinyciv-development-handoff:'.length));
    if (!developmentHandoff?.keepUntilAcknowledged) window.name = developmentHandoff?.name ?? '';
  } catch { window.name = ''; }
}
try {
  const serialized = developmentHandoff ? null : localStorage.getItem(STORAGE);
  const saved = developmentHandoff?.state ?? (serialized ? parseGameSave(serialized) : null);
  if (saved?.world && saved.world.tiles?.length === saved.world.width * saved.world.height && saved.factions?.[0] && Array.isArray(saved.units) && Number.isFinite(saved.rngState)) {
    state = saved;
    state.paused = Boolean(state.paused);
    state.buildMode = null;
    state.diplomacy = null;
    if (!developmentHandoff) migrateGame(state);
  } else { state = createGame(generateWorld(freshSeed()), undefined, { banditIntensity: preferredBanditIntensity }); chooseInitialWorld = true; }
} catch { state = createGame(generateWorld(freshSeed()), undefined, { banditIntensity: preferredBanditIntensity }); chooseInitialWorld = true; }
// A continued world's difficulty is authoritative over the new-game preference.
preferredBanditIntensity = banditIntensity(state);
if (chooseInitialWorld) setEnemyStrength(state, preferredEnemyStrength);
preferredEnemyStrength = enemyStrength(state);
if (chooseInitialWorld) setAutomaticallyRebuildDefenses(state, preferredAutoRebuildDefenses);

$('#app').innerHTML = `
<main class="game-area">
  <canvas id="world" tabindex="0" aria-label="TinyCiv game world. Right click or WASD to move, left click to select, 1 or E to recall retinue, 2 to change stance, 3 to toggle Infantry Drill formation, hold Q/E to rotate while active, B to build, F for fortifications, C to clear trees, buildings and construction, H for controls."></canvas>
  <div id="leader-action-feedback" class="leader-action-feedback" aria-hidden="true" hidden></div>
  <header class="resource-bar" aria-label="Resources">
    <div class="resources">
      <div class="resource food" title="Food · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/ui/resources/food.png" alt="" aria-hidden="true"><div class="resource-values"><strong id="food"></strong><span id="food-yield"></span></div></div>
      <div class="resource gold" title="Gold · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/ui/resources/gold.png" alt="" aria-hidden="true"><div class="resource-values"><strong id="gold"></strong><span id="gold-yield"></span></div></div>
      <div class="resource population" title="Population / housing"><img class="resource-icon" src="/assets/ui/resources/population.png" alt="" aria-hidden="true"><div class="resource-values"><strong id="population"></strong><span id="capacity"></span></div></div>
      <div class="resource culture" aria-label="Culture"><img id="culture-icon" class="resource-icon" src="/assets/ui/resources/culture.png" alt="" aria-hidden="true"><div class="resource-values"><strong id="culture"></strong><span id="culture-next"></span><span id="culture-rate"></span></div></div>
    </div>
    <div id="research-toolbar" class="research-toolbar" aria-label="Current research"></div>
    <div class="time-controls"><button type="button" id="menu" aria-haspopup="dialog" title="Game menu"><span aria-hidden="true" class="menu-glyph"></span> Menu</button><button type="button" id="pause" title="Pause (Space)" aria-label="Pause">${icon('pause')}</button><button type="button" id="speed" title="Simulation speed" aria-label="Change simulation speed"><span class="speed-value">1×</span></button></div>
  </header>
  <div id="paused" hidden>Paused</div>
  <div id="network-status" class="network-status" role="status" aria-live="polite" hidden></div>
  <section class="selection-panel" id="selection-panel" aria-label="Selection">
    <div class="portrait" id="portrait"></div>
    <div class="selection-copy"><div class="selection-name" id="selection-name"></div><div class="selection-stats" id="selection-stats"></div><div class="health-track" role="progressbar" aria-label="Health"><div class="health-fill"><i id="selection-health"></i></div></div><div id="selection-hint" class="selection-hint" hidden></div></div>
  </section>
  <footer class="hud">
    <div class="minimap-panel" aria-label="World overview">
      <canvas id="minimap" width="212" height="212" aria-label="Minimap. Click to move camera."></canvas>
      <div class="minimap-frame" aria-hidden="true"></div><span class="minimap-north" aria-hidden="true">N</span>
      <button id="minimap-zoom-in" class="minimap-control" title="Zoom in" aria-label="Zoom in">+</button>
      <button id="minimap-zoom-out" class="minimap-control" title="Zoom out" aria-label="Zoom out">-</button>
    </div>
    <section id="leader-xp" class="leader-xp" aria-label="Leader progression"></section>
    <section class="hotbar" aria-label="Numbered action slots">
      <button class="action-slot" data-slot="1" data-hotbar-action="recall" aria-label="Recall retinue" aria-keyshortcuts="1 E" title="Recall retinue (1 / E)"><kbd>1</kbd><span class="hotbar-art hotbar-recall" aria-hidden="true"></span><span class="hotbar-label">Recall</span></button>
      <button class="action-slot" data-slot="2" data-hotbar-action="stance" aria-label="Change stance" aria-keyshortcuts="2 Q"><kbd>2</kbd><span class="hotbar-art hotbar-stance" aria-hidden="true"></span><span class="hotbar-label">Change Stance</span></button>
      <button class="action-slot research-locked" data-slot="3" data-hotbar-action="formation" aria-label="Formation · Requires Infantry Drill" aria-keyshortcuts="3" aria-pressed="false" disabled><kbd>3</kbd><span class="hotbar-art hotbar-formation" aria-hidden="true">${icon('infantryFormation')}</span><span class="hotbar-label">Formation</span><svg class="hotbar-lock" viewBox="0 0 12 14" aria-hidden="true"><path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 6h10v8H1z" fill="currentColor"/></svg></button>
      <button class="action-slot research-locked" data-slot="4" data-hotbar-action="levy" aria-label="Mass levy" aria-keyshortcuts="4" disabled><kbd>4</kbd><span class="hotbar-art hotbar-auxiliary" aria-hidden="true">${icon('levy')}</span><span class="hotbar-label">Mass levy</span></button>
      <button class="action-slot" data-slot="5" data-hotbar-action="garrison" aria-label="Garrison" aria-keyshortcuts="5" disabled><kbd>5</kbd><span class="hotbar-art hotbar-auxiliary" aria-hidden="true">${icon('garrison')}</span><span class="hotbar-label">Garrison</span></button>
      ${Array.from({ length: 5 }, (_, i) => `<button class="action-slot" data-slot="${i + 6}" aria-label="Empty action slot ${i + 6}" disabled><kbd>${i + 6}</kbd></button>`).join('')}
    </section>
    <section class="special-actions" aria-label="Actions">
      <button data-action="build" aria-keyshortcuts="B" aria-expanded="false" aria-controls="build-panel" title="Open buildings (B)"><span class="command-art command-build" aria-hidden="true"></span><span class="action-label">Build <kbd>(B)</kbd></span></button>
      <button data-action="fortifications" aria-keyshortcuts="F" aria-expanded="false" aria-controls="build-panel" title="Open fortifications (F)"><span class="command-art command-fortify" aria-hidden="true"></span><span class="action-label">Fortify <kbd>(F)</kbd></span></button>
      <button data-action="clear" aria-keyshortcuts="C" title="Clear trees, marsh plants, buildings and construction (C). Drag a rectangle; unfinished work refunds unused gold."><span class="command-art command-clear" aria-hidden="true"></span><span class="action-label">Clear <kbd>(C)</kbd></span></button>
      <button data-action="forbid" title="Drag to forbid friendly workers, merchants and guards. Start inside a forbidden zone to erase."><span class="command-art command-forbid" aria-hidden="true"></span><span class="action-label">Forbid</span></button>
    </section>
    <section class="build-panel" id="build-panel" role="region" aria-label="Buildings" hidden>
      <button id="close-build" aria-label="Close construction menu" title="Close (Esc)">×</button>
      <div class="build-actions">
        ${BUILD_OPTIONS.map(({ kind, key, label }) => {
          const gold = BUILD_COSTS[buildingKindForSelection(kind)].gold;
          const seconds = CONSTRUCTION_SECONDS[buildingKindForSelection(kind)];
          const menuKey = buildMenuForSelection(kind) === 'fortifications' ? 'F' : 'B';
          const benefit = kind === 'camp' ? ' · Maximum 16 connected plots · Blocks over 6 plots must have a longest-to-shortest side ratio of at most 1.5:1'
            : kind === 'well' ? ` · Requires ${WELL_POPULATION_REQUIREMENT} population · Level 2 housing within ${WELL_RADIUS} tiles · Can share a house tile`
            : kind === 'irrigation' ? ` · Doubles farmland yield within ${IRRIGATION_RADIUS} tiles · Unbridged crossings are half speed · Immune to attacks`
            : kind === 'palisade' ? ' · Available immediately · One-quarter of stone wall health · Roads create gates · Displaced farms move for free'
            : kind === 'wall' ? ` · ${minimumBuildGold('wall')} gold over a palisade · Roads create gates · Displaced farms move for free`
            : kind === 'house' ? ' · Can share a well tile'
            : kind === 'dock' ? ' · Requires Sailing · Place on shore · Launches a Leader galley and an automatic fishing sailboat'
            : kind === 'monument' ? ` · +${Number(MONUMENT_CULTURE_PER_SECOND.toFixed(2))} culture per second · Expands borders`
            : kind === 'blacksmith' ? ' · Armor and weapon upgrades for the Leader and army · Set spearman proportion after Military tactics'
            : kind === 'healerShack' ? ` · Requires Traditional Medicine · ${HEALER_SHACK_MULTIPLIER}× friendly healing within ${HEALER_SHACK_RADIUS} tiles · Own borders and normal recovery delay apply · Does not stack`
            : kind === 'ballista' ? ' · Requires Siege Engines · Range 18 · Fires every 4 seconds · Prioritizes fortifications · Assembles without a civilian, including outside borders'
            : kind === 'archeryRange' ? ' · Set warrior and archer proportions · Soldiers visit to retrain'
            : kind === 'stable' ? ' · Requires Horseback Riding · Set mounted retinue proportion · Soldiers visit to mount or dismount'
            : kind === 'observationPost' ? ' · Requires a Scouts’ Lodge · 1 population · 3 gold / 30s · 3× sight · Neutral ground only'
            : kind === 'scoutLodge' ? ' · Requires Exploration · Unlocks concealed observation posts'
            : kind === 'library' ? ' · Fund technologies and faction bonuses · Open the research tree nearby'
            : kind === 'fort' ? ' · 2×2 masonry Fort · Fires arrows at two targets · 20 gold / 30s · Permanent foundation, half-price rebuilding · Skirmisher Brigade upgrades'
            : kind === 'supplyDepot' ? ' · Requires Supply train · Sends handcarts to the Leader · Delivery heals every friendly unit by up to 10 HP · No population cost'
            : kind === 'guardPost' ? ` · Up to ${GUARD_POST_CAPACITY} militia defend this city · ${GUARD_POST_UPKEEP} gold / ${GUARD_POST_UPKEEP_INTERVAL}s upkeep`
            : kind === 'woodenTower' ? ` · ${WATCHTOWER_MAINTENANCE} gold / ${ECONOMY_INTERVAL}s upkeep`
            : kind === 'palace' ? ` · Founds a new city and claims borders · Four housing and food for four people · ${SETTLEMENT_MAINTENANCE} gold / ${ECONOMY_INTERVAL}s upkeep; capital exempt` : '';
          return `<button data-build="${kind}" aria-label="${label}" aria-keyshortcuts="${menuKey} ${key.toUpperCase()}" title="${label} · ${gold} gold · ${seconds} seconds${benefit} · ${menuKey} then ${key.toUpperCase()}"><kbd>${key.toUpperCase()}</kbd><span class="action-label">${label.replace(' ', '<br>')}</span></button>`;
        }).join('')}
      </div>
    </section>
  </footer>
  <div id="build-status" class="build-status" role="status" aria-live="polite"></div>
  <div id="leader-respawn" class="leader-respawn" role="status" hidden><span>Waiting to respawn<span class="respawn-dots" aria-hidden="true">...</span></span></div>
  <div id="tile-tooltip" hidden></div>
  <section id="building-activity" class="building-activity" role="dialog" aria-modal="false" aria-labelledby="building-activity-title" hidden></section>
  <section id="leader-skills" class="leader-skills" role="dialog" aria-modal="false" aria-labelledby="leader-skills-title" hidden></section>
</main>
<div class="dialog-backdrop" id="dialog" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button id="close-dialog" class="close-dialog" aria-label="Close">${icon('close')}</button><div id="dialog-body"></div></section></div><div id="frontend"></div>`;

const canvas = $<HTMLCanvasElement>('#world');
const renderer = new Renderer(canvas, $<HTMLCanvasElement>('#minimap'));
renderer.center(state);
if (developmentHandoff) {
  if (developmentHandoff.camera) renderer.camera = developmentHandoff.camera;
  if (developmentHandoff.follow !== undefined) renderer.follow = developmentHandoff.follow;
  if (developmentHandoff.zoom !== undefined) renderer.zoom = developmentHandoff.zoom;
  developmentHandoff = undefined;
}
const buildingActivity = new BuildingActivityPopup($('#building-activity'), () => state, point => renderer.screenPoint(point),
  () => ({ width: renderer.width, height: renderer.height }), save, () => canvas.focus({ preventScroll: true }), command => sendCommand(command));
const researchToolbar = new ResearchToolbar($('#research-toolbar'));
const goldTooltip = new GoldTooltip($('.resource.gold'));
const leaderActionFeedback = new LeaderActionFeedback($('#leader-action-feedback'), () => state, point => renderer.screenPoint(point));
const leaderProgression = new LeaderProgressionUI($('#leader-xp'), $('#leader-skills'), () => state, skill => {
  if (state.multiplayer) {
    const sent = multiplayer.command({ type: 'learnLeaderSkill', skill });
    return { ok: sent, pending: sent, message: sent ? '' : 'Not connected to the match.' };
  }
  const result = learnLeaderSkill(state, skill);
  if (result.ok) save();
  return result;
}, () => {
  buildingActivity.close(); clearPlacement(); buildMenu = null;
  clearInput(); cancelStroke(); clearPointer();
  if (state.multiplayer) multiplayer.input(input);
}, () => canvas.focus({ preventScroll: true }), () => sessionStarted && !frontend.active && $('#dialog').hidden && !state.gameOver);
const input: InputState = { up: false, down: false, left: false, right: false, turnLeft: false, turnRight: false };
let pauseBeforeDialog = false, gameEndShown = false, last = performance.now(), lastUI = 0, lastSave = 0;
let dismissDialog: (() => void) | undefined;
let buildError = '';
type AreaTool = 'clear' | 'forbid';
type RetinueAction = 'recall' | 'stance';
const RETINUE_ACTION_COOLDOWN_MS = 1000;
// HUD feedback uses wall-clock time, so commands recover even while paused.
const retinueActionReadyAt: Record<RetinueAction, number> = { recall: 0, stance: 0 };
let buildMenu: BuildMenu | null = null;
let areaTool: AreaTool | null = null;
let areaStroke: { start: Point; end: Point; pointerId: number; erase: boolean } | null = null;
let pan: { x: number; y: number; cameraX: number; cameraY: number } | null = null;
let stroke: { start: Point; kind: BuildSelection; pointerId: number; twoClick: boolean } | null = null;
let routePreviewKey = "", routeContextKey = "", routePreviewAt = 0;
let pointer: Point | null = null;
const clearTurnInput = () => { input.turnLeft = input.turnRight = false; if (state.multiplayer) multiplayer.input(input); };
const clearInput = () => { input.up = input.down = input.left = input.right = false; clearTurnInput(); };
let hasSavedGame = !chooseInitialWorld, sessionStarted = false, pauseBeforeFrontend = state.paused;
let offlineState = state;
let onlineIncomeHistory: object = {};
let connectionAttempt = 0;
let leavingRoom = false;
const pendingCaptures = new Set<number>();
let retryFrontend: () => void = () => location.reload();
let leaveDestination: FrontendView = 'servers';
const frontend = new Frontend($('#frontend'), action => handleFrontendAction(action));
const multiplayer = new MultiplayerClient({
  onRooms: rooms => frontend.setRooms(rooms, multiplayer.ping),
  onRoom: (room, _faction) => {
    if (leavingRoom && room) return;
    if (!room) leavingRoom = false;
    frontend.setRoom(room, multiplayer.playerId);
    if (room?.phase === 'loading') showLoading('Starting match', '', undefined, true);
    else if (room?.phase === 'waiting' && ['loading', 'error'].includes(frontend.currentView)) showFrontend('lobby');
    if (!room && state.multiplayer) leaveOnlineState();
    else if (!room && frontend.currentView === 'loading' && document.documentElement.dataset.assets === 'ready') { showFrontend(leaveDestination); frontend.setStatus(''); }
  },
  onState: (next, initial) => {
    if (leavingRoom) return;
    const entering = initial;
    if (entering) { if (!state.multiplayer) offlineState = state; buildingActivity.close(); leaderProgression.reset(); clearInput(); clearPointer(); cancelStroke(); pendingCaptures.clear(); leaderActionFeedback.clear(); onlineIncomeHistory = {}; }
    const view = { selected: state.selected, selectedType: state.selectedType, buildMode: state.buildMode, diplomacy: state.diplomacy };
    state = next; resetEntities(state);
    if (!entering) Object.assign(state, view);
    if (initial) renderer.prepare(state);
    if (entering) { buildMenu = null; areaTool = null; renderer.center(state); gameEndShown = false; sessionStarted = true; hideFrontend(); }
    updateUI();
  },
  onStatus: message => { frontend.setStatus(message); $('#network-status').textContent = message; $('#network-status').hidden = !message || !state.multiplayer; },
  onLoading: (_message, progress) => { if (!leavingRoom && multiplayer.room?.phase === 'loading') showLoading('Starting match', '', progress, true); },
  onError: message => { if (!multiplayer.connected || frontend.currentView === 'loading' || !frontend.active) { showFrontend('error'); frontend.error(message); } else frontend.setStatus(message); },
  onResult: result => { if (!result.ok) { pendingCaptures.clear(); showCommandError(result.message || 'The command could not be completed.'); } },
});
function showCommandError(message: string): void {
  buildError = message; frontend.setStatus(message); $('#build-status').textContent = message;
  const status = $('#network-status'); status.textContent = message; status.hidden = false;
  if (buildingActivity.isOpen) $('.activity-message').textContent = message;
  window.setTimeout(() => { if (status.textContent === message) status.hidden = true; }, 3500);
}
function sendCommand(command: GameCommand): boolean {
  if (!state.multiplayer) return false;
  if (!multiplayer.command(command)) showCommandError('Not connected to the match.');
  return true;
}
function showFrontend(view: FrontendView = 'main'): void {
  if (!frontend.active && !state.multiplayer) pauseBeforeFrontend = state.paused;
  if (!state.multiplayer) state.paused = true;
  buildingActivity.close(); leaderProgression.close(); clearInput(); cancelStroke(); clearPointer(); pan = null;
  if (state.multiplayer) multiplayer.input(input);
  $('#dialog').hidden = true; dismissDialog = undefined;
  $('.game-area').inert = true; $('.game-area').classList.add('frontend-active');
  frontend.setSession(sessionStarted, hasSavedGame, !!state.multiplayer);
  syncFrontendSettings();
  frontend.show(view);
}
function hideFrontend(): void {
  frontend.hide(); $('.game-area').inert = false; $('.game-area').classList.remove('frontend-active');
  if (!state.multiplayer) state.paused = pauseBeforeFrontend;
  last = performance.now(); canvas.focus({ preventScroll: true });
}
function syncFrontendSettings(): void {
  frontend.setSettings({ zoom: renderer.zoom, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, follow: renderer.follow,
    autoRebuildDefenses: automaticallyRebuildDefenses(state.factions.find(f => f.id === playerFaction(state))),
    fullscreen: !!document.fullscreenElement, enemyStrength: enemyStrength(state), banditIntensity: multiplayer.room && !state.multiplayer ? DEFAULT_BANDIT_INTENSITY : banditIntensity(state) });
}
function showLoading(title: string, status: string, progress?: number, cancellable = false): void { showFrontend('loading'); frontend.loading(title, status, progress, cancellable); }
function leaveOnlineState(): void {
  leaderProgression.reset();
  state = offlineState; resetEntities(state); renderer.prepare(state); renderer.center(state);
  sessionStarted = false; buildMenu = null; areaTool = null; gameEndShown = false; leaderActionFeedback.clear();
  $('#network-status').hidden = true; showFrontend(leaveDestination); leaveDestination = 'servers'; updateUI();
}
function leaveMultiplayer(destination: 'main' | 'servers'): void {
  leaveDestination = destination;
  if (multiplayer.connected && multiplayer.room) { leavingRoom = true; multiplayer.leave(); showFrontend(destination); }
  else {
    leavingRoom = false; multiplayer.abandon();
    if (state.multiplayer) leaveOnlineState(); else showFrontend(destination);
  }
  frontend.setStatus('');
}
async function openMultiplayer(): Promise<void> {
  const attempt = ++connectionAttempt;
  retryFrontend = () => { void openMultiplayer(); };
  showLoading('Connecting', '', undefined, true);
  try { await multiplayer.connect(); if (attempt !== connectionAttempt) return; frontend.setStatus(''); showFrontend(multiplayer.room ? 'lobby' : 'servers'); multiplayer.list(); }
  catch (error) { if (attempt === connectionAttempt) frontend.error(error instanceof Error ? error.message : 'Unable to connect. Try again.'); }
}
function handleFrontendAction(action: FrontendAction): void {
  if (action.type === 'resume' || action.type === 'continue') { sessionStarted = true; hideFrontend(); updateUI(); return; }
  if (action.type === 'save') { frontend.setStatus(save() ? 'Single-player game saved.' : 'Browser storage is unavailable.'); return; }
  if (action.type === 'cancel-loading') {
    connectionAttempt++;
    leaveMultiplayer(multiplayer.room ? 'servers' : 'main'); return;
  }
  if (action.type === 'main') { leaveMultiplayer('main'); return; }
  if (action.type === 'multiplayer') { void openMultiplayer(); return; }
  if (action.type === 'refresh') { multiplayer.list(); return; }
  if (action.type === 'create') { multiplayer.create(action.name, action.playerName, action.color, action.options); return; }
  if (action.type === 'join') { multiplayer.join(action.roomId, action.name, action.color); return; }
  if (action.type === 'profile') { multiplayer.profile(action.name, action.color); return; }
  if (action.type === 'ready') { multiplayer.ready(action.ready); return; }
  if (action.type === 'start') { multiplayer.start(); return; }
  if (action.type === 'leave') { leaveMultiplayer('servers'); return; }
  if (action.type === 'retry') { retryFrontend(); return; }
  if (action.type === 'settings') {
    if (action.settings.autoRebuildDefenses !== undefined) {
      const enabled = action.settings.autoRebuildDefenses;
      if (!sendCommand({ type: 'auto-rebuild-defenses', enabled })) { setAutomaticallyRebuildDefenses(state, enabled); save(); }
      preferredAutoRebuildDefenses = enabled;
      try { localStorage.setItem(REBUILD_SETTING_STORAGE, String(enabled)); } catch { /* Current settings still work in memory. */ }
    }
    if (action.settings.zoom !== undefined) renderer.changeZoom(action.settings.zoom - renderer.zoom);
    if (action.settings.follow !== undefined) renderer.follow = action.settings.follow;
    if (action.settings.banditIntensity !== undefined && !state.multiplayer && !multiplayer.room) {
      setBanditIntensity(state, action.settings.banditIntensity);
      preferredBanditIntensity = banditIntensity(state);
      try { localStorage.setItem(BANDIT_SETTING_STORAGE, String(preferredBanditIntensity)); } catch { /* The current game still uses the chosen intensity. */ }
      save();
    }
    if (action.settings.enemyStrength !== undefined && !state.multiplayer && !multiplayer.room) {
      setEnemyStrength(state, action.settings.enemyStrength);
      preferredEnemyStrength = enemyStrength(state);
      try { localStorage.setItem(ENEMY_SETTING_STORAGE, String(preferredEnemyStrength)); } catch { /* In-memory settings remain active. */ }
      save();
    }
    syncFrontendSettings();
    if (action.settings.fullscreen !== undefined) {
      const task = action.settings.fullscreen ? document.documentElement.requestFullscreen() : document.exitFullscreen();
      void task.then(() => { syncFrontendSettings(); frontend.show('options'); }).catch(() => frontend.setStatus('Fullscreen is unavailable in this browser.'));
    }
    return;
  }
  if (action.type === 'new') {
    const start = () => {
      showLoading('Generating world', '');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { if (multiplayer.room) multiplayer.leave(); newWorld(action.options.seed, action.options.style, action.options.landformFamily, action.options.advancedStart); sessionStarted = true; offlineState = state; pauseBeforeFrontend = false; hideFrontend(); save(); }
        catch (error) { frontend.error(error instanceof Error ? error.message : 'Unable to generate this world. Try a different seed.'); }
      }));
    };
    retryFrontend = start; start();
  }
}
const signed = (n: number) => { const rounded = Math.round(n); return `${rounded >= 0 ? '+' : ''}${rounded}`; };
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function save(): boolean {
  if (state.multiplayer || !sessionStarted) return false;
  try { localStorage.setItem(STORAGE, serializeGameSave({ ...state, paused: frontend.active ? pauseBeforeFrontend : $('#dialog').hidden ? state.paused : pauseBeforeDialog })); hasSavedGame = true; return true; }
  catch { return false; }
}
function cancelStroke() { routePreviewKey = routeContextKey = ""; stroke = null; areaStroke = null; renderer.buildPreview = []; renderer.areaPreview = null; }
function clearPointer() { pointer = null; renderer.hover = null; }
function refreshWorldPointer() {
  // Keep the cursor anchored to the screen while following, panning, or zooming.
  renderer.hover = pointer ? renderer.worldPoint(pointer.x, pointer.y) : null;
  if (stroke && renderer.hover) {
    const x = Math.floor(renderer.hover.x), y = Math.floor(renderer.hover.y);
    const routeKey = `${stroke.kind}:${stroke.start.x},${stroke.start.y}:${x},${y}`, now = performance.now();
    if (routeKey !== routePreviewKey || now - routePreviewAt > 350) {
      const leader = getLeader(state), faction = state.factions.find(faction => faction.id === playerFaction(state));
      const contextKey = JSON.stringify([worldStructureRevision(state.world), territory(state).revision, forbiddenRevision(state),
        leader && [leader.id, leader.x.toFixed(2), leader.y.toFixed(2)], faction && [faction.id, Math.floor(faction.gold), faction.population, faction.research?.levels],
        state.buildings.map(b => [b.id, b.kind, b.faction, b.x, b.y, b.hp > 0, !!b.construction, !!b.farmSuppressed]),
        state.units.filter(u => u.engineer || stroke?.kind === 'bridge' && u.kind === 'sailboat').map(u => [u.id, u.hp > 0, u.kind === 'sailboat' ? [u.x.toFixed(1), u.y.toFixed(1)] : undefined])]);
      if (routeKey !== routePreviewKey || contextKey !== routeContextKey) {
        renderer.buildPreview = stroke.kind === 'clearTrees' ? tilesInRectangle(state, stroke.start, { x, y })
          : isLinearPlacement(stroke.kind) ? constructionRoute(state, stroke.kind, stroke.start, { x, y }) : [{ x, y }];
      }
      routeContextKey = contextKey;
      routePreviewKey = routeKey; routePreviewAt = now;
    }
  }
  if (areaTool && areaStroke && renderer.hover) {
    areaStroke.end = { x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) };
    renderer.areaPreview = { tool: areaTool, start: areaStroke.start, end: areaStroke.end, erase: areaStroke.erase };
  }
}
function closeDialog() {
  const dismiss = dismissDialog; dismissDialog = undefined;
  dismiss?.();
  $('#dialog').hidden = true;
  state.diplomacy = null;
  if (!state.multiplayer) state.paused = pauseBeforeDialog;
  if (dismiss) save();
  canvas.focus({ preventScroll: true });
}
function openDialog(html: string) {
  const dismiss = dismissDialog; dismissDialog = undefined;
  dismiss?.();
  buildingActivity.close();
  leaderProgression.close();
  if ($('#dialog').hidden) pauseBeforeDialog = state.paused;
  if (!state.multiplayer) state.paused = true;
  clearInput(); cancelStroke(); clearPointer();
  if (state.multiplayer) multiplayer.input(input);
  $('#dialog-body').innerHTML = html;
  $('#dialog').hidden = false;
  $('#close-dialog').hidden = false;
  $('#close-dialog').focus();
}
function newWorld(seed: string, style: WorldGenerationStyle = DEFAULT_WORLD_STYLE, landformFamily: LandformFamily = 'mixed', advancedStart = false) {
  respawnCamera.cancel(); deathCamera = undefined; wasWaitingForRespawn = wasRespawnPanning = false;
  dismissDialog = undefined;
  buildingActivity.close();
  leaderProgression.reset();
  state = createGame(generateWorld(seed, undefined, undefined, { style, landformFamily }), undefined, { advancedStart, banditIntensity: preferredBanditIntensity });
  setEnemyStrength(state, preferredEnemyStrength);
  setAutomaticallyRebuildDefenses(state, preferredAutoRebuildDefenses);
  buildMenu = null; areaTool = null;
  clearInput(); clearPointer(); cancelStroke(); pan = null; renderer.moveMarker = null; renderer.movementModeMarker = null; leaderActionFeedback.clear();
  renderer.prepare(state); renderer.center(state);
  gameEndShown = false; pauseBeforeDialog = false; buildError = '';
  last = performance.now();
  closeDialog(); save(); updateUI();
}
function showPalaceCapture() {
  const offer = state.palaceCaptures?.find(offer => !pendingCaptures.has(offer.palaceId) && (offer.captor === undefined || offer.captor === playerFaction(state)));
  if (!offer) return;
  openDialog(`<h2 id="dialog-title">Capture ${escape(offer.cityName)}?</h2><p>Keep the city name and immediately claim its settlement at <strong>10% health</strong>.</p><div class="dialog-actions"><button id="leave-palace">Leave destroyed</button><button class="primary" id="capture-palace">Capture city</button></div><p id="capture-result" role="status"></p>`);
  dismissDialog = () => {
    if (sendCommand({ type: 'capture', buildingId: offer.palaceId, capture: false })) pendingCaptures.add(offer.palaceId);
    else resolvePalaceCapture(state, offer.palaceId, false);
  };
  $('#leave-palace').onclick = () => { closeDialog(); updateUI(); };
  $('#capture-palace').onclick = () => {
    if (sendCommand({ type: 'capture', buildingId: offer.palaceId, capture: true })) { pendingCaptures.add(offer.palaceId); dismissDialog = undefined; closeDialog(); return; }
    const result = resolvePalaceCapture(state, offer.palaceId, true);
    if (!result.ok) { $('#capture-result').textContent = result.message; return; }
    dismissDialog = undefined;
    closeDialog(); updateUI(); save();
  };
  $('#leave-palace').focus();
}
function showMenu() {
  showFrontend('main');
}
function showNewWorld() { showFrontend(state.multiplayer ? 'main' : 'single'); }
function showGameEnd() {
  if (state.multiplayer) {
    const defeated = state.multiplayer.winner !== -1 && state.multiplayer.winner !== playerFaction(state);
    openDialog(`<h2 id="dialog-title">${state.multiplayer.winner === -1 ? 'Draw' : defeated ? 'Defeat' : 'Victory'}</h2>${defeated ? '' : '<p>The match has ended.</p>'}<div class="dialog-actions"><button class="primary" id="leave-match">${defeated ? 'New World' : 'Return to multiplayer'}</button></div>`);
    if (defeated) { $('#close-dialog').hidden = true; $('#leave-match').focus(); }
    $('#leave-match').onclick = () => { closeDialog(); leaveMultiplayer('servers'); };
    return;
  }
  const respawn = !state.victory && canRespawnLeader(state);
  openDialog(state.victory
    ? '<h2 id="dialog-title">Victory</h2><p>All rival factions have joined or fallen. You can keep building and exploring this world.</p><div class="dialog-actions"><button class="primary" id="keep-playing">Keep playing</button><button id="play-again">New world</button></div>'
    : `<h2 id="dialog-title">Defeat</h2><div class="dialog-actions"><button class="primary" id="respawn" ${respawn ? '' : 'disabled'}>Respawn</button><button id="play-again">New World</button></div>`);
  if (!state.victory) {
    $('#close-dialog').hidden = true;
    $(respawn ? '#respawn' : '#play-again').focus();
  }
  $('#play-again').onclick = showNewWorld;
  if (state.victory) {
    const resume = () => {
      if (!continueAfterVictory(state)) return;
      gameEndShown = false; pauseBeforeDialog = false; last = performance.now();
      save(); updateUI();
    };
    // Escape and the dialog × also resume, so dismissing victory cannot strand
    // the player in a frozen world with no way to reopen its action button.
    dismissDialog = resume;
    $('#keep-playing').onclick = closeDialog;
  }
  if (!state.victory) $('#respawn').onclick = () => {
    const result = respawnLeader(state);
    if (!result.ok) { $<HTMLButtonElement>('#respawn').disabled = true; $('#play-again').focus(); return; }
    clearInput(); cancelStroke(); clearPointer(); pan = null;
    buildMenu = null; areaTool = null; buildError = '';
    renderer.moveMarker = null; renderer.movementModeMarker = null; leaderActionFeedback.clear(); renderer.center(state);
    gameEndShown = false; pauseBeforeDialog = false; last = performance.now();
    closeDialog(); save(); updateUI();
  };
}
function showHelp() {
  openDialog(`<h2 id="dialog-title">Controls</h2><dl class="controls"><dt>WASD / arrows</dt><dd>Move the Leader, including while placing buildings. In Formation 3, W/S advance/reverse and A/D strafe relative to facing.</dd><dt>Right click</dt><dd>Move to ground, attack enemies, or open diplomacy on a peaceful faction’s building</dd><dt>Left click</dt><dd>Select a unit or building</dd><dt>Leader attack</dt><dd>Automatically throws javelins up to 4 tiles, or 5 when firing downhill</dd><dt>2 / Q</dt><dd>Cycle retinue stance: Defensive, Hold, Aggressive. Hold Q to rotate left while Formation 3 is active; 2 always changes stance.</dd><dt>1 / E</dt><dd>Recall the retinue without changing stance. Hold E to rotate right while Formation 3 is active; 1 always recalls.</dd><dt>3 · Infantry Drill</dt><dd>Toggle close rectangular ranks after researching Infantry Drill with at least eight retinue soldiers. If fewer than five remain, the formation disbands and its survivors and Leader rout. The Leader stays in the center with ranged troops in the rear; soldiers adjust around nearby obstacles while clear ranks keep their places. March at 105% speed, with +25% frontal damage and +50% defense. Hold Q/E to rotate continuously; release to stop. A/D strafe without changing facing.</dd><dt>Shift</dt><dd>Separate mob / travel setting: move together as a mob around the Leader at three-quarter speed</dd><dt>Farm peasants</dt><dd>Gather ripe food and carry it to the settlement before it spoils</dd><dt>B</dt><dd>Open / close buildings</dd><dt>F</dt><dd>Open / close fortifications</dd><dt>B then R / G / H / U</dt><dd>Road / farm / house / irrigation</dd><dt>F then P / T / G / L</dt><dd>Wall / wood tower / guard post / ballista</dd><dt>B then V / L / T</dt><dd>Bridge / well / dock</dd><dt>Sailing</dt><dd>Research Sailing after Exploration, then build a dock on shore. Each completed dock launches one sailboat. Right-click your boat to board; use WASD or right-click water to sail. Right-click a reachable shore to disembark. The empty boat stays behind for reboarding; the retinue remains on land.</dd><dt>C</dt><dd>Clear trees, buildings, and construction sites with one rectangular selection</dd><dt>B then Y</dt><dd>Stable after Horseback Riding</dd><dt>B then M / K / J / N</dt><dd>Monument / blacksmith / archery range / new settlement</dd><dt>Drag to build a line</dt><dd>Drag roads, walls, bridges, or irrigation ditches. On touchscreens, tap the start and then the end.</dd><dt>Clear</dt><dd>Drag a rectangle to queue tree or marsh-plant clearing, cancel unfinished friendly construction with its unused gold refunded, and remove completed owned buildings or buildings within your borders without a refund. You can also drag directly from Clear to a single tile. Occupied crossings remain when there is no safe exit.</dd><dt>Forbid</dt><dd>Drag a rectangle to keep friendly workers, merchants and guards out. The Leader and retinue may cross. Start a drag inside a forbidden zone to allow that rectangle again. One white marker identifies each connected zone.</dd><dt>4–10 slots</dt><dd>Empty and unassigned</dd><dt>Space</dt><dd>Pause / resume</dd><dt>= / -</dt><dd>Increase / decrease simulation speed, from 1× to 4×</dd><dt>Home</dt><dd>Center on Leader</dd><dt>Y</dt><dd>Tile yields</dd><dt>Wheel / minimap + / -</dt><dd>Zoom</dd><dt>Middle-drag / minimap</dt><dd>Pan camera</dd><dt>N</dt><dd>New world</dd><dt>Esc</dt><dd>Cancel</dd></dl><p>Normal games begin with 20 residents. Advanced start begins with 250 residents, every building, and 12 naturally supported retinue soldiers: 3 each of warriors, archers, spearmen, and horsemen. Infantry Drill is already researched. New and replacement retinue soldiers recruit one at a time, ten game seconds apart. Farms are walkable single-tile fields costing 15 gold and 3.75 seconds of work each; farms and other buildings can stand directly beside them. Each edge-connected farm block is limited to 16 plots. Blocks of more than six plots must be compact: the longer side can be at most 1.5 times the shorter side. Each plot produces about 1.07 food every 60 seconds before terrain and bonuses, averaging about 0.53 per 30-second economy cycle. Connected wheat plots grow and ripen together. Each contiguous same-owner crop parcel uses one peasant, subject to available residents. Settlements stagger departures, and each peasant can sweep the entire parcel before returning. Peasants wait inside between trips. Ripe food has 11 seconds of freshness; its timer pauses only while the peasant is actively collecting inside that parcel, including already gathered food. Waiting, fleeing and the return journey consume the remaining time. At least 1.875 farmland tiles per resident are needed before delivery losses. Larger cities need more farmland, and longer delivery routes lose more food to spoilage, with no hard population cap; roads, irrigation, research and bonuses can improve supply. A courier gathers only from the assigned contiguous parcel and checks that the remaining freshness allows the walk home. Ripe crops must reach the settlement before they spoil. After 120 seconds without a visit by an owning unit, a farm stays fallow until a unit returns; its peasant can walk back to restart cultivation. Only neutral, unclaimed farms disappear after ten minutes without an owner. Claiming cancels that timer; owned farms remain even while fallow. Click a nearby farm to plant one orchard for 5 gold or the nearest ten for 50 gold. Orchards establish for 120 seconds and then yield 50% more food. Only delivered food feeds the population. Longer journeys leave less time to return a harvest before it spoils. Roads, terrain, and traffic affect how much food reaches the settlement. A hopping clock warns of an expiring harvest; red numbers show food lost. Governors build farms or houses to relieve the city’s food or housing bottleneck, filling suitable enclosed housing sites first. New and relocated farms favor adjoining fields and fill gaps to form compact blocks. Farm scoring uses actual terrain-weighted walking routes from settlement doors, so short straight-line distances across water do not hide long delivery detours. Approach within three tiles of your settlement and click it to toggle Governor permissions or import an immigrant for 100 gold. Each immigrant purchase fills one vacant bed in that city; full settlements cannot import immigrants. Buy retinue slot adds one permanent faction-wide slot for 1,000 gold, filled through normal recruitment. Each purchased slot costs 5 gold every 30 game seconds, even while vacant, in addition to soldier upkeep. A completed blacksmith opens armor and weapon upgrades at the same range. Tiers I–VI cost 200 / 400 / 600 / 800 / 1,000 / 1,200 gold and set defense or attack to 1.15× / 1.3× / 1.5× / 1.7× / 1.9× / 2.1× for your Leader and retinue, including new recruits. Armor also strengthens defensive buildings, and weapons improve tower attacks. Armor tiers I–III use buckler, oval, and legionary shields; IV–VI retain the legionary shield. Farm and Housing checkboxes independently allow automatic construction; each settlement uses its own development clock and construction limits with shared faction gold; Escape or the red × closes the panel. Open buildings with B or fortifications with F, choose a structure, then click to place it. Clear is available directly with C for trees, buildings, and construction sites. Construction buttons show names and an upper-right shortcut letter; hover to see prices and requirements. Footprints may be placed in fog of war. A peasant travels from the settlement to construct it. Generated dirt trails connect most neutral villages, using fords to cross rivers. They give 5% faster movement, cannot be constructed, and disappear beneath newly placed roads. Roads can start from either bank of a ford or extend an existing road or bridge. Dragging from or across a ford leaves the crossing intact and free. Repeated travel creates roads only inside faction borders. Construction workers, harvesters, the Leader, and the retinue cross fields without contributing to road creation. Roads block farm placement; placing a road, including a caravan or foot-traffic road, moves an existing farm to a suitable reachable plot at no cost. If no replacement plot exists, the road is not placed. Invalid cells in construction drags are skipped. Queued sites remain open ground until a builder starts work. One builder per five residents shares construction and repair duties; damaged buildings can be repaired after five seconds without a hit. Construction uses gold: farms cost ${BUILD_COSTS.camp.gold}, houses ${BUILD_COSTS.house.gold}, wells ${BUILD_COSTS.well.gold}, monuments ${BUILD_COSTS.monument.gold}, and blacksmiths ${BUILD_COSTS.blacksmith.gold}. Blacksmiths take 90 seconds to build. Build a library with B then I: ${BUILD_COSTS.library.gold} gold, a 2×2 footprint, and 90 seconds. Its research tree unlocks buildings, units, and faction bonuses. Approach within three tiles and use the library slider to direct a share of incoming gold to Science, starting at 25%. The cheapest available technology runs automatically. Select any technology and Prioritize to put it first, including distant technologies whose prerequisites are handled automatically. Add multiple priorities, move one to the front, or remove it; earned Science is retained. The top bar shows the current technology and progress. Research pauses at 0% allocation or without a completed library; additional libraries do not multiply progress. Reinforced Defenses adds 30% wall and tower health; Coinage adds 20% trade gold; Urban Planning adds one housing place per house; Metal Tools adds 25% construction and repair speed; Fletching adds 15% archer damage; Grain Storage keeps newly harvested grain fresh 50% longer. Fortification also unlocks Upgrade to Keep in the settlement popup: a free, immediate stone upgrade from 650 to 6,500 maximum health that preserves the current health percentage. Keeps shoot arrows, prevent gold theft, and house ten residents. A further 1,000-gold housing upgrade adds fifteen places, for twenty-five total. Houses, wells, bridges, roads, settlements, and farms need no research. Military Tactics unlocks stronger, piercing spearmen, allocated at an archery range. Siege Engines unlocks ballistae: F then L, 300 gold, 30 seconds of automatic assembly, twelve-tile range and one shot every four seconds. Traditional Medicine unlocks a Healer’s shack: B then P, 200 gold, one tile, and 45 seconds to build. Friendly people within four tiles heal three times faster (7.2 HP per second) inside their own borders after the usual 15-second recovery delay. Overlapping shacks do not stack. Exploration unlocks Scouts’ Lodges. Build a lodge with B then O for 100 gold and 45 seconds to unlock observation posts in Fortify. Lodges no longer recruit automatic explorers. Archery ranges cost 400 gold, occupy two cells, and take 90 seconds. Their linked sliders set warrior/archer proportions and expected counts. Soldiers visit the range to retrain; replacements may spawn as archers. Archers cost an extra 0.5 gold each 30 seconds, have four-tile range, two-thirds health, half defense and 80% attack, and retreat from melee. Arrows pass buildings but stop at walls. Moving formations put archers behind warriors. Wells require ${WELL_POPULATION_REQUIREMENT} population. A house and a friendly well can share one tile in either build order, including pending construction; wells can also stand alone. Click the front-left well or the house entrance to select each separately. Level 3 houses require well coverage, 40 nearby residents within six tiles, and a guard post in their city’s borders. They hold nine residents and earn 50% more gold per resident. Lost requirements cause a bouncing warning, followed by downgrade after 60 seconds. Each settlement keeps independent population-growth progress based on its city’s net food production, at twice the previous rate, with up to ten births per 30-second economy tick. Births use only that city’s vacant homes and cost four food from the shared delivered supply. Older cities cannot take a newer city’s births. Each completed well brings friendly houses within ${WELL_RADIUS} tiles to level 2; overlapping wells do not add more levels. Fords cross the whole river in one to three lanes and allow travel at 45% of normal speed. Forest along a viewing path reduces sight, leaving 30% of normal range in continuous woodland. Fog reveals whole map cells with soft edges and lingers briefly before fading back in. Your territory is always fully observed, including woodland. Rounded borders alternate white and faction color, expand through culture, extend across rivers, and mark where your units can heal after 15 seconds without damage. Borders appear only on discovered tiles. Each completed settlement produces 12 culture per minute, in addition to monuments. Each completed monument immediately claims a ${BASE_BORDER_RADIUS.monument}-tile radius and produces ${Number(MONUMENT_CULTURE_PER_SECOND.toFixed(2))} culture per second. Population does not affect borders. Settlements and houses retain their 30% border buffer. Culture expands each source’s reach by 1.3 tiles at 100, 300, 600, 1000 culture and progressively higher totals. New cities inherit at most 100 culture; further border growth uses culture earned after their settlement is completed. Buildings claimed by your territory change allegiance, except guard posts and watch towers. Outlying farms change hands when another faction’s border reaches them; farms that still touch their owner’s territory remain theirs. Forest and jungle consume more cultural reach, following the same cost as line of sight, so borders follow the terrain. Only full factions have borders; raider camps do not. Earned culture remains after a monument is destroyed. The culture counter shows the next expansion threshold. Enclosing your settlement with completed walls, friendly gates, and uncrossable water gives houses inside that region 30% faster population growth, marked by green pixel glints sweeping southwest to northeast. Unguarded fords, bridges, and wall breaches break the enclosure. Level-three houses inside a secure enclosure become level four, using the chimney house and holding ten people before housing bonuses. They still need the well, nearby population, and city guard post. Losing protection starts a 60-second recovery warning before returning to level three; losing the other requirements can return them to level two. The Leader collects ordinary wilderness treasure chests for 200 gold. Enemy warriors earn 6 gold and archers earn 8 gold; marauder leaders earn 50. Start with four escorts, then gain one per 20 population through 100, one per additional 50 through 500, and one per additional 75 thereafter. Escorts belong to squads of three; surviving squads keep their shared veterancy and pass it to replacements. Only losing every member destroys a squad and its veterancy. Regular requires 10 kills, Veteran 100, Hardened 250 and Elite 500. Hardened has three close gold chevrons; Elite has a thunderbolt. Elite deals 130% more damage and takes 85% less damage after armor than an otherwise equivalent untrained unit. New and replacement escorts leave the settlement one at a time and travel to the Leader. Held friendly soldiers step aside for the Leader and return to their posts without changing stance. When the Leader slows or stops, escorts gather around them and engage nearby enemies according to their stance. Workers flee immediately when attacked. Clear trees sends a settlement peasant to chop each marked tree, leaving a stump for thirty game seconds. Farms, roads, bridges, irrigation, walls, palisades, ballistae, and new settlements may be built outside your borders. Towers, guard posts, and other new buildings must fit entirely inside your own borders. Neutral-village territory remains reserved against foreign construction. A settlement costs 500 gold, takes 90 seconds, and requires a clear 2×2 footprint and a builder route from an existing city. It creates a named city with borders, four settlement beds and four food per economy cycle so its first residents can grow before farms and houses are built. Imported residents remain assigned to that city. Fleeing Leaders seek the nearest reachable completed settlement. Each city selects another reachable friendly city for trade. Each city pair shares one mounted caravan traveling back and forth at 1.3 tiles per second before terrain modifiers. Each domestic delivery pays one gold per planned route tile, with a distance premium capped at 50%. Actual resident populations at both endpoints scale the payment with diminishing returns; cities share their trading capacity across routes. Empty endpoints earn nothing. Fractions are retained internally, and detours cannot increase a quoted delivery. Merchants lay roads along eligible travel cells, including outside borders; killing one awards 200 gold. Wild boars graze in herds of 1–8, resting for 22–38 seconds between short slow forage walks. They run when humans approach. Military units hunt within range when free of enemy combat. Each kill gives 5 food and +10% growth for 30 seconds; kills stack with independent expiry. Replacement herds appear only out of sight, at most one every 3–5 minutes. Buildings can stand directly beside walls. Manual, merchant and foot-traffic roads relocate farms to reachable free plots at no cost; roads and farms cannot share a tile. Irrigation ditches remain in place. Irrigation costs ${BUILD_COSTS.irrigation.gold} gold per tile and takes four seconds to dig after a builder arrives. New ditches must connect cardinally to a river, lake or existing irrigation ditch; continuous drags can start at either end. Completed ditches double farmland harvests within three tiles; overlapping coverage does not stack. Governors compare expected harvest per crop tile, prioritizing higher-yield irrigated sites within the city’s collection radius. Automatic farms can share irrigation channels, but cannot cover roads. Green placement shading shows the benefited area. Ditches share farmland and road tiles. Unbridged ditch tiles halve movement speed; roads over them form small bridges. Enemy units cannot attack or destroy ditches. Use Clear (C) to remove ditches and other eligible building layers in a selected area. Completed structures return no gold; unfinished friendly construction refunds its unused gold. Manual houses may stand alone or fill narrow parcels inside your borders, within ten tiles of the Leader. Builders wait for access to isolated orders. Governors preserve access and choose the nearest suitable housing cell, preferring enclosed ground. When that cell is farmland, the whole farm moves to a reachable plot farther from its settlement at no cost; the new home gains one permanent extra housing place. Bridges span up to eight water tiles across rivers, lakes, coast, or ocean and must have clear land at both ends. Click water to preview the shortest complete crossing, or drag straight across to choose its direction. Other buildings can replace roads when the placement rules are met. Completed settlements receive free roads around their perimeter wherever tiles are buildable. Nearby settlement and blacksmith activity panels can be opened while the build menu is active. The bottom-right action card always keeps Build (B), Fortify (F), Clear (C), and Forbid; inspecting other units or buildings does not change it. Clear cancels unfinished friendly construction with unused gold refunded and removes completed eligible structures without a refund. Recall is on slot 1 (or E); slot 2 (or Q) cycles retinue stance. Click empty ground to clear selection. All construction sites show wooden pegs and a small circular countdown for remaining work until complete; each wall section takes four seconds. Wooden towers throw javelins up to six tiles. A guard post costs 200 gold and starts with three militia, upgradeable to five for 100 gold and eight for 125 gold, stronger than ordinary marauders but weaker than regular warriors. They deploy against reachable enemies in their city’s borders or nearby threats to civilians, and can pursue an engaged enemy up to 20 tiles from their post, including beyond the border. They return home after ten seconds without a reachable threat. Their veterancy belongs to the post, and deaths reduce city population. The first 30 seconds after completion are included. Upkeep is 15 / 20 / 30 gold every 30 seconds for three / five / eight guards, including peacetime; an unpaid post recalls its militia until it can pay. Casualties are replaced at the next paid upkeep interval. The guard-post popup’s Stay inside city walls option confines that post’s guards to its city enclosure. Guards outside return home; without a complete enclosure, they stay in the post. A tower and a friendly wall can share one tile in either build order; click the upper tower or lower wall face to select each separately. Gates must remain clear of towers. Walls over roads form gates for friendly units. Placing stone walls over friendly or neutral palisades costs 25 gold per tile, crediting the palisade’s 5-gold cost. The palisade remains until the replacement finishes, and canceling refunds only the unfinished upgrade. Walls lose their owner when no completed city building remains within eight tiles; the faction with the most nearby city buildings claims them, with ties remaining neutral. Neutral gates admit everyone. Roads on existing friendly or neutral walls can create gates without adjoining roads or road-junction restrictions. Gates need one intervening wall tile. Solid 2×2 wall blocks are not allowed. Ordinary road junctions need two tiles of separation. All marauders deal 15% less damage after armor. Visible routing allies can spread panic through hostile armies during nearby fighting; steady commanders reduce that pressure. Routed marauders cannot rally for at least 15 game seconds. Raiders emerge from camps with palisade watchposts and a stone-walled refuge, with wave intervals falling from 26 to 14 seconds over fifteen game minutes. Weapon and armor strength rise linearly from 1× to 1.6× over the same period and then stop increasing. Waves grow to at most 60, split into parties of at most 30 including a leader. Spawning still saturates at 90 living raiders per camp and 240 globally; survivors count toward the limits. Destroying tents reduces recruitment toward a five-raider reserve. Destroy all four inner watchtowers to stop that camp’s recruitment; a replacement camp is attempted on hidden, suitable terrain after 120 seconds. ${OPPOSING_FACTION_COUNT} rival civilizations each begin with two named cities and extra gold. Rival settlements build defenses and protect their homes. When your troops destroy a rival settlement, choose whether to capture it immediately at 10% health and retain its city name. Units prioritize other units and buildings ahead of walls, use reachable entrances, and breach blocking wall sections only when needed to reach a city target. Raider leaders are faster and tougher than ordinary raiders. When one dies, nearby marauder soldiers within six tiles immediately lose 40 morale. A bouncing red mark warns of an imminent wave. Right-click a visible peaceful faction’s building to choose Declare War. Approach a rival settlement to discuss confederation. Raised shelves vary in number, size, and shape; some stack into two tiers. Cliff edges can only be crossed using stair entrances, one tier at a time. Stairs and their landings must remain clear of buildings. After defeat, Respawn returns an untrained Leader to a random reachable tile within four tiles of a surviving settlement, with no enemies on neighboring tiles. New worlds are ${DEFAULT_WORLD_WIDTH}×${DEFAULT_WORLD_HEIGHT} tiles with varied continents, island chains, and archipelagos. Rivers and coastlines share the same water colors. White neutral villages begin with three tents and 2–5 villagers, at roughly 1.5 villages per full faction. Click any visible village building or villager to trade for 250 gold, ally from 3000 gold, or declare war. Each ten gold the village earns from completed trade journeys with you reduces the alliance price by one, to a minimum of 500 gold; spending does not reset the discount. You can also click the main tent within three tiles. Raiders ignore independent villages; allied villages defend against raiders. Trade and alliance are separate purchases. Village caravans use a separate distance-based payout without domestic population scaling. Allies defend against your hostile factions and raiders, share twenty-tile sight, and slowly replace villagers without farming. Their identity adds one faction-wide bonus: growers +10% harvests, merchants +15% trade, builders +15% construction and repairs, or scholars +15% research. Duplicate identities do not stack; losing the main tent removes its benefits. Village caravans pay both partners. Villages spend that income on houses clustered in groups of one to three, housing upgrades through level three, and defenses, up to ten houses, twelve guards, two guard posts and four wooden towers, with no walls or Leader. Prosperous rival factions can also open a village trade route; their trade does not reduce your alliance price. Progress saves automatically.</p><p>Press Y and hover a tile to inspect its biome, soil, regional resource, and any discovery. Wetlands, tundra, and alpine ground slow travel; roads restore their usual speed. Soil fertility changes farm harvests, and irrigation and orchards retain their bonuses. Cities develop local specialties from nearby accessible clay, iron, stone, salt, and fish deposits. Completed settlements cost ${SETTLEMENT_MAINTENANCE} gold every 30 seconds, with one capital exempt; watchtowers cost 5. There is no per-population maintenance. Unpaid upkeep stays as a negative treasury and later income repays it. Governors reserve upkeep before ordering construction. New settlements cost 100 gold. Domestic trade pays at most 6 gold per trip while either city has 20 residents or fewer, including bonuses. It rises rapidly to the full route payout by 30 residents at both ends. The full payout is 1.5 gold per planned route tile with a distance premium capped at 50%, multiplied by the harmonic mean H of both endpoints’ resident shares divided by H + 50. Each city pair still shares one caravan. Trade earns 5% more for each specialty found at only one end of the route, up to 25%. Select a settlement to inspect its specialties and trade bonus. Most wilderness chests contain 200 gold; rare named discoveries have individual rewards. Boars prefer productive woodland and freshwater habitats. Marsh birds spawn in coastal wetlands, move equally across land and water, and yield 20 food per hunted bird.</p>`);
}
function showDiplomacy(id: number) {
  const faction = state.factions.find(candidate => candidate.id === id);
  if (!faction) return;
  if (faction.villageId !== undefined) {
    const camp = state.villages?.find(village => village.id === faction.villageId)?.campId;
    if (camp !== undefined) showVillageDiplomacy(id, camp);
    return;
  }
  const chance = Math.round((.15 + faction.affinity * .007) * (faction.relation === 'war' ? .5 : 1) * 100);
  openDialog(`<h2 id="dialog-title" style="color:${faction.color}">${escape(faction.name)}</h2><div class="diplomacy-stats"><span>${faction.relation === 'war' ? 'At war' : 'At peace'}</span><span>Affinity ${Math.round(faction.affinity)}%</span><span>Population ${faction.population}</span></div><div class="dialog-actions"><button id="confederate">Confederate · ${chance}%</button><button id="war-action">${faction.relation === 'war' ? 'Attack settlement' : 'Declare war'}</button></div><p id="diplomacy-result" role="status"></p>`);
  $('#confederate').onclick = () => {
    if (sendCommand({ type: 'diplomacy', faction: id, action: 'confederate' })) { closeDialog(); return; }
    const result = diplomacyAction(state, id, 'confederate');
    if (result.ok) closeDialog();
    else {
      showDiplomacy(id);
      $('#diplomacy-result').textContent = result.message;
    }
  };
  $('#war-action').onclick = () => {
    if (faction.relation === 'war') {
      const palace = state.buildings.find(b => b.faction === id && b.kind === 'palace');
      const leader = getLeader(state);
      if (palace && sendCommand({ type: 'attack', x: palace.x + .5, y: palace.y + .5 })) { closeDialog(); return; }
      if (palace && leader) { leader.target = palace.id; leader.destination = undefined; leader.path = undefined; leader.repathAt = 0; }
      closeDialog();
    } else {
      if (sendCommand({ type: 'diplomacy', faction: id, action: 'war' })) { closeDialog(); return; }
      const result = diplomacyAction(state, id, 'war');
      if (result.ok) closeDialog();
      else $('#diplomacy-result').textContent = result.message;
    }
  };
}
function showVillageDiplomacy(factionId: number, entityId: number) {
  const village = state.villages?.find(candidate => candidate.faction === factionId);
  const camp = village && villageCamp(state, village);
  const status = camp && villageDiplomacyStatus(state, camp, true);
  if (!status) return;
  state.selected = entityId; state.selectedType = state.units.some(unit => unit.id === entityId) ? 'unit' : 'building'; state.diplomacy = factionId;
  const labels = { trade: 'Establish trade', ally: 'Form alliance', war: 'Declare War' };
  const relation = status.relation === 'trade' ? 'Trading' : capitalize(status.relation);
  openDialog(`<h2 id="dialog-title">${escape(status.village.name)}</h2>
    <p class="diplomacy-stats">${relation}${status.relation === 'allied' && status.village.trading ? ' · Trading' : ''}</p>
    <p>Trade creates a caravan. Both partners earn gold after each completed journey.</p>
    <p>Alliance shares sight and local defense. <strong>${escape(status.bonusName)}:</strong> ${escape(status.bonusDescription)}</p>
    ${status.relation === 'allied' ? '' : `<p class="diplomacy-stats village-trade-discount">${status.allianceDiscount ? `Trade discount: -${status.allianceDiscount} gold. ` : ''}Every 10 gold traded with you lowers the alliance price by 1, to a minimum of 500.</p>`}
    <div class="dialog-actions">${(['trade', 'ally', 'war'] as const).map(action => {
      const option = status[action];
      return `<button id="village-${action}" data-village-diplomacy="${action}" ${option.available ? '' : 'disabled'} title="${escape(option.reason)}">${labels[action]}${option.cost ? ` · ${option.cost} gold` : ''}</button>`;
    }).join('')}<button id="cancel-war">Cancel</button></div><p id="war-result" role="status"></p>`);
  $('#cancel-war').onclick = closeDialog;
  for (const action of ['trade', 'ally', 'war'] as const) $(`#village-${action}`).onclick = () => {
    if (sendCommand({ type: 'diplomacy', faction: factionId, action, buildingId: entityId })) { closeDialog(); return; }
    const result = diplomacyAction(state, factionId, action, entityId);
    if (result.ok) { closeDialog(); save(); updateUI(); }
    else $('#war-result').textContent = result.message;
  };
}
function showDeclareWar(factionId: number, buildingId: number) {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return;
  if (faction.villageId !== undefined) { showVillageDiplomacy(factionId, buildingId); return; }
  state.selected = buildingId; state.selectedType = 'building'; state.diplomacy = factionId;
  openDialog(`<h2 id="dialog-title">Declare war?</h2><p>Declare war on <strong>${escape(faction.name)}</strong>?</p><div class="dialog-actions"><button id="cancel-war">Cancel</button><button class="primary" id="declare-war">Declare War</button></div><p id="war-result" role="status"></p>`);
  $('#cancel-war').onclick = closeDialog;
  $('#declare-war').onclick = () => {
    if (sendCommand({ type: 'diplomacy', faction: factionId, action: 'war', buildingId })) { closeDialog(); return; }
    const result = diplomacyAction(state, factionId, 'war', buildingId);
    if (result.ok) { closeDialog(); save(); updateUI(); }
    else $('#war-result').textContent = result.message;
  };
}
function clearPlacement() {
  clearInput(); cancelStroke(); buildError = '';
  areaTool = null; state.buildMode = null;
}
function selectBuild(kind: BuildSelection | null) {
  if (kind === 'observationPost' && !hasObservationLodge(state, playerFaction(state))) { buildError = 'Build a Scouts’ Lodge first'; updateUI(); return; }
  if (kind && kind !== 'clearTrees' && !isBuildingUnlocked(state.factions.find(faction => faction.id === playerFaction(state))!, buildingKindForSelection(kind))) {
    const requirement = buildingResearchRequirement(buildingKindForSelection(kind));
    buildError = `Research ${RESEARCH_BRANCHES.find(branch => branch.id === requirement)?.label ?? 'the required technology'} first`;
    updateUI();
    return;
  }
  buildingActivity.close();
  leaderProgression.close();
  clearPlacement();
  buildMenu = kind && !matchMedia('(pointer: coarse)').matches ? buildMenuForSelection(kind) : null;
  state.buildMode = kind;
  if (kind && !state.multiplayer) {
    const leader = getLeader(state);
    if (leader) { leader.destination = undefined; leader.path = undefined; }
  }
  canvas.focus({ preventScroll: true });
  updateUI();
}
function toggleBuildMenu(menu: BuildMenu) {
  const open = buildMenu !== menu;
  selectBuild(null);
  buildMenu = open ? menu : null;
  updateUI();
  if (open) $('.build-actions').scrollTop = 0;
}
function selectAreaTool(tool: AreaTool) {
  selectBuild(null);
  areaTool = tool;
  updateUI();
}
function beginAreaStroke(pointerId: number, point: Point) {
  const start = { x: Math.floor(point.x), y: Math.floor(point.y) };
  areaStroke = { start, end: start, pointerId, erase: areaTool === 'forbid' && isForbidden(state, start.x, start.y) };
  buildError = '';
  refreshWorldPointer();
}
function finishAreaStroke() {
  if (!areaTool || !areaStroke) return;
  if (sendCommand(areaTool === 'forbid' ? { type: 'forbid', start: areaStroke.start, end: areaStroke.end, enabled: !areaStroke.erase }
    : { type: 'clear', start: areaStroke.start, end: areaStroke.end })) { cancelStroke(); updateUI(); return; }
  const result = areaTool === 'forbid' ? setForbiddenRectangle(state, areaStroke.start, areaStroke.end, !areaStroke.erase)
    : clearArea(state, areaStroke.start, areaStroke.end);
  cancelStroke();
  buildError = result.message;
  if (result.count) save();
  updateUI();
}
function shortBuildError(message: string) {
  if (/forbidden/i.test(message)) return 'Remove the forbidden zone here first';
  if (/bridge/i.test(message)) return message.replace(/\.$/, '');
  if (message.includes('one level')) return 'Keep ledges, stairs and approaches clear';
  if (message.includes('within your faction’s borders')) return 'Build entirely within your borders';
  if (message.includes('inside another faction’s borders')) return 'Choose a site outside other factions’ borders';
  if (message.includes('between gates')) return 'Leave two wall tiles between gates';
  if (message.includes('junctions at least')) return 'Keep road junctions at least 2 tiles apart';
  if (message.includes('Wells require') || message.includes('Roads must remain')) return message;
  if (message === 'Choose a tree.') return 'Choose a tree';
  if (message === 'Tree already marked for clearing.') return 'Already marked';
  if (message.includes('10 tiles')) return 'Out of range';
  if (message.includes('clear 2 by 2')) return 'Farm needs four clear tiles';
  if (message.includes('Farm blocks')) return message.replace(/\.$/, '');
  if (message.includes('Farm plots cannot overlap')) return 'Farm plots cannot overlap';
  if (message.includes('route from the settlement')) return 'No route from the settlement';
  if (message.includes('field open')) return 'Reserved farm field';
  if (message.includes('Need')) return 'Insufficient gold';
  if (message.toLowerCase().includes('occup') || message.includes('unit')) return 'Tile occupied';
  return 'Cannot build here';
}
function updateUI() {
  // Direct actions refresh immediately and restart the periodic HUD deadline.
  lastUI = performance.now();
  leaderProgression.refresh();
  researchToolbar.refresh(state);
  refreshWorldPointer();
  $('.game-area').dataset.areaTool = areaTool ?? '';
  const faction = state.factions.find(faction => faction.id === playerFaction(state))!, leader = getLeader(state);
  const changes = resourceChanges(state, state.multiplayer ? onlineIncomeHistory : state);
  const changeWindow = changes.elapsedSeconds < 30 ? `last ${Math.floor(changes.elapsedSeconds)} game seconds (collecting a 30-second history)` : 'last 30 game seconds';
  for (const key of ['food', 'gold'] as const) {
    const total = String(Math.floor(faction[key])), change = `(${signed(changes[key])})`;
    $(`#${key}`).textContent = total;
    $(`#${key}-yield`).textContent = change;
    if (key !== 'gold') $(`.resource.${key}`).title = `${capitalize(key)} · ${signed(changes[key])} income over ${changeWindow} · Spending, upkeep and refunds excluded`;
    $(`.resource.${key}`).setAttribute('aria-label', `${capitalize(key)} ${total}, ${signed(changes[key])} over ${changeWindow}`);
    $(`#${key}-yield`).classList.toggle('negative', Math.round(changes[key]) < 0);
    $(`.resource.${key}`).style.setProperty('--value-fit', String(Math.min(1, 75 / (total.length * 14 + change.length * 9))));
  }
  $('#gold').classList.toggle('negative', faction.gold < 0);
  goldTooltip.refresh(state, faction);
  $('#population').textContent = String(faction.population);
  const capacity = housingCapacity(state);
  $('#capacity').textContent = `/ ${capacity}`;
  $('.resource.population').style.setProperty('--value-fit', String(Math.min(1, 101 / (`${faction.population} / ${capacity}`.length * 14))));
  const culture = Math.max(0, faction.culture ?? 0), cultureRate = culturePerSecond(state, faction.id), threshold = nextCultureThreshold(culture);
  const cultureTotal = String(Math.floor(culture)), cultureChange = `(${signed(changes.culture)})`;
  $('#culture').textContent = cultureTotal;
  $('#culture-next').textContent = '';
  $('#culture-rate').textContent = cultureChange;
  $('#culture-rate').classList.toggle('negative', Math.round(changes.culture) < 0);
  $('.resource.culture').title = `Culture · ${signed(changes.culture)} income over ${changeWindow} · Production ${Math.round(cultureRate * 60)} per minute · Border expansion ${cultureLevel(culture)} · Next expansion at ${threshold} culture · Each city produces ${Math.round(SETTLEMENT_CULTURE_PER_SECOND * 60)} per minute; each monument produces ${Math.round(MONUMENT_CULTURE_PER_SECOND * 60)}`;
  $('.resource.culture').setAttribute('aria-label', `Culture ${cultureTotal}, ${signed(changes.culture)} over ${changeWindow}`);
  $('.resource.culture').style.setProperty('--value-fit', String(Math.min(1, 67 / (cultureTotal.length * 14 + cultureChange.length * 9))));
  // Keep controls stable between pointerdown and pointerup; replacing their
  // children during the periodic HUD refresh can interrupt a browser click.
  const pauseLabel = state.paused ? 'Resume' : 'Pause';
  if ($('#pause').getAttribute('aria-label') !== pauseLabel) {
    $('#pause').innerHTML = icon(state.paused ? 'play' : 'pause');
    $('#pause').setAttribute('aria-label', pauseLabel);
    $('#pause').title = `${pauseLabel} (Space)`;
  }
  const speedLabel = `${state.speed}×`;
  if ($('.speed-value').textContent !== speedLabel) $('.speed-value').textContent = speedLabel;
  $('#speed').setAttribute('aria-label', `Simulation speed ${speedLabel}. Click for ${state.speed === 4 ? 1 : state.speed + 1}×`);
  $('#speed').title = 'Simulation speed · = faster · - slower · 1× to 4×';
  $<HTMLButtonElement>('#pause').disabled = !!state.multiplayer;
  $<HTMLButtonElement>('#speed').disabled = !!state.multiplayer;
  if (state.multiplayer) { $('#pause').title = 'Online matches cannot be paused'; $('#speed').title = 'Online matches run at normal speed'; }
  $('#paused').hidden = !state.paused || !$('#dialog').hidden || state.gameOver;
  $<HTMLButtonElement>('#minimap-zoom-in').disabled = renderer.zoom >= MAX_ZOOM;
  $<HTMLButtonElement>('#minimap-zoom-out').disabled = renderer.zoom <= MIN_ZOOM;
  const selection = selectionSummary(state);
  const panel = $('#selection-panel');
  panel.classList.toggle('empty', !selection);
  panel.title = selection?.title ?? '';
  $('#selection-name').textContent = selection?.name ?? '';
  $('#selection-hint').textContent = selection?.hint ?? '';
  $('#selection-hint').hidden = !selection?.hint;
  const maxHp = Math.max(1, selection?.maxHp ?? 1);
  const hp = Math.max(0, Math.min(maxHp, selection?.hp ?? 0));
  const health = hp / maxHp * 100;
  $('#selection-stats').innerHTML = selection
    ? `<span><span class="stat-label">HP</span> ${Math.ceil(hp)} / ${Math.ceil(maxHp)}</span>${selection.showCombatStats ? `<span><span class="stat-label">Attack</span> ${Number(selection.attack.toFixed(2))}</span><span><span class="stat-label">Defense</span> ${Number(selection.defense.toFixed(2))}</span>` : ''}` : '';
  $('#selection-health').style.width = `${Math.max(0, Math.min(100, health))}%`;
  const healthTrack = $('.health-track');
  healthTrack.setAttribute('aria-valuemin', '0');
  healthTrack.setAttribute('aria-valuemax', String(maxHp));
  healthTrack.setAttribute('aria-valuenow', String(hp));
  const portraitKey = selection ? `${selection.picture}:${selection.factionColor}:${selection.houseTier}:${selection.armorLevel}` : '';
  if ($('#portrait').dataset.picture !== portraitKey) {
    $('#portrait').innerHTML = selection ? icon(selection.picture, selection.factionColor, selection.houseTier, selection.armorLevel) : '';
    $('#portrait').dataset.picture = portraitKey;
  }
  $('#build-panel').hidden = buildMenu === null;
  // This is the Leader's command card, independent of the inspection selection.
  // Keep the controls in place even when the Leader is temporarily unavailable.
  const canAct = !state.gameOver && !!leader && leader.hp > 0 && !leader.inside;
  const uiNow = performance.now();
  document.querySelectorAll<HTMLButtonElement>('[data-hotbar-action="recall"], [data-hotbar-action="stance"]').forEach(button => {
    const cooling = uiNow < retinueActionReadyAt[button.dataset.hotbarAction as RetinueAction];
    button.disabled = !canAct || cooling;
    button.classList.toggle('cooling', cooling);
  });
  const levy = levyDisplayStatus(state), levyButton = $<HTMLButtonElement>('[data-hotbar-action="levy"]');
  const dismissing = levy.active > 0;
  levyButton.disabled = levy.cooldown > 0 || (dismissing ? state.gameOver : !levy.canLevy);
  levyButton.classList.toggle('research-locked', !dismissing && !researchLevel(faction, 'massLevy'));
  levyButton.querySelector<HTMLElement>('.hotbar-label')!.textContent = dismissing ? 'Dismiss levy' : 'Mass levy';
  levyButton.setAttribute('aria-label', dismissing ? 'Dismiss levy' : 'Mass levy');
  levyButton.setAttribute('aria-pressed', String(dismissing));
  levyButton.title = levy.cooldown > 0 ? `Levy available in ${Math.ceil(levy.cooldown)}s` : dismissing ? `Dismiss ${levy.active} levy · Return to civilian jobs · Current upkeep ${levy.upkeep} gold / 30s`
    : levy.reason || `Raise ${levy.available} Levy Infantry · 15 gold each to draft · 5 gold each every 30s`;
  const garrison = garrisonStatus(state), garrisonButton = $<HTMLButtonElement>('[data-hotbar-action="garrison"]');
  const garrisonLabel = garrison.active ? 'Recall Garrison' : 'Garrison';
  garrisonButton.disabled = !garrison.enabled;
  garrisonButton.querySelector<HTMLElement>('.hotbar-label')!.textContent = garrisonLabel;
  garrisonButton.setAttribute('aria-label', garrisonLabel); garrisonButton.setAttribute('aria-pressed', String(garrison.active));
  garrisonButton.title = garrison.reason || (garrison.active ? `Recall ${garrison.count} defenders to the Leader (5)`
    : 'Defend this city · Pursue enemies up to 3 tiles beyond borders for 5 seconds (5)');
  for (const [button, picture] of [[levyButton, 'levy'], [garrisonButton, 'garrison']] as const) {
    const art = button.querySelector<HTMLElement>('.hotbar-art')!, markup = icon(picture, faction.color);
    if (art.dataset.markup !== markup) { art.innerHTML = markup; art.dataset.markup = markup; }
  }
  const { stance, nextStance } = retinueCommand(state);
  const formation = infantryFormationControl(state);
  const formationButton = $<HTMLButtonElement>('[data-hotbar-action="formation"]');
  formationButton.disabled = !formation.enabled;
  formationButton.title = formation.title;
  formationButton.setAttribute('aria-label', `Formation. ${formation.title}`);
  formationButton.setAttribute('aria-pressed', String(formation.active));
  formationButton.classList.toggle('research-locked', !formation.unlocked);
  formationButton.querySelector<SVGElement>('.hotbar-lock')!.toggleAttribute('hidden', formation.unlocked);
  const recallButton = $('[data-hotbar-action="recall"]');
  const steering = formation.active || !!boardedBoat(state);
  recallButton.title = `Recall retinue (${steering ? '1' : '1 / E'})`;
  recallButton.setAttribute('aria-keyshortcuts', steering ? '1' : '1 E');
  const stanceButton = $('[data-hotbar-action="stance"]');
  stanceButton.title = `Change stance (${steering ? '2' : '2 / Q'}) · Current: ${stance} · Next: ${nextStance}`;
  stanceButton.setAttribute('aria-keyshortcuts', steering ? '2' : '2 Q');
  stanceButton.setAttribute('aria-label', `Change stance. Current: ${stance}. Next: ${nextStance}`);
  stanceButton.dataset.stance = stance;
  const showBuildActions = buildMenu !== null;
  $('.hud').classList.toggle('building', canAct);
  $('#build-panel').classList.toggle('is-building-menu', buildMenu === 'build');
  $('#build-panel').dataset.menu = buildMenu ?? 'actions';
  $('#build-panel').setAttribute('aria-label', buildMenu === 'build' ? 'Leader buildings' : buildMenu === 'fortifications' ? 'Leader fortifications' : 'Leader actions');
  document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => {
    const kind = button.dataset.build as BuildSelection;
    button.hidden = !showBuildActions || buildMenuForSelection(kind) !== buildMenu;
    const active = button.dataset.build === state.buildMode;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    const unaffordable = kind !== 'clearTrees' && faction.gold < minimumBuildGold(kind, state);
    const researchLocked = kind !== 'clearTrees' && !isBuildingUnlocked(faction, buildingKindForSelection(kind));
    const locked = kind === 'well' && faction.population < WELL_POPULATION_REQUIREMENT || kind === 'observationPost' && (!hasObservationLodge(state, faction.id) || faction.population < 1) || researchLocked;
    button.dataset.buildTitle ??= button.title;
    const requirement = kind === 'clearTrees' ? undefined : buildingResearchRequirement(buildingKindForSelection(kind));
    const researchLabel = RESEARCH_BRANCHES.find(branch => branch.id === requirement)?.label;
    const researchHint = researchLocked ? `Research ${researchLabel ?? 'this building'} at a library to unlock.` : '';
    const baseTitle = kind === 'road' || kind === 'bridge' ? button.dataset.buildTitle.replace(/· [\d.]+ gold/, `· ${buildCostAt(state, kind, 0, 0).gold} gold`) : button.dataset.buildTitle;
    const lodgeHint = kind === 'observationPost' && !hasObservationLodge(state, faction.id) ? ' · Build a Scouts’ Lodge first.' : '';
    button.title = baseTitle + (researchHint ? ` · ${researchHint}` : '') + lodgeHint;
    button.classList.toggle('research-locked', researchLocked);
    if (researchHint) button.setAttribute('aria-description', researchHint);
    else button.removeAttribute('aria-description');
    button.disabled = !canAct || unaffordable || locked;
    button.classList.toggle('unaffordable', unaffordable || locked);
    button.setAttribute('aria-disabled', String(button.disabled));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    const action = button.dataset.action;
    button.hidden = false;
    button.disabled = !canAct;
    button.setAttribute('aria-disabled', String(button.disabled));
    const active = action === areaTool || action === buildMenu;
    button.classList.toggle('active', active);
    if (action === 'clear' || action === 'forbid') button.setAttribute('aria-pressed', String(active));
  });
  for (const menu of ['build', 'fortifications'] as const)
    $(`[data-action="${menu}"]`).setAttribute('aria-expanded', String(buildMenu === menu));
  if (!state.buildMode) { $('#build-status').textContent = ''; $('#build-status').classList.remove('invalid'); }
  if (areaTool) $('#build-status').textContent = buildError || (areaTool === 'forbid'
    ? areaStroke?.erase ? 'Drag to allow this area again' : 'Drag to forbid · Start inside a zone to erase'
    : 'Drag to clear trees, buildings and construction · Unused construction gold refunded');

  if (state.buildMode) {
    const preview = renderer.buildPreview.length ? renderer.buildPreview
      : renderer.hover ? [{ x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) }] : [];
    const plan = planConstruction(state, state.buildMode, preview);
    if (stroke) buildError = plan.ok ? '' : shortBuildError(plan.message);
    const count = preview.length ? plan.tiles.length : 1;
    const gold = preview.length ? plan.costs.gold : state.buildMode === 'clearTrees' ? 0 : buildCostAt(state, state.buildMode, 0, 0).gold;
    const area = state.buildMode === 'palace' ? count * 4 : count;
    const benefit = state.buildMode === 'irrigation' ? ` · 2× farmland yield within ${IRRIGATION_RADIUS} tiles`
      : state.buildMode === 'well' ? ` · Level 2 homes within ${WELL_RADIUS} tiles`
      : state.buildMode === 'monument' ? ` · Claims a ${BASE_BORDER_RADIUS.monument}-tile radius · +${Number(MONUMENT_CULTURE_PER_SECOND.toFixed(2))} culture/s`
      : state.buildMode === 'guardPost' ? ` · ${GUARD_POST_CAPACITY} militia · ${GUARD_POST_UPKEEP} gold/${GUARD_POST_UPKEEP_INTERVAL}s upkeep`
      : state.buildMode === 'woodenTower' ? ` · ${WATCHTOWER_MAINTENANCE} gold/${ECONOMY_INTERVAL}s upkeep`
      : state.buildMode === 'palace' ? ` · ${SETTLEMENT_MAINTENANCE} gold/${ECONOMY_INTERVAL}s upkeep; capital exempt` : '';
    const requirement = state.buildMode === 'well' && faction.population < WELL_POPULATION_REQUIREMENT
      ? `Wells require ${WELL_POPULATION_REQUIREMENT} population` : '';
    const crossingError = state.buildMode === 'bridge' && preview.length && !plan.ok ? shortBuildError(plan.message) : '';
    $('#build-status').textContent = buildError || requirement || crossingError || `${isLinearPlacement(state.buildMode) ? stroke ? 'Choose end · ' : 'Choose start · ' : ''}${area} tile${area === 1 ? '' : 's'} · ${gold} gold${benefit}${plan.skipped ? ` · ${plan.skipped} skipped` : ''}`;
    $('#build-status').classList.toggle('invalid', !!buildError || !!requirement || !!crossingError || gold > faction.gold);
  }
  if (renderer.showYields && renderer.hover && !state.buildMode && isVisible(state, renderer.hover.x, renderer.hover.y)) {
    const x = Math.floor(renderer.hover.x), y = Math.floor(renderer.hover.y), t = state.world.tiles[y * state.world.width + x];
    if (t && x >= 0 && y >= 0 && x < state.world.width && y < state.world.height) {
      $('#tile-tooltip').hidden = false;
      const field = state.fields?.find(field => field.x === x && field.y === y);
      const water = WATER.has(t.terrain);
      const biome = !water && t.biome ? BIOME_NAMES[t.biome] : capitalize(t.terrain);
      const ground = `${biome}${t.landform && !water ? ` · ${LANDFORM_NAMES[t.landform]}` : ''}${t.overlay === 'forest' ? ' · Woodland' : t.overlay === 'ford' ? ' · Ford' : ''}${t.resource ? ` · ${RESOURCE_NAMES[t.resource]}` : ''}`;
      const soil = water || t.fertility === undefined ? '' : ` · Soil ${Math.round(t.fertility * 100)}%`;
      const speed = groundMovementMultiplier(t);
      const travel = speed < 1 && (!water || t.overlay === 'ford') ? ` · Ground speed ${Math.round(speed * 100)}%` : '';
      const discovery = state.treasures?.find(chest => chest.x === x && chest.y === y && !chest.collected);
      const site = discovery?.name ? ` · ${escape(discovery.name)} (${discovery.rewardGold ?? 200} gold)` : '';
      $('#tile-tooltip').innerHTML = field ? `${field.planted ? 'Planted field' : 'Fallow field'} · ${ground}${soil}${irrigationYieldMultiplier(state, x, y) > 1 ? ' · Irrigated (2× yield)' : ''}<span>${icon('food')} ${field.food.toFixed(1)} stored · ${fieldHarvestFoodForState(state, x, y).toFixed(1)} / harvest</span>` : `${ground}${soil}${travel}${site}`;
    } else $('#tile-tooltip').hidden = true;
  } else $('#tile-tooltip').hidden = true;
}

function performRetinueAction(action: RetinueAction): void {
  const leader = getLeader(state);
  if (state.gameOver || !leader || leader.hp <= 0 || leader.inside || performance.now() < retinueActionReadyAt[action]) return;
  const nextStance = retinueCommand(state).nextStance;
  if (!sendCommand(action === 'recall' ? { type: 'recall' } : { type: 'stance', stance: nextStance })) {
    if (action === 'recall') recallRetinue(state);
    else toggleRetinueOrder(state);
  }
  leaderActionFeedback.show($<HTMLButtonElement>(`[data-hotbar-action="${action}"]`),
    action === 'stance' ? capitalize(state.multiplayer ? nextStance : retinueCommand(state).stance) : undefined);
  if (action === 'recall') {
    retinueActionReadyAt.recall = performance.now() + RETINUE_ACTION_COOLDOWN_MS;
    window.setTimeout(updateUI, RETINUE_ACTION_COOLDOWN_MS);
  }
  updateUI(); save();
}

for (const action of ['recall', 'stance'] as const) {
  $(`[data-hotbar-action="${action}"]`).onclick = () => {
    performRetinueAction(action);
    canvas.focus({ preventScroll: true });
  };
}

function performInfantryAction(): void {
  const control = infantryFormationControl(state);
  if (!control.enabled) { showCommandError(control.reason); return; }
  clearTurnInput();
  const command: GameCommand = { type: 'infantry-formation' };
  if (!sendCommand(command)) {
    const result = toggleInfantryFormation(state);
    if (!result.ok) { showCommandError(result.message ?? 'Formation unavailable.'); return; }
  }
  leaderActionFeedback.show($<HTMLButtonElement>('[data-hotbar-action="formation"]'),
    control.active ? 'Released' : 'Form ranks');
  updateUI(); save();
}
$('[data-hotbar-action="formation"]').onclick = () => { performInfantryAction(); canvas.focus({ preventScroll: true }); };

function performLevyAction(): void {
  const dismiss = levyDisplayStatus(state).active > 0;
  const command: GameCommand = { type: dismiss ? 'dismiss-levy' : 'levy' };
  if (!sendCommand(command)) {
    const result = dismiss ? dismissLevy(state) : levyPopulation(state);
    if (!result.ok) { showCommandError(result.message); return; }
    logEvent(state, result.message, 'good');
  }
  updateUI(); save();
}
$('[data-hotbar-action="levy"]').onclick = () => { performLevyAction(); canvas.focus({ preventScroll: true }); };
function performGarrisonAction(): void {
  if (!sendCommand({ type: 'garrison' })) {
    const result = toggleGarrison(state);
    if (!result.ok) { showCommandError(result.message); return; }
    logEvent(state, result.message, 'good');
  }
  updateUI(); save();
}
$('[data-hotbar-action="garrison"]').onclick = () => { performGarrisonAction(); canvas.focus({ preventScroll: true }); };

$('#close-dialog').onclick = closeDialog;
$('#dialog').onclick = e => { if (e.target === $('#dialog')) closeDialog(); };
$('[data-action="build"]').onclick = () => toggleBuildMenu('build');
$('[data-action="fortifications"]').onclick = () => toggleBuildMenu('fortifications');
$('#close-build').onclick = () => selectBuild(null);
for (const tool of ['clear', 'forbid'] as const) {
  const button = $<HTMLButtonElement>(`[data-action="${tool}"]`);
  let buttonDrag: { x: number; y: number; moved: boolean } | null = null;
  let suppressClick = false;
  button.onclick = () => { if (!suppressClick) selectAreaTool(tool); suppressClick = false; };
  button.onpointerdown = e => {
    if (e.button !== 0 || state.gameOver) return;
    selectAreaTool(tool);
    buttonDrag = { x: e.clientX, y: e.clientY, moved: false };
    button.setPointerCapture(e.pointerId);
  };
  button.onpointermove = e => {
    if (!buttonDrag) return;
    buttonDrag.moved ||= Math.hypot(e.clientX - buttonDrag.x, e.clientY - buttonDrag.y) > 4;
    if (!buttonDrag.moved || document.elementFromPoint(e.clientX, e.clientY) !== canvas) return;
    pointer = { x: e.clientX, y: e.clientY };
    // Dragging the button drops on one tile; selecting then dragging the map selects an area.
    beginAreaStroke(e.pointerId, renderer.worldPoint(e.clientX, e.clientY));
    refreshWorldPointer(); updateUI();
  };
  button.onpointerup = e => {
    suppressClick = !!buttonDrag?.moved;
    if (areaStroke && document.elementFromPoint(e.clientX, e.clientY) === canvas) finishAreaStroke();
    else cancelStroke();
    buttonDrag = null;
    if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId);
    clearPointer();
  };
  button.onpointercancel = () => { buttonDrag = null; cancelStroke(); clearPointer(); };
}
$('#pause').onclick = () => { if (state.multiplayer) return; state.paused = !state.paused; clearInput(); updateUI(); save(); };
$('#speed').onclick = () => { if (state.multiplayer) return; state.speed = state.speed >= 4 ? 1 : state.speed + 1; updateUI(); save(); };
$('#menu').onclick = showMenu;
for (const [selector, delta] of [['#minimap-zoom-in', .15], ['#minimap-zoom-out', -.15]] as const) {
  $(selector).onclick = () => {
    renderer.changeZoom(delta); refreshWorldPointer(); updateUI();
    canvas.focus({ preventScroll: true });
  };
}
document.querySelectorAll<HTMLButtonElement>('[data-build]').forEach(button => button.onclick = () => selectBuild(button.dataset.build as BuildSelection));
// Time controls work from building popups and focused HUD controls. Text entry
// retains its usual keys; Space otherwise always pauses the simulation.
window.addEventListener('keydown', e => {
  if (frontend.active || state.multiplayer || e.metaKey || e.ctrlKey || e.altKey || !$('#dialog').hidden || ![' ', '=', '+', '-'].includes(e.key)) return;
  const target = e.target;
  if (target instanceof HTMLElement && target.isContentEditable
    || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || target instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(target.type)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.key === ' ') { state.paused = !state.paused; clearInput(); }
  else state.speed = Math.max(1, Math.min(4, state.speed + (e.key === '-' ? -1 : 1)));
  updateUI(); save();
}, { capture: true });
window.addEventListener('keydown', e => {
  if (frontend.active || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') {
    if (!$('#dialog').hidden) closeDialog();
    else if (leaderProgression.isOpen) leaderProgression.close(true);
    else if (buildingActivity.isOpen) { buildingActivity.close(); canvas.focus({ preventScroll: true }); }
    else if (stroke?.twoClick) cancelStroke();
    else if (state.buildMode || buildMenu || areaTool) selectBuild(null);
    else showMenu();
    updateUI(); return;
  }
  if (!$('#dialog').hidden) {
    if (key === 'tab') {
      const elements = Array.from($('#dialog').querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'));
      if (e.shiftKey && document.activeElement === elements[0]) { e.preventDefault(); elements.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0]?.focus(); }
    }
    return;
  }
  // Focused HUD controls keep native activation without trapping movement keys.
  if (e.target instanceof HTMLInputElement && (e.target.type !== 'checkbox' || key === ' ' || key === 'enter')) return;
  if (e.target instanceof HTMLButtonElement && (key === ' ' || key === 'enter')) return;
  if (key === 'b') { e.preventDefault(); if (!e.repeat) toggleBuildMenu('build'); return; }
  if (key === 'f') { e.preventDefault(); if (!e.repeat) toggleBuildMenu('fortifications'); return; }
  if (key === 'c') { e.preventDefault(); if (!e.repeat) selectAreaTool('clear'); return; }
  const buildSelection = buildSelectionForKey(key, buildMenu);
  if (buildSelection !== undefined) {
    e.preventDefault();
    if (!e.repeat) selectBuild(buildSelection);
    return;
  }
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) e.preventDefault();
  if (key === 'w' || key === 'arrowup') input.up = true;
  if (key === 's' || key === 'arrowdown') input.down = true;
  if (key === 'a' || key === 'arrowleft') input.left = true;
  if (key === 'd' || key === 'arrowright') input.right = true;
  const directionalSteering = infantryFormationActive(state) || !!boardedBoat(state);
  const heldTurn = leaderHeldTurnForKey(key, directionalSteering);
  if (heldTurn) { e.preventDefault(); input[heldTurn] = true; if (state.multiplayer) multiplayer.input(input); return; }
  if (input.up || input.down || input.left || input.right) renderer.follow = true;
  if (e.repeat) return;
  if (key === '4' || key === '5') { e.preventDefault(); if (!e.repeat) { if (key === '4') performLevyAction(); else performGarrisonAction(); } return; }
  const hotbarAction = leaderHotbarActionForKey(key, directionalSteering);
  if (hotbarAction) {
    e.preventDefault();
    if (hotbarAction === 'recall' || hotbarAction === 'stance') performRetinueAction(hotbarAction);
    else performInfantryAction();
  }
  if (key === 'shift') { e.preventDefault(); if (!sendCommand({ type: 'movement' })) renderer.showMovementMode(toggleMovementMode(state)); save(); }
  if (key === 'home') { e.preventDefault(); renderer.center(state); }
  if (key === 'y') renderer.showYields = !renderer.showYields;
  if (key === 'h') showHelp();
  if (key === 'n') showNewWorld();
  updateUI();
});
window.addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  if (key === 'w' || key === 'arrowup') input.up = false;
  if (key === 's' || key === 'arrowdown') input.down = false;
  if (key === 'a' || key === 'arrowleft') input.left = false;
  if (key === 'd' || key === 'arrowright') input.right = false;
  if (key === 'q') input.turnLeft = false;
  if (key === 'e') input.turnRight = false;
  if (state.multiplayer) multiplayer.input(input);
});
window.addEventListener('blur', () => { clearInput(); cancelStroke(); clearPointer(); pan = null; });
document.addEventListener('focusin', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) clearInput();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); cancelStroke(); clearPointer(); save(); } });
window.addEventListener('beforeunload', save);
canvas.addEventListener('contextmenu', e => e.preventDefault());
function commitStroke() {
  if (!stroke) return;
  // Refresh against the authoritative current state, even if hover was cached.
  routePreviewKey = ''; refreshWorldPointer();
  if (sendCommand({ type: 'build', kind: stroke.kind, points: renderer.buildPreview })) { cancelStroke(); updateUI(); return; }
  const result = buildStroke(state, stroke.kind, renderer.buildPreview);
  cancelStroke(); buildError = result.ok ? '' : shortBuildError(result.message);
  if (result.placed) save();
  updateUI();
}
function commandWorldPoint(point: Point) {
  clearInput();
  const villageTarget = neutralVillageEntityAt(state, point);
  if (villageTarget) { clearPlacement(); showVillageDiplomacy(villageTarget.faction, villageTarget.id); updateUI(); return; }
  const diplomaticTarget = warDeclarationTargetAt(state, point.x, point.y);
  if (diplomaticTarget) { clearPlacement(); showDeclareWar(diplomaticTarget.faction, diplomaticTarget.id); updateUI(); return; }
  selectBuild(null);
  if (state.multiplayer) sendCommand({ type: 'interact', x: point.x, y: point.y });
  else if (!commandAttackAt(state, point.x, point.y) && commandMove(state, point.x, point.y)) renderer.showMoveMarker(point);
  updateUI();
}
function primaryWorldPoint(point: Point, pointerId: number, touch: boolean) {
  canvas.focus({ preventScroll: true });
  if (stroke?.twoClick) { commitStroke(); return; }
  const villageTarget = !areaTool ? neutralVillageEntityAt(state, point) : undefined;
  if (villageTarget) { clearPlacement(); showVillageDiplomacy(villageTarget.faction, villageTarget.id); updateUI(); return; }
  const activityTarget = !areaTool ? buildingAtPoint(state, point) : undefined;
  if (activityTarget && !(state.buildMode && isFarmKind(activityTarget.kind)) && buildingActivityAvailable(state, activityTarget)) {
    leaderProgression.close();
    if (state.buildMode) clearPlacement();
    cancelStroke(); state.selected = activityTarget.id; state.selectedType = 'building'; state.diplomacy = null;
    buildingActivity.toggle(activityTarget);
  } else if (areaTool) {
    beginAreaStroke(pointerId, point);
    if (!touch) canvas.setPointerCapture(pointerId);
  } else if (state.buildMode) {
    stroke = { start: { x: Math.floor(point.x), y: Math.floor(point.y) }, kind: state.buildMode, pointerId, twoClick: touch && isLinearPlacement(state.buildMode) };
    renderer.buildPreview = [stroke.start]; routePreviewKey = ''; buildError = '';
    if (touch && !stroke.twoClick) commitStroke();
    else if (!stroke.twoClick) canvas.setPointerCapture(pointerId);
  } else if (touch) commandWorldPoint(point);
  else {
    selectAt(state, point.x, point.y);
    if (state.selectedType === 'building') leaderProgression.close();
    buildingActivity.toggle(state.selectedType === 'building' ? state.buildings.find(building => building.id === state.selected) : undefined);
    if (state.diplomacy !== null) showDiplomacy(state.diplomacy);
  }
  updateUI();
}
const touches = new Map<number, { x: number; y: number; startX: number; startY: number }>();
let gesture: { x: number; y: number; distance: number; zoom: number; camera: Point } | null = null;
let touchMoved = false;
function startTouchGesture() {
  const [a, b] = [...touches.values()];
  if (!a || !b) return;
  gesture = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: renderer.zoom, camera: { ...renderer.camera } };
  touchMoved = true; areaStroke = null; renderer.areaPreview = null; renderer.follow = false;
}
canvas.addEventListener('pointerdown', e => {
  if (frontend.active || !$('#dialog').hidden || state.gameOver || state.factions.find(f => f.id === playerFaction(state))?.leaderRespawn) return;
  e.preventDefault(); pointer = { x: e.clientX, y: e.clientY }; refreshWorldPointer();
  if (e.pointerType === 'touch') {
    if (!touches.size) touchMoved = false;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (touches.size === 2) startTouchGesture();
    else if (areaTool) beginAreaStroke(e.pointerId, renderer.worldPoint(e.clientX, e.clientY));
    return;
  }
  if (e.button === 1) {
    cancelStroke(); pan = { x: e.clientX, y: e.clientY, cameraX: renderer.camera.x, cameraY: renderer.camera.y };
    renderer.follow = false; canvas.setPointerCapture(e.pointerId); return;
  }
  if (e.button === 2) {
    canvas.focus({ preventScroll: true });
    if (stroke?.twoClick) { cancelStroke(); updateUI(); return; }
    commandWorldPoint(renderer.worldPoint(e.clientX, e.clientY)); return;
  }
  if (e.button === 0) primaryWorldPoint(renderer.worldPoint(e.clientX, e.clientY), e.pointerId, false);
});
canvas.addEventListener('pointermove', e => {
  pointer = { x: e.clientX, y: e.clientY };
  const touch = touches.get(e.pointerId);
  if (touch) {
    touch.x = e.clientX; touch.y = e.clientY;
    if (gesture && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      renderer.changeZoom(gesture.zoom * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance - renderer.zoom);
      renderer.camera.x = gesture.camera.x - ((a.x + b.x) / 2 - gesture.x) / (32 * renderer.zoom);
      renderer.camera.y = gesture.camera.y - ((a.y + b.y) / 2 - gesture.y) / (32 * renderer.zoom);
      return;
    }
    if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > 10) touchMoved = true;
  }
  if (pan) {
    renderer.camera.x = pan.cameraX - (e.clientX - pan.x) / (32 * renderer.zoom);
    renderer.camera.y = pan.cameraY - (e.clientY - pan.y) / (32 * renderer.zoom);
  }
  refreshWorldPointer(); if (stroke || areaStroke) updateUI();
});
canvas.addEventListener('pointerup', e => {
  pointer = { x: e.clientX, y: e.clientY }; refreshWorldPointer(); pan = null;
  if (e.pointerType === 'touch') {
    if (!touches.has(e.pointerId)) return;
    if (frontend.active || !$('#dialog').hidden || state.gameOver || state.factions.find(f => f.id === playerFaction(state))?.leaderRespawn) {
      touches.delete(e.pointerId); if (!touches.size) gesture = null;
      cancelStroke(); if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (!gesture && areaStroke && e.pointerId === areaStroke.pointerId) finishAreaStroke();
    else if (!touchMoved && !gesture) primaryWorldPoint(renderer.worldPoint(e.clientX, e.clientY), e.pointerId, true);
    touches.delete(e.pointerId); if (!touches.size) { gesture = null; touchMoved = false; }
  } else {
    if (areaStroke && e.pointerId === areaStroke.pointerId) finishAreaStroke();
    if (stroke && !stroke.twoClick && e.pointerId === stroke.pointerId) commitStroke();
  }
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (document.elementFromPoint(e.clientX, e.clientY) !== canvas && !stroke?.twoClick) clearPointer();
});
canvas.addEventListener('pointercancel', e => { touches.delete(e.pointerId); if (!touches.size) gesture = null; pan = null; cancelStroke(); clearPointer(); });
canvas.addEventListener('pointerleave', () => { if (!stroke && !areaStroke && !pan) clearPointer(); });
canvas.addEventListener('wheel', e => {
  e.preventDefault(); pointer = { x: e.clientX, y: e.clientY };
  renderer.changeZoom(e.deltaY > 0 ? -.08 : .08); refreshWorldPointer();
}, { passive: false });
$('#minimap').addEventListener('click', e => {
  const point = renderer.minimapWorldPoint(e.clientX, e.clientY);
  if (!point) return;
  renderer.camera = { x: point.x, y: point.y };
  renderer.follow = false;
});
new ResizeObserver(() => { renderer.resize(); refreshWorldPointer(); }).observe(canvas);
const mobileControls = new MobileControls($('.game-area'), input, () => { if (state.multiplayer) multiplayer.input(input); }, () => { renderer.follow = true; renderer.center(state); });
let wasWaitingForRespawn = false;
let deathCamera: Point | undefined;
const respawnCamera = new RespawnCamera();
let wasRespawnPanning = false;
function frame(now: number) {
  const elapsedFrame = Math.max(0, (now - last) / 1000), dt = Math.min(elapsedFrame, .15); last = now;
  if ((input.turnLeft || input.turnRight) && (!infantryFormationActive(state) && !boardedBoat(state) || state.paused || frontend.active || !$('#dialog').hidden)) clearTurnInput();
  if (state.multiplayer) multiplayer.input(input);
  else updateGame(state, dt, input);
  if (state.multiplayer) multiplayer.updatePresentation(now);
  let beganRespawnPan = false;
  const waitingForRespawn = !!state.factions.find(faction => faction.id === playerFaction(state))?.leaderRespawn;
  const respawnOverlay = $('#leader-respawn');
  if (waitingForRespawn !== wasWaitingForRespawn) {
    if (waitingForRespawn) {
      deathCamera = { ...state.factions.find(faction => faction.id === playerFaction(state))!.leaderRespawn!.position };
      respawnCamera.cancel(); renderer.camera = { ...deathCamera }; renderer.follow = false;
      clearInput(); clearPlacement(); buildingActivity.close(); leaderProgression.close();
    } else {
      const leader = getLeader(state);
      if (leader && deathCamera) { respawnCamera.start(deathCamera, leader); beganRespawnPan = true; }
      deathCamera = undefined;
    }
    wasWaitingForRespawn = waitingForRespawn;
    updateUI(); save();
  }
  respawnOverlay.hidden = !waitingForRespawn || frontend.active;
  mobileControls.update(!frontend.active && $('#dialog').hidden && !waitingForRespawn && !state.gameOver && !state.paused, infantryFormationActive(state) || !!boardedBoat(state));
  const respawnPan = respawnCamera.advance(beganRespawnPan ? 0 : elapsedFrame);
  if (respawnPan) { renderer.camera = respawnPan; renderer.follow = false; }
  else if (!waitingForRespawn && wasRespawnPanning) renderer.follow = true;
  wasRespawnPanning = !!respawnPan;
  renderer.draw(state, dt, refreshWorldPointer);
  buildingActivity.update(now);
  leaderActionFeedback.update(now);
  if (now - lastUI >= CHECK_INTERVAL_MS) {
    updateUI();
    if (!frontend.active && state.palaceCaptures?.some(offer => !pendingCaptures.has(offer.palaceId) && (offer.captor === undefined || offer.captor === playerFaction(state))) && $('#dialog').hidden) showPalaceCapture();
  }
  if (now - lastSave > 15000) { save(); lastSave = now; }
  if (!frontend.active && state.gameOver && !gameEndShown) {
    gameEndShown = true;
    showGameEnd();
  }
  requestAnimationFrame(frame);
}
document.documentElement.dataset.assets = 'loading';
showLoading('Loading', '', 0);
const assets = [loadGameFonts(), renderer.initialize(), loadPalaceSprite(), loadFortArt(), loadPunyCharacters(), loadFarmArt(), loadFoodArt(), loadNavalArt(), loadFishingArt(), loadCityPanelArt(), loadCombatEffectArt(), loadResearchIcons(), loadIrrigationArt(), loadTreasureArt(), loadMonumentArt(), loadBlacksmithArt(), loadPalisadeArt(), loadArcheryArt(), loadLibraryArt(), loadScoutsLodgeArt(), loadHealerShackArt(), loadGuardPostArt(), loadWildlifeArt(), loadMerchantArt(), loadVegetationArt()];
let loadedAssets = 0;
void Promise.all(assets.map(task => task.then(() => { if (document.documentElement.dataset.assets !== 'error') frontend.loading('Loading', '', ++loadedAssets / assets.length); }))).then(() => {
  document.documentElement.dataset.assets = 'ready';
  frontend.setStatus('');
  if (hasSavedGame) { sessionStarted = true; hideFrontend(); }
  else showFrontend('main');
  chooseInitialWorld = false;
  last = performance.now();
  updateUI(); requestAnimationFrame(frame);
}).catch(error => {
  document.documentElement.dataset.assets = 'error';
  console.error(error);
  frontend.error('Unable to load the game assets. Retry to reload the page.', false);
});
if (import.meta.env.DEV) Object.assign(window, { __game: {
  get state() { return state; }, renderer,
  replaceState: (next: GameState) => { state = next; resetEntities(state); offlineState = state; sessionStarted = true; pauseBeforeFrontend = state.paused; hideFrontend(); },
  entities: entityStore,
  step: (seconds: number) => updateGame(state, seconds, { up: false, down: false, left: false, right: false }),
  newWorld,
  interact: (x: number, y: number) => interactAt(state, x, y),
  build: (kind: BuildSelection, x: number, y: number) => buildAt(state, kind, x, y),
  save,
} });
