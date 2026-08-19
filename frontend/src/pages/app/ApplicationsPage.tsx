import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeHref } from '../../safeHref.js';
import {
  APPLICATION_STATUS,
  EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_LABELS,
  REFERRAL_ACCEPTED,
  REFERRAL_ACTION_LABEL,
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABELS,
  referralDue,
  relativeTime,
  daysBetween,
  formatDate,
  type Application,
  type ApplicationStatus,
  type Contact,
  type EmploymentType,
  type ReferralStatus,
  type Resume,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { LoadingSpinner } from '../../components/LoadingSpinner.js';
import {
  ArchiveIcon,
  BuildingIcon,
  PeopleIcon,
  PinIcon,
  SearchIcon,
} from '../../components/icons.js';
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

/**
 * Rows per page in the list view.
 *
 * The list was capped at the API's default of 200 and rendered every one of
 * them, so a year of applying is 200 rows of DOM under a filter strip and the
 * thing you tracked in March is a scroll away with no way to ask for it.
 *
 * 25 because a tracker row is a small dashboard rather than a line — stage
 * track, silence counter, posting status — and about that many fit a laptop
 * screen before the filters scroll out of reach.
 *
 * The board is deliberately not paged. Its columns are the pipeline, and a
 * page boundary through them shows an arbitrary slice of each stage while
 * looking like the whole of it.
 */
const PAGE_SIZE = 25;

/**
 * Page size for the CSV export, which is a different question from the one the
 * pager answers.
 *
 * Export means "everything matching these filters", and it meant that before
 * this page had pages — so it pulls the whole result set in chunks rather than
 * writing out whichever 25 rows happen to be on screen. 500 is the API's
 * documented ceiling for `limit`; the loop is what covers the rest.
 */
const EXPORT_PAGE = 500;

/** Refuses to loop forever if the server ever stops shrinking the page. */
const EXPORT_MAX_ROWS = 20_000;

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
  const [page, setPage] = useState(0);
  /** Rows matching the filters, not rows on screen. What the pager counts. */
  const [total, setTotal] = useState(0);

  /** Everything the server needs to answer "which rows", minus which page. */
  const filters = useMemo(
    () => ({
      q: query || undefined,
      status: view === 'board' || status === 'ALL' ? undefined : status,
      archived: (tab === 'archived' ? 'true' : 'false') as 'true' | 'false',
      starred: (starredOnly ? 'true' : undefined) as 'true' | undefined,
      from: from || undefined,
      to: to || undefined,
      sort,
    }),
    [query, status, view, tab, starredOnly, from, to, sort]
  );

  /*
   * Page 0 whenever the filters change, decided during render rather than in an
   * effect.
   *
   * An effect would run after this render has already fired `load` with the
   * old page against the new filters — one wasted request, and a visible flash
   * of page 4 of a result set that now has one page. Setting state during
   * render re-renders before any effect runs, so the fetch below only ever sees
   * a page that belongs to these filters.
   */
  const filterKey = JSON.stringify(filters);
  const lastFilterKey = useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    lastFilterKey.current = filterKey;
    if (page !== 0) setPage(0);
  }

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listApplications({
        ...filters,
        // The board is not paged: it needs every row to fill its columns.
        ...(view === 'board' ? {} : { limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      });

      /*
       * An empty page that is not the first one means the rows underneath moved
       * — archiving the last row of the last page does it — and `total` cannot
       * correct us, because the server has no row to hang the count on. Step
       * back and let the effect refetch rather than showing "nothing matches
       * those filters" over a tracker that is full.
       */
      if (list.applications.length === 0 && page > 0) {
        setPage((p) => Math.max(0, p - 1));
        return;
      }

      setApplications(list.applications);
      setTotal(view === 'board' ? list.applications.length : list.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filters, view, page]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [load, query]);

  /**
   * Every row matching the current filters, for the CSV export.
   *
   * Paged through rather than asked for in one request, because `limit` is
   * capped at 500 server-side and someone with more than that applied is
   * exactly the person who wants a spreadsheet of it.
   */
  const fetchAllMatching = useCallback(async () => {
    const rows: Application[] = [];

    for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE) {
      const batch = await api.listApplications({ ...filters, limit: EXPORT_PAGE, offset });
      rows.push(...batch.applications);
      if (batch.applications.length < EXPORT_PAGE || rows.length >= batch.total) break;
    }

    return rows;
  }, [filters]);

  /**
   * A change the server has already accepted, applied without a round trip.
   *
   * Separate from `update` because that one PATCHes the application; referral
   * counts are computed by the server from a different table and arrive as a
   * side effect of the dialog's own writes. Sending them back as an
   * application patch would be asking the API to store a derived number.
   */
  const patchLocal = useCallback((id: string, patch: Partial<Application>) => {
    setApplications((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

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
          exportRows={fetchAllMatching}
          onImported={(msg) => {
            setNotice(msg);
            void load();
          }}
        />
      </header>

      {/* Count, tabs and filters read as one control strip rather than three
          stacked blocks with gaps between them. */}
      <div className="tracker-bar">
        {/* The total, never the page length: "25 active" under a pager reading
            "1–25 of 213" is the page describing itself as the tracker. */}
        <span className="tracker-count">
          <strong>{total}</strong>
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
        <>
          <ul className="tracker-list">
            {applications.map((app) => (
              <TrackerRow key={app.id} app={app} onUpdate={update} onLocalPatch={patchLocal} />
            ))}
          </ul>
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Previous / next, and where you are.
 *
 * Numbered page links were the alternative and are worse here: the tracker is
 * sorted by recency, so page 7 is not a place anyone means to go — it is
 * "further back than I have looked". The range readout is the part that
 * answers the real question, which is how much is behind you.
 *
 * Renders nothing when everything fits on one page. A pager under a list of
 * four says the list is truncated when it is not.
 */
function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <nav className="pager" aria-label="Application pages">
      <button
        className="btn btn-ghost"
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
      >
        ← Newer
      </button>

      {/*
        aria-live, because paging replaces the whole list without moving focus:
        a screen reader is otherwise told nothing happened.
      */}
      <span className="pager-range" aria-live="polite">
        {first}–{last} of {total}
      </span>

      <button
        className="btn btn-ghost"
        onClick={() => onPage(Math.min(lastPage, page + 1))}
        disabled={page >= lastPage}
      >
        Older →
      </button>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  applications,
  exportRows,
  onImported,
}: {
  applications: Application[];
  /** Every row matching the current filters — not the page on screen. */
  exportRows: () => Promise<Application[]>;
  onImported: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);

  /*
   * Fetches before it writes the file.
   *
   * The export used to serialise whatever the page held, which was every row
   * the API returned and so happened to be right. Once the list is paged, the
   * same code silently exports 25 rows and calls the file
   * jobpilot-applications.csv — a wrong answer that looks like a complete one,
   * and one nobody checks until they need it.
   */
  async function handleExport() {
    setExporting(true);
    try {
      const rows = await exportRows();
      if (rows.length === 0) {
        onImported('Nothing to export with those filters.');
        return;
      }
      downloadCsv('jobpilot-applications.csv', toCsv(rows));
    } catch (err) {
      onImported(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

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
        onClick={() => void handleExport()}
        disabled={exporting || applications.length === 0}
      >
        {exporting ? 'Exporting…' : 'Export CSV'}
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

  /*
   * Escape closes, and the tracker behind the backdrop holds still.
   *
   * Both were missing here while the profile and resume dialogs already had
   * them, and the second one is what made this look broken: the only thing
   * that moved when the form was too tall for the screen was the list of
   * applications underneath it, so the wheel appeared to do nothing to the
   * dialog and the Add button stayed off the bottom of the page.
   */
  /*
   * Through a ref, so the lock is taken once on mount and released once on
   * unmount. `onClose` is an inline arrow in the parent and so has a new
   * identity every render — depending on it directly would tear the lock down
   * and rebuild it each time the tracker behind the dialog re-rendered.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
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

        <div className="modal-body">
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
        </div>

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
  onLocalPatch,
}: {
  app: Application;
  onUpdate: (id: string, patch: Partial<Application>) => void;
  /** Applies a change the server already accepted, without a round trip. */
  onLocalPatch: (id: string, patch: Partial<Application>) => void;
}) {
  const [referralsOpen, setReferralsOpen] = useState(false);
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
          <a className="role-link" href={safeHref(app.jobUrl)} target="_blank" rel="noreferrer noopener">
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
        {/* The count is the reason this is not a menu item. "Have I asked
            anyone here yet" is the question the row has to answer at a glance;
            hiding it one click deep makes it a thing to remember to check. */}
        <button
          className="icon-btn referral-btn"
          data-has={(app.referralCount ?? 0) > 0}
          title={referralButtonLabel(app)}
          aria-label={referralButtonLabel(app)}
          onClick={() => setReferralsOpen(true)}
        >
          <PeopleIcon />
          {app.referralCount ? <span className="referral-n">{app.referralCount}</span> : null}
        </button>
        <button
          className="icon-btn"
          title={app.archived ? 'Restore' : 'Archive'}
          aria-label={app.archived ? 'Restore' : 'Archive'}
          onClick={() => onUpdate(app.id, { archived: !app.archived })}
        >
          <ArchiveIcon />
        </button>
      </div>

      {referralsOpen && (
        <ReferralsDialog
          app={app}
          onClose={() => setReferralsOpen(false)}
          onCounts={(counts) => onLocalPatch(app.id, counts)}
        />
      )}
    </li>
  );
}

/** Spoken by a screen reader and shown on hover, so it says the whole state. */
function referralButtonLabel(app: Application): string {
  const total = app.referralCount ?? 0;
  if (total === 0) return `Referrals for ${app.title} — none logged`;

  const accepted = app.referralAccepted ?? 0;
  const asks = total === 1 ? '1 ask' : `${total} asks`;
  return `Referrals for ${app.title} — ${asks}, ${accepted} accepted`;
}

/**
 * One line saying what an ask needs, or nothing.
 *
 * `referralDue` is the same rule the toolbar badge and the LinkedIn card read.
 * Three surfaces deciding independently is how they drift, and a dashboard
 * disagreeing with the badge above it is a dashboard that stops being checked.
 */
function DueFlag({ referral }: { referral: Contact }) {
  const due = referralDue(referral);

  if (due.action && due.isDue) {
    return (
      <span className="ref-due">
        {REFERRAL_ACTION_LABEL[due.action]}
        {due.overdueDays > 0 ? ` · ${due.overdueDays}d overdue` : ' · due now'}
      </span>
    );
  }

  // Only after a follow-up. One nudge is the limit, so this is an ending
  // rather than a task — said quietly, and never as a number anywhere.
  if (due.stale) return <span className="ref-quiet">no reply</span>;

  if (due.action && due.dueAt) {
    return <span className="ref-quiet">{REFERRAL_ACTION_LABEL[due.action].toLowerCase()} {relativeTime(due.dueAt)}</span>;
  }

  return null;
}

/* -------------------------------------------------------------------------- */

/**
 * Referral asks for one application.
 *
 * Phase 1 of docs/REFERRALS.md: the record. The user does the sending on
 * LinkedIn themselves and logs what they did here, which is why there is a
 * form and no "send" button anywhere in this file.
 *
 * The company is deliberately not a field. It is the application's company and
 * the user already told the system once; every field that can be filled in
 * advance is one fewer reason to abandon the form halfway.
 */
function ReferralsDialog({
  app,
  onClose,
  onCounts,
}: {
  app: Application;
  onClose: () => void;
  onCounts: (counts: { referralCount: number; referralAccepted: number }) => void;
}) {
  const [referrals, setReferrals] = useState<Contact[] | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [status, setStatus] = useState<'INVITED' | 'ASKED'>('INVITED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    api
      .listReferrals(app.id)
      .then(setReferrals)
      .catch((err) => {
        setReferrals([]);
        setError(err instanceof Error ? err.message : 'Could not load referrals');
      });
  }, [app.id]);

  /** Counts are recomputed from the list, never incremented, so they cannot drift. */
  const publish = (list: Contact[]) => {
    setReferrals(list);
    onCounts({
      referralCount: list.length,
      referralAccepted: list.filter((r) => REFERRAL_ACCEPTED.includes(r.status)).length,
    });
  };

  async function add() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { referral } = await api.addReferral(app.id, {
        name: name.trim(),
        role: role.trim() || null,
        linkedinUrl: linkedinUrl.trim() || null,
        status,
      });
      publish([...(referrals ?? []), referral]);
      setName('');
      setRole('');
      setLinkedinUrl('');
      setStatus('INVITED');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(referral: Contact, next: ReferralStatus) {
    const previous = referrals ?? [];
    publish(previous.map((r) => (r.id === referral.id ? { ...r, status: next } : r)));
    try {
      const { referral: saved } = await api.updateReferral(app.id, referral.id, { status: next });
      publish(previous.map((r) => (r.id === referral.id ? saved : r)));
    } catch (err) {
      publish(previous);
      setError(err instanceof Error ? err.message : 'Could not update');
    }
  }

  async function remove(referral: Contact) {
    const previous = referrals ?? [];
    publish(previous.filter((r) => r.id !== referral.id));
    try {
      await api.deleteReferral(app.id, referral.id);
    } catch (err) {
      publish(previous);
      setError(err instanceof Error ? err.message : 'Could not remove');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={`Referrals for ${app.title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Referrals</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <p className="muted ref-context">
            {app.title} — {app.company.name}
          </p>

          <div className="ref-form">
            <h3 className="ref-heading">Log an ask</h3>
            <p className="muted ref-hint">
              Send the connection request on LinkedIn yourself, then record it here.
            </p>

            <label className="ob-field">
              Person <span className="req">*</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Who did you contact?"
                autoFocus
              />
            </label>

            <div className="modal-grid">
              <label className="ob-field">
                Their role
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="Engineering Manager"
                />
              </label>

              <label className="ob-field">
                Profile URL
                <input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="linkedin.com/in/…"
                />
              </label>
            </div>

            {/* Two starting points, because a first-degree contact skips the
                invitation entirely and a form that cannot say so gets lied to. */}
            <fieldset className="ref-status">
              <legend>What did you do?</legend>
              <label>
                <input
                  type="radio"
                  name="ref-start"
                  checked={status === 'INVITED'}
                  onChange={() => setStatus('INVITED')}
                />
                Sent a connection request
              </label>
              <label>
                <input
                  type="radio"
                  name="ref-start"
                  checked={status === 'ASKED'}
                  onChange={() => setStatus('ASKED')}
                />
                Already connected — sent the message
              </label>
            </fieldset>

            <div className="ref-form-actions">
              <button
                className="btn btn-primary"
                onClick={() => void add()}
                disabled={saving || !name.trim()}
              >
                {saving ? 'Saving…' : 'Add ask'}
              </button>
            </div>
          </div>

          <h3 className="ref-heading">
            Logged {referrals && referrals.length > 0 ? `(${referrals.length})` : ''}
          </h3>

          {referrals === null ? (
            <p className="muted">Loading…</p>
          ) : referrals.length === 0 ? (
            <p className="muted">
              Nothing logged for this application yet. The first one you add shows on the
              tracker row.
            </p>
          ) : (
            <ul className="ref-list">
              {referrals.map((referral) => (
                <li key={referral.id} className="ref-item">
                  <div className="ref-who">
                    {referral.linkedinUrl ? (
                      <a
                        href={safeHref(referral.linkedinUrl)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {referral.name}
                      </a>
                    ) : (
                      <span className="ref-name">{referral.name}</span>
                    )}
                    <span className="ref-sub">
                      {referral.role ? `${referral.role} · ` : ''}
                      {REFERRAL_STATUS_LABELS[referral.status] ?? referral.status} on{' '}
                      {formatDate(referral.statusAt)}
                    </span>
                    <DueFlag referral={referral} />
                  </div>

                  <select
                    aria-label={`Status for ${referral.name}`}
                    value={referral.status}
                    onChange={(e) => void changeStatus(referral, e.target.value as ReferralStatus)}
                  >
                    {REFERRAL_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {REFERRAL_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>

                  <button
                    className="icon-btn"
                    title={`Remove ${referral.name}`}
                    aria-label={`Remove ${referral.name}`}
                    onClick={() => void remove(referral)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
