import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  POSTS,
  findPost,
  formatDate,
  relatedPosts,
  type Block,
  type Post,
} from '../content/posts.js';
import { PostCover } from '../components/PostCover.js';
import { Reveal } from '../components/Reveal.js';
import { SITE_URL, useSeo } from '../usePageMeta.js';
import { SITE } from '../content/site.js';

const BY_DATE = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));

/* -------------------------------------------------------------------------- */
/* Index                                                                      */
/* -------------------------------------------------------------------------- */

function PostCard({ post, featured = false }: { post: Post; featured?: boolean }) {
  return (
    <article className="post-card" data-featured={featured}>
      <Link to={`/blog/${post.slug}`} className="post-card-link">
        <div className="post-card-media">
          <PostCover slug={post.slug} />
          <span className="post-card-category">{post.category}</span>
        </div>

        <div className="post-card-body">
          <h2>{post.title}</h2>
          <p>{post.summary}</p>
          <div className="post-card-meta">
            <time dateTime={post.date}>{formatDate(post.date)}</time>
            <span aria-hidden="true">·</span>
            <span>{post.readingMinutes} min read</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export function BlogIndex() {
  const [featured, ...rest] = BY_DATE;

  useSeo({
    title: 'Blog — job searching, applications, and how hiring actually works',
    description:
      'Practical writing on job applications: following up, duplicate applications, what an ATS really does, and why job trackers go stale.',
    path: '/blog',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: `${SITE.name} blog`,
      url: `${SITE_URL}/blog`,
      description:
        'Practical writing on job applications, applicant tracking systems, and keeping a job search organised.',
      blogPost: BY_DATE.map((post) => ({
        '@type': 'BlogPosting',
        headline: post.title,
        url: `${SITE_URL}/blog/${post.slug}`,
        datePublished: post.date,
        description: post.summary,
      })),
    },
  });

  return (
    <div className="shell">
      {/* Wrapped in Reveal because .underline-accent only animates inside an
          .is-visible ancestor. `immediate` because this is the LCP element —
          it must not wait on the observer. */}
      <Reveal className="blog-head" as="header" immediate>
        <span className="eyebrow">Blog</span>
        <h1>
          The parts of applying <span className="underline-accent">nobody designs for</span>
        </h1>
        <p>
          Silence after applying, duplicate applications, what an applicant tracking system really
          does with your resume, and why every job-search spreadsheet dies in week three.
        </p>
      </Reveal>

      <Reveal>
        <PostCard post={featured} featured />
      </Reveal>

      <div className="post-grid">
        {rest.map((post, index) => (
          <Reveal key={post.slug} delay={((index % 3) + 1) as 1 | 2 | 3}>
            <PostCard post={post} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Post                                                                       */
/* -------------------------------------------------------------------------- */

/** Thin bar across the top showing how far through the article you are. */
function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="reading-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

/** Heading ids let the contents list link into the article. */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-');
}

function renderBlock(block: Block, index: number) {
  switch (block.kind) {
    case 'h2':
      return (
        <h2 id={headingId(block.text)} key={index}>
          {block.text}
        </h2>
      );
    case 'quote':
      return <blockquote key={index}>{block.text}</blockquote>;
    case 'list':
      return (
        <ul key={index}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    default:
      return <p key={index}>{block.text}</p>;
  }
}

export function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? findPost(slug) : undefined;

  useSeo({
    title: post?.title ?? 'Post not found',
    description: post?.summary,
    path: post ? `/blog/${post.slug}` : '/blog',
    type: post ? 'article' : 'website',
    publishedTime: post?.date,
    modifiedTime: post?.updated ?? post?.date,
    tags: post?.tags,
    structuredData: post
      ? {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.summary,
          datePublished: post.date,
          dateModified: post.updated ?? post.date,
          author: { '@type': 'Organization', name: post.author, url: SITE_URL },
          publisher: { '@type': 'Organization', name: SITE.name, url: SITE_URL },
          mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/blog/${post.slug}` },
          keywords: post.tags.join(', '),
          articleSection: post.category,
          wordCount: post.body.reduce(
            (total, block) =>
              total +
              ('text' in block ? block.text : block.items.join(' ')).split(/\s+/).length,
            0
          ),
        }
      : undefined,
  });

  if (!post) {
    return (
      <div className="shell">
        <div className="blog-head">
          <h1>Post not found</h1>
          <p>
            That link does not match anything. <Link to="/blog">Back to the blog</Link>.
          </p>
        </div>
      </div>
    );
  }

  const headings = post.body.filter((block): block is Extract<Block, { kind: 'h2' }> => block.kind === 'h2');
  const related = relatedPosts(post);

  return (
    <>
      <ReadingProgress />

      <div className="shell">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link to="/blog">Blog</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{post.category}</span>
        </nav>

        <article className="article">
          <header className="article-head">
            <div className="article-meta" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span className="post-card-category" data-inline="true">
                {post.category}
              </span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.readingMinutes} min read</span>
            </div>

            <h1 style={{ marginTop: '12px', marginBottom: '14px', lineHeight: 1.15 }}>{post.title}</h1>
            <p className="article-lede" style={{ fontSize: '17px', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {post.summary}
            </p>

            {/* Author Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '20px',
                paddingTop: '16px',
                borderTop: '1px solid var(--line)',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--signal-bright) 0%, var(--signal) 100%)',
                    color: 'var(--on-signal)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    fontSize: '14px',
                  }}
                >
                  JP
                </div>
                <div>
                  <strong style={{ fontSize: '13px', display: 'block', color: 'var(--text)' }}>
                    {post.author}
                  </strong>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    Job Hunt &amp; Hiring Team
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href);
                  alert('Link copied to clipboard!');
                }}
                style={{
                  background: 'var(--signal-wash)',
                  border: '1px solid var(--signal-dim)',
                  color: 'var(--signal-text)',
                  padding: '4px 12px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔗 Share Article
              </button>
            </div>
          </header>

          <div className="article-media" style={{ marginTop: '24px', borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--line)' }}>
            <PostCover slug={post.slug} />
          </div>

          {/* Key Takeaways Box */}
          <div
            style={{
              background: 'linear-gradient(135deg, var(--signal-wash) 0%, var(--panel) 100%)',
              border: '1px solid var(--signal-dim)',
              borderRadius: '14px',
              padding: '18px 22px',
              margin: '32px 0 24px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--signal-text)', fontWeight: 800, fontSize: '13.5px', marginBottom: '8px' }}>
              <span>💡 Key Takeaways in 30 Seconds</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13.5px', color: 'var(--text)', lineHeight: 1.6 }}>
              <li>Always have a specific trigger or update reason before reaching out to recruiters.</li>
              <li>Keep follow-up emails strictly under 4 concise sentences.</li>
              <li>Track all updates in an automatic log so you know exactly when to step back.</li>
            </ul>
          </div>

          <div className="article-layout">
            {headings.length > 2 && (
              <aside className="toc" aria-label="On this page">
                <span className="toc-label">On this page</span>
                <ol>
                  {headings.map((heading) => (
                    <li key={heading.text}>
                      <a href={`#${headingId(heading.text)}`}>{heading.text}</a>
                    </li>
                  ))}
                </ol>
              </aside>
            )}

            <div className="prose">{post.body.map(renderBlock)}</div>
          </div>

          {/* Author Bio Footer Box */}
          <div
            style={{
              background: 'var(--panel-raised)',
              border: '1px solid var(--line)',
              borderRadius: '14px',
              padding: '20px',
              marginTop: '36px',
              display: 'flex',
              gap: '14px',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--signal-bright) 0%, var(--signal) 100%)',
                color: 'var(--on-signal)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: '16px',
                flexShrink: 0,
              }}
            >
              JP
            </div>
            <div>
              <strong style={{ fontSize: '14px', color: 'var(--text)' }}>Written by {post.author}</strong>
              <p style={{ fontSize: '12px', color: 'var(--text-dim)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                We write actionable guides to help software engineers, designers, and tech professionals navigate modern job applications and automated hiring.
              </p>
            </div>
          </div>

          <footer className="article-foot">
            <div className="tag-row">
              {post.tags.map((tag) => (
                <span className="tag" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          </footer>
        </article>

        {related.length > 0 && (
          <section className="related">
            <h2 className="related-head">Keep reading</h2>
            <div className="post-grid">
              {related.map((other) => (
                <PostCard post={other} key={other.slug} />
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="cta-band">
        <div className="shell">
          <div className="cta-panel">
            <h2>Stop losing track of where you applied</h2>
            <p>
              jobpilot fills the form, records the application, and tells you when a posting comes
              down — without you touching a spreadsheet.
            </p>
            <div className="cta-actions">
              <Link className="btn btn-primary" to="/signup">
                Join now — it&rsquo;s free
              </Link>
              <Link className="btn btn-ghost" to="/job-application-tracker">
                See the tracker
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
