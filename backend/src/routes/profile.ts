import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  EDUCATION_LEVELS,
  EMPLOYMENT_TYPE,
  EMPTY_AVAILABILITY,
  EMPTY_COMPENSATION,
  EMPTY_DEMOGRAPHICS,
  PAY_PERIODS,
  PROFILE_REGIONS,
  SCORE_TYPES,
  STUDY_MODES,
  answerKey,
  type Profile,
} from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

const nullableText = (max: number) => z.string().max(max).nullable().optional();

const moneySchema = z.object({
  // Minor units. Bounded generously — annual packages in weaker currencies run
  // to eight or nine figures without being implausible.
  amountCents: z.number().int().min(0).max(1e15).nullable(),
  currency: z.string().max(8).nullable(),
  period: z.enum(PAY_PERIODS).nullable(),
});

const compensationSchema = z.object({
  current: moneySchema,
  expected: moneySchema,
});

const availabilitySchema = z.object({
  noticePeriodDays: z.number().int().min(0).max(365).nullable(),
  servingNotice: z.boolean().nullable(),
  lastWorkingDay: z.string().max(10).nullable(),
  earliestStartDate: z.string().max(10).nullable(),
});

const experienceSchema = z.object({
  id: z.string().max(64),
  company: z.string().max(200),
  title: z.string().max(200),
  startDate: z.string().max(10).nullable(),
  endDate: z.string().max(10).nullable(),
  current: z.boolean(),
  location: z.string().max(200).nullable(),
  description: z.string().max(4000).nullable(),
  // Optional, not just nullable: rows written before this field existed do not
  // carry the key at all, and requiring it would reject every one of them.
  employmentType: z.enum(EMPLOYMENT_TYPE).nullable().optional(),
});

const educationSchema = z.object({
  id: z.string().max(64),
  school: z.string().max(200),
  level: z.enum(EDUCATION_LEVELS).nullable(),
  degree: z.string().max(200).nullable(),
  field: z.string().max(200).nullable(),
  startDate: z.string().max(10).nullable(),
  endDate: z.string().max(10).nullable(),
  score: z.string().max(20).nullable(),
  scoreType: z.enum(SCORE_TYPES).nullable(),
  // Optional for the same reason as employmentType: rows predating the field
  // do not carry the key, and requiring it would reject every one of them.
  studyMode: z.enum(STUDY_MODES).nullable().optional(),
});

const savedAnswerSchema = z.object({
  id: z.string().max(64),
  key: z.string().max(200).optional(),
  label: z.string().max(500),
  answer: z.string().max(8000),
});

/**
 * Nullable but not optional: this object is stored whole, so an absent key and
 * a null value must not be different states. `nullableText` is for top-level
 * columns, where a missing key correctly means "leave unchanged".
 */
const demographicsSchema = z.object({
  enabled: z.boolean(),
  gender: z.string().max(100).nullable(),
  ethnicity: z.string().max(100).nullable(),
  veteranStatus: z.string().max(100).nullable(),
  disabilityStatus: z.string().max(100).nullable(),
});

const profileSchema = z.object({
  firstName: nullableText(100),
  lastName: nullableText(100),
  preferredName: nullableText(100),
  email: nullableText(254),
  phone: nullableText(40),

  addressLine1: nullableText(200),
  city: nullableText(100),
  state: nullableText(100),
  postalCode: nullableText(20),
  country: nullableText(100),

  linkedinUrl: nullableText(500),
  githubUrl: nullableText(500),
  portfolioUrl: nullableText(500),
  otherUrl: nullableText(500),

  currentCompany: nullableText(200),
  currentTitle: nullableText(200),

  authorizedToWork: z.boolean().nullable().optional(),
  requiresSponsorship: z.boolean().nullable().optional(),
  willingToRelocate: z.boolean().nullable().optional(),
  referralSource: nullableText(200),

  workAuthCountries: z.array(z.string().max(3)).max(40).optional(),
  preferredLocations: z.array(z.string().max(120)).max(20).optional(),
  regions: z.array(z.enum(PROFILE_REGIONS)).max(PROFILE_REGIONS.length).optional(),

  compensation: compensationSchema.optional(),
  availability: availabilitySchema.optional(),

  skills: z.array(z.string().max(80)).max(150).optional(),
  languages: z.array(z.string().max(60)).max(40).optional(),

  experience: z.array(experienceSchema).max(40).optional(),
  education: z.array(educationSchema).max(20).optional(),
  savedAnswers: z.array(savedAnswerSchema).max(200).optional(),
  demographics: demographicsSchema.optional(),

  resumeFileName: nullableText(260),
  /*
   * 20k characters is about eight pages of CV — past any real resume, and a
   * bound worth having on a column the client fills. It feeds a dictionary
   * lookup, so the tail of a longer document would change no answer anyway.
   * The client truncates to the same figure; this is the half that is enforced.
   */
  resumeText: nullableText(20_000),
  /**
   * Boolean rather than a timestamp: the client says "onboarding is finished",
   * the server decides when that was. A client-supplied completion time would
   * be trivially forgeable and is not worth trusting for something that gates
   * routing.
   */
  onboardingComplete: z.boolean().optional(),
});

type ProfileRow = typeof profiles.$inferSelect;

/**
 * Merges stored jsonb over the empty shapes.
 *
 * Rows written before a field existed will be missing it, so the defaults are
 * spread underneath rather than trusting whatever is in the column.
 */
function toDto(row: ProfileRow): Profile {
  return {
    ...row,
    workAuthCountries: row.workAuthCountries ?? [],
    preferredLocations: row.preferredLocations ?? [],
    regions: row.regions ?? [],
    compensation: {
      current: { ...EMPTY_COMPENSATION.current, ...row.compensation?.current },
      expected: { ...EMPTY_COMPENSATION.expected, ...row.compensation?.expected },
    },
    availability: { ...EMPTY_AVAILABILITY, ...row.availability },
    skills: row.skills ?? [],
    languages: row.languages ?? [],
    experience: row.experience ?? [],
    education: row.education ?? [],
    savedAnswers: row.savedAnswers ?? [],
    demographics: { ...EMPTY_DEMOGRAPHICS, ...row.demographics },
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const profileRoutes = new Hono<AppContext>();

profileRoutes.use('*', requireAuth);

/** The extension calls this before every autofill, so it must stay cheap. */
profileRoutes.get('/', async (c) => {
  const db = createDb(c.env);
  const userId = c.get('userId');

  const [existing] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (existing) return c.json({ profile: toDto(existing) });

  // Create on first read so the client never has to handle a missing profile.
  const [created] = await db
    .insert(profiles)
    .values({
      userId,
      demographics: EMPTY_DEMOGRAPHICS,
      compensation: EMPTY_COMPENSATION,
      availability: EMPTY_AVAILABILITY,
    })
    .returning();

  return c.json({ profile: toDto(created) });
});

profileRoutes.put('/', async (c) => {
  const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HTTPException(400, {
      message: `Invalid profile: ${issue?.path.join('.')} ${issue?.message}`,
    });
  }

  const db = createDb(c.env);
  const userId = c.get('userId');
  const input = parsed.data;

  // Pulled out of the spread rather than overwritten in place: the parsed
  // shape has `key` optional, and the raw array leaking through would store
  // answers the matcher can never look up. `onboardingComplete` is a request
  // flag, not a column, so it comes out here too.
  const {
    savedAnswers: submitted,
    experience: roles,
    education: schools,
    onboardingComplete,
    ...rest
  } = input;

  // Recompute answer keys server-side. The extension looks answers up by key,
  // so letting a client send its own would let one bad write break matching
  // for every future form.
  const savedAnswers = submitted?.map((answer) => ({
    ...answer,
    key: answerKey(answer.label),
  }));

  /*
   * employmentType is optional in the request so older clients and rows
   * without it still validate, but the stored shape requires an explicit
   * null. Spreading the parsed array straight in would leave the key absent,
   * which is a different state from "not answered" and does not typecheck.
   */
  const experience = roles?.map((role) => ({
    ...role,
    employmentType: role.employmentType ?? null,
  }));

  const education = schools?.map((entry) => ({
    ...entry,
    studyMode: entry.studyMode ?? null,
  }));

  const values = {
    ...rest,
    ...(experience ? { experience } : {}),
    ...(education ? { education } : {}),
    ...(savedAnswers ? { savedAnswers } : {}),
    // Only ever set, never cleared: finishing onboarding is not something a
    // later profile edit should undo.
    ...(onboardingComplete ? { onboardingCompletedAt: new Date() } : {}),
    updatedAt: new Date(),
  } satisfies Partial<typeof profiles.$inferInsert>;

  const [row] = await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values })
    .returning();

  return c.json({ profile: toDto(row) });
});
