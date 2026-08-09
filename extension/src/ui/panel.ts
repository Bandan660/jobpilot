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

export interface PanelJob {
  job: CapturedJob;
  coverage: { fillable: number; total: number };
  email: string | null;
  duplicate: DuplicateMatch | null;
  /**
   * Signed out renders the form in the panel rather than sending people to the
   * toolbar popup. Chrome caps that popup at 600px, so it can never be the
   * full-height surface — and bouncing between two windows to sign in, then
   * back to the page to act, was the confusing part.
   */
  authenticated: boolean;
  /** Easy Apply is available here, so the auto-apply action is worth showing. */
  canAutoApply: boolean;
  /** The resume on file, or null when the profile has none. Metadata only. */
  resume: { fileName: string; sizeBytes: number } | null;
  /** Whether this page has somewhere to put it. */
  hasResumeField: boolean;
  /**
   * Is there an application form here at all?
   *
   * Distinct from a coverage of zero. No form and a form with nothing we
   * recognise are different situations and the panel says so, because the
   * combined message counted the host page own controls as fields.
   */
  hasForm: boolean;
  /**
   * There is an application here this can drive end to end. Elsewhere the
   * section is hidden rather than disabled — an offer that can never be taken
   * on this page is just clutter.
   */
  canApply: boolean;
}

export interface PanelHandlers {
  onFill: (overwrite: boolean) => Promise<{ filled: number; unanswered: number }>;
  onSave: () => Promise<boolean>;
  onSignOut: () => void;
  /** Resolves to an error message, or null on success. */
  onAuth: (mode: 'login' | 'signup', email: string, password: string) => Promise<string | null>;
  /** Runs the Easy Apply sequence, reporting progress as it goes. */
  onAutoApply: (
    report: (line: string, tone: 'busy' | 'blocked' | 'ready') => void,
    draftAnswers: boolean
  ) => Promise<void>;
  onCancelAutoApply: () => void;
  /** Puts the stored resume in the form's file input. Resolves to a message. */
  onAttachResume: () => Promise<{ ok: boolean; message: string }>;
  /** Opens the profile page, for when there is no resume to attach. */
  onOpenProfile: () => void;

  /* One application at a time. */
  onStartSession: () => void;
  /** Called after the user has answered the questions the form demanded. */
  onContinueSession: () => void;
  onCancelSession: () => void;
  onSaveAnswers: (answers: { label: string; answer: string }[]) => void;
}

/**
 * The live mount, kept so updates repaint in place.
 *
 * Tearing the host down and rebuilding it made the panel flash twice on every
 * job switch: once when the title arrived and again when the rest of the pane
 * settled. Reusing the element means those land as a content change nobody
 * sees rather than two full remounts.
 */
let mounted: {
  destroy: () => void;
  repaint: (state: PanelJob, handlers: PanelHandlers) => void;
} | null = null;

/* Kept so the panel can be reopened without the caller re-supplying them. */
let lastState: PanelJob | null = null;
let lastHandlers: PanelHandlers | null = null;

/*
 * Module-level, so it survives a re-render.
 *
 * The panel is redrawn whenever the posting or the form changes, and a local
 * flag would snap it shut mid-use every time the Easy Apply modal advanced a
 * step. Open is a decision the user made; redrawing the contents is not a
 * reason to undo it.
 */
let collapsed = true;

/**
 * Auto-apply run state, module-level for exactly the reason `collapsed` is —
 * and missed when `collapsed` was fixed.
 *
 * The run and the panel have different lifetimes. Opening Easy Apply changes
 * the form's field count, the field count is part of the tracking signature,
 * and a changed signature repaints the panel — so the panel is rebuilt roughly
 * one second into a run, and again on every step it advances. `paint()` clears
 * the root, which detached the status element the run's `report` callback had
 * captured. Everything after "Opening Easy Apply…" was then written into a
 * node that was no longer in the document.
 *
 * The visible result was the worst possible one: the modal opens, the run
 * stops on some step, and the panel says nothing at all — including when what
 * it had to say was "this step needs you".
 *
 * Held here instead, so a repaint restores the line and the button rather than
 * losing them. `active` lives here too: it was a local, so a repaint reset the
 * button to "Apply with jobpilot" mid-run and a second click started a second
 * run over the first.
 */
let autoApplyRun: {
  active: boolean;
  line: string | null;
  tone: 'busy' | 'blocked' | 'ready';
  /** Sticky across repaints and across jobs: a per-session preference. */
  draftAnswers: boolean;
} = { active: false, line: null, tone: 'busy', draftAnswers: false };

/** The live status node and button, re-pointed by every paint. */
let statusEl: HTMLElement | null = null;
let applyEl: HTMLButtonElement | null = null;

function paintRunState(): void {
  if (statusEl) {
    statusEl.hidden = autoApplyRun.line === null;
    statusEl.dataset.tone = autoApplyRun.tone;
    statusEl.innerHTML = autoApplyRun.tone === 'busy' ? '<span class="spin"></span>' : '';
    if (autoApplyRun.line) statusEl.append(document.createTextNode(autoApplyRun.line));
  }
  if (applyEl) {
    applyEl.textContent = autoApplyRun.active ? 'Stop' : 'Apply with jobpilot';
  }
}

/** Passed to the run, and safe to hold across any number of repaints. */
function reportRunProgress(line: string, tone: 'busy' | 'blocked' | 'ready'): void {
  autoApplyRun.line = line;
  autoApplyRun.tone = tone;
  paintRunState();
}

/** "bandan-pradhan.pdf" -> "PDF". Falls back to a generic mark. */
function extensionOf(fileName: string): string {
  const extension = fileName.split('.').pop()?.toUpperCase() ?? '';
  return extension && extension.length <= 4 ? extension : 'DOC';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ----------------------------- apply session ----------------------------- */

/**
 * Session state, module-level for the same reason everything else here is.
 *
 * An application changes the page repeatedly — the modal opens, each step
 * re-renders, the posting itself can change underneath — and every one of
 * those repaints the panel. Anything the session owns has to live outside
 * `paint()` or it is destroyed mid-application, taking its handlers with it.
 */
export interface PanelSession {
  state: 'idle' | 'running' | 'needs-input' | 'done' | 'error';
  stage: 'fill' | 'check' | 'submit' | null;
  message: string;
  /** Named questions the user has to answer in the page's own form. */
  questions: { label: string; kind: 'empty' | 'invalid' }[];
  /** Offered back to the profile after a submit that needed hand-filling. */
  answersToSave: { label: string; answer: string }[];
  savingAnswers: boolean;
  answersSaved: boolean;
}

const IDLE_SESSION: PanelSession = {
  state: 'idle',
  stage: null,
  message: '',
  questions: [],
  answersToSave: [],
  savingAnswers: false,
  answersSaved: false,
};

let session: PanelSession = { ...IDLE_SESSION };
let sessionRoot: HTMLElement | null = null;
let sessionActs: PanelHandlers | null = null;

/** Called by the session, from outside any paint. */
export function updateSession(next: Partial<PanelSession>): void {
  session = { ...session, ...next };
  paintSession();
}

export function resetPanelSession(): void {
  session = { ...IDLE_SESSION };
  paintSession();
}

const STAGES: { key: NonNullable<PanelSession['stage']>; label: string }[] = [
  { key: 'fill', label: 'Fill' },
  { key: 'check', label: 'Check' },
  { key: 'submit', label: 'Submit' },
];

function paintSession(): void {
  const root = sessionRoot;
  const acts = sessionActs;
  if (!root || !acts) return;

  root.innerHTML = '';
  root.dataset.state = session.state;

  /* Stage rail, while it is working. */
  if (session.state === 'running') {
    const rail = document.createElement('div');
    rail.className = 'rail';
    const reached = STAGES.findIndex((stage) => stage.key === session.stage);

    STAGES.forEach((stage, index) => {
      const dot = document.createElement('div');
      dot.className = 'stage';
      dot.dataset.state = index < reached ? 'done' : index === reached ? 'now' : 'todo';
      const bead = document.createElement('span');
      bead.className = 'bead';
      bead.textContent = index < reached ? '✓' : String(index + 1);
      const name = document.createElement('span');
      name.className = 'stage-l';
      name.textContent = stage.label;
      dot.append(bead, name);
      rail.append(dot);
    });
    root.append(rail);
  }

  /* The questions the user has to answer. This is the whole point. */
  if (session.state === 'needs-input') {
    const head = document.createElement('div');
    head.className = 'ask-head';
    head.textContent = session.message;
    root.append(head);

    const list = document.createElement('ul');
    list.className = 'asks';
    for (const question of session.questions) {
      const item = document.createElement('li');
      item.dataset.kind = question.kind;
      item.textContent = question.label;
      list.append(item);
    }
    root.append(list);

    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent =
      'Answer them in the application form itself, then press continue — nothing is lost.';
    root.append(hint);
  }

  if (session.state !== 'idle' && session.state !== 'needs-input' && session.message) {
    const line = document.createElement('div');
    line.className = 'sess-msg';
    line.dataset.tone = session.state;
    line.textContent = session.message;
    root.append(line);
  }

  /* Offer the hand-typed answers back to the profile. */
  if (session.state === 'done' && session.answersToSave.length > 0 && !session.answersSaved) {
    const offer = document.createElement('div');
    offer.className = 'offer';

    const text = document.createElement('div');
    text.className = 'offer-t';
    text.textContent =
      session.answersToSave.length === 1
        ? 'Save that answer to your profile so it fills itself next time?'
        : `Save those ${session.answersToSave.length} answers to your profile?`;

    const save = document.createElement('button');
    save.className = 'ghost';
    save.textContent = session.savingAnswers ? 'Saving…' : 'Save to profile';
    save.disabled = session.savingAnswers;
    save.addEventListener('click', () => acts.onSaveAnswers(session.answersToSave));

    offer.append(text, save);
    root.append(offer);
  }

  if (session.answersSaved) {
    const saved = document.createElement('p');
    saved.className = 'note';
    saved.textContent = 'Saved. Those questions will fill themselves from now on.';
    root.append(saved);
  }

  /* The one button, whose label is the state. */
  const action = document.createElement('button');
  action.className = 'fill';

  if (session.state === 'running') {
    action.textContent = 'Stop';
    action.addEventListener('click', () => acts.onCancelSession());
  } else if (session.state === 'needs-input') {
    action.textContent = 'Resume application';
    action.addEventListener('click', () => acts.onContinueSession());
  } else {
    action.textContent = session.state === 'done' ? 'Apply to another' : 'Apply with jobpilot';
    action.addEventListener('click', () => acts.onStartSession());
  }
  root.append(action);

  if (session.state === 'idle') {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      'Fills this one application, submits it, and adds it to your tracker. One job per press.';
    root.append(note);
  }
}

/**
 * Is the panel open, as opposed to collapsed to its edge handle?
 *
 * Used to decide whether a notification is worth raising: if the panel is
 * open the questions are already listed in it, and a banner on top would be
 * the same message twice, overlapping itself.
 */
/**
 * Open the panel because the run is waiting on the user.
 *
 * The panel deliberately never opens by itself — a surface covering a third of
 * the window before being asked for is what gets extensions removed. This is
 * the exception, and it is not the same thing: the user started this run, it
 * cannot finish without them, and the control they need is in here. Opening
 * unasked is rude; opening because you asked and I got stuck is the answer.
 */
export function openPanelForInput(): void {
  if (!mounted || !lastState || !lastHandlers) return;
  collapsed = false;
  mounted.repaint(lastState, lastHandlers);
}

export function panelIsOpen(): boolean {
  return !collapsed && mounted !== null;
}

export function removePanel(): void {
  mounted?.destroy();
  mounted = null;
  statusEl = null;
  applyEl = null;
  sessionRoot = null;
  document.getElementById(HOST_ID)?.remove();
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
  /*
   * SOLID, NOT GLASS.
   *
   * This was translucent with a backdrop blur, and over a light ATS page it
   * read as washed-out grey rather than as a dark panel — the blur pulls the
   * page's brightness through no matter how heavy the tint. Every surface here
   * is opaque now, and the panel reads as its own application again, which was
   * the whole reason it is dark in the first place.
   *
   * The token names still say "glass" so the rules below did not all have to
   * change. They are ordinary solid colours: a base, one step up for raised
   * cards, one more for hover, and two line weights.
   */
  .panel {
    --ink: #080d17;
    --panel: #0f1626;
    --raised: #182135;
    --line: #263149;
    --text: #e8edf7;
    --dim: #9fb0cc;
    --signal: #ffb020;
    --on-signal: #1a1204;
    --live: #3fcf8e;
    --warn: #ffb020;

    --glass: #0f1626;
    --glass-raised: #182135;
    --glass-hover: #1f2b44;
    --glass-line: #263149;
    --glass-edge: #33405e;

    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    background: var(--glass);
    border-left: 1px solid var(--glass-edge);
    box-shadow: -18px 0 48px rgba(0, 0, 0, 0.45);
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
    border-bottom: 1px solid var(--glass-line);
    background: var(--ink);
    flex-shrink: 0;
  }

  .mark {
    width: 22px; height: 22px; border-radius: 7px;
    background: linear-gradient(145deg, rgba(255,176,32,0.22), rgba(11,18,32,0.9));
    border: 1px solid rgba(255,176,32,0.28);
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
  .icon-btn:hover { color: var(--text); background: var(--glass-hover); }
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
    background: var(--glass-raised);
    border: 1px solid var(--glass-line);
    border-radius: 12px;
    padding: 12px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }

  .role { font-size: 14px; font-weight: 650; letter-spacing: -0.01em; }
  .meta { color: var(--dim); font-size: 12px; margin-top: 3px; }

  .lamp-row {
    display: flex; align-items: center; gap: 6px;
    margin-top: 9px; padding-top: 9px;
    border-top: 1px solid var(--glass-line);
    font-size: 11px; color: var(--dim);
  }
  .lamp {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--live); flex-shrink: 0;
    box-shadow: 0 0 0 3px rgba(63, 207, 142, 0.14);
  }

  /* Duplicate warning. Amber not red: applying twice is worth knowing about,
     not an error, and red here would read as "something broke". */
  .warn {
    border-color: rgba(255, 176, 32, 0.4);
    background: rgba(255, 176, 32, 0.09);
  }
  .warn .role { color: var(--signal); font-size: 12.5px; }

  .action {
    padding: 14px 16px;
    border-top: 1px solid var(--glass-line);
    background: var(--ink);
    flex-shrink: 0;
  }

  .fill {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: linear-gradient(180deg, #ffbe45, var(--signal));
    color: var(--on-signal);
    border: none; border-radius: 10px;
    padding: 13px 16px;
    font: inherit; font-size: 14px; font-weight: 700;
    cursor: pointer;
    box-shadow:
      0 6px 18px rgba(255, 176, 32, 0.22),
      inset 0 1px 0 rgba(255, 255, 255, 0.34);
    transition: filter 140ms ease, transform 140ms ease;
  }
  .fill:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
  .fill:active:not(:disabled) { transform: translateY(0); }
  .fill:disabled { opacity: 0.5; cursor: default; }
  .fill svg { width: 15px; height: 15px; }

  .ghost {
    width: 100%;
    background: var(--glass-raised);
    color: var(--text);
    border: 1px solid var(--glass-line);
    border-radius: 10px;
    padding: 10px 14px;
    font: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    transition: background 140ms ease, border-color 140ms ease;
  }
  .ghost:hover:not(:disabled) { background: var(--glass-hover); border-color: var(--glass-edge); }
  .ghost:disabled { opacity: 0.5; cursor: default; }

  .toggle {
    display: flex; align-items: center; gap: 8px;
    margin-top: 10px;
    font-size: 12px; color: var(--dim);
    cursor: pointer;
  }
  .toggle input { accent-color: var(--signal); width: 14px; height: 14px; cursor: pointer; }

  .note { font-size: 11.5px; color: var(--dim); }

  /* Bulk run -------------------------------------------------------------- */

  /* Not a card: it is the action bar's own content, not something inside it. */
  .run { display: flex; flex-direction: column; gap: 10px; }
  .run > .fill { margin-top: 0; }

  /* Stage rail */
  .rail { display: flex; align-items: center; justify-content: space-between; }
  .stage { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .bead {
    width: 21px; height: 21px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 10px; font-weight: 700;
    border: 1px solid var(--glass-line);
    color: var(--dim);
  }
  .stage-l { font-size: 9.5px; color: var(--dim); }
  .stage[data-state='done'] .bead { background: rgba(63,207,142,0.18); border-color: rgba(63,207,142,0.5); color: var(--live); }
  .stage[data-state='done'] .stage-l { color: var(--live); }
  .stage[data-state='now'] .bead {
    background: var(--signal); border-color: transparent; color: var(--on-signal);
    box-shadow: 0 0 0 4px rgba(255,176,32,0.16);
  }
  .stage[data-state='now'] .stage-l { color: var(--signal); font-weight: 700; }

  /* The questions the form still wants. Amber, not red: nothing is broken. */
  .ask-head { font-size: 12.5px; font-weight: 650; color: var(--signal); }
  .asks { list-style: none; margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
  .asks li {
    font-size: 12px; line-height: 1.35;
    padding: 7px 9px; border-radius: 8px;
    background: rgba(255,176,32,0.10);
    border: 1px solid rgba(255,176,32,0.28);
  }
  .asks li[data-kind='invalid'] {
    background: rgba(239,68,68,0.10);
    border-color: rgba(239,68,68,0.3);
  }
  .asks li[data-kind='invalid']::before { content: '⚠︎  '; opacity: 0.8; }

  .sess-msg { font-size: 12px; line-height: 1.4; color: var(--dim); }
  .sess-msg[data-tone='done']  { color: var(--live); font-weight: 600; }
  .sess-msg[data-tone='error'] { color: #ff9b9b; }

  .offer {
    margin-top: 11px; padding: 10px;
    border: 1px solid var(--glass-line); border-radius: 10px;
    background: var(--glass-raised);
  }
  .offer-t { font-size: 12px; line-height: 1.4; margin-bottom: 8px; }

  .run .fill { margin-top: 11px; }

  /* Resume ---------------------------------------------------------------- */

  .resume { display: flex; align-items: center; gap: 10px; }

  .doc {
    width: 30px; height: 34px; border-radius: 5px; flex-shrink: 0;
    display: grid; place-items: center;
    background: linear-gradient(160deg, rgba(255,176,32,0.18), rgba(255,255,255,0.04));
    border: 1px solid rgba(255,176,32,0.26);
    color: var(--signal);
    font-size: 8.5px; font-weight: 800; letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* min-width:0 or a long filename pushes the button off the panel. */
  .resume-meta { min-width: 0; flex: 1; }
  .resume-name {
    font-size: 12.5px; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .resume-sub { font-size: 11px; color: var(--dim); margin-top: 1px; }

  .attach {
    flex-shrink: 0;
    background: var(--glass-raised);
    color: var(--text);
    border: 1px solid var(--glass-line);
    border-radius: 8px;
    padding: 7px 11px;
    font: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .attach:hover:not(:disabled) { background: var(--glass-hover); border-color: var(--glass-edge); }
  .attach:disabled { opacity: 0.55; cursor: default; }
  .attach[data-done='1'] { color: var(--live); border-color: rgba(63,207,142,0.35); }

  .linkish {
    background: none; border: none; padding: 0;
    color: var(--signal); font: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
  }

  /* Run status ----------------------------------------------------------- */

  .status {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border-radius: 8px;
    padding: 10px 11px;
    font-size: 12px;
    line-height: 1.45;
  }
  .status[data-tone='busy']    { background: rgba(74,168,216,0.12); color: #a9d6ee; }
  .status[data-tone='blocked'] { background: rgba(255,176,32,0.12); color: #ffd08a; }
  .status[data-tone='ready']   { background: rgba(63,207,142,0.12); color: #9fe6c4; }

  /* Spins only while the run is active, and never under reduced motion. */
  .spin {
    width: 12px; height: 12px; flex-shrink: 0; margin-top: 2px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
  }
  @media (prefers-reduced-motion: no-preference) {
    .status[data-tone='busy'] .spin { animation: rot 700ms linear infinite; }
  }
  @keyframes rot { to { transform: rotate(360deg); } }

  .apply {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: transparent;
    color: var(--signal);
    border: 1px solid var(--signal);
    border-radius: 8px;
    padding: 11px 16px;
    font: inherit; font-size: 13.5px; font-weight: 700;
    cursor: pointer;
    margin-top: 9px;
  }
  .apply:hover:not(:disabled) { background: rgba(255,176,32,0.1); }
  .apply:disabled { opacity: 0.5; cursor: default; }

  /* Auth form ------------------------------------------------------------ */

  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label { font-size: 11.5px; color: var(--dim); font-weight: 600; }
  .field input {
    background: var(--ink);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px 11px;
    color: var(--text);
    font: inherit; font-size: 13px;
  }
  .field input:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 1px;
    border-color: transparent;
  }
  .field input::placeholder { color: #6b7d99; }

  .err {
    background: rgba(255, 107, 94, 0.12);
    border: 1px solid rgba(255, 107, 94, 0.35);
    color: #ffb4ac;
    border-radius: 7px;
    padding: 9px 11px;
    font-size: 12px;
  }

  .switch {
    background: none; border: none; padding: 0;
    color: var(--signal); font: inherit; font-size: 12.5px;
    cursor: pointer; text-decoration: underline; align-self: center;
  }

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
    [data-first] .handle { animation: pop 260ms cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes pop {
      from { opacity: 0; transform: translateY(-50%) translateX(14px); }
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    [data-first] .panel { animation: slide 220ms cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes slide { from { transform: translateX(100%); } }
  }
`;

const BOLT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/></svg>';
const MARK = '<svg viewBox="0 0 32 32" fill="none"><path d="M16 7l7 9-7 9-7-9z" fill="#FFB020"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * Signed-out view: the same panel shell with a sign-in form in place of the
 * job actions, so the surface never changes shape underneath the user.
 */
function buildAuth(
  state: PanelJob,
  handlers: PanelHandlers,
  onCollapse: () => void
): HTMLElement {
  let mode: 'login' | 'signup' = 'login';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'jobpilot');

  const header = document.createElement('header');
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.innerHTML = MARK;
  const word = document.createElement('span');
  word.className = 'wordmark';
  word.textContent = 'jobpilot';
  const spacer = document.createElement('span');
  spacer.className = 'who';
  const collapse = document.createElement('button');
  collapse.className = 'icon-btn';
  collapse.setAttribute('aria-label', 'Collapse');
  collapse.innerHTML = CHEV;
  collapse.addEventListener('click', onCollapse);
  header.append(mark, word, spacer, collapse);

  const body = document.createElement('div');
  body.className = 'body';

  const intro = document.createElement('p');
  intro.className = 'note';

  const job = document.createElement('div');
  job.className = 'card';
  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = state.job.title ?? 'This posting';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [state.job.company, state.job.location].filter(Boolean).join(' · ');
  job.append(role, meta);

  const emailField = document.createElement('div');
  emailField.className = 'field';
  const emailLabel = document.createElement('label');
  emailLabel.textContent = 'Email';
  const email = document.createElement('input');
  email.type = 'email';
  email.autocomplete = 'username';
  email.placeholder = 'you@example.com';
  emailLabel.htmlFor = email.id = 'jp-email';
  emailField.append(emailLabel, email);

  const passField = document.createElement('div');
  passField.className = 'field';
  const passLabel = document.createElement('label');
  passLabel.textContent = 'Password';
  const password = document.createElement('input');
  password.type = 'password';
  password.placeholder = 'At least 8 characters';
  passLabel.htmlFor = password.id = 'jp-password';
  passField.append(passLabel, password);

  const error = document.createElement('div');
  error.className = 'err';
  error.hidden = true;

  const switcher = document.createElement('button');
  switcher.className = 'switch';

  const action = document.createElement('div');
  action.className = 'action';
  const submit = document.createElement('button');
  submit.className = 'fill';
  action.append(submit);

  const applyMode = () => {
    intro.textContent =
      mode === 'login'
        ? 'Sign in to autofill this application and record it in your tracker.'
        : 'Create an account to autofill applications and track every one you send.';
    submit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    switcher.textContent =
      mode === 'login' ? 'No account? Create one' : 'Already have an account? Sign in';
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  };

  switcher.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    error.hidden = true;
    applyMode();
  });

  const go = async () => {
    error.hidden = true;
    if (!email.value.trim() || !password.value) {
      error.textContent = 'Enter your email and password.';
      error.hidden = false;
      return;
    }

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = mode === 'login' ? 'Signing in…' : 'Creating…';

    const failure = await handlers.onAuth(mode, email.value.trim(), password.value);
    if (failure) {
      error.textContent = failure;
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = label;
    }
    // On success the caller re-renders the panel, so this element goes away.
  };

  submit.addEventListener('click', () => void go());
  // Enter submits from either field, which is what a two-field form implies.
  for (const input of [email, password]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void go();
    });
  }

  applyMode();
  body.append(intro, job, emailField, passField, error, switcher);
  panel.append(header, body, action);
  return panel;
}

export async function renderPanel(state: PanelJob, handlers: PanelHandlers): Promise<void> {
  // Already on the page: swap the contents and leave the element alone.
  lastState = state;
  lastHandlers = handlers;

  if (mounted && document.getElementById(HOST_ID)) {
    mounted.repaint(state, handlers);
    return;
  }

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
  // Cleared after the first paint, so later updates appear without motion.
  root.setAttribute('data-first', '');

  // Mutable, so repaint() can swap them without recreating the closure.
  let current = state;
  let acts = handlers;

  const paint = () => {
    root.innerHTML = '';
    // Everything below is about to be recreated; nothing may hold a reference
    // to the nodes this just discarded.
    statusEl = null;
    applyEl = null;
    sessionRoot = null;

    if (collapsed) {
      const handle = document.createElement('button');
      handle.className = 'handle';

      /*
       * The label tracks what is actually on the page. On a LinkedIn posting
       * there is no form until Easy Apply is clicked, so promising "Autofill"
       * there would be a button that cannot do what it says.
       */
      const hasFields = current.coverage.fillable > 0;
      const label = hasFields
        ? `Autofill ${current.coverage.fillable} fields with jobpilot`
        : 'Open jobpilot — save this job or check for duplicates';

      handle.setAttribute('aria-label', label);
      handle.title = label;
      handle.innerHTML = BOLT;
      handle.append(document.createTextNode(hasFields ? 'Autofill' : 'jobpilot'));

      if (hasFields) {
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(current.coverage.fillable);
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

    if (!current.authenticated) {
      root.append(buildAuth(state, handlers, () => {
        collapsed = true;
        paint();
      }));
      return;
    }

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
    who.textContent = current.email ?? '';

    const collapse = document.createElement('button');
    collapse.className = 'icon-btn';
    collapse.setAttribute('aria-label', 'Collapse');
    collapse.innerHTML = CHEV;
    collapse.addEventListener('click', () => {
      collapsed = true;
      paint();
    });

    /*
     * Closes to the launcher, not away entirely. A close that removes the only
     * way back leaves no route to the panel short of reloading the page, which
     * is not what a close button should mean.
     */
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.innerHTML = CLOSE;
    close.addEventListener('click', () => {
      collapsed = true;
      paint();
    });

    header.append(mark, word, who, collapse, close);

    /* Body */
    const body = document.createElement('div');
    body.className = 'body';

    const jobCard = document.createElement('div');
    jobCard.className = 'card';
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = current.job.title ?? 'This posting';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [current.job.company, current.job.location].filter(Boolean).join(' · ');
    jobCard.append(role, meta);

    /*
     * Three states, three sentences.
     *
     * "0 of 28 fields can be filled" was one sentence covering all of them,
     * and on a posting with no form at all the 28 was the host page's search
     * box and filters. A count is only meaningful once there is a form to
     * count within; otherwise say there isn't one.
     */
    const lampRow = document.createElement('div');
    lampRow.className = 'lamp-row';
    const status = !current.hasForm
      ? current.canApply
        ? { state: 'ready', text: 'Ready to apply — the form opens when you start' }
        : { state: 'no-form', text: 'No application form on this page' }
      : current.coverage.fillable === 0
        ? {
            state: 'no-match',
            text: `Nothing here matches your profile (${current.coverage.total} field${
              current.coverage.total === 1 ? '' : 's'
            })`,
          }
        : {
            state: 'ready',
            text: `${current.coverage.fillable} of ${current.coverage.total} fields can be filled`,
          };

    lampRow.dataset.state = status.state;
    lampRow.innerHTML = '<span class="lamp"></span>';
    lampRow.append(document.createTextNode(status.text));
    jobCard.append(lampRow);
    body.append(jobCard);

    if (current.duplicate) {
      const dup = document.createElement('div');
      dup.className = 'card warn';
      const t = document.createElement('div');
      t.className = 'role';
      t.textContent = 'You already applied to this role';
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = `${current.duplicate.title} at ${current.duplicate.companyName} · ${
        current.duplicate.daysAgo ?? '?'
      } days ago · ${current.duplicate.status.toLowerCase()}`;
      dup.append(t, m);
      body.append(dup);
    }

    const save = document.createElement('button');
    save.className = 'ghost';
    save.textContent = 'Save this job';
    save.addEventListener('click', () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      void acts.onSave().then((ok) => {
        save.textContent = ok ? 'Saved to your tracker' : 'Could not save';
        if (!ok) save.disabled = false;
      });
    });
    body.append(save);

    /*
     * The resume from the profile.
     *
     * Shown whenever there is one, not only when this page can take it —
     * knowing which resume jobpilot would send is worth as much as being able
     * to send it, and a card that appears and disappears between postings is
     * harder to trust than one that is always there saying what it holds.
     */
    const resumeCard = document.createElement('div');
    resumeCard.className = 'card resume';

    const doc = document.createElement('div');
    doc.className = 'doc';

    const rMeta = document.createElement('div');
    rMeta.className = 'resume-meta';
    const rName = document.createElement('div');
    rName.className = 'resume-name';
    const sub = document.createElement('div');
    sub.className = 'resume-sub';
    rMeta.append(rName, sub);

    if (current.resume) {
      doc.textContent = extensionOf(current.resume.fileName);
      rName.textContent = current.resume.fileName;
      rName.title = current.resume.fileName;
      sub.textContent = formatBytes(current.resume.sizeBytes);
      resumeCard.append(doc, rMeta);

      if (current.hasResumeField) {
        const attach = document.createElement('button');
        attach.className = 'attach';
        attach.textContent = 'Attach';
        attach.addEventListener('click', () => {
          attach.disabled = true;
          attach.textContent = 'Attaching…';
          void acts.onAttachResume().then((result) => {
            attach.textContent = result.ok ? 'Attached' : 'Failed';
            attach.dataset.done = result.ok ? '1' : '0';
            sub.textContent = result.message;
            // Only a success is final. A failure is worth another try, since
            // the usual cause is the form not having rendered its field yet.
            if (!result.ok) {
              setTimeout(() => {
                attach.disabled = false;
                attach.textContent = 'Attach';
                delete attach.dataset.done;
              }, 2600);
            }
          });
        });
        resumeCard.append(attach);
      } else {
        sub.textContent = formatBytes(current.resume.sizeBytes);
      }
    } else {
      doc.textContent = '—';
      rName.textContent = 'No resume saved';
      sub.textContent = 'Add one to your profile and it attaches itself.';
      resumeCard.append(doc, rMeta);

      const open = document.createElement('button');
      open.className = 'linkish';
      open.textContent = 'Profile';
      open.addEventListener('click', () => acts.onOpenProfile());
      resumeCard.append(open);
    }

    body.append(resumeCard);

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      'Autofill never submits, and leaves a field blank rather than guessing at it.';
    body.append(note);

    /* Primary action */
    const action = document.createElement('div');
    action.className = 'action';

    /*
     * The run owns its own subtree. paint() creates the container and nothing
     * else; everything inside is drawn by paintRun(), which the run calls
     * directly so its updates do not depend on a repaint happening.
     */
    if (current.canApply) {
      const sessionSection = document.createElement('div');
      sessionSection.className = 'run';
      sessionRoot = sessionSection;
      sessionActs = acts;
      paintSession();
      action.append(sessionSection);
    }

    /*
      * Shown only when it is the useful thing to press: there is a form here
      * and no session to run. With a session available the session fills as
      * its first step; with no form at all there is nothing to fill.
      */
    const showFill = current.hasForm && !current.canApply;

    const fill = document.createElement('button');
    fill.className = 'fill';
    fill.innerHTML = BOLT;
    fill.append(
      document.createTextNode(
        current.coverage.fillable > 0
          ? `Fill ${current.coverage.fillable} field${current.coverage.fillable === 1 ? '' : 's'}`
          : current.hasForm
            ? 'Nothing to fill here'
            : 'No form to fill'
      )
    );
    fill.disabled = current.coverage.fillable === 0;

    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    const overwrite = document.createElement('input');
    overwrite.type = 'checkbox';
    toggle.append(overwrite, document.createTextNode('Replace values I already typed'));

    fill.addEventListener('click', () => {
      fill.disabled = true;
      fill.textContent = 'Filling…';
      void acts.onFill(overwrite.checked).then((r) => {
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

    if (showFill) action.append(fill, toggle);

    if (current.canAutoApply) {
      const status = document.createElement('div');
      status.className = 'status';

      const apply = document.createElement('button');
      apply.className = 'apply';

      /*
       * Off by default, and stays off. Drafting sends the question and the
       * user's history to a model, which is a decision they should make per
       * application rather than one made for them once.
       */
      const draftToggle = document.createElement('label');
      draftToggle.className = 'toggle';
      const draft = document.createElement('input');
      draft.type = 'checkbox';
      draft.checked = autoApplyRun.draftAnswers;
      draft.addEventListener('change', () => {
        autoApplyRun.draftAnswers = draft.checked;
      });
      draftToggle.append(draft, document.createTextNode('Draft long answers with AI'));

      // Re-point the module-level handles at this paint's nodes, then restore
      // whatever a run in flight has already reported.
      statusEl = status;
      applyEl = apply;
      paintRunState();

      apply.addEventListener('click', () => {
        if (autoApplyRun.active) {
          acts.onCancelAutoApply();
          return;
        }

        autoApplyRun = { ...autoApplyRun, active: true, line: null, tone: 'busy' };
        paintRunState();

        void acts.onAutoApply(reportRunProgress, autoApplyRun.draftAnswers).finally(() => {
          autoApplyRun.active = false;
          paintRunState();
        });
      });

      /* Says where it stops before it starts, so nobody expects a submit. */
      const caveat = document.createElement('p');
      caveat.className = 'note';
      caveat.textContent =
        'Fills the form, attaches your resume, and stops at submit. You press submit.';

      action.append(apply, draftToggle, caveat, status);
    }

    /* Footer */
    const foot = document.createElement('div');
    foot.className = 'foot';
    const out = document.createElement('button');
    out.className = 'link';
    out.textContent = 'Sign out';
    out.addEventListener('click', acts.onSignOut);
    foot.append(out);

    panel.append(header, body, action, foot);
    root.append(panel);
  };

  paint();
  shadow.append(style, root);
  // Next frame: the entrance has started, and every later paint is an update.
  requestAnimationFrame(() => root.removeAttribute('data-first'));
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
    repaint: (next, nextHandlers) => {
      current = next;
      acts = nextHandlers;
      paint();
    },
  };
}
