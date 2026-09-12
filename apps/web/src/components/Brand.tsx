import type { ReactElement } from 'react';

export function BrandMark(): ReactElement {
  return <span className="app-brand-mark">AI</span>;
}

export function initials(name: string | undefined): string {
  return (name?.trim().slice(0, 2) || 'AI').toUpperCase();
}
