-- Firebase becomes the identity provider.
--
-- Two changes, both required before /api/auth/firebase can create an account.
--
-- 1. password_hash becomes nullable. An account created by Google sign-in has
--    no password in this database and never will. The column is kept rather
--    than dropped so any account created before this migration keeps working
--    through /api/auth/login, which now refuses a null hash explicitly instead
--    of letting "no password set" mean "any password accepted".
--
-- 2. firebase_uid, unique. Matched on in preference to email because email is
--    mutable at the provider and the uid is not — someone who changes their
--    Google address must land on the same row, not a second one.
--
-- The unique index is deliberately NOT partial. Postgres treats NULLs as
-- distinct in a unique index, so every pre-Firebase account can hold NULL here
-- without colliding, and a partial index would only add a condition that
-- changes nothing.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firebase_uid" text;

CREATE UNIQUE INDEX IF NOT EXISTS "users_firebase_uid_idx" ON "users" ("firebase_uid");
