import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalizeProfileUrl, type ReferralAsk } from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { applicationEvents, applications, companies, contacts } from '../db/schema.js';
import { captureApplication } from '../services/capture.js';
import { toContactDto } from '../services/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { capturedJob } from '../validation/job.js';
import { normalizeProfileUrl } from '../validation/url.js';
import type { AppContext } from '../env.js';

/**
 * Every referral ask the user has, flat.
 *
 * The extension's lookup index. Writes stay on the per-application
 * sub-resource in `applications.ts`, where ownership already comes free from
 * `loadOwned`; this is read-only and exists because the question asked on a
 * LinkedIn profile — "is this person anywhere in my asks?" — spans every
 * application and cannot be answered one at a time.
 *
 * Ownership is enforced by the join, not by a filter on `contacts`. The table
 * has no `userId` of its own: an ask belongs to an application, and the
 * application belongs to a user. Joining through is the only correct check,
 * and doing it any other way here would be the kind of thing that leaks rows.
 */
export const referralRoutes = new Hono<AppContext>();

referralRoutes.use('*', requireAuth);

/**
 * Enough asks to cover anyone's history without an unbounded scan.
 *
 * There is no pagination and deliberately so: the client is building an index
 * to answer lookups offline, and half an index answers "no" for the missing
 * half — which is indistinguishable from "you never asked them" on the card.
 * A cap that cannot realistically be reached beats a page the caller might
 * forget to follow.
 */
const MAX_ASKS = 1000;

referralRoutes.get('/', async (c) => {
  const db = createDb(c.env);

  const rows = await db
    .select({ contact: contacts, application: applications, company: companies })
    .from(contacts)
    .innerJoin(applications, eq(contacts.applicationId, applications.id))
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .where(eq(applications.userId, c.get('userId')))
    .orderBy(desc(contacts.statusAt))
    .limit(MAX_ASKS);

  const referrals: ReferralAsk[] = rows.map((row) => ({
    ...toContactDto(row.contact),
    profileKey: canonicalizeProfileUrl(row.contact.linkedinUrl),
    application: {
      id: row.application.id,
      title: row.application.title,
      company: row.company.name,
      status: row.application.status as ReferralAsk['application']['status'],
      appliedAt: row.application.appliedAt?.toISOString() ?? null,
      jobUrl: row.application.jobUrl,
    },
  }));

  return c.json({ referrals });
});

/* ------------------------- log an ask from a page ------------------------ */

/**
 * Record an ask against whatever application this posting maps to, creating
 * one if there is none.
 *
 * WHY THIS IS NOT THE SUB-RESOURCE
 *
 * `POST /api/applications/:id/referrals` needs an application id, and at the
 * moment this is called there may not be an application at all: the panel
 * shows its referral searches on *every* posting, applied to or not, because a
 * referral submitted alongside the application beats one chasing it. The
 * resource this would be a child of does not exist yet, which is exactly when
 * a top-level endpoint is the honest shape.
 *
 * The application is created as SAVED — the status that already means "I am
 * tracking this, I have not applied". Blocking a referral on paperwork is
 * backwards: the ask is the time-sensitive half.
 *
 * `captureApplication` does the resolve-or-create, so this inherits the
 * canonical-URL lookup, the company upsert, duplicate flagging and the CREATED
 * event without a second implementation of any of them. `applied: false` is
 * load-bearing twice over: it is what makes a new row SAVED, and on an
 * existing row it leaves the status alone — `shouldPromote` is false, so
 * logging an ask can never downgrade an application already marked APPLIED.
 */
const logAskBody = z.object({
  job: capturedJob,
  name: z.string().min(1).max(200),
  role: z.string().max(200).nullable().optional(),
  linkedinUrl: z.string().max(2048).nullable().optional(),
  status: z.enum(['INVITED', 'ASKED']).default('INVITED'),
});

referralRoutes.post('/', async (c) => {
  const parsed = logAskBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid referral payload: ${parsed.error.issues[0]?.path.join('.')} ${
        parsed.error.issues[0]?.message
      }`,
    });
  }

  const db = createDb(c.env);
  const userId = c.get('userId');

  const capture = await captureApplication(db, userId, {
    job: parsed.data.job,
    applied: false,
    capturedAt: new Date().toISOString(),
  });

  const applicationId = capture.application.id;

  const [contact] = await db
    .insert(contacts)
    .values({
      applicationId,
      name: parsed.data.name.trim(),
      role: parsed.data.role?.trim() || null,
      linkedinUrl: normalizeProfileUrl(parsed.data.linkedinUrl),
      status: parsed.data.status,
    })
    .returning();

  await db.insert(applicationEvents).values({
    applicationId,
    type: 'CONTACT_ADDED',
    /*
     * EXTENSION, not USER. The user typed the name, but the extension is what
     * wrote the row and chose the application it hangs off — and if that
     * choice is ever wrong, the actor is the first thing worth reading in the
     * history. `application_events` is append-only precisely so this stays
     * answerable later.
     */
    actor: 'EXTENSION',
    payload: {
      contactId: contact.id,
      name: contact.name,
      status: contact.status,
      applicationCreated: capture.created,
    },
  });

  return c.json(
    {
      referral: {
        ...toContactDto(contact),
        profileKey: canonicalizeProfileUrl(contact.linkedinUrl),
        application: {
          id: applicationId,
          title: capture.application.title,
          company: capture.application.company.name,
          status: capture.application.status,
          appliedAt: capture.application.appliedAt,
          jobUrl: capture.application.jobUrl,
        },
      } satisfies ReferralAsk,
      /** True when this posting was not being tracked until now. */
      applicationCreated: capture.created,
    },
    201
  );
});
