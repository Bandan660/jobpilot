/**
 * In-page notice.
 *
 * Rendered into a shadow root so the host page's CSS cannot restyle it and our
 * styles cannot leak out. ATS pages ship aggressive global resets, and without
 * isolation this banner is unreadable on roughly half of them.
 */

const HOST_ID = 'jobpilot-banner-host';

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
    'z-index: 2147483647',
    'width: 340px',
    'max-width: calc(100vw - 32px)',
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
    .close {
      background: none; border: none; cursor: pointer;
      color: inherit; opacity: 0.5; font-size: 16px; line-height: 1;
      padding: 2px; align-self: flex-start;
    }
    .close:hover { opacity: 1; }


    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
  `;

  const card = document.createElement('div');
  card.className = 'card';

  const content = document.createElement('div');
  content.className = 'content';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'jobpilot';

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

  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', removeBanner);

  card.append(content, close);
  shadow.append(style, card);
  document.documentElement.append(host);

  const timeout = options.timeoutMs ?? (options.tone === 'success' ? 6000 : 0);

  if (timeout > 0) {
    setTimeout(removeBanner, timeout);
  }
}
