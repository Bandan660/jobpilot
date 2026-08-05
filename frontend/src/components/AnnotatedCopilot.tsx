import { useEffect, useRef, useState } from 'react';

/**
 * One browser frame, annotated.
 *
 * Instead of a separate screenshot per capability, the whole extension is shown
 * working on a single page with numbered pins over the parts that matter. That
 * is closer to the truth — these things happen together, on one page, in one
 * pass — and it reads as an instrument legend rather than a feature list.
 *
 * The pins auto-advance until the reader interacts, then follow them.
 */

interface Pin {
  id: string;
  /** Position over the mock, in percent. */
  x: number;
  y: number;
  title: string;
  body: string;
}

const PINS: Pin[] = [
  {
    id: 'read',
    x: 26,
    y: 17,
    title: 'Reads the posting',
    body: 'Title, company, location, requisition id, and any salary the employer published — from the page’s structured job data first, selectors only to fill gaps.',
  },
  {
    id: 'duplicate',
    x: 78,
    y: 26,
    title: 'Checks it against your tracker',
    body: 'If you have applied to this role before — even through a different URL — the notice appears before you start filling anything in.',
  },
  {
    id: 'fill',
    x: 30,
    y: 52,
    title: 'Fills from one profile',
    body: 'Contact details, address, links, current role, work authorization, notice period. Matched by what the form calls each field, not by a hard-coded layout.',
  },
  {
    id: 'answers',
    x: 34,
    y: 72,
    title: 'Answers the repeats',
    body: 'Save an answer to “why this company?” once and Copilot recognises the same question next time, however it has been reworded.',
  },
  {
    id: 'submit',
    x: 20,
    y: 90,
    title: 'Logs it when you submit',
    body: 'You review and send. The application lands in your tracker on its own — Copilot never presses submit for you.',
  },
];

/** Cycle speed while the reader has not taken over. */
const AUTO_ADVANCE_MS = 4200;

export function AnnotatedCopilot() {
  const [active, setActive] = useState(0);
  const [locked, setLocked] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (locked) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    timer.current = window.setInterval(() => {
      setActive((current) => (current + 1) % PINS.length);
    }, AUTO_ADVANCE_MS);

    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [locked]);

  /** Any deliberate interaction stops the carousel for good. */
  const take = (index: number) => {
    setLocked(true);
    setActive(index);
  };

  return (
    <div className="annotated">
      <div className="annotated-frame">
        <div className="browser">
          <div className="browser-bar">
            <div className="browser-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="browser-url">
              boards.greenhouse.io/northwind/jobs/4821/application
            </div>
          </div>

          <div className="annotated-page" aria-hidden="true">
            <div className="ann-header">
              <span className="af-logo" />
              <div>
                <div className="ann-role">Software Engineer, Platform</div>
                <div className="mock-company">Northwind · Remote</div>
              </div>
            </div>

            <div className="ann-notice">
              <span className="demo-brand-dot">◆</span>
              <div>
                <div className="demo-banner-title">You applied to this role</div>
                <div className="demo-banner-sub">21 days ago — currently interview</div>
              </div>
            </div>

            <div className="ann-fields">
              <div className="af-field">
                <span className="af-field-label">Full name</span>
                <span className="ann-value">Alex Mercer</span>
              </div>
              <div className="af-field">
                <span className="af-field-label">Email</span>
                <span className="ann-value">alex.mercer@hey.com</span>
              </div>
              <div className="af-field">
                <span className="af-field-label">LinkedIn</span>
                <span className="ann-value">linkedin.com/in/amercer</span>
              </div>
              <div className="af-field">
                <span className="af-field-label">Authorized</span>
                <span className="ann-value">Yes</span>
              </div>
            </div>

            <div className="ann-question">
              <span className="ann-question-label">Why do you want to work here?</span>
              <div className="ann-textarea">
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className="ann-submit">Submit application</div>
          </div>
        </div>

        {/* Pins sit over the frame, positioned in percent so they track it as
            it scales. */}
        {PINS.map((pin, index) => (
          <button
            key={pin.id}
            type="button"
            className="ann-pin"
            data-active={index === active}
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            onMouseEnter={() => take(index)}
            onFocus={() => take(index)}
            onClick={() => take(index)}
            aria-label={pin.title}
          >
            {String(index + 1).padStart(2, '0')}
          </button>
        ))}
      </div>

      <ol className="annotated-legend">
        {PINS.map((pin, index) => (
          <li key={pin.id}>
            <button
              type="button"
              className="ann-legend-item"
              data-active={index === active}
              onMouseEnter={() => take(index)}
              onFocus={() => take(index)}
              onClick={() => take(index)}
            >
              <span className="ann-legend-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="ann-legend-body">
                <span className="ann-legend-title">{pin.title}</span>
                <span className="ann-legend-text">{pin.body}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
