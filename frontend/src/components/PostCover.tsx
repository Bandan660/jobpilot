/**
 * Generated cover art.
 *
 * Each post gets a distinct abstract image derived from its slug, so covers are
 * stable across builds without shipping photographs. Drawn as SVG in the theme
 * tokens: sharp at any density, correct in both themes, and a few hundred bytes
 * rather than a few hundred kilobytes.
 *
 * Five patterns, all from the instrument vocabulary used across the site.
 */

import type { ReactElement } from 'react';

const W = 480;
const H = 270;

/** Small deterministic hash, so a slug always picks the same pattern and seed. */
function hash(input: string): number {
  let value = 2166136261;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Mulberry32 — tiny seeded PRNG, enough for placing decorative marks. */
function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every pattern takes the same props so the registry stays plainly typed. */
interface PatternProps {
  random: () => number;
}

/* Pattern 0: a response-rate trace with one emphasised point. */
function Trace({ random }: PatternProps) {
  const points = Array.from({ length: 13 }, (_, i) => {
    const x = 30 + (i * (W - 60)) / 12;
    const y = H - 50 - random() * (H - 130);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${path} L${points[points.length - 1][0].toFixed(1)} ${H - 30} L${points[0][0].toFixed(1)} ${H - 30} Z`;
  const peak = points.reduce((best, p) => (p[1] < best[1] ? p : best));

  return (
    <>
      <path d={area} fill="var(--signal-wash)" />
      <path d={path} fill="none" stroke="var(--signal)" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={peak[0]} cy={peak[1]} r="5" fill="var(--signal)" />
      <circle cx={peak[0]} cy={peak[1]} r="11" fill="none" stroke="var(--signal)" strokeOpacity="0.4" />
    </>
  );
}

/* Pattern 1: the sweep, as concentric rings with a beam. */
function Rings({ random }: PatternProps) {
  const cx = W * 0.5;
  const cy = H * 0.52;

  return (
    <>
      {[38, 66, 94, 122].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="var(--line-bright)" strokeWidth="1" />
      ))}
      <path
        d={`M${cx} ${cy} L${cx + 122} ${cy} A122 122 0 0 0 ${cx + 96} ${cy - 75} Z`}
        fill="var(--signal-wash)"
      />
      <line x1={cx - 130} y1={cy} x2={cx + 130} y2={cy} stroke="var(--line)" strokeWidth="1" />
      <line x1={cx} y1={cy - 130} x2={cx} y2={cy + 130} stroke="var(--line)" strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => {
        const angle = random() * Math.PI * 2;
        const radius = 26 + random() * 92;
        const failing = i === 2;
        return (
          <circle
            key={i}
            cx={cx + Math.cos(angle) * radius}
            cy={cy + Math.sin(angle) * radius}
            r="4"
            fill={failing ? 'var(--down)' : 'var(--live)'}
          />
        );
      })}
    </>
  );
}

/* Pattern 2: a field of records, a few of them flagged. */
function Field({ random }: PatternProps) {
  const cols = 12;
  const rows = 6;
  const marks: ReactElement[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 42 + c * 33;
      const y = 46 + r * 32;
      const roll = random();
      const flagged = roll > 0.9;
      marks.push(
        <rect
          key={`${r}-${c}`}
          x={x}
          y={y}
          width={flagged ? 20 : 14}
          height="6"
          rx="3"
          fill={flagged ? 'var(--signal)' : 'var(--line-bright)'}
          opacity={flagged ? 1 : 0.55 + roll * 0.35}
        />
      );
    }
  }

  return <>{marks}</>;
}

/* Pattern 3: a funnel, narrowing. Fixed shape — no randomness needed. */
function Funnel(_: PatternProps) {
  const widths = [1, 0.62, 0.4, 0.24, 0.13];

  return (
    <>
      {widths.map((w, i) => (
        <rect
          key={i}
          x={44}
          y={44 + i * 38}
          width={(W - 88) * w}
          height="22"
          rx="4"
          fill={i === widths.length - 1 ? 'var(--signal)' : 'var(--line-bright)'}
          opacity={i === widths.length - 1 ? 1 : 0.85 - i * 0.12}
        />
      ))}
    </>
  );
}

/* Pattern 4: overlapping URLs collapsing to one. Fixed shape. */
function Converge(_: PatternProps) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={40 + i * 14}
          y={44 + i * 20}
          width={200}
          height="26"
          rx="6"
          fill="var(--panel-raised)"
          stroke="var(--line-bright)"
          strokeWidth="1"
        />
      ))}
      <path
        d={`M${W * 0.62} 88 L${W * 0.78} 88 L${W * 0.78} 168 L${W * 0.62} 168`}
        fill="none"
        stroke="var(--line-bright)"
        strokeWidth="1.5"
      />
      <rect
        x={W * 0.5}
        y={186}
        width={200}
        height="34"
        rx="8"
        fill="var(--signal-wash)"
        stroke="var(--signal)"
        strokeWidth="1.5"
      />
    </>
  );
}

const PATTERNS = [Trace, Rings, Field, Funnel, Converge];

export function PostCover({ slug, className }: { slug: string; className?: string }) {
  const seed = hash(slug);
  const Pattern = PATTERNS[seed % PATTERNS.length];
  const random = rng(seed);
  const gridId = `grid-${seed.toString(36)}`;

  return (
    <svg
      className={`post-cover ${className ?? ''}`.trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <pattern id={gridId} width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0 L0 0 0 30" fill="none" stroke="var(--line)" strokeWidth="1" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill="var(--panel-raised)" />
      <rect width={W} height={H} fill={`url(#${gridId})`} opacity="0.6" />

      <Pattern random={random} />
    </svg>
  );
}
