/**
 * Unified loyalty score UI over a live game: the real city panel
 * (BuildingActivityPopup, governor section: "Loyalty N/100 · rate · Target"
 * with its factor line) and the real village diplomacy popup
 * (villageDiplomacyMarkup: affiliation with factors, independence and the exact
 * confederation threshold). Buttons go through diplomacyAction, the same call
 * src/main.ts makes, so "Request confederation" runs the Rust decision and,
 * when accepted, the real confederation transfer (the village becomes a city).
 *
 * The game stylesheet is scoped into a shadow root so its global rules (body
 * overflow, :root palette) do not leak into other stories.
 */
import gameCss from '../../src/style.css?inline';
import { BuildingActivityPopup } from '../../src/ui/building-activity';
import { villageDiplomacyActions, villageDiplomacyMarkup } from '../../src/ui/village-diplomacy';
import { villageCamp, villageDiplomacyStatus } from '../../src/game/villages';
import { diplomacyAction } from '../../src/game/simulation';
import { mountGameState, type MountedScenario } from '../harness/mount';
import { advanceEvolution, createEvolutionGame, EVOLUTION_DEFINITIONS, type EvolutionGame } from './fixture';
import { clock } from './frames';

export interface LoyaltyStoryOptions { time: number; width: number; height: number }

const OVERRIDES = `
  :host { all: initial; position: absolute; inset: 0; font-family: var(--game-font), monospace; color: #f5e7c5; pointer-events: none; }
  .dialog-backdrop { position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 16px; background: #0713144d; pointer-events: auto; z-index: 10; }
  .dialog { max-height: calc(100% - 32px); }
  .building-activity { pointer-events: auto; }
  .ve-outcome { position: absolute; left: 16px; bottom: 16px; max-width: 60%; padding: 8px 12px; background: #1a2a2bee; border: 4px solid #30403b; font-size: 16px; line-height: 20px; pointer-events: auto; }
`;

export function loyaltyStory(options: LoyaltyStoryOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 've-root';
  const title = document.createElement('div');
  title.className = 've-title';
  title.textContent = 'Loyalty and confederation';
  const subtitle = document.createElement('div');
  subtitle.className = 've-subtitle';
  subtitle.textContent = 'One affiliation score: city loyalty (left panel) and village affiliation (popup) come from the same Rust model.';
  const progress = document.createElement('div');
  progress.className = 've-progress';
  progress.textContent = 'Generating world...';
  const host = document.createElement('div');
  root.append(title, subtitle, progress, host);
  void build(root, host, progress, options).catch(error => {
    progress.textContent = `Story failed: ${error instanceof Error ? error.message : String(error)}`;
    progress.dataset.error = 'true';
    console.error(error);
  });
  return root;
}

async function build(root: HTMLElement, host: HTMLElement, progress: HTMLElement, options: LoyaltyStoryOptions): Promise<void> {
  for (let i = 0; i < 600 && !root.isConnected; i++) await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const game = createEvolutionGame(EVOLUTION_DEFINITIONS.roadside);
  await advanceEvolution(game, options.time, { progress: now => { progress.textContent = `Simulating ${clock(now)} of ${clock(options.time)}...`; } });
  const { state, village } = game;
  // Enough in the treasury for the tribute, so the decision rests on affiliation alone.
  state.factions[0].gold = Math.max(state.factions[0].gold, 1500);
  const palace = state.buildings.find(b => b.id === game.palace)!;
  // Village and capital sit in the left part of the view; the popup takes the right.
  const zoom = .8, shift = options.width * .22 / (32 * zoom);
  const camera = { x: (palace.x + 1 + game.center.x) / 2 + shift, y: (palace.y + 1 + game.center.y) / 2 };
  const mounted = await mountGameState(host, state, { camera, zoom, width: options.width, height: options.height });
  progress.textContent = `${village.name} at ${clock(state.time)}. Press Request confederation to ask.`;
  const viewport = mounted.element.querySelector<HTMLElement>('.tc-viewport')!;
  overlay(viewport, mounted, game, progress);
  (window as unknown as { __scenario?: MountedScenario }).__scenario = mounted;
}

function overlay(viewport: HTMLElement, mounted: MountedScenario, game: EvolutionGame, progress: HTMLElement): void {
  const { state, village } = game, renderer = mounted.renderer;
  const shadowHost = document.createElement('div');
  shadowHost.className = 've-ui-panel-host';
  viewport.append(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = gameCss.replace(/:root\b/g, ':host') + OVERRIDES;
  const panel = document.createElement('section');
  panel.id = 'building-activity'; panel.className = 'building-activity'; panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop'; backdrop.id = 'dialog';
  const dialog = document.createElement('section');
  dialog.className = 'dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-labelledby', 'dialog-title');
  const body = document.createElement('div');
  body.id = 'dialog-body';
  dialog.append(body); backdrop.append(dialog);
  const outcome = document.createElement('div');
  outcome.className = 've-outcome'; outcome.hidden = true;
  shadow.append(style, panel, backdrop, outcome);

  const city = new BuildingActivityPopup(panel, () => state, point => renderer.screenPoint(point),
    () => ({ width: renderer.width, height: renderer.height }), () => mounted.draw(0), () => undefined);
  const palace = state.buildings.find(b => b.id === game.palace);
  if (palace) city.toggle(palace);

  const camp = villageCamp(state, village)!;
  const show = (message = ''): void => {
    const status = villageDiplomacyStatus(state, camp, true);
    if (!status) { backdrop.hidden = true; return; }
    backdrop.hidden = false;
    body.innerHTML = villageDiplomacyMarkup(state, status, 0);
    const result = shadow.querySelector<HTMLElement>('#war-result')!;
    result.textContent = message;
    if (message) dialog.scrollTop = dialog.scrollHeight;
    shadow.querySelector<HTMLButtonElement>('#cancel-war')!.onclick = () => { backdrop.hidden = true; };
    for (const action of villageDiplomacyActions(status)) shadow.querySelector<HTMLButtonElement>(`#village-${action}`)!.onclick = () => {
      const outcomeResult = diplomacyAction(state, village.faction, action, camp.id);
      if (outcomeResult.ok) {
        backdrop.hidden = true;
        outcome.hidden = false; outcome.textContent = outcomeResult.message;
        progress.textContent = outcomeResult.message;
        root(shadowHost).dataset.outcome = 'accepted';
        mounted.draw(0);
      } else {
        show(outcomeResult.message);
        root(shadowHost).dataset.outcome = 'refused';
      }
    };
  };
  show();

  const tick = (): void => {
    if (!shadowHost.isConnected) return;
    city.update(performance.now());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const root = (element: HTMLElement): HTMLElement => element.closest<HTMLElement>('.ve-root') ?? element;
