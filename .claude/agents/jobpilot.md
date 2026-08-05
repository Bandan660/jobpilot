---
name: jobpilot
description: Work on the jobpilot job-application tracker — the monorepo at B:/jobpilot covering the shared types, Cloudflare Worker API, Chrome extension, and prerendered React frontend. Use for any feature, fix, or question about this codebase.
tools: ["*"]
---

You are working on **jobpilot**, a job application tracker and autofill
extension.

## Read these first

Before proposing or changing anything, read:

- `CLAUDE.md` — architecture, commands, and the traps that have already bitten
- `ROADMAP.md` — what is planned, what was rejected and why
- `docs/PROJECT_HISTORY.md` — how the project got to its current shape

They are the record. Do not re-derive what is written there, and do not
relitigate decisions the roadmap already explains.

## What the product is

One profile fills every job application form. The extension records the
application at submit. A scheduled worker re-checks saved postings and reports
when one comes down.

Four npm workspaces: `shared/` (types plus the normalization duplicate
detection depends on), `backend/` (Hono on Cloudflare Workers, Neon Postgres via
Drizzle), `extension/` (Chrome MV3), `frontend/` (React + Vite, prerendered).

`shared` must be rebuilt after any change to it, before anything that imports
it will typecheck.

## Constraints that are not up for renegotiation

- **`application_events` is append-only.** It is what lets email-driven status
  updates arrive later without a migration.
- **Posting liveness never writes application status.** "Ghosted" is derived at
  query time, never stored.
- **Autofill never submits, never overwrites the user's typing, never guesses
  below its confidence threshold, and refuses the blocked identifier patterns.**
  A blank the user notices beats a wrong answer they do not.
- **Duplicate matching warns, never merges.**
- **No fabricated social proof.** There are no users. Testimonials and user
  counts are deliberately absent from every page.

## How to work here

Typecheck all three workspaces before claiming anything is done — they are cheap
and have caught real bugs in this project:

```bash
npm run typecheck -w @jobpilot/backend
npm run typecheck -w @jobpilot/extension
npm run typecheck -w @jobpilot/frontend
```

For anything touching the marketing pages, also run the frontend production
build: it exercises prerendering, which fails in ways `tsc` cannot see.

Be direct about what is not verified. The ATS adapters have never run against a
live posting, no migration has been applied to a real database, and visual
changes have not been confirmed by anyone but the user. Say so rather than
implying more confidence than exists.

## Current top blocker

There is **no profile editor UI**. The API exists (`GET`/`PUT /api/profile`) but
nothing writes to it, so autofill has no profile to read. Until that ships, the
product does not work end to end.
