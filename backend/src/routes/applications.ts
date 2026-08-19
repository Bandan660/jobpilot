import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  APPLICATION_STATUS,
  EMPLOYMENT_TYPE,
  REFERRAL_ACCEPTED,
  REFERRAL_STATUS,
  canonicalizeJobUrl,
  normalizeCompany,
  normalizeTitle,
  parseCompensation,
  type ApplicationStatus,
} from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { applicationEvents, applications, companies, contacts, notes } from '../db/schema.js';
import { toApplicationDto, toContactDto, toEventDto } from '../services/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { httpUrl, normalizeProfileUrl } from '../validation/url.js';
import type { AppContext } from '../env.js';

/**
 * Reaching any of these from APPLIED means the employer got back to the user,
 * which is what firstResponseAt records. It drives response-rate and
 * time-to-response stats, so it must be set exactly once, on the first move.
 */
const RESPONSE_STATUSES: readonly ApplicationStatus[] = ['SCREEN', 'INTERVIEW', 'OFFER', 'REJECTED'];

/**
 * Referral counts for the tracker row, as correlated subqueries.
 *
 * A left join with a GROUP BY would work too and would drag every other
 * selected column into the grouping — including the whole application row —
 * for two integers. These stay out of the way of the existing query entirely,
 * which matters because that query already carries seven optional filters.
 *
 * The "accepted" list is built from `REFERRAL_ACCEPTED` rather than written
 * out here, so the number on the row and the number the UI would compute from
 * the same statuses cannot drift.
 */
const referralCountSql = sql<number>`(
  select count(*)::int from ${contacts}
  where ${contacts.applicationId} = ${applications.id}
)`;

const referralAcceptedSql = sql<number>`(
  select count(*)::int from ${contacts}
  where ${contacts.applicationId} = ${applications.id}
    and ${contacts.status} in (${sql.join(
      REFERRAL_ACCEPTED.map((status) => sql`${status}`),
      sql`, `
    )})
)`;

/**
 * How many rows the filters match, before the page is taken.
 *
 * A window function rather than a second `count(*)` query. Postgres evaluates
 * it after WHERE and before LIMIT/OFFSET, so it is the total the pager needs,
 * and it costs nothing extra: a separate count would be a second round trip to
 * Neon over HTTP, and every one of those counts against the Worker's 50
 * subrequest budget.
 *
 * The price is that it rides on every row of the page and is absent when the
 * page is empty. See the note where it is returned.
 */
const totalSql = sql<number>`count(*) over()`;

export const applicationRoutes = new Hono<AppContext>();

applicationRoutes.use('*', requireAuth);

/* ------------------------------- list ---------------------------------- */

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().max(200).optional(),
  /** "false" (default), "true", or "all". */
  archived: z.enum(['true', 'false', 'all']).default('false'),
  starred: z.enum(['true', 'false']).optional(),
  /** Inclusive ISO dates filtering on appliedAt. */
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  sort: z.enum(['recent', 'applied', 'company', 'stage']).default('recent'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

applicationRoutes.get('/', async (c) => {
  const parsed = listQuery.safeParse(c.req.query());
  if (!parsed.success) throw new HTTPException(400, { message: 'Invalid query parameters' });

  const { status, q, archived, starred, from, to, sort, limit, offset } = parsed.data;
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

  const order = {
    recent: desc(applications.updatedAt),
    applied: desc(applications.appliedAt),
    company: asc(companies.name),
    // Furthest through the pipeline first. The enum is declared in stage order,
    // so its ordinal is the sort key.
    stage: desc(applications.status),
  }[sort];

  const rows = await db
    .select({
      application: applications,
      company: companies,
      referralCount: referralCountSql,
      referralAccepted: referralAcceptedSql,
      total: totalSql,
    })
    .from(applications)
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(
      and(
        eq(applications.userId, userId),
        archived === 'all' ? undefined : eq(applications.archived, archived === 'true'),
        starred ? eq(applications.starred, starred === 'true') : undefined,
        statuses.length > 0 ? inArray(applications.status, statuses) : undefined,
        from ? gte(applications.appliedAt, new Date(from)) : undefined,
        // Inclusive: a "to" of 2026-08-07 must include that whole day.
        to ? lte(applications.appliedAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
        q ? or(ilike(applications.title, `%${q}%`), ilike(companies.name, `%${q}%`)) : undefined
      )
    )
    .orderBy(order)
    .limit(limit)
    .offset(offset);

  return c.json({
    applications: rows.map((r) =>
      toApplicationDto(r.application, r.company, {
        count: r.referralCount,
        accepted: r.referralAccepted,
      })
    ),
    /*
     * Row count before the page was taken, from the window function above.
     *
     * Zero when the page is past the end — there is no row to carry the count
     * on. Callers must treat an empty page at a non-zero offset as "step back",
     * not as "you have no applications"; the tracker does exactly that.
     */
    total: rows[0]?.total ?? 0,
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

  const [eventRows, noteRows, contactRows] = await Promise.all([
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
    db
      .select()
      .from(contacts)
      .where(eq(contacts.applicationId, row.application.id))
      // Oldest first: an ask list reads as a history of who was approached and
      // when, and reversing it puts the newest name above the one that has
      // been waiting longest.
      .orderBy(asc(contacts.createdAt))
      .limit(100),
  ]);

  return c.json({
    application: toApplicationDto(row.application, row.company, {
      count: contactRows.length,
      accepted: contactRows.filter((r) =>
        (REFERRAL_ACCEPTED as readonly string[]).includes(r.status)
      ).length,
    }),
    events: eventRows.map(toEventDto),
    notes: noteRows.map((n) => ({
      id: n.id,
      applicationId: n.applicationId,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
    })),
    referrals: contactRows.map(toContactDto),
  });
});

/* ------------------------------ create ---------------------------------- */

const createBody = z.object({
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  jobUrl: httpUrl(2048).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPE).nullable().optional(),
  resumeId: z.string().uuid().nullable().optional(),
  status: z.enum(APPLICATION_STATUS).default('APPLIED'),
  appliedAt: z.string().max(30).nullable().optional(),
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
      employmentType: input.employmentType ?? null,
      resumeId: input.resumeId ?? null,
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

/* ------------------------------ import ---------------------------------- */

const importBody = z.object({
  rows: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        company: z.string().min(1).max(200),
        status: z.enum(APPLICATION_STATUS).optional(),
        appliedAt: z.string().max(30).nullable().optional(),
        jobUrl: httpUrl(2048).nullable().optional(),
        location: z.string().max(200).nullable().optional(),
        employmentType: z.enum(EMPLOYMENT_TYPE).nullable().optional(),
      })
    )
    .min(1)
    .max(500),
});

/**
 * Bulk import, for applications made before signing up.
 *
 * Rows are inserted one at a time rather than in a single statement so one bad
 * row cannot fail the whole file — the response reports what landed and what
 * did not, which is the difference between a usable importer and a frustrating
 * one. Duplicate URLs are skipped rather than erroring, since re-importing the
 * same export is a normal thing to do.
 */
applicationRoutes.post('/import', async (c) => {
  const parsed = importBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid import payload' });
  }

  const db = createDb(c.env);
  const userId = c.get('userId');

  let imported = 0;
  let skipped = 0;
  const failures: { row: number; reason: string }[] = [];

  for (const [index, row] of parsed.data.rows.entries()) {
    try {
      const slug = normalizeCompany(row.company) || 'unknown';
      await db
        .insert(companies)
        .values({ name: row.company, slug })
        .onConflictDoNothing({ target: companies.slug });
      const [company] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);

      const canonical = canonicalizeJobUrl(row.jobUrl ?? null);
      if (canonical) {
        const [existing] = await db
          .select({ id: applications.id })
          .from(applications)
          .where(
            and(eq(applications.userId, userId), eq(applications.jobUrlCanonical, canonical))
          )
          .limit(1);
        if (existing) {
          skipped += 1;
          continue;
        }
      }

      const status = row.status ?? 'APPLIED';
      const appliedAt = row.appliedAt ? new Date(row.appliedAt) : null;

      const [created] = await db
        .insert(applications)
        .values({
          userId,
          companyId: company.id,
          title: row.title,
          titleSlug: normalizeTitle(row.title),
          location: row.location ?? null,
          employmentType: row.employmentType ?? null,
          jobUrl: row.jobUrl ?? null,
          jobUrlCanonical: canonical,
          status,
          source: 'IMPORT',
          appliedAt:
            appliedAt && !Number.isNaN(appliedAt.getTime())
              ? appliedAt
              : status === 'SAVED'
                ? null
                : new Date(),
        })
        .returning();

      await db.insert(applicationEvents).values({
        applicationId: created.id,
        type: 'CREATED',
        actor: 'USER',
        toStatus: status,
        payload: { imported: true },
      });

      imported += 1;
    } catch (error) {
      failures.push({
        row: index + 1,
        reason: error instanceof Error ? error.message : 'Could not import',
      });
    }
  }

  return c.json({ imported, skipped, failures });
});

/* ------------------------------ update ---------------------------------- */

const patchBody = z.object({
  status: z.enum(APPLICATION_STATUS).optional(),
  title: z.string().min(1).max(300).optional(),
  location: z.string().max(200).nullable().optional(),
  compRaw: z.string().max(500).nullable().optional(),
  archived: z.boolean().optional(),
  starred: z.boolean().optional(),
  resumeId: z.string().uuid().nullable().optional(),
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
      archived: input.archived ?? current.archived,
      resumeId: input.resumeId !== undefined ? input.resumeId : current.resumeId,
      starred: input.starred ?? current.starred,
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

/* ----------------------------- referrals -------------------------------- */

/*
 * Referral asks, as a sub-resource of the application they are about.
 *
 * A top-level /api/referrals was the other option and it would have had to
 * re-derive ownership on every call. Here `loadOwned` already answers "is this
 * the caller's application", and the ask cannot exist without one — the grain
 * is deliberately per-application, so the person asked about two roles is two
 * rows. See docs/REFERRALS.md.
 *
 * Every write also appends to `application_events`, which is what makes an ask
 * show up in the application's own history without a second thing to read.
 * `CONTACT_ADDED` already exists in EVENT_TYPE, so none of this needs an enum
 * migration — the trap that took LinkedIn capture down for months.
 */

const referralBody = z.object({
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  linkedinUrl: z.string().max(2048).nullable().optional(),
  /*
   * Only the two the form offers. The rest of the lifecycle is reached by
   * PATCH, because "I sent a request" and "they replied" are different events
   * with different timestamps, and letting a create claim REFERRED would
   * record an outcome with no history behind it.
   */
  status: z.enum(['INVITED', 'ASKED']).default('INVITED'),
});

applicationRoutes.post('/:id/referrals', async (c) => {
  const parsed = referralBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: 'A name is required' });

  const db = createDb(c.env);
  const applicationId = c.req.param('id');
  await loadOwned(db, c.get('userId'), applicationId);

  const [contact] = await db
    .insert(contacts)
    .values({
      applicationId,
      name: parsed.data.name.trim(),
      role: parsed.data.role?.trim() || null,
      email: parsed.data.email?.trim() || null,
      linkedinUrl: normalizeProfileUrl(parsed.data.linkedinUrl),
      status: parsed.data.status,
    })
    .returning();

  await db.insert(applicationEvents).values({
    applicationId,
    type: 'CONTACT_ADDED',
    actor: 'USER',
    payload: { contactId: contact.id, name: contact.name, status: contact.status },
  });

  return c.json({ referral: toContactDto(contact) }, 201);
});

const referralPatch = z.object({
  status: z.enum(REFERRAL_STATUS).optional(),
  name: z.string().min(1).max(200).optional(),
  role: z.string().max(200).nullable().optional(),
  linkedinUrl: z.string().max(2048).nullable().optional(),
});

applicationRoutes.patch('/:id/referrals/:referralId', async (c) => {
  const parsed = referralPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(400, { message: 'Invalid referral update' });

  const db = createDb(c.env);
  const applicationId = c.req.param('id');
  await loadOwned(db, c.get('userId'), applicationId);

  const [existing] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.id, c.req.param('referralId')), eq(contacts.applicationId, applicationId))
    )
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: 'Referral not found' });

  const statusChanged = parsed.data.status !== undefined && parsed.data.status !== existing.status;

  const [updated] = await db
    .update(contacts)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.role !== undefined ? { role: parsed.data.role?.trim() || null } : {}),
      ...(parsed.data.linkedinUrl !== undefined
        ? { linkedinUrl: normalizeProfileUrl(parsed.data.linkedinUrl) }
        : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      /*
       * Only moved when the status actually moved. Re-stamping it on a name
       * correction would restart the follow-up clock on an ask that has been
       * waiting four days, which is exactly when the reminder matters most.
       */
      ...(statusChanged ? { statusAt: new Date() } : {}),
    })
    .where(eq(contacts.id, existing.id))
    .returning();

  if (statusChanged) {
    await db.insert(applicationEvents).values({
      applicationId,
      type: 'CONTACT_ADDED',
      actor: 'USER',
      payload: {
        contactId: updated.id,
        name: updated.name,
        fromStatus: existing.status,
        status: updated.status,
      },
    });
  }

  return c.json({ referral: toContactDto(updated) });
});

applicationRoutes.delete('/:id/referrals/:referralId', async (c) => {
  const db = createDb(c.env);
  const applicationId = c.req.param('id');
  await loadOwned(db, c.get('userId'), applicationId);

  await db
    .delete(contacts)
    .where(
      and(eq(contacts.id, c.req.param('referralId')), eq(contacts.applicationId, applicationId))
    );

  /*
   * The events stay. `application_events` is append-only regardless of cause,
   * and a deleted ask still happened — the history reading "asked Priya, then
   * removed the row" is more use than a gap.
   */
  return c.body(null, 204);
});
