import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  daysBetween,
  profileReadiness,
  type Application,
  type FunnelStats,
  type Profile,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { usePageMeta } from '../../usePageMeta.js';

/**
 * Dashboard home.
 *
 * Answers one question: what should I do next? Everything here is either a
 * measurement of the search or an item needing action. Deliberately absent
 * from the reference layout: job matches, resume and cover-letter generation,
 * premium upsells, referral credit, and a streak counter. This product makes
 * applying faster and keeps the record straight; a dashboard selling other
 * things is a dashboard that has stopped doing that.
 */
export function DashboardHome() {
  usePageMeta('Dashboard', undefined, '/dashboard');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [alerts, setAlerts] = useState<{ id: string; title: string; postingStatus: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getProfile(), api.funnel(), api.listApplications(), api.deadPostings()])
      .then(([p, f, list, dead]) => {
        if (cancelled) return;
        setProfile(p.profile);
        setStats(f);
        setApplications(list.applications);
        setAlerts(dead.alerts);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="centered">Loading…</p>;

  const readiness = profile ? profileReadiness(profile) : null;
  const firstName = profile?.firstName;

  const thisWeek = applications.filter(
    (a) => a.appliedAt && daysBetween(a.appliedAt) < 7
  ).length;

  // Applied, no reply, and quiet long enough to be worth a nudge.
  const stale = applications.filter(
    (a) =>
      a.status === 'APPLIED' &&
      !a.firstResponseAt &&
      a.appliedAt &&
      daysBetween(a.appliedAt) >= 10 &&
      a.postingStatus === 'LIVE'
  );

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>{firstName ? `Welcome back, ${firstName}` : 'Welcome back'}</h1>
        <p className="muted">
          {applications.length === 0
            ? 'Nothing tracked yet. Install the extension and apply to a job — it lands here on its own.'
            : `${applications.length} applications tracked · ${thisWeek} this week`}
        </p>
      </header>

      {error && <p className="banner-error">{error}</p>}

      <Setup profile={profile} readiness={readiness} hasApplications={applications.length > 0} />

      {stats && <Readouts stats={stats} />}

      <NeedsAttention alerts={alerts} stale={stale} />

      <RecentApplications applications={applications} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Setup checklist. Hidden once everything is done rather than lingering at
 * 100% — a permanent checklist is decoration.
 */
function Setup({
  profile,
  readiness,
  hasApplications,
}: {
  profile: Profile | null;
  readiness: ReturnType<typeof profileReadiness> | null;
  hasApplications: boolean;
}) {
  if (!profile || !readiness) return null;

  const items = [
    {
      label: 'Complete your profile',
      detail:
        readiness.missing.length > 0
          ? `${readiness.missing.length} fields autofill still can't answer`
          : 'Everything autofill needs is set',
      done: readiness.missing.length === 0,
      to: '/dashboard/profile',
    },
    {
      label: 'Install the extension',
      detail: 'Capture and autofill only work with it installed',
      done: hasApplications,
      to: '/copilot',
    },
    {
      label: 'Apply to something',
      detail: 'Your first application will appear here by itself',
      done: hasApplications,
      to: '/copilot',
    },
  ];

  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;

  return (
    <section className="panel setup">
      <div className="panel-head">
        <h2>Finish setting up</h2>
        <span className="cell-dim">
          {done}/{items.length}
        </span>
      </div>

      <div className="setup-bar">
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>

      <ul className="setup-list">
        {items.map((item) => (
          <li key={item.label} data-done={item.done}>
            <span className="setup-tick" aria-hidden="true">
              {item.done ? '✓' : ''}
            </span>
            <div>
              <Link to={item.to}>{item.label}</Link>
              <p className="muted">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
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

/** The one section that says "do something", so it sits above the pipeline. */
function NeedsAttention({
  alerts,
  stale,
}: {
  alerts: { id: string; title: string; postingStatus: string }[];
  stale: Application[];
}) {
  if (alerts.length === 0 && stale.length === 0) return null;

  return (
    <section className="panel panel-alert">
      <div className="panel-head">
        <h2>Needs attention</h2>
        <span className="lamp lamp-down">{alerts.length + stale.length}</span>
      </div>

      <ul className="alert-list">
        {alerts.map((alert) => (
          <li key={alert.id}>
            <strong>{alert.title}</strong>
            <span className="lamp lamp-down">{alert.postingStatus.toLowerCase()}</span>
            <span className="cell-dim">posting gone — worth asking directly</span>
          </li>
        ))}
        {stale.map((app) => (
          <li key={app.id}>
            <strong>{app.title}</strong>
            <span className="cell-dim">
              {app.company.name} · silent {daysBetween(app.appliedAt!)}d
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentApplications({ applications }: { applications: Application[] }) {
  const recent = applications.slice(0, 6);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recent applications</h2>
        <Link className="btn-link" to="/dashboard/applications">
          See all
        </Link>
      </div>

      {recent.length === 0 ? (
        <p className="muted">
          Nothing yet. <Link to="/copilot">Install the extension</Link> and your next application
          will appear here on its own.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Applied</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((app) => (
                <tr key={app.id}>
                  <td>{app.title}</td>
                  <td>{app.company.name}</td>
                  <td className="cell-dim">
                    {app.appliedAt ? `${daysBetween(app.appliedAt)}d ago` : '—'}
                  </td>
                  <td>
                    <span
                      className={`lamp lamp-${
                        app.postingStatus === 'LIVE' ? 'live' : app.postingStatus === 'UNKNOWN' ? 'wait' : 'down'
                      }`}
                    >
                      {app.status.toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
