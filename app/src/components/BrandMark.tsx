// Ember wordmark + bolt mark. Client-safe and dependency-free (no DB/browser
// APIs) so it can live in the dashboard header and the first-run welcome alike.
// It reuses the app's Tailwind utilities so it inherits the font + slate/amber
// theme — no new fonts, no new deps.

// A clean angular lightning bolt. Filled with a subtle amber gradient (amber-400
// → amber-500 → amber-600) for a faint "ember glow" while staying crisp at small
// sizes. Each instance gets a unique gradient id so multiple bolts on a page
// don't collide. Sizing comes from the caller via `className` (e.g. `h-6 w-6`).
export function BoltIcon({ className, idSuffix }: { className?: string; idSuffix?: string }) {
  const gid = `ember-bolt-${idSuffix ?? 'a'}`;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-hidden="true"
      fill={`url(#${gid})`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#fbbf24" />
          <stop offset="0.5" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
      <path d="M13.5 2 4 13.2h6.1L9 22l9.6-11.3h-6.2L13.5 2Z" />
    </svg>
  );
}

// The reusable header/logo lockup: bolt to the left of the "Ember" wordmark,
// styled to match the existing cockpit-header h1 (bold, tight tracking,
// slate-50). The caller passes sizing via `className` (text size + bolt size are
// derived from it through `em` units, so it scales as one unit). The whole
// lockup truncates and never wraps, so it stays on the no-wrap header row.
export function Wordmark({
  className,
  textClassName,
}: {
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className ?? ''}`}>
      <BoltIcon className="h-[1.1em] w-[1.1em] shrink-0 drop-shadow-[0_0_6px_rgba(245,158,11,0.45)]" />
      <span className={`truncate font-bold tracking-tight text-slate-50 ${textClassName ?? ''}`}>
        Ember
      </span>
    </span>
  );
}
