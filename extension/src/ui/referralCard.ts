import {
  REFERRAL_ACTION_LABEL,
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABELS,
  draftFor,
  referralDue,
  relativeTime,
  type ReferralAsk,
  type ReferralStatus,
} from '@jobpilot/shared';
import { POPOVER_RESET, promoteToTopLayer, sealEvents } from './topLayer.js';

/**
 * "You asked this person about React JS Developer at Tata Consultancy."
 *
 * The payoff for everything phase 1 stored. LinkedIn tells the user someone
 * accepted; this is what makes that useful, by being right there when they
 * open the profile to act on it.
 *
 * WHY THE ROLE IS THE HEADLINE AND NOT THE NAME
 *
 * The name is already on the page in 32px — repeating it is the one piece of
 * information the user certainly has. What they do not have, and what sent
 * them to another tab, is *which job they asked about*. So the role leads and
 * the person's name appears underneath as confirmation the match is right.
 *
 * WHY THIS IS NOT THE MAIN PANEL
 *
 * That panel is a full-height sidebar built around a job posting — it wants a
 * `PanelJob`, a coverage count and an apply session, none of which exist on a
 * profile page. A small card is the honest shape for one fact and one action.
 * It borrows `topLayer.ts` so the isolation guarantees are the same ones.
 */

const HOST_ID = 'banapply-referral-host';

const CSS = `
:host, * { box-sizing: border-box; }

.card {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 320px;
  max-width: calc(100vw - 36px);
  /* Opaque. Glass was tried on the main panel and removed: backdrop-filter
     pulls the host page's brightness through the tint, and over LinkedIn's
     white profile page this would read as washed-out grey. */
  background: #0f1726;
  color: #e8edf7;
  border: 1px solid #2b3c59;
  border-radius: 12px;
  box-shadow: 0 24px 60px -24px rgba(0,0,0,0.75);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  padding: 14px 16px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: auto;
}

.head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }

.brand {
  font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ffb020;
}

.close {
  background: none; border: none; cursor: pointer;
  color: #7e91b0; font-size: 15px; line-height: 1; padding: 2px 4px;
  border-radius: 4px;
}
.close:hover { color: #e8edf7; }
.close:focus-visible { outline: 2px solid #ffb020; outline-offset: 1px; }

.ask { display: flex; flex-direction: column; gap: 8px; }
.ask + .ask { border-top: 1px solid #1e2b42; padding-top: 10px; }

.eyebrow { font-size: 11px; color: #7e91b0; }
.role { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: #ffb020; }
.company { font-size: 12.5px; color: #a8b8d0; }

.tele {
  font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
  font-size: 11px;
  color: #a8b8d0;
  line-height: 1.75;
  border-top: 1px solid #1e2b42;
  border-bottom: 1px solid #1e2b42;
  padding: 7px 0;
  display: flex;
  flex-direction: column;
}
.tele span { display: flex; justify-content: space-between; gap: 12px; }
.tele b { font-weight: 400; color: #7e91b0; }

.row { display: flex; align-items: center; gap: 8px; }
.row label { font-size: 11px; color: #7e91b0; flex: 0 0 auto; }

select {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 12.5px;
  background: #162134;
  color: #e8edf7;
  border: 1px solid #2b3c59;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
}
select:focus-visible { outline: 2px solid #ffb020; outline-offset: 1px; }
select:disabled { opacity: 0.6; cursor: progress; }

.err { font-size: 11.5px; color: #ff8f8f; }

.due {
  font-size: 12px;
  font-weight: 700;
  color: #ffb020;
}
.quiet { font-size: 11.5px; color: #7e91b0; }

.draft {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid #1e2b42;
  border-radius: 8px;
  background: #0b1220;
}
.draft-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #7e91b0;
  font-family: ui-monospace, "Cascadia Mono", Menlo, monospace;
}
.count { font-variant-numeric: tabular-nums; }
.count[data-over="true"] { color: #ff8f8f; font-weight: 700; }
.draft-body { resize: vertical; line-height: 1.5; min-height: 60px; }

.field {
  font: inherit;
  font-size: 12.5px;
  background: #162134;
  color: #e8edf7;
  border: 1px solid #2b3c59;
  border-radius: 6px;
  padding: 7px 9px;
  width: 100%;
}
.field::placeholder { color: #7e91b0; }
.field:focus-visible { outline: 2px solid #ffb020; outline-offset: 1px; }

.btns { display: flex; gap: 8px; }
.b {
  font: inherit;
  font-size: 12.5px;
  font-weight: 640;
  padding: 7px 12px;
  border-radius: 6px;
  border: 1px solid #2b3c59;
  background: transparent;
  color: #e8edf7;
  cursor: pointer;
  flex: 1 1 auto;
}
.b:hover:not(:disabled) { border-color: #ffb020; }
.b:focus-visible { outline: 2px solid #ffb020; outline-offset: 1px; }
.b:disabled { opacity: 0.6; cursor: progress; }
.b.primary { background: #ffb020; color: #1a1204; border-color: #ffb020; }

@media (prefers-reduced-motion: no-preference) {
  .card { animation: rise 180ms ease-out; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: none; }
  }
}
`;

export interface ReferralCardHandlers {
  /** Persist a status change. Resolves false when the write failed. */
  onStatus(ask: ReferralAsk, next: ReferralStatus): Promise<boolean>;
  /**
   * Log a new ask against the posting the intent came from. Resolves false on
   * failure; the form stays open with what the user typed still in it.
   */
  onLog(input: {
    name: string;
    role: string | null;
    status: 'INVITED' | 'ASKED';
  }): Promise<boolean>;
  /** The user is not going to log this one. Drops the intent. */
  onDismissIntent(): void;
}

/** What the user was looking for when they left the posting. */
export interface CardIntent {
  title: string;
  company: string;
  /** Read off this profile page, and editable. Either may be null. */
  prefill: { name: string | null; headline: string | null };
}

/**
 * Dismissed for this page view only.
 *
 * Module-level rather than per-render, for the same reason `collapsed` is in
 * the main panel: anything the render creates dies on the next one, and a
 * dismissal that un-dismisses itself a second later is worse than no dismiss
 * button. Cleared by `resetReferralCard` on navigation, because the next
 * profile is a different person and a different question.
 */
let dismissed = false;

export function resetReferralCard(): void {
  dismissed = false;
}

export function removeReferralCard(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function renderReferralCard(
  asks: ReferralAsk[],
  intent: CardIntent | null,
  handlers: ReferralCardHandlers,
  /** Signs off the drafts. Omitted rather than guessed when it is unknown. */
  userName: string | null = null
): void {
  removeReferralCard();
  /*
   * Nothing to say, so nothing is drawn. Most profiles a person opens have no
   * ask against them and were not reached from a referral search, and a card
   * on every profile on LinkedIn is what makes an extension feel like spyware.
   */
  if (dismissed || (asks.length === 0 && !intent)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 2147483647',
    // Must not eat clicks on the profile behind it.
    'pointer-events: none',
    ...POPOVER_RESET,
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const card = document.createElement('div');
  card.className = 'card';
  card.setAttribute('role', 'complementary');
  card.setAttribute('aria-label', 'Your referral asks for this person');

  const head = document.createElement('div');
  head.className = 'head';

  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent =
    asks.length > 1 ? `BanApply · ${asks.length} asks` : 'BanApply · referral';

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => {
    dismissed = true;
    // Dismissing the form is a decision about the intent, not just this paint.
    // Left alone it would reappear on the next profile, having already been
    // turned down once.
    if (intent) handlers.onDismissIntent();
    removeReferralCard();
  });

  head.append(brand, close);
  card.append(head);

  const error = document.createElement('div');
  error.className = 'err';
  error.hidden = true;

  for (const ask of asks) {
    card.append(askBlock(ask, handlers, error, userName));
  }

  if (intent) card.append(logBlock(intent, handlers, error));

  card.append(error);
  shadow.append(style, card);
  document.body.append(host);

  sealEvents(host);
  promoteToTopLayer(host);
}

function askBlock(
  ask: ReferralAsk,
  handlers: ReferralCardHandlers,
  error: HTMLElement,
  userName: string | null
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'ask';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'You asked about';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = ask.application.title;

  const company = document.createElement('div');
  company.className = 'company';
  company.textContent = ask.application.company;

  const tele = document.createElement('div');
  tele.className = 'tele';
  if (ask.application.appliedAt) {
    tele.append(teleLine('applied', relativeTime(ask.application.appliedAt)));
  }
  tele.append(
    teleLine(
      (REFERRAL_STATUS_LABELS[ask.status] ?? ask.status).toLowerCase(),
      relativeTime(ask.statusAt)
    )
  );

  /*
   * What is owed, and the words to say it in.
   *
   * The draft is the point of the card being here at all once the ask exists.
   * The user is on the profile, the message box is one click away, and the
   * alternative is writing the same four sentences from scratch for the
   * fortieth time — which is how a referral push quietly stops happening.
   *
   * Nothing sends. Copy, paste, edit, press send: the operating rule of this
   * whole feature, and also why the message has a chance of working.
   */
  const due = referralDue(ask);
  const draft = draftFor(ask.status, { ask, from: userName });

  if (due.action && due.isDue) {
    const flag = document.createElement('div');
    flag.className = 'due';
    flag.textContent =
      due.overdueDays > 0
        ? `${REFERRAL_ACTION_LABEL[due.action]} — ${due.overdueDays}d overdue`
        : `${REFERRAL_ACTION_LABEL[due.action]} — due now`;
    block.append(flag);
  } else if (due.stale) {
    const flag = document.createElement('div');
    flag.className = 'quiet';
    flag.textContent = 'No reply. Nothing more to send — one follow-up is the limit.';
    block.append(flag);
  }

  if (draft) {
    block.append(draftBlock(draft, error));
  }

  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = 'Status';
  const selectId = `ref-status-${ask.id}`;
  label.setAttribute('for', selectId);

  const select = document.createElement('select');
  select.id = selectId;
  for (const status of REFERRAL_STATUS) {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = REFERRAL_STATUS_LABELS[status];
    option.selected = status === ask.status;
    select.append(option);
  }

  /*
   * The whole point of the card being here.
   *
   * LinkedIn has just told them Priya accepted; they open the profile to write
   * to her, and the one thing the tracker needs is that fact. Making them go
   * back to the dashboard to record it is how a tracker stops being kept up to
   * date at all.
   */
  select.addEventListener('change', () => {
    const next = select.value as ReferralStatus;
    const previous = ask.status;
    select.disabled = true;
    error.hidden = true;

    void handlers.onStatus(ask, next).then((ok) => {
      select.disabled = false;
      if (ok) {
        ask.status = next;
        return;
      }
      // Put the control back where the data still is. A select showing a
      // status the server rejected is a lie the user cannot see.
      select.value = previous;
      error.textContent = 'Could not save that. Try again, or use the dashboard.';
      error.hidden = false;
    });
  });

  row.append(label, select);
  block.append(eyebrow, role, company, tele, row);
  return block;
}

/**
 * The log form, shown when the user came here from a referral search.
 *
 * The moment this exists for: they have just pressed Connect, the person's
 * name and headline are on the screen behind this card, and the alternative is
 * switching to the dashboard and typing both again. Nobody does that
 * reliably — and if the ask never gets logged, none of the rest of this
 * feature has anything to work with.
 *
 * Neither the company nor the role is a field. Both came from the posting the
 * user was reading when they pressed the search, so asking again would be
 * asking them to retype something the tool already knows.
 */
function logBlock(
  intent: CardIntent,
  handlers: ReferralCardHandlers,
  error: HTMLElement
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'ask';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Log an ask for';

  const role = document.createElement('div');
  role.className = 'role';
  role.textContent = intent.title;

  const company = document.createElement('div');
  company.className = 'company';
  company.textContent = intent.company;

  const name = document.createElement('input');
  name.className = 'field';
  name.type = 'text';
  name.placeholder = 'Their name';
  name.value = intent.prefill.name ?? '';
  name.setAttribute('aria-label', 'Their name');

  const headline = document.createElement('input');
  headline.className = 'field';
  headline.type = 'text';
  headline.placeholder = 'Their role (optional)';
  headline.value = intent.prefill.headline ?? '';
  headline.setAttribute('aria-label', 'Their role');

  const buttons = document.createElement('div');
  buttons.className = 'btns';

  const save = (status: 'INVITED' | 'ASKED', button: HTMLButtonElement) => {
    if (!name.value.trim()) {
      error.textContent = 'Their name, at least — the rest is optional.';
      error.hidden = false;
      name.focus();
      return;
    }

    for (const b of buttons.querySelectorAll('button')) b.disabled = true;
    const label = button.textContent;
    button.textContent = 'Saving…';
    error.hidden = true;

    void handlers
      .onLog({
        name: name.value.trim(),
        role: headline.value.trim() || null,
        status,
      })
      .then((ok) => {
        if (ok) {
          // The caller repaints from the refreshed index, so this card is
          // replaced by the "you asked about…" one. Nothing to reset here.
          return;
        }
        for (const b of buttons.querySelectorAll('button')) b.disabled = false;
        button.textContent = label;
        error.textContent = 'Could not save that. Try again, or use the dashboard.';
        error.hidden = false;
      });
  };

  /*
   * Two buttons rather than a dropdown and a submit. There are exactly two
   * things that just happened — a request went out, or they were already
   * connected and got the message — and each is one press.
   */
  const sent = document.createElement('button');
  sent.type = 'button';
  sent.className = 'b primary';
  sent.textContent = 'Sent a request';
  sent.addEventListener('click', () => save('INVITED', sent));

  const messaged = document.createElement('button');
  messaged.type = 'button';
  messaged.className = 'b';
  messaged.textContent = 'Messaged them';
  messaged.title = 'Already connected — you sent the referral message';
  messaged.addEventListener('click', () => save('ASKED', messaged));

  buttons.append(sent, messaged);
  block.append(eyebrow, role, company, name, headline, buttons);
  return block;
}

/**
 * The draft, with a copy button and nothing that sends.
 *
 * Editable in place, because the sentence only the user can write — why this
 * company, what they actually did — is the difference between a message that
 * gets a reply and one that reads as generated. The character counter only
 * appears where there is a real cap: LinkedIn silently rejects a connection
 * note over 200, and discovering that with the dialog already open is the
 * failure this prevents.
 */
function draftBlock(
  draft: { title: string; body: string; limit: number | null },
  error: HTMLElement
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'draft';

  const head = document.createElement('div');
  head.className = 'draft-head';

  const title = document.createElement('span');
  title.textContent = draft.title;

  const count = document.createElement('span');
  count.className = 'count';

  const area = document.createElement('textarea');
  area.className = 'field draft-body';
  area.value = draft.body;
  area.rows = draft.limit ? 3 : 5;
  area.setAttribute('aria-label', draft.title);

  const sync = () => {
    if (!draft.limit) return;
    const length = area.value.trim().length;
    count.textContent = `${length}/${draft.limit}`;
    count.dataset.over = String(length > draft.limit);
  };
  area.addEventListener('input', sync);
  sync();

  head.append(title, count);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'b';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(area.value)
      .then(() => {
        copy.textContent = 'Copied';
        // Back to a button that looks pressable. Leaving it as "Copied"
        // reads as done, and this is a thing people press twice.
        setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1600);
      })
      .catch(() => {
        // Clipboard writes need a user gesture and a focused document, and
        // both are true here — but a host page can still refuse via
        // permissions policy, and silently doing nothing is the worst
        // outcome for a button whose whole job is one action.
        area.select();
        error.textContent = 'Could not copy — the text is selected, press Ctrl+C.';
        error.hidden = false;
      });
  });

  const actions = document.createElement('div');
  actions.className = 'btns';
  actions.append(copy);

  wrap.append(head, area, actions);
  return wrap;
}

function teleLine(name: string, value: string): HTMLElement {
  const line = document.createElement('span');
  const key = document.createElement('b');
  key.textContent = name;
  const val = document.createElement('span');
  val.textContent = value;
  line.append(key, val);
  return line;
}
