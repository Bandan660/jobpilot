import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { answerKey, type Profile } from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

const nullableText = (max: number) => z.string().max(max).nullable().optional();

const experienceSchema = z.object({
  id: z.string().max(64),
  company: z.string().max(200),
  title: z.string().max(200),
  startDate: z.string().max(10).nullable(),
  endDate: z.string().max(10).nullable(),
  current: z.boolean(),
  location: z.string().max(200).nullable(),
  description: z.string().max(4000).nullable(),
});

const educationSchema = z.object({
  id: z.string().max(64),
  school: z.string().max(200),
  degree: z.string().max(200).nullable(),
  field: z.string().max(200).nullable(),
  startDate: z.string().max(10).nullable(),
  endDate: z.string().max(10).nullable(),
  gpa: z.string().max(20).nullable(),
});

const savedAnswerSchema = z.object({
  id: z.string().max(64),
  key: z.string().max(200).optional(),
  label: z.string().max(500),
  answer: z.string().max(8000),
});

const demographicsSchema = z.object({
  enabled: z.boolean(),
  gender: nullableText(100),
  ethnicity: nullableText(100),
  veteranStatus: nullableText(100),
  disabilityStatus: nullableText(100),
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
  noticePeriod: nullableText(200),
  salaryExpectation: nullableText(200),
  referralSource: nullableText(200),

  experience: z.array(experienceSchema).max(40).optional(),
  education: z.array(educationSchema).max(20).optional(),
  savedAnswers: z.array(savedAnswerSchema).max(200).optional(),
  demographics: demographicsSchema.optional(),
});

const EMPTY_DEMOGRAPHICS = {
  enabled: false,
  gender: null,
  ethnicity: null,
  veteranStatus: null,
  disabilityStatus: null,
};

type ProfileRow = typeof profiles.$inferSelect;

function toDto(row: ProfileRow): Profile {
  return {
    ...row,
    experience: (row.experience ?? []) as Profile['experience'],
    education: (row.education ?? []) as Profile['education'],
    savedAnswers: (row.savedAnswers ?? []) as Profile['savedAnswers'],
    demographics: {
      ...EMPTY_DEMOGRAPHICS,
      ...(row.demographics as object),
    } as Profile['demographics'],
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
    .values({ userId, demographics: EMPTY_DEMOGRAPHICS })
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

  // Recompute answer keys server-side. The extension looks answers up by key,
  // so letting a client send its own would let one bad write break matching
  // for every future form.
  const savedAnswers = input.savedAnswers?.map((answer) => ({
    ...answer,
    key: answerKey(answer.label),
  }));

  const values = {
    ...input,
    ...(savedAnswers ? { savedAnswers } : {}),
    updatedAt: new Date(),
  };

  const [row] = await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values })
    .returning();

  return c.json({ profile: toDto(row) });
});
