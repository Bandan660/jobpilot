import { useEffect } from 'react';
import { SITE } from './content/site.js';

/**
 * Document head management.
 *
 * A single-page app never reloads, so without this every route shares the
 * index.html title and description — which is what browser tabs, bookmarks,
 * link previews, and search result snippets all read.
 *
 * Note the limit: these tags are written by JavaScript after the page loads.
 * Google renders JS and will see them; most social scrapers and some other
 * crawlers do not. Pre-rendering the marketing routes at build time is the
 * proper fix once the content settles.
 */

const SITE_URL = `https://${SITE.domain}`;

function upsertMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.append(tag);
  }
  tag.content = content;
}

function upsertLink(rel: string, href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.rel = rel;
    document.head.append(tag);
  }
  tag.href = href;
}

export interface SeoOptions {
  title: string;
  description?: string;
  /** Path only, e.g. "/blog/some-post". Combined with the site origin. */
  path?: string;
  /** "website" for pages, "article" for posts. */
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
  /** JSON-LD object emitted into a script tag and removed on unmount. */
  structuredData?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Prerender collection                                                       */
/* -------------------------------------------------------------------------- */

/**
 * During the prerender pass there is no document and effects never run, so the
 * options are collected synchronously as the tree renders and serialised into
 * the static HTML afterwards.
 *
 * A module-level slot is safe here because renderToString is synchronous and
 * single-threaded, and one render produces exactly one page.
 */
let collected: SeoOptions | null = null;

export function resetSeo(): void {
  collected = null;
}

export function getCollectedSeo(): SeoOptions | null {
  return collected;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/** Serialises collected options into head markup for the prerendered page. */
export function renderSeoTags(options: SeoOptions | null): string {
  if (!options) return '';

  const { title, description, path, type = 'website', publishedTime, modifiedTime, tags } = options;
  const fullTitle = `${title} · ${SITE.name}`;
  const url = path ? `${SITE_URL}${path}` : SITE_URL;
  const lines: string[] = [];

  lines.push(`<title>${escapeHtml(fullTitle)}</title>`);
  lines.push(`<link rel="canonical" href="${escapeHtml(url)}">`);
  lines.push(`<meta property="og:title" content="${escapeHtml(fullTitle)}">`);
  lines.push(`<meta property="og:type" content="${type}">`);
  lines.push(`<meta property="og:url" content="${escapeHtml(url)}">`);
  lines.push(`<meta name="twitter:title" content="${escapeHtml(fullTitle)}">`);

  if (description) {
    lines.push(`<meta name="description" content="${escapeHtml(description)}">`);
    lines.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
    lines.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
  }

  if (type === 'article') {
    if (publishedTime) {
      lines.push(`<meta property="article:published_time" content="${publishedTime}">`);
    }
    if (modifiedTime) {
      lines.push(`<meta property="article:modified_time" content="${modifiedTime}">`);
    }
    for (const tag of tags ?? []) {
      lines.push(`<meta property="article:tag" content="${escapeHtml(tag)}">`);
    }
  }

  if (options.structuredData) {
    // Only "<" needs neutralising inside a JSON-LD block; escaping the rest
    // would corrupt the JSON.
    const json = JSON.stringify(options.structuredData).replace(/</g, '\\u003c');
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }

  return lines.join('\n    ');
}

export function useSeo(options: SeoOptions): void {
  // Not a hook call, so the conditional is fine — and effects below still run
  // unconditionally on the client.
  if (typeof document === 'undefined') {
    collected = options;
  }

  const {
    title,
    description,
    path,
    type = 'website',
    publishedTime,
    modifiedTime,
    tags,
    structuredData,
  } = options;

  const serialisedTags = tags?.join(',');
  const serialisedData = structuredData ? JSON.stringify(structuredData) : undefined;

  useEffect(() => {
    const fullTitle = `${title} · ${SITE.name}`;
    document.title = fullTitle;

    const url = path ? `${SITE_URL}${path}` : SITE_URL;
    upsertLink('canonical', url);

    upsertMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    upsertMeta('meta[property="og:type"]', 'property', 'og:type', type);
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', url);
    upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);

    if (description) {
      upsertMeta('meta[name="description"]', 'name', 'description', description);
      upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
      upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    }

    // Article-only tags. Removed when navigating to a non-article route, so a
    // page does not inherit the previous post's publish date.
    const articleTags = document.head.querySelectorAll('meta[property^="article:"]');
    for (const tag of articleTags) tag.remove();

    if (type === 'article') {
      if (publishedTime) {
        upsertMeta(
          'meta[property="article:published_time"]',
          'property',
          'article:published_time',
          publishedTime
        );
      }
      if (modifiedTime) {
        upsertMeta(
          'meta[property="article:modified_time"]',
          'property',
          'article:modified_time',
          modifiedTime
        );
      }
      for (const tag of serialisedTags?.split(',').filter(Boolean) ?? []) {
        const meta = document.createElement('meta');
        meta.setAttribute('property', 'article:tag');
        meta.content = tag;
        document.head.append(meta);
      }
    }
  }, [title, description, path, type, publishedTime, modifiedTime, serialisedTags]);

  useEffect(() => {
    if (!serialisedData) return;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = serialisedData;
    document.head.append(script);

    return () => script.remove();
  }, [serialisedData]);
}

/** Thin wrapper kept for the pages that only need a title and description. */
export function usePageMeta(title: string, description?: string, path?: string): void {
  useSeo({ title, description, path });
}

export { SITE_URL };
