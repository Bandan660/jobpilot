import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPLICATION_STATUS,
  EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_LABELS,
  daysBetween,
  formatDate,
  type Application,
  type ApplicationStatus,
  type EmploymentType,
  type Resume,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { LoadingSpinner } from '../../components/LoadingSpinner.js';
import { ArchiveIcon, BuildingIcon, PinIcon, SearchIcon } from '../../components/icons.js';
import { SourceMark } from '../../components/SourceMark.js';
import { downloadCsv, parseCsv, toCsv } from '../../csv.js';
import { usePageMeta } from '../../usePageMeta.js';
import { BoardView } from './BoardView.js';
import { ResumeBuilderLink } from '../../components/ResumeBuilderLink.js';

/**
 * The tracker.
 *
 * A row is a small dashboard: where the application is in the pipeline, how
 * long it has been silent, and — the part no other tracker shows — whether the
 * posting is still up.
 */

/** Pipeline order for the stage track. Terminal statuses sit outside it. */
const STAGES: { status: ApplicationStatus; label: string }[] = [
  { status: 'SAVED', label: 'Saved' },
  { status: 'APPLIED', label: 'Applied' },
  { status: 'SCREEN', label: 'Screen' },
  { status: 'INTERVIEW', label: 'Interview' },
  { status: 'OFFER', label: 'Offer' },
];

const TERMINAL: ApplicationStatus[] = ['REJECTED', 'GHOSTED', 'WITHDRAWN', 'ACCEPTED'];

type Tab = 'active' | 'archived';
type Sort = 'recent' | 'applied' | 'company' | 'stage';
type View = 'list' | 'board';

const VIEW_KEY = 'jobpilot.trackerView';

export function ApplicationsPage() {
  usePageMeta('Job tracker', undefined, '/dashboard/applications');

  const [tab, setTab] = useState<Tab>('active');
  const [view, setView] = useState<View>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY)) === 'board'
      ? 'board'
      : 'list'
  );
  const [applications, setApplications] = useState<Application[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ApplicationStatus | 'ALL'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [starredOnly, setStarredOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listApplications({
        q: query || undefined,
        status: view === 'board' || status === 'ALL' ? undefined : status,
        archived: tab === 'archived' ? 'true' : 'false',
        starred: starredOnly ? 'true' : undefined,
        from: from || undefined,
        to: to || undefined,
        sort,
      });
      setApplications(list.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [query, status, view, tab, starredOnly, from, to, sort]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [load, query]);

  /** Optimistic, reverting on failure — the row must feel immediate. */
  async function update(id: string, patch: Partial<Application>) {
    const previous = applications;
    setApplications((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    try {
      await api.updateApplication(id, patch as never);
      // Archiving removes the row from the current tab, so refetch.
      if ('archived' in patch) void load();
    } catch (err) {
      setApplications(previous);
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  const filtersActive =
    query !== '' || status !== 'ALL' || from !== '' || to !== '' || starredOnly;

  function clearFilters() {
    setQuery('');
    setStatus('ALL');
    setFrom('');
    setTo('');
    setStarredOnly(false);
  }

  return (
    <div className="dash">
      <header className="tracker-head">
        <h1>Your job tracker</h1>
        <Toolbar
          applications={applications}
          onImported={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      </header>

      {/* Count, tabs and filters read as one control strip rather than three
          stacked blocks with gaps between them. */}
      <div className="tracker-bar">
        <span className="tracker-count">
          <strong>{applications.length}</strong>
          {filtersActive ? ' matching' : tab === 'archived' ? ' archived' : ' active'}
        </span>

        <div className="tracker-tabs" role="tablist">
          {(['active', 'archived'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className="tracker-tab"
              data-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>

        <div className="view-toggle" role="group" aria-label="View">
          {(['list', 'board'] as View[]).map((v) => (
            <button
              key={v}
              data-selected={view === v}
              onClick={() => {
                setView(v);
                localStorage.setItem(VIEW_KEY, v);
              }}
            >
              {v === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="banner-error">{error}</p>}
      {notice && <p className="banner-note">{notice}</p>}

      <section className="filters">
        <div className="search-field">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search roles or companies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {view === 'list' && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus | 'ALL')}
          >
            <option value="ALL">All statuses</option>
            {APPLICATION_STATUS.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        )}

        <label className="date-field">
          <span>Applied from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-field">
          <span>until</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        {view === 'list' && (
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Recently updated</option>
          <option value="applied">Date applied</option>
          <option value="company">Company</option>
          <option value="stage">Furthest stage</option>
        </select>
        )}

        <button
          className="ob-chip"
          data-selected={starredOnly}
          onClick={() => setStarredOnly(!starredOnly)}
        >
          ★ Starred
        </button>

        {filtersActive && (
          <button className="btn-link" onClick={clearFilters}>
            Clear
          </button>
        )}
      </section>

      {loading ? (
        <LoadingSpinner label="Loading application pipeline…" />
      ) : applications.length === 0 ? (
        <section className="panel">
          <p className="muted">
            {filtersActive
              ? 'Nothing matches those filters.'
              : tab === 'archived'
                ? 'Nothing archived yet.'
                : 'Nothing tracked yet. Apply with the extension installed and it lands here, or import a spreadsheet you already keep.'}
          </p>
          {/* Only on the genuinely-empty state. Someone whose filters matched
              nothing already has applications and does not need a resume. */}
          {!filtersActive && tab !== 'archived' && (
            <p className="muted cross-promo">
              Still writing the resume?{' '}
              <ResumeBuilderLink path="/resume/new" medium="tracker_empty">
                Build a free ATS-friendly one on HireFresher
              </ResumeBuilderLink>
              .
            </p>
          )}
        </section>
      ) : view === 'board' ? (
        <BoardView
          applications={applications}
          onMove={(id, next) => update(id, { status: next })}
        />
      ) : (
        <ul className="tracker-list">
          {applications.map((app) => (
            <TrackerRow key={app.id} app={app} onUpdate={update} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  applications,
  onImported,
}: {
  applications: Application[];
  onImported: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  async function handleImport(file: File) {
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());

      if (parsed.missing.length > 0) {
        onImported(
          `Could not import: no ${parsed.missing.join(' or ')} column found. Rename the column and try again.`
        );
        return;
      }
      if (parsed.rows.length === 0) {
        onImported('That file had headers but no rows.');
        return;
      }

      const result = await api.importApplications(parsed.rows);
      const parts = [`Imported ${result.imported}`];
      if (result.skipped) parts.push(`${result.skipped} already tracked`);
      if (result.failures.length) parts.push(`${result.failures.length} could not be read`);
      if (parsed.ignored.length) parts.push(`ignored columns: ${parsed.ignored.join(', ')}`);
      onImported(`${parts.join(' · ')}.`);
    } catch (err) {
      onImported(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="tracker-toolbar">
      <button
        className="btn btn-ghost"
        onClick={() => downloadCsv('jobpilot-applications.csv', toCsv(applications))}
        disabled={applications.length === 0}
      >
        Export CSV
      </button>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
      <button className="btn btn-ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
        {busy ? 'Importing…' : 'Import CSV'}
      </button>

      <button className="btn btn-primary" onClick={() => setAdding(true)}>
        Add application
      </button>

      {adding && (
        <AddApplication
          companies={[...new Set(applications.map((a) => a.company.name))].sort()}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            onImported('Application added.');
          }}
        />
      )}
    </div>
  );
}

function AddApplication({
  companies,
  onClose,
  onAdded,
}: {
  companies: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType | ''>('FULL_TIME');
  const [status, setStatus] = useState<ApplicationStatus>('APPLIED');
  const [appliedAt, setAppliedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect the default so the common case needs no interaction.
  useEffect(() => {
    api
      .listResumes()
      .then(({ resumes: list }) => {
        setResumes(list);
        setResumeId(list.find((r) => r.isDefault)?.id ?? '');
      })
      .catch(() => setResumes([]));
  }, []);

  // Saved jobs have not been applied to, so a date would be a lie.
  const needsDate = status !== 'SAVED';

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.createApplication({
        title: title.trim(),
        company: company.trim(),
        location: location.trim() || null,
        jobUrl: jobUrl.trim() || null,
        employmentType: employmentType || null,
        resumeId: resumeId || null,
        status,
        appliedAt: needsDate && appliedAt ? new Date(appliedAt).toISOString() : null,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Add application"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Add application</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <p className="muted">For anything the extension did not capture.</p>

        <label className="ob-field">
          Position title <span className="req">*</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="ob-field">
          Company <span className="req">*</span>
          {/* Suggests companies already in the tracker so the same employer
              does not end up under three spellings. Free text either way. */}
          <input
            list="known-companies"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <datalist id="known-companies">
            {companies.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>

        <div className="modal-grid">
          <label className="ob-field">
            Location
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>

          <label className="ob-field">
            Job type
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType | '')}
            >
              <option value="">Not specified</option>
              {EMPLOYMENT_TYPE.map((type) => (
                <option key={type} value={type}>
                  {EMPLOYMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="ob-field">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
            >
              {APPLICATION_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="ob-field" data-disabled={resumes.length === 0}>
            Resume sent
            <select
              value={resumeId}
              disabled={resumes.length === 0}
              onChange={(e) => setResumeId(e.target.value)}
            >
              <option value="">
                {resumes.length === 0 ? 'None uploaded' : 'Not recorded'}
              </option>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fileName}
                  {r.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="ob-field" data-disabled={!needsDate}>
            Date applied
            <input
              type="date"
              value={needsDate ? appliedAt : ''}
              disabled={!needsDate}
              onChange={(e) => setAppliedAt(e.target.value)}
            />
          </label>
        </div>

        <label className="ob-field">
          Posting URL
          <input
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://…"
          />
          <small>Adding it lets jobpilot tell you when the posting comes down.</small>
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving || !title.trim() || !company.trim()}
          >
            {saving ? 'Adding…' : 'Add application'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Deterministic tint from the company name, so a logo-less row is still scannable. */
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;

  return (
    <span className="avatar" data-tone={String(hash % 5)} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

function TrackerRow({
  app,
  onUpdate,
}: {
  app: Application;
  onUpdate: (id: string, patch: Partial<Application>) => void;
}) {
  const currentIndex = STAGES.findIndex((s) => s.status === app.status);
  const isTerminal = TERMINAL.includes(app.status);

  // Stage dates are derived rather than stored per stage: created for saved,
  // appliedAt for applied, and the first employer response for whichever stage
  // came after it.
  const dateFor = (index: number): string | null => {
    if (index === 0) return app.createdAt;
    if (index === 1) return app.appliedAt;
    return app.firstResponseAt;
  };

  const silentDays =
    app.status === 'APPLIED' && !app.firstResponseAt && app.appliedAt
      ? daysBetween(app.appliedAt)
      : null;

  return (
    <li className="tracker-row" data-archived={app.archived}>
      <button
        className="star"
        data-on={app.starred}
        aria-label={app.starred ? 'Unstar' : 'Star'}
        onClick={() => onUpdate(app.id, { starred: !app.starred })}
      >
        {app.starred ? '★' : '☆'}
      </button>

      <Avatar name={app.company.name} />

      <div className="tracker-main">
        {app.jobUrl ? (
          <a className="role-link" href={app.jobUrl} target="_blank" rel="noreferrer noopener">
            {app.title}
          </a>
        ) : (
          <span className="tracker-title">{app.title}</span>
        )}
        <div className="tracker-meta">
          <span className="meta-item">
            <BuildingIcon />
            {app.company.name}
          </span>
          {/* Where it was applied. Second, because the company is the thing
              being scanned for; the platform is what you check once you have
              found the row. */}
          <SourceMark jobUrl={app.jobUrl} ats={app.ats} />
          {app.location && (
            <span className="meta-item">
              <PinIcon />
              {app.location}
            </span>
          )}
          {app.postingStatus !== 'LIVE' && app.postingStatus !== 'UNKNOWN' && (
            <span className="lamp lamp-down">{app.postingStatus.toLowerCase()}</span>
          )}
          {silentDays !== null && silentDays >= 10 && (
            <span className="lamp lamp-wait">silent {silentDays}d</span>
          )}
        </div>
      </div>

      {/* The stage track. Terminal statuses replace it, because "rejected" is
          not a point on the pipeline — it is where the pipeline stopped. */}
      {isTerminal ? (
        <div className="stage-terminal">
          <span className={`lamp lamp-${app.status === 'ACCEPTED' ? 'live' : 'down'}`}>
            {app.status.toLowerCase()}
          </span>
        </div>
      ) : (
        <ol className="stage-track" aria-label="Stage">
          {STAGES.map((stage, index) => {
            const reached = index <= currentIndex;
            const date = reached ? dateFor(index) : null;
            return (
              <li key={stage.status} data-reached={reached} data-current={index === currentIndex}>
                <span className="stage-label">{stage.label}</span>
                <span className="stage-dot" />
                <span className="stage-date">{date ? formatDate(date) : ''}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="tracker-actions">
        <select
          aria-label={`Status for ${app.title}`}
          value={app.status}
          onChange={(e) => onUpdate(app.id, { status: e.target.value as ApplicationStatus })}
        >
          {APPLICATION_STATUS.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          title={app.archived ? 'Restore' : 'Archive'}
          aria-label={app.archived ? 'Restore' : 'Archive'}
          onClick={() => onUpdate(app.id, { archived: !app.archived })}
        >
          <ArchiveIcon />
        </button>
      </div>
    </li>
  );
}
