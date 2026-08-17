-- Referral asks, phase 1. See docs/REFERRALS.md.
--
-- `contacts` shipped in 0000 and nothing has ever read or written it — no
-- route, no dashboard code, no extension code. So this is finishing
-- scaffolding rather than new ground, and because the table is empty the two
-- columns need no backfill and no default that has to be reasoned about.
--
-- WHY text AND NOT AN ENUM
--
-- A TypeScript union is not a Postgres enum. `LINKEDIN` was added to
-- ATS_PROVIDER and never to the database type; zod validated every request
-- against the TS union so nothing caught it, and the insert then died on
-- `invalid input value for enum ats_provider` — which onError turns into a
-- generic 500. Saving any LinkedIn posting reported "Something went wrong"
-- with nothing anywhere pointing at the enum.
--
-- This status set is small, user-owned, and still being designed. Storing it
-- as text with zod validating at the edge means adding a value is a one-line
-- change in shared/, not a migration that cannot run inside its own
-- transaction. The check constraint is deliberately absent for the same
-- reason.
--
-- The default is INVITED because that is what the form's first option writes,
-- and status_at defaults to now() because the follow-up clock counts from it.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'INVITED';
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "status_at" timestamp with time zone NOT NULL DEFAULT now();

-- The queue query is "what is due", which sorts by status_at within a status.
CREATE INDEX IF NOT EXISTS "contacts_status_idx" ON "contacts" ("status","status_at");
