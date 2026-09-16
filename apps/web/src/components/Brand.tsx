import type { ReactElement } from 'react';

export function BrandMark(): ReactElement {
  return (
    <span className="app-brand-mark">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    </span>
  );
}

export function initials(name: string | undefined): string {
  return (name?.trim().slice(0, 2) || 'RF').toUpperCase();
}
