import { send, type SessionState } from './messages.js';
import { DEFAULT_WEB_BASE_URL } from './config.js';
import {
  OPTIONAL_PLATFORMS,
  grantedPlatforms,
  injectIntoOpenTabs,
  requestPlatform,
  revokePlatform,
  type Platform,
} from './platforms.js';

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
 * Signing in happens on the website, not here.
 *
 * The popup used to carry its own email/password form posting to
 * /api/auth/login. That stopped being viable when Firebase became the identity
 * provider: Google's consent flow wants a real browsing context rather than a
 * 360px popup, and maintaining a second sign-in surface against one provider
 * means two things to keep working and two places for it to break.
 *
 * So this opens the site and waits. The content script already runs on
 * jobpilot's own origin; once the user signs in there, the page hands the
 * session back through it and `render()` below picks the change up.
 */
function renderAuth(session: SessionState): void {
  root.replaceChildren();
  account.textContent = '';

  const status = el('p', { className: 'muted' });

  const signIn = el('button', { textContent: 'Sign in on the web' });
  signIn.addEventListener('click', () => {
    chrome.tabs.create({ url: `${DEFAULT_WEB_BASE_URL}/login` });
    status.textContent = 'Waiting for you to sign in… this updates on its own.';
  });

  const signUp = el('button', { className: 'secondary', textContent: 'Create an account' });
  signUp.addEventListener('click', () => {
    chrome.tabs.create({ url: `${DEFAULT_WEB_BASE_URL}/signup` });
    status.textContent = 'Waiting for you to sign up… this updates on its own.';
  });

  /*
   * Re-render when the stored session changes.
   *
   * chrome.storage fires this in the popup the moment the background worker
   * writes the handed-over token, so the popup flips to the signed-in view
   * while it is still open — no refresh, and nothing to press twice.
   */
  chrome.storage.onChanged.addListener((changes, area) => {
    // 'authToken' is the key storage.ts actually writes. Watching the wrong
    // key is a listener that never fires and a popup that never updates.
    if (area === 'local' && changes.authToken) void render();
  });

  root.append(
    el('p', {
      className: 'muted',
      textContent:
        'Sign in on the website — including with Google. BanApply connects this extension automatically once you are in.',
    }),
    signIn,
    signUp,
    status,
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
/**
 * The job sites the user can switch on, and which are already on.
 *
 * Each toggle is a real permission prompt, which is why the checkbox is driven
 * by `chrome.permissions` rather than by its own checked state: the user can
 * dismiss the prompt, and a checkbox that stayed ticked after a refusal would
 * be claiming the extension runs somewhere it does not. The box is put back to
 * whatever the browser actually says.
 *
 * The warning is not decoration. These adapters were built from each
 * platform's published markup and verified against synthetic DOM only, so the
 * first live run on each is genuinely a first run.
 */
async function platformSettings(): Promise<HTMLElement> {
  const granted = new Set((await grantedPlatforms()).map((platform) => platform.id));

  const section = el('section', { className: 'platforms' });
  const summary = el('h2', { textContent: 'Job sites' });

  const note = el('p', {
    className: 'muted',
    textContent:
      'LinkedIn, Indeed and Naukri are on by default. The rest are untested on live postings — switch one on to try it, and off again if it misbehaves.',
  });

  const status = el('p', { className: 'muted' });
  const list = el('div', { className: 'platform-list' });

  for (const platform of OPTIONAL_PLATFORMS) {
    const row = el('label', { className: 'platform-row' });
    const box = el('input', { type: 'checkbox' });
    box.checked = granted.has(platform.id);

    box.addEventListener('change', () => {
      // Await inside the handler, not around it: `permissions.request()` needs
      // the user gesture, and that is only still in scope synchronously here.
      void toggle(platform, box, status);
    });

    row.append(box, el('span', { textContent: platform.label }));
    list.append(row);
  }

  section.append(summary, note, list, status);
  return section;
}

async function toggle(
  platform: Platform,
  box: HTMLInputElement,
  status: HTMLElement
): Promise<void> {
  status.textContent = '';

  if (box.checked) {
    const ok = await requestPlatform(platform);
    // Chrome's own answer wins over the click that asked the question.
    box.checked = ok;
    status.textContent = ok
      ? `${platform.label} enabled. Open a posting there — no reload needed.`
      : `${platform.label} was not enabled.`;
    if (ok) await injectIntoOpenTabs(platform);
    return;
  }

  await revokePlatform(platform);
  box.checked = false;
  status.textContent = `${platform.label} turned off.`;
}

async function renderSignedIn(session: SessionState): Promise<void> {
  root.replaceChildren();
  account.textContent = session.email ?? '';

  root.append(
    el('p', {
      className: 'muted',
      textContent:
        'Open a job posting and use the Autofill button on the right of the page. BanApply records the application when you submit it.',
    })
  );

  const signOut = el('button', { className: 'secondary', textContent: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await send<SessionState>({ type: 'LOGOUT' });
    void render();
  });

  root.append(await platformSettings(), signOut, apiSettings(session));
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
