import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  APPLICATION_STATUS,
  daysBetween,
  type Application,
  type ApplicationStatus,
  type FunnelStats,
} from '@jobpilot/shared';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { ThemeToggle } from '../theme.js';
import { Brand } from '../components/SiteChrome.js';

type DeadAlert = { id: string; title: string; postingStatus: string; appliedAt: string | null };

export function DashboardPage() {
  const { signOut } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [alerts, setAlerts] = useState<DeadAlert[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      const [list, funnel, dead] = await Promise.all([
        api.listApplications({ q: q || undefined }),
        api.funnel(),
        api.deadPostings(),
      ]);
      setApplications(list.applications);
      setStats(funnel);
      setAlerts(dead.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const handle = setTimeout(() => void load(query), query ? 300 : 0);
    return () => clearTimeout(handle);
  }, [query, load]);

  async function changeStatus(id: string, status: ApplicationStatus) {
    // Optimistic: the row updates immediately and reverts only if the API rejects.
    const previous = applications;
    setApplications((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));

    try {
      await api.updateStatus(id, status);
      setStats(await api.funnel());
    } catch (err) {
      setApplications(previous);
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <Brand />
        <ThemeToggle />
        <Link className="btn btn-ghost" to="/">
          Site
        </Link>
        <button className="btn btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      {error && <p className="banner-error">{error}</p>}

      {loading ? (
        <p className="centered">Loading your pipeline…</p>
      ) : (
        <>
          {stats && <Readouts stats={stats} />}

          {alerts.length > 0 && (
            <section className="panel panel-alert">
              <div className="panel-head">
                <h2>Postings that went down</h2>
                <span className="lamp lamp-down">{alerts.length} to review</span>
              </div>
              <p className="muted">
                You are still waiting on {alerts.length === 1 ? 'this role' : 'these roles'}, but the
                posting is no longer live — usually filled or frozen. Worth a follow-up.
              </p>
              <ul className="alert-list">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <strong>{alert.title}</strong>
                    <span className={`lamp lamp-down`}>{alert.postingStatus.toLowerCase()}</span>
                    {alert.appliedAt && (
                      <span className="cell-dim">applied {daysBetween(alert.appliedAt)}d ago</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Applications</h2>
              <input
                type="search"
                placeholder="Search role or company…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {applications.length === 0 ? (
              <p className="muted">
                Nothing tracked yet. Install the extension and apply to a job — it lands here on its
                own.
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
                          <PostingLamp status={app.postingStatus} />
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
        </>
      )}
    </div>
  );
}

function Readouts({ stats }: { stats: FunnelStats }) {
  const tiles = [
    { label: 'Tracked', value: String(stats.total), emphasis: false },
    { label: 'Response rate', value: `${Math.round(stats.responseRate * 100)}%`, emphasis: false },
    {
      label: 'Median reply',
      value: stats.medianDaysToResponse != null ? `${stats.medianDaysToResponse}d` : '—',
      emphasis: false,
    },
    // The only tile that ever takes the accent — it is the one that means act.
    { label: 'Likely ghosted', value: String(stats.ghostedCount), emphasis: stats.ghostedCount > 0 },
  ];

  return (
    <div className="readouts">
      {tiles.map((tile) => (
        <div className="readout" data-emphasis={tile.emphasis} key={tile.label}>
          <span className="readout-value">{tile.value}</span>
          <span className="readout-label">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

function PostingLamp({ status }: { status: Application['postingStatus'] }) {
  const tone = status === 'LIVE' ? 'live' : status === 'UNKNOWN' ? 'wait' : 'down';
  return <span className={`lamp lamp-${tone}`}>{status.toLowerCase()}</span>;
}
