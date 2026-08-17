import {
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABELS,
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

export function renderReferralCard(asks: ReferralAsk[], handlers: ReferralCardHandlers): void {
  removeReferralCard();
  if (dismissed || asks.length === 0) return;

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
  brand.textContent = asks.length > 1 ? `BanApply · ${asks.length} asks` : 'BanApply · referral';

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', () => {
    dismissed = true;
    removeReferralCard();
  });

  head.append(brand, close);
  card.append(head);

  const error = document.createElement('div');
  error.className = 'err';
  error.hidden = true;

  for (const ask of asks) {
    card.append(askBlock(ask, handlers, error));
  }

  card.append(error);
  shadow.append(style, card);
  document.body.append(host);

  sealEvents(host);
  promoteToTopLayer(host);
}

function askBlock(
  ask: ReferralAsk,
  handlers: ReferralCardHandlers,
  error: HTMLElement
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

function teleLine(name: string, value: string): HTMLElement {
  const line = document.createElement('span');
  const key = document.createElement('b');
  key.textContent = name;
  const val = document.createElement('span');
  val.textContent = value;
  line.append(key, val);
  return line;
}
