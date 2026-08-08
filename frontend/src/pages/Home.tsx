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
  PlatformMarquee,
  RadarSweep,
  WorksOn,
} from '../components/illustrations.js';
import { useScrollScenes } from '../useScrollScenes.js';

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
  );
}

export function Home() {
  useScrollScenes();

  useSeo({
    title: 'Job application tracker that updates itself',
    description:
      'jobpilot autofills job applications from one profile, records every application from your browser, and tells you when a posting comes down.',
    path: '/',
    // FAQPage markup on the questions already rendered below. This is the one
    // schema type on the marketing pages that can earn a rich result.
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: SITE.name,
          url: SITE_URL,
          description: 'A job application tracker that fills forms and updates itself.',
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
            <span className="eyebrow">Job application tracker</span>
            <h1>
              Apply. That&rsquo;s the <em>whole</em> workflow.
            </h1>
            <p>
              Copilot fills the form from one profile, records the application straight from your
              browser, warns you before you apply somewhere twice, and tells you when a posting
              comes down.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/job-application-tracker">
                See the tracker
              </Link>
            </div>
            <span className="hero-note">
              No card, no trial timer. Free while jobpilot is in early access.
            </span>
          </div>

          <TrackerMock />
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
              <WorksOn />
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
                  different titles, same opening. jobpilot recognises them as one and warns you
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

          <Waypoint index="04">
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
          <Waypoint index="05">
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
