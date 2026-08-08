import { useEffect } from 'react';

/**
 * GSAP ScrollTrigger scenes for the marketing pages.
 *
 * Loaded dynamically for the same reason as the WebGL hero: this is decoration
 * on top of a page that already reads correctly without it, so it must not sit
 * in the critical path. Nothing here is required for the content to be legible
 * — if the import never resolves, the page is the page.
 *
 * Two rules shape every scene below.
 *
 * Nothing animates opacity from 0 on a first-screen element. A hidden element
 * is not paintable, so fading in the hero heading would remove the largest
 * thing on screen from the LCP measurement. Above the fold, motion is
 * transform-only.
 *
 * Nothing animates a property that changes layout. Only transform and opacity,
 * so scroll effects can never cause layout shift.
 */
export function useScrollScenes(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let ctx: { revert: () => void } | undefined;
    let disposed = false;

    void (async () => {
      const [{ gsap }, { ScrollTrigger }] = await Promise.all([
        import('gsap'),
        import('gsap/ScrollTrigger'),
      ]);
      if (disposed) return;

      gsap.registerPlugin(ScrollTrigger);

      // gsap.context scopes every selector and gives one revert() that undoes
      // all of it, which is what makes this safe across client-side route
      // changes — without it, triggers from the previous page keep firing.
      ctx = gsap.context(() => {
        /* Hero ------------------------------------------------------------ */

        // Transform-only, and it starts at its natural position: the heading is
        // the LCP element and must be fully painted at zero scroll.
        gsap.to('.hero-copy', {
          y: -70,
          ease: 'none',
          scrollTrigger: {
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 0.4,
          },
        });

        gsap.to('.hero .panel-mock', {
          y: -130,
          ease: 'none',
          scrollTrigger: {
            trigger: '.hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 0.6,
          },
        });

        /* Waypoints -------------------------------------------------------- */

        // Each section's index badge holds still while its section passes,
        // which is what makes the rail read as one continuous instrument
        // rather than a series of unrelated blocks.
        ScrollTrigger.matchMedia({
          '(min-width: 900px)': () => {
            gsap.utils.toArray<HTMLElement>('.waypoint').forEach((waypoint) => {
              const badge = waypoint.querySelector('.waypoint-marker');
              if (!badge) return;

              ScrollTrigger.create({
                trigger: waypoint,
                start: 'top 22%',
                end: 'bottom 55%',
                pin: badge,
                pinSpacing: false,
              });
            });
          },
        });

        /* Counters --------------------------------------------------------- */

        // Numbers count up the first time they arrive. Only digits are
        // touched; any suffix in the markup is left alone.
        gsap.utils.toArray<HTMLElement>('.strip-value').forEach((node) => {
          const target = Number(node.textContent?.replace(/[^\d.]/g, ''));
          if (!Number.isFinite(target) || target === 0) return;

          const suffix = node.textContent?.replace(/[\d.,]/g, '') ?? '';
          const state = { value: 0 };

          gsap.to(state, {
            value: target,
            duration: 1.1,
            ease: 'power2.out',
            scrollTrigger: { trigger: node, start: 'top 88%', once: true },
            onUpdate: () => {
              node.textContent = `${Math.round(state.value)}${suffix}`;
            },
          });
        });

        /* Page progress ----------------------------------------------------- */

        // Scrubbed against the whole document rather than stepped, so it tracks
        // the scrollbar exactly. transform only — a width animation here would
        // relayout on every frame.
        gsap.fromTo(
          '.scroll-progress',
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.2 },
          }
        );
      });

      // Fonts land after first paint and change element heights, which leaves
      // every trigger measuring stale positions.
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    })();

    return () => {
      disposed = true;
      ctx?.revert();
    };
  }, [enabled]);
}
