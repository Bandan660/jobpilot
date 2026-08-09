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
skills list *and* the text of every role. It replaced a Gemini call that worked
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

**The match score is requirement overlap, not a chance of being called back.**
It reports the share of what a posting *asks for* that the profile evidences.
Nothing here can see the other applicants, the budget, the referral the role is
already earmarked for, or whether it is filled — so odds would be invented, and
the cost of inventing them is someone skipping a job they were right for
because a model said 40%. The prompt says so, the panel says so, and the
`matched` / `missing` lists are the part actually worth reading. Do not relabel
it as a callback probability.

It is drawn on arrival, not behind a button — the button only ever existed
because each check cost a Gemini request. A set intersection costs nothing, so
asking the user to press something to see an answer already computed was making
them do the machine's work. `matchCache` in `content.ts` holds it for the
posting and clears on navigation, because the panel repaints on every form
change and the description scrape is an `innerText` read that forces layout.

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
read body, size check, magic bytes, then put. Resumes are capped at 3MB and 5
per account, which bounds free-tier storage at 15MB per user worst case.

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

## Where things stand — 9 Aug 2026

Everything below is deployed and pushed. `docs/PROJECT_HISTORY.md` has the
detail; this is what a new session needs before touching anything.

**Working, confirmed against reality:**

- Capture and autofill on a live Greenhouse posting — 10 of 15 fields filled,
  correct title and company. The adapters are no longer theoretical.
- Duplicate detection across platforms, CSV import, the tracker, the profile.
- R2 resume storage: one per account, 200KB, replaced on upload.

**Working, never exercised end to end:**

- **No application has ever been submitted through the extension.** Everything
  up to the submit button is confirmed; the capture-on-submit path is not.
  This is the next milestone that matters, and it needs the user, not us.
- LinkedIn Easy Apply auto-fill. Written and typechecked, never run.
- Lever, Ashby and the JSON-LD fallback.

**Parked at the user's request:**

- Gemini match analysis. `POST /api/analyze` is deployed and
  `GEMINI_API_KEY` is set correctly. Their Gemini free-tier daily quota was
  already exhausted when tested — a valid key returning 429 on
  `generate_content_free_tier_requests`. Retry after a reset before assuming
  anything is broken.

**Decisions already made — do not re-raise:**

- The user declined rotating two Cloudflare secrets whose *names* contain a
  database URL and a Gemini API key. Raised twice; they chose to keep them.
- No resume builder here. That is `hirefresher.in`, their separate product,
  linked to from six placements.
- No animation library on the marketing site. three.js and GSAP were both
  tried and removed on measured performance grounds.

---

## Known incomplete

- **No application has been submitted through the extension.** Capture and
  autofill work on a live Greenhouse posting; the submit path is unproven.
- **LinkedIn auto-apply is withheld, not removed.** It was run against a live
  Easy Apply posting and stopped on step 1 without saying why. Two real bugs
  came out of that — `findBlockers` counting wrapper elements, and the panel
  repaint detaching the status node — and both are fixed, but nothing has
  confirmed the flow end to end. `linkedinFlow` in `flows.ts` is complete and
  deliberately unreachable: `flowFor` returns null for LINKEDIN. Re-enabling is
  one line, once someone can watch it run.
- **Assisted apply on ATS platforms has never been run against a live form.**
  Blocker detection and resume attachment are verified against synthetic DOM;
  the `DataTransfer` assignment itself is browser behaviour that no test here
  can exercise. Greenhouse is the one to try it on first — it is the only
  platform anything has been confirmed on.
- **Answer drafting is deployed in code only.** `POST /api/analyze/answer`
  needs `wrangler deploy`, and the Gemini free-tier quota was already exhausted
  the last time it was tried, so nothing has seen a real response.
- `optional_host_permissions` is declared but not wired to `chrome.scripting`.
- **Every host in the manifest now has an adapter, and only Greenhouse has
  ever been run against a live posting.** The other 23 are built from each
  platform's published markup conventions and verified against synthetic DOM,
  which proves the routing and the parsing but says nothing about whether the
  selectors match the real page. Expect the first live run on each to find
  something. Workday matters most: it emits no JSON-LD, so `workday.ts` is the
  only thing standing between it and an empty capture.
- Two hosts are matched by an adapter but absent from `manifest.json`, so the
  content script never runs there: `myworkdaysite.com` (newer Workday tenants)
  and `successfactors.eu` (EU-hosted SAP). Adding the match patterns is all
  either needs.
- The extension is not on the Web Store, so the install banner points at
  `/copilot` rather than a listing.
- `frontend/src/content/site.ts` holds placeholder contact details that render
  into the live privacy policy and terms.
- Privacy policy is accurate to the code but has had no legal review.
