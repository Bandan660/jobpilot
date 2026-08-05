import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  APPLICATION_STATUS,
  canonicalizeJobUrl,
  normalizeCompany,
  normalizeTitle,
  parseCompensation,
  type ApplicationStatus,
} from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { applicationEvents, applications, companies, notes } from '../db/schema.js';
import { toApplicationDto, toEventDto } from '../services/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

/**
 * Reaching any of these from APPLIED means the employer got back to the user,
 * which is what firstResponseAt records. It drives response-rate and
 * time-to-response stats, so it must be set exactly once, on the first move.
 */
const RESPONSE_STATUSES: readonly ApplicationStatus[] = ['SCREEN', 'INTERVIEW', 'OFFER', 'REJECTED'];

export const applicationRoutes = new Hono<AppContext>();

applicationRoutes.use('*', requireAuth);

/* ------------------------------- list ---------------------------------- */

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

applicationRoutes.get('/', async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: 'Invalid query parameters' });

  const { status, q, limit, offset } = parsed.data;
  const db = createDb(c.env);
  const userId = c.get('userId');

  const statuses = status
    ? status
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s): s is ApplicationStatus =>
          (APPLICATION_STATUS as readonly string[]).includes(s)
        )
    : [];

  const rows = await db
    .select({ application: applications, company: companies })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(applications.userId, userId),
        statuses.length > 0 ? inArray(applications.status, statuses) : undefined,
        q ? or(ilike(applications.title, `%${q}%`), ilike(companies.name, `%${q}%`)) : undefined
      )
    )
    .orderBy(desc(applications.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    applications: rows.map((r) => toApplicationDto(r.application, r.company)),
    limit,
    offset,
  });
});

/* -------------------------------- get ----------------------------------- */

async function loadOwned(db: ReturnType<typeof createDb>, userId: string, id: string) {
  const [row] = await db
    .select({ application: applications, company: companies })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .limit(1);

  // 404 rather than 403 for someone else's row: confirming a row exists would
  // leak that another user has it.
  if (!row) throw new HTTPException(404, { message: 'Application not found' });
  return row;
}

applicationRoutes.get('/:id', async (c) => {
  const db = createDb(c.env);
  const row = await loadOwned(db, c.get('userId'), c.req.param('id'));

  const [eventRows, noteRows] = await Promise.all([
    db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, row.application.id))
      .orderBy(desc(applicationEvents.occurredAt))
      .limit(100),
    db
      .select()
      .from(notes)
      .where(eq(notes.applicationId, row.application.id))
      .orderBy(desc(notes.createdAt))
      .limit(100),
  ]);

  return c.json({
    application: toApplicationDto(row.application, row.company),
    events: eventRows.map(toEventDto),
    notes: noteRows.map((n) => ({
      id: n.id,
      applicationId: n.applicationId,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

/* ------------------------------ create ---------------------------------- */

const createBody = z.object({
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  jobUrl: z.string().url().max(2048).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  status: z.enum(APPLICATION_STATUS).default('APPLIED'),
  appliedAt: z.string().datetime().nullable().optional(),
  compRaw: z.string().max(500).nullable().optional(),
});

applicationRoutes.post('/', async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const db = createDb(c.env);
  const userId = c.get('userId');
  const input = parsed.data;

  const slug = normalizeCompany(input.company) || 'unknown';
  await db
    .insert(companies)
    .values({ name: input.company, slug })
    .onConflictDoNothing({ target: companies.slug });
  const [company] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);

  const comp = parseCompensation(input.compRaw ?? null);
  const appliedAt = input.appliedAt
    ? new Date(input.appliedAt)
    : input.status === 'SAVED'
      ? null
      : new Date();

  const [created] = await db
    .insert(applications)
    .values({
      userId,
      companyId: company.id,
      title: input.title,
      titleSlug: normalizeTitle(input.title),
      location: input.location ?? null,
      jobUrl: input.jobUrl ?? null,
      jobUrlCanonical: canonicalizeJobUrl(input.jobUrl ?? null),
      status: input.status,
      source: 'WEB_MANUAL',
      appliedAt,
      compRaw: input.compRaw ?? null,
      compMinCents: comp.minCents,
      compMaxCents: comp.maxCents,
      compCurrency: comp.currency,
    })
    .returning();

  await db.insert(applicationEvents).values({
    applicationId: created.id,
    type: 'CREATED',
    actor: 'USER',
    toStatus: created.status as ApplicationStatus,
  });

  return c.json({ application: toApplicationDto(created, company) }, 201);
});

/* ------------------------------ update ---------------------------------- */

const patchBody = z.object({
  status: z.enum(APPLICATION_STATUS).optional(),
  title: z.string().min(1).max(300).optional(),
  location: z.string().max(200).nullable().optional(),
  compRaw: z.string().max(500).nullable().optional(),
});

applicationRoutes.patch('/:id', async (c) => {
  const parsed = patchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const db = createDb(c.env);
  const userId = c.get('userId');
  const { application: current, company } = await loadOwned(db, userId, c.req.param('id'));
  const input = parsed.data;

  const nextStatus = input.status ?? (current.status as ApplicationStatus);
  const statusChanged = nextStatus !== current.status;

  // Record the first employer response, once. A later move to another response
  // status must not overwrite the original timestamp.
  const firstResponseAt =
    current.firstResponseAt ??
    (statusChanged && RESPONSE_STATUSES.includes(nextStatus) && current.appliedAt
      ? new Date()
      : null);

  const comp = input.compRaw !== undefined ? parseCompensation(input.compRaw) : null;

  const [updated] = await db
    .update(applications)
    .set({
      status: nextStatus,
      title: input.title ?? current.title,
      titleSlug: input.title ? normalizeTitle(input.title) : current.titleSlug,
      location: input.location !== undefined ? input.location : current.location,
      compRaw: input.compRaw !== undefined ? input.compRaw : current.compRaw,
      compMinCents: comp ? comp.minCents : current.compMinCents,
      compMaxCents: comp ? comp.maxCents : current.compMaxCents,
      compCurrency: comp ? comp.currency : current.compCurrency,
      // Moving to a non-SAVED status for the first time backfills appliedAt.
      appliedAt:
        current.appliedAt ?? (nextStatus !== 'SAVED' && statusChanged ? new Date() : null),
      firstResponseAt,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, current.id))
    .returning();

  if (statusChanged) {
    await db.insert(applicationEvents).values({
      applicationId: current.id,
      type: 'STATUS_CHANGED',
      actor: 'USER',
      fromStatus: current.status as ApplicationStatus,
      toStatus: nextStatus,
    });
  }

  return c.json({ application: toApplicationDto(updated, company) });
});

applicationRoutes.delete('/:id', async (c) => {
  const db = createDb(c.env);
  const userId = c.get('userId');
  await loadOwned(db, userId, c.req.param('id'));

  await db.delete(applications).where(eq(applications.id, c.req.param('id')));
  return c.body(null, 204);
});

/* ------------------------------- notes ---------------------------------- */

applicationRoutes.post('/:id/notes', async (c) => {
  const parsed = z
    .object({ body: z.string().min(1).max(10_000) })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: 'Note body is required' });

  const db = createDb(c.env);
  const userId = c.get('userId');
  await loadOwned(db, userId, c.req.param('id'));

  const [note] = await db
    .insert(notes)
    .values({ applicationId: c.req.param('id'), body: parsed.data.body })
    .returning();

  await db.insert(applicationEvents).values({
    applicationId: note.applicationId,
    type: 'NOTE_ADDED',
    actor: 'USER',
    payload: { noteId: note.id },
  });

  return c.json(
    {
      note: {
        id: note.id,
        applicationId: note.applicationId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      },
    },
    201
  );
});
