-- Session revocation.
--
-- Tokens last 30 days by design — auth/jwt.ts sets out why, and being signed
-- out mid-application really is the worst moment to interrupt anyone. What was
-- missing is any way to end one early: signing out deleted the client's copy
-- and nothing else, so a token that leaked was simply valid for a month.
--
-- requireAuth now compares each token's `iat` against this column. One UPDATE
-- ends every session for one account, on every device.
--
-- DEFAULT now() rather than epoch, and NOT NULL: an existing row gets a cutoff
-- of "when this migration ran", which invalidates every token issued before
-- this deploy. That is a deliberate one-time sign-out of everyone — the tokens
-- predating this change were issued by a system with no revocation, which is
-- exactly the set worth retiring.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tokens_valid_from" timestamp with time zone DEFAULT now() NOT NULL;
