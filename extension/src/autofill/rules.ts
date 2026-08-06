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

/**
 * Never touched, whatever the labels say.
 *
 * Covers government identifiers across every market the extension runs in, not
 * just the US. Writing a national ID into a form the user has not read is the
 * worst thing this extension could do, so the list is deliberately broad and
 * errs toward refusing a field it could have safely filled.
 *
 * Word boundaries matter here: /\bpan\b/ must not fire on "company" or
 * "panel", and it does not, because \b requires a non-word character on both
 * sides.
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  // Credentials
  /\bpassword\b/,
  /\bpasscode\b/,
  /\bpin\b/,
  /\bsecurity.?question\b/,
  /mother'?s.?maiden/,

  // Payment and banking
  /\bcredit.?card\b/,
  /\bcard.?number\b/,
  /\bcvv\b/,
  /\bcvc\b/,
  /\bsecurity.?code\b/,
  /\bbank\b/,
  /\brouting\b/,
  /\biban\b/,
  /\bswift\b/,
  /\bbic\b/,
  /\bsort.?code\b/,
  /\bifsc\b/,
  /\bupi\b/,

  // Government identifiers — United States and Canada
  /\bssn\b/,
  /social.?security/,
  /\bsin\b/,
  /social.?insurance/,

  // United Kingdom and Ireland
  /national.?insurance/,
  /\bni\s*(number|no)\b/,
  /\bnino\b/,
  /\bppsn\b/,

  // India
  /\baadhaar\b/,
  /\baadhar\b/,
  /\buidai\b/,
  /\bpan\b/,
  /\bpan.?card\b/,
  /\buan\b/,
  /\bpf.?(number|no|account)\b/,

  // Europe
  /\bnif\b/,
  /\bnie\b/,
  /\bbsn\b/,
  /codice.?fiscale/,
  /steuer.?id/,
  /\binsz\b/,

  // Elsewhere
  /\btfn\b/,
  /\bcpf\b/,
  /\bcnpj\b/,
  /\brfc\b/,
  /\bcurp\b/,

  // Generic identity documents
  /\btax.?id\b/,
  /\bpassport\b/,
  /\bnational.?id/,
  /\bidentity.?(card|number)\b/,
  /driv(ing|er'?s).?licen[cs]e/,
  /\bvisa.?number\b/,
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
  /*
   * Pay. "Expected" must outrank "current" on a form that asks for both, so
   * each rule carries the other as a negative rather than relying on order.
   */
  {
    field: 'expectedCompensation',
    patterns: [
      /expected.?(ctc|salary|compensation|package|pay)/,
      /desired.?(salary|compensation|pay|ctc)/,
      /salary.?expectation/,
      /compensation.?expectation/,
      /salary.?required/,
    ],
    negative: [/current/, /present/, /existing/],
    weight: 30,
  },
  {
    field: 'currentCompensation',
    patterns: [
      /current.?(ctc|salary|compensation|package|pay)/,
      /present.?(ctc|salary|compensation)/,
      /existing.?(ctc|salary)/,
      /\bctc\b/,
    ],
    negative: [/expected/, /desired/, /required/],
    weight: 28,
  },

  {
    field: 'noticePeriod',
    patterns: [/notice.?period/, /\bnotice\b/, /how.?soon.?can.?you.?(join|start)/],
    negative: [/last.?working/, /notice.?board/],
    weight: 26,
  },
  {
    field: 'lastWorkingDay',
    patterns: [/last.?working.?(day|date)/, /\blwd\b/, /last.?date.?of.?employment/],
    weight: 30,
  },
  {
    field: 'earliestStartDate',
    patterns: [
      /earliest.?(start|joining|available)/,
      /available.?(to.?)?start/,
      /joining.?date/,
      /start.?date/,
      /availability/,
    ],
    negative: [/notice/, /previous/, /employment.?start/],
    weight: 18,
  },

  {
    field: 'totalExperience',
    patterns: [
      /total.?(work.?|professional.?)?experience/,
      /years.?of.?experience/,
      /\byoe\b/,
      /experience.?in.?years/,
      /relevant.?experience/,
    ],
    negative: [/describe/, /tell.?us/],
    weight: 24,
  },

  {
    field: 'skills',
    patterns: [/skills?/, /technical.?skills/, /key.?skills/, /technologies/],
    negative: [/soft.?skill.?example/, /describe/],
    weight: 20,
  },
  {
    field: 'languages',
    patterns: [/languages?.?(known|spoken)/, /^languages?$/, /languages/],
    negative: [/programming/],
    weight: 22,
  },
  {
    field: 'preferredLocations',
    patterns: [/preferred.?(location|city|work.?location)/, /desired.?location/, /location.?preference/],
    weight: 26,
  },

  /* Education. Scores are gated to the markets that ask for them. */
  {
    field: 'highestQualification',
    patterns: [/highest.?(qualification|education|degree)/, /education.?level/, /qualification\b/],
    negative: [/percentage|marks|score|year/],
    weight: 22,
  },
  {
    field: 'graduationYear',
    patterns: [
      /(passing|passout|pass.?out|graduation|completion).?year/,
      /year.?of.?(passing|graduation|completion)/,
      /\bbatch\b/,
    ],
    weight: 26,
  },
  {
    field: 'secondaryScore',
    patterns: [/\b(10th|tenth|sslc|matriculation|class.?x)\b/, /secondary.?(school.?)?(percentage|marks)/],
    negative: [/12th|twelfth/],
    weight: 28,
  },
  {
    field: 'higherSecondaryScore',
    patterns: [/\b(12th|twelfth|hsc|intermediate|class.?xii)\b/, /higher.?secondary/],
    weight: 28,
  },
  {
    field: 'graduationScore',
    patterns: [
      /(graduation|degree|bachelor|\bug\b).?(percentage|marks|cgpa|gpa|score|aggregate)/,
      /(cgpa|gpa)\b/,
    ],
    negative: [/10th|12th|tenth|twelfth|sslc|hsc/],
    weight: 24,
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
