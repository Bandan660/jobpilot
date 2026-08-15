import { useEffect, useState } from 'react';
import { safeHref } from '../../safeHref.js';
import type { AdminMetrics } from '@jobpilot/shared';
import { api } from '../../api.js';
import { LoadingSpinner } from '../../components/LoadingSpinner.js';
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

  const [tab, setTab] = useState<'analytics' | 'blog' | 'reports'>('analytics');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [blogPosts, setBlogPosts] = useState<import('@jobpilot/shared').DynamicBlogPost[]>([]);
  const [reports, setReports] = useState<import('@jobpilot/shared').UserReport[]>([]);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Blog Editor State
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState('Job search');
  const [author, setAuthor] = useState('BanApply Team');
  const [tagsInput, setTagsInput] = useState('');
  const [content, setContent] = useState('');
  const [published, setPublished] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorMsg, setEditorMsg] = useState<string | null>(null);

  const fetchBlogPosts = () => {
    api.getAdminBlogPosts().then(setBlogPosts).catch(() => {});
  };

  const fetchReports = () => {
    api.getAdminReports().then(setReports).catch(() => {});
  };

  const handleUpdateReportStatus = async (id: string, nextStatus: string) => {
    setUpdatingReportId(id);
    try {
      await api.updateReportStatus(id, nextStatus);
      fetchReports();
    } catch {
      // Ignore
    } finally {
      setUpdatingReportId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.adminMetrics(),
      api.getAdminBlogPosts().catch(() => []),
      api.getAdminReports().catch(() => []),
    ])
      .then(([m, posts, rep]) => {
        if (cancelled) return;
        setMetrics(m);
        setBlogPosts(posts);
        setReports(rep);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const openNewPostForm = () => {
    setEditingId(null);
    setTitle('');
    setSummary('');
    setCategory('Job search');
    setAuthor('BanApply Team');
    setTagsInput('job search, productivity');
    setContent('');
    setPublished(true);
    setEditorMsg(null);
    setShowEditor(true);
  };

  const openEditPostForm = (post: import('@jobpilot/shared').DynamicBlogPost) => {
    setEditingId(post.id);
    setTitle(post.title);
    setSummary(post.summary);
    setCategory(post.category);
    setAuthor(post.author);
    setTagsInput(post.tags ? post.tags.join(', ') : '');
    setContent(post.content);
    setPublished(post.published);
    setEditorMsg(null);
    setShowEditor(true);
  };

  const handleSavePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !summary.trim() || !content.trim()) {
      setEditorMsg('Title, Summary, and Content are required.');
      return;
    }

    setSaving(true);
    setEditorMsg(null);
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (editingId) {
        await api.updateBlogPost(editingId, {
          title,
          summary,
          category,
          author,
          tags,
          content,
          published,
        });
      } else {
        await api.createBlogPost({
          title,
          summary,
          category,
          author,
          tags,
          content,
          published,
        });
      }
      setShowEditor(false);
      fetchBlogPosts();
    } catch (err) {
      setEditorMsg(err instanceof Error ? err.message : 'Failed to save blog post');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePost = async (id: string) => {
    if (!confirm('Are you sure you want to delete this blog post?')) return;
    try {
      await api.deleteBlogPost(id);
      fetchBlogPosts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete post');
    }
  };

  if (loading) return <LoadingSpinner label="Loading admin metrics…" fullPage />;

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

  const { users, applications, activatedUsers } = metrics ?? {
    users: { total: 0, last7: 0, last30: 0 },
    applications: { total: 0, last7: 0, last30: 0, withResume: 0 },
    activatedUsers: 0,
  };

  const activation = users.total > 0 ? Math.round((activatedUsers / users.total) * 100) : 0;

  return (
    <div className="dash">
      <header className="dash-hero">
        <div className="dash-hero-copy" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
          <div>
            <h1>Admin Dashboard</h1>
            <p>System metrics & content publishing control center.</p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`btn ${tab === 'analytics' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('analytics')}
            >
              📊 Analytics
            </button>
            <button
              className={`btn ${tab === 'blog' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('blog')}
            >
              📝 Blog Posts ({blogPosts.length})
            </button>
            <button
              className={`btn ${tab === 'reports' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab('reports')}
            >
              🚩 User Reports ({reports.length})
            </button>
          </div>
        </div>
      </header>

      {tab === 'analytics' ? (
        <>
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

          {metrics && <Signups points={metrics.signups} />}

          {metrics && (
            <div className="dash-split">
              <div className="dash-col">
                <Breakdown title="Platforms" rows={metrics.platforms.map((p) => [p.ats, p.count])} />
              </div>
              <div className="dash-col">
                <Breakdown title="Application status" rows={metrics.statuses.map((s) => [s.status, s.count])} />
                <Breakdown title="Postings" rows={metrics.postings.map((p) => [p.status, p.count])} />
              </div>
            </div>
          )}
        </>
      ) : tab === 'blog' ? (
        <section className="panel" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '20px', margin: 0 }}>Published Blog Posts</h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '14px', margin: '4px 0 0 0' }}>
                Manage custom articles published on banapply.com/blog
              </p>
            </div>
            <button className="btn btn-primary" onClick={openNewPostForm}>
              + Create New Post
            </button>
          </div>

          {showEditor && (
            <form
              onSubmit={handleSavePost}
              style={{
                background: 'var(--panel-raised)',
                border: '1px solid var(--line-bright)',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <h3 style={{ margin: 0 }}>{editingId ? 'Edit Blog Post' : 'Create New Blog Post'}</h3>
              {editorMsg && <p style={{ color: 'var(--error)', margin: 0 }}>{editorMsg}</p>}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Post Title *
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. 5 Strategies to Accelerate Your Job Hunt"
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Category
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Job search, Engineering, Career, Product"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Author Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="BanApply Team"
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    className="input"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    placeholder="autofill, job tracker, resume tips"
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Summary / Excerpt (shows in cards & search results) *
                </label>
                <textarea
                  className="input"
                  style={{ minHeight: '60px', fontFamily: 'inherit' }}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Brief summary of the article..."
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Post Content (Markdown or plain text) *
                </label>
                <textarea
                  className="input"
                  style={{ minHeight: '220px', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.5 }}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your article body here..."
                  required
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="pub-check"
                  checked={published}
                  onChange={(e) => setPublished(e.target.checked)}
                />
                <label htmlFor="pub-check" style={{ fontSize: '14px', cursor: 'pointer' }}>
                  Publish immediately (visible to all site visitors)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Post' : 'Publish Article'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowEditor(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {blogPosts.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-dim)' }}>
              No custom blog posts yet. Click <strong>"+ Create New Post"</strong> above to publish your first article!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {blogPosts.map((post) => (
                <div
                  key={post.id}
                  style={{
                    background: 'var(--panel)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '16px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                      <span className={`lamp ${post.published ? 'lamp-live' : 'lamp-dim'}`}>
                        {post.published ? 'Published' : 'Draft'}
                      </span>
                      <h3 style={{ margin: 0, fontSize: '16px' }}>{post.title}</h3>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-dim)' }}>
                      slug: <code>/blog/{post.slug}</code> · Category: {post.category} · Author: {post.author}
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-ghost" onClick={() => openEditPostForm(post)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ color: 'var(--error)' }}
                      onClick={() => handleDeletePost(post.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel" style={{ padding: '24px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <h2 style={{ fontSize: '20px', margin: 0 }}>
                User Feedback & Bug Reports ({reports.length})
              </h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '14px', margin: '4px 0 0 0' }}>
                Issues and feedback submitted directly from the BanApply extension side panel.
              </p>
            </div>
            <button className="btn btn-ghost" onClick={fetchReports}>
              🔄 Refresh
            </button>
          </div>

          {reports.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
              No user reports submitted yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {reports.map((report) => {
                const categoryConfig = {
                  autofill: { label: '⚡ AUTOFILL', bg: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
                  bug: { label: '🐛 BUG', bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
                  general: { label: '💡 FEEDBACK', bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' },
                }[report.category as 'autofill' | 'bug' | 'general'] || { label: report.category.toUpperCase(), bg: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-dim)', border: 'var(--line)' };

                const statusColor = {
                  open: '#f59e0b',
                  investigating: '#3b82f6',
                  resolved: '#10b981',
                  closed: '#6b7280',
                }[report.status] || '#6b7280';

                return (
                  <div
                    key={report.id}
                    style={{
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--line-bright)',
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            padding: '3px 10px',
                            borderRadius: '20px',
                            background: categoryConfig.bg,
                            color: categoryConfig.color,
                            border: `1px solid ${categoryConfig.border}`,
                          }}
                        >
                          {categoryConfig.label}
                        </span>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--text-bright)' }}>
                          {report.subject}
                        </h3>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                          🕒 {new Date(report.createdAt).toLocaleString()}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: statusColor,
                              display: 'inline-block',
                            }}
                          />
                          <select
                            value={report.status}
                            disabled={updatingReportId === report.id}
                            onChange={(e) => handleUpdateReportStatus(report.id, e.target.value)}
                            style={{
                              padding: '5px 12px',
                              borderRadius: '8px',
                              background: 'var(--panel)',
                              color: 'var(--text-bright)',
                              border: '1px solid var(--line)',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              outline: 'none',
                            }}
                          >
                            <option value="open">Open</option>
                            <option value="investigating">Investigating</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                      }}
                    >
                      <p
                        style={{
                          fontSize: '14px',
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.6,
                          color: 'var(--text)',
                        }}
                      >
                        {report.description}
                      </p>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '12px',
                        fontSize: '12px',
                        color: 'var(--text-dim)',
                        paddingTop: '10px',
                        borderTop: '1px solid var(--line)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '180px' }}>
                        <span>👤 User:</span>
                        <strong style={{ color: 'var(--text-bright)', fontWeight: 600 }}>
                          {report.userEmail || 'Anonymous'}
                        </strong>
                      </div>

                      {report.pageUrl && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            maxWidth: '100%',
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <span>📍 URL:</span>
                          <a
                            href={safeHref(report.pageUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={report.pageUrl}
                            style={{
                              color: '#60a5fa',
                              textDecoration: 'none',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '450px',
                              fontWeight: 500,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            {report.pageUrl} ↗
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
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
