import type { AccountUser } from '../account/client';
import { menuPlate } from './menu-plate';
import './feedback-dialog.css';

/** A retained form keeps a draft intact while account/menu state refreshes. */
export class FeedbackDialog {
  private readonly overlay = document.createElement('div');
  private readonly textarea: HTMLTextAreaElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly identity: HTMLElement;
  private readonly status: HTMLElement;
  private busy = false;

  constructor(host: HTMLElement, submit: (message: string) => void, private readonly closed: () => void) {
    this.overlay.className = 'frontend-feedback-backdrop';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `<section class="menu-sheet feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <header><h1 id="feedback-title">Help &amp; feedback</h1><button class="menu-button feedback-plate feedback-close" type="button" data-feedback-close>${menuPlate}<span>Close</span></button></header>
      <form class="frontend-form feedback-form">
        <label for="feedback-message">Your feedback</label>
        <textarea id="feedback-message" name="feedback-message" rows="7" maxlength="4000" required></textarea>
        <p class="feedback-identity"></p>
        <button class="menu-button feedback-plate feedback-send" type="submit">${menuPlate}<span>Send feedback</span></button>
        <p class="feedback-status" role="status" aria-live="polite"></p>
      </form>
    </section>`;
    this.textarea = this.overlay.querySelector('textarea')!;
    this.submitButton = this.overlay.querySelector('[type="submit"]')!;
    this.identity = this.overlay.querySelector('.feedback-identity')!;
    this.status = this.overlay.querySelector('.feedback-status')!;
    this.overlay.addEventListener('click', event => {
      event.stopPropagation();
      if ((event.target as HTMLElement).closest('[data-feedback-close]')) this.close();
    });
    this.overlay.addEventListener('input', () => this.textarea.setCustomValidity(''));
    this.overlay.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      if (this.busy) return;
      const message = this.textarea.value.trim();
      if (!message) { this.textarea.setCustomValidity('Enter your feedback.'); this.textarea.reportValidity(); return; }
      submit(message);
    });
    this.overlay.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...this.overlay.querySelectorAll<HTMLElement>('button:not(:disabled),textarea')];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    });
    host.append(this.overlay);
  }

  setAccount(user: AccountUser | null): void {
    this.identity.textContent = user
      ? `Sending as ${user.displayName}. Includes your account, browser and game details.`
      : 'Sending as Guest. Includes an anonymous browser ID and game details.';
  }

  open(user: AccountUser | null): void {
    this.setAccount(user);
    if (!this.busy) this.status.textContent = '';
    this.overlay.hidden = false;
    this.textarea.focus({ preventScroll: true });
  }

  close(): void {
    if (this.overlay.hidden) return;
    this.overlay.hidden = true; this.closed();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.textarea.readOnly = busy;
    this.submitButton.disabled = busy;
    this.overlay.querySelector('form')!.setAttribute('aria-busy', String(busy));
    if (busy) this.status.textContent = 'Sending…';
  }

  result(message: string, success = false): void {
    this.status.textContent = message;
    if (success) this.textarea.value = '';
  }
}
