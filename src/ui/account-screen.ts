import './account-screen.css';

export type AccountView = 'login' | 'create-account' | 'forgot-password';
export const isAccountView = (view: string): view is AccountView =>
  view === 'login' || view === 'create-account' || view === 'forgot-password';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Keep only the email between screens; never retain or persist passwords. */
export class AccountScreen {
  private email = '';
  private message = '';

  rememberEmail(form: HTMLFormElement | null): void {
    const input = form?.elements.namedItem('account-email');
    if (input instanceof HTMLInputElement) this.email = input.value.trim();
  }

  clearMessage(): void { this.message = ''; }

  markup(view: AccountView): string {
    const creating = view === 'create-account', recovering = view === 'forgot-password';
    const email = `<label for="account-email">Email address</label><input id="account-email" name="account-email" type="email" autocomplete="${creating ? 'email' : 'username'}" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${escape(this.email)}" required>`;
    const password = recovering ? '' : `<label for="account-password">Password</label><input id="account-password" name="account-password" type="password" maxlength="1024" autocomplete="${creating ? 'new-password' : 'current-password'}" ${creating ? 'minlength="10" aria-describedby="account-password-hint"' : ''} required>${creating ? '<p class="frontend-hint" id="account-password-hint">Use at least 10 characters.</p><label for="account-confirm">Confirm password</label><input id="account-confirm" name="account-confirm" type="password" autocomplete="new-password" minlength="10" maxlength="1024" required>' : ''}`;
    return `${creating || recovering ? `<p class="account-intro">${creating ? 'A new commander. A new civilization.' : 'Enter your account email to request a password reset link.'}</p>` : ''}
      ${recovering ? '' : '<button class="menu-button account-plate" type="button" data-account-action="google"><span>Continue with Google</span></button><div class="account-divider"><span>or use your email</span></div>'}
      <form class="account-form" method="post" data-form="account" data-account-view="${view}">
        ${email}${password}
        ${view === 'login' ? '<button class="account-link account-forgot" type="button" data-view="forgot-password">Forgot password?</button>' : ''}
        <button class="menu-button account-plate account-submit" type="submit"><span>${creating ? 'Create account' : recovering ? 'Send reset link' : 'Sign in'}</span></button>
      </form>
      <p class="account-notice" role="status" aria-live="polite" aria-atomic="true">${escape(this.message)}</p>
      <div class="account-navigation">${view === 'login' ? '<span>New to TinyCiv?</span><button class="account-link" type="button" data-view="create-account">Create an account</button>' : '<button class="account-link" type="button" data-view="login">Back to sign in</button>'}</div>
      <button class="menu-button account-plate account-guest" type="button" data-view="main"><span>Continue as guest</span></button>`;
  }

  /** Google OAuth and reset mail require separate provider configuration. */
  google(host: HTMLElement): void {
    this.setMessage(host, 'Google sign-in is coming soon. Continue as a guest to play.');
  }

  submit(form: HTMLFormElement, host: HTMLElement, submit: (mode: 'login' | 'create-account', email: string, password: string) => void): void {
    const confirm = form.elements.namedItem('account-confirm');
    const password = form.elements.namedItem('account-password');
    if (confirm instanceof HTMLInputElement && password instanceof HTMLInputElement) {
      confirm.setCustomValidity(confirm.value === password.value ? '' : 'Passwords must match.');
    }
    if (!form.reportValidity()) return;
    this.rememberEmail(form);
    const view = form.dataset.accountView;
    if (view === 'forgot-password') this.setMessage(host, 'Password recovery is not available yet. No reset email was sent.');
    else if ((view === 'login' || view === 'create-account') && password instanceof HTMLInputElement) {
      this.setMessage(host, view === 'login' ? 'Signing in…' : 'Creating account…');
      submit(view, this.email, password.value);
    }
    for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"]')) input.value = '';
  }

  setMessage(host: HTMLElement, message: string): void {
    this.message = message;
    const status = host.querySelector<HTMLElement>('.account-notice');
    if (status) status.textContent = message;
  }
}
