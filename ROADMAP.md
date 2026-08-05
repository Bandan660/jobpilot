# Roadmap

Decided, not yet built. Ordered by when they should happen, not by size.

---

## 1. Expected-CTC advisor

**The problem.** Indian applications ask for expected CTC on the first form,
before any conversation, and whatever you type anchors the whole negotiation.
Most people guess. Under-quote by 2 LPA and the error follows you, because the
next employer asks for your current CTC.

Existing sources are weak: Glassdoor India is thin and stale, AmbitionBox is
self-reported and skewed toward the disgruntled.

**Why it fits here.** The compensation fields already exist on the profile
(`compensation.current` / `compensation.expected`, each with amount, currency,
and cadence), and applications already record what was offered. The data is
half-collected already.

### Phase 1 — single user, works on day one

No other users required. Surface, from the person's own tracked history:

- What they asked for versus what was actually offered, per application
- Whether they are consistently anchoring below their own offers
- Their own range by role and location

Most people never notice they are systematically under-quoting themselves.
That observation alone is worth the feature.

### Phase 2 — cross-user aggregate

Group offered CTC by role family, experience band, city, and company tier.
Show it in the extension **at the moment the expected-CTC field is being
filled** — the only moment it changes a decision.

Blocked on volume. Publishing a median from four data points is worse than
publishing nothing, so gate on a minimum sample and show the sample size.

### Notes

- Store amounts in minor units with currency and cadence, as now. Never compare
  raw numbers across currencies.
- `toAnnualCents()` already normalises cadence for aggregation.
- Label-aware formatting exists: a field labelled "(LPA)" gets `18`, an
  unlabelled one gets `1800000`. Keep that behaviour when writing suggestions
  back into a form.

---

## 2. Off-campus drive tracker (freshers)

**The problem.** India's largest and most anxious job-seeking population is
freshers going through off-campus drives — TCS NQT, Infosys, Wipro Elite,
Capgemini, Cognizant and similar. Each has a registration window, an exam date,
and hard eligibility rules. People currently track this across WhatsApp groups,
Telegram channels, and YouTube. It is chaos.

Simplify does not serve this segment at all; it targets experienced US tech
candidates.

**The feature.** A drive listing with eligibility checked against the profile,
so the answer is not "here are 12 drives" but "you are eligible for 7, and here
is precisely why not the other 5."

### Eligibility rules to model

Real drives filter on some combination of:

- Batch / passout year
- Minimum percentage, often "60% throughout" across 10th, 12th, and graduation
- Active backlogs (usually zero permitted)
- Maximum education gap, typically 1 year
- Degree and specialisation
- Prior attempt cooling-off periods

The profile already carries most of this: `education[]` has `level`, `score`,
`scoreType`, and `endDate`, so 10th/12th/graduation results are ordinary
entries rather than special-cased columns. Missing: backlog count and gap
years — both small additions.

### Open questions

- **Where does drive data come from?** Manual curation is realistic to start
  and is what makes the listing trustworthy. Scraping aggregators is fragile
  and legally murkier. Decide before building the ingestion side.
- Notification channel matters more than the listing. A missed registration
  window is a total loss, and email may not be enough for this audience.
- This is a different product surface from the tracker, sharing the profile
  underneath. Worth keeping the boundary clean.

---

## Considered and not chosen

Recorded so the reasoning is not relitigated later.

| Idea | Why not now |
|---|---|
| Employer response scorecard | Strong, but needs cross-user volume, and publishing company-level judgements carries real defamation risk. Revisit with scale and a legal read. |
| Ghost-job detection | Same volume dependency. Falls out of the scorecard data once it exists. |
| Funnel bottleneck diagnosis | Genuinely good and works with zero users. Deferred only because 1 and 2 were preferred. |
| Job-search proof export | Small and unserved (unemployment benefit evidence). Cheap to add later. |
| Naukri profile freshness | Highest daily-pain idea, but automating platform actions almost certainly breaches Naukri's terms. Safe version is a reminder plus keyword-gap check, leaving the action to the user. |
| JD-similarity duplicate matching | Solves the consultancy "A Leading MNC" masking problem. Contained algorithm change; revisit after 1. |
| Semantic saved answers | Upgrades an existing feature rather than adding surface area. Good follow-on. |

---

## Blocking work, unrelated to the above

These gate launch regardless of which features land next.

- **Profile editor UI.** The API exists (`GET`/`PUT /api/profile`) but there is
  no form to fill it in, so autofill currently has nothing to read. This is the
  single thing stopping the product working end to end.
- **`optional_host_permissions` wiring.** Declared in the manifest but not
  functional — needs `chrome.scripting` and a permission request in the popup.
- **Adapters untested against live pages.** Written from documented structure,
  never run against a real posting.
- **PBKDF2 versus the Workers free tier.** 100k iterations exceeds the 10ms CPU
  limit; signup and login may require the paid plan. Test before launch.
- **Legal review.** The privacy policy accurately describes the code but has not
  been reviewed by anyone qualified — and now covers full personal profiles,
  compensation, and optional demographic data.
- **`src/content/site.ts`** still holds placeholder contact details that render
  into the live privacy policy and terms.
