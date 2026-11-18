import { loadGameAssets } from './game/game-assets';
import { telemetry } from './telemetry/client';
import { resolveExploration, type ExplorationSite } from './game/exploration-native';
import { explorationDialogMarkup } from './ui/exploration-dialog';
import { warshipAction, warshipActionAvailable } from './game/warships-native';
import { refreshDiplomacy } from './game/diplomacy';
import type { DiplomacyTerms } from './game/diplomacy-view';
import { factionDiplomacyMarkup, bindFactionDiplomacy } from './ui/faction-diplomacy';
import { lifetimeCulture } from './game/achievement-effects';
import { campaignStats } from './game/campaign-stats';
import { campaignReportMarkup } from './ui/campaign-report';
import { atWar } from './game/relations';
import { isMapRevealed, setMapRevealed, pointInSight, presentationFog } from './game/fog';
import { stoneDefenseMultiplier } from './game/stone-defense';
import { actionTooltip, buildTooltip, townBuildDetails } from './ui/action-tooltips';
import { ActionTooltips } from './ui/action-tooltip-view';
import { hermitAt, hermitPosition, askHermit } from './game/hermits';
import { questGiverAt, performQuestAction } from './game/quests';
import { questMarkup, refreshQuestDialog } from './ui/quest-dialog';
import { siteViews } from './game/sites-native';
import { buildSite, quoteSite } from './game/site-construction';
import { isSiteBuilding, type SiteView } from './game/site-types';
import { siteDialogMarkup, SiteVisits } from './ui/site-dialog';
import './ui/sites.css';
import './ui/quests.css';
import { RespawnCamera } from './ui/respawn-camera';
import { researchLevel } from './game/research';
import { CHECK_INTERVAL_MS } from './game/work-cadence';
import { frameSimulationDelta } from './game/frame-time';
import { logEvent } from './game/simulation';
import { garrisonStatus, toggleGarrison } from './game/garrison';
import { levyDisplayStatus, levyPopulation, dismissLevy } from './game/mass-levy';
import { loadGameFonts } from './game/game-font';
import './ui/game-font.css';
import './style.css';
import './ui/forged-hud.css';
import { selectionSummary } from './ui/selection-summary';
import { multiplierPercent, wholeNumber } from './ui/number-format';
import { soilFertility } from './game/fertility';
import { LeaderActionFeedback } from './ui/leader-action-feedback';
import { LeaderProgressionUI } from './ui/leader-progression';
import { learnLeaderSkill } from './game/leader-progression';
import { resourceChanges } from './ui/resource-rates';
import { ResearchToolbar } from './ui/research-toolbar';
import { GoldTooltip } from './ui/gold-tooltip';
import { ArmyWarnings } from './ui/army-warnings';
import { generateWorldAsync, DEFAULT_WORLD_WIDTH, DEFAULT_WORLD_HEIGHT } from './world/generator';
import { createScenarioGame } from './game/scenario-loader';
import { OPPOSING_FACTION_COUNT } from './game/civilizations';
import { LANDFORM_NAMES } from './world/options';
import { BASE_BORDER_RADIUS } from './game/borders';
import { resolvePalaceCapture, continueAfterVictory } from './game/simulation';
import { createGame, updateGame, interactAt, selectAt, commandMove, commandAttackAt, warDeclarationTargetAt, toggleMovementMode, buildAt, diplomacyAction, getLeader, housingCapacity, recallRetinue, canRespawnLeader, respawnLeader, BUILD_COSTS, minimumBuildGold, advanceConstructionReconciliation, constructionReconciliationPending } from './game/simulation';
import { Renderer, MIN_ZOOM, MAX_ZOOM } from './game/renderer';
import { entityStore, resetEntities } from './game/entity-store';
import { isVisible } from './game/fog';
import { buildStroke } from './game/construction';
import { holdSimulationReads, withSimulationReads } from './game/simulation-reads';
import { constructionRoute, isLinearPlacement } from './game/construction-route';
import { previewConstructionPlan } from './game/construction-display';
import { ConstructionGestureCache } from './game/construction-gesture';
import { createLinearPurchase, type LinearPurchase, type LinearPurchaseResult } from './game/road-purchase';
import { type GameState, type BuildSelection, type InputState, type Point, WATER, isFarmKind, buildingKindForSelection } from './game/types';
import { icon } from './ui/icons';
import { isForbidden, setForbiddenRectangle } from './game/forbidden-zones';
import { buildMenuForSelection, buildSelectionForKey, type BuildMenu } from './ui/build-controls';
import { constructionActionsMarkup, buildingButtonsMarkup } from './ui/build-controls-view';
import { CONSTRUCTION_SECONDS } from './game/structures';
import { boardedBoat } from './game/sailing';
import { villageCamp, villageDiplomacyStatus } from './game/villages';
import { villageDiplomacyActions, villageDiplomacyMarkup } from './ui/village-diplomacy';
import { villageTradeEstimate } from './ui/village-trade-estimate';
import { villageTradeSummary } from './ui/village-trade-summary';
import { IRRIGATION_RADIUS, irrigationYieldMultiplier } from './game/irrigation';
import { GUARD_POST_CAPACITY, GUARD_POST_UPKEEP, GUARD_POST_UPKEEP_INTERVAL } from './game/guard-posts';
import { BUILDING_UPKEEP, settlementMaintenance, townBuildTerms, WATCHTOWER_MAINTENANCE } from './game/maintenance';
import { HEALER_SHACK_RADIUS, HEALER_SHACK_MULTIPLIER } from './game/healer-shack';
import { enemyStrength, setEnemyStrength } from './game/enemy-strength';
import { DEFAULT_BANDIT_INTENSITY, banditIntensity, normalizeBanditIntensity, setBanditIntensity } from './game/bandit-intensity';
import { ECONOMY_INTERVAL } from './game/economy-constants';
import { WELL_RADIUS, WELL_POPULATION_REQUIREMENT } from './game/wells';
import { retinueCommand, toggleRetinueOrder } from './ui/retinue-controls';
import { infantryFormationControl, leaderHeldTurnForKey, leaderHotbarActionForKey } from './ui/infantry-formation-controls';
import { infantryFormationActive, toggleInfantryFormation } from './game/infantry-drill';
import { beginOffensive, cancelOffensive } from './game/offensive-native';
import { canWalk } from './game/pathfinding';
import { offensiveControl, updateOffensiveButton } from './ui/offensive-controls';
import './ui/offensive-controls.css';
import { tilesInRectangle, clearArea } from './game/area-tools';
import { culturePerSecond, cultureLevel, nextCultureThreshold, MONUMENT_CULTURE_PER_SECOND, SETTLEMENT_CULTURE_PER_SECOND } from './game/culture';
import { BuildingActivityPopup } from './ui/building-activity';
import { ResourceActivityPopup } from './ui/resource-activity';
import './ui/resource-activity.css';
import { buildingActivityAvailable } from './game/building-activity';
import { buildingAtPoint, neutralVillageEntityAt, unitAtPoint } from './game/hit-testing';
import { buildingResearchRequirement, isBuildingUnlocked, RESEARCH_BRANCHES } from './game/research';
import { BIOME_NAMES, HILL_BIOME_NAMES, RESOURCE_NAMES, groundMovementMultiplier } from './game/geography';
import { fieldHarvestFoodForState } from './game/farms';
import { parseGameSave, serializeGameSave, serializeGameSaveAsync } from './game/game-save';
import { restorableSimulation, simCore } from './game/sim-handle';
import { AUTOSAVE_ID, listStoredGames, readStoredGame, writeStoredGame, type StoredGameDetails } from './game/game-storage';
import type { NewGameOptions } from './ui/world-generation';
import { Frontend, type FrontendAction, type FrontendView, type HallOfFameEntry } from './ui/frontend';
import { AccountClient } from './account/client';
import { MultiplayerClient } from './multiplayer/client';
import type { GameCommand } from './multiplayer/protocol';
import { playerFaction } from './game/player-context';
import { automaticallyRebuildDefenses, setAutomaticallyRebuildDefenses } from './game/defense-rebuilding';
import { hasObservationLodge } from './game/observation-posts';
import { buildCostAt } from './game/simulation';
import { MobileControls } from './ui/mobile-controls';
import { fitGameViewport } from './ui/game-viewport';
import './ui/leader-respawn.css';
import './ui/reference-buttons.css';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const freshSeed = () => `TinyCiv-${Math.floor(Math.random() * 900000 + 100000)}`;
// Terrain definitions changed; earlier worlds are replaced by a fresh game.
const ENEMY_SETTING_STORAGE = 'tinyciv-enemy-strength';
let preferredEnemyStrength = 1;
const BANDIT_SETTING_STORAGE = 'tinyciv-bandit-intensity';
const REBUILD_SETTING_STORAGE = 'tinyciv-auto-rebuild-defenses';
const INFINITE_GOLD_SETTING_STORAGE = 'tinyciv-infinite-gold';
let preferredInfiniteGold = false;
const HALL_OF_FAME_STORAGE = 'tinyciv-hall-of-fame';
let preferredAutoRebuildDefenses = true;
let preferredBanditIntensity = DEFAULT_BANDIT_INTENSITY;
try {
  preferredEnemyStrength = Math.max(.25, Math.min(3, Number(localStorage.getItem(ENEMY_SETTING_STORAGE) ?? 1) || 1));
  preferredAutoRebuildDefenses = localStorage.getItem(REBUILD_SETTING_STORAGE) !== 'false';
  preferredInfiniteGold = localStorage.getItem(INFINITE_GOLD_SETTING_STORAGE) === 'true';
  const stored = localStorage.getItem(BANDIT_SETTING_STORAGE);
  if (stored !== null) preferredBanditIntensity = normalizeBanditIntensity(Number(stored));
} catch { /* Settings still work in memory when browser storage is unavailable. */ }
$('#app').innerHTML = '<div class="frontend-boot"><div class="frontend-boot-loading"><span class="frontend-loading-spinner" aria-hidden="true"></span><progress class="frontend-loading-accessible" aria-label="Loading progress" value="0" max="1"></progress><output class="frontend-loading-percent" aria-hidden="true">0%</output></div></div>';
try { await loadGameFonts(); }
catch (error) {
  $('#app').innerHTML = '<div class="frontend-boot"><div><p>Unable to load the game font.</p><button id="boot-retry">Retry</button></div></div>';
  $('#boot-retry').onclick = () => location.reload();
  throw error;
}
await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let state: GameState;
let chooseInitialWorld = false;
async function initialGame(): Promise<GameState> {
  const world = await generateWorldAsync(freshSeed(), undefined, undefined, {}, ({ progress }) => {
    $<HTMLProgressElement>('.frontend-boot progress').value = progress * .85;
    $('.frontend-boot .frontend-loading-percent').textContent = `${Math.round(progress * 85)}%`;
  });
  $<HTMLProgressElement>('.frontend-boot progress').value = .9;
  $('.frontend-boot .frontend-loading-percent').textContent = '90%';
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const game = createGame(world, undefined, { banditIntensity: preferredBanditIntensity });
  $<HTMLProgressElement>('.frontend-boot progress').value = 1;
  $('.frontend-boot .frontend-loading-percent').textContent = '100%';
  return game;
}
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
  const serialized = developmentHandoff ? undefined : await readStoredGame();
  const saved = developmentHandoff?.state ?? (serialized ? parseGameSave(serialized) : null);
  if (saved?.world && saved.world.tiles?.length === saved.world.width * saved.world.height && saved.factions?.[0] && Array.isArray(saved.units) && restorableSimulation(saved)) {
    state = saved;
    state.paused = Boolean(state.paused);
    state.buildMode = null;
    state.diplomacy = null;
  } else { state = await initialGame(); chooseInitialWorld = true; }
} catch { state = await initialGame(); chooseInitialWorld = true; }
// A continued world's difficulty is authoritative over the new-game preference.
preferredBanditIntensity = banditIntensity(state);
if (chooseInitialWorld) setEnemyStrength(state, preferredEnemyStrength);
preferredEnemyStrength = enemyStrength(state);
if (chooseInitialWorld) setAutomaticallyRebuildDefenses(state, preferredAutoRebuildDefenses);
if (chooseInitialWorld) state.infiniteGold = preferredInfiniteGold;
preferredInfiniteGold = !!state.infiniteGold;

$('#app').innerHTML = `
<main class="game-area">
  <canvas id="world" tabindex="0" aria-label="TinyCiv game world. Right click or WASD to move, left click to select, 1 or E to recall retinue, 2 to change stance, 3 to toggle Infantry Drill formation, 9 for Offensive, hold Q/E to rotate while active, B to build, F for fortifications, C to clear trees, buildings and construction, H for controls."></canvas>
  <div id="leader-action-feedback" class="leader-action-feedback" aria-hidden="true" hidden></div>
  <header class="resource-bar" aria-label="Resources">
    <div class="resources">
      <div class="resource food" title="Food · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/runtime/ui/resources/food.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="food"></strong><span id="food-yield"></span></div></div>
      <div class="resource gold" title="Gold · Income received over the last 30 game seconds"><img class="resource-icon" src="/assets/runtime/ui/resources/gold.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="gold"></strong><span id="gold-yield"></span></div></div>
      <div class="resource population" title="Population / housing"><img class="resource-icon" src="/assets/runtime/ui/resources/population.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="population"></strong><span id="capacity"></span></div></div>
      <div class="resource culture" aria-label="Culture"><img id="culture-icon" class="resource-icon" src="/assets/runtime/ui/resources/culture.webp" alt="" aria-hidden="true"><div class="resource-values"><strong id="culture"></strong><span id="culture-next"></span><span id="culture-rate"></span></div></div>
    </div>
    <div id="research-toolbar" class="research-toolbar" aria-label="Current research"></div>
    <div class="time-controls"><button type="button" id="diplomacy-menu" aria-haspopup="dialog">Diplomacy</button><button type="button" id="menu" aria-haspopup="dialog" title="Game menu"><span aria-hidden="true" class="menu-glyph"></span> Menu</button><button type="button" id="pause" title="Pause (Space)" aria-label="Pause">${icon('pause')}</button><button type="button" id="speed" title="Simulation speed" aria-label="Change simulation speed"><span class="speed-value">1×</span></button></div>
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
      ${(['anchor', 'land', 'reinforce'] as const).map((action, i) => `<button class="action-slot" data-slot="${i + 6}" data-naval-action="${action}" disabled hidden><kbd>${i + 6}</kbd><img alt="" class="naval-hotbar-icon" src="${import.meta.env.BASE_URL}assets/runtime/ui/naval/${action}.webp"><span class="hotbar-label">${action === 'anchor' ? 'Cast anchor' : action === 'land' ? 'Go ashore' : 'Reinforce'}</span></button>`).join('')}
      <button class="action-slot research-locked" data-slot="9" data-hotbar-action="offensive" aria-label="Offensive · Requires Officer Corps" aria-keyshortcuts="9" aria-pressed="false" disabled><kbd>9</kbd><span class="hotbar-art hotbar-offensive" aria-hidden="true" style="background-image:url('${import.meta.env.BASE_URL}assets/runtime/ui/forged/retinue-actions-pixel.webp')"></span><span class="hotbar-label">Offensive</span></button>
      <button class="action-slot" data-slot="10" aria-label="Empty action slot 10" disabled><kbd>10</kbd></button>
    </section>
    <section class="special-actions" aria-label="Actions">
      ${constructionActionsMarkup({
        build: actionTooltip('Opens the civilian building menu.'),
        fortifications: actionTooltip('Opens the defenses menu.'),
        clear: actionTooltip('Drag to clear vegetation or remove buildings; unfinished work refunds unused gold.'),
        forbid: actionTooltip('Drag to forbid civilian and guard activity; drag from inside a zone to erase it.'),
      })}
    </section>
    <section class="build-panel" id="build-panel" role="region" aria-label="Buildings" hidden>
      <button id="close-build" aria-label="Close construction menu" title="Close (Esc)">×</button>
      <div class="build-actions">
        ${buildingButtonsMarkup(kind => {
          const gold = BUILD_COSTS[buildingKindForSelection(kind)].gold;
          const seconds = wholeNumber(CONSTRUCTION_SECONDS[buildingKindForSelection(kind)]);
          return buildTooltip(kind, Number(gold), Number(seconds));
        })}
      </div>
    </section>
  </footer>
  <div id="build-status" class="build-status" role="status" aria-live="polite"></div>
  <div id="leader-respawn" class="leader-respawn" role="status" hidden><span>Waiting to respawn<span class="respawn-dots" aria-hidden="true">...</span></span></div>
  <div id="tile-tooltip" hidden></div>
  <section id="building-activity" class="building-activity" role="dialog" aria-modal="false" aria-labelledby="building-activity-title" hidden></section>
  <section id="resource-activity" class="building-activity resource-activity" role="dialog" aria-modal="false" aria-labelledby="resource-activity-title" hidden></section>
  <section id="leader-skills" class="leader-skills" role="dialog" aria-modal="false" aria-labelledby="leader-skills-title" hidden></section>
</main>
<div class="dialog-backdrop" id="dialog" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button id="close-dialog" class="close-dialog" aria-label="Close">${icon('close')}</button><div id="dialog-body"></div></section></div><div id="frontend"></div>`;

fitGameViewport($('.game-area'));
const canvas = $<HTMLCanvasElement>('#world');
const renderer = new Renderer(canvas, $<HTMLCanvasElement>('#minimap'));
let offensivePlacement: { state: GameState; rally?: Point; zoom: number; follow: boolean; paused: boolean } | undefined;
const offensivePlacementPanel = document.createElement('div');
offensivePlacementPanel.className = 'offensive-placement';
offensivePlacementPanel.hidden = true;
offensivePlacementPanel.innerHTML = '<strong role="status">Rally flag</strong><button type="button">Cancel</button>';
$('.game-area').append(offensivePlacementPanel);
offensivePlacementPanel.querySelector('button')!.onclick = () => { endOffensivePlacement(true); updateUI(); };
renderer.center(state);
const actionTooltips = new ActionTooltips();
const armyWarnings = new ArmyWarnings($('.game-area'), () => state, point => renderer.screenPoint(point));
if (developmentHandoff) {
  if (developmentHandoff.camera) renderer.camera = developmentHandoff.camera;
  if (developmentHandoff.follow !== undefined) renderer.follow = developmentHandoff.follow;
  if (developmentHandoff.zoom !== undefined) renderer.zoom = developmentHandoff.zoom;
  developmentHandoff = undefined;
}
const buildingActivity = new BuildingActivityPopup($('#building-activity'), () => state, point => renderer.screenPoint(point),
  () => ({ width: renderer.width, height: renderer.height }), save, () => canvas.focus({ preventScroll: true }), command => sendCommand(command));
const resourceActivity = new ResourceActivityPopup($('#resource-activity'), () => state, point => renderer.screenPoint(point),
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
  buildingActivity.close(); resourceActivity.close(); clearPlacement(); buildMenu = null;
  clearInput(); cancelStroke(); clearPointer();
  if (state.multiplayer) multiplayer.input(input);
}, () => canvas.focus({ preventScroll: true }), () => sessionStarted && !frontend.active && $('#dialog').hidden && !state.gameOver);
const input: InputState = { up: false, down: false, left: false, right: false, turnLeft: false, turnRight: false };
const GAME_SPEEDS = [1, 2, 3, 4, 6, 8] as const;
const speedIndex = () => Math.max(0, GAME_SPEEDS.findIndex(speed => speed >= state.speed));
let pauseBeforeDialog = false, gameEndShown = false, last = performance.now(), lastUI = 0, lastSave = 0;
let lastVillageTradeMarkup = '';
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
let routePreviewKey = "";
const constructionGesture = new ConstructionGestureCache();
let pointerStatusDirty = false, linearCleanupDue = false, linearPurchaseNotice = "";
const linearPurchases: { purchase: LinearPurchase; kind: 'road' | 'irrigation'; queuedAt: number }[] = [];
let linearPurchaseState: GameState | undefined, linearPurchasesChanged = false, linearWorkSkippedFrames = 0;
let linearPurchasesCompleted = 0, linearPurchaseLastResult: LinearPurchaseResult | undefined;
let linearWorkSerial = 0, linearWorkMs = 0;
let pointer: Point | null = null;
const clearTurnInput = () => { input.turnLeft = input.turnRight = false; if (state.multiplayer) multiplayer.input(input); };
const clearInput = () => { input.up = input.down = input.left = input.right = false; clearTurnInput(); };
let sessionStarted = false, pauseBeforeFrontend = state.paused;
let saveLibraryBusy = false, loadingSavedGame = false;
let offlineState = state;
let onlineIncomeHistory: object = {};
let connectionAttempt = 0;
let leavingRoom = false;
const pendingCaptures = new Set<number>();
let retryFrontend: () => void = () => location.reload();
let leaveDestination: FrontendView = 'servers';
const frontend = new Frontend($('#frontend'), action => handleFrontendAction(action));
const accounts = new AccountClient();
void accounts.restore().then(user => frontend.setAccount(user)).catch(() => {});
async function submitAccount(action: Extract<FrontendAction, { type: 'account-submit' }>): Promise<void> {
  frontend.setAccountBusy(true);
  try {
    const user = await accounts.signIn(action.mode, action.email, action.password);
    frontend.setAccount(user); frontend.show('main');
  } catch (error) { frontend.setAccountMessage(error instanceof Error ? error.message : 'Sign-in failed. Try again.'); }
  finally { action.password = ''; frontend.setAccountBusy(false); }
}
function readHallOfFame(): (HallOfFameEntry & { key?: string })[] {
  try { const entries = JSON.parse(localStorage.getItem(HALL_OF_FAME_STORAGE) ?? '[]'); return Array.isArray(entries) ? entries : []; }
  catch { return []; }
}
frontend.setHallOfFame(readHallOfFame());
/** Remember a finished single-player reign once, even if the end screen reappears after a reload. */
function recordHallOfFame(): void {
  const faction = state.factions.find(candidate => candidate.id === playerFaction(state));
  if (!faction) return;
  const result = state.victory ? 'Victory' : 'Defeat', key = `${state.seed}:${result}:${Math.floor(state.time / 60)}`;
  const entries = readHallOfFame();
  if (entries.some(entry => entry.key === key)) return;
  entries.unshift({ key, result, civilization: faction.name, seed: state.seed, minutes: state.time / 60, population: faction.population, date: new Date().toISOString().slice(0, 10) });
  try { localStorage.setItem(HALL_OF_FAME_STORAGE, JSON.stringify(entries.slice(0, 50))); } catch { /* The record stays for this session. */ }
  frontend.setHallOfFame(entries);
}
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
    if (entering) { if (!state.multiplayer) offlineState = state; buildingActivity.close(); resourceActivity.close(); leaderProgression.reset(); clearInput(); clearPointer(); cancelStroke(); pendingCaptures.clear(); leaderActionFeedback.clear(); onlineIncomeHistory = {}; }
    const view = { selected: state.selected, selectedType: state.selectedType, buildMode: state.buildMode, diplomacy: state.diplomacy };
    state = next;
    if (!entering) Object.assign(state, view);
    if (initial) renderer.prepare(state);
    if (entering) { telemetry.startPlay(state); buildMenu = null; areaTool = null; renderer.center(state); gameEndShown = false; sessionStarted = true; hideFrontend(); }
    updateUI();
  },
  onStatus: message => { frontend.setStatus(message); $('#network-status').textContent = message; $('#network-status').hidden = !message || !state.multiplayer; },
  onLoading: (_message, progress) => { if (!leavingRoom && multiplayer.room?.phase === 'loading') showLoading('Starting match', '', progress, true); },
  onError: message => { telemetry.error(message, 'multiplayer'); if (!multiplayer.connected || frontend.currentView === 'loading' || !frontend.active) { showFrontend('error'); frontend.error(message); } else frontend.setStatus(message); },
  onResult: result => {
    const siteDialog = document.querySelector<HTMLElement>('.site-dialog');
    if (result.siteId !== undefined && siteDialog?.dataset.siteId === String(result.siteId)) {
      if (result.ok) { closeDialog(); updateUI(); }
      else {
        const button = $<HTMLButtonElement>('#site-build'); delete button.dataset.pending;
        button.disabled = false; $('#site-error').textContent = result.message ?? 'Cannot build here.';
        nextSiteDialogRefreshAt = performance.now() + 500;
      }
    }
    if (result.questAction !== undefined) { closeDialog(); updateUI(); }
    else if (!result.ok) {
      const button = document.querySelector<HTMLButtonElement>('[data-quest-action]');
      if (button) { delete button.dataset.pending; button.disabled = false; }
    }
    if (result.hermitRumor) showHermitReply(result.hermitRumor);
    if (!result.ok) { pendingCaptures.clear(); showCommandError(result.message || 'The command could not be completed.'); }
  },
});
function showCommandError(message: string): void {
  buildError = message; frontend.setStatus(message); $('#build-status').textContent = message;
  const status = $('#network-status'); status.textContent = message; status.hidden = false;
  if (buildingActivity.isOpen) buildingActivity.message(message);
  if (resourceActivity.isOpen) resourceActivity.message(message);
  const questError = document.querySelector<HTMLElement>('[data-quest-error]');
  if (questError) questError.textContent = message;
  window.setTimeout(() => { if (status.textContent === message) status.hidden = true; }, 3500);
}
function sendCommand(command: GameCommand): boolean {
  if (!state.multiplayer) return false;
  if (!multiplayer.command(command)) showCommandError('Not connected to the match.');
  return true;
}
let placementIntentState: GameState | undefined, placementIntentActive: boolean | undefined;
function syncPlacementIntent(): void {
  if (!state.multiplayer) { placementIntentState = undefined; placementIntentActive = undefined; return; }
  const active = !!state.buildMode && state.buildMode !== 'clearTrees';
  if (placementIntentState === state && placementIntentActive === active) return;
  if (multiplayer.command({ type: 'placement-intent', active })) {
    placementIntentState = state; placementIntentActive = active;
  }
}
function showFrontend(view: FrontendView = 'main'): void {
  endOffensivePlacement(true);
  if (!frontend.active && !state.multiplayer) pauseBeforeFrontend = state.paused;
  if (!state.multiplayer) state.paused = true;
  buildingActivity.close(); resourceActivity.close(); leaderProgression.close(); clearInput(); cancelStroke(); clearPointer(); pan = null;
  if (state.multiplayer) multiplayer.input(input);
  $('#dialog').hidden = true; dismissDialog = undefined;
  $('.game-area').inert = true; $('.game-area').classList.add('frontend-active');
  frontend.setSession(sessionStarted, !!state.multiplayer);
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
    infiniteGold: !!state.infiniteGold,
    autoRebuildDefenses: automaticallyRebuildDefenses(state.factions.find(f => f.id === playerFaction(state))),
    revealMapAvailable: import.meta.env.DEV && sessionStarted && !state.multiplayer, revealMap: isMapRevealed(state),
    fullscreen: !!document.fullscreenElement, enemyStrength: enemyStrength(state), banditIntensity: multiplayer.room && !state.multiplayer ? DEFAULT_BANDIT_INTENSITY : banditIntensity(state) });
}
function showLoading(title: string, status: string, progress?: number, cancellable = false): void { showFrontend('loading'); frontend.loading(title, status, progress, cancellable); }
function leaveOnlineState(): void {
  telemetry.stopPlay();
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
  if (action.type === 'account-submit') { void submitAccount(action); return; }
  if (action.type === 'feedback-submit') {
    frontend.setFeedbackBusy(true);
    void accounts.submitFeedback(action.message, action.signedIn)
      .then(() => frontend.setFeedbackResult('Feedback sent. Thank you.', true))
      .catch(error => frontend.setFeedbackResult(error instanceof Error ? error.message : 'Feedback could not be sent. Try again.'))
      .finally(() => frontend.setFeedbackBusy(false));
    return;
  }
  if (action.type === 'account-logout') {
    frontend.setAccountBusy(true);
    void accounts.logout().then(() => frontend.setAccount(null)).catch(() => frontend.setStatus('Sign-out failed. Try again.'))
      .finally(() => frontend.setAccountBusy(false));
    return;
  }
  if (action.type === 'resume') { telemetry.ensurePlay(state); sessionStarted = true; hideFrontend(); updateUI(); return; }
  if (action.type === 'saves') { void openSavedGames(); return; }
  if (action.type === 'load') { void loadSavedGame(action.id); return; }
  if (action.type === 'save') {
    void saveNamedGame(action.name);
    return;
  }
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
    if (action.settings.infiniteGold !== undefined && !state.multiplayer && !multiplayer.room) {
      state.infiniteGold = preferredInfiniteGold = action.settings.infiniteGold;
      try { localStorage.setItem(INFINITE_GOLD_SETTING_STORAGE, String(preferredInfiniteGold)); } catch { /* Settings remain active in memory. */ }
      save();
    }
    if (action.settings.revealMap !== undefined && import.meta.env.DEV && !state.multiplayer) setMapRevealed(state, action.settings.revealMap);
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
      showLoading(action.options.scenario ? 'Loading scenario' : 'Generating world', '', 0);
      requestAnimationFrame(() => requestAnimationFrame(async () => {
        try { if (multiplayer.room) multiplayer.leave(); await newWorld(action.options); sessionStarted = true; offlineState = state; pauseBeforeFrontend = false; hideFrontend(); save(); }
        catch (error) { telemetry.error(error, 'world-generation'); frontend.error(error instanceof Error ? error.message : 'Unable to generate this world. Try a different seed.'); }
      }));
    };
    retryFrontend = start; start();
  }
}
const signed = (n: number) => { const rounded = Math.round(n); return `${rounded >= 0 ? '+' : ''}${rounded}`; };
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
let saveQueue = Promise.resolve(true);
let pendingSaves = 0;
// Game actions request a save; one coalesced write runs when the browser is
// idle. Clicking through placements or popups no longer serializes the whole
// game inside each input handler. Explicit and page-hide saves use saveNow.
const SAVE_DEBOUNCE_MS = 1500;
let saveTimer: number | undefined, saveIdle: number | undefined;
function save(): void {
  if (state.multiplayer || !sessionStarted || loadingSavedGame || saveTimer !== undefined || saveIdle !== undefined) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const run = () => { saveIdle = undefined; void saveNow(); };
    if (typeof requestIdleCallback === 'function') saveIdle = requestIdleCallback(run, { timeout: 2500 });
    else run();
  }, SAVE_DEBOUNCE_MS);
}
function cancelPendingSave() {
  if (saveTimer !== undefined) { clearTimeout(saveTimer); saveTimer = undefined; }
  if (saveIdle !== undefined) { cancelIdleCallback(saveIdle); saveIdle = undefined; }
}
function savedGameDetails(source: GameState, name = 'Autosave'): StoredGameDetails {
  return { name, savedAt: Date.now(), time: source.time, seed: source.seed,
    civilization: source.factions.find(faction => faction.id === playerFaction(source))?.name ?? '' };
}
function saveNow(incremental = true, name?: string): Promise<boolean> {
  cancelPendingSave();
  if (state.multiplayer || !sessionStarted || loadingSavedGame) return Promise.resolve(false);
  const source = state, paused = frontend.active ? pauseBeforeFrontend : $('#dialog').hidden ? state.paused : pauseBeforeDialog;
  pendingSaves++;
  // Serialize requests in order, including their terrain preparation. A slow
  // old-world save cannot overwrite a later explicit save or a new world.
  return saveQueue = saveQueue.then(async () => {
    try {
      const serialized = await serializeGameSaveAsync(source, { incremental, paused });
      await writeStoredGame(serialized, savedGameDetails(source, name), name === undefined ? AUTOSAVE_ID : crypto.randomUUID());
      return true;
    } catch { return false; }
    finally { pendingSaves--; }
  });
}
async function openSavedGames(): Promise<void> {
  if (saveLibraryBusy || state.multiplayer || multiplayer.room) return;
  saveLibraryBusy = true;
  frontend.setSaves([], `${state.factions[0]?.name || 'Game'} · ${Math.floor(state.time / 60)} min`);
  frontend.setSavesBusy(true);
  showFrontend('saves'); frontend.setStatus('Loading saves…');
  try {
    await saveQueue;
    frontend.setSaves(await listStoredGames()); frontend.setStatus('');
  } catch { frontend.setStatus('Unable to read saved games. Browser storage may be unavailable.'); }
  finally { saveLibraryBusy = false; frontend.setSavesBusy(false); }
}
async function saveNamedGame(value: string): Promise<void> {
  const name = value.trim();
  if (saveLibraryBusy || !name || name.length > 80 || !sessionStarted || state.multiplayer) return;
  saveLibraryBusy = true; frontend.setSavesBusy(true); frontend.setStatus('Saving…');
  try {
    if (!await saveNow(false, name)) {
      frontend.setStatus('Unable to save. Browser storage may be full or unavailable.'); return;
    }
    frontend.setStatus(`Saved “${name}”.`);
    try { frontend.setSaves(await listStoredGames()); }
    catch { frontend.setStatus(`Saved “${name}”, but the save list could not be refreshed.`); }
  } finally { saveLibraryBusy = false; frontend.setSavesBusy(false); }
}
async function loadSavedGame(id: string): Promise<void> {
  if (saveLibraryBusy || state.multiplayer || multiplayer.room) return;
  saveLibraryBusy = loadingSavedGame = true;
  cancelPendingSave(); frontend.setSavesBusy(true); frontend.setStatus('Loading game…');
  let loaded = false;
  try {
    // Finish earlier writes before reading, and block autosaves until the
    // replacement is complete so an old session cannot overwrite this one.
    await saveQueue;
    const serialized = await readStoredGame(id);
    if (!serialized) throw new Error('This saved game is no longer available.');
    const next = parseGameSave(serialized);
    if (next.multiplayer || !next.factions?.[0] || !Array.isArray(next.units) || !Array.isArray(next.buildings) || !restorableSimulation(next))
      throw new Error('This saved game is invalid.');
    // Import and validate the native snapshot before replacing the live game.
    simCore(next); resetEntities(next);
    respawnCamera.cancel(); deathCamera = undefined; wasWaitingForRespawn = wasRespawnPanning = false;
    buildingActivity.close(); resourceActivity.close(); leaderProgression.reset();
    clearInput(); clearPointer(); cancelStroke(); discardLinearPurchases(); pendingCaptures.clear();
    dismissDialog = undefined; $('#dialog').hidden = true;
    state = next; offlineState = next; sessionStarted = true; telemetry.startPlay(state);
    state.buildMode = null; state.diplomacy = null;
    buildMenu = null; areaTool = null; pan = null; gameEndShown = false; buildError = '';
    pauseBeforeDialog = pauseBeforeFrontend = Boolean(state.paused);
    retinueActionReadyAt.recall = retinueActionReadyAt.stance = 0;
    renderer.moveMarker = null; renderer.movementModeMarker = null; leaderActionFeedback.clear();
    preferredBanditIntensity = banditIntensity(state); preferredEnemyStrength = enemyStrength(state);
    preferredInfiniteGold = !!state.infiniteGold;
    preferredAutoRebuildDefenses = automaticallyRebuildDefenses(state.factions[0]);
    renderer.prepare(state); renderer.center(state);
    frontend.setStatus(''); hideFrontend(); updateUI(); loaded = true;
  } catch (error) {
    telemetry.error(error, 'save-load');
    frontend.setStatus(error instanceof Error ? `Unable to load game: ${error.message}` : 'Unable to load this saved game.');
  } finally {
    saveLibraryBusy = loadingSavedGame = false; frontend.setSavesBusy(false);
  }
  if (loaded) save();
}
function cancelStroke() {
  routePreviewKey = ''; constructionGesture.clear(); renderer.constructionGesture = undefined;
  stroke = null; areaStroke = null; renderer.buildPreview = []; renderer.areaPreview = null;
  pointerStatusDirty = true;
}
function clearPointer() {
  pointer = null; renderer.hover = null;
  if (!stroke) { renderer.buildPreview = []; renderer.constructionGesture = undefined; constructionGesture.clear(); }
}
function refreshWorldPointer(authoritative = false) {
  // Input events only record the latest screen position. Rendering calls this
  // after moving the camera so the one shared quote stays under the cursor.
  renderer.hover = pointer ? renderer.worldPoint(pointer.x, pointer.y) : null;
  const kind = stroke?.kind ?? state.buildMode;
  if (renderer.hover && kind && (stroke ? isLinearPlacement(kind) : kind === 'road' || kind === 'irrigation')) {
    const end = { x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) }, start = stroke?.start ?? end;
    if (authoritative && (state.multiplayer || kind !== 'road' && kind !== 'irrigation')) {
      renderer.buildPreview = constructionRoute(state, kind, start, end, true);
      renderer.constructionGesture = undefined;
      pointerStatusDirty = true;
    } else {
      const preview = constructionGesture.read(state, kind, start, end, performance.now(), authoritative);
      if (renderer.constructionGesture !== preview) pointerStatusDirty = true;
      renderer.constructionGesture = preview; renderer.buildPreview = preview.points;
    }
  } else {
    renderer.constructionGesture = undefined;
    if (stroke && renderer.hover) {
      const end = { x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) };
      const key = `${stroke.kind}:${stroke.start.x},${stroke.start.y}:${end.x},${end.y}`;
      if (authoritative || routePreviewKey !== key) {
        renderer.buildPreview = stroke.kind === 'clearTrees' ? tilesInRectangle(state, stroke.start, end) : [end];
        routePreviewKey = key; pointerStatusDirty = true;
      }
    } else if (!stroke) renderer.buildPreview = [];
  }
  if (areaTool && areaStroke && renderer.hover) {
    const end = { x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) };
    pointerStatusDirty ||= end.x !== areaStroke.end.x || end.y !== areaStroke.end.y;
    areaStroke.end = end;
    renderer.areaPreview = { tool: areaTool, start: areaStroke.start, end, erase: areaStroke.erase };
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
// The caravan estimate plans two paths. Fill it in after the dialog paints;
// villageTradeEstimate keeps later HUD refreshes on a slow clock.
let villageTradeRefreshQueued = false;
function queueVillageTradeRefresh() {
  if (villageTradeRefreshQueued) return;
  villageTradeRefreshQueued = true;
  requestAnimationFrame(() => setTimeout(() => {
    villageTradeRefreshQueued = false;
    if (state.multiplayer) refreshVillageTradeDialog(); else withSimulationReads(state, refreshVillageTradeDialog);
  }, 0));
}
function refreshVillageTradeDialog() {
  if ($('#dialog').hidden) return;
  const comparison = document.querySelector<HTMLElement>('#village-trade-comparison');
  if (!comparison) return;
  const village = state.villages?.find(candidate => candidate.id === Number(comparison.dataset.village));
  const markup = village ? villageTradeSummary(villageTradeEstimate(state, village)) : '<p>Village no longer available.</p>';
  if (markup !== lastVillageTradeMarkup) { comparison.innerHTML = markup; lastVillageTradeMarkup = markup; }
}
function openDialog(html: string) {
  const dismiss = dismissDialog; dismissDialog = undefined;
  dismiss?.();
  buildingActivity.close(); resourceActivity.close();
  leaderProgression.close();
  if ($('#dialog').hidden) pauseBeforeDialog = state.paused;
  if (!state.multiplayer) state.paused = true;
  clearInput(); cancelStroke(); clearPointer();
  if (state.multiplayer) multiplayer.input(input);
  $('#dialog-body').innerHTML = html;
  lastVillageTradeMarkup = '';
  $('#dialog').hidden = false;
  $('#close-dialog').hidden = false;
  $('#close-dialog').focus();
}
async function newWorld(options: NewGameOptions): Promise<void> {
  telemetry.attemptWorld(options);
  const title = options.scenario ? 'Loading scenario' : 'Generating world';
  const progress = async (value: number): Promise<void> => {
    frontend.loading(title, '', value);
    // Let completed work paint before starting the next block.
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  };
  respawnCamera.cancel(); deathCamera = undefined; wasWaitingForRespawn = wasRespawnPanning = false;
  dismissDialog = undefined;
  buildingActivity.close(); resourceActivity.close();
  leaderProgression.reset();
  if (options.scenario) {
    state = await createScenarioGame(options.scenario, value => frontend.loading(title, '', value * .8));
    state.paused = true;
  } else {
    const world = await generateWorldAsync(options.seed, options.width, options.height, options,
      ({ progress: value }) => frontend.loading(title, '', .04 + value * .7));
    await progress(.78);
    state = createGame(world, undefined,
      { advancedStart: options.advancedStart, banditIntensity: options.banditIntensity ?? preferredBanditIntensity });
    state.paused = true;
  }
  preferredBanditIntensity = banditIntensity(state);
  try { localStorage.setItem(BANDIT_SETTING_STORAGE, String(preferredBanditIntensity)); } catch { /* In-memory settings remain active. */ }
  setEnemyStrength(state, preferredEnemyStrength);
  setAutomaticallyRebuildDefenses(state, preferredAutoRebuildDefenses);
  state.infiniteGold = preferredInfiniteGold;
  buildMenu = null; areaTool = null;
  clearInput(); clearPointer(); cancelStroke(); pan = null; renderer.moveMarker = null; renderer.movementModeMarker = null; leaderActionFeedback.clear();
  await progress(.9);
  renderer.prepare(state); renderer.center(state);
  gameEndShown = false; pauseBeforeDialog = false; buildError = '';
  last = performance.now();
  closeDialog();
  // Loading still owns the pause through the final progress paint.
  state.paused = true;
  save(); updateUI();
  await progress(1);
  telemetry.startPlay(state);
}
function showPalaceCapture() {
  const offer = state.palaceCaptures?.find(offer => !pendingCaptures.has(offer.palaceId) && (offer.captor === undefined || offer.captor === playerFaction(state)));
  if (!offer) return;
  openDialog(`<h2 id="dialog-title">Capture ${escape(offer.cityName)}?</h2><div class="dialog-actions"><button id="leave-palace">Leave destroyed</button><button class="primary" id="capture-palace">Capture city</button></div><p id="capture-result" role="status"></p>`);
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
  const faction = state.factions.find(faction => faction.id === playerFaction(state));
  const report = faction ? campaignReportMarkup({ ...campaignStats(state, faction), civilization: faction.name,
    elapsedSeconds: state.time, treasury: faction.gold, culture: lifetimeCulture(faction),
    cities: state.buildings.filter(building => building.kind === 'palace' && building.faction === faction.id && building.hp > 0 && !building.construction).length }) : '';
  if (state.multiplayer) {
    const defeated = state.multiplayer.winner !== -1 && state.multiplayer.winner !== playerFaction(state);
    openDialog(`<h2 id="dialog-title">${state.multiplayer.winner === -1 ? 'Draw' : defeated ? 'Defeat' : 'Victory'}</h2>${report}<div class="dialog-actions"><button class="primary" id="leave-match">Main menu</button></div>`);
    if (defeated) { $('#close-dialog').hidden = true; $('#leave-match').focus(); }
    $('#leave-match').onclick = () => { closeDialog(); leaveMultiplayer('main'); };
    return;
  }
  recordHallOfFame();
  const respawn = !state.victory && canRespawnLeader(state);
  openDialog(state.victory
    ? `<h2 id="dialog-title">Victory</h2>${report}<div class="dialog-actions"><button class="primary" id="keep-playing">Keep playing</button><button id="play-again">Main menu</button></div>`
    : `<h2 id="dialog-title">Defeat</h2><div class="dialog-actions"><button class="primary" id="respawn" ${respawn ? '' : 'disabled title="Requires a surviving town with clear, safe ground nearby."'}>Respawn</button><button id="play-again">Main menu</button></div><p id="respawn-error" role="status"></p>`);
  if (!state.victory) {
    $('#close-dialog').hidden = true;
    $(respawn ? '#respawn' : '#play-again').focus();
  }
  $('#play-again').onclick = () => { dismissDialog = undefined; closeDialog(); gameEndShown = false; showMenu(); };
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
    if (!result.ok) { $('#respawn-error').textContent = result.message; $<HTMLButtonElement>('#respawn').disabled = true; $('#play-again').focus(); return; }
    clearInput(); cancelStroke(); clearPointer(); pan = null;
    buildMenu = null; areaTool = null; buildError = '';
    renderer.moveMarker = null; renderer.movementModeMarker = null; leaderActionFeedback.clear(); renderer.center(state);
    gameEndShown = false; pauseBeforeDialog = false; last = performance.now();
    closeDialog(); save(); updateUI();
  };
}
function showHelp() {
  openDialog(`<h2 id="dialog-title">Controls</h2><dl class="controls"><dt>WASD / arrows</dt><dd>Move the Leader, including while placing buildings. In Formation 3, W/S advance/reverse and A/D strafe relative to facing.</dd><dt>Right click</dt><dd>Move to ground, attack enemies, or open diplomacy on a peaceful faction’s building</dd><dt>Left click</dt><dd>Select a unit or building</dd><dt>Leader attack</dt><dd>Automatically throws javelins up to 4 tiles, or 5 when firing downhill</dd><dt>2 / Q</dt><dd>Cycle retinue stance: Defensive, Hold, Aggressive. Hold Q to rotate left while Formation 3 is active; 2 always changes stance.</dd><dt>1 / E</dt><dd>Recall the retinue without changing stance. Hold E to rotate right while Formation 3 is active; 1 always recalls.</dd><dt>3 · Infantry Drill</dt><dd>Toggle close rectangular ranks after researching Infantry Drill with at least eight retinue soldiers. If fewer than five remain, the formation disbands and its survivors and Leader rout. The Leader stays in the center with ranged troops in the rear; soldiers adjust around nearby obstacles while clear ranks keep their places. March at 105% speed, with +25% frontal damage and +50% defense. Hold Q/E to rotate continuously; release to stop. A/D strafe without changing facing.</dd><dt>Shift</dt><dd>Separate mob / travel setting: move together as a mob around the Leader at three-quarter speed</dd><dt>Farm peasants</dt><dd>Gather ripe food and carry it to the town before it spoils</dd><dt>B</dt><dd>Open / close buildings</dd><dt>F</dt><dd>Open / close fortifications</dd><dt>B then R / G / H / U</dt><dd>Road / farm / house / irrigation</dd><dt>F then P / T / G / L / N</dt><dd>Wall / wood tower / guard post / ballista / siege cannon</dd><dt>B then V / L / T</dt><dd>Bridge / well / dock</dd><dt>Sailing</dt><dd>Research Sailing after Exploration, then build a dock on shore. Each completed dock launches one sailboat. Right-click your boat to board; use WASD or right-click water to sail. Right-click a reachable shore to disembark. The empty boat stays behind for reboarding; the retinue remains on land.</dd><dt>C</dt><dd>Clear trees, buildings, and construction sites with one rectangular selection</dd><dt>B then Y</dt><dd>Stable after Horseback Riding</dd><dt>B then M / K / J / N</dt><dd>Monument / blacksmith / archery range / new town</dd><dt>Drag to build a line</dt><dd>Drag roads, walls, bridges, or irrigation ditches. On touchscreens, tap the start and then the end.</dd><dt>Clear</dt><dd>Drag a rectangle to queue tree or marsh-plant clearing, cancel unfinished friendly construction with its unused gold refunded, and remove completed owned buildings or buildings within your borders without a refund. You can also drag directly from Clear to a single tile. Occupied crossings remain when there is no safe exit.</dd><dt>Forbid</dt><dd>Drag a rectangle to keep friendly workers, merchants and guards out. The Leader and retinue may cross. Start a drag inside a forbidden zone to allow that rectangle again. One white marker identifies each connected zone.</dd><dt>9 · Offensive</dt><dd>Place a Rally flag, then an Objective flag after researching Officer Corps.</dd><dt>Space</dt><dd>Pause / resume</dd><dt>= / -</dt><dd>Increase / decrease simulation speed, from 1× to 8×</dd><dt>Home</dt><dd>Center on Leader</dd><dt>Y</dt><dd>Tile yields</dd><dt>Wheel / minimap + / -</dt><dd>Zoom</dd><dt>Middle-drag / minimap</dt><dd>Pan camera</dd><dt>N</dt><dd>New world</dd><dt>Esc</dt><dd>Cancel</dd></dl><p>Normal games begin with 20 residents. Advanced start begins with 250 residents, every building, and 12 naturally supported retinue soldiers: 3 each of warriors, archers, spearmen, and horsemen. Infantry Drill is already researched. New and replacement retinue soldiers recruit one at a time, ten game seconds apart. Farms are walkable single-tile fields costing ${wholeNumber(BUILD_COSTS.camp.gold)} gold and 4 seconds of work each; farms and other buildings can stand directly beside them. Each edge-connected farm block is limited to 16 plots. Blocks of more than six plots must be compact: the longer side can be at most 150% of the shorter side. Each plot produces about 64 food per hour before terrain and bonuses. Connected wheat plots grow and ripen together. Each contiguous same-owner crop parcel uses one peasant, subject to available residents. Towns stagger departures, and each peasant can sweep the entire parcel before returning. Peasants wait inside between trips. Ripe food has 11 seconds of freshness; its timer pauses only while the peasant is actively collecting inside that parcel, including already gathered food. Waiting, fleeing and the return journey consume the remaining time. At least 15 farmland tiles for every eight residents are needed before delivery losses. Larger cities need more farmland, and longer delivery routes lose more food to spoilage, with no hard population cap; roads, irrigation, research and bonuses can improve supply. A courier gathers only from the assigned contiguous parcel and checks that the remaining freshness allows the walk home. Ripe crops must reach the town before they spoil. After 120 seconds without a visit by an owning unit, a farm stays fallow until a unit returns; its peasant can walk back to restart cultivation. Only neutral, unclaimed farms disappear after ten minutes without an owner. Claiming cancels that timer; owned farms remain even while fallow. Click a nearby farm to plant one orchard for 5 gold or the nearest ten for 50 gold. Orchards establish for 120 seconds and then yield 50% more food. Only delivered food feeds the population. Longer journeys leave less time to return a harvest before it spoils. Roads, terrain, and traffic affect how much food reaches the town. A hopping clock warns of an expiring harvest; red numbers show food lost. Governors build farms or houses to relieve the city’s food or housing bottleneck, filling suitable enclosed housing sites first. New and relocated farms favor adjoining fields and fill gaps to form compact blocks. Farm scoring uses actual terrain-weighted walking routes from town doors, so short straight-line distances across water do not hide long delivery detours. Approach within three tiles of your town and click it to toggle Governor permissions or import an immigrant for 100 gold. Each immigrant purchase fills one vacant bed in that city; full towns cannot import immigrants. Buy retinue slot adds one permanent faction-wide slot for 1,000 gold, filled through normal recruitment. Each purchased slot costs 5 gold every 30 game seconds, even while vacant, in addition to soldier upkeep. A completed blacksmith opens armor and weapon upgrades at the same range; each purchase requires a developed iron mine within your faction’s borders. Tiers I–VI cost 200 / 400 / 600 / 800 / 1,000 / 1,200 gold and set defense or attack to 115% / 130% / 150% / 170% / 190% / 210% for your Leader and retinue, including new recruits. Armor also strengthens defensive buildings, and weapons improve tower attacks. Armor tiers I–III use buckler, oval, and legionary shields; IV–VI retain the legionary shield. Farm and Housing checkboxes independently allow automatic construction; each town uses its own development clock and construction limits with shared faction gold; Escape or the red × closes the panel. Open buildings with B or fortifications with F, choose a structure, then click to place it. Clear is available directly with C for trees, buildings, and construction sites. Construction buttons show names and an upper-right shortcut letter; hover to see prices and requirements. Footprints may be placed in fog of war. A peasant travels from the town to construct it. Generated dirt trails connect most neutral villages, using fords to cross rivers. They give 5% faster movement, cannot be constructed, and disappear beneath newly placed roads. Roads can start from either bank of a ford or extend an existing road or bridge. Dragging from or across a ford leaves the crossing intact and free. Repeated travel creates roads only inside faction borders. Construction workers, harvesters, the Leader, and the retinue cross fields without contributing to road creation. Roads block farm placement; placing a road, including a caravan or foot-traffic road, moves an existing farm to a suitable reachable plot at no cost. If no replacement plot exists, the road is not placed. Invalid cells in construction drags are skipped. Queued sites remain open ground until a builder starts work. One builder per five residents shares construction and repair duties; damaged buildings can be repaired after five seconds without a hit. Click a visible resource inside your city’s borders to develop the eligible, explored part of its connected patch for 50 gold per new tile. The popup shows the full price. Mines appear on ore and stone, fences surround olive groves, and salt pans gain a fenced excavation and dirt approach. All resource benefits serve your whole faction while the developed tiles remain within its borders. Each salt tile covers 10 residents for 25% less food consumption; coverage is shared across the whole population and total savings cannot exceed 25%. Each developed olive tree adds 2% to neutral-village trade payouts, stacking across groves; domestic trade is unchanged. Stone can be quarried but has no additional bonus yet. Losing a mine does not remove existing soldiers or completed upgrades. The advanced start’s pre-equipped escort is retained, but later spearman replacements need copper. Construction uses gold: farms cost ${BUILD_COSTS.camp.gold}, houses ${BUILD_COSTS.house.gold}, wells ${BUILD_COSTS.well.gold}, monuments ${BUILD_COSTS.monument.gold}, and blacksmiths ${BUILD_COSTS.blacksmith.gold}. Blacksmiths take 90 seconds to build. Build a forum with B then Q after Cultural Identity (requires Statehood and Traditional Medicine): 300 gold, a 2×2 footprint, 90 seconds to build, and 3 gold upkeep every 30 seconds. Approach within three tiles and click it to purchase permanent achievements with culture. Prerequisites are shown by arrows; spending culture preserves lifetime influence and borders. Build a library with B then I: ${BUILD_COSTS.library.gold} gold, a 2×2 footprint, and 90 seconds. Its research tree unlocks buildings, units, and faction bonuses. Approach within three tiles and use the library slider to direct a share of incoming gold to Science, starting at 25%. The cheapest available technology runs automatically. Select any technology and Prioritize to put it first, including distant technologies whose prerequisites are handled automatically. Add multiple priorities, move one to the front, or remove it; earned Science is retained. The top bar shows the current technology and progress. Research pauses at 0% allocation or without a completed library; additional libraries do not multiply progress. Reinforced Defenses adds 30% wall and tower health; Coinage adds 20% trade gold; Urban Planning adds one housing place per house; Metal Tools adds 25% construction and repair speed; Fletching adds 15% archer damage; Grain Storage keeps newly harvested grain fresh 50% longer. Fortification also unlocks Upgrade to Keep in the town popup: a free, immediate stone upgrade from 650 to 6,500 maximum health that preserves the current health percentage. Keeps shoot arrows, prevent gold theft, and house ten residents. A further 1,000-gold housing upgrade adds fifteen places, for twenty-five total. Houses, wells, bridges, roads, towns, and farms need no research. Military Tactics and a developed copper mine allow stronger, piercing spearmen, allocated at a blacksmith. Siege Engines allows ballistae without developed iron: F then L, 300 gold, 30 seconds of automatic assembly, eighteen-tile range and one shot every four seconds. Siege cannons still require a developed iron mine. Traditional Medicine unlocks a Healer’s shack: B then P, 200 gold, one tile, and 45 seconds to build. Friendly people within four tiles heal three times faster (72 HP every ten seconds) inside their own borders after the usual 15-second recovery delay. Overlapping shacks do not stack. Exploration unlocks Scouts’ Lodges. Build a lodge with B then O for 100 gold and 45 seconds to unlock observation posts in Fortify. Lodges no longer recruit automatic explorers. Archery ranges cost 400 gold, occupy two cells, and take 90 seconds. Their linked sliders set warrior/archer proportions and expected counts. Soldiers visit the range to retrain; replacements may spawn as archers. Archers cost an extra 1 gold each minute, have four-tile range, two-thirds health, half defense and 80% attack, and retreat from melee. Arrows pass buildings but stop at walls. Moving formations put archers behind warriors. Wells require ${WELL_POPULATION_REQUIREMENT} population. A house and a friendly well can share one tile in either build order, including pending construction; wells can also stand alone. Click the front-left well or the house entrance to select each separately. Level 3 houses require well coverage, 40 nearby residents within six tiles, and a guard post in their city’s borders. They hold nine residents and earn 50% more gold per resident. Lost requirements cause a bouncing warning, followed by downgrade after 60 seconds. Each town keeps independent population-growth progress based on its city’s net food production, at twice the previous rate, with up to ten births per 30-second economy tick. Births use only that city’s vacant homes and cost four food from the shared delivered supply. Older cities cannot take a newer city’s births. Each completed well brings friendly houses within ${WELL_RADIUS} tiles to level 2; overlapping wells do not add more levels. Fords cross the whole river in one to three lanes and allow travel at 45% of normal speed. Forest along a viewing path reduces sight, leaving 30% of normal range in continuous woodland. Fog reveals whole map cells with soft edges and lingers briefly before fading back in. Your territory is always fully observed, including woodland. Rounded borders alternate white and faction color, expand through culture, extend across rivers, and mark where your units can heal after 15 seconds without damage. Borders appear only on discovered tiles. Each completed town produces 12 culture per minute, in addition to monuments. Each completed monument immediately claims a ${BASE_BORDER_RADIUS.monument}-tile radius and produces ${wholeNumber(MONUMENT_CULTURE_PER_SECOND * 60)} culture per minute. Population does not affect borders. Towns and houses retain their 30% border buffer. Culture expands each source’s reach at 100, 300, 600, 1000 culture and progressively higher totals. New cities inherit at most 100 culture; further border growth uses culture earned after their town is completed. Buildings claimed by your territory change allegiance, except guard posts and watch towers. Outlying farms change hands when another faction’s border reaches them; farms that still touch their owner’s territory remain theirs. Forest and jungle consume more cultural reach, following the same cost as line of sight, so borders follow the terrain. Only full factions have borders; raider camps do not. Earned culture remains after a monument is destroyed. The culture counter shows the next expansion threshold. Enclosing your town with completed walls, friendly gates, and uncrossable water gives houses inside that region 30% faster population growth, marked by green pixel glints sweeping southwest to northeast. Unguarded fords, bridges, and wall breaches break the enclosure. Level-three houses inside a secure enclosure become level four, using the chimney house and holding ten people before housing bonuses. They still need the well, nearby population, and city guard post. Losing protection starts a 60-second recovery warning before returning to level three; losing the other requirements can return them to level two. The Leader collects ordinary wilderness treasure chests for 200 gold. Enemy warriors earn 6 gold and archers earn 8 gold; marauder leaders earn 50. Start with four escorts, then gain one per 20 population through 100, one per additional 50 through 500, and one per additional 75 thereafter. Escorts belong to squads of three; surviving squads keep their shared veterancy and pass it to replacements. Only losing every member destroys a squad and its veterancy. Regular requires 10 kills, Veteran 100, Hardened 250 and Elite 500. Hardened has three close gold chevrons; Elite has a thunderbolt. Elite deals 130% more damage and takes 85% less damage after armor than an otherwise equivalent untrained unit. New and replacement escorts leave the town one at a time and travel to the Leader. Held friendly soldiers step aside for the Leader and return to their posts without changing stance. When the Leader slows or stops, escorts gather around them and engage nearby enemies according to their stance. Workers flee immediately when attacked. Clear trees sends a town peasant to chop each marked tree, leaving a stump for thirty game seconds. Farms, roads, bridges, irrigation, walls, palisades, ballistae, and new towns may be built outside your borders. Towers, guard posts, and other new buildings must fit entirely inside your own borders. Neutral-village territory remains reserved against foreign construction. A town costs ${wholeNumber(BUILD_COSTS.palace.gold)} gold, takes ${wholeNumber(CONSTRUCTION_SECONDS.palace)} seconds, and requires a clear 2×2 footprint and a builder route from an existing city. It creates a named city with borders, four town beds and four food per economy cycle so its first residents can grow before farms and houses are built. Imported residents remain assigned to that city. Fleeing Leaders seek the nearest reachable completed town. Each city selects another reachable friendly city for trade. Each city pair shares one mounted caravan traveling back and forth at 13 tiles every ten seconds before terrain modifiers. Each domestic delivery pays one gold per planned route tile, with a distance premium capped at 50%. Actual resident populations at both endpoints scale the payment with diminishing returns; cities share their trading capacity across routes. Empty endpoints earn nothing. Fractions are retained internally, and detours cannot increase a quoted delivery. Merchants lay roads along eligible travel cells, including outside borders; killing one awards 200 gold. Wild boars graze in herds of 1–8, resting for 22–38 seconds between short slow forage walks. They run when humans approach. Military units hunt within range when free of enemy combat. Each kill gives 5 food and +10% growth for 30 seconds; kills stack with independent expiry. Replacement herds appear only out of sight, at most one every 3–5 minutes. Buildings can stand directly beside walls. Manual, merchant and foot-traffic roads relocate farms to reachable free plots at no cost; roads and farms cannot share a tile. Irrigation ditches remain in place. Irrigation costs ${BUILD_COSTS.irrigation.gold} gold per tile and takes four seconds to dig after a builder arrives. New ditches must connect cardinally to a river, lake or existing irrigation ditch; continuous drags can start at either end. Completed ditches double farmland harvests on other land and triple desert harvests within three tiles; overlapping coverage does not stack. Governors compare expected harvest per crop tile, prioritizing higher-yield irrigated sites within the city’s collection radius. Automatic farms can share irrigation channels, but cannot cover roads. Green placement shading shows the benefited area. Ditches share farmland and road tiles. Ditch tiles halve movement speed off roads. Enemy units cannot attack or destroy ditches. Use Clear (C) to remove ditches and other eligible building layers in a selected area. Completed structures return no gold; unfinished friendly construction refunds its unused gold. Manual houses may stand alone or fill narrow parcels inside your borders, within ten tiles of the Leader. Builders wait for access to isolated orders. Governors preserve access and choose the nearest suitable housing cell, preferring enclosed ground. When that cell is farmland, the whole farm moves to a reachable plot farther from its town at no cost; the new home gains one permanent extra housing place. Bridges span up to two water tiles initially, or eight after Engineering, across rivers, lakes, coast, or ocean. They require clear land at both ends. Click water to preview the shortest complete crossing, or drag straight across to choose its direction. Other buildings can replace roads when the placement rules are met. Completed towns receive free roads around their perimeter wherever tiles are buildable. Nearby town and blacksmith activity panels can be opened while the build menu is active. The bottom-right action card always keeps Build (B), Fortify (F), Clear (C), and Forbid; inspecting other units or buildings does not change it. Clear cancels unfinished friendly construction with unused gold refunded and removes completed eligible structures without a refund. Recall is on slot 1 (or E); slot 2 (or Q) cycles retinue stance. Click empty ground to clear selection. All construction sites show wooden pegs and a small circular countdown for remaining work until complete; each wall section takes four seconds. Wooden towers throw javelins up to six tiles. A guard post costs 200 gold and starts with three militia, upgradeable to five for 100 gold and eight for 125 gold, stronger than ordinary marauders but weaker than regular warriors. They deploy against reachable enemies in their city’s borders or nearby threats to civilians, and can pursue an engaged enemy up to 20 tiles from their post, including beyond the border. They return home after ten seconds without a reachable threat. Their veterancy belongs to the post, and deaths reduce city population. The first 30 seconds after completion are included. Upkeep is 15 / 20 / 30 gold every 30 seconds for three / five / eight guards, including peacetime; an unpaid post recalls its militia until it can pay. Casualties are replaced at the next paid upkeep interval. The guard-post popup’s Stay inside city walls option confines that post’s guards to its city enclosure. Guards outside return home; without a complete enclosure, they stay in the post. A tower and a friendly wall can share one tile in either build order; click the upper tower or lower wall face to select each separately. Gates must remain clear of towers. Walls over roads form gates for friendly units. Placing stone walls over friendly or neutral palisades costs 25 gold per tile, crediting the palisade’s 5-gold cost. The palisade remains until the replacement finishes, and canceling refunds only the unfinished upgrade. Walls lose their owner when no completed city building remains within eight tiles; the faction with the most nearby city buildings claims them, with ties remaining neutral. Neutral gates admit everyone. Roads on existing friendly or neutral walls can create gates without adjoining roads or road-junction restrictions. Gates need one intervening wall tile. Solid 2×2 wall blocks are not allowed. Ordinary road junctions need two tiles of separation. All marauders deal 15% less damage after armor. Visible routing allies can spread panic through hostile armies during nearby fighting; steady commanders reduce that pressure. Routed marauders cannot rally for at least 15 game seconds. Raiders emerge from camps with palisade watchposts and a stone-walled refuge, with wave intervals falling from 26 to 14 seconds over fifteen game minutes. Weapon and armor strength rise linearly from 100% to 160% over the same period and then stop increasing. Raiding parties are 40% smaller for the first five minutes, gradually returning to normal sizes by minute fifteen. Waves then grow to at most 60, split into parties of at most 30 including a leader. Spawning still saturates at 90 living raiders per camp and 240 globally; survivors count toward the limits. Destroying tents reduces recruitment toward a five-raider reserve. Destroy all four inner watchtowers to stop that camp’s recruitment; a replacement camp is attempted on hidden, suitable terrain after 120 seconds. ${OPPOSING_FACTION_COUNT} rival civilizations each begin with two named cities and extra gold. Rival towns build defenses and protect their homes. When your troops destroy a rival town, choose whether to capture it immediately at 10% health and retain its city name. Units prioritize other units and buildings ahead of walls, use reachable entrances, and breach blocking wall sections only when needed to reach a city target. Raider leaders are faster and tougher than ordinary raiders. When one dies, nearby marauder soldiers within six tiles immediately lose 40 morale. A bouncing red mark warns of an imminent wave. Open Diplomacy to negotiate peace, gold, technologies, trade, military access, and defensive alliances with contacted factions. Review an offer to see their decision and reasons. Peace protects a three-minute truce. Treaty withdrawal requires thirty seconds of notice; recurring payments remain due. Confederation requires peace, trust 75, affiliation 70, and an alliance honored for three game minutes. After defeat, Respawn returns an untrained Leader to a random reachable tile within four tiles of a surviving town, with no enemies on neighboring tiles. New worlds are ${DEFAULT_WORLD_WIDTH}×${DEFAULT_WORLD_HEIGHT} tiles with varied continents, island chains, and archipelagos. Rivers and coastlines share the same water colors. White neutral villages begin with three tents and 2–5 villagers, at roughly three villages per two full factions. Click any visible village building or villager to trade for 250 gold, ally from 3000 gold, or declare war. Each ten gold the village earns from completed trade journeys with you reduces the alliance price by one, to a minimum of 500 gold; spending does not reset the discount. You can also click the main tent within three tiles. Raiders ignore independent villages; allied villages defend against raiders. Trade and alliance are separate purchases. Village caravans use a separate travel-time payout without domestic population scaling. Each village requests copper, iron, stone, salt, or olives. Developing the requested resource anywhere in your faction quadruples its village trade payout. The village popup compares expected gold per 30 seconds with and without its resource. Allies defend against your hostile factions and raiders, share twenty-tile sight, and slowly replace villagers without farming. Their identity adds one faction-wide bonus: growers +10% harvests, merchants +15% trade, builders +15% construction and repairs, or scholars +15% research. Duplicate identities do not stack; losing the main tent removes its benefits. Village caravans pay both partners. Villages spend that income on houses clustered in groups of one to three, housing upgrades through level three, and defenses, up to ten houses, twelve guards, two guard posts and four wooden towers, with no walls or Leader. Prosperous rival factions can also open a village trade route; their trade does not reduce your alliance price. Progress saves automatically.</p><p>Press Y and hover a tile to inspect its biome, soil, regional resource, and any discovery. Wetlands, tundra, and alpine ground slow travel; roads restore their usual speed. Grassland has 100% base soil fertility, plains 75%, and desert 50%. Adjacent freshwater adds 25 percentage points, falling by five points per tile to the base value. Soil fertility changes farm harvests, and irrigation and orchards retain their bonuses. Cities develop local specialties from nearby accessible clay, iron, stone, salt, and fish deposits. Completed towns cost ${wholeNumber(settlementMaintenance(2))} gold every 30 seconds, rising by a quarter for each further town, with one capital exempt; watchtowers cost 5, and libraries, monuments, ballistas and other civic buildings have their own upkeep. Each controlled stone tile reduces wall and watchtower construction and upkeep by 5%, capped at 75%; development is not required. There is no per-population maintenance. Upkeep consumes only available gold; the treasury never falls below zero and unpaid costs do not become debt. Governors reserve upkeep before ordering construction. New towns cost 100 gold. Domestic trade accrues at most 7 gold per 30 active travel seconds while either city has 20 residents or fewer, including bonuses. It reaches the full population-supported rate by 30 residents at both ends. A city shares its trade capacity among its connections. Active travel time determines the receipt, paid on arrival; parked or blocked caravans earn nothing. River travel earns 250% of the land rate. Each city pair still shares one caravan. Trade earns 5% more for each specialty found at only one end of the route, up to 25%. Select a town to inspect its specialties and trade bonus. Most wilderness chests contain 200 gold; rare named discoveries have individual rewards. Boars prefer productive woodland and freshwater habitats. Marsh birds spawn in coastal wetlands, move equally across land and water, and yield 20 food per hunted bird.</p>`);
}
function showDiplomacy(id?: number, draft?: DiplomacyTerms, message = '') {
  const faction = state.factions.find(candidate => candidate.id === id);
  if (faction?.villageId !== undefined) {
    const camp = state.villages?.find(village => village.id === faction.villageId)?.campId;
    if (camp !== undefined) showVillageDiplomacy(faction.id, camp);
    return;
  }
  if (state.multiplayer) return;
  refreshDiplomacy(state);
  openDialog(factionDiplomacyMarkup(state, id, draft, message));
  bindFactionDiplomacy($('#dialog-body'), state, showDiplomacy, target => diplomacyAction(state, target, 'confederate'), () => { save(); updateUI(); });
}
function showVillageDiplomacy(factionId: number, entityId: number) {
  const village = state.villages?.find(candidate => candidate.faction === factionId);
  const camp = village && villageCamp(state, village);
  const status = camp && villageDiplomacyStatus(state, camp, true);
  if (!status) return;
  state.selected = entityId; state.selectedType = state.units.some(unit => unit.id === entityId) ? 'unit' : 'building'; state.diplomacy = factionId;
  openDialog(villageDiplomacyMarkup(state, status, playerFaction(state), true));
  queueVillageTradeRefresh();
  $('#cancel-war').onclick = closeDialog;
  for (const action of villageDiplomacyActions(status)) $(`#village-${action}`).onclick = () => {
    if (sendCommand({ type: 'diplomacy', faction: factionId, action, buildingId: entityId })) { closeDialog(); return; }
    const result = diplomacyAction(state, factionId, action, entityId);
    if (result.ok) { closeDialog(); save(); updateUI(); }
    else if (action === 'confederate') { showVillageDiplomacy(factionId, entityId); $('#war-result').textContent = result.message; }
    else $('#war-result').textContent = result.message;
  };
}
function showDeclareWar(factionId: number, buildingId: number) {
  const faction = state.factions.find(candidate => candidate.id === factionId);
  if (!faction) return;
  if (faction.villageId !== undefined) { showVillageDiplomacy(factionId, buildingId); return; }
  state.selected = buildingId; state.selectedType = 'building'; state.diplomacy = factionId;
  showDiplomacy(factionId);
}
function clearPlacement() {
  endOffensivePlacement(true);
  clearInput(); cancelStroke(); buildError = ''; linearPurchaseNotice = '';
  areaTool = null; state.buildMode = null;
  syncPlacementIntent();
}
function selectBuild(kind: BuildSelection | null) {
  if (kind && isSiteBuilding(kind)) return;
  if (kind === 'observationPost' && !hasObservationLodge(state, playerFaction(state))) { buildError = 'Build a Scouts’ Lodge first'; updateUI(); return; }
  if (kind && kind !== 'clearTrees' && !isBuildingUnlocked(state.factions.find(faction => faction.id === playerFaction(state))!, buildingKindForSelection(kind))) {
    const requirement = buildingResearchRequirement(buildingKindForSelection(kind));
    buildError = `Research ${RESEARCH_BRANCHES.find(branch => branch.id === requirement)?.label ?? 'the required technology'} first`;
    updateUI();
    return;
  }
  buildingActivity.close(); resourceActivity.close();
  leaderProgression.close();
  clearPlacement();
  buildMenu = kind && !matchMedia('(pointer: coarse)').matches ? buildMenuForSelection(kind) : null;
  state.buildMode = kind;
  syncPlacementIntent();
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
  // Keep the validator's building name, price, distance and remedy intact.
  return message.trim().replace(/\.$/, '') || 'Placement failed. Select the building again and retry';
}
/** Input handlers and popups request a HUD refresh; the next animation frame
 * renders it once. A click that places, selects and closes a dialog used to
 * rebuild the HUD two or three times before the browser could paint. */
let uiRequested = true;
function updateUI() { uiRequested = true; }
  $('#diplomacy-menu').hidden = !!state.multiplayer;
  const incomingDeals = state.diplomacyState?.offers.filter(o => o.to === playerFaction(state)).length ?? 0;
  $('#diplomacy-menu').textContent = incomingDeals ? `Diplomacy (${incomingDeals})` : 'Diplomacy';
function renderUI() {
  uiRequested = false;
  // Direct actions refresh immediately and restart the periodic HUD deadline.
  lastUI = performance.now();
  refreshVillageTradeDialog();
  refreshQuestDialog($('#dialog-body'),state);
  refreshSiteDialog();
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
  const culture = Math.max(0, faction.culture ?? 0), cultureRate = culturePerSecond(state, faction.id), threshold = nextCultureThreshold(lifetimeCulture(faction));
  const cultureTotal = String(Math.floor(culture)), cultureChange = `(${signed(changes.culture)})`;
  $('#culture').textContent = cultureTotal;
  $('#culture-next').textContent = '';
  $('#culture-rate').textContent = cultureChange;
  $('#culture-rate').classList.toggle('negative', Math.round(changes.culture) < 0);
  $('.resource.culture').title = `Culture · ${signed(changes.culture)} income over ${changeWindow} · Production ${Math.round(cultureRate * 60)} per minute · Border expansion ${cultureLevel(lifetimeCulture(faction))} · Next expansion at ${threshold} lifetime culture · Spent ${Math.floor(faction.cultureSpent ?? 0)} culture · Each city produces ${Math.round(SETTLEMENT_CULTURE_PER_SECOND * 60)} per minute; each monument produces ${Math.round(MONUMENT_CULTURE_PER_SECOND * 60)}`;
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
  $('#speed').setAttribute('aria-label', `Simulation speed ${speedLabel}. Click for ${GAME_SPEEDS[(speedIndex() + 1) % GAME_SPEEDS.length]}×`);
  $('#speed').title = 'Simulation speed · = faster · - slower · 1× to 8×';
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
    ? `${selection.showHealth ? `<span><span class="stat-label">HP</span> ${wholeNumber(hp)} / ${wholeNumber(maxHp)}</span>` : ''}${selection.showCombatStats ? `<span><span class="stat-label">Attack</span> ${wholeNumber(selection.attack)}</span><span><span class="stat-label">Defense</span> ${wholeNumber(selection.defense)}</span>` : ''}` : '';
  $('#selection-health').style.width = `${Math.max(0, Math.min(100, health))}%`;
  const healthTrack = $('.health-track');
  healthTrack.hidden = !selection?.showHealth;
  healthTrack.setAttribute('aria-valuemin', '0');
  healthTrack.setAttribute('aria-valuemax', wholeNumber(maxHp));
  healthTrack.setAttribute('aria-valuenow', wholeNumber(hp));
  const portraitKey = selection ? `${selection.picture}:${selection.factionColor}:${selection.houseTier}:${selection.armorLevel}` : '';
  if ($('#portrait').dataset.picture !== portraitKey) {
    $('#portrait').innerHTML = selection ? icon(selection.picture, selection.factionColor, selection.houseTier, selection.armorLevel) : '';
    $('#portrait').dataset.picture = portraitKey;
  }
  $('#build-panel').hidden = buildMenu === null;
  // This is the Leader's command card, independent of the inspection selection.
  // Keep the controls in place even when the Leader is temporarily unavailable.
  const canAct = !state.gameOver && !!leader && leader.hp > 0 && !leader.inside;
  const inspectedShip = state.selectedType === 'unit' ? state.units.find(u => u.id === state.selected && u.faction === faction.id && u.warship && u.hp > 0) : undefined;
  const navalShip = boardedBoat(state) ?? inspectedShip;
  document.querySelectorAll<HTMLButtonElement>('[data-naval-action]').forEach(button => {
    const action = button.dataset.navalAction as 'anchor' | 'land' | 'reinforce';
    const available = !!navalShip?.warship && warshipActionAvailable(state, navalShip, action);
    button.hidden = !navalShip?.warship || action === 'anchor' && !available;
    button.disabled = state.gameOver || !available || (action !== 'reinforce' && navalShip?.sailboat?.passenger !== leader?.id);
    if (action === 'anchor') button.querySelector<HTMLElement>('.hotbar-label')!.textContent = navalShip?.warship?.anchored ? 'Raise anchor' : 'Cast anchor';
  });
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
  levyButton.title = actionTooltip(dismissing ? 'Returns drafted troops to civilian work.' : 'Drafts available citizens into your army.',
    dismissing ? 0 : '15 gold / citizen', 30, `${levy.cooldown > 0 ? `Ready in ${Math.ceil(levy.cooldown)}s. ` : ''}${dismissing ? '' : levy.reason || 'Upkeep: 5 gold / soldier every 30s.'}`);
  const garrison = garrisonStatus(state), garrisonButton = $<HTMLButtonElement>('[data-hotbar-action="garrison"]');
  const garrisonLabel = garrison.active ? 'Recall Garrison' : 'Garrison';
  garrisonButton.disabled = !garrison.enabled;
  garrisonButton.querySelector<HTMLElement>('.hotbar-label')!.textContent = garrisonLabel;
  garrisonButton.setAttribute('aria-label', garrisonLabel); garrisonButton.setAttribute('aria-pressed', String(garrison.active));
  garrisonButton.title = actionTooltip(garrison.active ? 'Recalls the city garrison to follow the Leader.' : 'Assigns your retinue to defend the current city.', 0, 0, garrison.reason);
  for (const [button, picture] of [[levyButton, 'levy'], [garrisonButton, 'garrison']] as const) {
    const art = button.querySelector<HTMLElement>('.hotbar-art')!, markup = icon(picture, faction.color);
    if (art.dataset.markup !== markup) { art.innerHTML = markup; art.dataset.markup = markup; }
  }
  const { stance, nextStance } = retinueCommand(state);
  const formation = infantryFormationControl(state);
  const formationButton = $<HTMLButtonElement>('[data-hotbar-action="formation"]');
  formationButton.disabled = !formation.enabled;
  formationButton.title = actionTooltip(formation.active ? 'Releases troops from formation.' : 'Forms close ranks with +25% frontal attack and +50% frontal defense.', 0, 0, formation.reason);
  formationButton.setAttribute('aria-label', `Formation. ${formation.title}`);
  formationButton.setAttribute('aria-pressed', String(formation.active));
  formationButton.classList.toggle('research-locked', !formation.unlocked);
  formationButton.querySelector<SVGElement>('.hotbar-lock')!.toggleAttribute('hidden', formation.unlocked);
  updateOffensiveButton($<HTMLButtonElement>('[data-hotbar-action="offensive"]'), state, !!offensivePlacement);
  const recallButton = $('[data-hotbar-action="recall"]');
  const steering = formation.active || !!boardedBoat(state);
  recallButton.title = actionTooltip('Calls your retinue back to the Leader without changing stance.', 0, 1);
  recallButton.setAttribute('aria-keyshortcuts', steering ? '1' : '1 E');
  const stanceButton = $('[data-hotbar-action="stance"]');
  stanceButton.title = actionTooltip('Changes how the retinue engages enemies.', 0, 0, `Current: ${stance} · Next: ${nextStance}`);
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

    const requirement = kind === 'clearTrees' ? undefined : buildingResearchRequirement(buildingKindForSelection(kind));
    const researchLabel = RESEARCH_BRANCHES.find(branch => branch.id === requirement)?.label;
    const researchHint = researchLocked ? `Research ${researchLabel ?? 'this building'} at a library to unlock.` : '';
    const town = kind === 'palace' && !button.hidden ? townBuildTerms(state, faction) : undefined;
    const baseTitle = kind === 'clearTrees' ? actionTooltip('Orders civilians to clear vegetation.')
      : buildTooltip(kind, buildCostAt(state, kind, 0, 0).gold, CONSTRUCTION_SECONDS[buildingKindForSelection(kind)],
        stoneDefenseMultiplier(state, playerFaction(state), buildingKindForSelection(kind)), town);
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
  updateBuildStatus(faction);
  if (renderer.showYields && renderer.hover && !state.buildMode && isVisible(state, renderer.hover.x, renderer.hover.y)) {
    const x = Math.floor(renderer.hover.x), y = Math.floor(renderer.hover.y), t = state.world.tiles[y * state.world.width + x];
    if (t && x >= 0 && y >= 0 && x < state.world.width && y < state.world.height) {
      $('#tile-tooltip').hidden = false;
      const field = state.fields?.find(field => field.x === x && field.y === y);
      const water = WATER.has(t.terrain);
      const biome = t.geothermal ? t.geothermal <= 3 ? 'Volcano' : 'Hot mud pool'
        : !water && t.hillBiome ? HILL_BIOME_NAMES[t.hillBiome]
        : !water && t.biome ? BIOME_NAMES[t.biome] : capitalize(t.terrain);
      const ground = `${biome}${t.landform && !water ? ` · ${LANDFORM_NAMES[t.landform]}` : ''}${t.overlay === 'forest' ? ' · Woodland' : t.overlay === 'ford' ? ' · Ford' : ''}${t.resource ? ` · ${RESOURCE_NAMES[t.resource]}` : ''}`;
      const soil = water || t.geothermal ? '' : ` · Soil fertility ${multiplierPercent(soilFertility(state.world, x, y))}`;
      const speed = groundMovementMultiplier(t);
      const travel = speed < 1 && (!water || t.overlay === 'ford') ? ` · Ground speed ${Math.round(speed * 100)}%` : '';
      const discovery = state.treasures?.find(chest => chest.x === x && chest.y === y && !chest.collected);
      const site = discovery?.name ? ` · ${escape(discovery.name)} (${wholeNumber(discovery.rewardGold ?? 200)} gold)` : '';
      const irrigation = irrigationYieldMultiplier(state, x, y);
      $('#tile-tooltip').innerHTML = field ? `${field.planted ? 'Planted field' : 'Fallow field'} · ${ground}${soil}${irrigation > 1 ? ` · Irrigated (${wholeNumber(irrigation)}× yield)` : ''}<span>${icon('food')} ${wholeNumber(field.food)} stored · ${wholeNumber(fieldHarvestFoodForState(state, x, y))} / harvest</span>` : `${ground}${soil}${travel}${site}`;
    } else $('#tile-tooltip').hidden = true;
  } else $('#tile-tooltip').hidden = true;
  actionTooltips.sync();
}

/** Pointer feedback has its own small update; the regular HUD keeps its clock. */
function updateBuildStatus(faction = state.factions.find(owner => owner.id === playerFaction(state))!) {
  pointerStatusDirty = false;
  const status = $('#build-status');
  if (!state.buildMode) { status.textContent = ''; status.classList.remove('invalid'); }
  if (areaTool) status.textContent = buildError || (areaTool === 'forbid'
    ? areaStroke?.erase ? 'Drag to allow this area again' : 'Drag to forbid · Start inside a zone to erase'
    : 'Drag to clear trees, buildings and construction · Unused construction gold refunded');

  if (state.buildMode) {
    const preview = renderer.buildPreview.length ? renderer.buildPreview
      : renderer.hover ? [{ x: Math.floor(renderer.hover.x), y: Math.floor(renderer.hover.y) }] : [];
    const shared = renderer.constructionGesture;
    const gesturePreview = shared?.state === state && shared.world === state.world && shared.kind === state.buildMode && shared.points === renderer.buildPreview ? shared : undefined;
    const plan = gesturePreview?.plan ?? previewConstructionPlan(state, state.buildMode, preview);
    if (stroke) buildError = plan.ok ? '' : shortBuildError(plan.message);
    const count = preview.length ? plan.tiles.length : 1;
    const gold = preview.length ? plan.costs.gold : state.buildMode === 'clearTrees' ? 0 : buildCostAt(state, state.buildMode, 0, 0).gold;
    const requested = gesturePreview?.requestedTiles ?? count;
    const area = state.buildMode === 'shipyard' ? count * 9 : state.buildMode === 'palace' ? count * 4 : count;
    const countText = requested > count ? `${count} of ${requested}` : String(area);
    const shortfall = Math.max(0, (gesturePreview?.requestedCost ?? gold) - faction.gold);
    const benefit = state.buildMode === 'irrigation' ? ` · Farmland yield: 2× on other land, 3× on desert within ${IRRIGATION_RADIUS} tiles`
      : state.buildMode === 'well' ? ` · Level 2 homes within ${WELL_RADIUS} tiles`
      : state.buildMode === 'monument' ? ` · Claims a ${BASE_BORDER_RADIUS.monument}-tile radius · +${wholeNumber(MONUMENT_CULTURE_PER_SECOND * 60)} culture/min`
      : state.buildMode === 'guardPost' ? ` · ${GUARD_POST_CAPACITY} militia · ${GUARD_POST_UPKEEP} gold/${GUARD_POST_UPKEEP_INTERVAL}s upkeep`
      : state.buildMode === 'woodenTower' ? ` · ${WATCHTOWER_MAINTENANCE} gold/${ECONOMY_INTERVAL}s upkeep`
      : state.buildMode === 'palace' ? ` · ${townBuildDetails(townBuildTerms(state, faction))}` : '';
    const upkeepNote = BUILDING_UPKEEP[state.buildMode as keyof typeof BUILDING_UPKEEP];
    const upkeepText = upkeepNote ? ` · ${upkeepNote} gold/${ECONOMY_INTERVAL}s upkeep${['bridge', 'irrigation'].includes(state.buildMode) ? ' per tile' : ''}` : '';
    const requirement = state.buildMode === 'well' && faction.population < WELL_POPULATION_REQUIREMENT
      ? `Wells require ${WELL_POPULATION_REQUIREMENT} population` : '';
    const warning = gesturePreview?.message || (plan.skipped ? plan.message : '');
    const details = shortfall > 0 ? ` · Need ${wholeNumber(Math.ceil(shortfall))} more gold`
      : warning ? ` · ${shortBuildError(warning)}` : '';
    status.textContent = requirement || `${isLinearPlacement(state.buildMode) ? stroke ? 'Choose end · ' : 'Choose start · ' : ''}${countText} tile${requested === 1 ? '' : 's'} · ${wholeNumber(gold)} gold${details}${benefit}${upkeepText}`;
    if (buildError && !stroke) status.textContent = buildError;
    if (!gesturePreview && !plan.ok && preview.length) status.textContent = shortBuildError(plan.message);
    status.classList.toggle('invalid', !!requirement || !plan.ok || !!warning || shortfall > 0);
  }
  const job = linearPurchases[0];
  if (job) {
    const progress = `Ordering ${job.kind === 'road' ? 'roads' : 'ditches'} ${job.purchase.total - job.purchase.remaining.length}/${job.purchase.total} · Esc cancels remaining`;
    status.textContent = stroke ? `${status.textContent} · ${progress}` : progress;
  } else if (!stroke && !areaStroke && linearPurchaseNotice) {
    status.textContent = linearPurchaseNotice;
    status.classList.toggle('invalid', /skipped/.test(linearPurchaseNotice));
  }
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

function endOffensivePlacement(restoreCamera: boolean): void {
  const placement = offensivePlacement;
  if (!placement) return;
  offensivePlacement = undefined;
  renderer.offensivePreview = undefined;
  offensivePlacementPanel.hidden = true;
  $('.game-area').classList.remove('placing-offensive');
  if (placement.state === state && !state.multiplayer) state.paused = placement.paused;
  if (restoreCamera) { renderer.zoom = placement.zoom; renderer.follow = placement.follow; }
}
function performOffensiveAction(): void {
  if (offensivePlacement) { endOffensivePlacement(true); updateUI(); return; }
  const control = offensiveControl(state);
  if (control.active) {
    if (!sendCommand({ type: 'cancel-offensive' })) cancelOffensive(state);
    updateUI(); save(); return;
  }
  if (!control.enabled) { showCommandError(control.reason); return; }
  clearPlacement(); buildingActivity.close(); resourceActivity.close(); leaderProgression.close();
  buildMenu = null;
  offensivePlacement = { state, zoom: renderer.zoom, follow: renderer.follow, paused: state.paused };
  if (!state.multiplayer) state.paused = true;
  renderer.zoom = MIN_ZOOM; renderer.follow = false;
  renderer.offensivePreview = {};
  offensivePlacementPanel.querySelector('strong')!.textContent = 'Rally flag';
  offensivePlacementPanel.hidden = false;
  $('.game-area').classList.add('placing-offensive');
  updateUI();
}
function placeOffensiveFlag(point: Point): boolean {
  if (!offensivePlacement) return false;
  if (offensivePlacement.state !== state) { endOffensivePlacement(true); return true; }
  if (point.x < 0 || point.y < 0 || point.x >= state.world.width || point.y >= state.world.height) return true;
  const flag = { x: Math.floor(point.x) + .5, y: Math.floor(point.y) + .5 };
  if (!offensivePlacement.rally) {
    if (!canWalk(state, flag.x, flag.y, playerFaction(state))) { showCommandError('Place the Rally flag on open ground.'); return true; }
    offensivePlacement.rally = flag;
    renderer.offensivePreview = { rally: flag };
    offensivePlacementPanel.querySelector('strong')!.textContent = 'Objective flag';
    return true;
  }
  const rally = offensivePlacement.rally;
  if (!sendCommand({ type: 'offensive', rally, objective: flag })) {
    const result = beginOffensive(state, rally, flag);
    if (!result.ok) { showCommandError(result.message ?? 'Offensive unavailable.'); return true; }
  }
  endOffensivePlacement(false); updateUI(); save();
  return true;
}
$('[data-hotbar-action="offensive"]').onclick = () => { performOffensiveAction(); canvas.focus({ preventScroll: true }); };

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
function performNavalAction(action: 'anchor' | 'land' | 'reinforce'): void {
  const ship = boardedBoat(state) ?? (state.selectedType === 'unit' ? state.units.find(u => u.id === state.selected && u.warship) : undefined);
  if (!ship?.warship) return;
  if (!sendCommand({ type: 'warship', shipId: ship.id, action })) {
    const result = warshipAction(state, ship, action); if (!result.ok) showCommandError(result.message); else { logEvent(state, result.message, 'good'); save(); }
  }
  updateUI(); canvas.focus({ preventScroll: true });
}
document.querySelectorAll<HTMLButtonElement>('[data-naval-action]').forEach(button => button.onclick = () => performNavalAction(button.dataset.navalAction as 'anchor' | 'land' | 'reinforce'));


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
$('#speed').onclick = () => { if (state.multiplayer) return; state.speed = GAME_SPEEDS[(speedIndex() + 1) % GAME_SPEEDS.length]; updateUI(); save(); };
$('#menu').onclick = showMenu;
$('#diplomacy-menu').onclick = () => showDiplomacy();
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
  else state.speed = GAME_SPEEDS[Math.max(0, Math.min(GAME_SPEEDS.length - 1, speedIndex() + (e.key === '-' ? -1 : 1)))];
  updateUI(); save();
}, { capture: true });
window.addEventListener('keydown', e => {
  if (frontend.active || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'escape') {
    if (offensivePlacement) endOffensivePlacement(true);
    else if (!$('#dialog').hidden) closeDialog();
    else if (leaderProgression.isOpen) leaderProgression.close(true);
    else if (resourceActivity.isOpen) { resourceActivity.close(); canvas.focus({ preventScroll: true }); }
    else if (buildingActivity.isOpen) { buildingActivity.close(); canvas.focus({ preventScroll: true }); }
    else if (stroke || areaStroke) cancelStroke();
    else if (linearPurchases.length) cancelLinearPurchases();
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
  if (key === '9') { e.preventDefault(); if (!e.repeat) performOffensiveAction(); return; }
  if (offensivePlacement) return;
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
  if (['6', '7', '8'].includes(key)) { e.preventDefault(); performNavalAction((['anchor', 'land', 'reinforce'] as const)[Number(key) - 6]); return; }
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
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); cancelStroke(); clearPointer(); void saveNow(); } });
window.addEventListener('beforeunload', () => {
  if (state.multiplayer || !sessionStarted || loadingSavedGame || pendingSaves) return;
  // Unload cannot wait for cooperative tasks. Retain the synchronous best-
  // effort final checkpoint; ordinary play and explicit saves use short tasks.
  try {
    const paused = frontend.active ? pauseBeforeFrontend : $('#dialog').hidden ? state.paused : pauseBeforeDialog;
    void writeStoredGame(serializeGameSave(state, paused), savedGameDetails(state)).catch(() => {});
  } catch { /* The last committed autosave remains available. */ }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
function syncPendingConstruction() {
  renderer.pendingConstruction = linearPurchases.map(({ kind, purchase }) => ({ kind, points: purchase.remaining }));
}
function discardLinearPurchases() {
  for (const { purchase } of linearPurchases) purchase.finish();
  linearPurchases.length = 0; linearPurchaseState = undefined; linearPurchasesChanged = false;
  linearWorkSkippedFrames = 0; linearCleanupDue = false; renderer.pendingConstruction = [];
}
function cancelLinearPurchases() {
  let placed = 0, cancelled = 0;
  for (const { purchase } of linearPurchases) {
    cancelled += purchase.remaining.length;
    const result = purchase.finish(); placed += result.placed;
    linearPurchasesCompleted++; linearPurchaseLastResult = result;
  }
  linearPurchases.length = 0; renderer.pendingConstruction = [];
  // Accepted cells retain their payment and pending reconciliation. The frame
  // pump finishes staffing and saving even when gameplay is paused.
  linearCleanupDue = true;
  linearPurchaseNotice = `${cancelled} remaining tile${cancelled === 1 ? '' : 's'} cancelled${placed ? ` · ${placed} ordered` : ''}`;
  updateBuildStatus();
}
function advanceLinearPurchases(frameStarted: number, frameTimestamp: number) {
  if (state.multiplayer || linearPurchaseState && linearPurchaseState !== state) { discardLinearPurchases(); return; }
  if (!linearPurchaseState && !constructionReconciliationPending(state)) return;
  if (linearPurchases[0] && frameTimestamp <= linearPurchases[0].queuedAt) return;
  // Share the frame with simulation, while guaranteeing paused and busy-world
  // progress. Each purchase and cleanup phase owns a separate turn.
  if (performance.now() - frameStarted >= 12 && linearWorkSkippedFrames < 4) { linearWorkSkippedFrames++; return; }
  linearWorkSkippedFrames = 0;
  const started = performance.now();
  try {
    // Ordinary building orders and governors share this housekeeping queue.
    // They must finish even while paused and without an active drag stroke.
    if (!linearPurchaseState) { advanceConstructionReconciliation(state); return; }
    // Finish cleanup between strokes; a continuous stream of new orders must
    // not starve staffing while paused.
    if (linearCleanupDue) {
      if (advanceConstructionReconciliation(state)) return;
      linearCleanupDue = false;
    }
    const job = linearPurchases[0];
    if (job) {
      const previousPlaced = job.purchase.result.placed, result = job.purchase.step(state);
      linearPurchasesChanged ||= result.placed > previousPlaced;
      syncPendingConstruction();
      if (result.done) {
        linearPurchases.shift(); linearPurchasesCompleted++; linearPurchaseLastResult = result;
        linearCleanupDue = true; syncPendingConstruction();
        linearPurchaseNotice = `${result.placed} ${job.kind === 'road' ? 'road' : 'ditch'} tile${result.placed === 1 ? '' : 's'} ordered`
          + (result.skipped ? ` · ${result.skipped} skipped: ${shortBuildError(result.message)}` : '');
        constructionGesture.clear();
      }
      updateBuildStatus();
      return;
    }
    const changed = linearPurchasesChanged;
    discardLinearPurchases();
    if (changed) save();
    updateUI();
  } finally { linearWorkMs = performance.now() - started; linearWorkSerial++; }
}
function commitStroke() {
  if (!stroke) return;
  if (!state.multiplayer && (stroke.kind === 'road' || stroke.kind === 'irrigation')) {
    const end = pointer ? renderer.worldPoint(pointer.x, pointer.y) : renderer.hover;
    if (!end) { cancelStroke(); return; }
    // Flush the latest endpoint once. Geometry is advisory; each scheduled
    // purchase checks its current connection, access, payment and farm move.
    const preview = constructionGesture.read(state, stroke.kind, stroke.start, end, performance.now(), true);
    if (linearPurchaseState !== state) discardLinearPurchases();
    linearPurchaseState = state;
    const purchase = createLinearPurchase(state, stroke.kind, preview.points);
    // Accept the first tile in the input event, including while paused. The
    // bounded frame pump purchases the rest of a drag and handles staffing.
    const first = purchase.step(state);
    linearPurchasesChanged ||= first.placed > 0;
    linearPurchases.push({ kind: stroke.kind, purchase, queuedAt: performance.now() });
    syncPendingConstruction();
    cancelStroke(); buildError = ''; linearPurchaseNotice = ''; updateUI(); return;
  }
  refreshWorldPointer(true);
  if (sendCommand({ type: 'build', kind: stroke.kind, points: renderer.buildPreview })) { cancelStroke(); updateUI(); return; }
  const result = buildStroke(state, stroke.kind, renderer.buildPreview);
  cancelStroke(); buildError = result.ok ? result.skipped ? `${result.placed} ordered · ${result.skipped} skipped: ${shortBuildError(result.message)}` : '' : shortBuildError(result.message);
  if (result.placed) save();
  updateUI();
}
function showHermitReply(message: string) {
  openDialog('<h2 id="dialog-title">The hermit speaks</h2><p id="hermit-answer"></p>');
  $('#hermit-answer').textContent = message;
}
function openQuestAt(point:Point):boolean {
  const quest=questGiverAt(state,point);if(!quest)return false;
  clearInput();clearPlacement();openDialog(questMarkup(quest));
  const button=$<HTMLButtonElement>('[data-quest-action]');
  button.onclick=()=>{
    const action=button.dataset.questAction as 'accept'|'complete';
    if(sendCommand({type:'quest',kind:quest.kind,action})){button.dataset.pending='true';button.disabled=true;return;}
    const result=performQuestAction(state,quest.kind,action);
    if(result.ok){closeDialog();save();updateUI();}else $('[data-quest-error]').textContent=result.message;
  };
  $('#quest-close').onclick=closeDialog;
  const target=document.querySelector<HTMLButtonElement>('#quest-target');
  if(target)target.onclick=()=>{closeDialog();renderer.camera={x:quest.x,y:quest.y};renderer.follow=false;};
  const diplomacy=document.querySelector<HTMLButtonElement>('#quest-diplomacy');
  if(diplomacy)diplomacy.onclick=()=>{const village=state.villages?.find(v=>v.id===quest.village);if(village)showVillageDiplomacy(village.faction,village.campId);};
  const information=document.querySelector<HTMLButtonElement>('#quest-information');
  if(information)information.onclick=()=>{const hermit=state.hermits?.find(h=>h.id===quest.giver);if(hermit)openHermitAt(hermitPosition(hermit));};
  return true;
}
const dismissedRuins = new Set<number>();
function openRuinsDialog(site: ExplorationSite): void {
  openDialog(explorationDialogMarkup(site));
  dismissDialog = () => { dismissedRuins.add(site.id); };
  const choose = (accept: boolean) => {
    if (sendCommand({ type: 'exploration-choice', siteId: site.id, accept })) { closeDialog(); return; }
    const result = resolveExploration(state, site.id, accept ? 1 : -1);
    if (result.ok) { closeDialog(); save(); updateUI(); }
    else $('#ruins-error').textContent = result.message;
  };
  $('#ruins-accept').onclick = () => choose(true);
  $('#ruins-decline').onclick = () => choose(false);
}
function offerRuinsDiscovery(): void {
  if (frontend.active || state.gameOver || !$('#dialog').hidden) return;
  const leader = state.units.find(u => u.kind === 'leader' && u.faction === playerFaction(state) && u.hp > 0);
  for (const site of state.explorationSites ?? []) if (dismissedRuins.has(site.id) && (!leader || leader.x < site.x - 1 || leader.x > site.x + 3 || leader.y < site.y - 1 || leader.y > site.y + 3)) dismissedRuins.delete(site.id);
  const site = state.explorationSites?.find(s => s.status === 1 && s.outcome === 2 && s.actor === playerFaction(state) && !dismissedRuins.has(s.id));
  if (site) openRuinsDialog(site);
}
const siteVisits = new SiteVisits();
let nextSiteDialogRefreshAt = 0;
function openSiteDialog(site: SiteView): void {
  siteVisits.observe(state.world, siteViews(state));
  siteVisits.dismiss(site);
  clearInput(); clearPlacement();
  openDialog(siteDialogMarkup(site));
  nextSiteDialogRefreshAt = 0;
  refreshSiteDialog();
  $('#site-later').onclick = closeDialog;
  $('#site-build').onclick = () => {
    const button = $<HTMLButtonElement>('#site-build');
    if (sendCommand({ type: 'build-site', siteId: site.id })) {
      button.dataset.pending = 'true'; button.disabled = true; return;
    }
    const result = buildSite(state, site.id);
    if (result.ok) { closeDialog(); save(); updateUI(); }
    else { $('#site-error').textContent = result.message; nextSiteDialogRefreshAt = 0; }
  };
}
function refreshSiteDialog(now = performance.now()): void {
  const dialog = document.querySelector<HTMLElement>('.site-dialog');
  if (!dialog || $('#dialog').hidden || now < nextSiteDialogRefreshAt) return;
  nextSiteDialogRefreshAt = now + 500;
  const site = siteViews(state, now).find(site => site.id === Number(dialog.dataset.siteId));
  if (!site?.near || !site.available || !pointInSight(presentationFog(state), site.x + 1, site.y + 1)) { closeDialog(); return; }
  const button = $<HTMLButtonElement>('#site-build');
  if (button.dataset.pending) return;
  const quote = quoteSite(state, site.id);
  button.disabled = !quote.ok; $('#site-error').textContent = quote.ok ? '' : quote.message;
}
function openSiteAt(point: Point): boolean {
  const sites = siteViews(state); siteVisits.observe(state.world, sites);
  const site = sites.find(site => site.available && site.near && point.x >= site.x && point.x < site.x + site.width && point.y >= site.y && point.y < site.y + site.height);
  if (!site || !pointInSight(presentationFog(state), site.x + 1, site.y + 1)) return false;
  openSiteDialog(site); return true;
}
function offerNearbySite(now: number): void {
  if (frontend.active || !sessionStarted || state.gameOver) return;
  const sites = siteViews(state, now); siteVisits.observe(state.world, sites);
  if (!$('#dialog').hidden || buildMenu || state.buildMode || areaTool || stroke || buildingActivity.isOpen || resourceActivity.isOpen) return;
  const fog = presentationFog(state);
  const site = sites.find(site => siteVisits.offer(site) && pointInSight(fog, site.x + 1, site.y + 1));
  if (site) openSiteDialog(site);
}
function openHermitAt(point: Point): boolean {
  const ruins = state.explorationSites?.find(s => s.status === 1 && s.outcome === 2 && s.actor === playerFaction(state)
    && point.x >= s.x && point.x < s.x + 2 && point.y >= s.y && point.y < s.y + 2);
  if (ruins) { openRuinsDialog(ruins); return true; }
  const hermit = hermitAt(state, point); if (!hermit) return false;
  clearInput(); clearPlacement();
  openDialog(`<h2 id="dialog-title">Hermit</h2><div class="dialog-actions"><button id="ask-hermit">Ask for information <span class="upgrade-price">25${icon('gold')}</span></button></div><p id="hermit-error" role="status"></p>`);
  $('#ask-hermit').onclick = () => {
    if (sendCommand({ type: 'hermit', hermitId: hermit.id })) { ($('#ask-hermit') as HTMLButtonElement).disabled = true; return; }
    const result = askHermit(state, hermit.id);
    if (result.ok) { save(); updateUI(); showHermitReply(result.message); }
    else $('#hermit-error').textContent = result.message;
  };
  return true;
}
function commandWorldPoint(point: Point) {
  if (placeOffensiveFlag(point)) return;
  if (!state.buildMode && !areaTool && openSiteAt(point)) return;
  if (openQuestAt(point)) return;
  if (openHermitAt(point)) return;
  clearInput();
  const villageTarget = neutralVillageEntityAt(state, point);
  if (villageTarget) { clearPlacement(); showVillageDiplomacy(villageTarget.faction, villageTarget.id); updateUI(); return; }
  const diplomaticTarget = warDeclarationTargetAt(state, point.x, point.y);
  if (diplomaticTarget) { clearPlacement(); showDeclareWar(diplomaticTarget.faction, diplomaticTarget.id); updateUI(); return; }
  selectBuild(null);
  if (state.multiplayer) {
    const target = unitAtPoint(state, point) ?? buildingAtPoint(state, point);
    const ship = state.selectedType === 'unit' ? state.units.find(u => u.id === state.selected && u.warship && u.faction === playerFaction(state)) : undefined;
    const cannon = state.selectedType === 'unit' ? state.units.find(u => u.id === state.selected && u.kind === 'fieldCannon' && u.faction === playerFaction(state)) : undefined;
    const command: GameCommand = ship && target && !('capacity' in target) && atWar(state,ship.faction,target.faction)
      ? {type:'warship-attack',shipId:ship.id,targetId:target.id}
      : cannon && !(target && atWar(state, cannon.faction, target.faction)) ? { type: 'field-cannon-move', unitId: cannon.id, x: point.x, y: point.y } : ship && target?.id !== ship.id && getLeader(state)?.embarkedOn !== ship.id
      ? { type: 'warship-move', shipId: ship.id, x: point.x, y: point.y } : { type: 'interact', x: point.x, y: point.y };
    if (sendCommand(command))
      renderer.showMoveMarker(point, !!target && atWar(state, playerFaction(state), target.faction));
  } else if (commandAttackAt(state, point.x, point.y)) renderer.showMoveMarker(point, true);
  else if (commandMove(state, point.x, point.y)) {
    const selected = state.selectedType === 'unit' && state.selected !== null ? entityStore(state).units.get(state.selected) : undefined;
    const ship = boardedBoat(state) ?? selected;
    renderer.showMoveMarker(ship?.warship && ship.destination ? ship.destination : point);
  }
  updateUI();
}
function primaryWorldPoint(point: Point, pointerId: number, touch: boolean) {
  canvas.focus({ preventScroll: true });
  if (placeOffensiveFlag(point)) return;
  if (stroke?.twoClick) { commitStroke(); return; }
  if (!areaTool && !state.buildMode && openSiteAt(point)) return;
  if (!areaTool && !state.buildMode && openQuestAt(point)) return;
  if (!areaTool && !state.buildMode && openHermitAt(point)) return;
  const villageTarget = !areaTool ? neutralVillageEntityAt(state, point) : undefined;
  if (villageTarget) { clearPlacement(); showVillageDiplomacy(villageTarget.faction, villageTarget.id); updateUI(); return; }
  const activityTarget = !areaTool ? buildingAtPoint(state, point) : undefined;
  if (activityTarget && !(state.buildMode && isFarmKind(activityTarget.kind)) && buildingActivityAvailable(state, activityTarget)) {
    resourceActivity.close();
    leaderProgression.close();
    if (state.buildMode) clearPlacement();
    cancelStroke(); state.selected = activityTarget.id; state.selectedType = 'building'; state.diplomacy = null;
    buildingActivity.toggle(activityTarget);
  } else if (!areaTool && !state.buildMode && !activityTarget && !unitAtPoint(state, point) && resourceActivity.open(point)) {
    buildingActivity.close(); leaderProgression.close();
    state.selected = null; state.selectedType = null; state.diplomacy = null;
  } else if (areaTool) {
    beginAreaStroke(pointerId, point);
    if (!touch) canvas.setPointerCapture(pointerId);
  } else if (state.buildMode) {
    stroke = { start: { x: Math.floor(point.x), y: Math.floor(point.y) }, kind: state.buildMode, pointerId, twoClick: touch && isLinearPlacement(state.buildMode) };
    renderer.buildPreview = [stroke.start]; routePreviewKey = ''; constructionGesture.clear(); buildError = ''; linearPurchaseNotice = '';
    if (touch && !stroke.twoClick) commitStroke();
    else if (!stroke.twoClick) canvas.setPointerCapture(pointerId);
  } else if (touch) commandWorldPoint(point);
  else {
    resourceActivity.close();
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
  e.preventDefault(); pointer = { x: e.clientX, y: e.clientY }; renderer.hover = renderer.worldPoint(e.clientX, e.clientY);
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
  if (!linearPurchases.length && linearPurchaseNotice) { linearPurchaseNotice = ''; pointerStatusDirty = true; }
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
  // Coalesce all pointer events into the next frame's shared preview.
});
canvas.addEventListener('pointerup', e => {
  pointer = { x: e.clientX, y: e.clientY }; renderer.hover = renderer.worldPoint(e.clientX, e.clientY); pan = null;
  if (areaStroke) refreshWorldPointer();
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
// Input-priority frames: when event handlers since the last frame already
// spent noticeable main-thread time (placing, opening a popup, a diplomacy
// action), this frame skips the simulation step and only draws, so the
// response appears without also paying for a full step. The skipped time is
// carried into the next step; no simulated time is lost.
const INPUT_PRIORITY_MS = 6;
let inputWorkMs = 0, inputStartedAt: number | undefined, carriedFrameSeconds = 0;
// Input handlers read the same published state the renderer just drew, so
// they share its trusted simulation reads (cached fog, territory, navigation).
// The window capture/bubble pair brackets every handler of one event; a
// handler that stops propagation leaves the scope to close at the next frame.
let inputDepth = 0, releaseInputReads: (() => void) | undefined;
function closeInputReads() { inputDepth = 0; releaseInputReads?.(); releaseInputReads = undefined; inputStartedAt = undefined; }
for (const type of ['pointerdown', 'pointerup', 'click', 'contextmenu', 'keydown', 'keyup', 'change', 'input', 'wheel'] as const) {
  window.addEventListener(type, () => {
    if (!inputDepth++) { inputStartedAt = performance.now(); releaseInputReads = state.multiplayer ? undefined : holdSimulationReads(state); }
  }, { capture: true, passive: true });
  window.addEventListener(type, () => {
    if (!inputDepth || --inputDepth) return;
    if (inputStartedAt !== undefined) inputWorkMs += performance.now() - inputStartedAt;
    closeInputReads();
  }, { passive: true });
}
function frame(now: number) {
  syncPlacementIntent();
  if (inputDepth) { if (inputStartedAt !== undefined) inputWorkMs += performance.now() - inputStartedAt; closeInputReads(); }
  const frameStarted = performance.now();
  const elapsed = Math.max(0, (now - last) / 1000); last = now;
  const inputPriority = !state.multiplayer && inputWorkMs >= INPUT_PRIORITY_MS && carriedFrameSeconds === 0;
  inputWorkMs = 0;
  // Animation and camera use real frame time; only the simulation step carries.
  const elapsedFrame = elapsed, simElapsed = inputPriority ? 0 : elapsed + carriedFrameSeconds;
  carriedFrameSeconds = inputPriority ? elapsed : 0;
  const dt = frameSimulationDelta(simElapsed, state.speed);
  if ((input.turnLeft || input.turnRight) && (!infantryFormationActive(state) && !boardedBoat(state) || state.paused || frontend.active || !$('#dialog').hidden)) clearTurnInput();
  if (state.multiplayer) multiplayer.input(input);
  else if (!inputPriority) updateGame(state, dt, input, { interactive: true, wallNow: Date.now() });
  if (state.multiplayer) multiplayer.updatePresentation(now);
  // Presentation and HUD reads share the trusted view of the state just published.
  // Online clients apply server snapshots outside the simulation's revisions.
  if (state.multiplayer) presentFrame(now, frameStarted, elapsedFrame);
  else withSimulationReads(state, () => presentFrame(now, frameStarted, elapsedFrame));
  telemetry.frame(now, performance.now() - frameStarted, sessionStarted && !frontend.active && !state.paused && !state.gameOver);
  requestAnimationFrame(frame);
}
function presentFrame(now: number, frameStarted: number, elapsedFrame: number) {
  advanceLinearPurchases(frameStarted, now);
  let beganRespawnPan = false;
  const waitingForRespawn = !!state.factions.find(faction => faction.id === playerFaction(state))?.leaderRespawn;
  const respawnOverlay = $('#leader-respawn');
  if (waitingForRespawn !== wasWaitingForRespawn) {
    if (waitingForRespawn) {
      deathCamera = { ...state.factions.find(faction => faction.id === playerFaction(state))!.leaderRespawn!.position };
      respawnCamera.cancel(); renderer.camera = { ...deathCamera }; renderer.follow = false;
      clearInput(); clearPlacement(); buildingActivity.close(); resourceActivity.close(); leaderProgression.close();
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
  // The menu covers the whole screen; skip drawing the hidden world beneath it.
  if (!frontend.active) renderer.draw(state, Math.min(elapsedFrame, .15), refreshWorldPointer);
  if (pointerStatusDirty) updateBuildStatus();
  actionTooltips.update();
  armyWarnings.update(now, !frontend.active && !state.gameOver && $('#dialog').hidden);
  buildingActivity.update(now);
  resourceActivity.update(now);
  leaderActionFeedback.update(now);
  if (uiRequested || now - lastUI >= CHECK_INTERVAL_MS) {
    renderUI();
    if (!frontend.active && state.palaceCaptures?.some(offer => !pendingCaptures.has(offer.palaceId) && (offer.captor === undefined || offer.captor === playerFaction(state))) && $('#dialog').hidden) showPalaceCapture();
    offerRuinsDiscovery();
    offerNearbySite(now);
  }
  if (now - lastSave > 15000) { save(); lastSave = now; }
  if (!frontend.active && state.gameOver && !gameEndShown) {
    gameEndShown = true;
    showGameEnd();
  }
}
document.documentElement.dataset.assets = 'loading';
showLoading('Loading', '', 0);
const assets = loadGameAssets(renderer);
let loadedAssets = 0;
void Promise.all(assets.map(task => task.then(() => { if (document.documentElement.dataset.assets !== 'error') frontend.loading('Loading', '', ++loadedAssets / assets.length); }))).then(() => {
  document.documentElement.dataset.assets = 'ready';
  frontend.setStatus('');
  // Account services are optional for now; guest access leads to the game menu,
  // where an existing save can be loaded explicitly.
  showFrontend('login');
  chooseInitialWorld = false;
  last = performance.now();
  updateUI(); requestAnimationFrame(frame);
}).catch(error => {
  document.documentElement.dataset.assets = 'error';
  telemetry.error(error, 'asset');
  console.error(error);
  frontend.error('Unable to load the game assets. Retry to reload the page.', false);
});
if (import.meta.env.DEV) Object.assign(window, { __game: {
  get state() { return state; }, renderer,
  get constructionStatus() { return { pending: linearPurchaseState === state, jobs: linearPurchases.length,
    completed: linearPurchasesCompleted, lastResult: linearPurchaseLastResult, workSerial: linearWorkSerial, workMs: linearWorkMs }; },
  replaceState: (next: GameState) => { state = next; resetEntities(state); offlineState = state; sessionStarted = true; pauseBeforeFrontend = state.paused; hideFrontend(); },
  entities: entityStore,
  step: (seconds: number) => updateGame(state, seconds, { up: false, down: false, left: false, right: false }, { wallNow: Date.now() }),
  newWorld,
  interact: (x: number, y: number) => interactAt(state, x, y),
  build: (kind: BuildSelection, x: number, y: number) => buildAt(state, kind, x, y),
  save: () => saveNow(false),
} });
