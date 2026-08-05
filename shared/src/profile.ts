/**
 * The one profile that autofill reads from.
 *
 * Everything here is data the user typed once so they never retype it. It is
 * deliberately flat and boring: the autofill matcher maps form fields onto
 * these keys, so adding a field means adding a key here and a rule in the
 * extension's rules table, and nothing else.
 */

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

export interface Education {
  id: string;
  school: string;
  degree: string | null;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
  gpa: string | null;
}

/**
 * Answers to the open-ended questions that repeat across applications
 * ("why do you want to work here?", notice period, salary expectation).
 * Keyed by a normalized form of the question text.
 */
export interface SavedAnswer {
  id: string;
  /** Normalized question, used for lookup. */
  key: string;
  /** The question as it was originally seen, for display. */
  label: string;
  answer: string;
}

/**
 * Voluntary self-identification fields (EEO in the US, similar elsewhere).
 *
 * Held separately from the rest of the profile because it is sensitive
 * category data: it is opt-in, defaults to off, and autofill skips the entire
 * group unless the user has explicitly enabled it.
 */
export interface Demographics {
  enabled: boolean;
  gender: string | null;
  ethnicity: string | null;
  veteranStatus: string | null;
  disabilityStatus: string | null;
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

  /** Work authorization. Null means "prefer not to answer / leave blank". */
  authorizedToWork: boolean | null;
  requiresSponsorship: boolean | null;
  willingToRelocate: boolean | null;
  /** Free text, e.g. "2 weeks" or "immediately". */
  noticePeriod: string | null;
  salaryExpectation: string | null;
  /** How they heard about the role — a near-universal dropdown. */
  referralSource: string | null;

  experience: WorkExperience[];
  education: Education[];
  savedAnswers: SavedAnswer[];
  demographics: Demographics;

  createdAt: string;
  updatedAt: string;
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
  'noticePeriod',
  'salaryExpectation',
  'referralSource',
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

export type ProfileInput = Partial<
  Omit<Profile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
>;

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

/**
 * Resolve a profile field to the string that should go into a form.
 * Returns null when there is nothing to fill, which the filler treats as
 * "leave this field alone" rather than "clear it".
 */
export function profileValue(profile: Profile, field: ProfileField): string | null {
  const yesNo = (value: boolean | null): string | null =>
    value === null ? null : value ? 'Yes' : 'No';

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
