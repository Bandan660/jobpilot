import type { CapturedJob, DuplicateMatch } from '@jobpilot/shared';

/**
 * In-page side panel, opened from a button docked to the right edge.
 *
 * The button is the resting state and the panel is closed until it is clicked.
 * Opening on its own was tried and dropped: a surface covering a third of the
 * window before being asked for is the behaviour that gets extensions removed.
 * What appears unprompted is the button, and only when there is genuinely
 * something to do — a real job page, a signed-in user, a form on screen.
 *
 * WHY NOT chrome.sidePanel
 *
 * Chrome's own side panel would be the better home for this — real browser
 * chrome, full height, docked rather than overlapping. It is not usable from
 * here: `chrome.sidePanel.open()` requires a user gesture, and the gesture has
 * to reach the extension, which a click on a page-injected button does not do.
 * Moving to it would mean opening from the toolbar icon only.
 *
 * ISOLATION
 *
 * Everything lives in a closed shadow root. ATS pages ship aggressive global
 * resets — `* { font-family: … !important }` is common — and without isolation
 * the panel is unreadable on roughly half of them. Only positioning sits on
 * the host element, and the z-index is the maximum because ATS modals and
 * cookie bars routinely sit in the high hundreds of thousands.
 */

const HOST_ID = 'jobpilot-panel-host';
const DISMISS_KEY = 'panelDismissedHosts';

export interface PanelJob {
  job: CapturedJob;
  coverage: { fillable: number; total: number };
  email: string | null;
  duplicate: DuplicateMatch | null;
}

export interface PanelHandlers {
  onFill: (overwrite: boolean) => Promise<{ filled: number; unanswered: number }>;
  onSave: () => Promise<boolean>;
  onSignOut: () => void;
}

let mounted: { destroy: () => void } | null = null;

export function removePanel(): void {
  mounted?.destroy();
  mounted = null;
  document.getElementById(HOST_ID)?.remove();
}

/** Per-host, so dismissing it on one ATS does not silence it everywhere. */
async function isDismissed(): Promise<boolean> {
  const stored = await chrome.storage.local.get(DISMISS_KEY);
  const hosts = (stored[DISMISS_KEY] as string[] | undefined) ?? [];
  return hosts.includes(window.location.host);
}

async function rememberDismissed(): Promise<void> {
  const stored = await chrome.storage.local.get(DISMISS_KEY);
  const hosts = new Set((stored[DISMISS_KEY] as string[] | undefined) ?? []);
  hosts.add(window.location.host);
  await chrome.storage.local.set({ [DISMISS_KEY]: [...hosts] });
}

const CSS = `
  :host, * { box-sizing: border-box; margin: 0; padding: 0; }

  /*
   * Dark by default rather than following the page. The panel is a different
   * application sitting on top of someone else's site, and reading as distinct
   * chrome is the point — a white panel on a white ATS form looks like part of
   * the form, which is exactly the confusion to avoid before someone hits
   * submit.
   */
  .panel {
    --ink: #0b1220;
    --panel: #131d30;
    --raised: #1a2740;
    --line: #24334f;
    --text: #e8edf7;
    --dim: #9fb0cc;
    --signal: #ffb020;
    --on-signal: #1a1204;
    --live: #3fcf8e;
    --warn: #ffb020;

    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.34);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }

  .mark {
    width: 22px; height: 22px; border-radius: 6px;
    background: var(--ink);
    display: grid; place-items: center;
    flex-shrink: 0;
  }
  .mark svg { width: 13px; height: 13px; }

  .wordmark { font-weight: 700; letter-spacing: -0.02em; font-size: 14px; }

  .who {
    margin-left: auto;
    font-size: 11px;
    color: var(--dim);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    background: none; border: none; cursor: pointer;
    color: var(--dim); padding: 4px; border-radius: 5px;
    display: grid; place-items: center; flex-shrink: 0;
  }
  .icon-btn:hover { color: var(--text); background: rgba(255,255,255,0.06); }
  .icon-btn svg { width: 15px; height: 15px; }

  /* The only scrolling region: the header and the action stay put. */
  .body {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card {
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 12px;
  }

  .role { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
  .meta { color: var(--dim); font-size: 12px; margin-top: 3px; }

  .lamp-row {
    display: flex; align-items: center; gap: 6px;
    margin-top: 9px; padding-top: 9px;
    border-top: 1px solid var(--line);
    font-size: 11px; color: var(--dim);
  }
  .lamp { width: 6px; height: 6px; border-radius: 50%; background: var(--live); flex-shrink: 0; }

  /* Duplicate warning. Amber not red: applying twice is worth knowing about,
     not an error, and red here would read as "something broke". */
  .warn {
    border-color: rgba(255, 176, 32, 0.4);
    background: rgba(255, 176, 32, 0.09);
  }
  .warn .role { color: var(--signal); font-size: 12.5px; }

  .action { padding: 14px 16px; border-top: 1px solid var(--line); flex-shrink: 0; }

  .fill {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: var(--signal);
    color: var(--on-signal);
    border: none; border-radius: 8px;
    padding: 13px 16px;
    font: inherit; font-size: 14px; font-weight: 700;
    cursor: pointer;
    transition: filter 140ms ease;
  }
  .fill:hover:not(:disabled) { filter: brightness(1.08); }
  .fill:disabled { opacity: 0.5; cursor: default; }
  .fill svg { width: 15px; height: 15px; }

  .ghost {
    width: 100%;
    background: transparent;
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 14px;
    font: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer;
  }
  .ghost:hover { background: rgba(255,255,255,0.05); }
  .ghost:disabled { opacity: 0.5; cursor: default; }

  .toggle {
    display: flex; align-items: center; gap: 8px;
    margin-top: 10px;
    font-size: 12px; color: var(--dim);
    cursor: pointer;
  }
  .toggle input { accent-color: var(--signal); width: 14px; height: 14px; cursor: pointer; }

  .note { font-size: 11.5px; color: var(--dim); }

  .foot {
    display: flex; gap: 10px; align-items: center;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    flex-shrink: 0;
  }
  .link {
    background: none; border: none; padding: 0;
    color: var(--dim); font: inherit; font-size: 11.5px;
    cursor: pointer; text-decoration: underline;
  }
  .link:hover { color: var(--text); }

  /*
   * The resting state: a launcher docked to the right edge. This is what the
   * panel is by default — it opens only when asked, rather than taking a third
   * of the window uninvited.
   *
   * Amber fill rather than the panel's dark surface, because at this size on
   * an unknown page it has to be findable without being hunted for.
   */
  .handle {
    position: absolute;
    top: 50%; right: 14px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 13px;
    background: var(--signal);
    color: var(--on-signal);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), filter 160ms ease;
  }
  .handle:hover { transform: translateY(-50%) scale(1.04); filter: brightness(1.06); }
  .handle:active { transform: translateY(-50%) scale(0.98); }
  .handle svg { width: 15px; height: 15px; flex-shrink: 0; }

  /* Count of fillable fields — the one fact worth showing before opening. */
  .handle .count {
    background: rgba(0, 0, 0, 0.18);
    border-radius: 999px;
    padding: 1px 7px;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  /* One slow sweep so it registers as new without becoming a blinking
     ornament on every page. */
  @media (prefers-reduced-motion: no-preference) {
    .handle { animation: pop 260ms cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes pop {
      from { opacity: 0; transform: translateY(-50%) translateX(14px); }
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .panel { animation: slide 220ms cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes slide { from { transform: translateX(100%); } }
  }
`;

const BOLT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>';
const MARK = '<svg viewBox="0 0 32 32" fill="none"><path d="M16 7l7 9-7 9-7-9z" fill="#FFB020"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export async function renderPanel(state: PanelJob, handlers: PanelHandlers): Promise<void> {
  if (await isDismissed()) return;
  removePanel();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position: fixed',
    'top: 0',
    'right: 0',
    'height: 100vh',
    'width: 372px',
    'max-width: 100vw',
    'z-index: 2147483647',
    // The host must not eat clicks on the page around the collapsed handle.
    'pointer-events: none',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const root = document.createElement('div');
  root.style.cssText = 'pointer-events: auto; height: 100%;';

  // Starts closed. The panel is opened by the button below, not by arriving on
  // a page — covering a third of someone's window uninvited is the behaviour
  // that makes extensions get uninstalled.
  let collapsed = true;

  const paint = () => {
    root.innerHTML = '';

    if (collapsed) {
      const handle = document.createElement('button');
      handle.className = 'handle';

      /*
       * The label tracks what is actually on the page. On a LinkedIn posting
       * there is no form until Easy Apply is clicked, so promising "Autofill"
       * there would be a button that cannot do what it says.
       */
      const hasFields = state.coverage.fillable > 0;
      const label = hasFields
        ? `Autofill ${state.coverage.fillable} fields with jobpilot`
        : 'Open jobpilot — save this job or check for duplicates';

      handle.setAttribute('aria-label', label);
      handle.title = label;
      handle.innerHTML = BOLT;
      handle.append(document.createTextNode(hasFields ? 'Autofill' : 'jobpilot'));

      if (hasFields) {
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(state.coverage.fillable);
        handle.append(count);
      }

      handle.addEventListener('click', () => {
        collapsed = false;
        paint();
      });

      root.append(handle);
      // Narrow host while closed, so the page stays clickable everywhere the
      // button is not.
      host.style.width = '200px';
      return;
    }

    host.style.width = '372px';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'jobpilot');

    /* Header */
    const header = document.createElement('header');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.innerHTML = MARK;
    const word = document.createElement('span');
    word.className = 'wordmark';
    word.textContent = 'jobpilot';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = state.email ?? '';

    const collapse = document.createElement('button');
    collapse.className = 'icon-btn';
    collapse.setAttribute('aria-label', 'Collapse');
    collapse.innerHTML = CHEV;
    collapse.addEventListener('click', () => {
      collapsed = true;
      paint();
    });

    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Hide on this site');
    close.title = 'Hide on this site';
    close.innerHTML = CLOSE;
    close.addEventListener('click', () => {
      void rememberDismissed();
      removePanel();
    });

    header.append(mark, word, who, collapse, close);

    /* Body */
    const body = document.createElement('div');
    body.className = 'body';

    const jobCard = document.createElement('div');
    jobCard.className = 'card';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = state.job.title ?? 'This posting';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [state.job.company, state.job.location].filter(Boolean).join(' · ');
    jobCard.append(role, meta);

    const lampRow = document.createElement('div');
    lampRow.className = 'lamp-row';
    lampRow.innerHTML = '<span class="lamp"></span>';
    lampRow.append(
      document.createTextNode(
        `${state.coverage.fillable} of ${state.coverage.total} fields can be filled`
      )
    );
    jobCard.append(lampRow);
    body.append(jobCard);

    if (state.duplicate) {
      const dup = document.createElement('div');
      dup.className = 'card warn';
      const t = document.createElement('div');
      t.className = 'role';
      t.textContent = 'You already applied to this role';
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = `${state.duplicate.title} at ${state.duplicate.companyName} · ${
        state.duplicate.daysAgo ?? '?'
      } days ago · ${state.duplicate.status.toLowerCase()}`;
      dup.append(t, m);
      body.append(dup);
    }

    const save = document.createElement('button');
    save.className = 'ghost';
    save.textContent = 'Save this job';
    save.addEventListener('click', () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      void handlers.onSave().then((ok) => {
        save.textContent = ok ? 'Saved to your tracker' : 'Could not save';
        if (!ok) save.disabled = false;
      });
    });
    body.append(save);

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      'Autofill never submits, and leaves a field blank rather than guessing at it.';
    body.append(note);

    /* Primary action */
    const action = document.createElement('div');
    action.className = 'action';

    const fill = document.createElement('button');
    fill.className = 'fill';
    fill.innerHTML = BOLT;
    fill.append(
      document.createTextNode(
        state.coverage.fillable > 0
          ? `Fill ${state.coverage.fillable} field${state.coverage.fillable === 1 ? '' : 's'}`
          : 'Nothing to fill here'
      )
    );
    fill.disabled = state.coverage.fillable === 0;

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const overwrite = document.createElement('input');
    overwrite.type = 'checkbox';
    toggle.append(overwrite, document.createTextNode('Replace values I already typed'));

    fill.addEventListener('click', () => {
      fill.disabled = true;
      fill.textContent = 'Filling…';
      void handlers.onFill(overwrite.checked).then((r) => {
        fill.textContent =
          r.filled > 0
            ? `Filled ${r.filled}${r.unanswered > 0 ? ` · ${r.unanswered} left for you` : ''}`
            : 'Nothing was filled';
        setTimeout(() => {
          fill.disabled = false;
          fill.innerHTML = BOLT;
          fill.append(document.createTextNode('Fill again'));
        }, 2600);
      });
    });

    action.append(fill, toggle);

    /* Footer */
    const foot = document.createElement('div');
    foot.className = 'foot';
    const out = document.createElement('button');
    out.className = 'link';
    out.textContent = 'Sign out';
    out.addEventListener('click', handlers.onSignOut);
    foot.append(out);

    panel.append(header, body, action, foot);
    root.append(panel);
  };

  paint();
  shadow.append(style, root);
  document.documentElement.append(host);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      collapsed = true;
      paint();
    }
  };
  window.addEventListener('keydown', onKey);

  mounted = {
    destroy: () => window.removeEventListener('keydown', onKey),
  };
}
