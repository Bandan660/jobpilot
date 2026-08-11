import { Link } from 'react-router-dom';
import { usePageMeta } from '../usePageMeta.js';
import { Reveal } from '../components/Reveal.js';
import { AnnotatedCopilot } from '../components/AnnotatedCopilot.js';
import { AutofillDemo, WorksOn } from '../components/illustrations.js';

export function Copilot() {
  usePageMeta(
    'Copilot browser extension',
    'Copilot autofills job applications from one profile, warns you about duplicates before you apply, and records the application at submit.',
    '/copilot'
  );

  return (
    <>
      <section className="hero">
        <div className="shell">
          <div className="hero-copy">
            <span className="eyebrow">Browser extension</span>
            <h1>
              Fill it once. Copilot does the <em>rest</em>.
            </h1>
            <p>
              One profile fills every application form — name, contact, links, work history, and the
              same handful of questions every employer asks. Copilot also catches duplicates before
              you apply and records the application the moment you send it.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/job-application-tracker">
                See the tracker
              </Link>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginTop: '12px',
                fontSize: '12px',
                color: 'var(--text-dim)',
              }}
            >
              <span style={{ color: '#ffb020', fontWeight: 800 }}>★ 4.9/5 Rating</span>
              <span>· Joined by 15,000+ active job seekers</span>
            </div>
            <span className="hero-note" style={{ marginTop: '6px' }}>
              Chrome and Chromium browsers · Manifest V3
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                top: '-16px',
                right: '-12px',
                background: 'linear-gradient(135deg, #ffc857 0%, #ffb020 100%)',
                color: '#120c02',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 800,
                boxShadow: '0 6px 20px rgba(255,176,32,0.4)',
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
                background: '#0d1424',
                border: '1px solid #10b981',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>🛡️ 20 Sensitive Fields Blocked</span>
            </div>

            <AutofillDemo />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <Reveal className="statement">
            <h2>
              Everything it does happens on{' '}
              <span className="underline-accent">one page, in one pass</span>.
            </h2>
            <p>
              Copilot is not five separate tools. It is one extension that reads the posting, checks
              your history, fills the form, and records the result — while you are on the page
              anyway.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Annotated diagram rather than a screenshot per feature: these things
          are simultaneous, and showing them apart would misrepresent that. */}
      <section className="section" style={{ borderTop: 'none', paddingTop: 0 }}>
        <div className="shell">
          <Reveal>
            <AnnotatedCopilot />
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <Reveal className="section-head" as="header">
            <span className="eyebrow">Boundaries</span>
            <h2>What it will not do</h2>
            <p>
              Worth being explicit, because most job extensions do the opposite — and because these
              limits are the reason it is safe to let something type on your behalf.
            </p>
          </Reveal>

          <div className="cluster">
            <Reveal className="tile" data-span="lead" data-accent="true">
              <span className="tile-tag">Hard rule</span>
              <h3>It never presses submit</h3>
              <p>
                Autofill puts values in front of you and stops. Sending an application stays a
                deliberate click — which is also what keeps this from becoming a tool for spraying
                hundreds of applications at employers who did not ask for them.
              </p>
              <div className="tile-foot">fill → review → you submit</div>
            </Reveal>

            <Reveal className="tile" data-span="tall" delay={1}>
              <span className="tile-tag">Refused outright</span>
              <h3>Sensitive fields</h3>
              <p>
                Passwords, card numbers, bank details, social security and national insurance
                numbers, passport numbers, dates of birth. Blocked by pattern, whatever the field is
                labelled.
              </p>
              <div className="tile-foot">20 blocked patterns</div>
            </Reveal>

            <Reveal className="tile" data-span="small">
              <span className="tile-tag">Your typing</span>
              <h3>Never overwritten</h3>
              <p>Anything you filled in yourself is left alone. Running autofill twice is safe.</p>
            </Reveal>

            <Reveal className="tile" data-span="small" delay={1}>
              <span className="tile-tag">Uncertainty</span>
              <h3>Never guesses</h3>
              <p>
                Below a confidence threshold it leaves the field blank. A blank you notice beats a
                wrong answer you do not.
              </p>
            </Reveal>

            <Reveal className="tile" data-span="small" delay={2}>
              <span className="tile-tag">Scope</span>
              <h3>No browsing history</h3>
              <p>
                It runs only on the boards in its permissions, and sends nothing until you act.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <Reveal className="section-head" as="header">
            <span className="eyebrow">Coverage</span>
            <h2>Where it works today</h2>
            <p>
              Each platform needs its own adapter — the field names, the form structure, and the
              submit behaviour all differ. Support grows one at a time rather than all at once.
            </p>
          </Reveal>

          <Reveal>
            <WorksOn />
          </Reveal>

          <Reveal className="strip">
            <div className="strip-item">
              <span className="strip-value">JSON-LD</span>
              <span className="strip-label">read before selectors</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">MV3</span>
              <span className="strip-label">manifest version</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">0</span>
              <span className="strip-label">application limits</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">0</span>
              <span className="strip-label">auto-submits</span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="cta-band">
        <div className="shell">
          <div className="cta-panel">
            <h2>Install it before your next application</h2>
            <p>The form only fills itself if Copilot is there when you open it.</p>
            <div className="cta-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/job-application-tracker">
                See the tracker
              </Link>
            </div>
            <p className="cta-fineprint">no card / no trial timer / uninstall to cancel</p>
          </div>
        </div>
      </section>
    </>
  );
}
