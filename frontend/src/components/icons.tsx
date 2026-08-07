/**
 * Icon set.
 *
 * Inline SVG rather than an icon font or a package: eight shapes do not justify
 * a dependency, and these inherit currentColor so a tinted wrapper colours them
 * without any per-icon variants.
 *
 * All are decorative — every one sits next to a text label, so they carry
 * aria-hidden and never a title.
 */

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function StackIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </svg>
  );
}

export function ReplyIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 010 12h-3" />
    </svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function GhostIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M5 21V10a7 7 0 0114 0v11l-3-2-2 2-2-2-2 2-2-2-3 2z" />
      <path d="M9.5 10h.01M14.5 10h.01" />
    </svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </svg>
  );
}

export function PuzzleIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M10 3h4a1 1 0 011 1v2a2 2 0 104 0V4h2a1 1 0 011 1v4h-2a2 2 0 100 4h2v4a1 1 0 01-1 1h-4v-2a2 2 0 10-4 0v2H5a1 1 0 01-1-1v-4h2a2 2 0 100-4H4V4a1 1 0 011-1h5z" />
    </svg>
  );
}

export function SendIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M21 3L3 10l7 3 3 7 8-17z" />
      <path d="M10 13l4-4" />
    </svg>
  );
}

export function PulseIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 4l9 16H3l9-16z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function ChartIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function BuildingIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16" />
      <path d="M15 9h4a1 1 0 011 1v11" />
      <path d="M2 21h20M8 8h3M8 12h3M8 16h3" />
    </svg>
  );
}

export function PinIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function ArchiveIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" />
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** Arrow leaving a box: marks a link that goes to a different site. */
export function ExternalIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" />
    </svg>
  );
}

export function FileTextIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7L12 19" />
    </svg>
  );
}

export function CapIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 4L2 9l10 5 10-5-10-5z" />
      <path d="M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5" />
    </svg>
  );
}

export function SparkIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z" />
    </svg>
  );
}

export function GlobeIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18z" />
    </svg>
  );
}

export function CoinIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5A2.5 2.5 0 0012 8.5c-1.4 0-2.5.7-2.5 1.8s1.1 1.6 2.5 1.9 2.5.8 2.5 1.9-1.1 1.8-2.5 1.8a2.5 2.5 0 01-2.5-1M12 7v10" />
    </svg>
  );
}
