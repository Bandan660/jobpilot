# Project history

A record of what was built, in what order, and why — including the reversals,
because the reasoning behind a change is usually more useful later than the
change itself.

Current as of 6 August 2026. Three commits on `main`.

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
