/**
 * Placeholder brand marks — used only until the real SVGs land in
 * public/assets/. Sizing respects the spec: heart minimum 14px with clear
 * space of half its height; figure-mark reserved for empty states.
 */

export function HeartPlaceholder({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="heart"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 21c-.6 0-4.9-3.2-7.5-6.4C2.6 12.2 2 10.6 2 8.9 2 5.9 4.3 4 6.8 4c2 0 3.9 1.2 5.2 3C13.3 5.2 15.2 4 17.2 4 19.7 4 22 5.9 22 8.9c0 1.7-.6 3.3-2.5 5.7C16.9 17.8 12.6 21 12 21Z"
        fill="#d7242a"
        stroke="#1f4897"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FigurePlaceholder({ height = 140 }: { height?: number }) {
  return (
    <svg className="figure" height={height} viewBox="0 0 100 140" fill="none" aria-hidden="true">
      <circle cx="50" cy="34" r="20" fill="#ffffff" stroke="#1f4897" strokeWidth="3" />
      <circle cx="43" cy="32" r="2.6" fill="#1f4897" />
      <circle cx="57" cy="32" r="2.6" fill="#1f4897" />
      <path d="M43 41c2.5 2.6 11.5 2.6 14 0" stroke="#1f4897" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M50 58c-16 0-24 10-24 26v34c0 6 4 10 10 10h28c6 0 10-4 10-10V84c0-16-8-26-24-26Z"
        fill="#ffffff"
        stroke="#1f4897"
        strokeWidth="3"
      />
      <path
        d="M50 84c-1.8 0-4.5-2.2-5.8-3.9-1-1.3-1.2-3.3 0-4.6 1.4-1.5 3.8-1.3 5.8.6 2-1.9 4.4-2.1 5.8-.6 1.2 1.3 1 3.3 0 4.6C54.5 81.8 51.8 84 50 84Z"
        fill="#d7242a"
      />
    </svg>
  );
}

export function PatternPlaceholder() {
  // subtle scatter standing in for pattern-5-clean.svg
  return (
    <svg className="pattern" width="100%" height="100%" aria-hidden="true">
      <defs>
        <pattern id="p5" width="72" height="72" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="3" fill="#134a3a" />
          <path d="M46 8l6 6-6 6-6-6z" fill="#134a3a" />
          <path d="M14 50c4-4 10-4 14 0" stroke="#134a3a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <circle cx="56" cy="52" r="4" fill="none" stroke="#134a3a" strokeWidth="2.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#p5)" />
    </svg>
  );
}

/** Stale refresh glyph (build spec §1: #5c4a00 refresh icon on #ffd00d). */
export function RefreshGlyph({ className = "refresh-glyph" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
