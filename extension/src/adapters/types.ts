import type { AtsProvider, CapturedJob } from '@jobpilot/shared';

export interface JobAdapter {
  ats: AtsProvider;
  /**
   * Bumped whenever selectors change. Stored on every captured event so a bad
   * scrape can be traced to the adapter version that produced it.
   */
  version: string;
  matches(url: URL): boolean;
  /** True only on an individual posting page, not a board listing. */
  isJobPage(url: URL): boolean;
  /** CSS-selector extraction. Only fills what JSON-LD did not provide. */
  extract(doc: Document, url: URL): Partial<CapturedJob>;
  /** Elements whose presence means the application went through. */
  confirmationSelectors: string[];
}

/** First selector that yields non-empty text wins. */
export function textFrom(doc: Document | Element, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const value = el?.textContent?.trim();
    if (value) return value;
  }
  return null;
}

export function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean);
}

/**
 * Turn a URL slug into something presentable ("acme-corp" -> "Acme Corp").
 * Only a fallback: JSON-LD's hiringOrganization.name is always preferred.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
