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

/* Brand marks. Filled rather than stroked, because these are logos and a
   stroked outline of a logo reads as a different logo. */
export function LinkedInIcon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
      <path d="M4.98 3.5a2.5 2.5 0 11-.02 5 2.5 2.5 0 01.02-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-.95 1.83-1.95 3.77-1.95 4.03 0 4.78 2.5 4.78 5.77V21h-4v-5.6c0-1.34-.03-3.06-1.9-3.06-1.9 0-2.2 1.45-2.2 2.96V21h-4z" />
    </svg>
  );
}

export function GithubIcon(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
      <path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0012 2z" />
    </svg>
  );
}

export function PencilIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M9 7V4h6v3" />
    </svg>
  );
}

export function EyeIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 19h16" />
    </svg>
  );
}
