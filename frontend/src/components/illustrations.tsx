/**
 * Animated product illustrations for the marketing pages.
 *
 * Drawn in markup and CSS rather than shipped as images: they stay sharp at
 * any density, follow the theme, and reuse the product's own classes so a
 * change to the real component shows up here too.
 *
 * All are decorative — screen readers get the surrounding prose instead.
 */

function CursorIcon() {
  return (
    <svg viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1 1l11.5 7.2-5 .9-2.6 4.8z"
        fill="#fff"
        stroke="#0b1420"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The posting sweep, drawn literally: a beam rotates over saved postings and
 * one fails as it passes. This is the six-hourly liveness check, not a
 * decorative graphic.
 */
export function RadarSweep() {
  // Positions are hand-placed so the failing dot sits where the beam reaches it
  // at the moment radar-fail flips it. Moving one means retiming the other.
  const dots = [
    { left: '62%', top: '30%', fails: false },
    { left: '35%', top: '41%', fails: false },
    { left: '72%', top: '64%', fails: true },
    { left: '46%', top: '72%', fails: false },
    { left: '24%', top: '58%', fails: false },
    { left: '55%', top: '19%', fails: false },
  ];

  return (
    <div>
      <div className="radar" aria-hidden="true">
        <span className="radar-beam" />
        {dots.map((dot) => (
          <span
            className="radar-dot"
            data-fails={dot.fails || undefined}
            style={{ left: dot.left, top: dot.top }}
            key={`${dot.left}-${dot.top}`}
          />
        ))}
      </div>
      <p className="radar-caption">sweep · every 6h</p>
    </div>
  );
}

/** Lightning glyph for the autofill section's icon chip. */
export function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Works on" pills — the platforms capture and autofill support today. */
export function WorksOn() {
  return (
    <div className="works-on">
      <span className="works-on-label">Works on</span>
      <span className="works-on-pill">
        <i />
        Greenhouse
      </span>
      <span className="works-on-pill">
        <i />
        Lever
      </span>
      <span className="works-on-pill">
        <i />
        Ashby
      </span>
      <span className="works-on-pill" data-more="true">
        +5 planned
      </span>
    </div>
  );
}

/**
 * The autofill sequence: cursor moves to the extension panel, presses Autofill,
 * and each field fills in turn with the amber flash the real extension uses.
 */
export function AutofillDemo() {
  const fields = [
    { label: 'Full name', value: 'Alex Mercer' },
    { label: 'Email', value: 'alex.mercer@hey.com' },
    { label: 'Phone', value: '+1 415 555 0148' },
    { label: 'LinkedIn', value: 'linkedin.com/in/amercer' },
    { label: 'Authorized', value: 'Yes' },
  ];

  return (
    <div className="browser" aria-hidden="true">
      <div className="browser-bar">
        <div className="browser-dots">
          <i />
          <i />
          <i />
        </div>
        <div className="browser-url">boards.greenhouse.io/northwind/jobs/4821</div>
      </div>

      <div className="af-page">
        <div className="af-company">
          <span className="af-logo" />
          Northwind
        </div>
        <div className="af-role">Software Engineer · Remote</div>

        <div className="af-fields">
          {fields.map((field) => (
            <div className="af-field" key={field.label}>
              <span className="af-field-label">{field.label}</span>
              <span className="af-field-value">{field.value}</span>
            </div>
          ))}
        </div>

        <div className="af-panel">
          <div className="af-panel-head">
            <span className="demo-brand-dot">◆</span>
            jobpilot
          </div>
          <div className="af-panel-body">
            <div className="af-panel-line" />
            <div className="af-panel-line" />
            <div className="af-panel-btn">Fill 12 fields</div>
          </div>
        </div>

        <div className="af-cursor">
          <CursorIcon />
        </div>
      </div>
    </div>
  );
}

/** The whole capture sequence: press submit, notice appears, row lands. */
export function CaptureDemo() {
  return (
    <div className="browser" aria-hidden="true">
      <div className="browser-bar">
        <div className="browser-dots">
          <i />
          <i />
          <i />
        </div>
        <div className="browser-url">jobs.lever.co/stripe/senior-backend-engineer/apply</div>
      </div>

      <div className="browser-body">
        <div className="demo-form">
          <div className="demo-field">Full name</div>
          <div className="demo-field">Email address</div>
          <div className="demo-field demo-field-file">Resume — drop a file</div>
          <div className="demo-submit">Submit application</div>
        </div>

        <div className="demo-cursor">
          <CursorIcon />
        </div>

        <div className="demo-banner">
          <span className="demo-brand-dot">◆</span>
          <div>
            <div className="demo-banner-title">Application tracked</div>
            <div className="demo-banner-sub">Senior Backend Engineer at Stripe</div>
          </div>
        </div>
      </div>

      <div className="demo-tracker">
        <div className="panel-mock-bar">
          <span>Your tracker</span>
          <span>updated just now</span>
        </div>
        <div className="mock-row" data-new="true">
          <div className="mock-role">
            Senior Backend Engineer
            <div className="mock-company">Stripe</div>
          </div>
          <span className="mock-age">0d</span>
          <span className="lamp lamp-wait">applied</span>
        </div>
        <div className="mock-row">
          <div className="mock-role">
            Software Engineer, Platform
            <div className="mock-company">Linear</div>
          </div>
          <span className="mock-age">9d</span>
          <span className="lamp lamp-live">screen</span>
        </div>
      </div>
    </div>
  );
}

/** Four URLs collapsing to one matched role. */
export function DuplicateDemo() {
  const sources = [
    'careers.stripe.com/jobs/4821',
    'jobs.lever.co/stripe/a3f…',
    'linkedin.com/jobs/view/…',
    'aggregator.io/j/senior-be',
  ];

  return (
    <div className="panel" aria-hidden="true">
      <div className="dup-sources">
        {sources.map((source) => (
          <div className="dup-source" key={source}>
            {source}
          </div>
        ))}
      </div>

      <div className="dup-arrow">↓</div>

      <div className="dup-result">
        <span className="lamp lamp-down">duplicate</span>
        <div>
          <div className="demo-banner-title">Senior Backend Engineer · Stripe</div>
          <div className="demo-banner-sub">You applied 21 days ago — currently interview</div>
        </div>
      </div>
    </div>
  );
}

/** A posting flipping from live to removed, with the sweep log beneath. */
export function PostingDemo() {
  return (
    <div className="panel" aria-hidden="true">
      <div className="posting-card">
        <div>
          <div className="demo-banner-title">Full Stack Engineer</div>
          <div className="demo-banner-sub">Vercel · applied 34d ago</div>
        </div>
        <span className="lamp-swap">
          <span className="lamp lamp-live">live</span>
          <span className="lamp lamp-down">removed</span>
        </span>
      </div>

      <div className="posting-card">
        <div>
          <div className="demo-banner-title">Staff Engineer, API</div>
          <div className="demo-banner-sub">Cloudflare · applied 27d ago</div>
        </div>
        <span className="lamp lamp-live">live</span>
      </div>

      <div className="sweep-log">
        <span>GET /stripe/senior-backend → 200 live</span>
        <span>
          GET /vercel/full-stack → <b>404 removed</b>
        </span>
        <span>GET /cloudflare/staff-api → 200 live</span>
      </div>
    </div>
  );
}

/** Pipeline funnel. Bars grow when the section scrolls into view. */
export function FunnelDemo() {
  const rows = [
    { label: 'Applied', width: 100, count: 48, tone: undefined },
    { label: 'Response', width: 31, count: 15, tone: undefined },
    { label: 'Screen', width: 19, count: 9, tone: undefined },
    { label: 'Interview', width: 10, count: 5, tone: undefined },
    { label: 'Ghosted', width: 19, count: 9, tone: 'dim' as const },
  ];

  return (
    <div className="panel funnel" aria-hidden="true">
      {rows.map((row) => (
        <div className="funnel-row" key={row.label}>
          <span className="funnel-label">{row.label}</span>
          <div className="funnel-bar">
            <div
              className="funnel-fill"
              data-tone={row.tone}
              style={{ width: `${row.width}%` }}
            />
          </div>
          <span className="funnel-count">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

/** Infinite marquee of supported and planned platforms. */
export function PlatformMarquee() {
  const platforms = [
    { name: 'Greenhouse', live: true },
    { name: 'Lever', live: true },
    { name: 'Ashby', live: true },
    { name: 'Workday', live: false },
    { name: 'iCIMS', live: false },
    { name: 'SmartRecruiters', live: false },
    { name: 'Taleo', live: false },
    { name: 'Workable', live: false },
  ];

  // Rendered twice: the track animates to -50%, so the second copy is what
  // makes the loop seamless rather than snapping back.
  const track = [...platforms, ...platforms];

  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {track.map((platform, index) => (
          <span
            className="marquee-item"
            data-state={platform.live ? 'live' : 'planned'}
            key={`${platform.name}-${index}`}
          >
            {platform.name}
            {platform.live && <span className="lamp lamp-live">live</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
