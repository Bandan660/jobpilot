/**
 * In-page notice.
 *
 * Rendered into a shadow root so the host page's CSS cannot restyle it and our
 * styles cannot leak out. ATS pages ship aggressive global resets, and without
 * isolation this banner is unreadable on roughly half of them.
 */

import { POPOVER_RESET, promoteToTopLayer, sealEvents } from './topLayer.js';

const HOST_ID = 'banapply-banner-host';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

export interface BannerOptions {
  tone: BannerTone;
  title: string;
  body?: string;
  /** Auto-dismiss delay. Success messages disappear; warnings stay put. */
  timeoutMs?: number;
  /**
   * Distance from the right edge.
   *
   * Defaults clear of nothing in particular; the side panel is 372px wide and
   * sits at the same edge, so a notice raised while it is open has to step
   * aside or it covers the very control it is telling the user to press.
   */
  rightPx?: number;
}

const TONE_COLORS: Record<BannerTone, { bar: string; bg: string; fg: string }> = {
  info: { bar: '#3b82f6', bg: '#eff6ff', fg: '#1e3a8a' },
  success: { bar: '#10b981', bg: '#ecfdf5', fg: '#065f46' },
  warning: { bar: '#f59e0b', bg: '#fffbeb', fg: '#92400e' },
  error: { bar: '#ef4444', bg: '#fef2f2', fg: '#991b1b' },
};

export function removeBanner(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function renderBanner(options: BannerOptions): void {
  removeBanner();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // Only positioning lives on the host; everything else is inside the shadow
  // root, where page styles cannot reach it.
  host.style.cssText = [
    'position: fixed',
    'top: 16px',
    `right: ${options.rightPx ?? 16}px`,
    // Fallback for anywhere the top layer is unavailable; see topLayer.ts for
    // why it is not sufficient on its own.
    'z-index: 2147483647',
    'width: 340px',
    'max-width: calc(100vw - 32px)',
    // See the note by `card.append` — this notice must never take a click.
    'pointer-events: none',
    ...POPOVER_RESET,
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });
  const colors = TONE_COLORS[options.tone];

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .card {
      display: flex;
      gap: 12px;
      background: ${colors.bg};
      border-left: 4px solid ${colors.bar};
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: ${colors.fg};
      animation: slide-in 180ms ease-out;
    }
    @keyframes slide-in {
      from { opacity: 0; transform: translateX(12px); }
      to   { opacity: 1; transform: none; }
    }
    .content { flex: 1; min-width: 0; }
    .title { font-size: 13px; font-weight: 600; line-height: 1.35; }
    .body { font-size: 12px; line-height: 1.45; margin-top: 3px; opacity: 0.85; word-break: break-word; }
    .brand { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; margin-bottom: 4px; }


    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  `;

  const card = document.createElement('div');
  card.className = 'card';

  const content = document.createElement('div');
  content.className = 'content';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'BanApply';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = options.title;

  content.append(brand, title);

  if (options.body) {
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = options.body;
    content.append(body);
  }

  /*
   * No dismiss button, and nothing else clickable either.
   *
   * The whole banner is `pointer-events: none`. A modal dismisses itself on
   * any click outside it, LinkedIn registers that in the capture phase on
   * `document` — before the event reaches us, so nothing we do at our own
   * element can stop it — and this notice sits over a half-filled
   * application. A ✕ that throws away the user's application is not a dismiss
   * button, so there is no dismiss button.
   *
   * Nothing is stranded by that: the warning clears the moment the run moves
   * on, and every other tone carries a timeout.
   */
  card.append(content);
  shadow.append(style, card);
  document.documentElement.append(host);

  /*
   * The whole point of this banner is to be seen over an application form, and
   * that form is now a top-layer `<dialog>` — so without this it was painted
   * underneath the very modal it exists to talk over. It is raised after the
   * dialog opens, which is also after the panel is promoted, so it lands on
   * top of both. Sealed for the same reason the panel is: dismissing this
   * notice must not dismiss the user's application behind it.
   */
  promoteToTopLayer(host);
  sealEvents(host);

  /*
   * Warnings stay: one is up precisely because a run is waiting on the user,
   * and it is removed when that stops being true. Everything else times out,
   * because without a dismiss button nothing else would ever clear it.
   */
  const timeout = options.timeoutMs ?? (options.tone === 'warning' ? 0 : 8000);

  if (timeout > 0) {
    setTimeout(removeBanner, timeout);
  }
}
