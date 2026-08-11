/**
 * Site-wide facts that appear in legal copy and contact links.
 *
 * Not decoration. `contactEmail` is the address the privacy policy gives for
 * deletion requests, and `domain` is the canonical URL of every page on the
 * site — a wrong value there tells search engines the content belongs to
 * somewhere else. The Chrome Web Store review reads the policy page you
 * submit, so both have to be real before publishing.
 */
export const SITE = {
  name: 'jobpilot',
  /** Used in policy text as the responsible party. */
  legalEntity: 'jobpilot',
  contactEmail: 'bandanpradhan456@gmail.com',
  /**
   * Drives `SITE_URL`, and through it every canonical link and every
   * structured-data URL on the site. Must be the domain actually serving the
   * production build.
   */
  domain: 'jobpilot.app',
  /** Last substantive revision of the policy pages. */
  policyUpdated: '2026-08-05',
} as const;
