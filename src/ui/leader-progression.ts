import { leaderProgressionView, LEADER_SKILL_IDS, leaderSkillMaxRank, skillName, skillEffect, type LeaderSkillId } from '../game/leader-progression';
import type { GameState } from '../game/types';
import './leader-progression.css';

/** Small, crisp glyphs share the palette and silhouettes of the approved pixel concept. */
function skillIcon(skill: LeaderSkillId): string {
  if (skill === 'brace') return skillIcon('guard');
  if (skill === 'engineer') return '<svg class="leader-skill-icon" viewBox="0 0 32 34" aria-hidden="true" shape-rendering="crispEdges"><path fill="#181611" d="M3 3h26v13H19v16h-8V16H3z"/><path fill="#b8bfbd" d="M5 5h22v9H5z"/><path fill="#f2eada" d="M5 5h22v3H5z"/><path fill="#9e6b35" d="M13 14h4v16h-4z"/></svg>';
  if (skill === 'discretion') return '<svg class="leader-skill-icon" viewBox="0 0 32 34" aria-hidden="true" shape-rendering="crispEdges"><path fill="#ead69d" d="m3 5 12 12L3 29v-8l4-4-4-4zm13 0 12 12-12 12v-8l4-4-4-4z"/></svg>';
  const art = skill === 'power'
    ? '<path fill="#151a1b" d="M25 1h6v7L15 24l-5-5zM7 17l9 9-4 4-3-3-5 5H0v-4l5-5-2-2z"/><path fill="#8e9698" d="M26 3h3v5L14 23l-5-5z"/><path fill="#f0eee1" d="M26 3h3v2L12 22l-3-3z"/><path fill="#c98d27" d="m6 18 10 10-2 2L4 20zM5 25l3 3-4 4H1v-3z"/><path fill="#ffe291" d="m6 18 10 10-2 1L5 20zM5 25l2 2-4 4H1v-2z"/>'
    : skill === 'guard'
      ? '<path fill="#151a1b" d="M14 1h5v3h10v17l-5 7-8 5-8-5-5-7V4h11z"/><path fill="#a5aaa8" d="M15 2h3v4h9v15l-5 6-6 4-6-4-5-6V6h10z"/><path fill="#ece9da" d="M15 3h2v5H7v13l5 6-3-2-3-5V7h9z"/><path fill="#636d70" d="M9 10h7v17l-5-4-2-4z"/><path fill="#414c51" d="M18 10h6v9l-3 5-3 3z"/><path fill="#d6d8cb" d="M16 8h2v21h-2z"/>'
      : '<path fill="#191614" d="M4 2h24v5h-3v25l-10-6-8 6V7H4z"/><path fill="#a46623" d="M6 5h3v27H6z"/><path fill="#f7cc66" d="M4 3h24v3H4zM7 1h3v2H7z"/><path fill="#a82931" d="M10 7h14v22l-8-5-6 4z"/><path fill="#ed4b49" d="M10 7h5v16l-5 5z"/><path fill="#ffd66d" d="M10 7h14v2H10zM10 25l6-4 8 5v3l-8-5-6 4z"/>';
  return `<svg class="leader-skill-icon" viewBox="0 0 32 34" aria-hidden="true" shape-rendering="crispEdges">${art}</svg>`;
}

const number = (value: number) => String(Number(value.toFixed(1)));
type LearnResult = { ok: boolean; message?: string; pending?: boolean };

export class LeaderProgressionUI {
  private previousLeader?: number;
  private pending?: { leaderId: number; skill: LeaderSkillId; rank: number; until: number };
  private message = '';
  private opened = false;

  constructor(private rail: HTMLElement, private popup: HTMLElement, private getState: () => GameState,
    private learn: (skill: LeaderSkillId) => LearnResult, private beforeOpen: () => void,
    private focusWorld: () => void, private canOpen: () => boolean) {
    rail.innerHTML = `<button type="button" class="leader-xp-open" aria-haspopup="dialog" aria-controls="leader-skills" aria-expanded="false" title="Leader skills">
      <span class="leader-level-badge">1</span><span class="leader-xp-track" role="progressbar" aria-label="Leader experience" aria-valuemin="0"><span class="leader-xp-fill"></span><span class="leader-xp-text">0 / 800 XP</span></span>
      </button><button type="button" class="leader-xp-points" aria-haspopup="dialog" aria-controls="leader-skills" aria-expanded="false" title="Leader skill points">0</button>`;
    popup.innerHTML = `<header class="leader-skills-header"><h2 id="leader-skills-title">Leader</h2><span class="leader-skills-level">Level 1</span><button type="button" data-leader-close aria-label="Close Leader skills">×</button></header>
      <div class="leader-skills-bonuses"><strong class="leader-skills-points">0 skill points</strong><span>Level bonus</span><span>+10 HP</span><span>+1 Attack</span></div>
      <div class="leader-skills-list" aria-label="Leader skills">${LEADER_SKILL_IDS.slice(0, 3).map(skill => this.skillRow(skill)).join('')}</div>
      <div class="leader-advanced-heading">Technology skills</div>
      <div class="leader-skills-list leader-advanced-skills" aria-label="Technology skills">${LEADER_SKILL_IDS.slice(3).map(skill => this.skillRow(skill)).join('')}</div>
      <p class="leader-skill-status" role="status" aria-live="polite"></p>`;
    rail.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => this.toggle());
    popup.querySelector<HTMLButtonElement>('[data-leader-close]')!.onclick = () => this.close(true);
    popup.querySelectorAll<HTMLButtonElement>('[data-leader-learn]').forEach(button => button.onclick = () => {
      const view = leaderProgressionView(this.getState()), id = button.dataset.leaderLearn as LeaderSkillId;
      const skill = view?.skills.find(skill => skill.id === id);
      if (!view || this.pending || !skill?.canLearn) return;
      const result = this.learn(id);
      this.message = result.ok ? '' : result.message ?? 'Unable to learn this skill.';
      if (result.ok && result.pending) this.pending = { leaderId: view.leader.id, skill: id, rank: skill.rank, until: performance.now() + 8000 };
      this.refresh();
    });
    for (const element of [rail, popup]) {
      element.addEventListener('pointerdown', event => event.stopPropagation());
      element.addEventListener('wheel', event => event.stopPropagation());
    }
    popup.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
  }

  private skillRow(skill: LeaderSkillId): string {
    return `<article class="leader-skill-row" data-leader-skill="${skill}">${skillIcon(skill)}<span class="leader-skill-copy"><strong>${skillName[skill]}</strong><span>${skillEffect[skill]}</span><small class="leader-skill-preview"></small><small class="leader-skill-tech"></small></span><span class="leader-skill-ranks"><span class="leader-skill-rank">0/${leaderSkillMaxRank(skill)}</span><span class="leader-skill-pips" aria-hidden="true">${'<i></i>'.repeat(leaderSkillMaxRank(skill))}</span></span><button type="button" data-leader-learn="${skill}" aria-label="Learn ${skillName[skill]}">+</button></article>`;
  }

  get isOpen(): boolean { return this.opened; }

  reset(): void {
    this.close(); this.previousLeader = undefined; this.pending = undefined;
  }

  toggle(): void { this.opened ? this.close(true) : this.open(); }

  open(): void {
    if (!this.canOpen() || !leaderProgressionView(this.getState())) return;
    this.beforeOpen(); this.opened = true; this.popup.hidden = false; this.message = '';
    this.refresh(); this.popup.querySelector<HTMLButtonElement>('[data-leader-close]')!.focus({ preventScroll: true });
  }

  close(focus = false): void {
    this.opened = false; this.popup.hidden = true; this.message = '';
    this.rail.querySelectorAll('button').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (focus) this.focusWorld();
  }

  refresh(): void {
    const view = leaderProgressionView(this.getState());
    this.rail.hidden = !view;
    if (!view) { this.reset(); return; }
    if (this.previousLeader !== undefined && this.previousLeader !== view.leader.id) {
      this.close(); this.pending = undefined;
    }
    this.previousLeader = view.leader.id;
    if (this.pending) {
      const learned = view.skills.find(skill => skill.id === this.pending!.skill)!.rank > this.pending.rank;
      if (this.pending.leaderId !== view.leader.id || learned) this.pending = undefined;
      else if (performance.now() >= this.pending.until) {
        this.pending = undefined;
        this.message = 'No confirmation received. Try again.';
      }
    }
    this.rail.querySelector('.leader-level-badge')!.textContent = String(view.level);
    this.rail.querySelector('.leader-xp-text')!.textContent = `${view.xp} / ${view.xpRequired} XP`;
    this.rail.querySelector<HTMLElement>('.leader-xp-fill')!.style.width = `${Math.min(100, view.xp / view.xpRequired * 100)}%`;
    const track = this.rail.querySelector('.leader-xp-track')!;
    track.setAttribute('aria-valuenow', String(view.xp)); track.setAttribute('aria-valuemax', String(view.xpRequired));
    track.setAttribute('aria-valuetext', `Level ${view.level}, ${view.xp} of ${view.xpRequired} XP`);
    const opener = this.rail.querySelector<HTMLButtonElement>('.leader-xp-open')!;
    opener.setAttribute('aria-label', `Leader level ${view.level}, ${view.xp} of ${view.xpRequired} XP. Open skills`);
    opener.title = `Leader level ${view.level} · ${view.xp} / ${view.xpRequired} XP · Open skills`;
    const points = this.rail.querySelector<HTMLButtonElement>('.leader-xp-points')!;
    points.textContent = String(view.skillPoints); points.classList.toggle('has-points', view.skillPoints > 0);
    const pointText = `${view.skillPoints} skill point${view.skillPoints === 1 ? '' : 's'}`;
    points.setAttribute('aria-label', `${pointText}. Open Leader skills`); points.title = pointText;
    this.rail.querySelectorAll('button').forEach(button => button.setAttribute('aria-expanded', String(this.opened)));
    if (!this.opened) return;
    this.popup.querySelector('.leader-skills-level')!.textContent = `Level ${view.level}`;
    this.popup.querySelector('.leader-skills-points')!.textContent = pointText;
    for (const skill of view.skills) {
      const row = this.popup.querySelector<HTMLElement>(`[data-leader-skill="${skill.id}"]`)!;
      row.setAttribute('aria-label', `${skill.name}, ${skill.rank} of ${skill.maxRank}, ${skill.effect}`);
      row.title = `${skill.name} · ${skill.effect}${skill.requiredTech ? ` · ${skill.requiredTech}` : ' per rank'}`;
      row.classList.toggle('is-locked', !skill.unlocked);
      row.querySelector('.leader-skill-tech')!.textContent = skill.requiredTech ? `${skill.unlocked ? 'Unlocked' : 'Requires'}: ${skill.requiredTech}` : '';
      row.querySelector('.leader-skill-rank')!.textContent = `${skill.rank}/${skill.maxRank}`;
      row.querySelectorAll('.leader-skill-pips i').forEach((pip, index) => pip.classList.toggle('earned', index < skill.rank));
      const label = skill.id === 'power' ? 'Attack' : skill.id === 'guard' ? 'Defense' : 'Retinue';
      const current = skill.id === 'power' ? view.attack : skill.id === 'guard' ? view.defense : view.retinueBonus;
      const next = skill.id === 'power' ? skill.nextAttack : skill.id === 'guard' ? skill.nextDefense : skill.nextRetinueBonus;
      row.querySelector('.leader-skill-preview')!.textContent = skill.requiredTech ? ''
        : `${label} ${number(current)}${skill.rank < skill.maxRank ? ` → ${number(next)}` : ''}`;
      const learn = row.querySelector<HTMLButtonElement>('[data-leader-learn]')!;
      const waiting = this.pending?.skill === skill.id;
      learn.disabled = !skill.canLearn || !!this.pending;
      learn.textContent = waiting ? '…' : '+';
      const reason = waiting ? `Learning ${skill.name}…` : !skill.unlocked ? `${skill.name}: requires ${skill.requiredTech}`
        : skill.rank === skill.maxRank ? `${skill.name}: maximum rank` : this.pending ? `${skill.name}: waiting for the previous skill purchase`
        : view.skillPoints === 0 ? `${skill.name}: level up to earn a skill point` : `Learn ${skill.name} — 1 skill point`;
      learn.title = reason; learn.setAttribute('aria-label', reason);
      learn.setAttribute('aria-busy', String(waiting));
      row.classList.toggle('is-pending', waiting);
    }
    this.popup.querySelector('.leader-skill-status')!.textContent = this.message;
  }
}
