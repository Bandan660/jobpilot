import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The instrument rail that runs down the page.
 *
 * Tracks how far the viewport has travelled through the section stack and
 * writes it to --rail-progress, which the amber fill scales against. Driven
 * from JS rather than CSS scroll-timelines because those are still
 * Chromium-only, and this is the page's main structural device — it should not
 * be missing in Safari and Firefox.
 */
export function Mission({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.style.setProperty('--rail-progress', '1');
      return;
    }

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight;

      // 0 when the top of the stack reaches the middle of the screen,
      // 1 when the bottom does.
      const total = rect.height + viewport * 0.4;
      const travelled = viewport * 0.6 - rect.top;
      const progress = Math.min(1, Math.max(0, travelled / total));

      node.style.setProperty('--rail-progress', progress.toFixed(4));
    };

    const onScroll = () => {
      // Coalesce to one write per frame; scroll fires far more often than paint.
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
    <div className="mission" ref={ref}>
      <span className="mission-progress" aria-hidden="true" />
      {children}
    </div>
  );
}

interface WaypointProps {
  /** Two-digit marker shown on the rail. */
  index: string;
  children: ReactNode;
}

/** One stop on the rail. Its marker lights when the section is reached. */
export function Waypoint({ index, children }: WaypointProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setActive(true);
        observer.disconnect();
      },
      { threshold: 0, rootMargin: '-40% 0px -40% 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={ref} className={`waypoint ${active ? 'is-active' : ''}`}>
      <span className="waypoint-marker" aria-hidden="true">
        {index}
      </span>
      {children}
    </section>
  );
}
