/**
 * A URL safe to put in an `href`, or undefined.
 *
 * React does not protect you here. Through React 18 a `javascript:` URL in an
 * href logs a deprecation warning and renders anyway, so any stored string
 * reaching an anchor is a script the reader runs by clicking a link that looks
 * like a link.
 *
 * Three places render URLs this application did not author:
 *
 * - the admin dashboard's report links, and `POST /api/reports` takes writes
 *   from anyone at all, with no account;
 * - the tracker's role links, from captured postings and from CSV imports.
 *
 * The API validates the scheme on the way in now, but that cannot help with
 * rows written before it did, and "the server checked" is the wrong thing for
 * a renderer to assume anyway. Undefined rather than a placeholder: an anchor
 * with no href is inert, still shows its text, and needs no styling decision.
 */
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    // Not absolute, so not something to link to from here.
    return undefined;
  }
}
