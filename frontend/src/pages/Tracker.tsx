import { Link } from 'react-router-dom';
import { usePageMeta } from '../usePageMeta.js';
import { Reveal } from '../components/Reveal.js';
import { Showcase, type ShowcaseItem } from '../components/Showcase.js';
import {
  MockBookmarks,
  MockImport,
  MockInsights,
  MockNotes,
  MockPipeline,
  SpreadsheetDecay,
} from '../components/trackerMocks.js';

const FEATURES: ShowcaseItem[] = [
  {
    id: 'pipeline',
    tag: 'One place',
    title: 'Every application, without the data entry',
    body: 'Applications land here on their own the moment you submit them. No spreadsheet, no end-of-day catch-up, no gaps where you forgot.',
    points: [
      'Role, company, posting URL, location, and date captured at submit',
      'Posting liveness shown alongside your own stage',
      'Search and filter across everything you have applied to',
    ],
    cta: { label: 'Track an application', to: '/signup' },
    visual: <MockPipeline />,
  },
  {
    id: 'insights',
    tag: 'Insights',
    title: 'Find out how you are actually doing',
    body: 'Application count is vanity. Response rate and time-to-reply are the numbers that change what you do next — and neither survives a spreadsheet you stopped updating.',
    points: [
      'What share of applications got any reply at all',
      'How long a response takes when it comes',
      'Which roles have gone quiet long enough to write off',
    ],
    cta: { label: 'See your insights', to: '/signup' },
    visual: <MockInsights />,
  },
  {
    id: 'notes',
    tag: 'Context',
    title: 'Keep notes and contacts with the role',
    body: 'Recruiter names, referrals, and what was actually said in the screen — attached to the application instead of scattered across your inbox and three chat apps.',
    points: [
      'Contacts per application, with how you know them',
      'Interview notes dated and kept in order',
      'A full history of every change, never overwritten',
    ],
    cta: { label: 'Organise your applications', to: '/signup' },
    visual: <MockNotes />,
  },
  {
    id: 'bookmarks',
    tag: 'Saved',
    title: 'Bookmark roles you are not ready for yet',
    body: 'Save an opening from anywhere on the web and it sits in your tracker as a saved job — separate from what you have actually applied to, so your numbers stay honest.',
    points: [
      'One click from the extension popup',
      'Saved jobs kept apart from submitted applications',
      'Promoted to applied automatically when you do apply',
    ],
    cta: { label: 'Bookmark a job', to: '/signup' },
    visual: <MockBookmarks />,
  },
  {
    id: 'import',
    tag: 'History',
    title: 'Bring in the ones you already sent',
    body: 'You did not start your job search today. Import the applications you made before jobpilot existed so the stats reflect your whole search, not just the part after signup.',
    points: [
      'Import from the spreadsheet you were already keeping',
      'Rows with missing details are flagged, not silently dropped',
      'Add a one-off application by hand any time',
    ],
    cta: { label: 'Start tracking now', to: '/signup' },
    visual: <MockImport />,
  },
];

export function Tracker() {
  usePageMeta(
    'Job application tracker',
    'Every application in one place, captured automatically — with response rates, time-to-reply, notes, contacts, and alerts when a posting comes down.',
    '/job-application-tracker'
  );

  return (
    <>
      <section className="hero">
        <div className="shell">
          <div className="hero-copy">
            <span className="eyebrow">Job application tracker</span>
            <h1>
              Track your search. Stop <em>maintaining</em> it.
            </h1>
            <p>
              jobpilot saves every application you submit, keeps its status current on its own, and
              tells you which roles have gone quiet — so you always know where you stand.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/copilot">
                How capture works
              </Link>
            </div>
            <span className="hero-note">
              No card, no trial timer. Free while jobpilot is in early access.
            </span>
          </div>

          <MockPipeline />
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <Reveal className="statement">
            <h2>
              No more spreadsheets you stopped{' '}
              <span className="underline-accent">trusting in week two</span>.
            </h2>
            <p>
              A tracker only helps if it is accurate, and it is only accurate if keeping it accurate
              costs you nothing.
            </p>
          </Reveal>

          <Reveal className="versus-wrap">
            <SpreadsheetDecay />
          </Reveal>

          <Reveal className="cards versus-notes">
            <article className="card">
              <h3>Week one</h3>
              <p>
                Immaculate. Every column filled in, colour-coded, sorted by date. This is the part
                everyone remembers.
              </p>
            </article>
            <article className="card">
              <h3>Week three</h3>
              <p>
                Statuses are stale. Two recruiters have replied and neither is recorded, because
                updating a row has no immediate payoff.
              </p>
            </article>
            <article className="card">
              <h3>Week six</h3>
              <p>
                You are reading old confirmation emails to work out where you actually stand. The
                spreadsheet is now a worse record than your inbox.
              </p>
            </article>
          </Reveal>
        </div>
      </section>

      <section className="section" style={{ borderTop: 'none', paddingTop: 0 }}>
        <div className="shell">
          <Showcase items={FEATURES} />
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <Reveal className="section-head" as="header">
            <span className="eyebrow">And the part nobody else does</span>
            <h2>It tells you when a posting dies</h2>
            <p>
              Silence after applying is indistinguishable from rejection. jobpilot re-checks the
              roles you are waiting on every six hours, and when a posting comes down — filled, or
              the req frozen — it moves to the top of your list instead of sitting there looking
              active.
            </p>
          </Reveal>

          <Reveal className="strip">
            <div className="strip-item">
              <span className="strip-value">6h</span>
              <span className="strip-label">between checks</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">404 / 410</span>
              <span className="strip-label">counts as evidence</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">403 / 429</span>
              <span className="strip-label">never does</span>
            </div>
            <div className="strip-item">
              <span className="strip-value">0</span>
              <span className="strip-label">status changes made for you</span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="cta-band">
        <div className="shell">
          <div className="cta-panel">
            <h2>Your next application can log itself</h2>
            <p>
              Create an account, install the extension, and apply to one job. That is the whole
              setup.
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
          </div>
        </div>
      </section>
    </>
  );
}
