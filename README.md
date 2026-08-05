# jobpilot

A job application tracker that updates itself.

You apply to a job; the browser extension captures it. A duplicate warning fires
*before* you re-apply somewhere you already did. A scheduled worker re-checks
your saved postings and tells you when one comes down — which usually means the
role was filled or frozen while you were still waiting.

Everything runs on free tiers.

---

## Architecture

```
shared/      TypeScript contract: domain types + the normalization used for dedupe
backend/     Cloudflare Worker (Hono) + Neon Postgres (Drizzle) + Cron Trigger
frontend/    React + Vite dashboard
extension/   Chrome MV3 extension: capture, duplicate warning, manual save
```

The reason this is a TypeScript monorepo rather than three projects: the
extension and the API must agree *exactly* on how a job URL is canonicalized
and how company/title names are normalized. If they ever disagree, duplicate
detection silently stops working. Those functions live in `shared/src/normalize.ts`
and are compiled into both.

### Two design decisions worth knowing

**`application_events` is append-only.** Every status change is written there
regardless of what caused it — user, extension, or system. Nothing updates or
deletes rows. This is what makes Gmail-driven auto-status a pure addition
later: an email ingester writes `STATUS_CHANGED` rows with `actor='EMAIL'` and
no other code changes. It also gives time-between-stage analytics for free.

**Posting liveness and application status are separate columns.** A posting
coming down is evidence about the *role*; the application status is a fact about
the *candidate*. The dead-posting worker only ever writes `postingStatus` — it
never touches user-owned state. "Ghosted" is derived at query time from the two,
never stored, so a late reply can't leave a stale label behind.

---

## Setup

### 1. Database (Neon — free, no card)

Create a project at [neon.tech](https://neon.tech) and copy the **pooled**
connection string (the host contains `-pooler`).

> You need Neon even for local development. The `@neondatabase/serverless`
> driver talks HTTP to Neon specifically — it cannot point at a local Postgres
> instance. Using the same database in dev and prod also means no driver
> divergence to debug later.

```bash
cp backend/.dev.vars.example backend/.dev.vars
# paste DATABASE_URL, and generate a JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 2. Install and push the schema

```bash
npm install
npm run build:shared          # extension/backend/frontend all import this

cd backend
$env:DATABASE_URL = (Select-String -Path .dev.vars -Pattern '^DATABASE_URL="(.+)"').Matches.Groups[1].Value
npx drizzle-kit push
```

On bash: `export DATABASE_URL=$(grep DATABASE_URL .dev.vars | cut -d'"' -f2)`

### 3. Run it

```bash
npm run dev:api      # Worker on http://localhost:8787
npm run dev:web      # dashboard on http://localhost:5173
npm run build:extension
```

Then load the extension: `chrome://extensions` → enable **Developer mode** →
**Load unpacked** → select `extension/dist`.

Open the extension popup, create an account, and visit any Greenhouse, Lever,
or Ashby posting.

---

## How capture works

1. The content script matches the URL against an adapter (`extension/src/adapters/`).
2. It extracts the job — **JSON-LD first**, CSS selectors only to fill gaps.
   Most ATSs emit schema.org `JobPosting` markup for Google Jobs indexing, and
   that markup is contractual. Selectors break on every redesign; JSON-LD doesn't.
3. It asks the API whether you've applied here before, and shows a banner if so.
4. It watches for a submit — either a form submission carrying a file/email
   input, or confirmation text appearing in the DOM.
5. On submit it POSTs to `/api/capture`, which is idempotent per
   `(user, canonical URL)` thanks to a partial unique index. A double-fire
   updates rather than duplicating.

### Adding another ATS

Write an adapter implementing `JobAdapter`, register it in
`extension/src/adapters/index.ts`, and add the host to **both** `matches` and
`host_permissions` in `manifest.json`. Nothing else changes.

---

## Known limits

These are real, and you'll hit them in this order:

**Workers free tier caps CPU at 10ms per request, and PBKDF2 password hashing
exceeds that.** Signup and login may fail on the free plan. The fix is the $5/mo
Workers Paid plan — *not* lowering the iteration count, which would trade a real
security property for a hosting bill. Every other endpoint is well under the
limit. Test this early; it's the one thing that could force a paid plan before
you have users.

**The ATS adapters have not been tested against live pages.** Selectors and
submit detection are written from the documented structure of each platform,
but Greenhouse, Lever, and Ashby all render differently across accounts. Expect
to adjust selectors the first time you apply to a real job with this installed.
JSON-LD extraction should carry most of the load; the selectors are the fallback.

**Submit detection is heuristic.** A form counts as an application if it
contains a file or email input. This biases toward missing a capture rather than
recording a false one — a bogus row silently corrupts your tracker, while a miss
is fixable from the popup's "Save this job".

**Neon's free tier scales to zero**, so the first query after an idle period
takes ~500ms.

**The cron sweep is bounded by subrequests.** Workers allows 50 per invocation
and every Neon query counts, so the batch defaults to 15 postings per run
(every 6 hours). Raising `POSTING_CHECK_BATCH_SIZE` past ~40 will start failing
runs.

---

## Deploying

```bash
cd backend
npx wrangler secret put DATABASE_URL
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Set `CORS_ORIGINS` in `wrangler.toml` to your deployed dashboard URL.

Frontend → Cloudflare Pages, build command `npm run build -w @jobpilot/frontend`,
output `frontend/dist`, with `VITE_API_BASE_URL` set to the Worker URL.

For the extension, add the Worker URL to `host_permissions` in `manifest.json`
and set the API base URL in the popup under **Advanced**.

Publishing to the Chrome Web Store needs a one-time $5 developer registration,
and real icons — `extension/icons/` currently holds generated placeholders from
`scripts/gen-icons.mjs`.

---

## Not built yet

Deliberately out of scope for v1:

- **Gmail auto-status.** The highest-value feature, and the schema is already
  shaped for it. Needs Google OAuth; `gmail.readonly` is a restricted scope
  requiring a CASA security assessment for production (fine in testing mode up
  to 100 users).
- **Response intelligence** — cross-user median response time and ghost rate per
  company. `applications_company_stats_idx` exists to serve it. Worthless until
  there's enough data for the aggregates to mean anything.
- **Outcome attribution** — callback rate per resume version.
- No resume builder, by design.
