import type { PayPeriod } from './normalize.js';

/**
 * The one profile that autofill reads from.
 *
 * Structured as a global core plus optional groups, rather than a single
 * superset of every market's fields. Nobody in Berlin should scroll past
 * "10th standard percentage", and nobody in Mumbai should be shown a US EEO
 * block — so groups are opt-in and the matcher skips a field entirely when its
 * group is off.
 */

/** Markets whose forms ask for materially different things. */
export const PROFILE_REGIONS = ['US', 'IN', 'UK', 'EU', 'CA', 'AU'] as const;
export type ProfileRegion = (typeof PROFILE_REGIONS)[number];

export interface WorkExperience {
  id: string;
  company: string;
  title: string;
  /** ISO yyyy-MM. Month precision is all any application form asks for. */
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  location: string | null;
  description: string | null;
}

/**
 * Qualification level. Present so 10th/12th results are ordinary education
 * entries rather than bolted-on Indian-only columns — the same shape covers
 * A-levels, the Abitur, and a US high school diploma.
 */
export const EDUCATION_LEVELS = [
  'SECONDARY',
  'HIGHER_SECONDARY',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'DOCTORATE',
  'CERTIFICATION',
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

/** Grading systems differ enough that the number alone is meaningless. */
export const SCORE_TYPES = ['PERCENTAGE', 'GPA', 'CGPA', 'GRADE'] as const;
export type ScoreType = (typeof SCORE_TYPES)[number];

export interface Education {
  id: string;
  school: string;
  level: EducationLevel | null;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
  score: string | null;
  scoreType: ScoreType | null;
}

export interface SavedAnswer {
  id: string;
  /** Normalized question, used for lookup. */
  key: string;
  /** The question as it was originally seen, for display. */
  label: string;
  answer: string;
}

/**
 * Voluntary self-identification (EEO in the US, similar elsewhere).
 *
 * Sensitive category data: opt-in, off by default, and autofill skips the whole
 * group unless explicitly enabled.
 */
export interface Demographics {
  enabled: boolean;
  gender: string | null;
  ethnicity: string | null;
  veteranStatus: string | null;
  disabilityStatus: string | null;
}

export interface MoneyAmount {
  /** Minor units, to avoid float drift. */
  amountCents: number | null;
  currency: string | null;
  period: PayPeriod | null;
}

/**
 * Current and expected pay.
 *
 * Global rather than an Indian "CTC" group: every market asks some version of
 * this, and the only real differences are cadence and currency, both of which
 * are already fields.
 */
export interface CompensationProfile {
  current: MoneyAmount;
  expected: MoneyAmount;
}

export interface AvailabilityProfile {
  /** Days of notice owed. 0 means immediately available. */
  noticePeriodDays: number | null;
  servingNotice: boolean | null;
  /** ISO date. Only meaningful while serving notice. */
  lastWorkingDay: string | null;
  earliestStartDate: string | null;
}

export interface Profile {
  id: string;
  userId: string;

  firstName: string | null;
  lastName: string | null;
  /** Kept separate: some forms have one "full name" field instead of two. */
  preferredName: string | null;
  email: string | null;
  phone: string | null;

  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;

  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  otherUrl: string | null;

  /** Current or most recent role, for the single-line variants forms ask for. */
  currentCompany: string | null;
  currentTitle: string | null;

  /** Null means "prefer not to answer / leave blank". */
  authorizedToWork: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  /** ISO country codes the user can work in without sponsorship. */
  workAuthCountries: string[];
  preferredLocations: string[];
  /** How they heard about the role — a near-universal dropdown. */
  referralSource: string | null;

  compensation: CompensationProfile;
  availability: AvailabilityProfile;

  experience: WorkExperience[];
  education: Education[];
  savedAnswers: SavedAnswer[];
  demographics: Demographics;

  /** Optional groups the user has switched on. Drives what autofill will fill. */
  regions: ProfileRegion[];

  /**
   * Set when the user finishes onboarding. Null means they have not, and the
   * app routes them back into it — autofill with an empty profile is worse
   * than no autofill, because it looks like it worked.
   */
  onboardingCompletedAt: string | null;
  /** Original filename of the resume the profile was parsed from, if any. */
  resumeFileName: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Onboarding steps, in order.
 *
 * Every step exists to fill fields autofill will later need. Deliberately
 * absent: anything that only serves job matching or our own analytics — this
 * product does not match people to jobs, and a question the user answers for
 * our benefit is a question that should not be asked.
 */
export const ONBOARDING_STEPS = [
  'resume',
  'about',
  'links',
  'eligibility',
  'availability',
  'done',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** True once every field autofill depends on has a usable value. */
export function profileReadiness(profile: Profile): {
  complete: number;
  total: number;
  missing: string[];
} {
  const checks: [string, unknown][] = [
    ['First name', profile.firstName],
    ['Last name', profile.lastName],
    ['Email', profile.email],
    ['Phone', profile.phone],
    ['City', profile.city],
    ['Country', profile.country],
    ['LinkedIn', profile.linkedinUrl],
    ['Work authorization', profile.authorizedToWork],
    ['Sponsorship', profile.requiresSponsorship],
    ['Notice period', profile.availability.noticePeriodDays],
    ['Work experience', profile.experience.length > 0 || null],
  ];

  const missing = checks.filter(([, value]) => value === null || value === '').map(([name]) => name);
  return { complete: checks.length - missing.length, total: checks.length, missing };
}

/** Every profile key the autofill matcher can target. */
export const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'city',
  'state',
  'postalCode',
  'country',
  'linkedinUrl',
  'githubUrl',
  'portfolioUrl',
  'otherUrl',
  'currentCompany',
  'currentTitle',
  'authorizedToWork',
  'requiresSponsorship',
  'willingToRelocate',
  'preferredLocations',
  'referralSource',
  'currentCompensation',
  'expectedCompensation',
  'noticePeriod',
  'lastWorkingDay',
  'earliestStartDate',
  'totalExperience',
  'highestQualification',
  'graduationYear',
  'secondaryScore',
  'higherSecondaryScore',
  'graduationScore',
  'gender',
  'ethnicity',
  'veteranStatus',
  'disabilityStatus',
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** Fields that come from the opt-in demographics group. */
export const DEMOGRAPHIC_FIELDS: readonly ProfileField[] = [
  'gender',
  'ethnicity',
  'veteranStatus',
  'disabilityStatus',
];

/**
 * Fields only worth filling in certain markets. A field listed here is skipped
 * unless the user has that region enabled, which is what stops a German form
 * being offered a school-leaving percentage.
 */
export const REGION_FIELDS: Partial<Record<ProfileField, ProfileRegion[]>> = {
  secondaryScore: ['IN'],
  higherSecondaryScore: ['IN'],
  graduationScore: ['IN'],
  lastWorkingDay: ['IN'],
  gender: ['US'],
  ethnicity: ['US'],
  veteranStatus: ['US'],
  disabilityStatus: ['US'],
};

export type ProfileInput = Partial<Omit<Profile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export const EMPTY_MONEY: MoneyAmount = { amountCents: null, currency: null, period: null };

export const EMPTY_DEMOGRAPHICS: Demographics = {
  enabled: false,
  gender: null,
  ethnicity: null,
  veteranStatus: null,
  disabilityStatus: null,
};

export const EMPTY_COMPENSATION: CompensationProfile = {
  current: { ...EMPTY_MONEY },
  expected: { ...EMPTY_MONEY },
};

export const EMPTY_AVAILABILITY: AvailabilityProfile = {
  noticePeriodDays: null,
  servingNotice: null,
  lastWorkingDay: null,
  earliestStartDate: null,
};

/**
 * A blank profile, minus the server-assigned identifiers and timestamps.
 * Used by clients that need something to render before the real one loads.
 */
export const EMPTY_PROFILE: Omit<Profile, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  firstName: null,
  lastName: null,
  preferredName: null,
  email: null,
  phone: null,
  addressLine1: null,
  city: null,
  state: null,
  postalCode: null,
  country: null,
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  otherUrl: null,
  currentCompany: null,
  currentTitle: null,
  authorizedToWork: null,
  requiresSponsorship: null,
  willingToRelocate: null,
  workAuthCountries: [],
  preferredLocations: [],
  referralSource: null,
  compensation: EMPTY_COMPENSATION,
  availability: EMPTY_AVAILABILITY,
  experience: [],
  education: [],
  savedAnswers: [],
  demographics: EMPTY_DEMOGRAPHICS,
  regions: [],
  onboardingCompletedAt: null,
  resumeFileName: null,
};

/** Normalizes a question so the same prompt matches across employers. */
export function answerKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s*\*\s*$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/* -------------------------------------------------------------------------- */
/* Derived values                                                             */
/* -------------------------------------------------------------------------- */

const LEVEL_RANK: Record<EducationLevel, number> = {
  SECONDARY: 1,
  HIGHER_SECONDARY: 2,
  CERTIFICATION: 3,
  DIPLOMA: 4,
  BACHELORS: 5,
  MASTERS: 6,
  DOCTORATE: 7,
};

function highestEducation(profile: Profile): Education | null {
  return profile.education.reduce<Education | null>((best, entry) => {
    if (!entry.level) return best;
    if (!best?.level) return entry;
    return LEVEL_RANK[entry.level] > LEVEL_RANK[best.level] ? entry : best;
  }, null);
}

function educationAt(profile: Profile, level: EducationLevel): Education | null {
  return profile.education.find((entry) => entry.level === level) ?? null;
}

/** Total months of work experience, from the experience entries. */
export function totalExperienceMonths(profile: Profile): number {
  let months = 0;

  for (const role of profile.experience) {
    if (!role.startDate) continue;
    const start = new Date(`${role.startDate}-01`);
    const end = role.current || !role.endDate ? new Date() : new Date(`${role.endDate}-01`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    months += Math.max(
      0,
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
    );
  }

  return months;
}

/**
 * Format a stored amount for a form field.
 *
 * When the label itself asks for lakhs — "Current CTC (LPA)" — the figure is
 * converted, because typing 1800000 into a field expecting 18 is exactly the
 * kind of silent wrong answer autofill must not produce.
 */
function formatMoney(money: MoneyAmount, label = ''): string | null {
  if (money.amountCents === null) return null;
  const units = money.amountCents / 100;

  if (/\b(lpa|lakh|lakhs|lac|lacs)\b/i.test(label)) {
    const lakhs = units / 1e5;
    return Number.isInteger(lakhs) ? String(lakhs) : lakhs.toFixed(2).replace(/\.?0+$/, '');
  }

  return String(Math.round(units));
}

/**
 * Resolve a profile field to the string that should go into a form.
 *
 * Returns null when there is nothing to fill, which the filler treats as
 * "leave this field alone" rather than "clear it". `label` is the visible
 * question, used only where the wording changes the expected format.
 */
export function profileValue(
  profile: Profile,
  field: ProfileField,
  label = ''
): string | null {
  const yesNo = (value: boolean | null): string | null =>
    value === null ? null : value ? 'Yes' : 'No';

  // Regional gate: a field tied to markets the user has not enabled is not
  // theirs to fill, however confidently it matched.
  const regions = REGION_FIELDS[field];
  if (regions && !regions.some((region) => profile.regions.includes(region))) {
    return null;
  }

  switch (field) {
    case 'fullName': {
      const parts = [profile.firstName, profile.lastName].filter(Boolean);
      return parts.length ? parts.join(' ') : null;
    }
    case 'authorizedToWork':
      return yesNo(profile.authorizedToWork);
    case 'requiresSponsorship':
      return yesNo(profile.requiresSponsorship);
    case 'willingToRelocate':
      return yesNo(profile.willingToRelocate);

    case 'preferredLocations':
      return profile.preferredLocations.length ? profile.preferredLocations.join(', ') : null;

    case 'currentCompensation':
      return formatMoney(profile.compensation.current, label);
    case 'expectedCompensation':
      return formatMoney(profile.compensation.expected, label);

    case 'noticePeriod': {
      const days = profile.availability.noticePeriodDays;
      if (days === null) return null;
      if (days === 0) return 'Immediate';
      // Forms usually phrase this in whichever unit their label uses.
      if (/\bmonths?\b/i.test(label)) return String(Math.round(days / 30));
      if (/\bweeks?\b/i.test(label)) return String(Math.round(days / 7));
      return String(days);
    }
    case 'lastWorkingDay':
      return profile.availability.lastWorkingDay;
    case 'earliestStartDate':
      return profile.availability.earliestStartDate;

    case 'totalExperience': {
      const months = totalExperienceMonths(profile);
      if (months <= 0) return null;
      if (/\bmonths?\b/i.test(label)) return String(months);
      return String(Math.floor(months / 12));
    }

    case 'highestQualification': {
      const entry = highestEducation(profile);
      return entry?.degree ?? entry?.level ?? null;
    }
    case 'graduationYear': {
      const entry = highestEducation(profile);
      return entry?.endDate ? entry.endDate.slice(0, 4) : null;
    }
    case 'secondaryScore':
      return educationAt(profile, 'SECONDARY')?.score ?? null;
    case 'higherSecondaryScore':
      return educationAt(profile, 'HIGHER_SECONDARY')?.score ?? null;
    case 'graduationScore':
      return educationAt(profile, 'BACHELORS')?.score ?? null;

    case 'gender':
      return profile.demographics.enabled ? profile.demographics.gender : null;
    case 'ethnicity':
      return profile.demographics.enabled ? profile.demographics.ethnicity : null;
    case 'veteranStatus':
      return profile.demographics.enabled ? profile.demographics.veteranStatus : null;
    case 'disabilityStatus':
      return profile.demographics.enabled ? profile.demographics.disabilityStatus : null;

    default:
      return (profile[field as keyof Profile] as string | null) ?? null;
  }
}
