import { z } from 'zod';
import { ATS_PROVIDER, CAPTURE_LIMITS, EMPLOYMENT_TYPE } from '@jobpilot/shared';
import { httpUrl } from './url.js';

/**
 * A scraped posting, as the extension sends it.
 *
 * Lifted out of `routes/capture.ts` when logging a referral ask also needed to
 * accept one. Two copies of this would drift, and the drift shows up as a 400
 * on one endpoint and not the other — over a payload the extension builds in
 * exactly one place.
 *
 * Limits come from `shared` so the extension can clamp to the same numbers
 * before sending, for the same reason.
 */
export const capturedJob = z.object({
  jobUrl: httpUrl(CAPTURE_LIMITS.jobUrl),
  title: z.string().max(CAPTURE_LIMITS.title).nullable(),
  company: z.string().max(CAPTURE_LIMITS.company).nullable(),
  location: z.string().max(CAPTURE_LIMITS.location).nullable(),
  remote: z.boolean().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPE).nullable(),
  externalId: z.string().max(CAPTURE_LIMITS.externalId).nullable(),
  ats: z.enum(ATS_PROVIDER),
  compRaw: z.string().max(CAPTURE_LIMITS.compRaw).nullable(),
  adapterVersion: z.string().max(CAPTURE_LIMITS.adapterVersion),
});
