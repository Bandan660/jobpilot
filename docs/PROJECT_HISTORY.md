# Project history

A record of what was built, in what order, and why — including the reversals,
because the reasoning behind a change is usually more useful later than the
change itself.

Current as of 10 August 2026.

---

## Where it started

The brief was a Simplify.jobs-style product, initially scoped to **job tracking
plus a browser extension, explicitly without the ATS resume builder**. Research
on Simplify itself is in `simplify-jobs-research.md`.

The reasoning for dropping the resume builder: tracking is the part of a job
search that decays, resume tooling is commoditised, and Simplify's own page
admits its builder is GPT behind a form.

## Stack, and why

Chosen under a hard constraint: **everything free until there are users**.

| Layer | Choice |
|---|---|
| API | Cloudflare Workers + Hono |
| DB | Neon Postgres + Drizzle |
| Cron | Workers Cron Triggers |
| Frontend | React + Vite → Cloudflare Pages |
| Extension | Chrome MV3, TypeScript, esbuild |
| Auth | JWT via `jose`, PBKDF2 via Web Crypto |

Workers was chosen over Render/Railway for two reasons that decided it:
**Render's free tier sleeps**, and a 50-second cold start on the request the
extension fires at submit would be fatal; and **cron is paid everywhere else**,
while the dead-posting sweep *is* a cron job.

MongoDB was considered and rejected: the Atlas Data API was sunset in September
2025, the native driver does not run on Workers, and the interesting queries
here (ghost rates grouped by company, time-between-stages) are relational.

## Built, in order

**Monorepo and schema.** Four workspaces. `application_events` append-only from
the start, posting liveness separate from application status.

**Capture and duplicate detection.** URL canonicalisation with a *denylist* of
tracking parameters — an allowlist would discard job ids that some ATSs put in
the query string. Partial unique index on `(userId, jobUrlCanonical)` makes
capture idempotent.

**Dead-posting sweep.** Batched to respect the Workers subrequest budget, since
every Neon query counts against it too. Only definitive signals (404, 410,
closed-phrase) mark a posting dead; 403 and 429 are explicitly inconclusive.

**Extension.** JSON-LD extraction first, CSS selectors only to fill gaps —
structured job data is contractual and survives redesigns.

**Frontend.** Marketing site, then dashboard.

## The reversals

**Autofill was added after launch scope was set.** The site originally
advertised *"No autofill"* as a differentiator, with a dedicated card on the
Copilot page and an FAQ answer saying it never types into forms. When autofill
became a requirement, all of that had to be rewritten, along with the privacy
policy — storing a full personal profile is a materially larger obligation than
storing a tracker.

**Three layout rewrites.** The first marketing build used alternating
text/visual rows and was correctly called out as reading like a clone. Each page
now uses a different structural device, chosen to fit what it describes:

- **Home** — a vertical instrument rail with numbered waypoints
- **Tracker** — a sticky panel that swaps view as the feature list scrolls, because it is one dashboard doing several things
- **Copilot** — an annotated diagram, because its capabilities happen simultaneously on one page

**Pricing page deleted.** Premium features deferred until there is a model.

**FAQ moved onto the home page**, its standalone route removed.

**India-first, then global.** Briefly scoped to India, then widened. The
internationalisation work stayed: compensation parsing with pay cadence and
lakh/crore notation, profile split into core plus opt-in regional groups, and a
blocklist covering Aadhaar, PAN, National Insurance, SIN, TFN, CPF and others.
India remains the strongest initial wedge — see `ROADMAP.md`.

## Design system

Concept: an **instrument panel**. Amber signal lighting on deep blue-black,
status lamps rather than badges, monospace telemetry. Both light and dark
themes, built with `light-dark()` so each token is declared once, with plain
fallbacks for browsers that lack it.

The light theme is not an inversion. Amber that reads as instrument lighting on
near-black is illegible as text on white, so the accent splits: `--signal` for
fills, `--signal-text` for text and borders, darkened in light mode.

Typeface is Geist + Geist Mono, self-hosted via Fontsource — no font CDN
request, so no third-party data transfer to justify.

## Performance and SEO

Lighthouse was reported at 76. Work done since:

- **Prerendering.** 11 public routes to static HTML via `renderToString`, then
  hydration. Meta tags and JSON-LD are collected during render and spliced into
  the served HTML, so crawlers that do not execute JS still see them.
- Hero LCP fix — transform-only entrance instead of a fade.
- Latin font preload, filenames read from the bundle.
- Auth routes code-split; sourcemaps off in production.
- Hydration mismatches removed via `useHydrated()`.
- `BlogPosting`, `Blog`, `FAQPage`, `WebSite`, `SoftwareApplication` structured
  data; sitemap generated at build from the real route list.

Verifying the prerendered output caught a genuine bug: **every page was emitting
the site root as its canonical URL**, because `path` was never passed to
`usePageMeta`. That would have capped rankings site-wide.

## Not verified

Stated plainly because it matters:

- The ATS adapters have **never run against a live posting**. They were written
  from documented structure.
- Nothing has touched a real database. No migration has been applied anywhere,
  which is why migrations were squashed to one.
- The rendered UI has not been visually confirmed by me — the browser I can
  drive is not on this machine, so every visual change was verified by build
  success and the user's own eyes.

---

# Session: 8–9 Aug 2026

## Shipped

**Profile page rebuilt twice.** First into a full editor (skills, languages,
inline experience/education editors, readiness ring, scroll-spy sidebar). Then
again, on user feedback, into a **read-first** page: sections display values and
a pencil opens the inputs in a dialog. Cancel restores a snapshot, because
inputs write into the draft as you type.

**HireFresher cross-promotion.** `hirefresher.in` is the user's separate ATS
resume builder. Six placements, each with its own `utm_medium`. Deliberately no
`/resume-builder` redirect page: an instant redirect is a doorway page, and a
real page would target the same keywords as the other site and split authority
between two of the user's own domains.

**PWA.** Manifest, real PNG icons generated from the favicon (including a
maskable variant padded into the safe zone), iOS meta tags, and a hand-written
service worker. It never caches `/api/` — those responses are per-user and
auth'd. Navigations are network-first so a deploy is never masked by a stale
shell; only fingerprinted `/assets/` are cache-first.

**Extension: LinkedIn support.** Adapter plus Easy Apply handling. The job id is
usually `?currentJobId=`, extraction is scoped to the detail pane, and the modal
is watched by MutationObserver because it has no URL and replaces its own DOM
between steps.

**Extension: auto-apply.** Opens Easy Apply, fills each step, advances, stops at
review. It never clicks submit — verified against the built bundle, not just the
source. Blocked steps name the unanswered question rather than guessing.

**Extension: in-page side panel** replacing the toolbar popup, opened from a
docked launcher. Sign-in lives in it too, since Chrome caps toolbar popups at
600px and they cannot be the full-height surface asked for.

**R2 enabled.** One resume per account, 200KB, replaced on upload. A 9GB
bucket-wide ceiling backs the per-account limit, because per-account limits
bound one user and do nothing about a thousand.

**Gemini match analysis endpoint** — deployed, key set, **parked** at the user's
request. Their free-tier quota was already exhausted when tested.

## What cost the most time, and why

Three UI changes in a row appeared to do nothing. The cause was not caching: two
other stylesheets already owned the class names. `tracker.css` owns `.modal*`
and loads last, so its `max-width: 420px` and near-black backdrop won silently.
Renaming to `.sheet` hit `layout.css`'s spreadsheet mock, which sets
`font-family: var(--font-mono)` — that is why the dialog rendered in monospace.
The dialogs are `.dlg` now, checked against every stylesheet *before* use.

Two CORS failures were found by the user's browser console rather than by any
test here, because **curl does not preflight**. First `PUT`, then `X-File-Name`.

## Still open

- The extension has **never completed a real application end to end**. Capture
  and autofill are confirmed working on a live Greenhouse posting; nothing has
  been submitted.
- Gemini analysis is parked pending quota.
- Extension is not on the Web Store, so the install banner points at `/copilot`.
- `frontend/src/content/site.ts` still holds placeholder contact details.
- Two stray Cloudflare secrets whose *names* are a database URL and a Gemini
  key. The user chose to leave them.

---

## 9–10 August 2026 — adapters, assisted apply, and a matcher that stopped using AI

The longest session so far, and the one with the most reversals. Recorded here
because the reversals are the useful part.

### Every injected host got an adapter

`findAdapter` returned null on any host without one, `init` returned early, and
the JSON-LD fallback the docs promised never ran — there was no adapter left to
carry it. Roughly twenty sites in the manifest were silent no-ops, including
ones emitting perfectly good structured data.

A `genericAdapter` matching whatever nothing else claimed fixed that, gated on
the page declaring a schema.org JobPosting so a careers index or jobpilot's own
site correctly fails the test. Twenty platform adapters on top: Workday
hand-written because it emits no structured data, thirteen through a
declarative factory, five job boards separated out because the application does
not happen there.

### Two orphans and a lie

`expectedExternalId` / `renderedExternalId` had been declared, documented at
length, implemented by LinkedIn, and called by nothing for two commits — the
rewrite to continuous tracking replaced the retry loop they served. The
signature comparison that replaced it cannot cover that case, because the
signature is computed *from* the stale DOM.

Coverage was scanned against the whole document whenever no Easy Apply dialog
was open, so a LinkedIn posting counted the search box, the filter selects and
the message composer: "0 of 28 fields can be filled" — arithmetically true and
the opposite of what was happening.

### The LINKEDIN enum

Saving any LinkedIn posting had always failed with "Something went wrong".
`LINKEDIN` went into `ATS_PROVIDER` when Easy Apply support landed and was
never added to the Postgres type. Nothing caught it because zod validates
against the TypeScript union, which had the value; the insert then died on the
enum and a generic 500 handler swallowed the detail. Fixed by migration
`0001_add_linkedin_ats`, applied to the deployed database.

The generic 500 handler is right — internal detail must not leak — but it means
every unhandled server error looks identical from the client. `wrangler tail`
is the only place the truth lives.

### Auto-submit, reversed deliberately

The codebase said, in its own words, that making the submit button reachable by
`.click()` "stops being an assistant and becomes a tool for spraying
applications". The owner chose hands-off submission with the Web Store and
LinkedIn rate-limiting costs stated. The rule in CLAUDE.md was rewritten rather
than left contradicting the code, which is the point worth remembering: a
prohibition the code ignores is worse than no prohibition, because the next
session believes it.

The guardrails are what make it defensible. `autoSubmit` defaults to false so
nothing that fills a form without being asked can send anything; the blocker
check runs again immediately before the click; the submission counts only once
the page removes the button.

### Bulk, then not bulk

A queue that worked down a whole LinkedIn collection was built, run, and
dropped within the hour — applying to everything reachable was not what the
product was for. One press is one application now, and when the form asks
something the profile cannot answer the session stops, names it, and resumes
when the user has filled it in. It never skips the job, because skipping loses
an application to a single dropdown.

Whatever gets typed by hand is offered back to the profile as a saved answer,
keyed by the question, so the same question fills itself next time. That loop
is the only thing that shortens the blocked list.

### Glass, then not glass

The panel was given a backdrop blur and read as washed-out grey over a light
ATS form — the blur pulls the page's brightness through whatever tint sits on
top, which is the opposite of the separation the panel exists to have. Solid
surfaces now, with a CSS check asserting it stays that way.

### The matcher that stopped using AI

Skills matching shipped against Gemini, worked, and hit the free-tier 429 on
first real use. Replaced with a 105-skill dictionary in `shared/src/skills.ts`:
instant, free, offline, deterministic, and neither the posting nor the profile
leaves the browser.

Its own tests caught two bugs that had already been *written and commented
against*. Auto-adding each canonical name as an alias undid the short-name
defence — `Go` is listed only as "golang" precisely so "you will go far here"
does not invent a requirement, and the auto-add put "go" straight back. And
"js" as an alias for JavaScript matched the ".js" in "Next.js", so any posting
naming it appeared to require JavaScript separately. That one moved the score.

The score is requirement overlap, never a callback probability. Nothing here
can see the other applicants, the budget, or whether the role is already
filled, and a number presented as odds would make someone skip a job they were
right for.

### What this session cost the most time on

Text surgery on large files. Two separate regex-based edits deleted more than
intended — one took out four helper functions, another removed
`maybeShowPanel`, `init` and `watchNavigation`. Both were caught by the
typechecker and recovered, the second only because the work had been committed
an hour earlier. Targeted edits over pattern-matched slices on anything large.

