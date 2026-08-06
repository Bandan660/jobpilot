import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVE_STATUSES,
  daysBetween,
  formatDate,
  profileReadiness,
  type Application,
  type ApplicationStatus,
  type FunnelStats,
  type Profile,
} from '@jobpilot/shared';
import { api, type ActivityEvent } from '../../api.js';
import {
  AlertIcon,
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  GhostIcon,
  PulseIcon,
  PuzzleIcon,
  ReplyIcon,
  SendIcon,
  StackIcon,
  UserIcon,
} from '../../components/icons.js';
import { usePageMeta } from '../../usePageMeta.js';

/**
 * Dashboard home.
 *
 * Answers one question: what should I do next? Everything here is either a
 * measurement of the search or an item needing action. Deliberately absent
 * from the reference layout: job matches, resume and cover-letter generation,
 * premium upsells, referral credit, and a streak counter. This product makes
 * applying faster and keeps the record straight; a dashboard selling other
 * things has stopped doing that.
 */

/** "1 field", "2 fields" — the plural bug is small and reads as carelessness. */
function plural(count: number, singular: string, plural_ = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural_}`;
}

export function DashboardHome() {
  usePageMeta('Dashboard', undefined, '/dashboard');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<FunnelStats | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [alerts, setAlerts] = useState<{ id: string; title: string; postingStatus: string }[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getProfile(),
      api.funnel(),
      api.listApplications(),
      api.deadPostings(),
      api.activity(),
    ])
      .then(([p, f, list, dead, act]) => {
        if (cancelled) return;
        setProfile(p.profile);
        setStats(f);
        setApplications(list.applications);
        setAlerts(dead.alerts);
        setActivity(act.events);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="centered">Loading…</p>;

  const readiness = profile ? profileReadiness(profile) : null;
  const thisWeek = applications.filter((a) => a.appliedAt && daysBetween(a.appliedAt) < 7).length;
  const lastWeek = applications.filter((a) => {
    if (!a.appliedAt) return false;
    const d = daysBetween(a.appliedAt);
    return d >= 7 && d < 14;
  }).length;

  const live = applications.filter((a) =>
    ACTIVE_STATUSES.includes(a.status as ApplicationStatus)
  ).length;

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
      <header className="dash-hero">
        <div className="dash-hero-copy">
          <h1>{profile?.firstName ? `Welcome back, ${profile.firstName}` : 'Welcome back'}</h1>
          <p>
            {applications.length === 0
              ? 'Nothing tracked yet. Install the extension and apply to a job — it lands here on its own.'
              : 'Everything you have applied to, kept current without you touching it.'}
          </p>
        </div>

        {applications.length > 0 && (
          <div className="dash-hero-stats">
            <div>
              <span>{applications.length}</span>
              <small>tracked</small>
            </div>
            <div>
              <span>{live}</span>
              <small>still live</small>
            </div>
            <div>
              <span>{thisWeek}</span>
              <small>this week</small>
            </div>
          </div>
        )}
      </header>

      {error && <p className="banner-error">{error}</p>}

      <Setup profile={profile} readiness={readiness} hasApplications={applications.length > 0} />

      {stats && <Readouts stats={stats} />}

      <NeedsAttention alerts={alerts} stale={stale} />

      {/* Two columns on wide screens: the pipeline reads as a whole, the
          activity log reads as a stream. They are different shapes of
          information and cramming them into one column wastes the width. */}
      <div className="dash-split">
        <div className="dash-col">
          {stats && <Pipeline stats={stats} total={applications.length} />}
          <ThisWeek thisWeek={thisWeek} lastWeek={lastWeek} />
        </div>

        <div className="dash-col">
          <Activity events={activity} />
        </div>
      </div>

      <RecentApplications applications={applications} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Hidden once complete rather than lingering at 100% — a permanent checklist is decoration. */
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
          ? `${plural(readiness.missing.length, 'field')} autofill still can't answer`
          : 'Everything autofill needs is set',
      done: readiness.missing.length === 0,
      to: '/dashboard/profile',
      cta: 'Fill it in',
      Icon: UserIcon,
    },
    {
      label: 'Install the extension',
      detail: 'Capture and autofill only work with it installed',
      done: hasApplications,
      to: '/copilot',
      cta: 'How it works',
      Icon: PuzzleIcon,
    },
    {
      label: 'Apply to something',
      detail: 'Your first application will appear here by itself',
      done: hasApplications,
      to: '/copilot',
      cta: null,
      Icon: SendIcon,
    },
  ];

  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;

  return (
    <section className="panel setup">
      <Head
        title="Finish setting up"
        tone="a"
        Icon={PuzzleIcon}
        aside={
          <span className="cell-dim">
            {done}/{items.length}
          </span>
        }
      />

      <div className="setup-bar">
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>

      <ul className="setup-list">
        {items.map((item) => (
          <li key={item.label} data-done={item.done}>
            <span className="setup-tick" data-done={item.done} aria-hidden="true">
              {item.done ? '✓' : <item.Icon />}
            </span>
            <div className="setup-body">
              <strong>{item.label}</strong>
              <p className="muted">{item.detail}</p>
            </div>
            {!item.done && item.cta && (
              <Link className="btn btn-ghost setup-cta" to={item.to}>
                {item.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Readouts({ stats }: { stats: FunnelStats }) {
  // Tints are for scanning, not meaning — four identical white boxes are hard
  // to tell apart at a glance. The only one that signals anything is the
  // ghosted tile, which takes the accent when it is non-zero.
  const tiles = [
    { label: 'Tracked', value: String(stats.total), tone: 'a', Icon: StackIcon },
    {
      label: 'Response rate',
      value: `${Math.round(stats.responseRate * 100)}%`,
      tone: 'b',
      Icon: ReplyIcon,
    },
    {
      label: 'Median reply',
      value: stats.medianDaysToResponse != null ? `${stats.medianDaysToResponse}d` : '—',
      tone: 'c',
      Icon: ClockIcon,
    },
    {
      label: 'Likely ghosted',
      value: String(stats.ghostedCount),
      tone: 'd',
      Icon: GhostIcon,
      emphasis: stats.ghostedCount > 0,
    },
  ];

  return (
    <div className="readouts">
      {tiles.map((tile) => (
        <div className="readout" data-emphasis={tile.emphasis} key={tile.label}>
          <span className="tile-icon" data-tone={tile.tone}>
            <tile.Icon />
          </span>
          <span className="readout-value">{tile.value}</span>
          <span className="readout-label">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Small tinted glyph beside a section heading. */
function Head({
  title,
  tone,
  Icon,
  aside,
}: {
  title: string;
  tone: string;
  Icon: (p: { className?: string }) => JSX.Element;
  aside?: React.ReactNode;
}) {
  return (
    <div className="panel-head">
      <h2 className="panel-title">
        <span className="tile-icon tile-icon-sm" data-tone={tone}>
          <Icon />
        </span>
        {title}
      </h2>
      {aside}
    </div>
  );
}

/** Status breakdown. The data was already being fetched and never shown. */
function Pipeline({ stats, total }: { stats: FunnelStats; total: number }) {
  const rows: [ApplicationStatus, string][] = [
    ['SAVED', 'Saved'],
    ['APPLIED', 'Applied'],
    ['SCREEN', 'Screen'],
    ['INTERVIEW', 'Interview'],
    ['OFFER', 'Offer'],
    ['REJECTED', 'Rejected'],
  ];

  const max = Math.max(1, ...rows.map(([status]) => stats.byStatus[status]));

  return (
    <section className="panel">
      <Head title="Pipeline" tone="c" Icon={ChartIcon} aside={<span className="cell-dim">{total} total</span>} />

      {total === 0 ? (
        <p className="muted">Your stages will show here once something is tracked.</p>
      ) : (
        <div className="funnel">
          {rows.map(([status, label]) => {
            const count = stats.byStatus[status];
            return (
              <div className="funnel-row" key={status}>
                <span className="funnel-label">{label}</span>
                <div className="funnel-bar">
                  <div
                    className="funnel-fill"
                    data-tone={status === 'REJECTED' ? 'dim' : undefined}
                    style={{ width: `${(count / max) * 100}%`, transform: 'scaleX(1)' }}
                  />
                </div>
                <span className="funnel-count">{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ThisWeek({ thisWeek, lastWeek }: { thisWeek: number; lastWeek: number }) {
  const delta = thisWeek - lastWeek;

  return (
    <section className="panel">
      <Head title="This week" tone="b" Icon={CalendarIcon} aside={<span className="cell-dim">last 7 days</span>} />

      <div className="week-row">
        <span className="readout-value">{thisWeek}</span>
        <div>
          <p className="muted">
            {thisWeek === 0
              ? 'Nothing submitted in the last seven days.'
              : `${plural(thisWeek, 'application')} submitted.`}
          </p>
          {lastWeek > 0 && (
            <p className="cell-dim">
              {delta === 0
                ? 'Same as the week before.'
                : delta > 0
                  ? `${delta} more than the week before.`
                  : `${Math.abs(delta)} fewer than the week before.`}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Reads from the append-only event log, so it shows things nobody typed. */
function Activity({ events }: { events: ActivityEvent[] }) {
  const describe = (e: ActivityEvent): string => {
    switch (e.type) {
      case 'CREATED':
        return e.actor === 'EXTENSION' ? 'Captured on submit' : 'Added by hand';
      case 'STATUS_CHANGED':
        return `${e.fromStatus?.toLowerCase() ?? 'new'} → ${e.toStatus?.toLowerCase() ?? ''}`;
      case 'POSTING_CHECKED':
        return 'Posting came down';
      case 'DUPLICATE_FLAGGED':
        return 'Flagged as a possible duplicate';
      case 'NOTE_ADDED':
        return 'Note added';
      default:
        return e.type.toLowerCase().replace(/_/g, ' ');
    }
  };

  return (
    <section className="panel activity">
      <Head title="Activity" tone="c" Icon={PulseIcon} />

      {events.length === 0 ? (
        <p className="muted">
          Everything that happens to an application shows up here — including the parts you did not
          do, like a posting being taken down.
        </p>
      ) : (
        <ol className="activity-list">
          {events.map((event) => (
            <li key={event.id}>
              <span className="activity-dot" aria-hidden="true" />
              <div>
                <strong>{event.title}</strong>
                <p className="muted">
                  {describe(event)} · {event.companyName}
                </p>
              </div>
              <span className="cell-dim">{formatDate(event.occurredAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

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
      <Head
        title="Needs attention"
        tone="d"
        Icon={AlertIcon}
        aside={<span className="lamp lamp-down">{alerts.length + stale.length}</span>}
      />

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
              {app.company.name} · silent {daysBetween(app.appliedAt!)}d, posting still up
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
      <Head
        title="Recent applications"
        tone="a"
        Icon={SendIcon}
        aside={
          <Link className="btn-link" to="/dashboard/applications">
            See all
          </Link>
        }
      />

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
                <th>Posting</th>
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
                  <td>{app.status.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
