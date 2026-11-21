import { MarketplacePanel } from './marketplace-panel';
import { orderMarketRoute } from '../game/trade';
import './marketplace-panel.css';
import { militaryFormationControl, selectMilitaryFormation, type MilitaryFormationType } from '../game/military-academy';
import { ShipyardPanel } from './shipyard-panel';
import { AchievementTree } from './achievement-tree';
import { purchaseAchievement } from '../game/achievements';
import { affiliationBreakdown, loyaltyOf } from '../game/settlement-bridge';
import { levySlingerFraction, setLevySlingerFraction } from '../game/mass-levy';
import { upgradeFort, upgradeFortStatus, upgradeFortBrigade, upgradeFortBrigadeStatus, rebuildFort, rebuildFortStatus, fortBrigadeCapacity, fortMaintenance } from '../game/forts';
import { CHECK_INTERVAL_MS } from '../game/work-cadence';
import { entityStore } from '../game/entity-store';
import { structuresOf, STRUCTURE_READY } from '../game/structure-index';
import { buildingActivityAnchor, buildingActivityAvailable, buildingActivityKind, isCompositionBuilding } from '../game/building-activity';
import { blacksmithUpgradeStatus, purchaseBlacksmithUpgrade, type BlacksmithUpgradeTrack } from '../game/blacksmith';
import { governorPermissions, setGovernorPermission } from '../game/governor';
import { immigrationStatus, importImmigrant, IMMIGRANT_COST } from '../game/immigration';
import { retinueSlotPurchaseStatus, purchaseRetinueSlot, RETINUE_SLOT_COST } from '../game/retinue-purchases';
import { logEvent } from '../game/simulation';
import { type Building, type GameState, type Point } from '../game/types';
import { icon } from './icons';
import { MeasuredSize } from './measured-size';
import { wholeNumber } from './number-format';
import { orchardUpgradeStatus, purchaseOrchardUpgrade, orchardReady, ORCHARD_UPGRADE_COST } from '../game/orchards';
import { guardPostUpgradeStatus, upgradeGuardPost, setGuardPostWallsOnly, setGuardPostAvoidForbidden, guardPostUpkeep, GUARD_POST_UPKEEP_INTERVAL } from '../game/guard-posts';
import { retinueComposition, retinueUpkeep, setRetinueCount, canRecruitSpearmen, type RetinueRole } from '../game/archery';
import { areSwordsmenUnlocked, areArchersUnlocked, areSpearmenUnlocked, arePikemenUnlocked, areMusketmenUnlocked, areHorsemenUnlocked, areHorseArchersUnlocked, areKnightsUnlocked, researchLevel, setResearchAllocation, prioritizeResearch, removeResearchPriority } from '../game/research';
import { hasLivestock } from '../game/livestock';
import { isKeep, KEEP_UPGRADE_COST, KEEP_HOUSING_COST, settlementLabel, settlementTierStatus, settlementUpgradeStatus,
  upgradeSettlement, upgradeSettlementTier, keepHousingUpgradeStatus, purchaseKeepHousing } from '../game/settlement-upgrades';
import { ResearchTree } from './research-tree';
import type { GameCommand } from '../multiplayer/protocol';
import { performVillageAction, villageDiplomacyStatus, VILLAGE_TRADE_COST, VILLAGE_ALLIANCE_COST } from '../game/villages';
import { cachedVillageTradeEstimate, villageTradeEstimate } from './village-trade-estimate';
import { villageTradeSummary } from './village-trade-summary';

interface Size { width: number; height: number; }
const equipmentTiers = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const compositionRows = [
  { name: 'warriors', role: 'warrior', label: 'Warriors', count: 'warriors' },
  { name: 'archers', role: 'archer', label: 'Archers', count: 'archers' },
  { name: 'spearmen', role: 'spearman', label: 'Spearmen', count: 'spearmen' },
  { name: 'swordsmen', role: 'swordsman', label: 'Swordsmen', count: 'swordsmen' },
  { name: 'field-cannons', role: 'fieldCannon', label: 'Field cannon', count: 'fieldCannons' },
  { name: 'musketmen', role: 'musketman', label: 'Musketmen', count: 'musketmen' },
  { name: 'pikemen', role: 'pikeman', label: 'Pikemen', count: 'pikemen' },
  { name: 'horsemen', role: 'horseman', label: 'Horsemen', count: 'horsemen' },
  { name: 'horse-archers', role: 'horseArcher', label: 'Horse archers', count: 'horseArchers' },
  { name: 'knights', role: 'knight', label: 'Knights', count: 'knights' },
] as const;

/** Preserve native-size text and pixel borders. CSS constrains the panel to the
 * viewport and scrolls tall content instead of blurring it with a transform. */
export function activityPopupLayout(anchor: Point, viewport: Size, panel: Size): { left: number; top: number; scale: number; visible: boolean } {
  const width = Math.min(panel.width, viewport.width - 40), height = Math.min(panel.height, viewport.height - 72);
  return {
    left: Math.round(Math.max(20, Math.min(viewport.width - width - 20, anchor.x - width / 2))),
    top: Math.round(Math.max(48, Math.min(viewport.height - height - 24, anchor.y - height - 16))),
    scale: 1,
    visible: anchor.x >= 0 && anchor.x <= viewport.width && anchor.y >= 0 && anchor.y <= viewport.height,
  };
}

/** A small, non-modal activity surface that follows one world building. */
export class BuildingActivityPopup {
  private buildingId: number | null = null;
  private nextRefreshAt = -Infinity;
  private readonly editingComposition = new Set<string>();
  private readonly pendingComposition = new Map<string, { value: number; until: number }>();
  private villageSummaryMarkup = '';
  // Set when a village popup opens: paint first, estimate the caravan next.
  private deferVillageTrade = false;
  private readonly size: MeasuredSize;
  private readonly researchTree: ResearchTree;
  private readonly achievementTree: AchievementTree;
  private readonly shipyard: ShipyardPanel;
  private readonly marketplace: MarketplacePanel;
  private readonly farms: HTMLInputElement;
  private readonly housing: HTMLInputElement;
  private readonly immigrants: HTMLButtonElement;
  private readonly upgrades: Record<BlacksmithUpgradeTrack, HTMLButtonElement>;

  constructor(private readonly element: HTMLElement, private readonly getState: () => GameState,
    private readonly project: (point: Point) => Point, private readonly viewport: () => Size,
    private readonly changed: () => void, private readonly focusWorld: () => void,
    private readonly sendCommand?: (command: GameCommand) => boolean) {
    this.size = new MeasuredSize(element);
    element.innerHTML = `<button class="activity-close" type="button" aria-label="Close building activity" title="Close (Escape)">×</button>
      <h2 id="building-activity-title"></h2>
      <div class="activity-governor">
        <p class="activity-note settlement-population"></p>
        <div class="settlement-upgrade-options">
          <div class="settlement-civic-upgrade" hidden>
            <button type="button" class="activity-upgrade activity-settlement" data-settlement-upgrade aria-describedby="settlement-upgrade-requirements"><span class="upgrade-label"></span><span class="upgrade-price"><span class="upgrade-cost"></span>${icon('gold')}</span></button>
            <p class="activity-note settlement-upgrade-requirements" id="settlement-upgrade-requirements"></p>
          </div>
          <button type="button" class="activity-upgrade activity-settlement" data-keep hidden><span class="upgrade-label">Upgrade defenses</span><span class="upgrade-price">${KEEP_UPGRADE_COST}${icon('gold')}</span></button>
          <button type="button" class="activity-upgrade activity-settlement" data-keep-housing hidden><span class="upgrade-label">Expand Keep housing</span><span class="upgrade-price">${KEEP_HOUSING_COST}${icon('gold')}</span></button>
        </div>
        <p class="activity-note city-loyalty-summary"></p><p class="activity-note city-loyalty-factors"></p>
        <label><input type="checkbox" name="farms" aria-label="Automatically build farms"><span>Farm</span></label>
        <label><input type="checkbox" name="housing" aria-label="Automatically build housing"><span>Housing</span></label>
        <button type="button" class="activity-upgrade activity-immigrants"><span class="upgrade-label">Import immigrants</span><span class="upgrade-price">${IMMIGRANT_COST}${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade activity-retinue" data-retinue-slot><span class="upgrade-label">Buy retinue slot</span><span class="upgrade-price">${RETINUE_SLOT_COST}${icon('gold')}</span></button>
      </div>
      <div class="activity-levy activity-stack" hidden>
        <label class="composition-row"><span>Slingers</span><input type="range" name="levySlingers" min="0" max="100" step="5" aria-label="Slinger levy proportion"><output class="levy-mix"></output></label>
      </div>
      <div class="activity-upgrades" hidden>${(['armor', 'weapon'] as const).map(track => `
        <button type="button" class="activity-upgrade" data-upgrade="${track}">
          <span class="upgrade-label">Upgrade ${track}</span>
          <span class="upgrade-price"><span class="upgrade-cost"></span>${icon('gold')}</span>
        </button>`).join('')}</div>
      <div class="activity-composition activity-stack" hidden>
        <h3>Army composition</h3>
        <p class="activity-note composition-summary"></p>
        ${compositionRows.map(row => `
          <label class="composition-row"><span>${row.label}</span><input type="range" name="${row.name}" min="0" max="0" step="1" aria-label="${row.label} target"><output class="${row.role}-count"></output></label>`).join('')}
      </div>
      <div class="activity-orchard activity-stack" hidden>
        <button class="activity-upgrade" data-orchard="1"><span class="upgrade-label">Plant orchard</span><span class="upgrade-price">${ORCHARD_UPGRADE_COST}${icon('gold')}</span></button>
        <button class="activity-upgrade" data-orchard="10"><span class="upgrade-label">Plant 10 orchards</span><span class="upgrade-price">${ORCHARD_UPGRADE_COST * 10}${icon('gold')}</span></button>
        <p class="activity-note orchard-status"></p>
      </div>
      <div class="activity-fort activity-stack" hidden>
        <p class="activity-note fort-status"></p>
        <button type="button" class="activity-upgrade" data-fort-upgrade><span class="upgrade-label fort-upgrade-label"></span><span class="upgrade-price"><span class="fort-upgrade-cost"></span>${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade" data-fort-brigade><span class="upgrade-label">Skirmisher Brigade</span><span class="upgrade-price"><span class="fort-brigade-cost"></span>${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade" data-fort-rebuild><span class="upgrade-label">Rebuild Fort</span><span class="upgrade-price"><span class="fort-rebuild-cost"></span>${icon('gold')}</span></button>
      </div>
      <div class="activity-guards activity-stack" hidden>
        <button class="activity-upgrade" data-guards><span class="upgrade-label">Expand guard post</span><span class="upgrade-price"><span class="guard-cost"></span>${icon('gold')}</span></button>
        <label><input type="checkbox" name="guardWallsOnly"><span>Stay inside city walls</span></label>
        <label><input type="checkbox" name="guardAvoidForbidden"><span>Guards avoid forbidden areas</span></label>
        <p class="activity-note guard-status"></p>
      </div>
      <div class="activity-scouts activity-stack" hidden>
        <p class="activity-note">Observation posts unlocked</p>
      </div>
      <div class="activity-militaryAcademy activity-stack" hidden>
        <label class="composition-row"><span>Formation</span><select name="militaryFormation" aria-label="Formation type">
          <option value="wide">Wide · 2 ranks</option><option value="standard">Standard · 3 ranks</option><option value="deep">Deep · 4 ranks</option>
          <option value="loose">Loose order · 2 ranks</option>
        </select></label>
        <p class="activity-note military-formation-effect"></p>
      </div>
      <div class="activity-shipyard" hidden></div>
      <div class="activity-marketplace" hidden></div>
      <div class="activity-research" hidden></div>
      <div class="activity-achievements" hidden></div>
      <div class="activity-village activity-stack" hidden>
        <p class="activity-note village-status"></p>
        <div class="village-trade-comparison"></div>
        <button type="button" class="activity-upgrade" data-village-action="trade"><span class="upgrade-label">Trade</span><span class="upgrade-price">${VILLAGE_TRADE_COST}${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade" data-village-action="ally"><span class="upgrade-label">Ally</span><span class="upgrade-price">${VILLAGE_ALLIANCE_COST}${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade" data-village-action="confederate"><span class="upgrade-label">Confederate</span><span class="upgrade-price">0${icon('gold')}</span></button>
        <button type="button" class="activity-upgrade village-war" data-village-action="war"><span class="upgrade-label">Declare war</span></button>
      </div>
      <span class="activity-message" role="status"></span>`;
    this.farms = element.querySelector<HTMLInputElement>('[name="farms"]')!;
    this.housing = element.querySelector<HTMLInputElement>('[name="housing"]')!;
    this.immigrants = element.querySelector<HTMLButtonElement>('.activity-immigrants')!;
    this.upgrades = { armor: element.querySelector<HTMLButtonElement>('[data-upgrade="armor"]')!,
      weapon: element.querySelector<HTMLButtonElement>('[data-upgrade="weapon"]')! };
    element.querySelector<HTMLButtonElement>('.activity-close')!.onclick = () => { this.close(); this.focusWorld(); };
    for (const [key, checkbox] of [['farms', this.farms], ['housing', this.housing]] as const) {
      checkbox.onchange = () => {
        const building = this.building();
        if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
        if (this.sendCommand?.({ type: 'governor', buildingId: building.id, permission: key, enabled: checkbox.checked })) return;
        setGovernorPermission(building, key, checkbox.checked);
        this.changed();
      };
    }
    for (const track of ['armor', 'weapon'] as const) this.upgrades[track].onclick = () => {
      const building = this.building();
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.({ type: 'blacksmith', buildingId: building.id, track })) return;
      const result = purchaseBlacksmithUpgrade(this.getState(), building, track);
      this.message(result.message, !result.ok);
      if (result.ok) { logEvent(this.getState(), result.message); this.changed(); }
      this.refresh();
    };
    this.immigrants.onclick = () => {
      const building = this.building();
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.({ type: 'immigrant', buildingId: building.id })) return;
      const result = importImmigrant(this.getState(), building);
      this.message(result.message, !result.ok);
      if (result.ok) { logEvent(this.getState(), result.message, 'good'); this.changed(); }
      this.refresh();
    };
    const purchase = (action: (state: GameState, building: Building) => { ok: boolean; message: string }, command: (building: Building) => GameCommand) => {
      const building = this.building();
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.(command(building))) return;
      const result = action(this.getState(), building);
      this.message(result.message, !result.ok);
      if (result.ok) { if (result.message) logEvent(this.getState(), result.message, 'good'); this.changed(); }
      this.refresh();
    };
    for (const count of [1, 10] as const) element.querySelector<HTMLButtonElement>(`[data-orchard="${count}"]`)!.onclick =
      () => purchase((state, building) => purchaseOrchardUpgrade(state, building, count), building => ({ type: 'orchard', buildingId: building.id, count }));
    element.querySelector<HTMLButtonElement>('[data-guards]')!.onclick = () => purchase(upgradeGuardPost, building => ({ type: 'guard-upgrade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-fort-brigade]')!.onclick = () => purchase(upgradeFortBrigade, building => ({ type: 'fort-brigade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-fort-upgrade]')!.onclick = () => purchase(upgradeFort, building => ({ type: 'fort-upgrade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-fort-rebuild]')!.onclick = () => purchase(rebuildFort, building => ({ type: 'fort-rebuild', buildingId: building.id }));
    const guardWallsOnly = element.querySelector<HTMLInputElement>('[name="guardWallsOnly"]')!;
    guardWallsOnly.onchange = () => purchase((state, building) => setGuardPostWallsOnly(state, building, guardWallsOnly.checked), building => ({ type: 'guard-walls', buildingId: building.id, enabled: guardWallsOnly.checked }));
    const guardAvoidForbidden = element.querySelector<HTMLInputElement>('[name="guardAvoidForbidden"]')!;
    guardAvoidForbidden.onchange = () => purchase((state, building) => setGuardPostAvoidForbidden(state, building, guardAvoidForbidden.checked), building => ({ type: 'guard-forbidden', buildingId: building.id, enabled: guardAvoidForbidden.checked }));
    element.querySelector<HTMLButtonElement>('[data-settlement-upgrade]')!.onclick = () => purchase(upgradeSettlementTier, building => ({ type: 'settlement-upgrade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-keep]')!.onclick = () => purchase(upgradeSettlement, building => ({ type: 'keep', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-keep-housing]')!.onclick = () => purchase(purchaseKeepHousing, building => ({ type: 'keep-housing', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-retinue-slot]')!.onclick = () => purchase(purchaseRetinueSlot, building => ({ type: 'retinue-slot', buildingId: building.id }));
    for (const button of ['trade', 'ally', 'confederate', 'war'] as const)
      element.querySelector<HTMLButtonElement>(`[data-village-action="${button}"]`)!.onclick = () => {
        // An open petition turns the confederation request into a free acceptance.
        const building = this.building(), petition = !!building && villageDiplomacyStatus(this.getState(), building)?.petition;
        const action = button === 'confederate' && petition ? 'petition' : button;
        purchase((state, building) => performVillageAction(state, building, action), building => ({ type: 'village', buildingId: building.id, action }));
      };
    for (const row of compositionRows) {
      const input = element.querySelector<HTMLInputElement>(`[name="${row.name}"]`)!;
      const commit = () => {
        const building = this.building(), count = input.valueAsNumber;
        this.editingComposition.delete(row.name);
        if (input.disabled) { this.pendingComposition.delete(row.name); return; }
        if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
        this.pendingComposition.clear();
        this.pendingComposition.set(row.name, { value: count, until: performance.now() + 1500 });
        if (this.sendCommand?.({ type: row.name, buildingId: building.id, count })) return;
        if (setRetinueCount(this.getState(), building, row.role, count)) this.changed();
        else this.pendingComposition.delete(row.name);
        this.refresh();
      };
      input.onpointerdown = () => { this.editingComposition.add(row.name); };
      input.oninput = () => { this.editingComposition.add(row.name); this.showCompositionValue(row.role, input); };
      input.onchange = commit;
      input.onblur = () => { if (this.editingComposition.has(row.name)) commit(); };
      input.onpointerup = () => { this.editingComposition.delete(row.name); };
      input.onpointercancel = () => { this.editingComposition.delete(row.name); this.pendingComposition.delete(row.name); this.refresh(); };
    }
    element.querySelector<HTMLInputElement>('[name="levySlingers"]')!.oninput = event => {
      const state = this.getState(), building = state.buildings.find(b => b.id === this.buildingId);
      if (!building) return;
      const fraction = Number((event.target as HTMLInputElement).value) / 100;
      if (this.sendCommand?.({ type: 'levy-composition', buildingId: building.id, fraction })) return;
      if (setLevySlingerFraction(state, building, fraction)) this.changed();
    };
    element.querySelector<HTMLSelectElement>('[name="militaryFormation"]')!.onchange = event => {
      const building = this.building(); if (!building || building.kind !== 'militaryAcademy') return;
      const type = (event.target as HTMLSelectElement).value as MilitaryFormationType;
      if (this.sendCommand?.({ type: 'military-formation', buildingId: building.id, formation: type })) return;
      const result = selectMilitaryFormation(this.getState(), type);
      this.message(result.ok ? '' : result.message ?? 'Formation unavailable.', !result.ok);
      this.refresh(); if (result.ok) this.changed();
    };
    this.shipyard = new ShipyardPanel(element.querySelector<HTMLElement>('.activity-shipyard')!, this.getState, this.changed, (text,error) => this.message(text,error), this.sendCommand);
    this.marketplace = new MarketplacePanel(element.querySelector<HTMLElement>('.activity-marketplace')!,
      destination => purchase((state, building) => orderMarketRoute(state, building, destination),
        building => ({ type: 'market-destination', buildingId: building.id, destination })), () => this.refresh());
    this.researchTree = new ResearchTree(element.querySelector<HTMLElement>('.activity-research')!, {
      allocate: allocation => purchase((state, building) => setResearchAllocation(state, building, allocation), building => ({ type: 'research-allocation', buildingId: building.id, allocation })),
      prioritize: branch => purchase((state, building) => prioritizeResearch(state, building, branch), building => ({ type: 'research-priority', buildingId: building.id, branch })),
      remove: branch => purchase((state, building) => removeResearchPriority(state, building, branch), building => ({ type: 'research-remove-priority', buildingId: building.id, branch })),
    });
    this.achievementTree = new AchievementTree(element.querySelector<HTMLElement>('.activity-achievements')!, achievement =>
      purchase((state, building) => purchaseAchievement(state, building, achievement), building => ({ type: 'achievement', buildingId: building.id, achievement })));
    element.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
    element.addEventListener('pointerdown' , event => event.stopPropagation());
    element.addEventListener('wheel', event => event.stopPropagation());
  }

  get isOpen(): boolean { return this.buildingId !== null; }

  message(text: string, error = true): void {
    const status = this.element.querySelector<HTMLElement>('.activity-message')!;
    status.textContent = text;
    status.classList.toggle('is-error', error && !!text);
  }

  private building(): Building | undefined {
    return this.buildingId === null ? undefined : entityStore(this.getState()).buildings.get(this.buildingId);
  }

  close(): void {
    this.message('',false);
    this.buildingId = null;
    this.editingComposition.clear(); this.pendingComposition.clear();
    this.researchTree.reset(); this.achievementTree.reset(); this.marketplace.reset();
    this.element.hidden = true;
  }

  toggle(building: Building | undefined): void {
    if (!building || !buildingActivityAvailable(this.getState(), building) || building.id === this.buildingId) { this.close(); return; }
    this.message('',false);
    this.editingComposition.clear(); this.pendingComposition.clear();
    this.buildingId = building.id; this.deferVillageTrade = true;
    this.researchTree.reset(); this.achievementTree.reset(); this.marketplace.reset();
    this.refresh();
  }

  refresh(): void {
    this.nextRefreshAt = performance.now() + CHECK_INTERVAL_MS;
    if (this.buildingId === null) return;
    const building = this.building();
    if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
    const kind = buildingActivityKind(building), smithy = kind === 'blacksmith';
    this.element.classList.toggle('is-blacksmith', smithy);
    this.element.classList.toggle('is-archery', isCompositionBuilding(building) || kind === 'scoutLodge');
    this.element.classList.toggle('is-library', kind === 'library' || kind === 'forum');
    this.element.classList.toggle('is-forum', kind === 'forum');
    this.element.classList.toggle('is-village', kind === 'village');
    this.element.classList.toggle('is-foundry', kind === 'foundry');
    this.element.classList.toggle('is-shipyard', kind === 'shipyard');
    this.element.classList.toggle('is-marketplace', kind === 'marketplace');
    const titles = { marketplace: 'Marketplace', militaryAcademy: 'Military Academy', foundry: 'Foundry', shipyard: 'Shipyard', fort: 'Fort', governor: settlementLabel(building), blacksmith: 'Blacksmith', farm: 'Orchard upgrades', guardPost: 'Guard post', archeryRange: 'Army composition', library: 'Research', forum: 'Forum · Achievements', scoutLodge: 'Scouts’ Lodge', stable: 'Stable', barracks: 'Barracks', village: 'Neutral village' };
    this.element.querySelector<HTMLElement>('#building-activity-title')!.textContent = titles[kind!];
    for (const [section, type] of [['fort', 'fort'], ['governor', 'governor'], ['upgrades', 'blacksmith'], ['orchard', 'farm'], ['guards', 'guardPost'], ['research', 'library'], ['achievements', 'forum'], ['scouts', 'scoutLodge'], ['village', 'village'], ['shipyard', 'shipyard'], ['marketplace', 'marketplace'], ['militaryAcademy', 'militaryAcademy']])
      this.element.querySelector<HTMLElement>(`.activity-${section}`)!.hidden = kind !== type;
    if (kind === 'militaryAcademy') {
      const control = militaryFormationControl(this.getState(), building.faction);
      const select = this.element.querySelector<HTMLSelectElement>('[name="militaryFormation"]')!;
      select.value = control.type; select.disabled = !control.enabled;
      this.element.querySelector<HTMLElement>('.military-formation-effect')!.textContent = control.type === 'wide'
        ? 'No defense bonus · +30% missile fire rate'
        : control.type === 'loose' ? '1-tile spacing · +50% frontal defense' : '+50% frontal defense';
    }
    if (kind === 'shipyard') this.shipyard.refresh(building);
    if (kind === 'marketplace') this.marketplace.refresh(this.getState(), building);
    if (kind === 'governor') {
      const state = this.getState(), loyalty = loyaltyOf(state, building), rate = Math.round(loyalty.rate * 60);
      const factors = affiliationBreakdown(state, building.id, building.faction);
      const tier = settlementTierStatus(state, building), next = tier.next;
      const promotion = this.element.querySelector<HTMLButtonElement>('[data-settlement-upgrade]')!;
      const requirements = this.element.querySelector<HTMLElement>('.settlement-upgrade-requirements')!;
      this.element.querySelector<HTMLElement>('.settlement-population')!.textContent = `Population ${wholeNumber(tier.population)}${Number.isFinite(tier.limit) ? ` / ${wholeNumber(tier.limit)}` : ' · Unlimited'}`;
      this.element.querySelector<HTMLElement>('.settlement-civic-upgrade')!.hidden = !next;
      if (next) {
        promotion.disabled = !tier.available;
        promotion.title = tier.reason;
        promotion.querySelector<HTMLElement>('.upgrade-label')!.textContent = `Upgrade to ${next.label}`;
        promotion.querySelector<HTMLElement>('.upgrade-cost')!.textContent = wholeNumber(next.cost);
        const capacity = Number.isFinite(next.capacity) ? `${wholeNumber(next.capacity)} population limit` : 'Unlimited population';
        requirements.textContent = `${Math.min(tier.buildings, next.buildings)}/${next.buildings} civic buildings · ${capacity}`;
      }
      const keep = isKeep(building), defense = settlementUpgradeStatus(state, building);
      const defensesButton = this.element.querySelector<HTMLButtonElement>('[data-keep]')!;
      defensesButton.hidden = keep;
      defensesButton.disabled = !defense.available;
      defensesButton.title = defense.reason;
      const housingUpgrade = keepHousingUpgradeStatus(state, building), housingButton = this.element.querySelector<HTMLButtonElement>('[data-keep-housing]')!;
      housingButton.hidden = !keep; housingButton.disabled = !housingUpgrade.available;
      housingButton.classList.toggle('is-max', !!building.keepHousingExpanded);
      housingButton.querySelector<HTMLElement>('.upgrade-label')!.textContent = building.keepHousingExpanded ? 'Keep housing expanded' : 'Expand Keep housing';
      housingButton.querySelector<HTMLElement>('.upgrade-price')!.hidden = !!building.keepHousingExpanded;
      housingButton.title = housingUpgrade.reason;
      this.element.querySelector<HTMLElement>('.city-loyalty-summary')!.textContent = `Loyalty ${Math.round(loyalty.value)}/100 · ${rate >= 0 ? '+' : '−'}${Math.abs(rate)}/min · Target ${Math.round(loyalty.target)}`;
      this.element.querySelector<HTMLElement>('.city-loyalty-factors')!.textContent = Number.isFinite(factors.culture)
        ? `Culture +${Math.round(factors.culture)} · Governance ${factors.governance >= 0 ? '+' : '−'}${Math.abs(Math.round(factors.governance))} · Trade +${Math.round(factors.trade)} · Threat −${Math.round(factors.threat)}${factors.snub ? ` · Snub −${Math.round(factors.snub)}` : ''}`
        : '';
    }
    if (kind === 'fort') {
      const state = this.getState(), upgrade = upgradeFortBrigadeStatus(state, building), rebuild = rebuildFortStatus(state, building);
      const fortUpgrade = upgradeFortStatus(state, building), improve = this.element.querySelector<HTMLButtonElement>('[data-fort-upgrade]')!;
      improve.hidden = !!building.fort?.destroyed || fortUpgrade.nextLevel === null;
      improve.disabled = !fortUpgrade.available;
      improve.title = fortUpgrade.reason;
      improve.querySelector<HTMLElement>('.fort-upgrade-label')!.textContent = 'Add moat';
      improve.querySelector<HTMLElement>('.fort-upgrade-cost')!.textContent = wholeNumber(fortUpgrade.cost ?? 0);
      const brigade = this.element.querySelector<HTMLButtonElement>('[data-fort-brigade]')!;
      const restore = this.element.querySelector<HTMLButtonElement>('[data-fort-rebuild]')!;
      brigade.hidden = !!building.fort?.destroyed; brigade.disabled = !upgrade.available; brigade.title = upgrade.reason;
      restore.hidden = !building.fort?.destroyed; restore.disabled = !rebuild.available; restore.title = rebuild.reason;
      brigade.querySelector<HTMLElement>('.fort-brigade-cost')!.textContent = upgrade.cost === null ? 'Max' : wholeNumber(upgrade.cost);
      brigade.querySelector<HTMLElement>('.icon')!.hidden = upgrade.cost === null;
      restore.querySelector<HTMLElement>('.fort-rebuild-cost')!.textContent = wholeNumber(rebuild.cost);
      const count = state.units.filter(unit => unit.fort === building.id && unit.hp > 0).length;
      this.element.querySelector<HTMLElement>('.fort-status')!.textContent = building.fort?.destroyed ? 'Destroyed'
        : `${count}/${fortBrigadeCapacity(building)} skirmishers · ${fortMaintenance(building)} gold / 30s${building.fort?.funded === false ? ' · Unpaid' : ''}`;
    }
    if (smithy) for (const track of ['armor', 'weapon'] as const) {
      const status = blacksmithUpgradeStatus(this.getState(), building, track), button = this.upgrades[track];
      button.disabled = !status.available;
      button.querySelector<HTMLElement>('.upgrade-label')!.textContent = status.nextLevel === null
        ? `${track === 'armor' ? 'Armor' : 'Weapon'} VI` : `Upgrade ${track} ${equipmentTiers[status.nextLevel - 1]}`;
      button.title = status.reason;
      button.querySelector<HTMLElement>('.upgrade-cost')!.textContent = status.cost === null ? 'Max' : String(status.cost);
      button.querySelector<HTMLElement>('.upgrade-price .icon')!.hidden = status.cost === null;
      button.classList.toggle('is-max', status.nextLevel === null);
    } else if (kind === 'governor') {
      const permissions = governorPermissions(building);
      this.farms.checked = permissions.farms; this.housing.checked = permissions.housing;
      const status = immigrationStatus(this.getState(), building);
      this.immigrants.disabled = !status.available;
      this.immigrants.title = status.reason;
      const retinue = retinueSlotPurchaseStatus(this.getState(), building), slotButton = this.element.querySelector<HTMLButtonElement>('[data-retinue-slot]')!;
      slotButton.disabled = !retinue.available;
      slotButton.title = retinue.reason;
    }
    const levyPanel = this.element.querySelector<HTMLElement>('.activity-levy')!;
    levyPanel.hidden = kind !== 'governor' || !isKeep(building) || !researchLevel(this.getState().factions.find(f => f.id === building.faction), 'massLevy');
    if (!levyPanel.hidden) {
      const percent = Math.round(levySlingerFraction(this.getState(), building.faction) * 100);
      levyPanel.querySelector<HTMLInputElement>('input')!.value = String(percent);
      levyPanel.querySelector<HTMLOutputElement>('output')!.textContent = `${100 - percent}% / ${percent}%`;
    }
    const composition = this.element.querySelector<HTMLElement>('.activity-composition')!;
    composition.hidden = !isCompositionBuilding(building);
    if (!composition.hidden) {
      composition.querySelector('h3')!.hidden = kind === 'archeryRange';
      this.refreshComposition(building);
    }
    if (kind === 'farm') {
      for (const count of [1, 10] as const) {
        const status = orchardUpgradeStatus(this.getState(), building, count), button = this.element.querySelector<HTMLButtonElement>(`[data-orchard="${count}"]`)!;
        button.disabled = !status.available; button.title = status.reason;
      }
      this.element.querySelector<HTMLElement>('.orchard-status')!.textContent = building.orchard
        ? orchardReady(building, this.getState().time) ? 'Established' : `Establishing · ${Math.ceil(building.orchard.readyAt - this.getState().time)}s`
        : '';
    } else if (kind === 'guardPost') {
      const status = guardPostUpgradeStatus(this.getState(), building), button = this.element.querySelector<HTMLButtonElement>('[data-guards]')!;
      button.disabled = !status.available; button.title = status.reason;
      this.element.querySelector<HTMLElement>('.guard-cost')!.textContent = status.cost === null ? 'Max' : String(status.cost);
      button.querySelector<HTMLElement>('.icon')!.hidden = status.cost === null;
      const wallsOnly = building.guardPost?.wallsOnly === true;
      this.element.querySelector<HTMLInputElement>('[name="guardWallsOnly"]')!.checked = wallsOnly;
      this.element.querySelector<HTMLInputElement>('[name="guardAvoidForbidden"]')!.checked = !building.guardPost?.ignoreForbidden;
      this.element.querySelector<HTMLElement>('.guard-status')!.textContent = `${guardPostUpkeep(building)} gold/${GUARD_POST_UPKEEP_INTERVAL}s upkeep · ${building.guardPost?.kills ?? 0} kills`;
    } else if (kind === 'library') this.researchTree.refresh(this.getState(), building);
    else if (kind === 'forum') this.achievementTree.refresh(this.getState(), building);
    else if (kind === 'village') {
      const status = villageDiplomacyStatus(this.getState(), building);
      if (!status) { this.close(); return; }
      this.element.querySelector<HTMLElement>('#building-activity-title')!.textContent = status.village.name;
      const relations = { neutral: 'Neutral', trade: 'Trading', allied: 'Allied', war: 'At war' };
      this.element.querySelector<HTMLElement>('.village-status')!.textContent = `${relations[status.relation]}${status.trading && status.relation === 'allied' ? ' · Trading' : ''} · Affiliation ${Math.round(status.affiliation)}/100 · ${status.stageName[0].toUpperCase()}${status.stageName.slice(1)}`
        + (status.relation !== 'allied' && status.allianceDiscount ? ` · -${status.allianceDiscount} gold alliance discount` : '');
      const comparison = this.element.querySelector<HTMLElement>('.village-trade-comparison')!;
      const now = performance.now(), deferred = this.deferVillageTrade && !cachedVillageTradeEstimate(this.getState(), status.village, now);
      this.deferVillageTrade = false;
      if (deferred) this.nextRefreshAt = now + 60;
      const summary = deferred ? '<p class="village-trade-pending">Estimating caravan route…</p>'
        : villageTradeSummary(villageTradeEstimate(this.getState(), status.village, now));
      if (this.villageSummaryMarkup !== summary) { comparison.innerHTML = summary; this.villageSummaryMarkup = summary; }
      for (const action of ['trade', 'ally', 'confederate', 'war'] as const) {
        const button = this.element.querySelector<HTMLButtonElement>(`[data-village-action="${action}"]`)!, option = status[action];
        button.disabled = !option.available; button.title = option.reason;
        button.querySelector<HTMLElement>('.upgrade-label')!.textContent = action === 'trade' ? status.trading ? 'Trading' : 'Trade'
          : action === 'ally' ? status.relation === 'allied' ? 'Allied' : 'Ally' : action === 'confederate' ? status.petition ? 'Accept petition' : 'Confederate'
            : status.relation === 'war' ? 'At war' : 'Declare war';
        const price = button.querySelector<HTMLElement>('.upgrade-price');
        if (price && price.dataset.cost !== String(option.cost)) {
          price.innerHTML = `${option.cost}${icon('gold')}`; price.dataset.cost = String(option.cost);
        }
      }
    }
    this.position(building, kind);
  }

  private showCompositionValue(role: RetinueRole, input: HTMLInputElement): void {
    this.element.querySelector<HTMLOutputElement>(`.${role}-count`)!.textContent = input.value;
    input.setAttribute('aria-valuetext', `${input.value} assigned`);
  }

  private refreshComposition(building: Building): void {
    const state = this.getState(), faction = state.factions.find(candidate => candidate.id === building.faction)!;
    const counts = retinueComposition(state, building.faction);
    const schools = new Set(structuresOf(state, faction.id, STRUCTURE_READY, 'archeryRange', 'blacksmith', 'stable', 'barracks', 'foundry').map(school => school.kind));
    const trainingBuildings = { warrior: undefined, archer: 'archeryRange', spearman: 'blacksmith', swordsman: 'blacksmith',
      fieldCannon: 'foundry', pikeman: 'barracks', musketman: 'barracks', horseman: 'stable', horseArcher: 'stable', knight: 'stable' } as const;
    const schoolNames = { foundry: 'a foundry', archeryRange: 'an archery range', blacksmith: 'a blacksmith', stable: 'a stable', barracks: 'a barracks' };
    const horseRequirement = hasLivestock(state, faction.id, 'horse') ? '' : 'Fence a horse herd.';
    const requirements: Record<RetinueRole, string> = {
      warrior: '',
      fieldCannon: researchLevel(faction, 'fieldCannon') > 0 ? '' : 'Requires Field cannon.',
      archer: areArchersUnlocked(faction) ? '' : 'Requires Archery.',
      spearman: canRecruitSpearmen(state, faction) ? '' : !areSpearmenUnlocked(faction) ? 'Requires Military Tactics.' : 'Develop a copper mine inside your city borders.',
      swordsman: areSwordsmenUnlocked(faction) ? '' : 'Requires Metal Casting.',
      musketman: areMusketmenUnlocked(faction) ? '' : 'Requires Gunpowder.',
      pikeman: arePikemenUnlocked(faction) ? '' : 'Requires Urban Militia.',
      horseman: areHorsemenUnlocked(faction) ? horseRequirement : 'Requires Horseback Riding.',
      horseArcher: areHorseArchersUnlocked(faction) ? horseRequirement : 'Requires Horseback Riding and Compound Bow.',
      knight: areKnightsUnlocked(faction) ? horseRequirement : 'Requires Horseback Riding and Stirrups.',
    };
    this.element.querySelector<HTMLElement>('.composition-summary')!.textContent = `${counts.total} retinue slots${counts.training ? ` · ${counts.training} retraining` : ''}`;
    const now = performance.now(), max = String(counts.slots);
    for (const row of compositionRows) {
      const input = this.element.querySelector<HTMLInputElement>(`[name="${row.name}"]`)!;
      const assigned = counts[row.count], pending = this.pendingComposition.get(row.name);
      if (pending && (pending.value === assigned || pending.value > counts.slots || now >= pending.until)) this.pendingComposition.delete(row.name);
      const school = trainingBuildings[row.role];
      const trainingRequirement = school && !schools.has(school) ? `Build ${schoolNames[school]} to train.` : '';
      const requirement = requirements[row.role] || trainingRequirement;
      input.disabled = !!requirement || counts.slots === 0;
      input.title = requirement || `${retinueUpkeep({ kind: row.role })} gold / 30s per unit`;
      input.setAttribute('aria-description', input.title);
      if (input.max !== max) input.max = max;
      if (!this.editingComposition.has(row.name)) {
        const value = String(this.pendingComposition.get(row.name)?.value ?? assigned);
        if (input.value !== value) input.value = value;
      }
      this.showCompositionValue(row.role, input);
    }
  }

  /** Keep following the camera every frame; refresh status/availability at 3 Hz. */
  update(now = performance.now()): void {
    if (this.buildingId === null) return;
    if (now >= this.nextRefreshAt) { this.refresh(); return; }
    const building = this.building();
    if (building) this.position(building, buildingActivityKind(building));
  }

  private position(building: Building, kind: ReturnType<typeof buildingActivityKind>): void {
    this.element.hidden = false;
    const viewport = this.viewport(), size = this.size.read();
    const layout = kind === 'library' || kind === 'forum' ? {
      left: Math.round((viewport.width - size.width) / 2),
      top: Math.round(Math.max(viewport.width > 760 && viewport.width <= 920 ? 82 : viewport.width <= 600 ? 68 : 48, (viewport.height - size.height) / 2)),
      visible: true,
    } : activityPopupLayout(this.project(buildingActivityAnchor(building)), viewport,
      size);
    this.element.hidden = !layout.visible;
    this.element.style.left = `${layout.left}px`;
    this.element.style.top = `${layout.top}px`;
  }
}
