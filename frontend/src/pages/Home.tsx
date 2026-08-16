import { Link } from 'react-router-dom';
import { SITE_URL, useSeo } from '../usePageMeta.js';
import { SITE } from '../content/site.js';
import { Reveal } from '../components/Reveal.js';
import { FAQS } from '../content/faqs.js';

/**
 * The homepage.
 *
 * THE TEST EVERY SECTION HAD TO PASS
 *
 * Could this section carry another company's logo unchanged? If yes it is the
 * wrong section. So the artwork here is application forms, field rows, status
 * lines, tracker rows and the amber diamond — the product's own vocabulary,
 * not illustrations about it.
 *
 * WHAT THE PAGE IS NOT ALLOWED TO CLAIM
 *
 * Three places where the brief and the product disagreed, resolved toward the
 * product every time, because a marketing page the first run contradicts is
 * worse than no page:
 *
 * - Submitting. The brief asked the site to show review rather than
 *   auto-submit "unless the product genuinely does so". It does — deliberately,
 *   and the extension's own panel says so. So the hero stops at review, which
 *   is what the *fill* path does, and the trust section states the actual
 *   guarantee: it submits after you press Apply, never with a required
 *   question unanswered.
 * - Platform status. Live means driven against a real posting: LinkedIn,
 *   Naukri, Indeed. Greenhouse is beta — opt-in, and tested on a live form.
 *   Everything else is written and unproven, and says so.
 * - Numbers. No ratings, no user counts, no "hours saved". The proof section
 *   counts what a form contains, which is true of any form, rather than
 *   counting users this product does not yet have.
 */

/* ------------------------------ hero content ----------------------------- */

const HERO_FIELDS = [
  { label: 'First name', value: 'Ritesh', state: 'filled' },
  { label: 'Last name', value: 'Kumar', state: 'filled' },
  { label: 'Email', value: 'ritesh@example.com', state: 'filled' },
  { label: 'Phone', value: '+91 98••• ••210', state: 'filled' },
  { label: 'Current company', value: 'Nimbus Labs', state: 'filled' },
  { label: 'Experience', value: '3 years', state: 'filled' },
  { label: 'LinkedIn', value: 'linkedin.com/in/…', state: 'filled' },
  { label: 'Resume', value: 'ritesh-kumar-cv.pdf', state: 'filled' },
  { label: 'Notice period', value: '30 days', state: 'filled' },
  { label: 'Expected CTC', value: 'Needs your answer', state: 'review' },
  { label: 'Why this company?', value: 'Needs your answer', state: 'review' },
] as const;

interface FieldRow {
  label: string;
  value: string;
  state?: string;
}

/**
 * The application surface.
 *
 * One component, five appearances: the hero, each step of the scroll story,
 * the LinkedIn section and the Naukri section. Reusing it is the point — by
 * the fourth time the reader knows what an amber rule and a tick mean without
 * being told.
 */
function ApplicationForm({
  url,
  role,
  meta,
  fields,
  counts,
  play = true,
}: {
  url: string;
  role: string;
  meta: string;
  fields: readonly FieldRow[];
  counts?: { detected: number; filled: number; review: number };
  play?: boolean;
}) {
  return (
    <div className={`hx-app ${play ? 'hx-play' : ''}`}>
      <div className="hx-app-bar">
        <i aria-hidden="true" />
        <i aria-hidden="true" />
        <i aria-hidden="true" />
        <span className="hx-app-url">{url}</span>
      </div>

      <div className="hx-app-head">
        <strong>{role}</strong>
        <span>{meta}</span>
      </div>

      <div className="hx-fields">
        {fields.map((field, i) => (
          <div
            className="hx-f"
            key={field.label}
            data-state={field.state}
            style={{ ['--i' as string]: i }}
          >
            <span className="hx-f-label">{field.label}</span>
            <span className="hx-f-value">{field.value}</span>
            <span className="hx-f-tick" aria-hidden="true">
              {field.state === 'review' ? '' : '✓'}
            </span>
          </div>
        ))}
      </div>

      {counts && (
        <div className="hx-app-foot">
          <div className="hx-counts">
            <span>
              <b>{counts.detected}</b> fields detected
            </span>
            <span>
              <b>{counts.filled}</b> filled from your profile
            </span>
            <span>
              <b data-tone="amber">{counts.review}</b> need you
            </span>
          </div>
          <span className="hx-stat" data-tone="warn">
            Review application
          </span>
        </div>
      )}
    </div>
  );
}

const REPEATED = [
  'First name',
  'Last name',
  'Email',
  'Phone',
  'Current company',
  'Experience',
  'LinkedIn',
  'Portfolio',
  'Resume',
  'Notice period',
  'Current CTC',
  'Expected CTC',
  'Preferred location',
  'Work authorisation',
];

const STEPS = [
  {
    n: '01',
    kicker: 'Detect',
    title: 'BanApply knows when you are applying.',
    body: 'Open a supported application and the panel reads what the form is asking for, then tells you how much of it your profile already answers.',
    note: '14 application fields recognised',
  },
  {
    n: '02',
    kicker: 'Fill',
    title: 'Repetitive fields disappear first.',
    body: 'Name, email, phone, company, experience, links, notice period, resume. It fills what it is confident about and leaves the rest — a blank you notice beats a wrong answer you do not.',
    note: '9 of 14 handled · 5 need you',
  },
  {
    n: '03',
    kicker: 'Remember',
    title: 'Answer it once.',
    body: 'Anything you type by hand is offered back to your profile, keyed to the question. The next form that asks it in different words already has your answer waiting.',
    note: 'Saved answer found',
  },
] as const;

const PLATFORMS = [
  {
    name: 'LinkedIn',
    sub: 'Easy Apply',
    state: 'live',
    caps: ['Profile fields', 'Resume', 'Screening questions', 'Auto-capture'],
  },
  {
    name: 'Naukri',
    sub: 'Chatbot apply',
    state: 'live',
    caps: ['Notice period', 'Current CTC', 'Expected CTC', 'Experience', 'Resume'],
  },
  { name: 'Indeed', sub: 'Quick apply', state: 'live', caps: ['Profile fields', 'Resume'] },
  {
    name: 'Greenhouse',
    sub: 'Opt-in from the popup',
    state: 'beta',
    caps: ['Application form', 'Resume attach', 'Screening dropdowns'],
  },
  {
    name: 'Lever · Ashby · Workday',
    sub: 'Adapters written, not yet driven on a live posting',
    state: 'next',
    caps: [],
  },
] as const;

const BADGE = { live: 'Live', beta: 'Beta', next: 'Next' } as const;

export function Home() {
  useSeo({
    title: 'Job Application Autofill & Job Tracker',
    description:
      'Save time on repetitive job applications with BanApply. Autofill common fields, attach your resume, reuse saved answers and keep your applications organised from one Chrome extension.',
    path: '/',
    structuredData: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          name: SITE.name,
          applicationCategory: 'BrowserApplication',
          operatingSystem: 'Chrome',
          url: SITE_URL,
          description:
            'Chrome extension that autofills repetitive job application fields, attaches your resume, reuses saved screening answers and tracks every application.',
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
    <div className="hx">
      {/* 02 ------------------------------ hero ---------------------------- */}
      <section className="hx-hero">
        <div className="hx-veil" aria-hidden="true">
          {[0, 1, 2, 3].map((col) => (
            <div className="hx-veil-col" key={col}>
              {[...REPEATED, ...REPEATED].map((word, i) => (
                <span key={`${word}-${i}`}>{word.toUpperCase()}</span>
              ))}
            </div>
          ))}
        </div>

        <div className="hx-wrap">
          <div className="hx-hero-grid">
            <Reveal immediate>
              <p className="hx-stat">BanApply is ready</p>

              <h1 className="hx-h1" style={{ marginTop: 18 }}>
                You found the job.
                <br />
                <em>Don’t do the data entry.</em>
              </h1>

              <p className="hx-p">
                BanApply fills repetitive job application fields, attaches your resume, remembers
                answers you have already written, and keeps your applications organised.
              </p>

              <div className="hx-cta-row">
                <a className="hx-btn hx-btn--primary" href={SITE.chromeStoreUrl}>
                  Add BanApply to Chrome <span aria-hidden="true">→</span>
                </a>
                <Link className="hx-btn hx-btn--ghost" to="/copilot">
                  See it in action
                </Link>
              </div>

              <p className="hx-micro">Free to get started · No card required</p>
            </Reveal>

            <Reveal immediate>
              <ApplicationForm
                url="linkedin.com/jobs/view/3901234567 — Easy Apply"
                role="Senior Software Engineer"
                meta="Acme Technologies · LinkedIn"
                fields={HERO_FIELDS}
                counts={{ detected: 11, filled: 9, review: 2 }}
              />
            </Reveal>
          </div>
        </div>
      </section>

      {/* 03 --------------------------- repetition ------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">The busywork</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              You already wrote this. Yesterday. And the day before.
            </h2>
          </Reveal>

          <Reveal className="hx-repeat" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <div className="hx-repeat-row" key={row}>
                {REPEATED.map((field) => (
                  <span className="hx-chip" key={`${row}-${field}`}>
                    {field}
                  </span>
                ))}
              </div>
            ))}
          </Reveal>

          <Reveal className="hx-collapse">
            <p className="hx-stat">One profile</p>
            <h2 className="hx-h2" style={{ maxWidth: '14ch' }}>
              Tell BanApply <em>once</em>.
            </h2>
          </Reveal>
        </div>
      </section>

      {/* 04 --------------------------- one profile ------------------------ */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <h2 className="hx-h2 hx-h2--wide">One profile. Fewer forms.</h2>
            <p className="hx-p">
              Your common application information lives in one place and is reused whenever you
              apply — instead of being retyped, re-uploaded and re-remembered on every job site.
            </p>
          </Reveal>

          <div className="hx-profile-grid">
            <Reveal className="hx-panel">
              <p className="hx-panel-head">BanApply profile</p>

              <div className="hx-group">
                <h4>Personal</h4>
                <div>
                  <span>Name</span>
                  <b>Ritesh Kumar</b>
                </div>
                <div>
                  <span>Email</span>
                  <b>ritesh@example.com</b>
                </div>
                <div>
                  <span>Location</span>
                  <b>Bengaluru</b>
                </div>
              </div>

              <div className="hx-group">
                <h4>Professional</h4>
                <div>
                  <span>Current company</span>
                  <b>Nimbus Labs</b>
                </div>
                <div>
                  <span>Experience</span>
                  <b>3 years</b>
                </div>
                <div>
                  <span>LinkedIn</span>
                  <b>/in/example</b>
                </div>
              </div>

              <div className="hx-group">
                <h4>Application</h4>
                <div>
                  <span>Notice period</span>
                  <b>30 days</b>
                </div>
                <div>
                  <span>Expected CTC</span>
                  <b>₹—</b>
                </div>
                <div>
                  <span>Resume</span>
                  <b>ritesh-kumar-cv.pdf</b>
                </div>
                <div>
                  <span>Saved answers</span>
                  <b>14</b>
                </div>
              </div>
            </Reveal>

            <Reveal className="hx-targets" delay={1}>
              {[
                { name: 'LinkedIn', note: 'Easy Apply, resume, screening questions', state: 'live' },
                { name: 'Naukri', note: 'CTC, notice period, experience, resume', state: 'live' },
                { name: 'Indeed', note: 'Quick apply, profile fields, resume', state: 'live' },
                { name: 'Greenhouse', note: 'In beta — switch it on from the popup', state: 'live' },
                { name: 'Lever · Ashby · Workday', note: 'Planned', state: 'planned' },
              ].map((target) => (
                <div className="hx-target" key={target.name} data-state={target.state}>
                  <div>
                    <b>{target.name}</b>
                    <small>{target.note}</small>
                  </div>
                  <span className="hx-stat" style={{ fontSize: 10.5 }}>
                    {target.state === 'planned' ? 'Planned' : 'Uses your profile'}
                  </span>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </section>

      {/* 05 -------------------------- scroll story ------------------------ */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">How it works</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Detect. Fill. Remember.
            </h2>
          </Reveal>

          <div className="hx-story">
            <div className="hx-steps">
              {STEPS.map((step) => (
                <Reveal className="hx-step" key={step.n} as="article">
                  <p className="hx-step-n">
                    {step.n} / {step.kicker.toUpperCase()}
                  </p>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <span className="hx-step-note">◆ {step.note}</span>
                </Reveal>
              ))}
            </div>

            <div className="hx-story-stage">
              <ApplicationForm
                url="boards.greenhouse.io/acme/jobs/4812 — Application"
                role="Product Engineer"
                meta="Acme · Remote"
                fields={[
                  { label: 'Full name', value: 'Ritesh Kumar', state: 'filled' },
                  { label: 'Email', value: 'ritesh@example.com', state: 'filled' },
                  { label: 'Phone', value: '+91 98••• ••210', state: 'filled' },
                  { label: 'Resume', value: 'ritesh-kumar-cv.pdf', state: 'filled' },
                  { label: 'Experience', value: '3 years', state: 'filled' },
                  { label: 'Work authorisation', value: 'Needs your answer', state: 'review' },
                ]}
                counts={{ detected: 14, filled: 9, review: 5 }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 06 ---------------------------- LinkedIn -------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">LinkedIn Easy Apply</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Easy Apply should <em>actually be easy</em>.
            </h2>
            <p className="hx-p">
              The form is short and you have filled it a hundred times. BanApply completes the
              contact step from your profile, attaches your resume, and stops at anything it cannot
              answer for you.
            </p>
          </Reveal>

          <Reveal className="hx-mt">
            <ApplicationForm
              url="linkedin.com/jobs/view/3901234567"
              role="Frontend Developer"
              meta="Easy Apply · Contact information"
              fields={[
                { label: 'Name', value: 'Ritesh Kumar', state: 'filled' },
                { label: 'Email', value: 'ritesh@example.com', state: 'filled' },
                { label: 'Phone', value: '+91 98••• ••210', state: 'filled' },
                { label: 'Resume', value: 'ritesh-kumar-cv.pdf', state: 'filled' },
                { label: 'Years of experience', value: '3', state: 'filled' },
                { label: 'Screening questions', value: '3 detected — 1 needs you', state: 'review' },
              ]}
              counts={{ detected: 9, filled: 8, review: 1 }}
            />
          </Reveal>
        </div>
      </section>

      {/* 07 ----------------------------- Naukri --------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">Naukri</p>
            <h2 className="hx-h2 hx-h2--wide" style={{ marginTop: 16 }}>
              Built for the questions Indian job seekers see every day.
            </h2>
            <p className="hx-p">
              Notice period, current CTC, expected CTC, total and relevant experience — the fields
              every Indian application asks for and no global tool bothers to learn.
            </p>
          </Reveal>

          <Reveal className="hx-mt">
            <ApplicationForm
              url="naukri.com — Apply"
              role="Full Stack Developer"
              meta="Naukri · Chatbot apply"
              fields={[
                { label: 'Current CTC', value: '₹8,00,000', state: 'filled' },
                { label: 'Expected CTC', value: '₹12,00,000', state: 'filled' },
                { label: 'Notice period', value: '30 days', state: 'filled' },
                { label: 'Current location', value: 'Bengaluru', state: 'filled' },
                { label: 'Total experience', value: '3 years', state: 'filled' },
                { label: 'Resume', value: 'ritesh-kumar-cv.pdf', state: 'filled' },
              ]}
              counts={{ detected: 8, filled: 6, review: 2 }}
            />
          </Reveal>

          <Reveal>
            <h2 className="hx-h2 hx-h2--wide" style={{ marginTop: 'clamp(36px, 5vw, 64px)' }}>
              Stop entering your notice period for the hundredth time.
            </h2>
          </Reveal>
        </div>
      </section>

      {/* 08 -------------------------- saved answers ----------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <div className="hx-cols">
            <Reveal>
              <p className="hx-stat">Saved answers</p>
              <h2 className="hx-h2" style={{ marginTop: 16 }}>
                Haven’t I answered this already?
              </h2>
              <p className="hx-p">
                Every form words it differently. BanApply recognises the question, offers back what
                you wrote last time, and waits for you to approve it. It never writes one for you.
              </p>
            </Reveal>

            <Reveal className="hx-answers">
              <p className="hx-ask">“Why do you want this role?”</p>
              <p className="hx-ask">“What excites you about this opportunity?”</p>
              <p className="hx-ask">“Why are you interested in joining us?”</p>

              <div className="hx-found">
                <header>
                  <span>◆ Similar question detected</span>
                  <span>Saved answer 07</span>
                </header>
                <p>The answer you wrote once, offered back in your own words.</p>
                <footer>
                  <span className="hx-mini" data-primary="">
                    Use answer
                  </span>
                  <span className="hx-mini">Edit</span>
                </footer>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 09 + 10 ------------------------ tracker -------------------------- */}
      <section className="hx-light">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">◆ Application tracked</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Your job search, without the spreadsheet.
            </h2>
            <p className="hx-p">
              Applying is not the end. Every application records itself as you send it, and keeps
              telling you something afterwards.
            </p>
          </Reveal>

          <Reveal className="hx-table">
            <div className="hx-tr hx-tr--head">
              <span>Company</span>
              <span>Role</span>
              <span>Source</span>
              <span>Applied</span>
              <span>Status</span>
              <span>Job posting</span>
            </div>

            {[
              ['Razorpay', 'Frontend Engineer', 'Naukri', 'Yesterday', 'Screening', 'live', 'Live'],
              ['Stripe', 'Backend Engineer', 'LinkedIn', '4 days ago', 'Applied', 'live', 'Live'],
              ['Vlink', 'Full Stack Developer', 'Naukri', '6 days ago', 'Applied', 'dup', 'Duplicate'],
              ['Startup X', 'Product Engineer', 'Career site', '2 weeks ago', 'Applied', 'closed', 'Closed'],
            ].map(([company, role, source, applied, status, tone, posting]) => (
              <div className="hx-tr" key={`${company}-${role}`}>
                <b>{company}</b>
                <span>{role}</span>
                <span>{source}</span>
                <span>{applied}</span>
                <span>{status}</span>
                <span className="hx-dot" data-s={tone}>
                  {posting}
                </span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 11 ---------------------------- duplicate ------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <div className="hx-cols">
            <Reveal>
              <p className="hx-stat">Duplicate guard</p>
              <h2 className="hx-h2" style={{ marginTop: 16 }}>
                Four links. One job.
              </h2>
              <p className="hx-p">
                The same role sits on the board, the company site, the ATS and an aggregator.
                BanApply recognises them as one opportunity — before you spend the afternoon
                applying to it again.
              </p>
            </Reveal>

            <Reveal>
              <div className="hx-links">
                <code>linkedin.com/jobs/784521</code>
                <code>naukri.com/job/928144</code>
                <code>acme.com/careers/102</code>
                <code>aggregator.com/job/19283</code>
              </div>

              <div className="hx-match">
                <span className="hx-stat" data-tone="warn">
                  Match found
                </span>
                <div className="hx-match-rows">
                  <span>Same company</span>
                  <span>Same job title</span>
                  <span>Same location</span>
                </div>
                <strong style={{ fontSize: 15 }}>You already applied 6 days ago.</strong>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 12 ------------------------- posting status ----------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <div className="hx-cols">
            <Reveal>
              <p className="hx-stat">Posting status</p>
              <h2 className="hx-h2" style={{ marginTop: 16 }}>
                Know when the opportunity disappears.
              </h2>
              <p className="hx-p">
                Saved postings are re-checked on a schedule. A role coming down is the difference
                between waiting on a reply and waiting on nothing — and silence never tells you
                which one it is.
              </p>
            </Reveal>

            <Reveal>
              <div className="hx-sweep">
                {[
                  ['Product Designer', 'live', 'Live'],
                  ['Backend Engineer', 'live', 'Live'],
                  ['Data Analyst', 'closed', 'Posting closed'],
                  ['Software Developer', 'live', 'Live'],
                ].map(([role, tone, label]) => (
                  <div className="hx-sweep-row" key={role}>
                    <span>{role}</span>
                    <span className="hx-dot" data-s={tone}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="hx-sweep-tally">
                <span>◆ Checked on a schedule</span>
                <span>
                  <b>20</b> saved
                </span>
                <span>
                  <b>18</b> still live
                </span>
                <span>
                  <b>2</b> closed
                </span>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* 13 ---------------------------- platforms ------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">Supported sites</p>
            <h2 className="hx-h2 hx-h2--wide" style={{ marginTop: 16 }}>
              Where BanApply works today — and where it goes next.
            </h2>
            <p className="hx-p">
              Each platform needs its own adapter, so support grows one at a time. Live means driven
              against real postings. Nothing here is listed as working before it does.
            </p>
          </Reveal>

          <Reveal className="hx-rail">
            {PLATFORMS.map((platform) => (
              <div className="hx-stop" key={platform.name}>
                <p className="hx-stop-name">
                  {platform.name}
                  <small>{platform.sub}</small>
                </p>
                <div className="hx-caps">
                  {platform.caps.map((cap) => (
                    <span key={cap}>{cap}</span>
                  ))}
                </div>
                <span className="hx-badge" data-s={platform.state}>
                  {BADGE[platform.state]}
                </span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 14 ---------------------------- extension ------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">In the browser</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Lives where you apply.
            </h2>
            <p className="hx-p">
              No copying job links into another website. The panel opens on the posting you are
              already looking at.
            </p>
          </Reveal>

          <Reveal className="hx-ext">
            <div className="hx-ext-page">
              <h4>Senior Software Engineer</h4>
              <p>Acme Technologies · Bengaluru · Posted 2 days ago</p>
              <p style={{ marginTop: 14 }}>
                About the role — you have read this far and decided you want it. The next fifteen
                minutes are the part BanApply removes.
              </p>
            </div>

            <div className="hx-ext-panel">
              <p className="hx-stat">Application detected</p>
              <div className="hx-ext-line">
                <span>Fields</span>
                <b>12</b>
              </div>
              <div className="hx-ext-line">
                <span>Profile</span>
                <b>Ready</b>
              </div>
              <div className="hx-ext-line">
                <span>Resume</span>
                <b>Ready</b>
              </div>
              <div className="hx-ext-line">
                <span>Saved answers</span>
                <b>14</b>
              </div>
              <span className="hx-btn hx-btn--primary" style={{ height: 44, justifyContent: 'center' }}>
                Fill application
              </span>
              <span className="hx-btn hx-btn--ghost" style={{ height: 44, justifyContent: 'center' }}>
                Open tracker
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 15 ------------------------------ trust --------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">Control</p>
            <h2 className="hx-h2 hx-h2--wide" style={{ marginTop: 16 }}>
              Powerful where it should be. Limited where it shouldn’t.
            </h2>
          </Reveal>

          <div className="hx-cols">
            <Reveal>
              <p className="hx-stat" style={{ marginBottom: 14 }}>
                BanApply does
              </p>
              <ul className="hx-list" data-kind="can">
                <li>Recognise the application form on supported sites</li>
                <li>Fill the fields your profile answers</li>
                <li>Attach the resume you uploaded</li>
                <li>Offer back answers you have already written</li>
                <li>Record the application in your tracker</li>
                <li>Submit — after you press Apply, and only then</li>
              </ul>
            </Reveal>

            <Reveal delay={1}>
              <p className="hx-stat" style={{ marginBottom: 14 }}>
                BanApply does not
              </p>
              <ul className="hx-list" data-kind="wont">
                <li>Submit while a required question is unanswered</li>
                <li>Fill government IDs, bank or card numbers</li>
                <li>Touch passwords, anywhere</li>
                <li>Overwrite a field you filled yourself</li>
                <li>Run on sites you have not granted it</li>
                <li>Invent an answer your profile cannot support</li>
              </ul>

              <div className="hx-locked" aria-hidden="true">
                {['Password', 'Payment details', 'National ID'].map((label) => (
                  <div key={label}>
                    <span>{label}</span>
                    <b />
                    <span>◆ blocked</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal>
            <p className="hx-micro" style={{ marginTop: 22 }}>
              Skills matching runs entirely in your browser — the posting never leaves the page. The{' '}
              <Link to="/privacy" style={{ color: 'var(--hx-amber)' }}>
                privacy policy
              </Link>{' '}
              sets out what is stored and where.
            </p>
          </Reveal>
        </div>
      </section>

      {/* 16 --------------------------- old vs new ------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <div className="hx-cols">
            <Reveal>
              <p className="hx-stat">The old way</p>
              <div className="hx-vs" data-side="old">
                {[
                  'Find job',
                  'Open application',
                  'Type name',
                  'Type email',
                  'Type phone',
                  'Upload resume',
                  'Enter experience',
                  'Enter notice period',
                  'Enter CTC',
                  'Answer questions',
                  'Open spreadsheet',
                  'Repeat',
                ].map((step, i) => (
                  <div key={`${step}-${i}`}>{step}</div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={1}>
              <p className="hx-stat">With BanApply</p>
              <div className="hx-vs" data-side="new">
                <div>Find job</div>
                <div>Open application</div>
                <div data-mark="">◆ BanApply</div>
                <div>Review</div>
                <div>Apply</div>
                <div>Tracked</div>
              </div>
            </Reveal>
          </div>

          <Reveal>
            <h2 className="hx-h2" style={{ marginTop: 'clamp(36px, 5vw, 64px)' }}>
              Same opportunities. <em>Less admin.</em>
            </h2>
          </Reveal>
        </div>
      </section>

      {/* 17 ------------------------- feature index ------------------------ */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">What it does</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Everything, in one list.
            </h2>
          </Reveal>

          <Reveal className="hx-index" as="dl">
            {[
              ['Autofill', 'Fill the repetitive application fields from one profile.'],
              ['Resume', 'Attach the right resume without finding the file again.'],
              ['Memory', 'Reuse the screening answers you have already written.'],
              ['Tracking', 'Applications record themselves as you send them.'],
              ['Duplicates', 'Warn you before you apply to the same job twice.'],
              ['Status', 'Tell you when a saved posting comes down.'],
              ['Profile', 'Keep reusable application information in one place.'],
            ].map(([term, description]) => (
              <div className="hx-index-row" key={term}>
                <dt>{term}</dt>
                <dd>{description}</dd>
              </div>
            ))}
          </Reveal>

          {/*
            Product proof, not social proof. There are no users to count yet, so
            nothing here counts any — it describes what a form contains, which
            is true of every form on every job site.
          */}
          <Reveal>
            <div className="hx-sweep-tally" style={{ marginTop: 34 }}>
              <span>A typical application</span>
              <span>
                <b>12</b> repetitive fields
              </span>
              <span>
                <b>1</b> resume upload
              </span>
              <span>
                <b>3</b> familiar questions
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 18 ------------------------------- FAQ ---------------------------- */}
      <section className="hx-section">
        <div className="hx-wrap">
          <Reveal>
            <p className="hx-stat">Questions</p>
            <h2 className="hx-h2" style={{ marginTop: 16 }}>
              Questions before your next application?
            </h2>
          </Reveal>

          <Reveal className="hx-faq">
            {FAQS.map((faq) => (
              <details key={faq.q}>
                <summary>{faq.q}</summary>
                {faq.a.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      {/* 19 ---------------------------- final CTA ------------------------- */}
      <Reveal className="hx-final" as="section">
        <div className="hx-wrap">
          <p className="hx-stat">Your next application</p>

          <h1 className="hx-h1" style={{ marginTop: 18, fontSize: 'clamp(2.6rem, 6vw, 5.6rem)' }}>
            Shouldn’t start <em>from zero</em>.
          </h1>

          <div className="hx-cta-row">
            <a className="hx-btn hx-btn--primary" href={SITE.chromeStoreUrl}>
              Add BanApply to Chrome <span aria-hidden="true">→</span>
            </a>
            <Link className="hx-btn hx-btn--ghost" to="/copilot">
              See how it works
            </Link>
          </div>

          <p className="hx-micro">Set up your profile once. Use it on your next application.</p>
        </div>

        <span className="hx-diamond" aria-hidden="true" />
      </Reveal>
    </div>
  );
}
