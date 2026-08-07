import { useEffect, useState } from 'react';

/**
 * Sidebar furniture for the profile page: the readiness ring and the
 * scroll-spy nav.
 *
 * Split out because both need effects and state, and the page itself is
 * already a long form.
 */

/**
 * Circular readiness meter.
 *
 * A ring rather than a bar because it sits beside the avatar, where a bar
 * would read as a third piece of chrome; the ring reads as one object with the
 * avatar it encloses.
 */
export function ReadinessRing({ percent, size = 84 }: { percent: number; size?: number }) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Profile ${percent}% complete`}
    >
      <circle
        className="ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="ring-value"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        // Drawn from the top, clockwise, by offsetting the dash rather than
        // rotating the element — keeps the transition on one property.
        strokeDashoffset={circumference * (1 - percent / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/**
 * Highlights whichever section is currently on screen.
 *
 * IntersectionObserver rather than a scroll listener: it does not fire on every
 * frame, and it does not need the page to be laid out to know where things are.
 * `rootMargin` pulls the detection line near the top of the viewport so the
 * highlight matches the section you are reading rather than the one furthest
 * down the screen.
 */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    // Guards the prerender pass, which runs in Node.
    if (typeof IntersectionObserver === 'undefined') return;

    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio);

        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of seen) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        if (best) setActive(best);
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] }
    );

    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [ids.join(',')]);

  return active;
}
