/**
 * Dashboard fragments for the tracker page.
 *
 * Each one is a view of the same product surface, reusing the real component
 * classes (.mock-row, .lamp, .readout) so these cannot drift from the app.
 * All decorative — the surrounding prose carries the meaning.
 */

function Frame({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="panel-mock" aria-hidden="true">
      <div className="panel-mock-bar">
        <span>{title}</span>
        <span>{meta}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * The comparison the "no more spreadsheets" claim rests on.
 *
 * Left: a real spreadsheet decaying — statuses frozen at whatever they were on
 * the day they were typed, then columns thinning out, then rows simply
 * stopping. Right: the same roles, current.
 *
 * The animation is the point. Rows fade to stale on a stagger, which is how
 * spreadsheets actually fail: not all at once, but a bit more each week.
 */
export function SpreadsheetDecay() {
  const sheetRows = [
    { company: 'Stripe', role: 'Senior Backend Eng', status: 'applied', date: '12 Jun' },
    { company: 'Linear', role: 'SWE, Platform', status: 'applied', date: '18 Jun' },
    { company: 'Vercel', role: 'Full Stack Eng', status: '?', date: '24 Jun' },
    { company: 'Ramp', role: 'Backend Eng', status: '', date: '' },
    { company: '', role: '', status: '', date: '' },
  ];

  const liveRows = [
    { company: 'Stripe', role: 'Senior Backend Eng', lamp: 'live', state: 'interview', age: '21d' },
    { company: 'Linear', role: 'SWE, Platform', lamp: 'live', state: 'screen', age: '9d' },
    { company: 'Vercel', role: 'Full Stack Eng', lamp: 'down', state: 'removed', age: '34d' },
    { company: 'Ramp', role: 'Backend Eng', lamp: 'wait', state: 'applied', age: '41d' },
    { company: 'Cloudflare', role: 'Staff Eng, API', lamp: 'wait', state: 'applied', age: '27d' },
  ] as const;

  return (
    <div className="versus" aria-hidden="true">
      <div className="versus-side" data-kind="sheet">
        <div className="versus-head">
          <span className="versus-label">A spreadsheet</span>
          <span className="versus-stamp">last edited 19 days ago</span>
        </div>

        <div className="sheet">
          <div className="sheet-row sheet-head">
            <span>Company</span>
            <span>Role</span>
            <span>Status</span>
            <span>Applied</span>
          </div>
          {sheetRows.map((row, index) => (
            <div className="sheet-row" data-index={index} key={row.company || `blank-${index}`}>
              <span>{row.company || ' '}</span>
              <span>{row.role}</span>
              <span>{row.status}</span>
              <span>{row.date}</span>
            </div>
          ))}
        </div>

        <p className="versus-foot">Frozen at whatever you last typed.</p>
      </div>

      <div className="versus-divider">
        <span />
      </div>

      <div className="versus-side" data-kind="live">
        <div className="versus-head">
          <span className="versus-label">jobpilot</span>
          <span className="versus-stamp" data-live="true">
            <i />
            updated 2 minutes ago
          </span>
        </div>

        <div className="panel-mock">
          {liveRows.map((row) => (
            <div className="mock-row" key={row.company}>
              <div className="mock-role">
                {row.role}
                <div className="mock-company">{row.company}</div>
              </div>
              <span className="mock-age">{row.age}</span>
              <span className={`lamp lamp-${row.lamp}`}>{row.state}</span>
            </div>
          ))}
        </div>

        <p className="versus-foot">Current, because nobody had to remember.</p>
      </div>
    </div>
  );
}

/** Everything in one place. */
export function MockPipeline() {
  const rows = [
    { role: 'Senior Backend Engineer', company: 'Stripe', age: '21d', lamp: 'live', state: 'interview' },
    { role: 'Software Engineer, Platform', company: 'Linear', age: '9d', lamp: 'live', state: 'screen' },
    { role: 'Full Stack Engineer', company: 'Vercel', age: '34d', lamp: 'down', state: 'removed' },
    { role: 'Backend Engineer', company: 'Ramp', age: '41d', lamp: 'wait', state: 'applied' },
    { role: 'Staff Engineer, API', company: 'Cloudflare', age: '27d', lamp: 'wait', state: 'applied' },
    { role: 'Product Engineer', company: 'Retool', age: '52d', lamp: 'down', state: 'rejected' },
  ] as const;

  return (
    <Frame title="Pipeline" meta="48 tracked">
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
    </Frame>
  );
}

/** Response rate, timing, and the funnel. */
export function MockInsights() {
  const tiles = [
    { label: 'Tracked', value: '48', emphasis: false },
    { label: 'Response', value: '31%', emphasis: false },
    { label: 'Median reply', value: '6.5d', emphasis: false },
    { label: 'Ghosted', value: '9', emphasis: true },
  ];

  const funnel = [
    { label: 'Applied', width: 100, count: 48 },
    { label: 'Response', width: 31, count: 15 },
    { label: 'Screen', width: 19, count: 9 },
    { label: 'Interview', width: 10, count: 5 },
  ];

  return (
    <Frame title="Insights" meta="last 90 days">
      <div className="mock-pad">
        <div className="readouts mock-readouts">
          {tiles.map((tile) => (
            <div className="readout" data-emphasis={tile.emphasis} key={tile.label}>
              <span className="readout-value">{tile.value}</span>
              <span className="readout-label">{tile.label}</span>
            </div>
          ))}
        </div>

        <div className="funnel mock-funnel">
          {funnel.map((row) => (
            <div className="funnel-row" key={row.label}>
              <span className="funnel-label">{row.label}</span>
              <div className="funnel-bar">
                <div className="funnel-fill" style={{ width: `${row.width}%` }} />
              </div>
              <span className="funnel-count">{row.count}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Notes, contacts, and the event history on one application. */
export function MockNotes() {
  return (
    <Frame title="Senior Backend Engineer" meta="Stripe">
      <div className="mock-pad">
        <div className="mock-contacts">
          <span className="mock-chip">
            <span className="mock-avatar">JR</span>
            Jordan Reyes · recruiter
          </span>
          <span className="mock-chip">
            <span className="mock-avatar">SP</span>
            Sam Park · referral
          </span>
        </div>

        <div className="mock-note">
          <span className="mock-note-date">14 Jul</span>
          <p>Screen went well. They asked about the payments migration in detail.</p>
        </div>
        <div className="mock-note">
          <span className="mock-note-date">09 Jul</span>
          <p>Recruiter said onsite loop is 4 rounds, one system design.</p>
        </div>

        <div className="mock-timeline">
          <span>
            <b />
            applied · 21d ago
          </span>
          <span>
            <b />
            screen · 14d ago
          </span>
          <span>
            <b data-now="true" />
            interview · today
          </span>
        </div>
      </div>
    </Frame>
  );
}

/** Bookmarked roles saved from anywhere. */
export function MockBookmarks() {
  const saved = [
    { role: 'Product Engineer', company: 'Retool', tag: 'saved' },
    { role: 'Backend Engineer', company: 'Supabase', tag: 'saved' },
    { role: 'Engineer, Dev Tools', company: 'Ashby', tag: 'saved' },
    { role: 'Platform Engineer', company: 'Neon', tag: 'saved' },
  ];

  return (
    <Frame title="Saved" meta="4 bookmarked">
      <div className="mock-pad mock-grid">
        {saved.map((job) => (
          <div className="mock-card" key={job.role}>
            <span className="mock-card-role">{job.role}</span>
            <span className="mock-company">{job.company}</span>
            <span className="lamp lamp-wait">{job.tag}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** Importing applications you made before signing up. */
export function MockImport() {
  const rows = [
    { csv: 'Figma, Product Engineer, 2026-05-02', ok: true },
    { csv: 'Datadog, Backend Engineer, 2026-05-11', ok: true },
    { csv: 'Airtable, Platform Eng, 2026-06-01', ok: true },
    { csv: '—, Software Engineer, ?', ok: false },
  ];

  return (
    <Frame title="Import" meta="applications.csv">
      <div className="mock-pad">
        {rows.map((row) => (
          <div className="mock-import-row" key={row.csv} data-ok={row.ok}>
            <span className="mock-import-mark">{row.ok ? '✓' : '!'}</span>
            <span className="mock-import-text">{row.csv}</span>
          </div>
        ))}
        <p className="mock-import-foot">3 ready · 1 needs a company name</p>
      </div>
    </Frame>
  );
}
