import type { AccountCredentials } from '../account/client';
import { menuPlate } from './menu-plate';
import './account-screen.css';

export type AccountView = 'login' | 'create-account' | 'forgot-password';
export const isAccountView = (view: string): view is AccountView =>
  view === 'login' || view === 'create-account' || view === 'forgot-password';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class AccountScreen {
  private email = '';
  private username = '';
  private identifier = '';
  private message = '';
  private creating = false;
  private readonly dialog = document.createElement('dialog');

  constructor(private readonly host: HTMLElement) {
    this.dialog.className = 'account-dialog';
    this.dialog.setAttribute('aria-labelledby', 'account-dialog-title');
    this.dialog.addEventListener('cancel', event => { if (this.creating) event.preventDefault(); });
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.dialog.replaceChildren(); });
    host.append(this.dialog);
  }

  get modalOpen(): boolean { return this.dialog.open; }

  rememberFields(form: HTMLFormElement | null): void {
    const value = (name: string) => {
      const input = form?.elements.namedItem(name);
      return input instanceof HTMLInputElement ? input.value.trim() : undefined;
    };
    this.email = value('account-email') ?? this.email;
    this.username = value('account-username') ?? this.username;
    this.identifier = value('account-identifier') ?? this.identifier;
  }

  clearMessage(): void { this.message = ''; }

  markup(view: AccountView): string {
    const creating = view === 'create-account', recovering = view === 'forgot-password';
    const username = creating ? `<label for="account-username">Username</label><input id="account-username" name="account-username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="40" pattern="[A-Za-z0-9_.\\-]{1,40}" title="Letters, numbers, periods, underscores, or hyphens" value="${escape(this.username)}" required>` : '';
    const identity = creating || recovering
      ? `<label for="account-email">Email address${creating ? ' (optional)' : ''}</label><input id="account-email" name="account-email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${escape(this.email)}" ${recovering ? 'required' : ''}>`
      : `<label for="account-identifier">Username or email address</label><input id="account-identifier" name="account-identifier" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" value="${escape(this.identifier)}" required>`;
    const password = recovering ? '' : `<label for="account-password">Password</label><input id="account-password" name="account-password" type="password" maxlength="1024" autocomplete="${creating ? 'new-password' : 'current-password'}" required>${creating ? '<label for="account-confirm">Confirm password</label><input id="account-confirm" name="account-confirm" type="password" autocomplete="new-password" maxlength="1024" required>' : ''}`;
    return `${recovering ? '' : `<button class="menu-button account-plate" type="button" data-account-action="google">${menuPlate}<span>Continue with Google</span></button><div class="account-divider" aria-hidden="true"></div>`}
      <form class="account-form" method="post" data-form="account" data-account-view="${view}">
        ${username}${identity}${password}
        ${view === 'login' ? '<button class="account-link account-forgot" type="button" data-view="forgot-password">Forgot password?</button>' : ''}
        <button class="menu-button account-plate account-submit" type="submit">${menuPlate}<span>${creating ? 'Create account' : recovering ? 'Send reset link' : 'Sign in'}</span></button>
      </form>
      <p class="account-notice" role="status" aria-live="polite" aria-atomic="true">${escape(this.message)}</p>
      <div class="account-navigation">${view === 'login' ? '<button class="account-link" type="button" data-view="create-account">Create an account</button>' : '<button class="account-link" type="button" data-view="login">Back to sign in</button>'}</div>
      <button class="menu-button account-plate account-guest" type="button" data-frontend-action="account-guest">${menuPlate}<span>Continue as guest</span></button>`;
  }

  google(): void {
    this.setMessage('Google sign-in is coming soon. Continue as a guest to play.');
  }

  submit(form: HTMLFormElement, submit: (credentials: AccountCredentials) => void): void {
    const confirm = form.elements.namedItem('account-confirm');
    const password = form.elements.namedItem('account-password');
    if (confirm instanceof HTMLInputElement && password instanceof HTMLInputElement)
      confirm.setCustomValidity(confirm.value === password.value ? '' : 'Passwords must match.');
    if (!form.reportValidity()) return;
    this.rememberFields(form);
    const view = form.dataset.accountView;
    if (view === 'forgot-password') {
      this.setMessage('Password recovery is not available yet. No reset email was sent.');
      return;
    }
    if (!(password instanceof HTMLInputElement)) return;
    const send = () => {
      const value = password.value;
      if (view === 'create-account') {
        this.setMessage('');
        this.creationStatus('Creating account...');
        submit({ mode: view, username: this.username, email: this.email, password: value });
      } else {
        this.setMessage('Signing in…');
        submit({ mode: 'login', identifier: this.identifier, password: value });
      }
      password.value = '';
      if (confirm instanceof HTMLInputElement) confirm.value = '';
    };
    if (view !== 'create-account' || this.email) { send(); return; }
    this.dialog.innerHTML = `<h2 id="account-dialog-title">Create account without email?</h2>
      <p>If you do not provide an email address, we will not be able to reset your password if you forget it.</p>
      <div class="account-dialog-actions"><button class="menu-button" type="button" data-account-add-email autofocus>${menuPlate}<span>Add email</span></button>
        <button class="menu-button" type="button" data-account-without-email>${menuPlate}<span>Continue without email</span></button></div>`;
    this.dialog.querySelector('[data-account-add-email]')?.addEventListener('click', () => {
      this.dialog.close();
      form.querySelector<HTMLInputElement>('#account-email')?.focus();
    }, { once: true });
    this.dialog.querySelector('[data-account-without-email]')?.addEventListener('click', send, { once: true });
    this.dialog.showModal();
  }

  creationStatus(message?: string): void {
    this.creating = message !== undefined;
    this.host.classList.toggle('is-creating-account', this.creating);
    if (message === undefined) {
      if (this.dialog.open) this.dialog.close();
      this.dialog.replaceChildren();
      return;
    }
    this.dialog.innerHTML = `<div class="account-dialog-progress">${message === 'Creating account...' ? '<span class="frontend-loading-spinner" aria-hidden="true"></span>' : ''}
      <h2 id="account-dialog-title" tabindex="-1" role="status">${escape(message)}</h2></div>`;
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector<HTMLElement>('#account-dialog-title')?.focus({ preventScroll: true });
  }

  setMessage(message: string): void {
    this.message = message;
    const status = this.host.querySelector<HTMLElement>('.account-notice');
    if (status) status.textContent = message;
  }
}
