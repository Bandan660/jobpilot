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

**drizzle-kit prompts interactively** when it cannot distinguish a new column
from a rename, which hangs a non-interactive shell.

**Workers free tier caps CPU at 10ms**, and PBKDF2 at 100k iterations exceeds
it. Signup/login may need the paid plan. Do not lower the iteration count to
dodge this.

---

## Known incomplete

- **R2 is not enabled on the Cloudflare account.** Enabling it requires a card
  on file even for the free tier. The `[[r2_buckets]]` binding is commented out
  of `backend/wrangler.toml` because its absence failed the *entire* worker
  deploy, not just the resume routes. Those routes return 503 until then. To
  finish: enable R2 in the dashboard, `wrangler r2 bucket create
  jobpilot-resumes`, uncomment the binding, deploy.
- **Autofill has never been driven by a real profile end to end.** The editor
  and the API both exist now; nobody has filled one in and watched it fill a
  live form.
- `optional_host_permissions` is declared but not wired to `chrome.scripting`.
- Adapters have never been run against a live posting.
- `frontend/src/content/site.ts` holds placeholder contact details that render
  into the live privacy policy and terms.
- Privacy policy is accurate to the code but has had no legal review.
