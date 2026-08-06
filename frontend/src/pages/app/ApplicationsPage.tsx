import { useCallback, useEffect, useState } from 'react';
import {
  APPLICATION_STATUS,
  daysBetween,
  type Application,
  type ApplicationStatus,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { usePageMeta } from '../../usePageMeta.js';

/** The full pipeline. Search, filter, and change stage. */
export function ApplicationsPage() {
  usePageMeta('Applications', undefined, '/dashboard/applications');

  const [applications, setApplications] = useState<Application[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'ALL'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q: string, status: ApplicationStatus | 'ALL') => {
    setError(null);
    try {
      const list = await api.listApplications({
        q: q || undefined,
        status: status === 'ALL' ? undefined : status,
      });
      setApplications(list.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced so typing does not fire a request per keystroke.
    const handle = setTimeout(() => void load(query, statusFilter), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, statusFilter, load]);

  async function changeStatus(id: string, status: ApplicationStatus) {
    // Optimistic: the row updates immediately and reverts only if the API rejects.
    const previous = applications;
    setApplications((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));

    try {
      await api.updateStatus(id, status);
    } catch (err) {
      setApplications(previous);
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>Applications</h1>
        <p className="muted">
          Everything captured by the extension, plus anything you added by hand.
        </p>
      </header>

      {error && <p className="banner-error">{error}</p>}

      <section className="panel">
        <div className="panel-head">
          <div className="filter-row">
            <input
              type="search"
              placeholder="Search role or company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | 'ALL')}
            >
              <option value="ALL">All statuses</option>
              {APPLICATION_STATUS.map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <span className="cell-dim">{applications.length} shown</span>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : applications.length === 0 ? (
          <p className="muted">
            {query || statusFilter !== 'ALL'
              ? 'Nothing matches that filter.'
              : 'Nothing tracked yet. Apply to a job with the extension installed and it lands here.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Applied</th>
                  <th>Posting</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td>
                      {app.jobUrl ? (
                        <a
                          className="role-link"
                          href={app.jobUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {app.title}
                        </a>
                      ) : (
                        app.title
                      )}
                    </td>
                    <td>{app.company.name}</td>
                    <td className="cell-dim">
                      {app.appliedAt ? `${daysBetween(app.appliedAt)}d ago` : '—'}
                    </td>
                    <td>
                      <span
                        className={`lamp lamp-${
                          app.postingStatus === 'LIVE'
                            ? 'live'
                            : app.postingStatus === 'UNKNOWN'
                              ? 'wait'
                              : 'down'
                        }`}
                      >
                        {app.postingStatus.toLowerCase()}
                      </span>
                    </td>
                    <td>
                      <select
                        aria-label={`Status for ${app.title}`}
                        value={app.status}
                        onChange={(e) =>
                          void changeStatus(app.id, e.target.value as ApplicationStatus)
                        }
                      >
                        {APPLICATION_STATUS.map((status) => (
                          <option key={status} value={status}>
                            {status.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
