import { runtimeArtUrl } from '../game/runtime-art';
import { FACTION_COLORS, type LobbyRoom, type MatchOptions } from '../multiplayer/protocol';
import { DEFAULT_WORLD_STYLE, LANDFORM_NAMES, WORLD_GENERATION_STYLES, WORLD_STYLE_DESCRIPTIONS, WORLD_STYLE_NAMES } from '../world/options';
import { DEFAULT_BANDIT_INTENSITY, MIN_BANDIT_INTENSITY, MAX_BANDIT_INTENSITY } from '../game/bandit-intensity';
import { BARBARIANS, CLIMATES, LAND_MASSES, TEMPERATURES, WORLD_SIZES, initialWorldSetup, newGameOptions, type NewGameOptions } from './world-generation';
import type { AdvancedStartPhase } from '../game/advanced-start';
import { SCENARIOS, type ScenarioId } from '../game/scenario-content';
import { AccountScreen, isAccountView, type AccountView } from './account-screen';
import type { AccountCredentials, AccountUser } from '../account/client';
import { FeedbackDialog } from './feedback-dialog';
import { AUTOSAVE_ID, type StoredGameSummary } from '../game/game-storage';
import { menuPlate } from './menu-plate';
import { movementGuideMarkup } from './movement-guide';
import './frontend.css';
import './world-generation.css';

export type FrontendView = AccountView | 'main' | 'game-menu' | 'single' | 'scenarios' | 'save' | 'saves' | 'servers' | 'lobby' | 'options' | 'controls' | 'fame' | 'credits' | 'loading' | 'error';
/** One finished single-player reign, kept by main in local storage. */
export interface HallOfFameEntry { result: 'Victory' | 'Defeat'; civilization: string; seed: string; minutes: number; population: number; date: string }
export interface FrontendSettings { zoom: number; minZoom: number; maxZoom: number; follow: boolean; fullscreen: boolean; banditIntensity: number; enemyStrength: number; autoRebuildDefenses: boolean; infiniteGold?: boolean;
  /** Development builds offer Reveal map for an offline game in progress. */
  revealMapAvailable?: boolean; revealMap?: boolean; }
export type FrontendAction =
  | ({ type: 'account-submit' } & AccountCredentials)
  | { type: 'account-logout' | 'account-guest' }
  | { type: 'feedback-submit'; message: string; signedIn: boolean }
  | { type: 'resume' | 'saves' | 'exit-game' | 'multiplayer' | 'refresh' | 'leave' | 'start' | 'retry' | 'main' | 'cancel-loading' }
  | { type: 'save'; name: string }
  | { type: 'load'; id: string }
  | { type: 'new'; options: NewGameOptions }
  | { type: 'create'; name: string; playerName: string; color: string; options: MatchOptions }
  | { type: 'join'; roomId: string; name: string; color: string }
  | { type: 'profile'; name: string; color: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'settings'; settings: Partial<FrontendSettings> };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const menuButton = ([label, attributes]: [string, string]) =>
  `<button type="button" class="menu-button" ${attributes}>${menuPlate}<span>${label}</span></button>`;
/** Advanced start slider: 0 standard, 1 midpoint research, 2 every technology. */
const START_STEPS: readonly (AdvancedStartPhase | undefined)[] = [undefined, 'midpoint', 'complete'];
const START_LABELS = ['Off', 'Midpoint', 'All techs'];
const START_TITLES = ['A young town of 20 people and your Leader.',
  '250 population, half the research tree, houses in blocks with wells, and 12 retinue.',
  '250 population, every technology researched, every building, and 12 retinue.'];
const freshSeed = () => `TinyCiv-${Math.floor(Math.random() * 900000 + 100000)}`;
/** World generation aligns its controls with a 1672 × 941 illustration. */
const SCENE_WIDTH = 1672, SCENE_HEIGHT = 941;
const CREDITS: [string, string][] = [
  ['Puny World, Puny Characters and Miniworld', 'Shade (Merchant Shade), with octoshrimpy · CC0'],
  ['Tiny Overworld hills and mountains', 'Luis Zuno (ansimuz)'],
  ['[LPC] Rocks', 'bluecarrot16 and contributors'],
  ['Overworld fields, grain and sailing', 'PixelHole'],
  ['Pixel Operator typeface', 'Jayvee Enaguas (HarvettFox96) · CC0'],
  ['Rendering', 'PixiJS'],
];

/** A presentation-only shell. Session ownership and network requests stay in main. */
export class Frontend {
  private view: FrontendView = 'loading';
  private returnView: FrontendView = 'main';
  private resumable = false;
  private saves: StoredGameSummary[] = [];
  private saveName = '';
  private savesBusy = false;
  private online = false;
  private rooms: LobbyRoom[] = [];
  private room: LobbyRoom | null = null;
  private selfId = '';
  private ping = 0;
  private selectedRoom = '';
  private selectedScenario: ScenarioId = 'tutorial';
  private name = 'Commander';
  private color: string = FACTION_COLORS[0];
  private options: MatchOptions = { seed: freshSeed(), style: DEFAULT_WORLD_STYLE, landformFamily: 'mixed' };
  private readonly worldSetup = initialWorldSetup();
  /** Index into START_STEPS. */
  private advancedStart = 0;
  private roomName = '';
  private status = '';
  private loadingTitle = 'Loading';
  private progress: number | undefined;
  private cancellableLoading = false;
  private movementGuide = false;
  private canReturnFromError = true;
  private settings: FrontendSettings = { zoom: 1, minZoom: .55, maxZoom: 3, follow: true, fullscreen: false, banditIntensity: DEFAULT_BANDIT_INTENSITY, enemyStrength: 1, autoRebuildDefenses: true };
  private lobbySignature = '';
  private hallOfFame: HallOfFameEntry[] = [];
  private readonly content: HTMLElement;
  private readonly feedback: FeedbackDialog;
  private readonly account: AccountScreen;
  private accountUser: AccountUser | null = null;
  private accountBusy = false;
  private layoutKey = '';
  constructor(readonly element: HTMLElement, private readonly action: (action: FrontendAction) => void) {
    element.className = 'frontend'; element.setAttribute('role', 'dialog'); element.setAttribute('aria-modal', 'true');
    const backdrop = document.createElement('picture');
    backdrop.className = 'menu-back'; backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <source media="(max-aspect-ratio: 3/4)" srcset="/assets/ui/main-menu/centered-backdrop-portrait.webp">
      <img src="/assets/ui/main-menu/centered-backdrop.webp" alt="" draggable="false">
    `;
    this.content = document.createElement('div');
    this.content.className = 'menu-front';
    element.replaceChildren(backdrop, this.content);
    this.account = new AccountScreen(element);
    this.feedback = new FeedbackDialog(element, message => this.action({ type: 'feedback-submit', message, signedIn: this.accountUser !== null }), () => {
      this.content.inert = false;
      this.content.querySelector<HTMLButtonElement>('[data-frontend-action="help"]')?.focus({ preventScroll: true });
    });
    addEventListener('resize', () => { if (this.active) this.layout(); });
    element.addEventListener('click', event => this.click(event));
    element.addEventListener('submit', event => this.submit(event));
    element.addEventListener('change', event => this.change(event));
    element.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (input.name === 'save-name') { this.saveName = input.value; input.setCustomValidity(''); }
      if (input.form?.dataset.form === 'account') {
        const confirm = input.form.elements.namedItem('account-confirm');
        if (confirm instanceof HTMLInputElement) confirm.setCustomValidity('');
      }
      if (input.name === 'enemy-strength') this.updateEnemyLabel(Number(input.value) / 100);
      if (input.name === 'bandit-intensity') this.updateBanditLabel(Number(input.value) / 100);
      if (input.name === 'advanced-start') this.updateStartLabel(input);
    });
    element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (this.account.modalOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!event.repeat) this.back();
      }
      if ((this.view === 'main' || this.view === 'game-menu') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const buttons = [...this.content.querySelectorAll<HTMLButtonElement>('.menu-buttons .menu-button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        event.preventDefault(); return;
      }
      if (this.view === 'scenarios' && (event.target as HTMLElement).closest('.scenario-list')
        && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-select-scenario]')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
        const button = buttons[next];
        if (button) { this.selectScenario(button.dataset.selectScenario as ScenarioId); button.focus({ preventScroll: true }); button.scrollIntoView({ block: 'nearest' }); }
        event.preventDefault(); return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')].filter(node => {
        if (!node.getClientRects().length) return false;
        if (node instanceof HTMLInputElement && node.type === 'radio' && !node.checked && node.form?.querySelector(`input[type="radio"][name="${CSS.escape(node.name)}"]:checked`)) return false;
        return true;
      });
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0]?.focus(); }
    });
    this.render();
  }
  get active(): boolean { return !this.element.hidden; }
  get inGame(): boolean { return this.element.classList.contains('in-game'); }
  get currentView(): FrontendView { return this.view; }
  setInGame(value: boolean): void { this.element.classList.toggle('in-game', value); }
  setSession(resumable: boolean, online = false): void { this.resumable = resumable; this.online = online; }
  setAccount(user: AccountUser | null): void {
    this.accountUser = user; this.feedback.setAccount(user);
    if (this.active && !isAccountView(this.view)) this.render();
  }
  openFeedback(): void { this.content.inert = true; this.feedback.open(this.accountUser); }
  setFeedbackBusy(busy: boolean): void { this.feedback.setBusy(busy); }
  setFeedbackResult(message: string, success = false): void { this.feedback.result(message, success); }
  setAccountBusy(busy: boolean): void {
    this.accountBusy = busy;
    this.element.querySelectorAll<HTMLButtonElement>('.account-submit,[data-frontend-action="account-logout"]').forEach(button => button.disabled = busy);
    if (!busy && this.account.modalOpen) this.account.creationStatus();
  }
  setAccountMessage(message: string): void { this.account.setMessage(message); }
  showAccountCreated(): void { this.account.creationStatus('Account created!'); }
  setSaves(saves: StoredGameSummary[], defaultName?: string): void {
    this.saves = saves;
    if (defaultName !== undefined) this.saveName = defaultName;
    if (this.view === 'saves' || this.view === 'save') this.render();
  }
  setSavesBusy(busy: boolean): void {
    this.savesBusy = busy;
    if (this.view === 'saves' || this.view === 'save') {
      this.render();
      if (!this.element.contains(document.activeElement)) this.content.querySelector<HTMLElement>('#frontend-title')?.focus({ preventScroll: true });
    }
  }
  setSettings(settings: FrontendSettings): void {
    if (this.settings.banditIntensity !== settings.banditIntensity) this.worldSetup.barbarians = settings.banditIntensity;
    this.settings = settings;
  }
  setHallOfFame(entries: HallOfFameEntry[]): void { this.hallOfFame = entries; if (this.view === 'fame' && this.active) this.render(); }
  show(view: FrontendView = 'main'): void {
    if (isAccountView(this.view)) this.account.rememberFields(this.element.querySelector('[data-form="account"]'));
    if (this.view !== view) {
      this.account.clearMessage();
      this.content.scrollTop = 0;
    }
    if (this.inGame && view === 'controls') this.returnView = this.view === 'options' ? 'options' : 'game-menu';
    else if (['options', 'controls'].includes(view) && !['options', 'controls'].includes(this.view)) this.returnView = this.view;
    this.view = view; this.element.hidden = false; this.render(); this.layout();
    const focus = view === 'login' ? '[name="account-identifier"]' : view === 'create-account' ? '[name="account-username"]'
      : view === 'forgot-password' ? '[name="account-email"]' : view === 'single' ? '.worldgen-back'
      : view === 'scenarios' ? '[data-select-scenario][aria-pressed="true"]' : view === 'save' ? '[name="save-name"]'
      : view === 'game-menu' ? '.game-menu-actions [data-frontend-action="resume"]' : 'button:not(:disabled),input:not(:disabled)';
    (this.element.querySelector<HTMLElement>(focus) ?? this.content.querySelector<HTMLElement>('#frontend-title[tabindex]'))?.focus({ preventScroll: true });
  }
  hide(): void { this.feedback.close(); this.element.hidden = true; }
  /** Select compact controls and fit the illustrated world generation screen. */
  private layout(): void {
    const width = innerWidth, height = innerHeight, key = `${this.view}:${width}x${height}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    const compact = width < 720 || width / height < 1.15 || this.view === 'scenarios' && width < 1100;
    this.element.classList.toggle('is-compact', compact);
    if (this.view === 'single') {
      const scale = Math.min(width / SCENE_WIDTH, height / SCENE_HEIGHT);
      this.element.style.setProperty('--worldgen-scale', String(scale));
      this.element.style.setProperty('--worldgen-x', `${(width - SCENE_WIDTH * scale) / 2}px`);
      this.element.style.setProperty('--worldgen-y', `${(height - SCENE_HEIGHT * scale) / 2}px`);
    }
  }
  loading(title: string, _status: string, progress?: number, cancellable = false, movementGuide = false): void {
    const reuse = this.view === 'loading' && this.cancellableLoading === cancellable
      && this.movementGuide === movementGuide && this.content.querySelector('progress');
    this.loadingTitle = title; this.status = '';
    this.progress = progress === undefined ? undefined : Math.max(0, Math.min(1, progress));
    this.cancellableLoading = cancellable;
    this.movementGuide = movementGuide;
    if (!reuse) { this.show('loading'); return; }
    // Keep the animated sprite mounted while completed work updates progress.
    this.element.hidden = false;
    this.content.querySelector('#frontend-title')!.textContent = title;
    const bar = this.content.querySelector('progress')!;
    if (this.progress === undefined) bar.removeAttribute('value');
    else bar.value = this.progress;
    this.content.querySelector('.frontend-loading-percent')!.textContent = this.progress === undefined ? '' : `${Math.round(this.progress * 100)}%`;
    this.layout();
  }
  setStatus(message: string): void { this.status = message; const node = this.element.querySelector('.frontend-status'); if (node) node.textContent = this.view === 'loading' ? '' : message; }
  error(message: string, canReturn = true): void { this.status = message; this.canReturnFromError = canReturn; this.show('error'); }
  setRooms(rooms: LobbyRoom[], ping: number): void { this.rooms = rooms; this.ping = ping; if (this.view === 'servers') this.render(); }
  setRoom(room: LobbyRoom | null, selfId: string): void {
    this.room = room; this.selfId = selfId;
    const self = room?.players.find(player => player.id === selfId);
    if (self) { this.name = self.name; this.color = self.color; }
    const signature = JSON.stringify(room);
    if (signature === this.lobbySignature) return;
    this.lobbySignature = signature;
    if (room && (this.view === 'servers' || this.view === 'lobby')) this.show('lobby');
    else if (this.view === 'lobby') this.show('servers');
  }
  private back(): void {
    if (this.accountBusy || (this.view === 'saves' || this.view === 'save') && this.savesBusy) return;
    if (this.inGame) {
      if (this.view === 'game-menu') this.action({ type: 'resume' });
      else {
        this.setStatus('');
        this.show(this.view === 'controls' && this.returnView === 'options' ? 'options' : 'game-menu');
      }
      return;
    }
    if (this.view === 'login') { this.action({ type: 'account-guest' }); return; }
    if (isAccountView(this.view)) { this.show('login'); return; }
    if (this.view === 'loading') { if (this.cancellableLoading) this.action({ type: 'cancel-loading' }); return; }
    if (this.view === 'error' && !this.canReturnFromError) return;
    if (this.view === 'lobby') { this.action({ type: 'leave' }); return; }
    if (['options', 'controls'].includes(this.view)) { this.show(this.returnView); return; }
    if (this.view === 'fame' || this.view === 'credits' || this.view === 'scenarios') { this.show('main'); return; }
    if (this.view === 'main' && this.resumable) this.action({ type: 'resume' });
    else { this.action({ type: 'main' }); this.show('main'); }
  }
  private worldFields(): string {
    const styles = [DEFAULT_WORLD_STYLE, ...WORLD_GENERATION_STYLES.filter(style => style !== DEFAULT_WORLD_STYLE)];
    return `<label>World shape<select name="style" aria-describedby="frontend-world-style-description">${styles.map(id => `<option value="${id}" ${id === this.options.style ? 'selected' : ''}>${WORLD_STYLE_NAMES[id]}</option>`).join('')}</select></label><p id="frontend-world-style-description" class="frontend-hint" data-world-style-description>${WORLD_STYLE_DESCRIPTIONS[this.options.style]}</p><label>Landscape<select name="landform">${Object.entries(LANDFORM_NAMES).map(([id, label]) => `<option value="${id}" ${id === this.options.landformFamily ? 'selected' : ''}>${id === 'rift-lakes' ? 'Rift lakes' : id === 'dissected-plateau' ? 'Plateaus' : label}</option>`).join('')}</select></label><label>Seed<input name="seed" maxlength="64" value="${escape(this.options.seed)}" autocomplete="off"></label>`;
  }
  private worldGenerationFields(): string {
    const setup = this.worldSetup;
    const nearest = BARBARIANS.reduce((best, choice) =>
      Math.abs(choice.value - setup.barbarians) < Math.abs(best.value - setup.barbarians) ? choice : best, BARBARIANS[0]);
    const radio = (name: string, value: string, label: string, checked: boolean, title = label) =>
      `<label class="worldgen-radio" title="${escape(title)}"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
    const environment = (name: 'climate' | 'temperature', heading: string, labels: readonly string[]) =>
      `<fieldset class="worldgen-environment worldgen-${name}"><legend>${heading}</legend><div class="worldgen-region-preview" aria-hidden="true"></div><div class="worldgen-environment-choices">${labels.map((label, index) => `<label class="worldgen-tile" title="${label}"><input type="radio" name="world-${name}" value="${index}" ${setup[name] === index ? 'checked' : ''}><span class="worldgen-thumb" aria-hidden="true"></span><span>${label}</span></label>`).join('')}</div></fieldset>`;
    return `<form data-form="single" class="worldgen-form" data-climate="${setup.climate}" data-temperature="${setup.temperature}">
      <fieldset class="worldgen-size"><legend>World Size</legend><div class="worldgen-radio-list">${WORLD_SIZES.map(size => radio('world-size', size.id, size.label, setup.size === size.id, `${size.label} · ${size.width} × ${size.height} tiles`)).join('')}</div></fieldset>
      <div class="worldgen-map" role="img" aria-label="Illustration of the selected world shape"><span class="worldgen-map-art"></span></div>
      <fieldset class="worldgen-barbarians"><legend>Barbarians</legend><div class="worldgen-radio-list">${BARBARIANS.map(choice => radio('world-barbarians', String(choice.value), choice.label, nearest === choice, `${choice.label} · ${choice.value * 100}% bandit intensity`)).join('')}</div></fieldset>
      <fieldset class="worldgen-land"><legend>Land Mass and Water Coverage</legend><div class="worldgen-land-choices">${LAND_MASSES.map(mass => `<div class="worldgen-land-group" data-landmass="${mass.id}"><div class="worldgen-water-choices">${[80, 70, 60].map(water => `<label class="worldgen-tile" title="${mass.label} · ${water}% water target"><input type="radio" name="world-landmass" id="world-landmass-${mass.id}-${water}" value="${mass.id}:${water}" aria-label="${mass.label}, ${water}% Water" ${setup.landmass === mass.id && setup.water === water ? 'checked' : ''}><span class="worldgen-thumb" aria-hidden="true"></span></label>`).join('')}</div><h3><label for="world-landmass-${mass.id}-70" data-landmass-caption="${mass.id}">${mass.label}${setup.landmass === mass.id ? ` (${setup.water}% Water)` : ''}</label></h3></div>`).join('')}</div></fieldset>
      ${environment('climate', 'Climate', CLIMATES)}${environment('temperature', 'Temperature', TEMPERATURES)}
      <footer class="worldgen-footer"><button class="menu-button worldgen-back" type="button" data-frontend-action="back">${menuPlate}<span>Back</span></button>
      <label class="worldgen-advanced-start" title="${START_TITLES[this.advancedStart]}"><span>Advanced Start</span><input type="range" name="advanced-start" min="0" max="2" step="1" value="${this.advancedStart}" aria-valuetext="${START_LABELS[this.advancedStart]}"><output data-start-value>${START_LABELS[this.advancedStart]}</output></label>
      <button class="menu-button worldgen-generate" type="submit">${menuPlate}<span>Generate World</span></button></footer></form>`;
  }
  private updateStartLabel(input: HTMLInputElement): void {
    const step = Number(input.value) || 0, output = input.parentElement?.querySelector('output');
    if (output) output.value = START_LABELS[step];
    input.setAttribute('aria-valuetext', START_LABELS[step]);
    input.parentElement?.setAttribute('title', START_TITLES[step]);
  }
  private updateWorldGeneration(form: HTMLFormElement): void {
    for (const name of ['climate', 'temperature'] as const) form.dataset[name] = String(this.worldSetup[name]);
    for (const mass of LAND_MASSES) {
      const caption = form.querySelector(`[data-landmass-caption="${mass.id}"]`);
      if (caption) caption.textContent = mass.label + (this.worldSetup.landmass === mass.id ? ` (${this.worldSetup.water}% Water)` : '');
    }
    const map = form.querySelector<HTMLElement>('.worldgen-map');
    if (map) {
      map.dataset.landmass = this.worldSetup.landmass;
      map.dataset.water = String(this.worldSetup.water);
      map.setAttribute('aria-label', `${LAND_MASSES.find(mass => mass.id === this.worldSetup.landmass)!.label}, ${this.worldSetup.water}% water target. Illustrative preview.`);
    }
  }
  private profileFields(): string {
    return `<label>Name<input name="player-name" maxlength="24" value="${escape(this.name)}" autocomplete="nickname"></label><label>Color<select name="player-color">${FACTION_COLORS.map((color, i) => `<option value="${color}" ${color === this.color ? 'selected' : ''}>${['Blue', 'Red', 'Gold', 'Green', 'Violet', 'Orange'][i]}</option>`).join('')}</select></label>`;
  }
  private readOptions(form: HTMLFormElement): MatchOptions {
    const data = new FormData(form);
    const style = data.get('style') as MatchOptions['style'];
    return { seed: String(data.get('seed') || '').trim() || freshSeed(), style, landformFamily: (data.get('landform') || 'mixed') as MatchOptions['landformFamily'] };
  }
  private readProfile(form: HTMLFormElement): void {
    const data = new FormData(form); this.name = String(data.get('player-name') || '').trim() || 'Commander'; this.color = String(data.get('player-color') || FACTION_COLORS[0]);
  }
  private submit(event: Event): void {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.dataset.form === 'save') {
      if (this.savesBusy || !this.resumable || this.online) return;
      const input = form.elements.namedItem('save-name') as HTMLInputElement;
      const name = input.value.trim();
      if (!name) { input.setCustomValidity('Enter a save name.'); input.reportValidity(); return; }
      this.action({ type: 'save', name }); return;
    }
    if (form.dataset.form === 'account') {
      if (!this.accountBusy) this.account.submit(form, credentials => this.action({ type: 'account-submit', ...credentials }));
      return;
    }
    if (form.dataset.form === 'single') {
      const options = newGameOptions({ seed: freshSeed(), style: DEFAULT_WORLD_STYLE, landformFamily: 'mixed',
        advancedStart: START_STEPS[this.advancedStart] }, this.worldSetup);
      this.action({ type: 'new', options });
    }
    if (form.dataset.form === 'server') { this.readProfile(form); this.action({ type: 'create', name: String(new FormData(form).get('room-name') || '').trim() || `${this.name}'s game`, playerName: this.name, color: this.color, options: this.readOptions(form) }); }
    if (form.dataset.form === 'profile') { this.readProfile(form); this.action({ type: 'profile', name: this.name, color: this.color }); }
  }
  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled || this.accountBusy) return;
    if (button.dataset.accountAction === 'google') { this.account.google(); return; }
    if (button.dataset.view) { this.show(button.dataset.view as FrontendView); return; }
    if (button.dataset.selectScenario) { this.selectScenario(button.dataset.selectScenario as ScenarioId); return; }
    if (button.dataset.scenario) {
      const scenario = SCENARIOS.find(scenario => scenario.id === button.dataset.scenario);
      if (scenario) this.action({ type: 'new', options: { seed: `Scenario:${scenario.id}`, style: DEFAULT_WORLD_STYLE, landformFamily: 'mixed', scenario: scenario.id } });
      return;
    }
    if (button.dataset.room) { this.selectedRoom = button.dataset.room; this.render(); return; }
    if (button.dataset.saveId) { if (!this.savesBusy) this.action({ type: 'load', id: button.dataset.saveId }); return; }
    const action = button.dataset.frontendAction;
    if (action === 'help') { this.openFeedback(); return; }
    if (action === 'back') { this.back(); return; }
    if (action === 'join') { const form = this.element.querySelector<HTMLFormElement>('[data-form="server"]'); if (form) this.readProfile(form); this.action({ type: 'join', roomId: this.selectedRoom, name: this.name, color: this.color }); return; }
    if (action === 'fullscreen') { this.action({ type: 'settings', settings: { fullscreen: !document.fullscreenElement } }); return; }
    if (action === 'quick') { this.action({ type: 'new', options: { seed: freshSeed(), style: 'pangaea',
      landformFamily: 'mixed', banditIntensity: DEFAULT_BANDIT_INTENSITY, banditStrength: .5 } }); return; }
    if (action) this.action({ type: action } as FrontendAction);
  }
  private change(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.form?.dataset.form === 'single') {
      if (input.name === 'world-size') this.worldSetup.size = input.value;
      if (input.name === 'world-barbarians') this.worldSetup.barbarians = Number(input.value);
      if (input.name === 'world-landmass') {
        const [mass, water] = input.value.split(':');
        this.worldSetup.landmass = mass as typeof this.worldSetup.landmass;
        this.worldSetup.water = Number(water);
      }
      for (const name of ['climate', 'temperature'] as const) if (input.name === `world-${name}`) this.worldSetup[name] = Number(input.value);
      if (input.name === 'advanced-start') this.advancedStart = Number(input.value) || 0;
      this.updateWorldGeneration(input.form);
    }
    if (input.name === 'style' && input.form) this.updateWorldOptions(input.form);
    if (input.name === 'ready') this.action({ type: 'ready', ready: input.checked });
    if (input.name === 'zoom') this.action({ type: 'settings', settings: { zoom: Number(input.value) } });
    if (input.name === 'auto-rebuild-defenses') this.action({ type: 'settings', settings: { autoRebuildDefenses: input.checked } });
    if (input.name === 'infinite-gold') this.action({ type: 'settings', settings: { infiniteGold: input.checked } });
    if (input.name === 'reveal-map') this.action({ type: 'settings', settings: { revealMap: input.checked } });
    if (input.name === 'follow') this.action({ type: 'settings', settings: { follow: input.checked } });
    if (input.name === 'enemy-strength' && !this.online && !this.room) {
      this.action({ type: 'settings', settings: { enemyStrength: Number(input.value) / 100 } });
      this.updateEnemyLabel(this.settings.enemyStrength);
    }
    if (input.name === 'bandit-intensity' && !this.online && !this.room) {
      this.action({ type: 'settings', settings: { banditIntensity: Number(input.value) / 100 } });
      this.updateBanditLabel(this.settings.banditIntensity);
    }
  }
  private updateWorldOptions(form: HTMLFormElement): void {
    const style = (form.elements.namedItem('style') as HTMLSelectElement | null)?.value as MatchOptions['style'] | undefined;
    if (!style) return;
    const description = form.querySelector<HTMLElement>('[data-world-style-description]');
    if (description) description.textContent = WORLD_STYLE_DESCRIPTIONS[style];
  }
  private updateEnemyLabel(value: number): void {
    const text = `${Math.round(value * 100)}%`;
    const output = this.element.querySelector<HTMLOutputElement>('[data-enemy-value]');
    if (output) output.value = text;
    this.element.querySelector<HTMLInputElement>('[name="enemy-strength"]')?.setAttribute('aria-valuetext', text);
  }
  private updateBanditLabel(value: number): void {
    const text = value === 0 ? '0% · Off' : `${Math.round(value * 100)}%${value === 1 ? ' · Normal' : ''}`;
    const output = this.element.querySelector<HTMLOutputElement>('[data-bandit-value]');
    if (output) output.value = text;
    this.element.querySelector<HTMLInputElement>('[name="bandit-intensity"]')?.setAttribute('aria-valuetext', text);
  }
  /** Reuse the generated brass menu plates; labels follow the session. */
  private scenarioInformation(): string {
    const scenario = SCENARIOS.find(scenario => scenario.id === this.selectedScenario)!;
    return `<header class="scenario-heading"><h2 id="scenario-name">${escape(scenario.name)}</h2><span>${scenario.factions} faction${scenario.factions === 1 ? '' : 's'} · ${escape(scenario.size)}</span></header>
      <figure class="scenario-world"><img src="${runtimeArtUrl(`${import.meta.env.BASE_URL}${scenario.mapPreview}`)}" alt="World map for ${escape(scenario.name)}" draggable="false"><figcaption>World map</figcaption></figure>
      <div class="scenario-copy"><p class="scenario-description">${escape(scenario.description)}</p></div>
      <button class="menu-button scenario-start" type="button" data-scenario="${scenario.id}" aria-label="Play ${escape(scenario.name)}">${menuPlate}<span>Play scenario</span></button>`;
  }
  private selectScenario(id: ScenarioId): void {
    if (!SCENARIOS.some(scenario => scenario.id === id)) return;
    this.selectedScenario = id;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-select-scenario]')) {
      const selected = button.dataset.selectScenario === id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const information = this.element.querySelector('.scenario-information');
    if (information) information.innerHTML = this.scenarioInformation();
  }
  private menuItems(): [string, string][] {
    const items: [string, string][] = [];
    if (this.resumable) {
      items.push(['Resume Game', 'data-frontend-action="resume"']);
      if (this.online) items.push(['Leave Match', 'data-frontend-action="leave"']);
      else items.push(['New Game', 'data-view="single"'], ['Save / Load', 'data-frontend-action="saves"']);
    } else items.push(['New Game', 'data-view="single"'], ['Quick Start', 'data-frontend-action="quick"'],
      ['Load Game', 'data-frontend-action="saves"']);
    if (!this.online) items.push(['Scenarios', 'data-view="scenarios"']);
    items.push(['Preferences', 'data-view="options"'],
      this.online ? ['Controls', 'data-view="controls"'] : ['Multiplayer', 'data-frontend-action="multiplayer"']);
    items.push(['Help', 'data-frontend-action="help"']);
    if (!this.accountUser) items.push(['Sign in / Create account', 'data-view="login"']);
    return items;
  }
  private gameMenuItems(): [string, string][] {
    const items: [string, string][] = [['Resume', 'data-frontend-action="resume"']];
    if (!this.online) items.push(['New Game', 'data-view="single"'], ['Save Game', 'data-view="save"'], ['Load Game', 'data-frontend-action="saves"']);
    items.push(['Preferences', 'data-view="options"'], ['Controls', 'data-view="controls"'], ['Exit to Menu', 'data-frontend-action="exit-game"']);
    return items;
  }
  private render(): void {
    const form = this.element.querySelector<HTMLFormElement>('form');
    if (form && !(this.view === 'lobby' && form.dataset.form === 'server')) {
      if (form.elements.namedItem('player-name')) this.readProfile(form);
      if (form.elements.namedItem('seed')) this.options = this.readOptions(form);
      const roomName = form.elements.namedItem('room-name') as HTMLInputElement | null;
      if (roomName) this.roomName = roomName.value;
    }
    const active = this.element.contains(document.activeElement) ? document.activeElement as HTMLInputElement : null;
    const focusedName = active?.getAttribute('name');
    const title: Record<FrontendView, string> = { login: 'Sign in', 'create-account': 'Create account', 'forgot-password': 'Reset password', main: 'TinyCiv', 'game-menu': 'Game Menu', single: 'New Game', scenarios: 'Scenarios', save: 'Save Game', saves: this.resumable && !this.online && !this.inGame ? 'Save / Load Game' : 'Load Game', servers: 'Multiplayer', lobby: 'Lobby', options: 'Preferences', controls: 'Controls', fame: 'Hall of Fame', credits: 'Credits', loading: this.loadingTitle, error: 'Error' };
    let body = '';
    if (this.view === 'game-menu') body = `<nav class="menu-buttons game-menu-actions" aria-label="Game menu">${this.gameMenuItems().map(menuButton).join('')}</nav>`;
    if (this.view === 'main') body = `<nav class="menu-buttons" aria-label="Main menu">${this.menuItems().map(menuButton).join('')}</nav>${this.online ? '<p class="frontend-hint">Online matches do not pause.</p>' : ''}`;
    if (this.view === 'main' && this.accountUser) body = `<button class="account-link menu-account" type="button" data-frontend-action="account-logout" ${this.accountBusy ? 'disabled' : ''}>${escape(this.accountUser.displayName)} · Sign out</button>` + body;
    if (isAccountView(this.view)) body = this.account.markup(this.view);
    if (this.view === 'scenarios') body = `<div class="scenario-browser"><nav class="scenario-list menu-buttons" aria-label="Scenarios">${SCENARIOS.map(scenario => `<button class="menu-button scenario-choice${scenario.id === this.selectedScenario ? ' is-selected' : ''}" type="button" data-select-scenario="${scenario.id}" aria-pressed="${scenario.id === this.selectedScenario}" aria-controls="scenario-information">
      ${menuPlate}<span>${escape(scenario.name)}</span></button>`).join('')}</nav><section id="scenario-information" class="scenario-information" aria-labelledby="scenario-name">${this.scenarioInformation()}</section></div>`;
    if (this.view === 'fame') body = this.hallOfFame.length
      ? `<ol class="fame-list">${this.hallOfFame.slice(0, 12).map(entry => `<li class="fame-${entry.result.toLowerCase()}"><strong>${escape(entry.result)} · ${escape(entry.civilization)}</strong><span>Population ${Math.round(entry.population)} · ${Math.max(1, Math.round(entry.minutes))} min · ${escape(entry.date)}</span><span class="fame-seed">${escape(entry.seed)}</span></li>`).join('')}</ol>`
      : '<p class="frontend-hint">No recorded reigns.</p>';
    if (this.view === 'credits') body = `<dl class="credits-list">${CREDITS.map(([work, author]) => `<dt>${escape(work)}</dt><dd>${escape(author)}</dd>`).join('')}</dl>`;
    if (this.view === 'single') body = this.worldGenerationFields();
    const savesDisabled = this.savesBusy ? 'disabled' : '';
    if (this.view === 'save' || this.view === 'saves' && this.resumable && !this.online && !this.inGame)
      body = `<form data-form="save" class="frontend-form save-form"><label>Save name<input name="save-name" maxlength="80" required autocomplete="off" value="${escape(this.saveName)}" ${savesDisabled}></label><button class="menu-button save-button" type="submit" ${savesDisabled}>${menuPlate}<span>${this.accountUser ? 'Save to Cloud' : 'Save Game'}</span></button></form>`;
    if (this.view === 'saves') {
      body += this.saves.length ? `<ul class="save-list">${this.saves.map(save => `<li${save.id === AUTOSAVE_ID ? ' class="is-autosave"' : ''}><strong>${escape(save.name)}</strong><span>${escape(new Date(save.savedAt).toLocaleString())}</span><span>${escape(save.civilization)} · ${Math.floor(save.time / 60)} min</span><span class="save-seed">${escape(save.seed)}</span><button class="menu-button save-button" type="button" data-save-id="${escape(save.id)}" aria-label="${escape(`Load ${save.name}`)}" ${savesDisabled}>${menuPlate}<span>Load</span></button></li>`).join('')}</ul>` : this.savesBusy ? '' : '<p>No saved games.</p>';
    }
    if (this.view === 'servers') body = `<div class="server-browser"><div class="server-toolbar"><button data-frontend-action="refresh">Refresh</button><button class="primary" data-frontend-action="join" ${!this.selectedRoom || !this.rooms.some(room => room.id === this.selectedRoom && room.players.length < 2 && room.phase === 'waiting') ? 'disabled' : ''}>Join selected</button></div><div class="server-table-wrap"><table><thead><tr><th>Name</th><th>Location</th><th>Players</th><th>Ping</th></tr></thead><tbody>${this.rooms.length ? this.rooms.map(room => `<tr class="${room.id === this.selectedRoom ? 'is-selected' : ''}"><td><button data-room="${escape(room.id)}" ${room.phase !== 'waiting' || room.players.length >= 2 ? 'disabled' : ''}>${escape(room.name)}</button></td><td>${escape(room.location)}</td><td>${room.players.length} / 2</td><td>${this.ping ? `${Math.round(this.ping)} ms` : '--'}</td></tr>`).join('') : '<tr><td colspan="4">No open games.</td></tr>'}</tbody></table></div><form data-form="server" class="frontend-form server-create"><h2>New 1v1 game</h2>${this.profileFields()}<label>Game name<input name="room-name" maxlength="40" placeholder="Game name"></label><details><summary>World options</summary>${this.worldFields()}</details><button class="primary" type="submit">Create game</button></form></div>`;
    if (this.view === 'lobby') {
      const room = this.room, self = room?.players.find(player => player.id === this.selfId), host = room?.hostId === this.selfId;
      body = room ? `<nav class="lobby-tabs" aria-label="Lobby tabs"><button class="is-active" type="button">Team</button><button data-view="options">Options</button><button data-view="controls">Controls</button></nav><h2>${escape(room.name)}</h2><p class="frontend-hint">${escape(room.location)} · ${escape(room.options.seed)} · ${WORLD_STYLE_NAMES[room.options.style]}</p><div class="lobby-players">${[0, 1].map(faction => { const player = room.players.find(player => player.faction === faction); return `<div class="lobby-player"><span class="faction-swatch" style="--faction:${player?.color || '#64716c'}"></span><div><strong>${player ? escape(player.name) : 'Waiting for opponent'}</strong><span>${player ? `${player.id === room.hostId ? 'Host' : 'Guest'} · ${player.ready ? 'Ready' : 'Not ready'}${player.connected ? '' : ' · Reconnecting'}` : ''}</span></div></div>`; }).join('')}</div><form data-form="profile" class="frontend-form lobby-profile">${this.profileFields()}<button type="submit">Apply</button></form><div class="lobby-bottom"><label class="frontend-check"><input name="ready" type="checkbox" ${self?.ready ? 'checked' : ''}>Ready</label>${host ? `<button class="primary" data-frontend-action="start" ${room.players.length !== 2 || room.players.some(player => !player.ready || !player.connected) ? 'disabled' : ''}>Start match</button>` : '<span>Waiting for host.</span>'}</div>` : '<p>Returning to games...</p>';
    }
    if (this.view === 'options') body = `<div class="frontend-form"><div class="frontend-bandits"><label for="bandit-intensity"><span class="frontend-slider-heading">Bandit intensity<output data-bandit-value for="bandit-intensity"></output></span></label><input id="bandit-intensity" name="bandit-intensity" type="range" min="${MIN_BANDIT_INTENSITY * 100}" max="${MAX_BANDIT_INTENSITY * 100}" step="25" value="${this.settings.banditIntensity * 100}" ${this.online || this.room ? 'disabled' : ''}><div class="frontend-slider-scale" aria-hidden="true"><span>Off</span><span>3×</span></div></div><div class="frontend-bandits"><label for="enemy-strength"><span class="frontend-slider-heading">Enemy strength<output data-enemy-value for="enemy-strength"></output></span></label><input id="enemy-strength" name="enemy-strength" type="range" min="25" max="300" step="25" value="${this.settings.enemyStrength * 100}" ${this.online || this.room ? 'disabled' : ''}><div class="frontend-slider-scale" aria-hidden="true"><span>25%</span><span>300%</span></div></div><label class="frontend-check"><input name="auto-rebuild-defenses" type="checkbox" ${this.settings.autoRebuildDefenses ? 'checked' : ''}>Automatically rebuild defenses</label><label class="frontend-check"><input name="infinite-gold" type="checkbox" ${this.settings.infiniteGold ? 'checked' : ''} ${this.online || this.room ? 'disabled' : ''}>Infinite gold</label>${this.settings.revealMapAvailable ? `<label><input name="reveal-map" type="checkbox" ${this.settings.revealMap ? 'checked' : ''}>Reveal map</label>` : ''}<label>Camera zoom<input name="zoom" type="range" min="${this.settings.minZoom}" max="${this.settings.maxZoom}" step=".05" value="${this.settings.zoom}"></label><label class="frontend-check"><input name="follow" type="checkbox" ${this.settings.follow ? 'checked' : ''}>Follow the Leader</label><button data-frontend-action="fullscreen">${document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}</button><button data-view="controls">Controls</button></div>`;
    if (this.view === 'controls') body = `<dl class="frontend-controls"><dt>WASD / arrows</dt><dd>Move the Leader; in Formation 3, W/S advance/reverse and A/D strafe; in a boat, W/S control throttle</dd><dt>Right click</dt><dd>Move, attack, or diplomacy</dd><dt>Left click</dt><dd>Select units and buildings</dd><dt>1 / E</dt><dd>Recall; hold E to steer right in a boat or rotate Formation 3</dd><dt>2 / Q</dt><dd>Change stance; hold Q to steer left in a boat or rotate Formation 3</dd><dt>3</dt><dd>Toggle formation after Infantry Drill; hold Q/E to rotate continuously; release to stop</dd><dt>4 / 5</dt><dd>Raise/dismiss levy; garrison/recall city defenders</dd><dt>Boats</dt><dd>Hold Q/E to steer; allow room to coast and brake</dd><dt>Shift</dt><dd>Separate mob / travel movement setting</dd><dt>B / F</dt><dd>Buildings / fortifications</dd><dt>C</dt><dd>Clear trees and structures</dd><dt>Mouse wheel</dt><dd>Camera zoom</dd><dt>Home</dt><dd>Center on the Leader</dd><dt>Space / + / -</dt><dd>Pause / speed in single player</dd><dt>Escape</dt><dd>Close panels or open the menu</dd></dl>`;
    if (this.view === 'loading') body = `${this.movementGuide ? movementGuideMarkup() : ''}<div class="frontend-loading">${this.movementGuide ? '' : '<span class="frontend-loading-spinner" aria-hidden="true"></span>'}<progress class="frontend-progress" aria-labelledby="frontend-title" ${this.progress === undefined ? '' : `value="${this.progress}"`} max="1"></progress><output class="frontend-loading-percent" aria-hidden="true">${this.progress === undefined ? '' : `${Math.round(this.progress * 100)}%`}</output></div>${this.cancellableLoading ? '<button data-frontend-action="cancel-loading">Cancel</button>' : ''}`;
    if (this.view === 'error') body = `<div class="frontend-error-actions"><button class="primary" data-frontend-action="retry">Retry</button>${this.canReturnFromError ? '<button data-frontend-action="main">Main menu</button>' : ''}</div>`;
    const heading = this.view === 'game-menu' ? ''
      : this.view === 'main' ? '<h1 id="frontend-title" class="menu-title"><span>TinyCiv</span></h1>'
      : this.view === 'single' ? '<header class="worldgen-heading"><span class="worldgen-brand" aria-label="TinyCiv">TinyCiv</span><h1 id="frontend-title">World Generation</h1></header>'
      : this.view === 'loading' ? `<h1 id="frontend-title" class="frontend-loading-title">${escape(this.loadingTitle)}</h1>`
      : `<header><h1 id="frontend-title"${this.inGame ? ' tabindex="-1"' : ''}>${escape(title[this.view])}</h1>${this.view === 'error' ? '' : ['scenarios', 'saves'].includes(this.view)
        ? `<button class="menu-button frontend-back" data-frontend-action="back">${menuPlate}<span>Back</span></button>`
        : '<button class="frontend-back" data-frontend-action="back">Back</button>'}</header>`;
    if (heading) {
      this.element.setAttribute('aria-labelledby', 'frontend-title');
      this.element.removeAttribute('aria-label');
    } else {
      this.element.removeAttribute('aria-labelledby');
      this.element.setAttribute('aria-label', title[this.view]);
    }
    this.element.classList.toggle('is-world-generation', this.view === 'single');
    const panel = ['main', 'game-menu', 'single'].includes(this.view) ? '' : 'menu-sheet ';
    this.content.innerHTML = `<section class="frontend-panel ${panel}${isAccountView(this.view) ? 'frontend-account ' : ''}frontend-${this.view}">${heading}${body}<p class="frontend-status" role="status" aria-live="polite">${isAccountView(this.view) || this.view === 'loading' ? '' : escape(this.status)}</p></section>`;
    if (this.view === 'saves' || this.view === 'save') {
      this.content.firstElementChild?.setAttribute('aria-busy', String(this.savesBusy));
      const back = this.content.querySelector<HTMLButtonElement>('.frontend-back');
      if (back) back.disabled = this.savesBusy;
    }
    const roomName = this.element.querySelector<HTMLInputElement>('[name="room-name"]'); if (roomName) roomName.value = this.roomName;
    const worldForm = this.element.querySelector<HTMLSelectElement>('[name="style"]')?.form;
    if (worldForm) this.updateWorldOptions(worldForm);
    const singleForm = this.element.querySelector<HTMLFormElement>('[data-form="single"]');
    if (singleForm) this.updateWorldGeneration(singleForm);
    if (this.view === 'options') { this.updateBanditLabel(this.settings.banditIntensity); this.updateEnemyLabel(this.settings.enemyStrength); }
    if (focusedName) this.element.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`)?.focus({ preventScroll: true });
  }
}
