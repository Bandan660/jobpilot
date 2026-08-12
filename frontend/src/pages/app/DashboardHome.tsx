import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVE_STATUSES,
  daysBetween,
  formatDate,
  profileReadiness,
  relativeTime,
  type Application,
  type ApplicationStatus,
  type FunnelStats,
  type Profile,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { LoadingSpinner } from '../../components/LoadingSpinner.js';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No `api.activity()` here. The activity stream this dashboard used to render
  // was replaced by ApplicationAnalytics, which derives everything it draws from
  // `applications` — the fetch outlived the component it fed and cost a request
  // per load for data nothing read. Restore both together or neither.
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

  if (loading) return <LoadingSpinner label="Loading dashboard stats…" fullPage />;

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

      <TimeSavedAndGoal applications={applications} thisWeek={thisWeek} />

      <Setup profile={profile} readiness={readiness} hasApplications={applications.length > 0} />

      {stats && <Readouts stats={stats} />}

      <QuickActions />

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
          <ApplicationAnalytics applications={applications} stats={stats} />
        </div>
      </div>

      <RecentApplications applications={applications} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TimeSavedAndGoal({
  applications,
  thisWeek,
}: {
  applications: Application[];
  thisWeek: number;
}) {
  const [weeklyGoal, setWeeklyGoal] = useState(() => {
    return Number(localStorage.getItem('jp_weekly_goal') || 25);
  });
  const [editingGoal, setEditingGoal] = useState(false);

  // Time saved estimate: ~30 mins saved per job applied/tracked
  const minutesSaved = applications.length * 30;
  const hoursSaved = (minutesSaved / 60).toFixed(1);
  const goalProgress = Math.min(100, Math.round((thisWeek / Math.max(1, weeklyGoal)) * 100));

  // Compute active streak (consecutive days with applications)
  const streakDays = (() => {
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const hasApp = applications.some((a) => {
        const raw = a.appliedAt || a.createdAt;
        return raw && new Date(raw).toISOString().split('T')[0] === dateStr;
      });
      if (hasApp) streak++;
      else if (i > 0) break; // streak broken
    }
    return streak;
  })();

  const handleGoalChange = (newGoal: number) => {
    setWeeklyGoal(newGoal);
    localStorage.setItem('jp_weekly_goal', String(newGoal));
    setEditingGoal(false);
  };

  return (
    <section
      className="panel time-goal-panel"
      style={{
        background:
          'linear-gradient(135deg, var(--signal-wash) 0%, var(--panel) 100%)',
        border: '1px solid var(--signal-dim)',
        padding: '16px 20px',
        borderRadius: '14px',
        marginBottom: '20px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
          alignItems: 'center',
        }}
      >
        {/* Time Saved ROI Metric */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--signal-bright) 0%, var(--signal) 100%)',
              color: 'var(--on-signal)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: '22px',
              boxShadow: '0 6px 18px var(--hero-glow)',
              flexShrink: 0,
            }}
          >
            🔥
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span
                style={{
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--text)',
                  letterSpacing: '-0.02em',
                }}
              >
                {hoursSaved} Hours Saved
              </span>
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--signal-text)',
                  background: 'var(--signal-wash)',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontWeight: 700,
                }}
              >
                ROI Boost
              </span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '2px' }}>
              By autofilling forms and auto-capturing {applications.length} applications with
              BanApply.
            </p>
          </div>
        </div>

        {/* Weekly Target Goal & Streak */}
        <div
          style={{
            background: 'var(--panel-raised)',
            padding: '12px 16px',
            borderRadius: '12px',
            border: '1px solid var(--line)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              <span>⚡ {streakDays} Day Streak</span>
              <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· Weekly Goal:</span>
              <strong style={{ color: 'var(--signal-text)' }}>
                {thisWeek}/{weeklyGoal}
              </strong>
            </div>

            <button
              onClick={() => setEditingGoal(!editingGoal)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--signal)',
                fontSize: '11px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {editingGoal ? 'Done' : 'Set target'}
            </button>
          </div>

          {/* Goal Progress Bar */}
          <div
            style={{
              height: '8px',
              background: 'var(--line)',
              borderRadius: '999px',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: `${goalProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, var(--signal) 0%, var(--live) 100%)',
                borderRadius: '999px',
                transition: 'width 400ms ease',
              }}
            />
          </div>

          {editingGoal && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Weekly target:</span>
              {[15, 25, 40, 60].map((val) => (
                <button
                  key={val}
                  onClick={() => handleGoalChange(val)}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    borderRadius: '6px',
                    border: '1px solid var(--line)',
                    background: weeklyGoal === val ? 'var(--signal)' : 'var(--hover-wash)',
                    color: weeklyGoal === val ? 'var(--on-signal)' : 'var(--text)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {val}/wk
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function QuickActions() {
  return (
    <section
      className="panel quick-actions-panel"
      style={{ padding: '16px 20px', borderRadius: '14px', marginBottom: '20px' }}
    >
      <Head title="Quick AI Tools & Workflows" tone="b" Icon={PuzzleIcon} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '12px',
          marginTop: '12px',
        }}
      >
        <Link
          to="/dashboard/profile"
          className="quick-card"
          style={{
            background: 'var(--panel-raised)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            textDecoration: 'none',
            transition: 'all 160ms ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--signal-text)',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            <span>⚡ Saved Answers Bank</span>
          </div>
          <p
            style={{
              fontSize: '11.5px',
              color: 'var(--text-dim)',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Manage reusable answers auto-filled across job applications.
          </p>
        </Link>

        <Link
          to="/copilot"
          className="quick-card"
          style={{
            background: 'var(--panel-raised)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            textDecoration: 'none',
            transition: 'all 160ms ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--live)',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            <span>🤖 AI Response Writer</span>
          </div>
          <p
            style={{
              fontSize: '11.5px',
              color: 'var(--text-dim)',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Draft long-form responses like &quot;Why join us?&quot; with 1-click AI.
          </p>
        </Link>

        <Link
          to="/dashboard/applications"
          className="quick-card"
          style={{
            background: 'var(--panel-raised)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            textDecoration: 'none',
            transition: 'all 160ms ease',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--info)',
              fontWeight: 700,
              fontSize: '13px',
            }}
          >
            <span>🎯 Skill Match Analysis</span>
          </div>
          <p
            style={{
              fontSize: '11.5px',
              color: 'var(--text-dim)',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Compare your profile skills against target postings instantly.
          </p>
        </Link>
      </div>
    </section>
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

function ApplicationAnalytics({
  applications,
  stats,
}: {
  applications: Application[];
  stats: FunnelStats | null;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Compute last 14 days application count
  const days: { dateStr: string; label: string; count: number }[] = [];
  const now = new Date();

  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const count = applications.filter((a) => {
      const raw = a.appliedAt || a.createdAt;
      if (!raw) return false;
      const appDate = new Date(raw).toISOString().split('T')[0];
      return appDate === dateStr;
    }).length;

    days.push({ dateStr, label, count });
  }

  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const totalCount = applications.length;
  const avgCount = (days.reduce((acc, d) => acc + d.count, 0) / 14).toFixed(1);
  const peakCount = Math.max(...days.map((d) => d.count));

  // Chart dimensions
  const width = 380;
  const height = 135;
  const paddingX = 22;
  const paddingY = 18;
  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  // Compute bar positions and bezier trendline path
  const barWidth = 14;
  const points = days.map((d, index) => {
    const x = paddingX + (index / (days.length - 1)) * chartW;
    const y = height - paddingY - (d.count / maxCount) * chartH;
    return { x, y, ...d, index };
  });

  // SVG Smooth Path generator
  const linePath = points.reduce((acc, point, i, arr) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = arr[i - 1];
    const cx = (prev.x + point.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${point.y}, ${point.x} ${point.y}`;
  }, '');

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
    : '';

  // Status breakdown for Donut Chart
  const statusColors: Record<string, string> = {
    APPLIED: 'var(--signal)',
    SAVED: 'var(--info)',
    SCREEN: 'var(--live)',
    INTERVIEW: 'var(--live)',
    OFFER: 'var(--accent-violet)',
    REJECTED: 'var(--muted)',
  };

  const statusLabels: Record<string, string> = {
    APPLIED: 'Applied',
    SAVED: 'Saved',
    SCREEN: 'Screen',
    INTERVIEW: 'Interview',
    OFFER: 'Offer',
    REJECTED: 'Rejected',
  };

  const donutData = stats
    ? Object.entries(stats.byStatus)
        .map(([status, count]) => ({
          status,
          label: statusLabels[status] || status,
          count,
          color: statusColors[status] || 'var(--muted)',
          pct: totalCount > 0 ? Math.round((count / totalCount) * 100) : 0,
        }))
        .filter((d) => d.count > 0)
    : [];

  return (
    <section className="panel analytics-panel">
      <Head title="Application Velocity & Analytics" tone="a" Icon={ChartIcon} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
        {/* 14-Day Application Volume Bar & Line Graph */}
        <div style={{ background: 'var(--panel-raised)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)' }}>
              Submissions (Last 14 Days)
            </span>
            <span style={{ fontSize: '11px', color: 'var(--signal-text)', background: 'var(--signal-wash)', padding: '2px 9px', borderRadius: '999px', fontWeight: 700 }}>
              Peak: {peakCount}/day
            </span>
          </div>

          <div style={{ position: 'relative' }}>
            <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--signal-bright)" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="var(--signal)" stopOpacity="0.45" />
                </linearGradient>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
                </linearGradient>
                <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Horizontal Background Grid Lines */}
              <line x1={paddingX} y1={paddingY} x2={width - paddingX} y2={paddingY} stroke="var(--line)" strokeDasharray="3 3" opacity="0.4" />
              <line x1={paddingX} y1={paddingY + chartH / 2} x2={width - paddingX} y2={paddingY + chartH / 2} stroke="var(--line)" strokeDasharray="3 3" opacity="0.4" />
              <line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} stroke="var(--line)" opacity="0.7" />

              {/* Shaded Area under Trendline */}
              <path d={areaPath} fill="url(#areaGrad)" />

              {/* Bars. The hover fill was #ffffff — an invisible bar against
                  the light theme's white panel. Brightening the accent reads
                  as a hover state in both themes. */}
              {points.map((pt) => {
                const bHeight = Math.max(4, (pt.count / maxCount) * chartH);
                const bY = height - paddingY - bHeight;
                const isHovered = hoveredIndex === pt.index;

                return (
                  <g key={pt.dateStr} onMouseEnter={() => setHoveredIndex(pt.index)} onMouseLeave={() => setHoveredIndex(null)}>
                    <rect
                      x={pt.x - barWidth / 2}
                      y={bY}
                      width={barWidth}
                      height={bHeight}
                      rx="3.5"
                      fill={isHovered ? 'var(--signal-bright)' : 'url(#barGrad)'}
                      style={{ transition: 'all 140ms ease', cursor: 'pointer' }}
                    />
                  </g>
                );
              })}

              {/* Bezier Trend Line */}
              <path d={linePath} fill="none" stroke="var(--signal)" strokeWidth="2.5" filter="url(#glow)" />

              {/* Data Points on Line */}
              {points.map((pt) => (
                <circle
                  key={`pt-${pt.dateStr}`}
                  cx={pt.x}
                  cy={pt.y}
                  r={hoveredIndex === pt.index ? '5' : '3'}
                  fill="var(--panel)"
                  stroke="var(--signal)"
                  strokeWidth="2"
                  style={{ transition: 'all 140ms ease' }}
                />
              ))}

              {/* X-Axis Labels */}
              <text x={points[0].x} y={height - 2} fill="var(--text-dim)" fontSize="10" textAnchor="start">
                {points[0].label}
              </text>
              <text x={points[Math.floor(points.length / 2)].x} y={height - 2} fill="var(--text-dim)" fontSize="10" textAnchor="middle">
                {points[Math.floor(points.length / 2)].label}
              </text>
              <text x={points[points.length - 1].x} y={height - 2} fill="var(--text-dim)" fontSize="10" textAnchor="end">
                {points[points.length - 1].label}
              </text>
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoveredIndex !== null && (
              <div
                style={{
                  position: 'absolute',
                  top: '0px',
                  left: `${(hoveredIndex / 13) * 78 + 11}%`,
                  transform: 'translateX(-50%)',
                  background: 'var(--panel-raised)',
                  border: '1px solid var(--signal-text)',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 14px var(--shadow)',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                <strong>{days[hoveredIndex].label}</strong>: {days[hoveredIndex].count} applied
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--line)', fontSize: '11.5px', color: 'var(--text-dim)' }}>
            <span>Avg: <strong style={{ color: 'var(--text)' }}>{avgCount}</strong> / day</span>
            <span>Total Tracked: <strong style={{ color: 'var(--text)' }}>{totalCount}</strong></span>
            <span>Active Days: <strong style={{ color: 'var(--live)' }}>{days.filter(d => d.count > 0).length}d</strong></span>
          </div>
        </div>

        {/* Stage Breakdown Donut & Legend */}
        {donutData.length > 0 && (
          <div style={{ background: 'var(--panel-raised)', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '12px' }}>
              Stage Distribution
            </div>
            <div style={{ display: 'flex', gap: '18px', alignItems: 'center' }}>
              {/* Donut Chart SVG */}
              <div style={{ position: 'relative', width: '84px', height: '84px', flexShrink: 0 }}>
                <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                  {(() => {
                    let cumulativeAngle = 0;
                    return donutData.map((d) => {
                      const strokeDasharray = `${d.pct * 2.83} ${283 - d.pct * 2.83}`;
                      const strokeDashoffset = -cumulativeAngle * 2.83;
                      cumulativeAngle += d.pct;
                      return (
                        <circle
                          key={d.status}
                          cx="50"
                          cy="50"
                          r="40"
                          fill="transparent"
                          stroke={d.color}
                          strokeWidth="13"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          style={{ transition: 'all 300ms ease' }}
                        />
                      );
                    });
                  })()}
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '16px', fontWeight: 800, lineHeight: 1 }}>{totalCount}</span>
                  <span style={{ fontSize: '9px', color: 'var(--text-dim)' }}>Jobs</span>
                </div>
              </div>

              {/* Legend List */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', flex: 1 }}>
                {donutData.map((d) => (
                  <div key={d.status} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-dim)' }}>{d.label}:</span>
                    <strong style={{ marginLeft: 'auto', color: 'var(--text)' }}>{d.count}</strong>
                    <span style={{ fontSize: '10px', opacity: 0.65 }}>({d.pct}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
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
                    {/* Not `${daysBetween()}d ago` — that renders "0d ago" for
                        anything applied to today, which is most of what lands
                        in a list called Recent. */}
                    {app.appliedAt ? relativeTime(app.appliedAt) : '—'}
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
