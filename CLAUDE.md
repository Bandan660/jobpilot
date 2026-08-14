# jobpilot

A job application tracker and autofill extension. One profile fills every
application form; the extension records the application at submit; a scheduled
worker re-checks saved postings and reports when one comes down.

Modelled on the *shape* of Simplify.jobs, deliberately not on its scope or its
design. See `ROADMAP.md` for what is planned and `docs/PROJECT_HISTORY.md` for
how it got here and why.

---

## Skills

`.claude/skills/ui-ux-pro-max/` is a third-party design database (MIT,
github.com/nextlevelbuilder/ui-ux-pro-max-skill) — 84 styles, 192 palettes, 74
font pairings, per-stack rules. Query it with
`python .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --stack react`.

Treat it as reference, not authority. This project already has a settled visual
language (the instrument panel: amber signal on deep blue-black, status lamps,
monospace telemetry) and a token system in `frontend/src/styles/tokens.css`.
Where the database disagrees with what is already here, what is already here
wins — the design decisions in this file were made for reasons the database
does not know about.

---

## Layout

```
shared/      Domain types + normalization. Compiled into all three others.
backend/     Cloudflare Worker (Hono) + Neon Postgres (Drizzle) + cron sweep.
extension/   Chrome MV3: capture, duplicate warning, autofill.
frontend/    React + Vite marketing site and dashboard, prerendered.
```

npm workspaces. `shared` must be built before anything that imports it.

## Commands

```bash
npm install
npm run build:shared          # required after any change under shared/

npm run dev:api               # wrangler dev  -> :8787
npm run dev:web               # vite          -> :5173
npm run build:extension       # -> extension/dist, load unpacked

# Frontend production build = client + SSR + prerender, in that order.
npm run build -w @jobpilot/frontend
```

Demo mode renders the whole UI against fixtures with no API or database:

```bash
cd frontend && VITE_DEMO=1 npx vite --host 127.0.0.1
```

Bind to `127.0.0.1` explicitly. Vite otherwise binds IPv6-only here and
`localhost` fails to connect.

## Verify before claiming done

```bash
npm run typecheck -w @jobpilot/backend
npm run typecheck -w @jobpilot/extension
npm run typecheck -w @jobpilot/frontend
```

Typechecks are cheap and have caught real bugs in this project. Run all three.

---

## Design decisions that constrain future work

**Coverage must be scoped to a form, never to the document.** `scanForm`
defaults to `document`, and the panel used that default whenever no Easy Apply
dialog was open — so on a LinkedIn posting it counted the search box, the
filter selects, the sort dropdown and the message composer, and reported "0 of
28 fields can be filled". Arithmetically true, and the opposite of what was
happening: there were no fields and no form. `findApplicationForm()` in
`flows.ts` is the strict test (a dialog with controls, or a form collecting a
file or an email) and returns null on a listing page. It is deliberately
separate from `dialogOrPage`, which keeps the loose `document` fallback because
Workday and Ashby post from a plain div — that fallback is right for an action
the user asked for and wrong for a passive count.

**A detected submit records automatically, and exactly once.** A confirmation
form was tried here and removed: the session records the application itself,
and the confirmation screen that submission produces then trips the detector —
so the user got a dialog asking them to add something already added.

Three guards keep it to one write per posting, and all three are load-bearing:

- `submitRecorded` — the MutationObserver re-fires on every mutation the
  "application sent" panel makes while it animates in, dozens of times.
- `captured` — set only on a confirmed write, never before the request. Setting
  it early latched the guard on failure: retries returned true without sending
  anything, losing the application while the UI reported success.
- `captureInFlight` — the session's own save is still open when the detector
  fires a few hundred milliseconds later, and `captured` is false for exactly
  that window. Without this flag that window is a second write. Removing it
  reproduces the duplicate immediately.

The tradeoff accepted here: a detected submit is evidence, not proof, and
`application_events` is append-only. A false positive is a wrong row the user
can correct in the tracker, which turned out to cost less than a dialog in
front of every application.

**`application_events` is append-only.** Every status change is written there
regardless of cause — user, extension, or system. Nothing updates or deletes.
This is what allows Gmail-driven status updates to be added later by writing
rows with a new `actor`, changing nothing else. Do not "optimise" it into a
mutable status column.

**Posting liveness is separate from application status.** The sweep worker
writes `postingStatus` only. It never touches user-owned state. "Ghosted" is
**derived at query time** from the two, never stored, so a late reply clears it
automatically.

**Normalization lives in `shared/`, not duplicated.** The extension and the API
must agree exactly on `canonicalizeJobUrl`, `normalizeCompany`, and
`normalizeTitle`. If they ever drift, duplicate detection breaks silently.

**Duplicate matching is lenient on purpose.** It powers a warning shown before
you apply. A false positive costs one glance; a miss costs a duplicate
application. Warn liberally, **never merge**.

**Autofill never submits, never overwrites, never guesses.** Below a confidence
threshold it leaves the field blank. A blank the user notices beats a wrong
answer they do not. It also refuses a broad blocklist of government and banking
identifiers across every market — see `extension/src/autofill/rules.ts`.

**Profile is core + opt-in regional groups.** Not a superset. A field tied to a
market the user has not enabled returns `null` however confidently it matched.

**No fabricated social proof.** There are no users yet. Every page deliberately
omits testimonials and user counts. Do not add them.

---

## Traps that have already bitten

**React-controlled inputs.** `element.value = x` updates the DOM but not
React's state; the field reverts or submits empty. `extension/src/autofill/fill.ts`
calls the *native* value setter and dispatches `input`/`change`. Every target
ATS is a React app, so this is the normal path, not an edge case.

**Prerendering forbids lazy components on public routes.** `renderToString`
cannot suspend. Only auth routes are `lazy()`; adding one to a prerendered route
bakes the fallback into the static HTML.

**Hydration mismatches cost Lighthouse points.** Anything reading `localStorage`
or `matchMedia` must render a neutral placeholder until `useHydrated()` flips.
Theme glyph and signed-in header already do this.

**LCP and opacity.** The hero heading uses a transform-only entrance. Fading it
in makes the largest element invisible during measurement. `Reveal` has an
`immediate` prop for above-the-fold content for the same reason.

**Canonical URLs.** Every page must pass `path` to `usePageMeta`/`useSeo`.
Without it, pages emit the site root as their canonical — silent duplicate
content across the whole site.

**Watch mode did not re-copy static files** until this was fixed. esbuild only
watches what it bundles, so `manifest.json`, `popup.html` and `popup.css`
were copied once at startup — editing the manifest mid-session left `dist`
holding the old one, and the extension loaded without a permission the source
plainly had. `build.mjs` now watches those three explicitly.

**Skills matching is a dictionary, not a model.** `shared/src/skills.ts` is a
set intersection: recognised skill names in the posting, against the profile's
skills list, the text of every role, *and* `resumeText`. It replaced a Gemini
call that worked
and cost a request per posting on a free tier that runs out. Instant, free,
offline, deterministic, and neither the posting nor the profile leaves the
browser. `/api/analyze` is still deployed and still better at prose — it is
simply not what "which of these named skills do I have" needs.

Two traps live in that file and both were caught by its own tests after being
written *and* commented against:

- The canonical name must not be auto-added as an alias. `Go` is listed only as
  "golang" precisely so "you will go far here" does not invent a requirement,
  and auto-adding put "go" straight back.
- Two-letter aliases are not worth their reach. `js` for JavaScript matched the
  ".js" in "Next.js" and "Node.js", so every posting naming either appeared to
  require JavaScript separately — and the score moved because of it.

`\b` does not work for names ending in punctuation: `\bc\+\+\b` never matches
"C++". The matcher uses "not flanked by a letter or digit" lookarounds instead.

**The resume is evidence, and it is text on the profile.** `resumeText` holds
the extracted plain text of the uploaded resume, and matching reads it. Without
it the evidence was the skills chips — a summary someone typed once — plus role
descriptions, so a posting asking for something printed on page one of the CV
scored as a gap. On a realistic posting the same profile moves 36% → 91% once
its resume is included.

Extraction is client-side and cannot move: the Worker caps CPU at 10ms and PDF
parsing is nowhere near that. `frontend/src/resume.ts` owns it, both write
points are in the browser (onboarding, and the Resumes upload), and both fail
quietly — a scan or a `.docx` costs a match no worse than before, never a
failed upload. There is no backfill: the text only exists where the file does,
so existing users get it on their next upload.

**Where onboarding fills the profile from a resume, missing means missing.**
`extractFields` returns the whole `ProfileInput` shape with `null` for anything
it could not read. Spreading that into the draft overwrote real answers — the
email captured at sign-up vanished whenever the regex missed the one printed on
the resume, and a second upload emptied the roles the first one found.
`foundOnly()` in `Onboarding.tsx` is the filter. A resume is evidence to add,
never a reason to forget something already known.

**The match score is requirement overlap, not a chance of being called back.**
It reports the share of what a posting *asks for* that the profile evidences.
Nothing here can see the other applicants, the budget, the referral the role is
already earmarked for, or whether it is filled — so odds would be invented, and
the cost of inventing them is someone skipping a job they were right for
because a model said 40%. The prompt says so, the panel says so, and the
`matched` / `missing` lists are the part actually worth reading. Do not relabel
it as a callback probability. This has been asked for directly, in those words,
and the answer did not change: what ships is a band and a named gap, which
answer "is this worth my afternoon" out of things that are true.

The overlap is **weighted, not flat**. `MUST_HAVE_CUE` marks requirements the
posting insisted on — "must have", "strong experience in", "proficient in" —
and those count double. A flat average scored a candidate holding both
must-haves and missing three tools named once the same as one who had it
exactly the other way round, which is the comparison the number exists to make.
The cue is scoped to its own line: the "Requirements:" heading is *why* those
skills are in the required bucket at all, and counting it again weights the
whole list equally, which is where this started.

`fitBand()` is the single definition of strong / worth applying / long shot,
and both the dial colour and the verdict text read it — two places deciding it
independently is how they drift. A missing must-have caps the band at "worth
applying" however high the coverage: 90% missing the one thing the posting
called essential is not a strong fit. Years sit *beside* the score and never
inside it, and are omitted entirely when the profile has no dates, because
unknown is not zero.

It is drawn on arrival, not behind a button — the button only ever existed
because each check cost a Gemini request. A set intersection costs nothing, so
asking the user to press something to see an answer already computed was making
them do the machine's work. `matchCache` in `content.ts` holds it for the
posting and clears on navigation, because the panel repaints on every form
change and the description scrape is an `innerText` read that forces layout.

**A cached score must be keyed to the body it was computed from, not only to
the posting.** The tracking signature carried one bit for the description —
"has one turned up" — and a bit that has flipped can never flip again. On
LinkedIn's split view the next posting's title arrives before its body, so a
score taken in that window was computed from the *previous* posting's text and
cached under the new posting's key, with nothing left that could notice it: the
bit was already set so no repaint, and a repaint would have returned the cache.
Clicking through a list showed one job's skills and score under every title
after it. `descriptionFingerprint()` moves when the text moves, and
`matchCacheFingerprint` records what was scored, so a bad read corrects itself
when the real body lands. It is re-checked *after* the profile await rather
than restamped — stamping the current value there marks a score drawn from the
old body as belonging to the new one and disables the correction for good.

**The profile cache in `content.ts` expires, and must.** "Fetched once per
page" is once per *tab*, and a job tab lives for hours; the only invalidation
was the saved-answers write. Editing skills on the dashboard and returning left
every later score computed against the profile from before the edit — a posting
insisting "JavaScript, HTML, CSS — not in your profile" against a profile
listing all three. There is a TTL now, and `invalidateProfile()` drops the
profile and the match together on tab re-focus, which is the one reliable
signal that an edit happened. Dropping the profile alone is not enough: the
match is keyed to the posting, so the old score stays on screen until something
sets `matchDeferred`.

**One application per press, and a blocked job is never skipped.** One click
applies to the posting on screen and stops. A queue that worked down a whole
collection was tried and dropped — applying to everything reachable is not what
this is for, and it is not coming back. When the form asks something the profile
cannot answer, `autoapply/session.ts` stops with the questions **named** and
leaves the form open — the user answers them in the page's own form and presses
continue, which is the *same call*, because `runApply` never overwrites a
filled field and so a second pass fills only what is still empty. Skipping was
the old behaviour and it lost an application to a single dropdown.

Whatever the user typed by hand is read off the form in `beforeSubmit` — the
last moment it exists, since a successful submit replaces the whole dialog —
and offered back to the profile as a `SavedAnswer` keyed by the question. That
loop is the only thing that makes the blocked list shorter over time.

**Auto-submit is on, deliberately, and the guardrails are the point.** This
reverses the original "never clicks submit" rule. The owner chose sending
without a second press, with the costs stated — Chrome Web Store review looks
for exactly this behaviour and it is a common rejection reason, and LinkedIn
can rate-limit or restrict an account that submits faster than a person could.
Do not re-litigate the decision; do not quietly weaken what protects it:

- `autoSubmit` defaults to **false** in `runApply`. Everything that fills a
  form without being asked — the panel's Fill, the coverage preview — cannot
  send anything and cannot be made to from elsewhere. Sending is one flag on
  one call path, so "can this send an application without me" stays answerable
  by reading one file.
- `findBlockers` runs **again immediately before the click**, not once at the
  start. A draft can fail and the page can render a validation error during the
  fill. An incomplete application sent is worse than none, because it burns the
  posting.
- The submission is confirmed by the page, not by the click. A click the form
  rejected leaves the button in place; counting that as sent is how a run
  reports fifty applications and delivers none.
- Cancellation is checked in the same breath as the click. Stop must stop.

The default pace is one application every ~2.5s and the faster options say what
they risk rather than showing a bigger number.

**One driver, several flows.** `apply.ts` holds the
fill → attach → draft → check → advance sequence for every platform; `flows.ts`
holds only what differs (where the form is, whether it paginates, what the
buttons say). This replaced a LinkedIn-only `autoApply.ts` that would have had
to be copied per platform. Adding an ATS means adding a flow, not a driver.

**The resume goes in through `DataTransfer`.** `input.files` is a read-only
`FileList` that cannot be constructed; assigning a `DataTransfer`'s `files` is
the only supported path, and it is what a real drag-and-drop produces. It never
replaces a file already attached — overwriting the tailored resume someone just
picked leaves no trace of what it replaced. It also refuses inputs it cannot
identify as resume fields, because a resume in the transcript slot is worse
than an empty one, and refuses `accept` mismatches, because the page would
otherwise reject it silently at submit.

**Answer drafting is prompted to refuse.** `POST /api/analyze/answer` is given
the profile as the only permitted source of fact and told to return `NO_BASIS`
rather than fill a gap. An empty draft is a success, not a failure — it means
the profile does not support an answer, which is exactly when the user must
write it themselves. The alternative is a model inventing an internship on
someone's application. Off by default in the panel, per-run.

**LinkedIn's selectors will rot.** It ships hashed class names that change
without notice, so `adapters/linkedin.ts` carries several fallbacks per field
ending in something structural. When capture starts returning nulls there,
suspect the selectors before anything else.

**The panel is opaque. Glass was tried and removed.** `backdrop-filter` pulls
the host page's brightness through whatever tint sits on top, so over a light
ATS form the panel read as washed-out grey rather than as dark chrome — the
opposite of the separation it exists to have. Every surface is a solid colour
now; the `--glass-*` token names survive only so the rules did not all have to
change. Coloured accent tints over that opaque base are fine. Reintroducing
`backdrop-filter` is not.

**One action in the action bar, never two.** The Fill button renders only when
there is a form here *and* no session available — a session fills as its first
step, so offering both is the same work twice, and a disabled "No form to fill"
under a live "Apply with jobpilot" is what made the panel read as broken. The
status line has to agree with the button below it: on a LinkedIn posting the
form does not exist until Easy Apply is pressed, which is "ready to apply", not
"no application form on this page".

**`genericAdapter` matches every host, so it must stay last in `ADAPTERS`.**
`findAdapter` takes the first match; anything registered after it is dead code.
It is also the reason an unknown host does something instead of nothing —
before it existed, `findAdapter` returned null, `init` returned early, and the
documented JSON-LD fallback never ran, because no adapter was left to carry it.
Its `isJobPage` demands a schema.org `JobPosting` in the document rather than
guessing from the URL, which is what keeps the panel off careers indexes and
off jobpilot's own site.

**`[aria-required="true"]` matches wrappers, not just controls.** `findBlockers`
queried `input[required], select[required], textarea[required],
[aria-required="true"]` and cast every hit to a form control. LinkedIn puts
that attribute on the `div` around each field as well as on the field, and a
`div` has no `.value` — so the emptiness test read `undefined` as "unanswered"
and reported a blocker for a question already answered. Auto-apply stopped on
step 1, contact info, every field prefilled by LinkedIn itself. Filter real
controls first, then check required-ness. Same function: a checkbox with no
`name` made `input[name=""]` match nothing, so an unnamed consent box always
read as unticked.

**Anything the panel's `paint()` creates dies on the next repaint.** The panel
is redrawn whenever the tracking signature changes, and the Easy Apply field
count is part of that signature — so opening the modal rebuilds the panel about
a second into an auto-apply run, and every step advance rebuilds it again.
`report` had captured the status element from the paint that started the run,
so every message after "Opening Easy Apply…" went into a detached node and the
user saw nothing at all. `collapsed` was already module-level for exactly this
reason; the run state was not. It is now, along with the live node handles.
Anything that must outlive a repaint belongs beside them.

**An adapter hook nothing calls is not a feature.** `expectedExternalId` /
`renderedExternalId` — the guard against scraping the previous posting during
an SPA navigation — were declared, documented at length, implemented by
LinkedIn, and called by nothing for two commits: the rewrite to continuous
tracking replaced the retry loop they served and left them orphaned. The
signature comparison that replaced it cannot cover that case, because the
signature is computed *from* the stale DOM and therefore looks perfectly
stable. `isStale()` in `content.ts` wires them back up. Grep for a caller
before trusting any optional member of `JobAdapter`.

**The profile dialogs are `.dlg`. `.modal` and `.sheet` are both taken.** Both files
`tracker.css` owns `.modal*` for the Add Application dialog and loads after
`dashboard.css`, so its `max-width: 420px` and near-black backdrop silently won
every conflict. Renaming to `.sheet` hit `layout.css`'s spreadsheet mock, which
sets `font-family: var(--font-mono)` — that is why the dialog rendered
monospace. Grep every stylesheet before claiming a class name. When a style
change seems to have no effect, look for a second definition before blaming the
cache.

**CORS must list every custom header, not just every method.** `X-File-Name`
was missing from `allowHeaders` and the browser blocked resume upload at
preflight — the same failure as the missing `PUT`, found the same way, by the
user's console rather than by any test here. curl does not preflight, so it
cannot catch either. Adding a custom header on the client means adding it to
`allowHeaders` in `backend/src/index.ts`, and verifying with a real OPTIONS
request carrying `Access-Control-Request-Headers`.

**Quota and size checks must run before the R2 write.** Rejecting an upload
after `bucket.put()` leaves an object with no row pointing at it, and nothing
in this system collects orphans. The upload handler's order is: count check,
read body, size check, magic bytes, then put.

The limits are **200KB and one resume per account** — `MAX_RESUME_BYTES` and
`MAX_RESUMES_PER_USER` in `shared/src/types.ts`, with a bucket-wide ceiling in
`MAX_TOTAL_STORAGE_BYTES` above that. Uploading replaces rather than adds, so
one user is 200KB and the storage question stops being interesting. Read the
constants rather than this paragraph before relying on a figure: they moved
once already and this said "3MB and 5 per account" for months afterwards.

200KB is tight and refuses legitimate files — a resume exported straight from a
word processor embeds full font files and lands at 150-400KB, while the same
document with subsetted fonts is nearer 60KB. That is why the error says how to
fix it rather than only stating the limit, and why anything that reads a resume
without storing it must not borrow this number: `frontend/src/resume.ts` parses
up to 10MB, and the two limits are unrelated. Onboarding states both, because a
file between them fills the profile and is not kept, and someone who is not
told that assumes their resume is on the account.

**Any API origin the extension uses must be in `host_permissions`.** The
extension shipped defaulting to `localhost:8787` with no production origin
declared, which made it non-functional on install — and silently, because a
blocked fetch is indistinguishable from a network error. The default is the
deployed Worker now; localhost stays declared so the popup override still works
for development.

**PowerShell mangles UTF-8.** Editing files through `Get-Content`/`Set-Content`
double-encodes punctuation. Use Node or the editing tools for source files.

**PowerShell pipes add a BOM.** Piping a value into a native command
(`$x | npx wrangler secret put NAME`) re-encodes stdout as UTF-8-with-BOM, and
the three invisible bytes end up inside the secret. Nothing displays them —
not the dashboard, not the error, which quotes the value back looking correct.
`cleanSecret()` in `db/client.ts` strips them defensively; pipe through bash if
you need to set one by hand.

**Cloudflare deploys take ~30s to propagate.** Testing immediately after
`wrangler deploy` hits the previous version. This has looked like a bug three
separate times — a missing CORS header, a missing response field, and a
suffix rule that "did not work". Poll until the new behaviour appears rather
than asserting on the first response.

**The frontend API URL must live in `frontend/.env.production`.** Deploys go
out as `wrangler pages deploy dist` — a locally-built bundle — so Cloudflare
Pages' own build variables never apply. Setting it only in the dashboard ships a
production bundle that calls `localhost:8787` and fails every request with
`ERR_CONNECTION_REFUSED`. Verify after building:
`grep -c localhost:8787 dist/assets/*.js` must be 0.

**GSAP must not animate anything `Reveal` already owns.** Both write
`transform`; the inline value wins and the CSS reveal silently stops
happening. GSAP drives only what nothing else touches — hero parallax, the
pinned waypoint markers, the counters, the progress bar. `.tile` and
`.cta-panel` stay with `Reveal`.

**Animation libraries were tried on the marketing site and removed.** three.js
cost ~190KB gzipped; GSAP ScrollTrigger cost 537ms of main-thread work and
forced reflows, which alone held Total Blocking Time at 290ms and performance
at 87. Both are gone. Motion on the marketing site is CSS only — the `Reveal`
component, the `Mission` rail, and the hero's drifting dot grid. Do not
reintroduce an animation library; the budget for one does not exist at 100.

**`--muted` in the light theme is pinned by contrast, not taste.** `#66748a`
scored 4.458:1 against the `#f6f8fc` page surface, just under the 4.5:1 AA
floor, and failed the nav, every footer link, and the status strip at once.
`#5f6d84` is 4.93:1. Do not lighten it.

**Adding a header nav item means moving the mobile breakpoint.** The bar is
brand + nav + theme toggle + two buttons on one 60px row. It was set to 900px
for three nav items and looked wrong across the whole tablet range once a
fourth was added; it is 1040px now. `.site-nav` carries `min-width: 0` so it
is the element that gives way, and `.header-actions` is `flex-shrink: 0` so
the sign-up button never compresses.

**The service worker must never cache `/api/`.** Those responses are per-user
and auth'd; a cached one served after sign-out is a real leak. Navigations are
network-first for the same reason stale deploys keep looking like bugs here —
cache-first would serve an old app shell after every deploy. Only
`/assets/` is cache-first, and only because Vite fingerprints those names.
Bump `VERSION` in `public/sw.js` when changing any of this.

**A TypeScript union is not a Postgres enum.** `LINKEDIN` was added to
`ATS_PROVIDER` when Easy Apply support landed and never added to the database
type, and the two disagreed for months. Nothing caught it: zod validates `ats`
against the TS union, so every request passed, and the insert then died on
`invalid input value for enum ats_provider: "LINKEDIN"` — which `onError` turns
into a generic 500. Saving any LinkedIn posting reported "Something went wrong"
with nothing anywhere pointing at the enum. Fixed by `0001_add_linkedin_ats`.
Adding a value to any `as const` array that backs a `pgEnum` means writing a
migration in the same change, and `ALTER TYPE … ADD VALUE` cannot be *used* in
the transaction that adds it.

**And a table in `schema.ts` is not a table in Postgres.** The same mistake,
one level up, and it went further: `user_reports` was declared when the issue
reporter shipped and never created, so reporting had never once worked. Zod
validated the request, the insert hit a missing relation, `onError` returned
"Something went wrong" — the same sentence every other unhandled error
produces — and it appeared under a filled-in form on the one screen someone
reaches *because* something else is already broken. Fixed by
`0004_add_user_reports`; no code change was needed, which is the tell.

Before assuming a 500 is in the handler, check the table exists. Comparing
`information_schema.tables` against the exports in `schema.ts` takes one query
and would have caught both of these on the day they landed. `backend/drizzle`
is applied by hand here — `meta/_journal.json` lists only two of the five
migrations, so the journal proves nothing about what a database actually has.

**A generic 500 handler hides exactly the errors worth reading.** `onError`
returns "Something went wrong" for anything that is not an `HTTPException`,
which is right — internal detail must not leak — but it means every unhandled
server error looks identical from the client. When the extension reports it,
the detail is in `wrangler tail` and nowhere else. Reach for that before
guessing at the payload.

**drizzle-kit prompts interactively** when it cannot distinguish a new column
from a rename, which hangs a non-interactive shell.

**Workers free tier caps CPU at 10ms**, and PBKDF2 at 100k iterations exceeds
it. Signup/login may need the paid plan. Do not lower the iteration count to
dodge this.

---

## Where things stand — 14 Aug 2026

Everything below is committed on `main` and pushed.
`docs/PROJECT_HISTORY.md` has the narrative; this is what a new session needs
before touching anything.

**Working, confirmed against reality:**

- Capture and autofill on a live Greenhouse posting.
- **Applications have been submitted through the extension**, on LinkedIn Easy
  Apply, and recorded in the tracker. That milestone is passed.
- Duplicate detection across platforms, CSV import, the tracker, the profile.
- Local skills matching: a posting's named skills against the profile, drawn on
  arrival with no model and no network. Weighted by must-haves, banded, and
  read against the resume text as well as the chips and the roles.

**Built, not yet run against a live account:**

- Resume text on the profile and the onboarding upload that stores it. Both
  paths typecheck and build; neither has been through a real sign-in, a real
  PDF and a real posting end to end. The migration is applied to `neondb`;
  confirm production points at the same database before assuming it is there.

**Working, thinly:**

- One application per press. The session stops on a question the profile
  cannot answer, names it, and resumes when the user has filled it in. Run
  against real postings and iterated on twice.
- Auto-submit is on. Guarded by a blocker re-check immediately before the
  click, a cancellation check, and confirmation that the page accepted it.

**Never run against a live form:**

- 20 of the 24 adapters. Built from published markup conventions and verified
  against synthetic DOM only. Greenhouse and LinkedIn are the exceptions.
- Resume attachment via `DataTransfer` — the assignment itself is browser
  behaviour no test here can exercise.

**Parked:**

- Gemini. Both `/api/analyze` and `/api/analyze/answer` are deployed and the
  key is valid; the free tier returns 429. Answer drafting still depends on it.
  Skills matching no longer does.

**Decisions already made — do not re-raise:**

- **The first release ships three platforms enabled: LinkedIn, Indeed, Naukri.**
  They are what India's job search runs through and the only three driven
  against live postings. Every other adapter is compiled into the bundle and
  reachable, but its host is opt-in: declared in `optional_host_permissions`
  and granted per site from the popup. `platforms.ts` owns that list and is the
  only file to edit when adding one — `ADAPTERS` already carries them all, and
  trimming it would only make an enabled platform fall through to
  `genericAdapter`.

  This is why the hosts are optional rather than added to
  `content_scripts.matches` one release at a time: adding a *required* host
  permission to an update is a permission increase, and Chrome disables the
  extension for every existing install until each user re-accepts. Doing that
  once per adapter would knock users offline repeatedly. Do not "simplify" an
  opt-in platform by moving its host into `content_scripts`.

  Greenhouse is the one to enable first: it is the only opt-in adapter proven
  on a live posting.
- **Firebase is the identity provider; jobpilot still issues the session.**
  Sign-in happens at Firebase (Google or email/password), the client exchanges
  the Firebase ID token once at `POST /api/auth/firebase`, and the Worker
  returns the same 30-day jobpilot JWT everything already used. `requireAuth`,
  every route, the admin allowlist and every foreign key were unchanged by this.

  Do not "simplify" it by verifying Firebase tokens per request. They last one
  hour and need refresh-token handling; the extension holds its session in
  `chrome.storage.local` with no refresh flow, and `jwt.ts` records why a short
  expiry is wrong here — being signed out mid-application is the most costly
  moment to interrupt anyone.

  `users.passwordHash` is nullable as a result. `/api/auth/login` refuses a null
  hash explicitly: "no local password" must mean "cannot log in this way", never
  "no password required".
- Auto-submit stays on. Taken with the Web Store and rate-limiting costs
  stated. See the guardrails note above before changing anything near it.
- The match score is requirement overlap, never a callback probability.
- Commit directly to `main`. No feature branches; the owner works solo.
- The owner declined rotating two Cloudflare secrets whose *names* contain a
  database URL and a Gemini API key. Raised twice; they chose to keep them.
- No resume builder here. That is `hirefresher.in`, their separate product.
- No animation library on the marketing site.

---

## Known incomplete

- **20 of the 24 adapters have never seen a live posting.** Built from each
  platform's published markup conventions and verified against synthetic DOM
  only. Greenhouse and LinkedIn are the two exceptions. Expect the first live
  run on each to find something; suspect the selectors before anything else.
- **Assisted apply is proven on LinkedIn Easy Apply only.** The single-job
  session, auto-submit and the resume attachment have all run there. No ATS
  form has been driven end to end — Greenhouse is the one to try next, being
  the only other platform anything is confirmed on. The `DataTransfer`
  assignment behind resume attachment is browser behaviour no test here can
  exercise.
- **Answer drafting has never produced an answer.** `POST /api/analyze/answer`
  is deployed and the key is valid; the Gemini free tier returns 429. It is the
  only feature still depending on the model — skills matching no longer does.
- `optional_host_permissions` is declared but not wired to `chrome.scripting`.
- Workday matters most among the untested: it emits no JSON-LD at all, so
  `workday.ts` is the only thing standing between it and an empty capture.
- `myworkdaysite.com` (newer Workday tenants) and `successfactors.eu` (EU-hosted
  SAP) are matched by their adapters but have never been in `manifest.json`.
  Moot while both are parked; add the patterns alongside the existing ones when
  Workday or SuccessFactors is brought back.
- The extension is not on the Web Store, so the install banner points at
  `/copilot` rather than a listing.
- `frontend/src/content/site.ts` holds placeholder contact details that render
  into the live privacy policy and terms.
- Privacy policy is accurate to the code but has had no legal review.
