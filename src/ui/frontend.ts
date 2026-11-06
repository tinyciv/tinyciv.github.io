import { FACTION_COLORS, type LobbyRoom, type MatchOptions } from '../multiplayer/protocol';
import { DEFAULT_WORLD_STYLE, LANDFORM_NAMES, WORLD_GENERATION_STYLES, WORLD_STYLE_DESCRIPTIONS, WORLD_STYLE_NAMES } from '../world/options';
import { DEFAULT_BANDIT_INTENSITY, MIN_BANDIT_INTENSITY, MAX_BANDIT_INTENSITY } from '../game/bandit-intensity';
import './frontend.css';

export type FrontendView = 'main' | 'single' | 'servers' | 'lobby' | 'options' | 'controls' | 'loading' | 'error';
export interface FrontendSettings { zoom: number; minZoom: number; maxZoom: number; follow: boolean; fullscreen: boolean; banditIntensity: number; enemyStrength: number; autoRebuildDefenses: boolean; }
export type FrontendAction =
  | { type: 'resume' | 'continue' | 'save' | 'multiplayer' | 'refresh' | 'leave' | 'start' | 'retry' | 'main' | 'cancel-loading' }
  | { type: 'new'; options: MatchOptions }
  | { type: 'create'; name: string; playerName: string; color: string; options: MatchOptions }
  | { type: 'join'; roomId: string; name: string; color: string }
  | { type: 'profile'; name: string; color: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'settings'; settings: Partial<FrontendSettings> };
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const freshSeed = () => `TinyCiv-${Math.floor(Math.random() * 900000 + 100000)}`;

/** A presentation-only shell. Session ownership and network requests stay in main. */
export class Frontend {
  private view: FrontendView = 'loading';
  private returnView: FrontendView = 'main';
  private resumable = false;
  private saved = false;
  private online = false;
  private rooms: LobbyRoom[] = [];
  private room: LobbyRoom | null = null;
  private selfId = '';
  private ping = 0;
  private selectedRoom = '';
  private name = 'Commander';
  private color: string = FACTION_COLORS[0];
  private options: MatchOptions = { seed: freshSeed(), style: DEFAULT_WORLD_STYLE, landformFamily: 'mixed' };
  private roomName = '';
  private status = '';
  private loadingTitle = 'Loading';
  private progress: number | undefined;
  private cancellableLoading = false;
  private canReturnFromError = true;
  private settings: FrontendSettings = { zoom: 1, minZoom: .55, maxZoom: 3, follow: true, fullscreen: false, banditIntensity: DEFAULT_BANDIT_INTENSITY, enemyStrength: 1, autoRebuildDefenses: true };
  private lobbySignature = '';
  constructor(readonly element: HTMLElement, private readonly action: (action: FrontendAction) => void) {
    element.className = 'frontend'; element.setAttribute('role', 'dialog'); element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-labelledby', 'frontend-title');
    element.addEventListener('click', event => this.click(event));
    element.addEventListener('submit', event => this.submit(event));
    element.addEventListener('change', event => this.change(event));
    element.addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (input.name === 'enemy-strength') this.updateEnemyLabel(Number(input.value) / 100);
      if (input.name === 'bandit-intensity') this.updateBanditLabel(Number(input.value) / 100);
    });
    element.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.back(); }
      if (event.key !== 'Tab') return;
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(node => !!node.getClientRects().length);
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    });
    this.render();
  }
  get active(): boolean { return !this.element.hidden; }
  get currentView(): FrontendView { return this.view; }
  setSession(resumable: boolean, saved: boolean, online = false): void { this.resumable = resumable; this.saved = saved; this.online = online; }
  setSettings(settings: FrontendSettings): void { this.settings = settings; }
  show(view: FrontendView = 'main'): void {
    if (['options', 'controls'].includes(view) && !['options', 'controls'].includes(this.view)) this.returnView = this.view;
    this.view = view; this.element.hidden = false; this.render();
    this.element.querySelector<HTMLElement>('button:not(:disabled),input')?.focus({ preventScroll: true });
  }
  hide(): void { this.element.hidden = true; }
  loading(title: string, status: string, progress?: number, cancellable = false): void {
    this.loadingTitle = title; this.status = status; this.progress = progress; this.cancellableLoading = cancellable; this.show('loading');
  }
  setStatus(message: string): void { this.status = message; const node = this.element.querySelector('.frontend-status'); if (node) node.textContent = message; }
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
    if (this.view === 'loading') { if (this.cancellableLoading) this.action({ type: 'cancel-loading' }); return; }
    if (this.view === 'error' && !this.canReturnFromError) return;
    if (this.view === 'lobby') { this.action({ type: 'leave' }); return; }
    if (['options', 'controls'].includes(this.view)) { this.show(this.returnView); return; }
    if (this.view === 'main' && this.resumable) this.action({ type: 'resume' });
    else { this.action({ type: 'main' }); this.show('main'); }
  }
  private worldFields(): string {
    const styles = [DEFAULT_WORLD_STYLE, ...WORLD_GENERATION_STYLES.filter(style => style !== DEFAULT_WORLD_STYLE)];
    return `<label>World shape<select name="style" aria-describedby="frontend-world-style-description">${styles.map(id => `<option value="${id}" ${id === this.options.style ? 'selected' : ''}>${WORLD_STYLE_NAMES[id]}</option>`).join('')}</select></label><p id="frontend-world-style-description" class="frontend-hint" data-world-style-description>${WORLD_STYLE_DESCRIPTIONS[this.options.style]}</p><label>Landscape<select name="landform" ${this.options.style === 'mediterranean' ? 'disabled' : ''}>${Object.entries(LANDFORM_NAMES).map(([id, label]) => `<option value="${id}" ${id === this.options.landformFamily ? 'selected' : ''}>${id === 'rift-lakes' ? 'Rift lakes' : id === 'dissected-plateau' ? 'Plateaus' : label}</option>`).join('')}</select></label><label>Seed<input name="seed" maxlength="64" value="${escape(this.options.seed)}" autocomplete="off"></label>`;
  }
  private profileFields(): string {
    return `<label>Name<input name="player-name" maxlength="24" value="${escape(this.name)}" autocomplete="nickname"></label><label>Color<select name="player-color">${FACTION_COLORS.map((color, i) => `<option value="${color}" ${color === this.color ? 'selected' : ''}>${['Blue', 'Red', 'Gold', 'Green', 'Violet', 'Orange'][i]}</option>`).join('')}</select></label>`;
  }
  private readOptions(form: HTMLFormElement): MatchOptions {
    const data = new FormData(form);
    const style = data.get('style') as MatchOptions['style'];
    return { seed: String(data.get('seed') || '').trim() || freshSeed(), style, landformFamily: style === 'mediterranean' ? 'mixed' : data.get('landform') as MatchOptions['landformFamily'], advancedStart: data.get('advanced-start') === 'on' };
  }
  private readProfile(form: HTMLFormElement): void {
    const data = new FormData(form); this.name = String(data.get('player-name') || '').trim() || 'Commander'; this.color = String(data.get('player-color') || FACTION_COLORS[0]);
  }
  private submit(event: Event): void {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (form.dataset.form === 'single') this.action({ type: 'new', options: this.readOptions(form) });
    if (form.dataset.form === 'server') { this.readProfile(form); this.action({ type: 'create', name: String(new FormData(form).get('room-name') || '').trim() || `${this.name}'s game`, playerName: this.name, color: this.color, options: this.readOptions(form) }); }
    if (form.dataset.form === 'profile') { this.readProfile(form); this.action({ type: 'profile', name: this.name, color: this.color }); }
  }
  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.dataset.view) { this.show(button.dataset.view as FrontendView); return; }
    if (button.dataset.room) { this.selectedRoom = button.dataset.room; this.render(); return; }
    const action = button.dataset.frontendAction;
    if (action === 'back') { this.back(); return; }
    if (action === 'join') { const form = this.element.querySelector<HTMLFormElement>('[data-form="server"]'); if (form) this.readProfile(form); this.action({ type: 'join', roomId: this.selectedRoom, name: this.name, color: this.color }); return; }
    if (action === 'fullscreen') { this.action({ type: 'settings', settings: { fullscreen: !document.fullscreenElement } }); return; }
    if (action) this.action({ type: action } as FrontendAction);
  }
  private change(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.name === 'style' && input.form) this.updateWorldOptions(input.form);
    if (input.name === 'ready') this.action({ type: 'ready', ready: input.checked });
    if (input.name === 'zoom') this.action({ type: 'settings', settings: { zoom: Number(input.value) } });
    if (input.name === 'auto-rebuild-defenses') this.action({ type: 'settings', settings: { autoRebuildDefenses: input.checked } });
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
    const landform = form.elements.namedItem('landform') as HTMLSelectElement | null;
    if (landform) {
      landform.disabled = style === 'mediterranean';
      if (landform.disabled) landform.value = 'mixed';
    }
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
    const title: Record<FrontendView, string> = { main: 'TinyCiv', single: 'Single player', servers: 'Multiplayer', lobby: 'Lobby', options: 'Options', controls: 'Controls', loading: this.loadingTitle, error: 'Error' };
    let body = '';
    if (this.view === 'main') body = `<nav class="frontend-main-actions" aria-label="Main menu">${this.resumable ? '<button class="primary" data-frontend-action="resume">Resume game</button>' : this.saved ? '<button class="primary" data-frontend-action="continue">Continue</button>' : ''}${!this.online ? '<button data-view="single">Single player</button><button data-frontend-action="multiplayer">Multiplayer</button>' : '<button data-frontend-action="leave">Leave match</button>'}<button data-view="options">Options</button><button data-view="controls">Controls</button>${this.resumable && !this.online ? '<button data-frontend-action="save">Save game</button>' : ''}</nav>${this.online ? '<p class="frontend-hint">Online matches do not pause.</p>' : ''}`;
    if (this.view === 'single') body = `<form data-form="single" class="frontend-form">${this.worldFields()}<label class="frontend-check"><input type="checkbox" name="advanced-start" ${this.options.advancedStart ? 'checked' : ''}>Advanced start</label><p class="frontend-hint">250 population · Every building · 12 retinue · All 4 soldier types</p><p class="frontend-hint">Replaces your single-player save.</p><button class="primary" type="submit">New game</button></form>`;
    if (this.view === 'servers') body = `<div class="server-browser"><div class="server-toolbar"><button data-frontend-action="refresh">Refresh</button><button class="primary" data-frontend-action="join" ${!this.selectedRoom || !this.rooms.some(room => room.id === this.selectedRoom && room.players.length < 2 && room.phase === 'waiting') ? 'disabled' : ''}>Join selected</button></div><div class="server-table-wrap"><table><thead><tr><th>Name</th><th>Location</th><th>Players</th><th>Ping</th></tr></thead><tbody>${this.rooms.length ? this.rooms.map(room => `<tr class="${room.id === this.selectedRoom ? 'is-selected' : ''}"><td><button data-room="${escape(room.id)}" ${room.phase !== 'waiting' || room.players.length >= 2 ? 'disabled' : ''}>${escape(room.name)}</button></td><td>${escape(room.location)}</td><td>${room.players.length} / 2</td><td>${this.ping ? `${Math.round(this.ping)} ms` : '--'}</td></tr>`).join('') : '<tr><td colspan="4">No open games.</td></tr>'}</tbody></table></div><form data-form="server" class="frontend-form server-create"><h2>New 1v1 game</h2>${this.profileFields()}<label>Game name<input name="room-name" maxlength="40" placeholder="Game name"></label><details><summary>World options</summary>${this.worldFields()}</details><button class="primary" type="submit">Create game</button></form></div>`;
    if (this.view === 'lobby') {
      const room = this.room, self = room?.players.find(player => player.id === this.selfId), host = room?.hostId === this.selfId;
      body = room ? `<nav class="lobby-tabs" aria-label="Lobby tabs"><button class="is-active" type="button">Team</button><button data-view="options">Options</button><button data-view="controls">Controls</button></nav><h2>${escape(room.name)}</h2><p class="frontend-hint">${escape(room.location)} · ${escape(room.options.seed)} · ${WORLD_STYLE_NAMES[room.options.style]}</p><div class="lobby-players">${[0, 1].map(faction => { const player = room.players.find(player => player.faction === faction); return `<div class="lobby-player"><span class="faction-swatch" style="--faction:${player?.color || '#64716c'}"></span><div><strong>${player ? escape(player.name) : 'Waiting for opponent'}</strong><span>${player ? `${player.id === room.hostId ? 'Host' : 'Guest'} · ${player.ready ? 'Ready' : 'Not ready'}${player.connected ? '' : ' · Reconnecting'}` : ''}</span></div></div>`; }).join('')}</div><form data-form="profile" class="frontend-form lobby-profile">${this.profileFields()}<button type="submit">Apply</button></form><div class="lobby-bottom"><label class="frontend-check"><input name="ready" type="checkbox" ${self?.ready ? 'checked' : ''}>Ready</label>${host ? `<button class="primary" data-frontend-action="start" ${room.players.length !== 2 || room.players.some(player => !player.ready || !player.connected) ? 'disabled' : ''}>Start match</button>` : '<span>Waiting for host.</span>'}</div>` : '<p>Returning to games...</p>';
    }
    if (this.view === 'options') body = `<div class="frontend-form"><div class="frontend-bandits"><label for="bandit-intensity"><span class="frontend-slider-heading">Bandit intensity<output data-bandit-value for="bandit-intensity"></output></span></label><input id="bandit-intensity" name="bandit-intensity" type="range" min="${MIN_BANDIT_INTENSITY * 100}" max="${MAX_BANDIT_INTENSITY * 100}" step="25" value="${this.settings.banditIntensity * 100}" aria-describedby="bandit-intensity-hint" ${this.online || this.room ? 'disabled' : ''}><div class="frontend-slider-scale" aria-hidden="true"><span>Off</span><span>3×</span></div><p class="frontend-hint" id="bandit-intensity-hint">${this.online || this.room ? 'Fixed for this multiplayer match.' : 'Scales raid frequency and raider limits. Existing raiders remain.'}</p></div><div class="frontend-bandits"><label for="enemy-strength"><span class="frontend-slider-heading">Enemy strength<output data-enemy-value for="enemy-strength"></output></span></label><input id="enemy-strength" name="enemy-strength" type="range" min="25" max="300" step="25" value="${this.settings.enemyStrength * 100}" ${this.online || this.room ? 'disabled' : ''}><div class="frontend-slider-scale" aria-hidden="true"><span>25%</span><span>300%</span></div><p class="frontend-hint">Enemy health, damage and gold income.</p></div><label class="frontend-check"><input name="auto-rebuild-defenses" type="checkbox" ${this.settings.autoRebuildDefenses ? 'checked' : ''}>Automatically rebuild defenses</label><p class="frontend-hint">Rebuild destroyed walls and towers using gold and builders. Existing construction orders continue when disabled.</p><label>Camera zoom<input name="zoom" type="range" min="${this.settings.minZoom}" max="${this.settings.maxZoom}" step=".05" value="${this.settings.zoom}"></label><label class="frontend-check"><input name="follow" type="checkbox" ${this.settings.follow ? 'checked' : ''}>Follow the Leader</label><button data-frontend-action="fullscreen">${document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}</button></div>`;
    if (this.view === 'controls') body = `<dl class="frontend-controls"><dt>WASD / arrows</dt><dd>Move the Leader; in Formation 3, W/S advance/reverse and A/D strafe; in a boat, W/S control throttle</dd><dt>Right click</dt><dd>Move, attack, or diplomacy</dd><dt>Left click</dt><dd>Select units and buildings</dd><dt>1 / E</dt><dd>Recall; hold E to steer right in a boat or rotate Formation 3</dd><dt>2 / Q</dt><dd>Change stance; hold Q to steer left in a boat or rotate Formation 3</dd><dt>3</dt><dd>Toggle close ranks after Infantry Drill; hold Q/E to rotate continuously; release to stop</dd><dt>4 / 5</dt><dd>Raise/dismiss levy; garrison/recall city defenders</dd><dt>Boats</dt><dd>Hold Q/E to steer; allow room to coast and brake</dd><dt>Shift</dt><dd>Separate mob / travel movement setting</dd><dt>B / F</dt><dd>Buildings / fortifications</dd><dt>C</dt><dd>Clear trees and structures</dd><dt>Mouse wheel</dt><dd>Camera zoom</dd><dt>Home</dt><dd>Center on the Leader</dd><dt>Space / + / -</dt><dd>Pause / speed in single player</dd><dt>Escape</dt><dd>Close panels or open the menu</dd></dl>`;
    if (this.view === 'loading') body = `<div class="frontend-loading"><progress aria-label="Loading progress" ${this.progress === undefined ? '' : `value="${this.progress}"`} max="1"></progress></div>${this.cancellableLoading ? '<button data-frontend-action="cancel-loading">Cancel</button>' : ''}`;
    if (this.view === 'error') body = `<div class="frontend-error-actions"><button class="primary" data-frontend-action="retry">Retry</button>${this.canReturnFromError ? '<button data-frontend-action="main">Main menu</button>' : ''}</div>`;
    this.element.innerHTML = `<section class="frontend-panel frontend-${this.view}"><header><h1 id="frontend-title">${escape(title[this.view])}</h1>${this.view !== 'main' && this.view !== 'loading' && this.view !== 'error' ? '<button class="frontend-back" data-frontend-action="back">Back</button>' : ''}</header>${body}<p class="frontend-status" role="status" aria-live="polite">${escape(this.status)}</p></section>`;
    const roomName = this.element.querySelector<HTMLInputElement>('[name="room-name"]'); if (roomName) roomName.value = this.roomName;
    const worldForm = this.element.querySelector<HTMLSelectElement>('[name="style"]')?.form;
    if (worldForm) this.updateWorldOptions(worldForm);
    if (this.view === 'options') { this.updateBanditLabel(this.settings.banditIntensity); this.updateEnemyLabel(this.settings.enemyStrength); }
    if (focusedName) this.element.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`)?.focus({ preventScroll: true });
  }
}
