# Referral asks

Proposed, not built. A design for tracking the ask-for-a-referral loop that
currently runs in someone's head: apply, find people at the company, send a
connection request, message them once they accept, follow up two days later.

**The user does all the sending.** jobpilot suggests where to look, opens the
page, and records what happened when the user tells it. It never sends a
connection request, never sends a message, and never navigates a page the user
did not ask for. Everything below is built to that shape.

---

## What the problem actually is

It is not too many steps. It is four steps, and each one is fine on its own.
What breaks is that **the context you need lives somewhere other than the
moment you need it**. You are in a LinkedIn message thread looking at a name,
and the answers — which company, which role, when you applied, whether you
already nudged them — are in a tracker in another tab, or nowhere.

So the job is not "build a CRM". A CRM is another tab to check. Three pieces
do the whole thing:

1. **A suggestion in the panel** — where to look for someone who can help with
   *this* application, opened in one click.
2. **A short form** — the user says who they contacted and what they did. Two
   fields to type; the rest is already known.
3. **A lookup** — when the user later lands on that person's profile or message
   thread, the panel says who they are and what was asked.

Piece 3 is what actually solves the stated pain. It needs no detection and no
scraping — only a match on the profile URL that the user themselves recorded.

---

## 1. The suggestion card

**Suggest searches, not people.** Naming actual people would mean reading
LinkedIn's directory, which is scraping. Instead the panel offers a handful of
searches scoped to this posting's company, and LinkedIn does the finding.
That is the difference between a feature and a liability, and it happens to
also be the better answer: LinkedIn's search knows who is currently there and
who is in the user's network.

On a job posting the panel gains one card:

```
WHO COULD HELP HERE                    Tata Consultancy

→ Recruiters at Tata Consultancy
→ People doing this job there
→ Alumni of Kalinga Institute there
→ People you already know there

You have applied to 2 roles here · 0 asks logged
```

Each opens in a **new tab** — the user is reading a posting and should not lose
it. `chrome.tabs.create`, or a plain `target="_blank"` link.

### Where the URLs come from

| Suggestion | Built from | URL shape |
| --- | --- | --- |
| Recruiters | company slug | `/company/{slug}/people/?keywords=recruiter` |
| People doing this job | company slug + captured job title | `/company/{slug}/people/?keywords=frontend%20engineer` |
| Alumni there | company slug + `profile.education[].school` | `/company/{slug}/people/?keywords={school}` |
| People you know there | company slug | `/company/{slug}/people/` — LinkedIn surfaces 1st-degree first |

**Prefer the `keywords` parameter over facet ids.** Facets like `facetSchool`
take opaque numeric ids that have to be looked up and that LinkedIn changes;
`keywords` is a string that has worked for years and degrades to a broader
result set rather than to an error page.

**Getting the company slug is free on LinkedIn.** `adapters/linkedin.ts`
already reads `a[href*="/company/"]` for the company name — the slug is in that
same href. Off LinkedIn (Greenhouse, Ashby, a careers site) there is no slug, so
fall back to people search by name:
`/search/results/people/?keywords={company}%20recruiter`. Less precise, still
useful.

Keep every URL template in one file, the way `platforms.ts` holds the platform
registry. When LinkedIn changes a path, that is one edit and not a hunt.

### Why the alumni row is worth building first

The profile already stores `education[].school`, and in India a shared college
is the single strongest opener for a cold referral ask — far ahead of a
stranger with the right job title. It costs one more entry in the table above
and it is the row most likely to get a reply.

---

## 2. The form

The user sends the connection request on LinkedIn themselves. Then they record
it. The form's whole job is to be short enough that they actually do.

```
LOG AN ASK

Application   React JS Developer — Tata Consultancy      (fixed)
Company       Tata Consultancy                           (fixed)

Person        [ Priya Raman                    ]
Their role    [ Engineering Manager            ]  optional
Profile URL   [ linkedin.com/in/priya-raman    ]

Status        (•) Connection request sent
              ( ) Already connected — message sent

                                    [ Cancel ]  [ Save ]
```

**Do not ask for the company name.** It is the application's company; the user
already told the system once. Every field that can be filled is one fewer
reason to abandon the form. Two fields are genuinely unknown — the person and
their profile URL — and one of those is a paste.

**Prefill from the page when there is one.** If the panel is open on
`linkedin.com/in/*`, the name, headline and URL are all on screen; fill them and
leave them editable. Manual entry stays as the path that always works, because
the profile-page read will eventually rot. Both routes reach the same form.

**Two statuses, not five.** "Connection request sent" and "already connected —
message sent" are the two real starting points; a first-degree contact skips
the invitation entirely, and a form that cannot express that gets abandoned or
lied to. Everything after this is a status change on an existing row, not a new
form.

### Where the form is reachable

- The suggestion card, after the user comes back to the tab — the card grows a
  `+ Log an ask` line once a suggestion has been opened.
- The panel on a LinkedIn profile page, prefilled.
- The application row in the dashboard, for anything logged later from a
  laptop with no extension.

---

## 3. The lookup

The piece that answers *who is this and what did I ask them about*.

On `linkedin.com/in/*` and `linkedin.com/messaging/*`, the content script reads
the profile's public id, matches it against asks the user has recorded, and
renders into the panel that is already there:

```
BANAPPLY · REFERRAL

Priya Raman
React JS Developer — Tata Consultancy

applied         12 Aug · 5 days ago
request sent    13 Aug

Mark as accepted →  then the draft opens
```

`*.linkedin.com/*` is **already** in `content_scripts.matches`, so `/in/` and
`/messaging/` need no manifest change and **no permission increase**. That
matters: adding a required host permission to an update disables the extension
for every existing install until each user re-accepts it.

Read from a local index in `chrome.storage.local`, not the API per page — **and
give it a TTL plus a re-focus invalidation**, exactly as the profile cache in
`content.ts` had to learn. A tab lives for hours, and a stale "not yet asked"
on someone messaged this morning is the same class of bug as the stale match
score.

### The user marks acceptance, and that is fine

LinkedIn already tells them someone accepted — by notification and by email.
The tool does not need to find that out independently; it needs to be useful at
the moment they act on it, which is when they open the profile or the thread.
That is the lookup above, and it works with no detection at all.

Automatic detection is written up at the end as an optional later phase. It was
never what solved the problem.

---

## Data model

**Less than the first draft of this document proposed.** `contacts` already
exists in `backend/src/db/schema.ts`, shipped in `0000_lyrical_epoch.sql`, with
almost exactly the right columns:

```
contacts
  id · applicationId · name · email · role · linkedinUrl · createdAt
```

Nothing reads or writes it. No route, no dashboard code, no extension code —
`backend/src/routes/` has no `contacts.ts`. So this is finishing scaffolding
that was laid and abandoned.

**Its per-application grain is correct here.** An earlier draft argued for
re-graining it to per-user. That was wrong for this flow: the ask is about one
application, the form is opened from one application, and the panel answers a
question about one application. Keeping the grain removes a migration and a
join. The person-across-two-applications case is two rows, which is honest —
they are two asks.

### What to add

| Column | Type | Why |
| --- | --- | --- |
| `status` | `text` | `INVITED`, `CONNECTED`, `ASKED`, `NUDGED`, `REFERRED`, `DECLINED`, `COLD` |
| `statusAt` | `timestamptz` | What the follow-up clock counts from |

**`text`, not a `pgEnum`.** This is deliberate. A TypeScript union is not a
Postgres enum, and the last time an `as const` array backing a `pgEnum` gained a
value without a migration, every LinkedIn capture died on
`invalid input value for enum` and surfaced as a generic 500 for months.
Validate the value with zod at the edge and store text; the set is small,
user-owned, and will change while this is being designed.

That is the entire schema change: one migration, two columns.

### It shows up as a note for free

Every write also appends a row to `application_events` — the `CONTACT_ADDED`
type **already exists** in `EVENT_TYPE`, so this needs no enum migration — with
the person and the status in `payload`. The application's history then reads:

```
17 Aug   Connection request sent to Priya Raman (Engineering Manager)
16 Aug   Applied
```

Which is what "save it as a note on the application" asked for, except it is
also queryable, countable, and able to drive the reminder. A free-text `notes`
row would have read the same and done none of that.

`application_events` stays append-only. A status change appends; nothing
updates. `contacts.status` is a cached read of the newest event, kept because
the queue query should not have to reduce a log to sort by due date.

---

## Follow-up

`statusAt + 2 days` on anything in `ASKED` is due. The count goes on the
**action badge**, which needs no permission at all — the extension already
wakes on every LinkedIn and job page, so compute it then.

**Not `chrome.alarms`.** It is a new permission, and a permission increase
disables the extension for every existing install until re-accepted. Not worth
spending on a reminder. Bundle it into some later release that is already
asking for consent.

The existing **6-hourly cron** writes `FOLLOW_UP_DUE` events — another enum
value that already exists and is unused — so the dashboard and the extension
agree on what is due.

One batched item: "4 referral follow-ups due", never one per contact.
Per-contact pings are how a tool built to reduce the hectic feeling becomes the
source of it.

**One nudge, then stop.** After `NUDGED`, the clock closes the ask as `COLD` at
+5 days rather than prompting again. Two follow-ups is pestering, and it costs
the contact for every future role at that company — which is the asset actually
being built.

---

## Drafting the message

Slot-filled templates, one per status. **Not a model.** The argument is the one
that already won in `shared/src/skills.ts`: a referral note is four sentences
with five variables, so a model buys nothing, costs a request on a free tier
that runs out, and sends the user's history to a third party. Templates are
instant, free, offline and the same every time. `/api/analyze/answer` is also
still returning 429.

- **Slots:** their first name, role title, company, when the application went
  in, the posting URL, and one line the user wrote themselves about why this
  company.
- **Count the characters on the connection note.** It caps at 200, and free
  accounts get a handful per month. A draft that silently exceeds either is one
  discovered while the dialog is already open.
- **Copy to clipboard; do not type into their composer.** Injecting text into
  LinkedIn's message box is the line between a tool that helped write this and
  a bot. It also breaks the moment they change their editor.
- **Editable and remembered.** Whatever the user changes becomes the template —
  the same loop that makes the blocked-question list shrink over time.

---

## Risks

**LinkedIn's User Agreement.** The user sends everything, so the exposure is
small — but it is not zero, and it stays small only while the tool refuses to
send, refuses to navigate on its own, and refuses to act in bulk. Opening a
search page the user clicked is browsing. Opening forty is not.

**Invitation limits are real.** LinkedIn caps invitations at roughly 100 a week
and flags patterns well below that. Show a weekly counter in the panel, so the
tool discourages the burst that a good suggestion card would otherwise make
easy.

**Web Store review and the privacy policy.** This is the first feature that
stores *other people's* personal data, which is a different disclosure from
everything shipped so far. The privacy policy has had no legal review and
currently describes a tool that handles only the user's own data. Update it
before submission, not after a rejection — the extension already carries review
risk from auto-submit.

**Third-party personal data.** Under India's DPDP Act and the GDPR, storing a
stranger's name and employer is processing. Minimise: name, headline, public
profile URL, and only what the user typed. No harvesting, no enrichment, no
reading their connections. Ship delete-all with the feature rather than after
it.

**Selector rot.** The company-slug read and the profile prefill both depend on
LinkedIn markup. Both are conveniences with a manual path behind them, which is
the right shape — the feature degrades to "type it in" rather than breaking.

---

## Sequencing

### Phase 1 — the record

Two columns on `contacts`, a `contacts.ts` route, the form, and the application
timeline entry. Reachable from the dashboard only.

No LinkedIn reading at all. Already answers *which person did I ask about which
role*, for anything typed in by hand.

### Phase 2 — the suggestion card and the lookup

The panel card with the searches, and the profile-page lookup. This is the pain
fix, and neither half needs a manifest change.

**Built:** `canonicalizeProfileUrl` in `shared/src/normalize.ts`, the read-only
`GET /api/referrals`, the index in `extension/src/referrals.ts`, the profile
card in `ui/referralCard.ts`, and the suggestion card in the panel fed by
`referralSearch.ts`.

Also built: **logging an ask from the profile page**. Pressing one of the
panel's searches records an *intent* — the posting the user went looking from —
in `chrome.storage.local` for thirty minutes. Every profile opened in that
window offers a two-field form, prefilled from the page, and one press logs the
ask. `POST /api/referrals` resolves the application from the posting and
creates it as `SAVED` when there is none.

The intent is what keeps this from being noise. A form on every LinkedIn
profile is what makes an extension feel like spyware; a form on the profiles
someone opened straight after pressing "Recruiters at Acme" is the thing they
wanted. It also avoids reading the company off the profile page — a rot-prone
selector recovering a fact the user's own click already established.

**Not built yet:** the messaging surface, deliberately last. `/messaging/thread/…`
carries no profile id in the URL, so it needs a DOM read and would drag a
rot-proof feature down to a fragile one's lifespan.

### Phase 3 — the reminder

Badge count, due-list query, the `FOLLOW_UP_DUE` cron write, templates.

### Later, and optional — automatic acceptance detection

Reading "X accepted your invitation" from the notifications feed, or a 1st-degree
badge on a profile recorded as `INVITED`, and offering it as a suggestion to
confirm. Never as a state change on the extension's word.

Deliberately last. `/mynetwork` and `/notifications` change more often than job
pages, which already rot fast enough to have their own note in `CLAUDE.md`, and
the lookup in Phase 2 makes this a convenience rather than a requirement.

---

## Open decisions

- ~~**Is an ask always tied to an application?**~~ **Decided: yes, and the
  application is created if it does not exist.** `POST /api/referrals` calls
  `captureApplication` with `applied: false`, which creates the row as `SAVED`
  — the status that already means "tracking, not applied". Blocking a referral
  on paperwork is backwards: the ask is the time-sensitive half. On an existing
  row `applied: false` leaves the status alone, so logging an ask can never
  downgrade something already marked `APPLIED`.
- **Does the queue live inside the tracker row or beside it?** Recommendation is
  inside — the application row grows a line reading
  `2 asks · 1 accepted · nudge due` — so it never becomes a separate app that
  has to be remembered.
- ~~**Should the suggestion card appear on every posting, or only after
  applying?**~~ **Decided: every posting.** The useful moment is often before —
  a referral submitted alongside the application beats one chasing it. The card
  therefore cannot assume an application exists, so the form's "Application"
  row is a picker defaulting to this posting, and offers to create the
  application when there is none.
