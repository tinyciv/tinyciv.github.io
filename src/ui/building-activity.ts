import { LOYALTY_START } from '../game/loyalty-model';
import { actionTooltip } from './action-tooltips';
import { levySlingerFraction, setLevySlingerFraction } from '../game/mass-levy';
import { upgradeFortBrigade, upgradeFortBrigadeStatus, rebuildFort, rebuildFortStatus, fortBrigadeCapacity } from '../game/forts';
import { CHECK_INTERVAL_MS } from '../game/work-cadence';
import { entityStore } from '../game/entity-store';
import { buildingActivityAnchor, buildingActivityAvailable, buildingActivityKind } from '../game/building-activity';
import { blacksmithUpgradeStatus, purchaseBlacksmithUpgrade, type BlacksmithUpgradeTrack } from '../game/blacksmith';
import { governorPermissions, setGovernorPermission } from '../game/governor';
import { EQUIPMENT_MULTIPLIERS } from '../game/equipment';
import { immigrationStatus, importImmigrant, IMMIGRANT_COST } from '../game/immigration';
import { retinueSlotPurchaseStatus, purchaseRetinueSlot, RETINUE_SLOT_COST, RETINUE_SLOT_UPKEEP, RETINUE_SLOT_UPKEEP_INTERVAL } from '../game/retinue-purchases';
import { logEvent } from '../game/simulation';
import { type Building, type GameState, type Point } from '../game/types';
import { icon } from './icons';
import { multiplierPercent, wholeNumber } from './number-format';
import { orchardUpgradeStatus, purchaseOrchardUpgrade, orchardReady, ORCHARD_UPGRADE_COST } from '../game/orchards';
import { guardPostUpgradeStatus, upgradeGuardPost, setGuardPostWallsOnly, guardPostUpkeep, guardPostLevel, GUARD_POST_UPKEEPS, GUARD_POST_UPKEEP_INTERVAL } from '../game/guard-posts';
import { swordsmanFraction, setSwordsmanFraction, archerFraction, spearmanFraction, horsemanFraction, horseArcherFraction, knightFraction, mountedFraction, setHorseArcherFraction, setKnightFraction, retinueComposition, setArcherFraction, setSpearmanFraction, setHorsemanFraction, canRecruitSpearmen } from '../game/archery';
import { areSwordsmenUnlocked, areArchersUnlocked, areSpearmenUnlocked, areHorsemenUnlocked, areHorseArchersUnlocked, areKnightsUnlocked, researchLevel, setResearchAllocation, prioritizeResearch, removeResearchPriority } from '../game/research';
import { isKeep, KEEP_MAX_HP, KEEP_HOUSING, KEEP_HOUSING_BONUS, KEEP_HOUSING_COST, settlementLabel, settlementUpgradeStatus,
  upgradeSettlement, keepHousingUpgradeStatus, purchaseKeepHousing } from '../game/settlement-upgrades';
import { ResearchTree } from './research-tree';
import type { GameCommand } from '../multiplayer/protocol';
import { performVillageAction, villageDiplomacyStatus, VILLAGE_TRADE_COST, VILLAGE_ALLIANCE_COST } from '../game/villages';
import { villageTradeQuote } from '../game/village-trade-quote';
import { villageTradeSummary } from './village-trade-summary';

interface Size { width: number; height: number; }
const equipmentTiers = ['I', 'II', 'III', 'IV', 'V', 'VI'];

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
  private villageSummaryMarkup = '';
  private readonly researchTree: ResearchTree;
  private readonly farms: HTMLInputElement;
  private readonly housing: HTMLInputElement;
  private readonly immigrants: HTMLButtonElement;
  private readonly upgrades: Record<BlacksmithUpgradeTrack, HTMLButtonElement>;

  constructor(private readonly element: HTMLElement, private readonly getState: () => GameState,
    private readonly project: (point: Point) => Point, private readonly viewport: () => Size,
    private readonly changed: () => void, private readonly focusWorld: () => void,
    private readonly sendCommand?: (command: GameCommand) => boolean) {
    element.innerHTML = `<button class="activity-close" type="button" aria-label="Close building activity" title="Close (Escape)">×</button>
      <h2 id="building-activity-title">Governor permissions:</h2>
      <div class="activity-governor"><p class="activity-note city-loyalty-summary"></p><p class="activity-note city-loyalty-factors"></p>
        <label><input type="checkbox" name="farms" aria-label="Automatically build farms"><span>Farm</span></label>
        <label><input type="checkbox" name="housing" aria-label="Automatically build housing"><span>Housing</span></label>
        <button type="button" class="activity-upgrade activity-immigrants"><span class="upgrade-label">Import immigrants</span><span class="upgrade-price">${IMMIGRANT_COST}${icon('gold')}</span><span class="immigrant-effect">+1 population</span></button>
        <button type="button" class="activity-upgrade activity-retinue" data-retinue-slot><span class="upgrade-label">Buy retinue slot</span><span class="upgrade-price">${RETINUE_SLOT_COST}${icon('gold')}</span><small class="retinue-slot-effect">+1 slot · ${RETINUE_SLOT_UPKEEP} gold / ${RETINUE_SLOT_UPKEEP_INTERVAL}s upkeep</small></button>
        <button type="button" class="activity-upgrade activity-keep" data-keep hidden><span class="upgrade-label">Upgrade to Keep</span><small class="keep-effect"></small></button>
        <button type="button" class="activity-upgrade activity-retinue" data-keep-housing hidden><span class="upgrade-label">Expand Keep housing</span><span class="upgrade-price">${KEEP_HOUSING_COST}${icon('gold')}</span><small class="keep-housing-effect retinue-slot-effect">+${KEEP_HOUSING_BONUS} housing · ${KEEP_HOUSING + KEEP_HOUSING_BONUS} total</small></button>
      </div>
      <div class="activity-levy activity-stack" hidden>
        <label class="composition-row"><span>Slingers</span><input type="range" name="levySlingers" min="0" max="100" step="5" aria-label="Slinger levy proportion"><output class="levy-mix"></output></label>
        <p class="activity-note">Next levy: militia / slingers. Existing soldiers keep their roles.</p>
      </div>
      <div class="activity-upgrades" hidden>${(['armor', 'weapon'] as const).map(track => `
        <button type="button" class="activity-upgrade" data-upgrade="${track}">
          <span class="upgrade-label">Upgrade ${track}</span>
          <span class="upgrade-levels" aria-hidden="true">${EQUIPMENT_MULTIPLIERS.slice(1).map((multiplier, index) => `<span data-level="${index + 1}"><b>${equipmentTiers[index]}</b><span>${multiplierPercent(multiplier)}</span></span>`).join('')}</span>
          <span class="upgrade-price"><span class="upgrade-cost"></span>${icon('gold')}</span>
        </button>`).join('')}</div>
      <div class="activity-spearmen activity-stack" hidden>
        <label class="composition-row"><span>Spearmen</span><input type="range" name="spearmen" min="0" max="100" step="1" aria-label="Spearman proportion"><output class="spearman-count"></output></label>
        <p class="activity-note spearman-status"></p>
        <label class="composition-row"><span>Swordsmen</span><input type="range" name="swordsmen" min="0" max="100" step="1" aria-label="Swordsman proportion"><output class="swordsman-count"></output></label>
        <p class="activity-note swordsman-status"></p>
      </div>
      <div class="activity-orchard activity-stack" hidden>
        <button class="activity-upgrade" data-orchard="1"><span class="upgrade-label">Plant orchard</span><small>One farm · 50% more food</small><span class="upgrade-price">${ORCHARD_UPGRADE_COST}${icon('gold')}</span></button>
        <button class="activity-upgrade" data-orchard="10"><span class="upgrade-label">Plant 10 orchards</span><small>Nearest ordinary farms</small><span class="upgrade-price">${ORCHARD_UPGRADE_COST * 10}${icon('gold')}</span></button>
        <p class="activity-note orchard-status"></p>
      </div>
      <div class="activity-fort activity-stack" hidden>
        <p class="activity-note fort-status"></p>
        <button type="button" class="activity-upgrade" data-fort-brigade><span class="upgrade-label">Skirmisher Brigade</span><small class="fort-brigade-effect"></small></button>
        <button type="button" class="activity-upgrade" data-fort-rebuild><span class="upgrade-label">Rebuild Fort</span><small class="fort-rebuild-effect"></small></button>
      </div>
      <div class="activity-guards activity-stack" hidden>
        <button class="activity-upgrade" data-guards><span class="upgrade-label">Expand guard post</span><small class="guard-capacity"></small><span class="upgrade-price"><span class="guard-cost"></span>${icon('gold')}</span></button>
        <label><input type="checkbox" name="guardWallsOnly" aria-describedby="guard-walls-note"><span>Stay inside city walls</span></label>
        <p class="activity-note" id="guard-walls-note" hidden>Defend the enclosure; remain at the post if no enclosure exists.</p>
        <p class="activity-note guard-status"></p>
      </div>
      <div class="activity-archery activity-stack" hidden>
        <label class="composition-row"><span>Warriors</span><input type="range" name="warriors" min="0" max="100" step="1" aria-label="Warrior proportion"><output class="warrior-count"></output></label>
        <label class="composition-row"><span>Archers</span><input type="range" name="archers" min="0" max="100" step="1" aria-label="Archer proportion"><output class="archer-count"></output></label>
        <p class="activity-note archery-status"></p>
      </div>
      <div class="activity-stable activity-stack" hidden>
        <label class="composition-row"><span>Horsemen</span><input type="range" name="horsemen" min="0" max="100" step="1" aria-label="Horseman proportion"><output class="horseman-count"></output></label>
        <label class="composition-row"><span>Horse archers</span><input type="range" name="horse-archers" min="0" max="100" step="1" aria-label="Horse archer proportion"><output class="horse-archer-count"></output></label>
        <label class="composition-row"><span>Knights</span><input type="range" name="knights" min="0" max="100" step="1" aria-label="Knight proportion"><output class="knight-count"></output></label>
        <p class="activity-note stable-status"></p>
        <p class="activity-note">Horsemen: fast spear cavalry · Horseback Riding</p>
        <p class="activity-note">Horse archers: mobile ranged · Compound Bow</p><p class="activity-note">Knights: heavy shock cavalry · Stirrups</p>
      </div>
      <div class="activity-scouts activity-stack" hidden>
        <p class="activity-note">Observation posts unlocked</p>
        <p class="activity-note">Place posts outside all borders from Fortify.</p>
      </div>
      <div class="activity-research" hidden></div>
      <div class="activity-village activity-stack" hidden>
        <p class="activity-note village-status"></p>
        <div class="village-trade-comparison"></div>
        <button type="button" class="activity-upgrade" data-village-action="trade"><span class="upgrade-label">Trade</span><span class="upgrade-price">${VILLAGE_TRADE_COST}${icon('gold')}</span><small>Both partners earn gold per completed journey</small></button>
        <button type="button" class="activity-upgrade" data-village-action="ally"><span class="upgrade-label">Ally</span><span class="upgrade-price">${VILLAGE_ALLIANCE_COST}${icon('gold')}</span><small class="village-bonus"></small></button>
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
      this.element.querySelector<HTMLElement>('.activity-message')!.textContent = result.message;
      if (result.ok) { logEvent(this.getState(), result.message); this.changed(); }
      this.refresh();
    };
    this.immigrants.onclick = () => {
      const building = this.building();
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.({ type: 'immigrant', buildingId: building.id })) return;
      const result = importImmigrant(this.getState(), building);
      this.element.querySelector<HTMLElement>('.activity-message')!.textContent = result.message;
      if (result.ok) { logEvent(this.getState(), result.message, 'good'); this.changed(); }
      this.refresh();
    };
    const purchase = (action: (state: GameState, building: Building) => { ok: boolean; message: string }, command: (building: Building) => GameCommand) => {
      const building = this.building();
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.(command(building))) return;
      const result = action(this.getState(), building);
      element.querySelector<HTMLElement>('.activity-message')!.textContent = result.message;
      if (result.ok) { logEvent(this.getState(), result.message, 'good'); this.changed(); }
      this.refresh();
    };
    for (const count of [1, 10] as const) element.querySelector<HTMLButtonElement>(`[data-orchard="${count}"]`)!.onclick =
      () => purchase((state, building) => purchaseOrchardUpgrade(state, building, count), building => ({ type: 'orchard', buildingId: building.id, count }));
    element.querySelector<HTMLButtonElement>('[data-guards]')!.onclick = () => purchase(upgradeGuardPost, building => ({ type: 'guard-upgrade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-fort-brigade]')!.onclick = () => purchase(upgradeFortBrigade, building => ({ type: 'fort-brigade', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-fort-rebuild]')!.onclick = () => purchase(rebuildFort, building => ({ type: 'fort-rebuild', buildingId: building.id }));
    const guardWallsOnly = element.querySelector<HTMLInputElement>('[name="guardWallsOnly"]')!;
    guardWallsOnly.onchange = () => purchase((state, building) => setGuardPostWallsOnly(state, building, guardWallsOnly.checked), building => ({ type: 'guard-walls', buildingId: building.id, enabled: guardWallsOnly.checked }));
    element.querySelector<HTMLButtonElement>('[data-keep]')!.onclick = () => purchase(upgradeSettlement, building => ({ type: 'keep', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-keep-housing]')!.onclick = () => purchase(purchaseKeepHousing, building => ({ type: 'keep-housing', buildingId: building.id }));
    element.querySelector<HTMLButtonElement>('[data-retinue-slot]')!.onclick = () => purchase(purchaseRetinueSlot, building => ({ type: 'retinue-slot', buildingId: building.id }));
    for (const action of ['trade', 'ally', 'war'] as const)
      element.querySelector<HTMLButtonElement>(`[data-village-action="${action}"]`)!.onclick =
        () => purchase((state, building) => performVillageAction(state, building, action), building => ({ type: 'village', buildingId: building.id, action }));
    for (const role of ['warriors', 'archers'] as const) element.querySelector<HTMLInputElement>(`[name="${role}"]`)!.oninput = event => {
      const building = this.building(), value = Number((event.target as HTMLInputElement).value) / 100;
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      const faction = this.getState().factions.find(candidate => candidate.id === building.faction)!;
      if (this.sendCommand?.({ type: 'archers', buildingId: building.id, fraction: role === 'archers' ? value : Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - spearmanFraction(faction) - value) })) return;
      if (setArcherFraction(this.getState(), building, role === 'archers' ? value : Math.max(0, 1 - mountedFraction(faction) - swordsmanFraction(faction) - spearmanFraction(faction) - value))) this.changed();
      this.refresh();
    };
    element.querySelector<HTMLInputElement>('[name="spearmen"]')!.oninput = event => {
      const building = this.building(), value = Number((event.target as HTMLInputElement).value) / 100;
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.({ type: 'spearmen', buildingId: building.id, fraction: value })) return;
      if (setSpearmanFraction(this.getState(), building, value)) this.changed();
      this.refresh();
    };
    element.querySelector<HTMLInputElement>('[name="levySlingers"]')!.oninput = event => {
      const state = this.getState(), building = state.buildings.find(b => b.id === this.buildingId);
      if (!building) return;
      const fraction = Number((event.target as HTMLInputElement).value) / 100;
      if (this.sendCommand?.({ type: 'levy-composition', buildingId: building.id, fraction })) return;
      if (setLevySlingerFraction(state, building, fraction)) this.changed();
    };
    element.querySelector<HTMLInputElement>('[name="swordsmen"]')!.oninput = event => {
      const building = this.building(), value = Number((event.target as HTMLInputElement).value) / 100;
      if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
      if (this.sendCommand?.({ type: 'swordsmen', buildingId: building.id, fraction: value })) return;
      if (setSwordsmanFraction(this.getState(), building, value)) this.changed();
      this.refresh();
    };
    for (const [type, setter] of [['horsemen', setHorsemanFraction], ['horse-archers', setHorseArcherFraction], ['knights', setKnightFraction]] as const) {
      element.querySelector<HTMLInputElement>(`[name="${type}"]`)!.oninput = event => {
        const building = this.building(), value = Number((event.target as HTMLInputElement).value) / 100;
        if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
        if (this.sendCommand?.({ type, buildingId: building.id, fraction: value })) return;
        if (setter(this.getState(), building, value)) this.changed();
        this.refresh();
      };
    }
    this.researchTree = new ResearchTree(element.querySelector<HTMLElement>('.activity-research')!, {
      allocate: allocation => purchase((state, building) => setResearchAllocation(state, building, allocation), building => ({ type: 'research-allocation', buildingId: building.id, allocation })),
      prioritize: branch => purchase((state, building) => prioritizeResearch(state, building, branch), building => ({ type: 'research-priority', buildingId: building.id, branch })),
      remove: branch => purchase((state, building) => removeResearchPriority(state, building, branch), building => ({ type: 'research-remove-priority', buildingId: building.id, branch })),
    });
    element.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
    element.addEventListener('pointerdown' , event => event.stopPropagation());
    element.addEventListener('wheel', event => event.stopPropagation());
  }

  get isOpen(): boolean { return this.buildingId !== null; }

  private building(): Building | undefined {
    return this.buildingId === null ? undefined : entityStore(this.getState()).buildings.get(this.buildingId);
  }

  close(): void {
    this.buildingId = null;
    this.researchTree.reset();
    this.element.hidden = true;
  }

  toggle(building: Building | undefined): void {
    if (!building || !buildingActivityAvailable(this.getState(), building) || building.id === this.buildingId) { this.close(); return; }
    this.buildingId = building.id;
    this.researchTree.reset();
    this.refresh();
  }

  refresh(): void {
    this.nextRefreshAt = performance.now() + CHECK_INTERVAL_MS;
    if (this.buildingId === null) return;
    const building = this.building();
    if (!building || !buildingActivityAvailable(this.getState(), building)) { this.close(); return; }
    const kind = buildingActivityKind(building), smithy = kind === 'blacksmith';
    this.element.classList.toggle('is-blacksmith', smithy);
    this.element.classList.toggle('is-archery', kind === 'archeryRange' || kind === 'scoutLodge' || kind === 'stable');
    this.element.classList.toggle('is-library', kind === 'library');
    this.element.classList.toggle('is-village', kind === 'village');
    const titles = { fort: 'Fort', governor: settlementLabel(building), blacksmith: 'Blacksmith', farm: 'Orchard upgrades', guardPost: 'Guard post', archeryRange: 'Army composition', library: 'Research', scoutLodge: 'Scouts’ Lodge', stable: 'Stable', village: 'Neutral village' };
    this.element.querySelector<HTMLElement>('#building-activity-title')!.textContent = titles[kind!];
    for (const [section, type] of [['fort', 'fort'], ['governor', 'governor'], ['upgrades', 'blacksmith'], ['spearmen', 'blacksmith'], ['orchard', 'farm'], ['guards', 'guardPost'], ['archery', 'archeryRange'], ['research', 'library'], ['scouts', 'scoutLodge'], ['stable', 'stable'], ['village', 'village']])
      this.element.querySelector<HTMLElement>(`.activity-${section}`)!.hidden = kind !== type;
    if (kind === 'governor') {
      const loyalty = building.loyalty, score = Math.round(loyalty?.value ?? LOYALTY_START), rate = Math.round((loyalty?.rate ?? 0) * 60);
      this.element.querySelector<HTMLElement>('.city-loyalty-summary')!.textContent = `Loyalty ${score}/100 · ${rate >= 0 ? '+' : ''}${rate}/min · Target ${Math.round(loyalty?.target ?? 70)}`;
      this.element.querySelector<HTMLElement>('.city-loyalty-factors')!.textContent = loyalty
        ? `Cities ${Math.round(loyalty.support) >= 0 ? '+' : ''}${Math.round(loyalty.support)} · Civic +${Math.min(20, loyalty.advanced * 4) + loyalty.monument * 12 + loyalty.guards * 3} · Borders −${Math.round(55 * Math.sqrt(loyalty.pressure))} · Losses −${Math.round(loyalty.trauma)}` : 'Develop this city and protect its residents to maintain loyalty.';
    }
    if (kind === 'fort') {
      const state = this.getState(), upgrade = upgradeFortBrigadeStatus(state, building), rebuild = rebuildFortStatus(state, building);
      const brigade = this.element.querySelector<HTMLButtonElement>('[data-fort-brigade]')!;
      const restore = this.element.querySelector<HTMLButtonElement>('[data-fort-rebuild]')!;
      brigade.hidden = !!building.fort?.destroyed; brigade.disabled = !upgrade.available; brigade.title = actionTooltip('Adds patrolling skirmishers to this fort.', upgrade.cost ?? 'Fully upgraded', 0, upgrade.reason);
      restore.hidden = !building.fort?.destroyed; restore.disabled = !rebuild.available; restore.title = actionTooltip('Rebuilds defenses on this permanent foundation.', rebuild.cost, 0, rebuild.reason);
      this.element.querySelector<HTMLElement>('.fort-brigade-effect')!.textContent = upgrade.nextCapacity === null ? 'Brigade fully upgraded' : `${upgrade.nextCapacity} patrolling skirmishers · ${upgrade.cost} gold`;
      this.element.querySelector<HTMLElement>('.fort-rebuild-effect')!.textContent = `${wholeNumber(rebuild.cost)} gold · Half initial price`;
      const count = state.units.filter(unit => unit.fort === building.id && unit.hp > 0).length;
      this.element.querySelector<HTMLElement>('.fort-status')!.textContent = building.fort?.destroyed ? 'Permanent foundation. Rebuild to restore defenses and borders.' : `${count}/${fortBrigadeCapacity(building)} skirmishers · 20 gold / 30s · Two arrow targets${building.fort?.funded === false ? ' · Awaiting upkeep' : ''}`;
    }
    if (smithy) for (const track of ['armor', 'weapon'] as const) {
      const status = blacksmithUpgradeStatus(this.getState(), building, track), button = this.upgrades[track];
      button.disabled = !status.available;
      const description = status.nextLevel === null ? `${multiplierPercent(status.currentMultiplier)} ${track === 'armor' ? 'defense' : 'attack'} · Fully upgraded`
        : `${multiplierPercent(status.currentMultiplier)} to ${multiplierPercent(status.multiplier)} ${track === 'armor' ? 'defense' : 'attack'} · ${status.cost} gold`;
      const coverage = track === 'armor' ? 'Leader, retinue and defensive buildings' : 'Leader, retinue and tower attacks';
      button.querySelector<HTMLElement>('.upgrade-label')!.textContent = status.nextLevel === null
        ? `${track === 'armor' ? 'Armor' : 'Weapon'} VI` : `Upgrade ${track} ${equipmentTiers[status.nextLevel - 1]}`;
      button.title = actionTooltip(description, status.cost ?? 'Fully upgraded', 0, status.available ? coverage : status.reason);
      button.setAttribute('aria-label', `Upgrade ${track}: ${button.title}`);
      button.querySelector<HTMLElement>('.upgrade-cost')!.textContent = status.cost === null ? 'Max' : String(status.cost);
      button.querySelector<HTMLElement>('.upgrade-price .icon')!.hidden = status.cost === null;
      button.classList.toggle('is-max', status.nextLevel === null);
      button.querySelectorAll<HTMLElement>('[data-level]').forEach(tier => {
        const level = Number(tier.dataset.level);
        tier.classList.toggle('complete', level <= status.level);
        tier.classList.toggle('current', level === status.level);
        tier.classList.toggle('next', level === status.nextLevel);
      });
    } else if (kind === 'governor') {
      const permissions = governorPermissions(building);
      this.farms.checked = permissions.farms; this.housing.checked = permissions.housing;
      const status = immigrationStatus(this.getState(), building);
      this.immigrants.disabled = !status.available;
      this.immigrants.title = actionTooltip('Adds one resident immediately, up to this city’s housing capacity.', IMMIGRANT_COST, 0, status.reason);
      this.immigrants.setAttribute('aria-label', `Import immigrants: ${this.immigrants.title}`);
      const retinue = retinueSlotPurchaseStatus(this.getState(), building), slotButton = this.element.querySelector<HTMLButtonElement>('[data-retinue-slot]')!;
      slotButton.disabled = !retinue.available;
      slotButton.title = actionTooltip('Adds one permanent retinue slot, filled through normal recruitment.', RETINUE_SLOT_COST, 0, `Upkeep: ${RETINUE_SLOT_UPKEEP} gold / ${RETINUE_SLOT_UPKEEP_INTERVAL}s. ${retinue.reason}`);
      slotButton.setAttribute('aria-label', `Buy retinue slot: ${RETINUE_SLOT_COST} gold · ${RETINUE_SLOT_UPKEEP} gold / ${RETINUE_SLOT_UPKEEP_INTERVAL}s upkeep. ${slotButton.title}`);
      const keep = isKeep(building), faction = this.getState().factions.find(candidate => candidate.id === building.faction);
      const upgrade = settlementUpgradeStatus(this.getState(), building), button = this.element.querySelector<HTMLButtonElement>('[data-keep]')!;
      button.hidden = keep || researchLevel(faction, 'woodenTower') === 0;
      button.disabled = !upgrade.available;
      button.classList.toggle('is-max', keep);
      button.querySelector<HTMLElement>('.upgrade-label')!.textContent = keep ? 'Keep' : 'Upgrade to Keep';
      button.querySelector<HTMLElement>('.keep-effect')!.textContent = keep ? `${building.capacity} housing · Arrows · Theft-proof` : `10× health · ${KEEP_HOUSING} housing · Arrows`;
      button.title = actionTooltip('Fortifies this settlement with arrows, more health and ten beds; protects stored gold.', 0, 0, upgrade.reason);
      const housingUpgrade = keepHousingUpgradeStatus(this.getState(), building), housingButton = this.element.querySelector<HTMLButtonElement>('[data-keep-housing]')!;
      housingButton.hidden = !keep; housingButton.disabled = !housingUpgrade.available;
      housingButton.classList.toggle('is-max', !!building.keepHousingExpanded);
      housingButton.querySelector<HTMLElement>('.upgrade-label')!.textContent = building.keepHousingExpanded ? 'Keep housing expanded' : 'Expand Keep housing';
      housingButton.querySelector<HTMLElement>('.upgrade-price')!.hidden = !!building.keepHousingExpanded;
      housingButton.querySelector<HTMLElement>('.keep-housing-effect')!.textContent = building.keepHousingExpanded
        ? `${building.capacity} total housing` : `+${KEEP_HOUSING_BONUS} housing · ${KEEP_HOUSING + KEEP_HOUSING_BONUS} total`;
      housingButton.title = actionTooltip(`Adds ${KEEP_HOUSING_BONUS} permanent beds to this Keep.`, KEEP_HOUSING_COST, 0, housingUpgrade.reason);
    }
    const levyPanel = this.element.querySelector<HTMLElement>('.activity-levy')!;
    levyPanel.hidden = kind !== 'governor' || !isKeep(building) || !researchLevel(this.getState().factions.find(f => f.id === building.faction), 'massLevy');
    if (!levyPanel.hidden) {
      const percent = Math.round(levySlingerFraction(this.getState(), building.faction) * 100);
      levyPanel.querySelector<HTMLInputElement>('input')!.value = String(percent);
      levyPanel.querySelector<HTMLOutputElement>('output')!.textContent = `${100 - percent}% / ${percent}%`;
    }
    if (smithy) {
      const state = this.getState(), faction = state.factions.find(candidate => candidate.id === building.faction)!;
      const counts = retinueComposition(state, building.faction), unlocked = canRecruitSpearmen(state, faction);
      const input = this.element.querySelector<HTMLInputElement>('[name="spearmen"]')!;
      input.max = String(100 - Math.round((mountedFraction(faction) + swordsmanFraction(faction)) * 100));
      input.disabled = !unlocked; input.value = String(Math.round(spearmanFraction(faction) * 100));
      this.element.querySelector<HTMLOutputElement>('.spearman-count')!.textContent = String(counts.spearmen);
      this.element.querySelector<HTMLElement>('.spearman-status')!.textContent = unlocked
        ? `${counts.currentSpearmen} trained · ${counts.spearmen} assigned${counts.training ? ` · ${counts.training} retraining` : ''}`
        : !areSpearmenUnlocked(faction) ? 'Requires Military tactics.' : 'Develop a copper mine inside your city borders.';
      const swords = this.element.querySelector<HTMLInputElement>('[name="swordsmen"]')!;
      swords.disabled = !areSwordsmenUnlocked(faction);
      swords.max = String(100 - Math.round(mountedFraction(faction) * 100));
      swords.value = String(Math.round(swordsmanFraction(faction) * 100));
      this.element.querySelector<HTMLOutputElement>('.swordsman-count')!.textContent = String(counts.swordsmen);
      this.element.querySelector<HTMLElement>('.swordsman-status')!.textContent = areSwordsmenUnlocked(faction)
        ? `${counts.currentSwordsmen} trained · ${counts.swordsmen} assigned · Twice spear attack; lower defense`
        : 'Requires Metal Casting.';

    }
    if (kind === 'farm') {
      for (const count of [1, 10] as const) {
        const status = orchardUpgradeStatus(this.getState(), building, count), button = this.element.querySelector<HTMLButtonElement>(`[data-orchard="${count}"]`)!;
        button.disabled = !status.available; button.title = actionTooltip(`Plants ${count} orchard${count === 1 ? '' : 's'} producing 50% more food.`, ORCHARD_UPGRADE_COST * count, 0, status.reason || 'Establishes in 120s.');
      }
      this.element.querySelector<HTMLElement>('.orchard-status')!.textContent = building.orchard
        ? orchardReady(building, this.getState().time) ? 'Established · 50% more food' : `Establishing · ${Math.ceil(building.orchard.readyAt - this.getState().time)}s remaining`
        : 'Orchards begin producing after 120s.';
    } else if (kind === 'guardPost') {
      const status = guardPostUpgradeStatus(this.getState(), building), button = this.element.querySelector<HTMLButtonElement>('[data-guards]')!;
      button.disabled = !status.available; button.title = actionTooltip('Increases the number of guards defending this city.', status.cost ?? 'Fully upgraded', 0, status.reason || `Upkeep: ${GUARD_POST_UPKEEPS[Math.min(2, guardPostLevel(building) + 1)]} gold / ${GUARD_POST_UPKEEP_INTERVAL}s.`);
      this.element.querySelector<HTMLElement>('.guard-capacity')!.textContent = status.nextCapacity ? `${status.capacity} to ${status.nextCapacity} guards` : `${status.capacity} guards · Fully upgraded`;
      this.element.querySelector<HTMLElement>('.guard-cost')!.textContent = status.cost === null ? 'Max' : String(status.cost);
      button.querySelector<HTMLElement>('.icon')!.hidden = status.cost === null;
      const wallsOnly = building.guardPost?.wallsOnly === true;
      this.element.querySelector<HTMLInputElement>('[name="guardWallsOnly"]')!.checked = wallsOnly;
      this.element.querySelector<HTMLElement>('#guard-walls-note')!.hidden = !wallsOnly;
      this.element.querySelector<HTMLElement>('.guard-status')!.textContent = `${guardPostUpkeep(building)} gold/${GUARD_POST_UPKEEP_INTERVAL}s upkeep · ${building.guardPost?.kills ?? 0} kills`;
    } else if (kind === 'archeryRange') {
      const state = this.getState(), faction = state.factions.find(faction => faction.id === building.faction)!, counts = retinueComposition(state, building.faction);
      const fraction = Math.round(archerFraction(faction) * 100);
      const unlocked = areArchersUnlocked(faction);
      for (const input of this.element.querySelectorAll<HTMLInputElement>('.activity-archery .composition-row input')) input.disabled = !unlocked;
      this.element.querySelector<HTMLInputElement>('[name="archers"]')!.value = String(fraction);
      const warriors = this.element.querySelector<HTMLInputElement>('[name="warriors"]')!;
      const spearmen = Math.round((spearmanFraction(faction) + swordsmanFraction(faction)) * 100);
      const mounted = Math.round(mountedFraction(faction) * 100);
      this.element.querySelector<HTMLInputElement>('[name="archers"]')!.max = String(100 - mounted - Math.round(swordsmanFraction(faction) * 100));
      warriors.max = String(100 - spearmen - mounted); warriors.value = String(Math.max(0, 100 - fraction - spearmen - mounted));
      this.element.querySelector<HTMLOutputElement>('.archer-count')!.textContent = String(counts.archers);
      this.element.querySelector<HTMLOutputElement>('.warrior-count')!.textContent = String(counts.warriors);
      this.element.querySelector<HTMLElement>('.archery-status')!.textContent = unlocked
        ? `${counts.total} retinue · ${fraction}% archers${counts.training ? ` · ${counts.training} retraining` : ''}`
        : 'Research Archery at the library to recruit archers.';
    } else if (kind === 'stable') {
      const state = this.getState(), faction = state.factions.find(faction => faction.id === building.faction)!, counts = retinueComposition(state, building.faction);
      for (const [name, output, fraction, unlocked, assigned] of [
        ['horsemen', 'horseman', horsemanFraction(faction), areHorsemenUnlocked(faction), counts.horsemen],
        ['horse-archers', 'horse-archer', horseArcherFraction(faction), areHorseArchersUnlocked(faction), counts.horseArchers],
        ['knights', 'knight', knightFraction(faction), areKnightsUnlocked(faction), counts.knights],
      ] as const) {
        const input = this.element.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        input.disabled = !unlocked; input.max = String(Math.round((1 - mountedFraction(faction) + fraction) * 100)); input.value = String(Math.round(fraction * 100));
        this.element.querySelector<HTMLOutputElement>(`.${output}-count`)!.textContent = unlocked ? String(assigned) : 'Locked';
      }
      this.element.querySelector<HTMLElement>('.stable-status')!.textContent = `${counts.currentHorsemen + counts.currentHorseArchers + counts.currentKnights} mounted · ${counts.horsemen + counts.horseArchers + counts.knights} assigned${counts.training ? ` · ${counts.training} retraining` : ''}`;
    } else if (kind === 'library') this.researchTree.refresh(this.getState(), building);
    else if (kind === 'village') {
      const status = villageDiplomacyStatus(this.getState(), building);
      if (!status) { this.close(); return; }
      this.element.querySelector<HTMLElement>('#building-activity-title')!.textContent = status.village.name;
      const relations = { neutral: 'Neutral', trade: 'Trading', allied: 'Allied', war: 'At war' };
      this.element.querySelector<HTMLElement>('.village-status')!.textContent = relations[status.relation]
        + (status.relation !== 'allied' && status.allianceDiscount ? ` · -${status.allianceDiscount} gold alliance discount` : '');
      const comparison = this.element.querySelector<HTMLElement>('.village-trade-comparison')!;
      const summary = villageTradeSummary(villageTradeQuote(this.getState(), status.village));
      if (this.villageSummaryMarkup !== summary) { comparison.innerHTML = summary; this.villageSummaryMarkup = summary; }
      const bonus = this.element.querySelector<HTMLElement>('.village-bonus')!;
      bonus.textContent = `Shared sight · ${status.bonusName}`;
      bonus.title = `${status.bonusDescription} The bonus ends if the camp is destroyed. Each 10 gold traded with you reduces the alliance price by 1, to a minimum of 500 gold.`;
      for (const action of ['trade', 'ally', 'war'] as const) {
        const button = this.element.querySelector<HTMLButtonElement>(`[data-village-action="${action}"]`)!, option = status[action];
        button.disabled = !option.available; button.title = actionTooltip(action === 'ally' ? 'Shares village sight, military support and a faction bonus.' : action === 'trade' ? 'Starts a caravan route from your nearest city.' : 'Allows your soldiers to attack this village.', option.cost, 0, option.reason);
        button.querySelector<HTMLElement>('.upgrade-label')!.textContent = action === 'trade' ? status.village.trading ? 'Trading' : 'Trade'
          : action === 'ally' ? status.relation === 'allied' ? 'Allied' : 'Ally' : status.relation === 'war' ? 'At war' : 'Declare war';
        const price = button.querySelector<HTMLElement>('.upgrade-price');
        if (price && price.dataset.cost !== String(option.cost)) {
          price.innerHTML = `${option.cost}${icon('gold')}`; price.dataset.cost = String(option.cost);
        }
      }
    }
    this.position(building, kind);
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
    const viewport = this.viewport();
    const layout = kind === 'library' ? {
      left: Math.round((viewport.width - this.element.offsetWidth) / 2),
      top: Math.round(Math.max(viewport.width > 760 && viewport.width <= 920 ? 82 : viewport.width <= 600 ? 68 : 48, (viewport.height - this.element.offsetHeight) / 2)),
      visible: true,
    } : activityPopupLayout(this.project(buildingActivityAnchor(building)), viewport,
      { width: this.element.offsetWidth, height: this.element.offsetHeight });
    this.element.hidden = !layout.visible;
    this.element.style.left = `${layout.left}px`;
    this.element.style.top = `${layout.top}px`;
  }
}
