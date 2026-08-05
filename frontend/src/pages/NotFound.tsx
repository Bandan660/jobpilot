import { Link } from 'react-router-dom';
import { usePageMeta } from '../usePageMeta.js';

/**
 * A real 404 rather than a silent redirect home. A redirect hides broken links
 * from you and leaves the visitor unsure whether they arrived somewhere wrong.
 */
export function NotFound() {
  usePageMeta('Not found');

  return (
    <div className="shell">
      <div className="notfound">
        <span className="notfound-code">404</span>
        <h1>That page isn&rsquo;t here</h1>
        <p className="muted">
          The link may be out of date, or the address may have a typo in it.
        </p>
        <div className="notfound-actions">
          <Link className="btn btn-primary" to="/">
            Back home
          </Link>
          <Link className="btn btn-ghost" to="/blog">
            Read the blog
          </Link>
        </div>
      </div>
    </div>
  );
}
