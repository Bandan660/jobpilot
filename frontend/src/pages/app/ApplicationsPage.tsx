import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPLICATION_STATUS,
  daysBetween,
  formatDate,
  type Application,
  type ApplicationStatus,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { downloadCsv, parseCsv, toCsv } from '../../csv.js';
import { usePageMeta } from '../../usePageMeta.js';

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

export function ApplicationsPage() {
  usePageMeta('Job tracker', undefined, '/dashboard/applications');

  const [tab, setTab] = useState<Tab>('active');
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
        status: status === 'ALL' ? undefined : status,
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
  }, [query, status, tab, starredOnly, from, to, sort]);

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
        <div>
          <h1>Your job tracker</h1>
          <p className="muted">
            {applications.length} {tab === 'archived' ? 'archived' : 'active'}
            {filtersActive ? ' matching your filters' : ''}
          </p>
        </div>

        <Toolbar applications={applications} onImported={(msg) => { setNotice(msg); void load(); }} />
      </header>

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

      {error && <p className="banner-error">{error}</p>}
      {notice && <p className="banner-note">{notice}</p>}

      <section className="panel filters">
        <input
          type="search"
          placeholder="Search roles or companies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | 'ALL')}>
          <option value="ALL">All statuses</option>
          {APPLICATION_STATUS.map((s) => (
            <option key={s} value={s}>
              {s.toLowerCase()}
            </option>
          ))}
        </select>

        <label className="date-field">
          <span>Applied from</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-field">
          <span>until</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Recently updated</option>
          <option value="applied">Date applied</option>
          <option value="company">Company</option>
          <option value="stage">Furthest stage</option>
        </select>

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
        <p className="centered">Loading…</p>
      ) : applications.length === 0 ? (
        <section className="panel">
          <p className="muted">
            {filtersActive
              ? 'Nothing matches those filters.'
              : tab === 'archived'
                ? 'Nothing archived yet.'
                : 'Nothing tracked yet. Apply with the extension installed and it lands here, or import a spreadsheet you already keep.'}
          </p>
        </section>
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

function AddApplication({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('APPLIED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.createApplication({ title, company, jobUrl: jobUrl || null, status });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add');
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add application"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Add an application</h2>
        <p className="muted">For anything the extension did not capture.</p>

        <label className="ob-field">
          Role
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="ob-field">
          Company
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label className="ob-field">
          Posting URL
          <input type="url" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} />
        </label>
        <label className="ob-field">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)}>
            {APPLICATION_STATUS.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving || !title || !company}
          >
            {saving ? 'Adding…' : 'Add'}
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
          <span>{app.company.name}</span>
          {app.location && <span>· {app.location}</span>}
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
          className="btn-link"
          onClick={() => onUpdate(app.id, { archived: !app.archived })}
        >
          {app.archived ? 'Restore' : 'Archive'}
        </button>
      </div>
    </li>
  );
}
