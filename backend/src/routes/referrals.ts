import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { canonicalizeProfileUrl, type ReferralAsk } from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { applications, companies, contacts } from '../db/schema.js';
import { toContactDto } from '../services/serialize.js';
import { requireAuth } from '../middleware/auth.js';
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
