import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { ATS_PROVIDER, type DuplicateCheckResponse } from '@jobpilot/shared';
import { createDb } from '../db/client.js';
import { captureApplication } from '../services/capture.js';
import { findDuplicates } from '../services/duplicates.js';
import { requireAuth } from '../middleware/auth.js';
import type { AppContext } from '../env.js';

const capturedJob = z.object({
  jobUrl: z.string().url().max(2048),
  title: z.string().max(300).nullable(),
  company: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  remote: z.boolean().nullable(),
  externalId: z.string().max(200).nullable(),
  ats: z.enum(ATS_PROVIDER),
  compRaw: z.string().max(500).nullable(),
  adapterVersion: z.string().max(50),
});

const captureRequest = z.object({
  job: capturedJob,
  applied: z.boolean(),
  capturedAt: z.string().datetime(),
});

const duplicateCheckRequest = z.object({
  jobUrl: z.string().url().max(2048),
  company: z.string().max(200).nullable().optional(),
  title: z.string().max(300).nullable().optional(),
});

export const captureRoutes = new Hono<AppContext>();

captureRoutes.use('*', requireAuth);

/** Extension calls this on submit (applied=true) or bookmark (applied=false). */
captureRoutes.post('/', async (c) => {
  const parsed = captureRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `Invalid capture payload: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
    });
  }

  const db = createDb(c.env);
  const result = await captureApplication(db, c.get('userId'), parsed.data);
  return c.json(result, result.created ? 201 : 200);
});

/**
 * Read-only duplicate probe, called while the user is still looking at the
 * posting. Must stay side-effect free -- it fires on page load.
 */
captureRoutes.post('/check-duplicate', async (c) => {
  const parsed = duplicateCheckRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid duplicate check payload' });
  }

  const db = createDb(c.env);
  const matches = await findDuplicates(db, c.get('userId'), {
    jobUrl: parsed.data.jobUrl,
    company: parsed.data.company ?? null,
    title: parsed.data.title ?? null,
  });

  const body: DuplicateCheckResponse = { matches };
  return c.json(body);
});
