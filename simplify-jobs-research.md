# Simplify.jobs — Product & Feature Research

Source: public marketing pages on https://simplify.jobs
Collected: 2026-08-05

---

## 1. Positioning

**Headline:** "Your AI job search partner. Powered by one profile."

**Subheadline:** "Get matched with jobs, tailor your resume, build your network, and track every opportunity in one place."

The whole product hangs off a single idea: the user fills out **one canonical profile**, and every other feature (autofill, matching, resume tailoring, tracking) reads from it. That's the architectural centerpiece — not the individual tools.

Positioning phrase from the About page: *"the world's first candidate-first recruiting platform"* / a **"personal talent agent."**

---

## 2. Product surface

### 2.1 Copilot — browser extension
The flagship feature and main acquisition hook.

- **Application autofill** — maps saved profile fields onto application forms automatically.
- **AI answer generation** — writes personalized responses to open-ended questions ("why are you a good fit?") by reading the job description.
- **Inline resume scoring** — scores the resume against the specific posting being viewed and suggests improvements.
- **Auto-capture** — submitted applications are silently saved to the tracker dashboard; no manual logging.

**Flow:**
1. User creates profile at signup
2. Installs browser extension
3. Visits a compatible job posting → Simplify popup appears
4. User clicks autofill → fields map from profile
5. Job-specific questions get AI-generated answers on demand

**Coverage:** 100+ job boards and ATS systems, incl. Workday, Greenhouse, iCIMS, Taleo, Avature, Lever, SmartRecruiters, LinkedIn, Indeed.

**Limits:** none stated — unlimited autofills, free permanently.

**CTA:** "Get the Extension — It's Free!" / "Add to Chrome"

### 2.2 Job Application Tracker

- All applications in one dashboard, populated automatically by Copilot
- Per-application status updates
- **Auto-generated recruiter follow-up emails**
- Recruiter + referral contacts stored per application
- Interview notes, dates, deadlines
- Job bookmarking from anywhere on the web
- CSV/spreadsheet import for applications made before signup
- Analytics: resume performance, progress visualization, funnel insights

Note: the page does **not** publish a specific status taxonomy (applied → screen → onsite → offer). That's left undefined publicly.

**CTAs:** "Track an application!" · "See your insights" · "Bookmark a job" · "Start tracking now"

### 2.3 AI Resume Builder

- Tailors a resume against a pasted/linked job description
- Identifies **missing keywords** from the posting
- Returns a **resume score** indicating optimization level
- AI rewrites bullet points and generates professional summaries
- ATS-compatible pre-built templates
- One-click tailored cover letters
- Explicitly stated: powered by **OpenAI GPT**, trained on recruiter-vetted resumes

Export formats are not specified on the page.

### 2.4 Job Matches
Personalized job recommendations derived from the profile and stated preferences. CTA: "Get Matched Now."

### 2.5 Secondary tools (mentioned, thinner public detail)
- Resume ATS Score analyzer (standalone)
- Cover letter & email generator
- Career Journal
- Networking Copilot / intro requests
- Handpicked / curated job lists
- AI Interviewer (referenced on the resume-builder page; no dedicated URL found)
- Human resume review service

---

## 3. Business model

**Candidate side: free.** Repeatedly and emphatically — autofill, tracker, job matches, and the basic resume builder are stated to remain free indefinitely. There is **no `/pricing` page** (404). Any paid candidate tier is not publicly marketed.

**Employer side: this is where the money is.** Simplify operates as a recruiting firm on top of its candidate network.

| Tier | Price | What you get |
|---|---|---|
| Self-serve (Post a Job) | $1,000–$2,000 per role, dynamically priced by volume | Job distributed to the network; applicants land in your ATS; you screen |
| Full-service recruiting | $5,000/mo per role **+** $25K–$50K placement fee | Managed inbound, AI + human outbound sourcing, referral bounties, vetted candidates delivered to Slack/email |

- Monthly retainer credits toward the placement fee
- 90-day replacement guarantee
- Sells access to a private network of ~2M active candidates, claimed 25% from top-20 institutions
- **Referral bounty engine** — network members get paid to refer qualified contacts

**Takeaway:** the free candidate product is the supply-side funnel. The candidate database *is* the product being sold.

---

## 4. Traction claims

Numbers are **inconsistent across pages** — treat as marketing, not data:

| Metric | Landing page | Resume builder page | About page | Employers page |
|---|---|---|---|---|
| Users | 1,500,000+ | 1.4M+ | 2M+ | 2M+ candidates |
| Applications | 200,000,000+ | 40M+ | 100M+ (past year) | — |
| Resumes created | — | 2M+ | — | — |
| Response-rate lift | 25% higher | "25% more" callbacks | — | — |

Companies where users landed: Google, Meta, Goldman Sachs, Jane Street, Deloitte, Insight Partners, Alation, FYPM, Polydelta.

Sample testimonial: *"Simplify notified me about Google's APM program the day it opened which was crucial in landing the offer!"* — Grace, joined Google.

---

## 5. Company

- Founded by **Michael Yan, Rushil Srivastava, and Ethan Horoschak** — Stanford and Berkeley dropouts
- Origin story: founders applied to 1,000+ jobs themselves
- Raised **$12M** (per a referenced Forbes piece)
- Press: Forbes, TechCrunch, Time, CNN

**Stated principles** (useful as differentiators, and as a trust play):
- Does not sell personal data to third-party advertisers
- Refuses employer requests to suppress salary data or community reviews
- Flags companies that attempt suppression with a **"Candidate Advisory" badge**

---

## 6. Site map

**Nav:** Copilot · Job Application Tracker · Resume Builder · Employers · Blog · Log In
**Footer:** About · Careers · For Employers · Support & FAQ · Terms · Privacy · Refund Policy
**Primary CTAs:** "Join Now — It's Free!" · "Add to Chrome" · "Get Matched Now" · "Start Hiring" (employer)

**Verified URLs**
- `/` · `/copilot` · `/job-application-tracker` · `/resume-builder` · `/employers` · `/about` — all live
- `/pricing` · `/ai-interview` — **404**

---

## 7. Notes for jobpilot

Observations relevant to building something in this space:

1. **The single-profile model is the moat, not the AI.** Autofill quality depends entirely on how well the profile schema maps to real ATS form fields. That mapping layer across 100+ ATS platforms is the hard, unglamorous engineering.
2. **The browser extension is the wedge.** It's the only piece that touches the user during their actual workflow, and it's what produces the tracking data for free.
3. **Tracking is a byproduct, not a feature.** Because autofill already sits on the page at submit time, capture is automatic. A tracker without an extension requires manual entry and will lose to this.
4. **Monetization is B2B.** A candidate-facing clone with no employer side has no revenue model — Simplify's free tier is subsidized by recruiting fees.
5. **Undefined publicly, so free to design:** application status taxonomy, resume export formats, matching algorithm, AI Interviewer scope.

---

*All content above is from publicly accessible marketing pages. No authenticated areas, job-listing data, or user data were accessed.*
