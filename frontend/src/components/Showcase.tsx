import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface ShowcaseItem {
  id: string;
  tag: string;
  title: string;
  body: string;
  points?: string[];
  cta?: { label: string; to: string };
  visual: ReactNode;
}

/**
 * One panel, many views.
 *
 * The dashboard mock is sticky and swaps its view as you scroll the feature
 * list beside it, rather than each feature getting its own image in an
 * alternating zig-zag. That mirrors what is actually being shown: a single
 * tracker doing several things, not five separate products.
 *
 * Below the breakpoint the sticky panel is hidden and each feature renders its
 * own visual inline, since there is no room for a two-column relationship.
 */
export function Showcase({ items }: { items: ShowcaseItem[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Several items can straddle the band at once; take the one nearest
        // the middle so the panel never flickers between two views.
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;

        const middle = window.innerHeight / 2;
        const closest = visible.reduce((best, entry) => {
          const distance = Math.abs(entry.boundingClientRect.top + entry.boundingClientRect.height / 2 - middle);
          const bestDistance = Math.abs(
            best.boundingClientRect.top + best.boundingClientRect.height / 2 - middle
          );
          return distance < bestDistance ? entry : best;
        });

        const index = refs.current.indexOf(closest.target as HTMLElement);
        if (index >= 0) setActive(index);
      },
      { rootMargin: '-35% 0px -35% 0px', threshold: 0 }
    );

    for (const node of refs.current) {
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [items.length]);

  return (
    <div className="showcase">
      <div className="showcase-list">
        {items.map((item, index) => (
          <article
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            className={`showcase-item ${index === active ? 'is-active' : ''}`}
          >
            <span className="showcase-index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>

            <span className="tile-tag">{item.tag}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>

            {item.points && (
              <ul className="feature-points">
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}

            {item.cta && (
              <Link className="btn btn-ghost showcase-cta" to={item.cta.to}>
                {item.cta.label}
              </Link>
            )}

            {/* Mobile only — the sticky panel is hidden at this width. */}
            <div className="showcase-inline">{item.visual}</div>
          </article>
        ))}
      </div>

      <div className="showcase-visual" aria-hidden="true">
        <div className="showcase-stack">
          {items.map((item, index) => (
            <div className="showcase-slide" data-active={index === active} key={item.id}>
              {item.visual}
            </div>
          ))}
        </div>

        {/* Which view the panel is showing, as a row of ticks. */}
        <div className="showcase-dots">
          {items.map((item, index) => (
            <span className="showcase-dot" data-active={index === active} key={item.id} />
          ))}
        </div>
      </div>
    </div>
  );
}
