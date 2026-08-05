import type { CapturedJob, CaptureResponse } from '@jobpilot/shared';
import {
  send,
  type AutofillSummary,
  type Message,
  type Response,
  type SessionState,
} from './messages.js';

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

/**
 * Send a message to the content script in the active tab.
 * Returns null when there is no content script there — an unsupported site, or
 * a page that was already open when the extension was installed.
 */
async function sendToPage<T>(message: Message): Promise<T | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  try {
    const result = (await chrome.tabs.sendMessage(tab.id, message)) as Response<T>;
    return result?.ok ? result.data : null;
  } catch {
    return null;
  }
}

const getPageJob = () => sendToPage<CapturedJob | null>({ type: 'GET_PAGE_JOB' });

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
async function autofillPanel(): Promise<HTMLElement> {
  const wrapper = el('div', { className: 'autofill' });
  const coverage = await sendToPage<{ fillable: number; total: number }>({
    type: 'GET_FORM_COVERAGE',
  });

  if (!coverage || coverage.total === 0) {
    return el('div');
  }

  const status = el('p', { className: 'muted' });

  if (coverage.fillable === 0) {
    status.textContent =
      'Found a form, but nothing in your profile matches it yet. Add your details in the tracker.';
    wrapper.append(status);
    return wrapper;
  }

  const button = el('button', {
    textContent: `Fill ${coverage.fillable} of ${coverage.total} fields`,
  });

  const overwrite = el('input', { type: 'checkbox', id: 'overwrite' });
  const overwriteRow = el('label', { className: 'inline', htmlFor: 'overwrite' }, [
    overwrite,
    document.createTextNode('Replace values I already typed'),
  ]);

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Filling…';
    status.className = 'muted';
    status.textContent = '';

    const result = await sendToPage<AutofillSummary>({
      type: 'AUTOFILL_PAGE',
      payload: { overwrite: overwrite.checked },
    });

    if (!result) {
      status.className = 'error';
      status.textContent = 'Could not reach the page. Reload it and try again.';
      button.disabled = false;
      button.textContent = 'Try again';
      return;
    }

    status.className = 'success';
    const unanswered = result.unanswered.length;
    status.textContent =
      `Filled ${result.filled}.` +
      (result.skipped ? ` Left ${result.skipped} you had already filled.` : '') +
      (unanswered ? ` ${unanswered} open question${unanswered === 1 ? '' : 's'} left for you.` : '');

    button.textContent = 'Fill again';
    button.disabled = false;
  });

  wrapper.append(
    el('p', {
      className: 'muted',
      textContent: 'Autofill never submits — check the form before you send it.',
    }),
    button,
    overwriteRow,
    status
  );

  return wrapper;
}

async function renderSignedIn(session: SessionState): Promise<void> {
  root.replaceChildren();
  account.textContent = session.email ?? '';

  const job = await getPageJob();

  root.append(await autofillPanel());

  if (!job) {
    root.append(
      el('p', {
        className: 'muted',
        textContent:
          'No job posting detected on this tab. Open a Greenhouse, Lever, or Ashby posting and jobpilot will track it automatically when you apply.',
      })
    );
  } else {
    const status = el('p', { className: 'muted' });
    const saveButton = el('button', { className: 'secondary', textContent: 'Save this job' });

    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'muted';

      const result = await send<CaptureResponse>({
        type: 'CAPTURE',
        // applied:false - an explicit bookmark, not a submitted application.
        payload: { job, applied: false, capturedAt: new Date().toISOString() },
      });

      if (result.ok) {
        status.textContent = result.data.created ? 'Saved to your tracker.' : 'Already in your tracker.';
        status.className = 'success';
      } else {
        status.textContent = result.error;
        status.className = 'error';
        saveButton.disabled = false;
      }
    });

    root.append(
      el('div', { className: 'job' }, [
        el('div', { className: 'job-title', textContent: job.title ?? 'Untitled role' }),
        el('div', {
          className: 'job-meta',
          textContent: [job.company, job.location].filter(Boolean).join(' · ') || 'Unknown company',
        }),
      ]),
      saveButton,
      status
    );
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
