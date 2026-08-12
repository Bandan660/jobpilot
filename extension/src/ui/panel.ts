import { relativeTime, type CapturedJob, type DuplicateMatch } from '@jobpilot/shared';
import { POPOVER_RESET, promoteToTopLayer, reraise, sealEvents } from './topLayer.js';
import { DEFAULT_WEB_BASE_URL } from '../config.js';

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

const HOST_ID = 'banapply-panel-host';

/** What the local matcher reports. No prose, so no model. */
export interface SkillSummary {
  score: number;
  matched: string[];
  missing: string[];
  /** Nice-to-haves the profile evidences. Shown, never scored. */
  bonus: string[];
  /** Nice-to-haves it does not. Shown last, and explicitly not a gap. */
  preferred: string[];
  yearsWanted: number | null;
}

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
  /**
   * The skills comparison, already computed.
   *
   * Passed in rather than fetched on demand because it is now a set
   * intersection rather than a model call — there is nothing to wait for and
   * nothing to spend, so making the user press a button to see it was asking
   * them to do work the machine had already done.
   */
  match: SkillSummary | null;
  /** Set only when the description could not be read: which containers missed. */
  matchDiagnostic?: string[];
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
  /** This posting redirects to an external company website (e.g. Naukri "Apply on company website"). */
  isExternalJob?: boolean;
  /** Match calculation is in-flight / settling. */
  isAnalyzingMatch?: boolean;
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

  /* One application at a time. */
  onStartSession: () => void;
  /**
   * Called after the user has answered the questions the form demanded.
   *
   * CURRENTLY UNWIRED, on purpose — noted here because an orphaned hook has
   * cost this project a debugging session before. The button that called it is
   * disabled during `needs-input`: pressing it on LinkedIn dismisses the
   * application, and the run resumes itself when the answers appear, so there
   * is nothing left for it to do. It loses nothing either way — `runApply`
   * re-runs `findBlockers` on entry, so pressing continue while a blocker
   * stands would report the same blocker straight back.
   */
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
    applyEl.textContent = autoApplyRun.active ? 'Stop' : 'Apply with BanApply';
  }
}

/** Passed to the run, and safe to hold across any number of repaints. */
function reportRunProgress(line: string, tone: 'busy' | 'blocked' | 'ready'): void {
  autoApplyRun.line = line;
  autoApplyRun.tone = tone;
  paintRunState();
}

/* -------------------------------- match ---------------------------------- */

/**
 * How well this posting's named skills line up with the profile.
 *
 * WHAT THE NUMBER IS, AND WHAT IT IS NOT
 *
 * The share of the skills this posting *names* that the profile evidences. It
 * is not a chance of being called back, and nothing here says it is: this
 * cannot see the other applicants, the budget, the referral the role is
 * already earmarked for, or whether it is filled. A number presented as odds
 * would be invented, and the cost of inventing it is someone skipping a job
 * they were right for because a panel said 40%.
 *
 * The lists are the useful half. "Not in your profile" is a thing to act on
 * before applying; the percentage is a glance.
 *
 * Drawn on arrival rather than behind a button, because the comparison is a
 * set intersection over a dictionary — there is nothing to wait for and
 * nothing to spend.
 */
function matchCard(match: SkillSummary): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card match';

  const total = match.matched.length + match.missing.length;

  /*
   * Nothing recognised is not a zero. A posting written entirely in prose, or
   * about a field the dictionary does not cover, says nothing about the
   * candidate — and "0%" would read as a verdict on them.
   */
  if (total === 0) {
    const none = document.createElement('div');
    none.className = 'match-line';
    none.textContent = 'No skills named in this posting that BanApply recognises.';
    card.append(none);
    return card;
  }

  const top = document.createElement('div');
  top.className = 'match-top';

  const dial = document.createElement('div');
  dial.className = 'dial';
  /*
   * Three bands, not a gradient. A number sliding through fifty shades invites
   * reading a precision into it that a dictionary lookup has not earned.
   */
  dial.dataset.band = match.score >= 70 ? 'high' : match.score >= 40 ? 'mid' : 'low';
  dial.style.setProperty('--pct', String(Math.max(0, Math.min(100, match.score))));
  const num = document.createElement('span');
  num.className = 'dial-n';
  num.textContent = String(match.score);
  dial.append(num);

  const verdict = document.createElement('div');
  verdict.className = 'match-verdict';

  const chanceTag = document.createElement('div');
  chanceTag.style.cssText = `font-size: 11.5px; font-weight: 800; color: ${
    match.score >= 70 ? '#10b981' : match.score >= 40 ? '#ffb020' : '#ff8f8f'
  }; margin-bottom: 2px;`;
  /*
   * Overlap, not odds.
   *
   * This read "High Shortlist Chance" / "Low Shortlist Odds", which is the one
   * thing this number must never be presented as. Nothing here can see the
   * other applicants, the budget, the referral the role is already earmarked
   * for, or whether it is already filled — so a shortlist probability would be
   * invented, and the cost of inventing it is someone skipping a job they were
   * right for because a dictionary lookup said "Low Odds".
   *
   * What it can honestly say is how much of what the posting asks for the
   * profile evidences, which is what the bands describe now.
   */
  chanceTag.textContent =
    match.score >= 70
      ? 'Strong overlap with what this posting asks for'
      : match.score >= 40
      ? 'Partial overlap with what this posting asks for'
      : 'Limited overlap with what this posting asks for';

  const label = document.createElement('div');
  label.className = 'match-label';
  const parts = [`${match.matched.length} of ${total} named`];
  if (match.yearsWanted !== null) parts.push(`asks ${match.yearsWanted}+ years`);

  const line = document.createElement('div');
  line.className = 'match-line';
  line.textContent = `${parts.join(' · ')}`;
  verdict.append(label, line);

  top.append(dial, verdict);
  card.append(top);

  /*
   * Capped, because this is the one part of the panel with no upper bound: a
   * posting naming twenty technologies produces twenty chips and pushes the
   * actions off the bottom of the window. Six is about two rows. The rest are
   * one click away rather than hidden — the count says how many.
   */
  const VISIBLE_CHIPS = 6;

  const chips = (items: string[], kind: 'has' | 'gap' | 'extra', heading: string) => {
    if (items.length === 0) return;

    const group = document.createElement('div');
    group.className = 'chips-group';
    const h = document.createElement('div');
    h.className = 'chips-h';
    h.textContent = `${heading} (${items.length})`;
    const row = document.createElement('div');
    row.className = 'chips';

    const add = (item: string) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.kind = kind;
      chip.textContent = item;
      row.append(chip);
    };

    for (const item of items.slice(0, VISIBLE_CHIPS)) add(item);

    if (items.length > VISIBLE_CHIPS) {
      const more = document.createElement('button');
      more.className = 'chip more';
      more.textContent = `+${items.length - VISIBLE_CHIPS}`;
      more.title = items.slice(VISIBLE_CHIPS).join(', ');
      more.addEventListener('click', () => {
        more.remove();
        for (const item of items.slice(VISIBLE_CHIPS)) add(item);
      });
      row.append(more);
    }

    group.append(h, row);
    card.append(group);
  };

  chips(match.matched, 'has', 'You have');
  chips(match.missing, 'gap', 'Not in your profile');
  /*
   * Below the two that count, and labelled so it cannot be read as a gap.
   * These are the posting's own "nice to have" list: absent from the score in
   * either direction, because a thing the employer said was not needed should
   * neither reward nor penalise. They used to sit in "Not in your profile",
   * which is how a candidate holding every requirement saw four red chips.
   */
  chips(match.bonus, 'has', 'Nice-to-haves you have');
  chips(match.preferred, 'extra', 'Nice to have — not required');

  return card;
}

function analyzingMatchCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card match match-analyzing';
  card.style.cssText = 'padding: 14px; position: relative; overflow: hidden;';

  const top = document.createElement('div');
  top.className = 'match-top';

  const spinner = document.createElement('div');
  spinner.className = 'match-spinner';

  const verdict = document.createElement('div');
  verdict.className = 'match-verdict';

  const head = document.createElement('div');
  head.className = 'match-analyzing-head';
  head.textContent = '✨ ANALYZING SKILLS...';

  const sub = document.createElement('div');
  sub.className = 'match-line';
  sub.style.cssText = 'color: var(--dim); font-size: 11.5px;';
  sub.textContent = 'Calculating shortlist match & keyword breakdown...';

  verdict.append(head, sub);
  top.append(spinner, verdict);
  card.append(top);

  const skeletonRow = document.createElement('div');
  skeletonRow.className = 'chips-skeleton';
  for (let i = 0; i < 3; i++) {
    const chip = document.createElement('span');
    chip.className = 'chip-skeleton';
    skeletonRow.append(chip);
  }
  card.append(skeletonRow);

  return card;
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
  /**
   * Every control on the step, when the run stalled without being able to name
   * a cause. Shown so a screenshot of the panel is a complete bug report.
   */
  diagnostic?: string[];
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
  // The run opens the host page's modal partway through, which lands above the
  // panel in the top layer. This is the only paint that happens while that is
  // going on, so it is the only place that can put the panel back on top.
  if (hostEl) raiseAboveModal(hostEl);

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

  /* The questions the user has to answer are shown in the top notification popup banner. */
  if (session.state === 'needs-input') {
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent =
      'Answer the required questions in the application form and BanApply carries on by itself.';
    root.append(hint);
  }

  if (session.state !== 'idle' && session.state !== 'needs-input' && session.message) {
    const line = document.createElement('div');
    line.className = 'sess-msg';
    line.dataset.tone = session.state;
    line.textContent = session.message;
    root.append(line);
  }

  /*
   * The step, verbatim, when the run could not explain itself.
   *
   * Ugly on purpose and only ever on screen when something has already gone
   * wrong. It exists because every stall this session was diagnosed from a
   * photograph of this panel, and asking someone mid-application to open
   * devtools and copy three console tables is not a diagnosis you get back.
   */
  if (session.diagnostic?.length) {
    const dump = document.createElement('ul');
    dump.className = 'dump';
    for (const line of session.diagnostic) {
      const item = document.createElement('li');
      item.textContent = line;
      dump.append(item);
    }
    root.append(dump);

    /*
     * Copy, because a photograph of this is not a bug report.
     *
     * Every diagnosis this session came from a screenshot, which meant reading
     * truncated labels off an image and guessing at the rest. Text can be
     * pasted whole. Safe to click here in a way the run's own buttons are not:
     * this only appears once the run has already failed, so if the click
     * reaches the host page's modal, there is no application left to lose.
     */
    const copy = document.createElement('button');
    copy.className = 'ghost';
    copy.textContent = 'Copy report';
    copy.addEventListener('click', () => {
      const text = [`BanApply ${session.message}`, ...(session.diagnostic ?? [])].join('\n');
      void navigator.clipboard.writeText(text).then(
        () => {
          copy.textContent = 'Copied';
        },
        () => {
          // Clipboard refused — usually focus. Select it instead so Ctrl+C
          // still works rather than leaving a button that does nothing.
          copy.textContent = 'Select the text above and copy';
          const range = document.createRange();
          range.selectNodeContents(dump);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      );
    });
    root.append(copy);
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

  /*
   * While a run is live the panel stops accepting clicks. All of it, except
   * Stop.
   *
   * A click anywhere outside the host page's modal dismisses it, and the panel
   * is outside it. LinkedIn registers that in the capture phase on `document`,
   * which fires before the event reaches our element — so it cannot be stopped
   * from here, and every attempt to has failed. The observed cost is not
   * theoretical: clicking the panel mid-application raised "Save this
   * application? Discard / Save" over a form the user had spent minutes
   * filling in.
   *
   * There is nothing here worth that risk during a run. Continuing no longer
   * needs a press — the run resumes itself once the questions are answered —
   * so the buttons this disables are ones the user has no reason to reach for.
   *
   * Stop stays live, because stop must stop. If pressing it does dismiss the
   * dialog, that is the outcome it was asked for.
   */
  const live = session.state === 'running' || session.state === 'needs-input';
  root.style.pointerEvents = live ? 'none' : '';

  /* The one button, whose label is the state. */
  const action = document.createElement('button');
  action.className = 'fill';

  if (session.state === 'running') {
    action.textContent = 'Stop';
    action.style.pointerEvents = 'auto';
    action.addEventListener('click', () => acts.onCancelSession());
  } else if (session.state === 'needs-input') {
    /*
     * A fallback, and on LinkedIn a harmful one — pressing it is what raises
     * the discard prompt. Kept enabled on platforms without that behaviour by
     * the `pointer-events` rule above, which the run's own resume does not
     * need: answering the questions is the signal.
     */
    action.textContent = 'Waiting for your answers…';
    action.disabled = true;
  } else {
    action.textContent = session.state === 'done' ? 'Apply to another' : 'Apply with BanApply';
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

/**
 * Point the panel at a different posting, synchronously, before anything is
 * known about it.
 *
 * The tracker already did this by calling `maybeShowPanel(job, dup, true)` and
 * not awaiting it — but that path is not synchronous and never was. It sends
 * `GET_SESSION` to the service worker and awaits `loadProfile()` before it
 * paints anything, and a sleeping service worker makes the first of those cost
 * hundreds of milliseconds. For that whole window the panel is still showing
 * the *previous* posting fully painted: its title, its duplicate warning, and
 * its match score. That is the "old score, then it analyses again, then the
 * real score" everyone sees on a LinkedIn job switch — the reset was queued
 * behind a network round-trip rather than run before it.
 *
 * So it happens here instead, off the state already on screen: swap the
 * identity-bound fields, keep the page-bound ones, repaint. No awaits, no
 * messages, nothing that can be scheduled late.
 *
 * `duplicate` is cleared for the same reason as the score, and more urgently —
 * "you already applied to this role" pinned under a job you have never seen is
 * worse than a stale number.
 */
export function showJobAnalyzing(job?: CapturedJob | null): void {
  if (!mounted || !lastState || !lastHandlers) return;

  lastState = {
    ...lastState,
    /*
     * No job means the URL moved and nothing has been read off the new pane
     * yet — which is the moment this matters most, and the only moment early
     * enough to beat the old score off the screen. The identity is blanked
     * rather than kept: the card falls back to "This posting", which reads as
     * loading, where the previous posting's title reads as an answer.
     */
    job: job ?? { ...lastState.job, title: null, company: null, location: null },
    match: null,
    matchDiagnostic: undefined,
    isAnalyzingMatch: true,
    duplicate: null,
    /*
     * Both go with the identity. A coverage count belongs to a form on the
     * posting being left behind, and leaving `hasForm` set while zeroing the
     * count lands on "Nothing here matches your profile (0 fields)" — a verdict,
     * during a transition, about a form that is not there.
     */
    coverage: job ? lastState.coverage : { fillable: 0, total: 0 },
    hasForm: job ? lastState.hasForm : false,
  };
  mounted.repaint(lastState, lastHandlers);
}

export function removePanel(): void {
  mounted?.destroy();
  mounted = null;
  statusEl = null;
  applyEl = null;
  sessionRoot = null;
  hostEl = null;
  raisedOver = undefined;
  document.getElementById(HOST_ID)?.remove();
}

/**
 * The panel host, kept so anything painting outside `renderPanel` can still
 * reach it — `paintSession` in particular, which runs throughout a run while
 * the tracking loop is deliberately standing back and not repainting.
 */
let hostEl: HTMLElement | null = null;

/** The open dialog the panel was last promoted above. */
let raisedOver: Element | null | undefined;

/**
 * Keep the panel above the host page's modal, as that modal comes and goes.
 *
 * The mechanics live in `topLayer.ts`; what belongs here is *when*. The panel
 * outlives any number of dialogs, and during an apply run jobpilot opens one
 * itself — so a single promotion at mount puts it straight back underneath.
 * The `<dialog>` migration behind all this is also why `flows.ts` had to learn
 * `dialog[open]`.
 */
function raiseAboveModal(host: HTMLElement): void {
  const modal = document.querySelector('dialog[open]');
  if (modal === raisedOver) return;
  raisedOver = modal;

  if (modal) reraise(host);
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
    --ink: #070b13;
    --panel: #0d1424;
    --raised: #141e33;
    --line: #202d48;
    --text: #edf2fb;
    --dim: #94a5c4;
    --signal: #ffb020;
    --on-signal: #120c02;
    --live: #10b981;
    --warn: #ffb020;

    --glass: #0d1424;
    --glass-raised: #141e33;
    --glass-hover: #1b2946;
    --glass-line: #202d48;
    --glass-edge: #2c3c5d;

    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    background: var(--glass);
    border-left: 1px solid var(--glass-edge);
    box-shadow: -20px 0 50px rgba(0, 0, 0, 0.55);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--glass-line);
    background: linear-gradient(180deg, #090d18 0%, #070a12 100%);
    flex-shrink: 0;
  }

  .mark {
    width: 24px; height: 24px; border-radius: 7px;
    background: linear-gradient(135deg, rgba(255,176,32,0.28), rgba(11,18,32,0.95));
    border: 1px solid rgba(255,176,32,0.4);
    box-shadow: 0 0 10px rgba(255,176,32,0.2);
    display: grid; place-items: center;
    flex-shrink: 0;
  }
  .mark svg { width: 14px; height: 14px; }

  .wordmark {
    font-weight: 800;
    letter-spacing: -0.025em;
    font-size: 14.5px;
    background: linear-gradient(180deg, #ffffff 0%, #d8e2f3 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .who {
    margin-left: auto;
    font-size: 11px;
    color: #93a6c8;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 3px 9px;
    border-radius: 999px;
    max-width: 160px;
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
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  /*
   * A thin, dark scrollbar for the times it is genuinely needed.
   *
   * The chip lists have no fixed height, so no amount of tightening guarantees
   * a fit at every window size — the goal is that scrolling is rare and, when
   * it happens, does not look like the panel broke. The default is a pale
   * chunky bar that reads as the host page's chrome bleeding through.
   */
  .body::-webkit-scrollbar { width: 8px; }
  .body::-webkit-scrollbar-track { background: transparent; }
  .body::-webkit-scrollbar-thumb {
    background: var(--glass-edge);
    border-radius: 999px;
    border: 2px solid var(--glass);
  }
  .body::-webkit-scrollbar-thumb:hover { background: var(--dim); }
  .body { scrollbar-width: thin; scrollbar-color: var(--glass-edge) transparent; }

  .card {
    background: var(--glass-raised);
    border: 1px solid var(--glass-line);
    border-radius: 12px;
    padding: 12px 13px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transition: border-color 160ms ease, background-color 160ms ease;
  }

  .role { font-size: 14.5px; font-weight: 700; letter-spacing: -0.015em; color: #f3f7fc; line-height: 1.35; }
  .meta { color: var(--dim); font-size: 12px; margin-top: 4px; }

  .lamp-row {
    display: flex; align-items: center; gap: 8px;
    margin-top: 9px; padding-top: 9px;
    border-top: 1px solid var(--glass-line);
    font-size: 11.5px; color: var(--dim);
  }
  .lamp {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--live); flex-shrink: 0;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
  }

  /* Duplicate warning. Amber not red: applying twice is worth knowing about,
     not an error, and red here would read as "something broke". */
  .warn {
    border-color: rgba(255, 176, 32, 0.4);
    background: rgba(255, 176, 32, 0.09);
  }
  .warn .role { color: var(--signal); font-size: 13px; }

  .action {
    padding: 13px 16px;
    border-top: 1px solid var(--glass-line);
    background: var(--ink);
    flex-shrink: 0;
  }

  .fill {
    width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    background: linear-gradient(135deg, #ffc857 0%, #ffb020 100%);
    color: var(--on-signal);
    border: none; border-radius: 11px;
    padding: 13.5px 18px;
    font: inherit; font-size: 14px; font-weight: 750;
    cursor: pointer;
    box-shadow:
      0 6px 20px rgba(255, 176, 32, 0.32),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease;
  }
  .fill:hover:not(:disabled) {
    filter: brightness(1.08);
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(255, 176, 32, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  .fill:active:not(:disabled) { transform: translateY(0); }
  .fill:disabled { opacity: 0.55; cursor: default; }
  .fill svg { width: 15px; height: 15px; }

  .ghost {
    width: 100%;
    background: var(--glass-raised);
    color: var(--text);
    border: 1px solid var(--glass-line);
    border-radius: 11px;
    padding: 11px 15px;
    font: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    transition: background 140ms ease, border-color 140ms ease, transform 140ms ease;
  }
  .ghost:hover:not(:disabled) {
    background: var(--glass-hover);
    border-color: var(--glass-edge);
    transform: translateY(-1px);
  }
  .ghost:disabled { opacity: 0.5; cursor: default; }

  .toggle {
    display: flex; align-items: center; gap: 8px;
    margin-top: 10px;
    font-size: 12px; color: var(--dim);
    cursor: pointer;
  }
  .toggle input { accent-color: var(--signal); width: 14px; height: 14px; cursor: pointer; }

  .note { font-size: 11.5px; color: var(--dim); }

  /* Match ---------------------------------------------------------------- */

  .match-head { font-size: 12.5px; font-weight: 650; margin-bottom: 9px; }
  .match-err { margin-top: 8px; font-size: 11.5px; color: #ff9b9b; line-height: 1.4; }

  .match-top { display: flex; align-items: center; gap: 12px; }

  /*
   * A ring rather than a bar: a bar reads as progress toward something, and
   * there is nothing here to complete. conic-gradient needs no SVG and no
   * animation frame.
   */
  .dial {
    --pct: 0;
    width: 44px; height: 44px; border-radius: 50%;
    flex-shrink: 0;
    display: grid; place-items: center;
    background: conic-gradient(var(--band) calc(var(--pct) * 1%), rgba(255,255,255,0.07) 0);
    position: relative;
  }
  .dial::after {
    content: ''; position: absolute; inset: 4px;
    border-radius: 50%; background: var(--glass-raised);
  }
  .dial-n { position: relative; z-index: 1; font-size: 13.5px; font-weight: 700; }
  .dial[data-band='high'] { --band: var(--live); }
  .dial[data-band='mid']  { --band: var(--signal); }
  .dial[data-band='low']  { --band: #ff8f8f; }
  .dial[data-band='high'] .dial-n { color: var(--live); }
  .dial[data-band='mid'] .dial-n  { color: var(--signal); }
  .dial[data-band='low'] .dial-n  { color: #ff8f8f; }

  .match-verdict { min-width: 0; }
  .match-label {
    font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--dim); font-weight: 700;
  }
  .match-line { font-size: 12px; line-height: 1.4; margin-top: 3px; }

  .chips-group { margin-top: 9px; }
  .chips-h { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .chip {
    font-size: 10.5px; line-height: 1.25;
    padding: 3px 7px; border-radius: 999px;
    border: 1px solid var(--glass-line);
  }
  /* The overflow control. A button, so it is reachable by keyboard. */
  .chip.more {
    background: transparent; color: var(--dim);
    font: inherit; font-size: 10.5px; cursor: pointer;
  }
  .chip.more:hover { color: var(--text); border-color: var(--glass-edge); }
  .chip[data-kind='has'] { background: rgba(63,207,142,0.12); border-color: rgba(63,207,142,0.32); color: #9fe6c4; }
  .chip[data-kind='gap'] { background: rgba(255,176,32,0.10); border-color: rgba(255,176,32,0.30); color: #ffd08a; }
  /* Neutral on purpose: an unmet nice-to-have is not a gap, and colouring it
     like one is what made a full-marks profile look half-qualified. */
  .chip[data-kind='extra'] { background: rgba(124,141,166,0.10); border-color: rgba(124,141,166,0.28); color: #b3c0d4; }

  .match .note { margin-top: 10px; }

  /* Bulk run -------------------------------------------------------------- */

  /* Not a card: it is the action bar's own content, not something inside it. */
  .run { display: flex; flex-direction: column; gap: 8px; }
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

  /* Diagnostic dump: only rendered when a run stalled without a cause. */
  .dump {
    list-style: none; margin-top: 8px;
    max-height: 260px; overflow-y: auto;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
    padding: 6px 8px;
  }
  .dump li {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 10.5px; line-height: 1.45;
    word-break: break-word; opacity: 0.85;
  }

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

  /* Match ---------------------------------------------------------------- */

  .match-head { font-size: 12.5px; font-weight: 650; margin-bottom: 9px; }
  .match-err { margin-top: 8px; font-size: 11.5px; color: #ff9b9b; line-height: 1.4; }

  .match-top { display: flex; align-items: center; gap: 12px; }

  /*
   * A ring rather than a bar: a bar reads as progress toward something, and
   * there is nothing here to complete. conic-gradient needs no SVG and no
   * animation frame.
   */
  .dial {
    --pct: 0;
    width: 54px; height: 54px; border-radius: 50%;
    flex-shrink: 0;
    display: grid; place-items: center;
    background: conic-gradient(var(--band) calc(var(--pct) * 1%), rgba(255,255,255,0.07) 0);
    position: relative;
  }
  .dial::after {
    content: ''; position: absolute; inset: 5px;
    border-radius: 50%; background: var(--glass-raised);
  }
  .dial-n { position: relative; z-index: 1; font-size: 15px; font-weight: 700; }
  .dial[data-band='high'] { --band: var(--live); }
  .dial[data-band='mid']  { --band: var(--signal); }
  .dial[data-band='low']  { --band: #ff8f8f; }
  .dial[data-band='high'] .dial-n { color: var(--live); }
  .dial[data-band='mid'] .dial-n  { color: var(--signal); }
  .dial[data-band='low'] .dial-n  { color: #ff8f8f; }

  .match-verdict { min-width: 0; }
  .match-label {
    font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--dim); font-weight: 700;
  }
  .match-line { font-size: 12px; line-height: 1.4; margin-top: 3px; }

  .chips-group { margin-top: 11px; }
  .chips-h { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); font-weight: 700; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .chip {
    font-size: 11px; line-height: 1.3;
    padding: 4px 8px; border-radius: 999px;
    border: 1px solid var(--glass-line);
  }
  .chip[data-kind='has'] { background: rgba(63,207,142,0.12); border-color: rgba(63,207,142,0.32); color: #9fe6c4; }
  .chip[data-kind='gap'] { background: rgba(255,176,32,0.10); border-color: rgba(255,176,32,0.30); color: #ffd08a; }
  /* Neutral on purpose: an unmet nice-to-have is not a gap, and colouring it
     like one is what made a full-marks profile look half-qualified. */
  .chip[data-kind='extra'] { background: rgba(124,141,166,0.10); border-color: rgba(124,141,166,0.28); color: #b3c0d4; }

  @keyframes jpSpin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes jpPulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }
  @keyframes jpShimmer {
    0% { background-position: -150px 0; }
    100% { background-position: 150px 0; }
  }

  .match-spinner {
    width: 44px; height: 44px; border-radius: 50%;
    flex-shrink: 0;
    border: 3px solid rgba(255, 176, 32, 0.15);
    border-top-color: #ffb020;
    border-right-color: #10b981;
    animation: jpSpin 0.9s linear infinite;
  }

  .match-analyzing-head {
    font-size: 11px; font-weight: 800;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: #ffb020;
    animation: jpPulse 1.4s ease-in-out infinite;
  }

  .chips-skeleton {
    display: flex; gap: 6px; margin-top: 10px;
  }

  .chip-skeleton {
    height: 20px; width: 60px; border-radius: 999px;
    background: linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.05) 100%);
    background-size: 300px 100%;
    animation: jpShimmer 1.4s infinite;
  }
  .chip-skeleton:nth-child(2) { width: 80px; }
  .chip-skeleton:nth-child(3) { width: 55px; }

  .match .note { margin-top: 10px; }

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

  /* Diagnostic dump: only rendered when a run stalled without a cause. */
  .dump {
    list-style: none; margin-top: 8px;
    max-height: 260px; overflow-y: auto;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
    padding: 6px 8px;
  }
  .dump li {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 10.5px; line-height: 1.45;
    word-break: break-word; opacity: 0.85;
  }

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

  .auth-card { display: flex; flex-direction: column; gap: 11px; margin-top: 4px; padding: 14px 15px; }
  .auth-head { font-size: 14px; font-weight: 750; color: #ffffff; letter-spacing: -0.01em; }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 11.5px; color: var(--dim); font-weight: 600; }
  .field input {
    background: var(--ink);
    border: 1px solid var(--glass-line);
    border-radius: 9px;
    padding: 11px 13px;
    color: var(--text);
    font: inherit; font-size: 13px;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }
  .field input:focus-visible {
    outline: 2px solid var(--signal);
    outline-offset: 1px;
    border-color: transparent;
    box-shadow: 0 0 10px rgba(255,176,32,0.25);
  }
  .field input::placeholder { color: #617392; }

  .err {
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.38);
    color: #fca5a5;
    border-radius: 9px;
    padding: 10px 12px;
    font-size: 12px;
    line-height: 1.4;
  }

  .switch {
    background: none; border: none; padding: 0;
    color: var(--signal); font: inherit; font-size: 12.5px; font-weight: 600;
    cursor: pointer; text-decoration: underline; text-underline-offset: 2px; align-self: flex-start;
  }

  .foot {
    display: flex; gap: 10px; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-top: 1px solid var(--glass-line);
    background: var(--ink);
    flex-shrink: 0;
  }
  .link {
    background: none; border: none; padding: 0;
    color: var(--dim); font: inherit; font-size: 11.5px; font-weight: 500;
    cursor: pointer; text-decoration: underline; text-underline-offset: 2px;
  }
  .link:hover { color: var(--text); }

  /*
   * The resting state: a launcher docked flush to the right edge.
   * Premium dark glow styling matching jobpilot website palette (#0d1424 / #ffb020).
   */
  .handle {
    position: absolute;
    top: 35%; right: 0;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px 10px 14px;
    background: linear-gradient(135deg, #0d1424 0%, #141e33 100%);
    color: #ffffff;
    border: 1px solid rgba(255, 176, 32, 0.45);
    border-right: none;
    border-top-left-radius: 999px;
    border-bottom-left-radius: 999px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 750;
    letter-spacing: -0.01em;
    box-shadow: 0 4px 20px rgba(255, 176, 32, 0.4), -4px 0 15px rgba(0, 0, 0, 0.5);
    transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms ease, filter 160ms ease;
  }
  .handle:hover {
    transform: translateY(-50%) translateX(-2px);
    box-shadow: 0 6px 25px rgba(255, 176, 32, 0.6), -6px 0 20px rgba(0, 0, 0, 0.6);
    filter: brightness(1.1);
  }
  .handle:active { transform: translateY(-50%) translateX(0); }
  .handle svg {
    width: 17px; height: 17px;
    flex-shrink: 0;
    color: #ffb020;
    filter: drop-shadow(0 0 6px rgba(255, 176, 32, 0.8));
  }

  /* Count of fillable fields — highlighted badge. */
  .handle .count {
    background: rgba(255, 176, 32, 0.2);
    border: 1px solid rgba(255, 176, 32, 0.4);
    color: #ffb020;
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  /* One slow sweep so it registers as new without becoming a blinking
     ornament on every page. */
  @media (prefers-reduced-motion: no-preference) {
    [data-first] .handle { animation: pop 260ms cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes pop {
      from { opacity: 0; transform: translateY(-50%) translateX(20px); }
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
  _handlers: PanelHandlers,
  onCollapse: () => void
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'BanApply');

  const header = document.createElement('header');
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.innerHTML = MARK;
  const word = document.createElement('span');
  word.className = 'wordmark';
  word.textContent = 'BanApply';
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = 'Sign in';
  const collapse = document.createElement('button');
  collapse.className = 'icon-btn';
  collapse.setAttribute('aria-label', 'Collapse');
  collapse.innerHTML = CHEV;
  collapse.addEventListener('click', onCollapse);
  header.append(mark, word, who, collapse);

  const body = document.createElement('div');
  body.className = 'body';

  /* Job Posting Summary Card */
  const job = document.createElement('div');
  job.className = 'card';
  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = state.job.title ?? 'This posting';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [state.job.company, state.job.location].filter(Boolean).join(' · ');
  job.append(role, meta);

  const lampRow = document.createElement('div');
  lampRow.className = 'lamp-row';
  lampRow.dataset.state = 'ready';
  lampRow.innerHTML = '<span class="lamp"></span>';
  lampRow.append(document.createTextNode('Sign in on BanApply website to auto-apply'));
  job.append(lampRow);
  body.append(job);

  /* Match card preview for 1st-time users if available */
  if (state.match) {
    body.append(matchCard(state.match));
  }

  /* Auth Card */
  const authCard = document.createElement('div');
  authCard.className = 'card auth-card';

  const authHead = document.createElement('div');
  authHead.className = 'auth-head';
  authHead.textContent = 'Sign in to Auto Apply';

  const intro = document.createElement('p');
  intro.className = 'note';
  intro.textContent =
    'Sign in or create your BanApply account on our web app to autofill applications with one click and track every role in your dashboard.';

  authCard.append(authHead, intro);
  body.append(authCard);

  const action = document.createElement('div');
  action.className = 'action';
  const submit = document.createElement('button');
  submit.className = 'fill';
  submit.innerHTML = BOLT;
  const submitText = document.createElement('span');
  submitText.textContent = 'Sign in to Auto Apply';
  submit.append(submitText);

  submit.addEventListener('click', () => {
    window.open(`${DEFAULT_WEB_BASE_URL}/login`, '_blank');
  });

  action.append(submit);

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
    // Kept as the fallback for anywhere the top layer is unavailable.
    'z-index: 2147483647',
    // The host must not eat clicks on the page around the collapsed handle.
    'pointer-events: none',
    ...POPOVER_RESET,
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
        ? `Autofill ${current.coverage.fillable} fields with BanApply`
        : 'Open BanApply — save this job or check for duplicates';

      handle.setAttribute('aria-label', label);
      handle.title = label;
      handle.innerHTML = BOLT;
      handle.append(document.createTextNode(hasFields ? 'Autofill' : 'BanApply'));

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

      // The root covers 100% of the host height. When collapsed the host is a
      // 200px-wide strip that would otherwise eat every click in that column.
      // Pass events through the invisible area; only the handle itself needs
      // to be interactive, so give it pointer-events back explicitly.
      root.style.pointerEvents = 'none';
      handle.style.pointerEvents = 'auto';

      root.append(handle);
      // Narrow host while closed, so the page stays clickable everywhere the
      // button is not.
      host.style.width = '200px';
      return;
    }

    // Restore pointer-events when the full panel is open.
    root.style.pointerEvents = 'auto';
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
    panel.setAttribute('aria-label', 'BanApply');

    /* Header */
    const header = document.createElement('header');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.innerHTML = MARK;
    const word = document.createElement('span');
    word.className = 'wordmark';
    word.textContent = 'BanApply';
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
    const status = current.isExternalJob
      ? {
          state: 'no-form',
          text: 'Apply on company website — auto-apply is available for Naukri Easy Apply jobs',
        }
      : !current.hasForm
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
      /*
       * From the timestamp, not from `daysAgo`. That field floors to whole
       * days, so an application submitted a minute ago came back as 0 and the
       * banner read "0 days ago" — which looks like the tracker lost the date
       * rather than like "just now". `daysAgo` stays as the fallback for rows
       * that predate `appliedAt` being sent.
       */
      const when =
        relativeTime(current.duplicate.appliedAt) ||
        (current.duplicate.daysAgo !== null ? `${current.duplicate.daysAgo} days ago` : 'earlier');

      m.textContent = `${current.duplicate.title} at ${current.duplicate.companyName} · ${when} · ${current.duplicate.status.toLowerCase()}`;
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
     * The match card is for deciding whether to apply, so it goes away once
     * that decision is made. It is by some distance the tallest thing in the
     * panel — a dial, two headings and up to twelve chips — and leaving it up
     * during a run squeezed everything that matters into a clipped strip: the
     * chip list cut off mid-heading and the run's own status was pushed to the
     * bottom edge. Nothing is lost by hiding it; it is unchanged when the run
     * ends, and the posting is the same posting.
     */
    if (current.match && session.state === 'idle') {
      body.append(matchCard(current.match));
    } else if (current.isAnalyzingMatch && session.state === 'idle') {
      body.append(analyzingMatchCard());
    } else if (!current.match && session.state === 'idle') {
      const fallbackCard = document.createElement('div');
      fallbackCard.className = 'card match';
      fallbackCard.style.cssText = 'padding: 12px 14px;';

      const head = document.createElement('div');
      head.style.cssText =
        'font-size: 11px; font-weight: 800; color: var(--dim); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px;';
      head.textContent = '🎯 SKILLS MATCHING';

      const msg = document.createElement('p');
      msg.style.cssText = 'font-size: 11.5px; color: var(--dim); line-height: 1.4;';
      /*
       * This branch is "the posting could not be read", not "the posting named
       * nothing". It said the latter, which sent a real investigation at the
       * skills dictionary while the actual fault was a description scrape that
       * ran before the pane rendered and cached its own failure.
       *
       * The genuinely-nothing-recognised case has its own message inside
       * `matchCard`, where a description *was* read. Two different facts, and
       * only one of them was ever true here.
       */
      msg.textContent = current.authenticated
        ? 'Could not read this posting’s description, so there is nothing to compare yet.'
        : 'Add your skills in your BanApply web profile to see how this posting compares.';

      fallbackCard.append(head, msg);

      /*
       * The containers that were looked for and what was in them. Small and
       * monospaced because it is diagnostic rather than content — but on the
       * card rather than in the console, because the console is the thing
       * nobody has open when this happens.
       */
      if (current.matchDiagnostic?.length) {
        const diag = document.createElement('pre');
        diag.style.cssText =
          'margin-top: 8px; font-size: 10px; line-height: 1.45; color: var(--dim); ' +
          'white-space: pre-wrap; word-break: break-all; opacity: 0.75; max-height: 88px; overflow: auto;';
        diag.textContent = current.matchDiagnostic.join('\n');
        fallbackCard.append(diag);
      }

      body.append(fallbackCard);
    }

    /* Primary action */
    const action = document.createElement('div');
    action.className = 'action';

    if (current.isExternalJob) {
      const disabledBtn = document.createElement('button');
      disabledBtn.className = 'fill';
      disabledBtn.disabled = true;
      disabledBtn.textContent = 'Apply on Company Site (Unsupported)';

      const note = document.createElement('p');
      note.className = 'note';
      note.style.marginTop = '8px';
      note.textContent =
        'Auto-apply is available for Naukri Easy Apply jobs. Save this job to track your application.';

      action.append(disabledBtn, note);
    } else if (current.canApply) {
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

    if (current.canAutoApply && !current.canApply) {
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

    panel.append(header, body, action);
    root.append(panel);
  };

  paint();
  shadow.append(style, root);
  // Next frame: the entrance has started, and every later paint is an update.
  requestAnimationFrame(() => root.removeAttribute('data-first'));
  document.documentElement.append(host);

  hostEl = host;
  promoteToTopLayer(host);
  sealEvents(host);
  raisedOver = document.querySelector('dialog[open]');

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
      // Covers the modal being opened by hand rather than by a run.
      raiseAboveModal(host);
    },
  };
}
