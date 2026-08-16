import { Link } from 'react-router-dom';
import { SITE_URL, useSeo } from '../usePageMeta.js';
import { SITE } from '../content/site.js';
import { Reveal } from '../components/Reveal.js';
import { Mission, Waypoint } from '../components/Mission.js';
import { FAQS } from '../content/faqs.js';
import {
  AutofillDemo,
  BoltIcon,
  CaptureDemo,
  DuplicateDemo,
  FunnelDemo,
  JobBoardShowcase,
  PlatformMarquee,
  RadarSweep,
  WorksOn,
} from '../components/illustrations.js';

/** Static readout of the product, built in CSS so it stays crisp at any size. */
function TrackerMock() {
  const rows = [
    { role: 'Senior Backend Engineer', company: 'Stripe', age: '21d', lamp: 'live', state: 'interview' },
    { role: 'Software Engineer, Platform', company: 'Linear', age: '9d', lamp: 'live', state: 'screen' },
    { role: 'Full Stack Engineer', company: 'Vercel', age: '34d', lamp: 'down', state: 'removed' },
    { role: 'Backend Engineer', company: 'Ramp', age: '41d', lamp: 'down', state: 'closed' },
    { role: 'Staff Engineer, API', company: 'Cloudflare', age: '27d', lamp: 'wait', state: 'applied' },
  ] as const;

  return (
    <div style={{ position: 'relative' }}>
      {/* Floating Badges */}
      <div
        style={{
          position: 'absolute',
          top: '-16px',
          right: '-12px',
          background: 'linear-gradient(135deg, var(--signal-bright) 0%, var(--signal) 100%)',
          color: 'var(--on-signal)',
          padding: '6px 12px',
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: 800,
          boxShadow: '0 6px 20px var(--hero-glow)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>⚡ 1-Click Form Autofill</span>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '-14px',
          left: '-16px',
          background: 'var(--panel-raised)',
          border: '1px solid var(--live)',
          color: 'var(--text)',
          padding: '6px 12px',
          borderRadius: '999px',
          fontSize: '11px',
          fontWeight: 700,
          boxShadow: '0 6px 20px var(--shadow)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>🛡️ Duplicate &amp; Posting Sweep Guard</span>
      </div>

      <div className="panel-mock" aria-hidden="true">
        <div className="panel-mock-bar">
          <span>Pipeline</span>
          <span>5 active · 2 postings down</span>
        </div>
        {rows.map((row) => (
          <div className="mock-row" key={row.role}>
            <div className="mock-role">
              {row.role}
              <div className="mock-company">{row.company}</div>
            </div>
            <span className="mock-age">{row.age}</span>
            <span className={`lamp lamp-${row.lamp}`}>{row.state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Home() {
  useSeo({
    title: 'Ban the pain of applying | 1-Click AI Job Autofill & Tracker',
    description:
      'BanApply — Ban the pain of applying. 1-click AI autofill across LinkedIn, Indeed, Naukri, Greenhouse, Lever & Workday. Calculate skill match scores and auto-track applications.',
    path: '/',
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: SITE.name,
          url: SITE_URL,
          description: 'BanApply — Ban the pain of applying. 1-click AI job autofill and automatic application tracker.',
        },
        {
          '@type': 'SoftwareApplication',
          name: `${SITE.name} Copilot`,
          applicationCategory: 'BrowserApplication',
          operatingSystem: 'Chrome',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        },
        {
          '@type': 'FAQPage',
          mainEntity: FAQS.map((faq) => ({
            '@type': 'Question',
            name: faq.q,
            acceptedAnswer: { '@type': 'Answer', text: faq.a.join(' ') },
          })),
        },
      ],
    },
  });

  return (
    <>
      <section className="hero">
        <div className="shell">
          <div className="hero-copy">
            <span className="eyebrow">⚡ BanApply &mdash; Ban the pain of applying</span>
            <h1>
              Ban the <em>pain</em> of applying for jobs.
            </h1>
            <p>
              BanApply is your 1-click AI job co-pilot. Fill application forms instantly across LinkedIn, Indeed, Naukri, Greenhouse, Lever, &amp; Workday, calculate skill match scores, and auto-track every role in your dashboard.
            </p>
            <div className="hero-actions">
              <a
                className="btn btn-primary"
                href={SITE.chromeStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                ⚡ Get Chrome Extension ↗
              </a>
              <Link className="btn btn-ghost" to="/signup">
                Join now &mdash; it&rsquo;s free
              </Link>
            </div>
            <span className="hero-note">
              No card required, no trial timer. Free while BanApply is in early access.
            </span>
          </div>

          <TrackerMock />
        </div>
      </section>

      {/* Featured Chrome Extension Section */}
      <section className="section" style={{ paddingTop: '20px', paddingBottom: '30px' }}>
        <div className="shell">
          <Reveal>
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
                border: '1px solid var(--signal-dim)',
                borderRadius: '20px',
                padding: '32px 36px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '24px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: '240px',
                  height: '100%',
                  background: 'radial-gradient(circle at top right, rgba(255, 176, 32, 0.15), transparent 70%)',
                  pointerEvents: 'none',
                }}
              />

              <div style={{ flex: '1 1 400px', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 800,
                      padding: '4px 12px',
                      borderRadius: '999px',
                      background: 'rgba(255, 176, 32, 0.15)',
                      color: 'var(--warn)',
                      border: '1px solid rgba(255, 176, 32, 0.3)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    ⚡ OFFICIAL CHROME EXTENSION
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: 'var(--text-dim)',
                    }}
                  >
                    Manifest V3 Certified
                  </span>
                </div>
                <h2 style={{ fontSize: '26px', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--text-bright)', lineHeight: 1.3 }}>
                  Get BanApply Copilot for Google Chrome
                </h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '15px', margin: 0, lineHeight: 1.6, maxWidth: '640px' }}>
                  1-Click auto-fill your profile, attach your resume, answer custom questions, and auto-track applications directly inside your browser across LinkedIn, Indeed, Greenhouse, Lever, Workday, Ashby, and Naukri.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', zIndex: 1 }}>
                <a
                  href={SITE.chromeStoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontWeight: 800,
                    padding: '14px 24px',
                    fontSize: '15px',
                    borderRadius: '10px',
                    boxShadow: '0 6px 20px rgba(245, 158, 11, 0.3)',
                    textDecoration: 'none',
                  }}
                >
                  <span>⚡ Add to Chrome &mdash; It&rsquo;s Free ↗</span>
                </a>
                <span style={{ fontSize: '12px', color: 'var(--text-dim)', opacity: 0.8 }}>
                  Free Access · Rated 5.0★ on Chrome Web Store
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Everything below hangs off one rail. Single column throughout — no
          zig-zag, which is the pattern that makes product pages interchangeable. */}
      <div className="shell">
        <Mission>
          <Waypoint index="01">
            <Reveal className="waypoint-head" as="header">
              <div className="chip-head">
                <span className="icon-chip">
                  <BoltIcon />
                </span>
                <span className="chip-label">Autofill</span>
              </div>
              <h2>Stop retyping the same twelve answers</h2>
              <p>
                One profile — name, contact, links, work history, authorization, notice period.
                Copilot maps it onto whatever each form calls those fields and fills them in a
                single pass.
              </p>
            </Reveal>

            <Reveal className="strip">
              <div className="strip-item">
                <span className="strip-value">1</span>
                <span className="strip-label">profile</span>
              </div>
              <div className="strip-item">
                <span className="strip-value">~12</span>
                <span className="strip-label">fields per form</span>
              </div>
              <div className="strip-item">
                <span className="strip-value">0</span>
                <span className="strip-label">auto-submits</span>
              </div>
              <div className="strip-item">
                <span className="strip-value">0</span>
                <span className="strip-label">sensitive fields touched</span>
              </div>
            </Reveal>

            <Reveal>
              <JobBoardShowcase />
              <AutofillDemo />
            </Reveal>
          </Waypoint>

          <Waypoint index="02">
            <Reveal className="waypoint-head" as="header">
              <h2>Then it logs itself</h2>
              <p>
                The extension is already on the page when you submit, so recording the application
                costs you nothing — no second step, no spreadsheet.
              </p>
            </Reveal>

            <Reveal>
              <CaptureDemo />
            </Reveal>
          </Waypoint>

          <Waypoint index="03">
            <Reveal className="waypoint-head" as="header">
              <h2>A list you maintain is just storage</h2>
              <p>
                A tracker earns its place by telling you something you did not already know. Three
                instruments, each watching a different failure mode.
              </p>
            </Reveal>

            {/* Tile size encodes importance rather than filling a grid evenly. */}
            <div className="cluster">
              <Reveal className="tile" data-span="lead" data-accent="true">
                <span className="tile-tag">Duplicate guard</span>
                <h3>One job hides behind four URLs</h3>
                <p>
                  Careers page, ATS board, aggregator, recruiter link — different addresses,
                  different titles, same opening. BanApply recognises them as one and warns you
                  before you apply again.
                </p>
                <div className="tile-visual">
                  <DuplicateDemo />
                </div>
              </Reveal>

              <Reveal className="tile" data-span="tall" delay={1}>
                <span className="tile-tag">Posting sweep</span>
                <h3>It notices when a listing dies</h3>
                <div className="tile-visual">
                  <RadarSweep />
                </div>
                <p>
                  Roles you are waiting on get re-checked around the clock. Only a 404, a 410, or
                  &ldquo;applications closed&rdquo; counts — a bot wall is not evidence.
                </p>
              </Reveal>

              <Reveal className="tile" data-span="wide">
                <span className="tile-tag">Search analytics</span>
                <h3>How you are actually doing</h3>
                <div className="tile-visual">
                  <FunnelDemo />
                </div>
              </Reveal>

              <Reveal className="tile" data-span="small" delay={1}>
                <span className="tile-tag">Saved answers</span>
                <h3>Write it once</h3>
                <p>
                  &ldquo;Why this company?&rdquo; recognised on the next application, however it is
                  worded.
                </p>
                <div className="ticker">
                  <span>matched</span>
                  <b>why_do_you_want</b>
                  <span className="ticker-cursor" />
                </div>
              </Reveal>
            </div>
          </Waypoint>

          <ComparisonSection />

          <Waypoint index="05">
            <Reveal className="waypoint-head" as="header">
              <h2>The boards you already apply through</h2>
              <p>
                Each platform needs its own adapter, so support grows one at a time. These three
                cover most startup and tech postings.
              </p>
            </Reveal>
            <Reveal>
              <PlatformMarquee />
            </Reveal>
          </Waypoint>

          {/* id lets the footer link straight to this section now that there is
              no standalone FAQ page. */}
          <Waypoint index="06">
            <div id="faq" style={{ scrollMarginTop: '84px' }}>
              <Reveal className="waypoint-head" as="header">
                <h2>Questions worth answering directly</h2>
                <p>
                  Mostly about what the extension can see, and how the automatic parts decide what
                  they decide.
                </p>
              </Reveal>

              <Reveal className="faq-list">
                {FAQS.map((faq) => (
                  <details className="faq-item" key={faq.q}>
                    <summary>{faq.q}</summary>
                    <div className="faq-answer">
                      {faq.a.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                  </details>
                ))}
              </Reveal>
            </div>
          </Waypoint>
        </Mission>
      </div>

      <section className="cta-band">
        <div className="shell">
          <Reveal className="cta-panel">
            <h2>Stop updating a spreadsheet you don&rsquo;t trust</h2>
            <p>
              Free to join, free to use. Install the extension, apply to your next role, and watch
              it fill and log itself.
            </p>
            <div className="cta-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/copilot">
                How Copilot works
              </Link>
            </div>
            <p className="cta-fineprint">no card / no trial timer / uninstall to cancel</p>
          </Reveal>
        </div>
      </section>
    </>
  );
}

function ComparisonSection() {
  return (
    <Waypoint index="04">
      <Reveal className="waypoint-head" as="header">
        <div className="chip-head">
          <span className="icon-chip">
            <BoltIcon />
          </span>
          <span className="chip-label">Why BanApply</span>
        </div>
        <h2>Manual Spreadsheets vs. The BanApply Workflow</h2>
        <p>
          Traditional job searching is filled with retyping, lost URLs, and zero feedback. See how
          BanApply automates the hard parts.
        </p>
      </Reveal>

      <Reveal>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '20px',
            marginTop: '24px',
          }}
        >
          {/* Traditional Manual Search */}
          <div
            style={{
              background: 'var(--down-wash)',
              border: '1px solid var(--down)',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '16px',
                color: 'var(--down)',
                fontWeight: 700,
                fontSize: '16px',
              }}
            >
              <span style={{ fontSize: '20px' }}>❌</span>
              <span>Traditional Manual Workflow</span>
            </div>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                fontSize: '13.5px',
                color: 'var(--text-dim)',
              }}
            >
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--down)' }}>•</span>
                <span>Spend 15+ minutes retyping work history &amp; contact info on every form</span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--down)' }}>•</span>
                <span>Manually update spreadsheets that get outdated in days</span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--down)' }}>•</span>
                <span>Accidentally apply twice to the same job across different boards</span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--down)' }}>•</span>
                <span>Never know when a job posting has been removed or closed</span>
              </li>
            </ul>
          </div>

          {/* With BanApply */}
          <div
            style={{
              background:
                'linear-gradient(135deg, var(--signal-wash) 0%, var(--live-wash) 100%)',
              border: '1px solid var(--signal-dim)',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: '0 8px 30px var(--shadow)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '16px',
                color: 'var(--signal-text)',
                fontWeight: 700,
                fontSize: '16px',
              }}
            >
              <span style={{ fontSize: '20px' }}>✨</span>
              <span>With BanApply Copilot</span>
            </div>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                fontSize: '13.5px',
                color: 'var(--text)',
              }}
            >
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--signal-text)', fontWeight: 800 }}>✓</span>
                <span>
                  <strong>5-second 1-click autofill</strong> mapped automatically from 1 profile
                </span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--signal-text)', fontWeight: 800 }}>✓</span>
                <span>
                  <strong>Zero-touch auto-logging</strong> straight from your browser on submit
                </span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--signal-text)', fontWeight: 800 }}>✓</span>
                <span>
                  <strong>Smart Duplicate Guard</strong> warns before you apply to duplicate URLs
                </span>
              </li>
              <li style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--signal-text)', fontWeight: 800 }}>✓</span>
                <span>
                  <strong>24/7 Posting Sweep</strong> alerts you when a listing dies or 404s
                </span>
              </li>
            </ul>
          </div>
        </div>
      </Reveal>
    </Waypoint>
  );
}
