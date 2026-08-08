import { send, type SessionState } from './messages.js';

const root = document.getElementById('root')!;
const account = document.getElementById('account')!;

/** DOM built imperatively: MV3's CSP forbids the inline handlers a template string would need. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function renderAuth(session: SessionState, mode: 'login' | 'signup' = 'login'): void {
  root.replaceChildren();
  account.textContent = '';

  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'username' });
  const password = el('input', {
    type: 'password',
    placeholder: mode === 'signup' ? 'At least 8 characters' : 'Password',
    autocomplete: mode === 'signup' ? 'new-password' : 'current-password',
  });
  const error = el('p', { className: 'error' });
  const submit = el('button', {
    textContent: mode === 'signup' ? 'Create account' : 'Sign in',
  });

  const toggle = el('button', {
    className: 'link',
    textContent:
      mode === 'signup' ? 'Already have an account? Sign in' : 'No account? Create one',
  });
  toggle.addEventListener('click', () => renderAuth(session, mode === 'signup' ? 'login' : 'signup'));

  async function submitForm(): Promise<void> {
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Working…';

    const result = await send<SessionState>({
      type: mode === 'signup' ? 'SIGNUP' : 'LOGIN',
      payload: { email: email.value.trim(), password: password.value },
    });

    if (!result.ok) {
      error.textContent = result.error;
      submit.disabled = false;
      submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
      return;
    }

    void render();
  }

  submit.addEventListener('click', () => void submitForm());
  password.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitForm();
  });

  root.append(
    el('fieldset', {}, [
      el('div', {}, [el('label', { textContent: 'Email' }), email]),
      el('div', {}, [el('label', { textContent: 'Password' }), password]),
      submit,
      error,
      toggle,
    ]),
    apiSettings(session)
  );
}

function apiSettings(session: SessionState): HTMLElement {
  const input = el('input', { type: 'url', value: session.apiBaseUrl });
  const status = el('p', { className: 'muted' });
  const save = el('button', { className: 'secondary', textContent: 'Save API URL' });

  save.addEventListener('click', async () => {
    const result = await send<SessionState>({
      type: 'SET_API_BASE_URL',
      payload: { apiBaseUrl: input.value.trim() },
    });
    status.textContent = result.ok ? 'Saved.' : result.error;
    status.className = result.ok ? 'success' : 'error';
  });

  return el('details', {}, [
    el('summary', { textContent: 'Advanced' }),
    el('div', {}, [
      el('label', { textContent: 'API base URL' }),
      input,
      save,
      status,
      el('p', {
        className: 'muted',
        textContent:
          'Must also be listed in the extension manifest’s host_permissions, or requests will be blocked.',
      }),
    ]),
  ]);
}

/**
 * Autofill controls. Shown only when the page actually has fillable fields, so
 * the popup does not offer an action that would do nothing.
 */
/**
 * The popup no longer duplicates the panel.
 *
 * Autofill, the job card and "save this job" all moved to the in-page panel,
 * which sits next to the form they act on. Two surfaces offering the same
 * button, one of them behind a toolbar icon, was the confusing part.
 *
 * What is left is the work only the popup can do: signing in before any panel
 * can appear, and settings that are not tied to a page.
 */
async function renderSignedIn(session: SessionState): Promise<void> {
  root.replaceChildren();
  account.textContent = session.email ?? '';

  root.append(
    el('p', {
      className: 'muted',
      textContent:
        'Open a job posting and use the Autofill button on the right of the page. jobpilot records the application when you submit it.',
    })
  );

  /*
   * The panel's close button hides it per host, and until now there was no way
   * back short of editing storage by hand. Only shown when something is
   * actually hidden, so it is not a permanently useless control.
   */
  const dismissed = await chrome.storage.local.get('panelDismissedHosts');
  const hosts = (dismissed.panelDismissedHosts as string[] | undefined) ?? [];

  if (hosts.length > 0) {
    const status = el('p', { className: 'muted' });
    const restore = el('button', {
      className: 'secondary',
      textContent: `Show the panel again on ${hosts.length} site${hosts.length === 1 ? '' : 's'}`,
    });

    restore.addEventListener('click', async () => {
      await chrome.storage.local.remove('panelDismissedHosts');
      restore.disabled = true;
      status.textContent = 'Restored. Reload the page to see it.';
      status.className = 'success';
    });

    root.append(restore, status);
  }

  const signOut = el('button', { className: 'secondary', textContent: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await send<SessionState>({ type: 'LOGOUT' });
    void render();
  });

  root.append(signOut, apiSettings(session));
}

async function render(): Promise<void> {
  const result = await send<SessionState>({ type: 'GET_SESSION' });

  if (!result.ok) {
    root.replaceChildren(el('p', { className: 'error', textContent: result.error }));
    return;
  }

  if (result.data.authenticated) {
    await renderSignedIn(result.data);
  } else {
    renderAuth(result.data);
  }
}

void render();
