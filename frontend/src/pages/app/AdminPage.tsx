import { useEffect, useState } from 'react';
import type { AdminMetrics } from '@jobpilot/shared';
import { api } from '../../api.js';
import { usePageMeta } from '../../usePageMeta.js';

/**
 * Service-wide instrument panel.
 *
 * Aggregates only — see `services/admin.ts`. There is nothing on this page
 * that names a user, and that is the feature rather than a limitation: it
 * answers "is the thing working and growing" without anyone's job search
 * passing through a second pair of eyes.
 *
 * Guarded server-side by the admin allowlist. This component's own handling of
 * a refusal is presentational: the API is the thing that says no.
 */
export function AdminPage() {
  usePageMeta('Admin', undefined, '/dashboard/admin');

  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .adminMetrics()
      .then((data) => !cancelled && setMetrics(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="centered">Loading…</p>;

  if (error) {
    return (
      <div className="dash">
        <header className="dash-hero">
          <div className="dash-hero-copy">
            <h1>Admin</h1>
            <p>{error}</p>
          </div>
        </header>
      </div>
    );
  }

  if (!metrics) return null;

  const { users, applications, activatedUsers } = metrics;

  /* Activation rate is the one derived figure worth showing: signups are easy
     and applications are the thing the product exists to produce. */
  const activation = users.total > 0 ? Math.round((activatedUsers / users.total) * 100) : 0;

  return (
    <div className="dash">
      <header className="dash-hero">
        <div className="dash-hero-copy">
          <h1>Admin</h1>
          <p>Service totals. No personal data — counts only.</p>
        </div>
      </header>

      <section className="panel">
        <div className="readouts">
          <Readout label="Users" value={users.total} sub={`+${users.last7} this week`} />
          <Readout
            label="Applications"
            value={applications.total}
            sub={`+${applications.last7} this week`}
          />
          <Readout
            label="Activated"
            value={`${activation}%`}
            sub={`${activatedUsers} have applied at least once`}
          />
          <Readout
            label="With a resume"
            value={applications.withResume}
            sub="applications carrying an attachment"
          />
        </div>
      </section>

      <Signups points={metrics.signups} />

      <div className="dash-split">
        <div className="dash-col">
          <Breakdown title="Platforms" rows={metrics.platforms.map((p) => [p.ats, p.count])} />
        </div>
        <div className="dash-col">
          <Breakdown title="Application status" rows={metrics.statuses.map((s) => [s.status, s.count])} />
          <Breakdown title="Postings" rows={metrics.postings.map((p) => [p.status, p.count])} />
        </div>
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="readout">
      <span className="readout-label">{label}</span>
      <strong className="readout-value">{value}</strong>
      <span className="readout-sub">{sub}</span>
    </div>
  );
}

/**
 * Thirty days of signups as a bar row.
 *
 * Deliberately not a charting library: this is one series of small integers,
 * and the marketing site's own budget rule about not adding dependencies for
 * motion applies just as well to a page only one person will ever open.
 */
function Signups({ points }: { points: AdminMetrics['signups'] }) {
  const peak = Math.max(1, ...points.map((p) => p.count));
  const total = points.reduce((sum, p) => sum + p.count, 0);

  return (
    <section className="panel">
      <h2 className="panel-title">Signups — last 30 days ({total})</h2>

      <div className="admin-bars">
        {points.map((point) => (
          <div
            key={point.date}
            className="admin-bar"
            style={{ height: `${Math.max(2, (point.count / peak) * 100)}%` }}
            title={`${point.date}: ${point.count}`}
          />
        ))}
      </div>
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>

      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <table className="table">
          <tbody>
            {rows.map(([label, count]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="cell-dim">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
