import type { ProfileField } from '@jobpilot/shared';

/**
 * Field-matching rules.
 *
 * A rule maps signals on a form control to a profile key. Rules are scored,
 * not tried in order, because a single field usually matches several weak
 * patterns and only one strong one.
 *
 * Adding support for a new field is a rule here plus a key in the shared
 * Profile — no changes anywhere else in the extension.
 */

export interface FieldRule {
  field: ProfileField;
  /**
   * HTML autocomplete tokens. These are a spec-defined contract rather than a
   * guess at someone's naming convention, so a hit here outranks everything.
   */
  autocomplete?: string[];
  /** Matched against the combined signals (name, id, label, placeholder…). */
  patterns: RegExp[];
  /** Any hit here disqualifies the rule outright. */
  negative?: RegExp[];
  /** Restrict to certain control types where the field only makes sense there. */
  inputTypes?: string[];
  /**
   * Tie-breaker for genuinely ambiguous fields. Higher wins. Used sparingly:
   * "first name" must beat the looser "name" rule.
   */
  weight?: number;
}

/** Never touched, whatever the labels say. */
export const BLOCKED_PATTERNS: RegExp[] = [
  /\bpassword\b/,
  /\bpasscode\b/,
  /\bpin\b/,
  /\bssn\b/,
  /social.?security/,
  /\bcredit.?card\b/,
  /\bcard.?number\b/,
  /\bcvv\b/,
  /\bcvc\b/,
  /\bsecurity.?code\b/,
  /\bbank\b/,
  /\brouting\b/,
  /\biban\b/,
  /\bsort.?code\b/,
  /\btax.?id\b/,
  /\bpassport\b/,
  /\bnational.?id\b/,
  /date.?of.?birth/,
  /\bdob\b/,
];

export const BLOCKED_INPUT_TYPES = new Set(['password', 'hidden', 'file', 'submit', 'button', 'image', 'reset']);

export const FIELD_RULES: FieldRule[] = [
  {
    field: 'firstName',
    autocomplete: ['given-name'],
    patterns: [/first.?name/, /\bfname\b/, /given.?name/, /\bforename\b/],
    weight: 20,
  },
  {
    field: 'lastName',
    autocomplete: ['family-name'],
    patterns: [/last.?name/, /\blname\b/, /family.?name/, /\bsurname\b/],
    weight: 20,
  },
  {
    field: 'preferredName',
    patterns: [/preferred.?name/, /nick.?name/, /goes.?by/],
    weight: 25,
  },
  {
    field: 'fullName',
    autocomplete: ['name'],
    // Only the generic "name" field. The negatives keep it away from the
    // more specific name fields and from company/school name inputs.
    patterns: [/full.?name/, /your.?name/, /^name$/, /\bname\b/],
    negative: [
      /first/,
      /last/,
      /given/,
      /family/,
      /surname/,
      /preferred/,
      /nick/,
      /middle/,
      /company/,
      /employer/,
      /school/,
      /university/,
      /college/,
      /reference/,
      /user.?name/,
      /file.?name/,
    ],
    weight: 5,
  },
  {
    field: 'email',
    autocomplete: ['email'],
    patterns: [/\bemail\b/, /e-?mail/],
    negative: [/confirm/, /verify/, /reference/],
    inputTypes: ['email', 'text'],
    weight: 15,
  },
  {
    field: 'phone',
    autocomplete: ['tel', 'tel-national'],
    patterns: [/\bphone\b/, /\bmobile\b/, /\bcell\b/, /telephone/, /contact.?number/],
    negative: [/country.?code/, /extension/, /reference/],
    inputTypes: ['tel', 'text'],
    weight: 15,
  },

  {
    field: 'addressLine1',
    autocomplete: ['address-line1', 'street-address'],
    patterns: [/street.?address/, /address.?line.?1/, /^address$/],
    negative: [/email/, /line.?2/, /city/, /state/, /zip/, /postal/, /country/],
  },
  {
    field: 'city',
    autocomplete: ['address-level2'],
    patterns: [/\bcity\b/, /\btown\b/, /locality/],
    negative: [/state/, /country/],
    weight: 10,
  },
  {
    field: 'state',
    autocomplete: ['address-level1'],
    patterns: [/\bstate\b/, /province/, /\bregion\b/, /county/],
    negative: [/united.?states/, /statement/],
  },
  {
    field: 'postalCode',
    autocomplete: ['postal-code'],
    patterns: [/postal.?code/, /\bzip\b/, /post.?code/, /\bpincode\b/],
  },
  {
    field: 'country',
    autocomplete: ['country', 'country-name'],
    patterns: [/\bcountry\b/],
    negative: [/country.?code/],
  },

  {
    field: 'linkedinUrl',
    patterns: [/linked.?in/],
    weight: 25,
  },
  {
    field: 'githubUrl',
    patterns: [/git.?hub/, /\bgit\b/],
    weight: 25,
  },
  {
    field: 'portfolioUrl',
    patterns: [/portfolio/, /personal.?(web)?site/, /\bwebsite\b/, /\bblog\b/],
    negative: [/company.?website/, /linked/, /github/],
    weight: 12,
  },
  {
    field: 'otherUrl',
    patterns: [/other.?(url|link|website)/, /additional.?(url|link)/, /\btwitter\b/, /\bx\.com\b/],
    weight: 8,
  },

  {
    field: 'currentCompany',
    patterns: [/current.?(company|employer)/, /^company$/, /\bemployer\b/, /present.?company/],
    negative: [/why/, /about/, /size/, /reference/],
    weight: 10,
  },
  {
    field: 'currentTitle',
    patterns: [/current.?(title|role|position)/, /job.?title/, /^title$/, /occupation/],
    negative: [/why/, /desired/, /reference/],
    weight: 10,
  },

  {
    field: 'authorizedToWork',
    patterns: [
      /legally.?authorized/,
      /authorized.?to.?work/,
      /eligible.?to.?work/,
      /right.?to.?work/,
      /work.?authorization/,
    ],
    weight: 30,
  },
  {
    field: 'requiresSponsorship',
    patterns: [/sponsor/, /visa.?support/, /require.?sponsorship/, /immigration.?status/],
    weight: 30,
  },
  {
    field: 'willingToRelocate',
    patterns: [/relocat/, /willing.?to.?move/],
    weight: 30,
  },
  {
    field: 'noticePeriod',
    patterns: [/notice.?period/, /how.?soon.?can.?you.?start/, /available.?start.?date/, /availability/],
    weight: 20,
  },
  {
    field: 'salaryExpectation',
    patterns: [
      /salary.?expectation/,
      /expected.?(salary|compensation)/,
      /compensation.?expectation/,
      /desired.?(salary|compensation|pay)/,
    ],
    weight: 25,
  },
  {
    field: 'referralSource',
    patterns: [/how.?did.?you.?hear/, /referral.?source/, /where.?did.?you.?find/, /how.?you.?found/],
    weight: 25,
  },

  // Opt-in only; the matcher drops these unless demographics are enabled.
  {
    field: 'gender',
    patterns: [/\bgender\b/, /\bsex\b/],
    negative: [/gender.?identity.?statement/],
    weight: 20,
  },
  {
    field: 'ethnicity',
    patterns: [/ethnic/, /\brace\b/, /racial/, /hispanic/],
    weight: 20,
  },
  {
    field: 'veteranStatus',
    patterns: [/veteran/, /military/, /protected.?veteran/],
    weight: 20,
  },
  {
    field: 'disabilityStatus',
    patterns: [/disabilit/, /\bdisabled\b/],
    weight: 20,
  },
];
