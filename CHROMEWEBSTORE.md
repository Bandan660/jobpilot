# Chrome Web Store Listing — BanApply

> Last Updated: 2026-08-12

## Store Listing

**Extension Name** [REQUIRED]
`BanApply - Autofill & Job Application Tracker`

**Short Description** [REQUIRED]
`Autofills job applications from one profile, warns you before you apply twice, and tells you when a posting comes down.`

**Detailed Description** [REQUIRED]
BanApply automates the tedious parts of your job hunt. Fill out application forms with one click, track every job you apply to automatically, and get alerted the moment a posting comes down.

Assisted Apply — what it does, stated plainly:
When you press "Apply with BanApply" on a job posting, the extension fills the application form from your profile and, if every required question can be answered from it, submits the form for you. It only ever does this after you press that button, on the posting you are looking at. If a question cannot be answered from your profile, it stops, names the question, and waits for you to answer it in the page's own form. You can cancel a run at any point. Autofill used on its own never submits anything — filling and sending are separate actions, and only one of them has a button that sends.

Key Features:
- One-Click Autofill: Detects and fills out fields on LinkedIn Easy Apply, Indeed, Naukri, Greenhouse, Lever, Ashby, and more using your saved master profile.
- Universal Application Tracker: Applications submit directly into your personal dashboard so you never have to maintain manual spreadsheets.
- Smart Duplicate Warning: Automatically checks whether you've already applied to a role across different platforms before you submit.
- Real-Time Skill Overlap: Compares the required skills in any job description against your profile directly inside the browser overlay.
- Dead Posting Monitor: Automatically tracks saved postings and notifies you when a listing is taken down by the employer.

How to Use:
1. Install the BanApply Chrome extension and sign in at banapply.com.
2. Complete your master candidate profile once.
3. Open any job posting on supported sites and click the BanApply floating overlay panel to autofill fields or track the application automatically upon submission.

Privacy & Security:
BanApply prioritizes candidate privacy. Your skills matching is calculated locally offline in your browser, sensitive payment and national ID numbers are strictly blocked from being touched, and your application data is never sold to third parties.

Support & Feedback:
Need help or have suggestions? Visit https://banapply.com or email bandanpradhan456@gmail.com.


**Category** [REQUIRED]
`Productivity`

**Single Purpose** [REQUIRED]
`Autofills job application forms from a master candidate profile and automatically records applications in a central tracker.`

**Primary Language** [REQUIRED]
`English`

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `extension/icons/icon128.png` — regenerate with `npm run icons` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `extension/store-assets/1-tracker.png` — the tracker, with platform marks and dead-posting lamps |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `extension/store-assets/2-dashboard.png` — dashboard, funnel and setup checklist |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `extension/store-assets/3-profile.png` — the one profile that fills every form |
| Screenshot 4 [RECOMMENDED] | 1280×800 | ✅ Ready | `extension/store-assets/4-panel.png` — the panel on a live posting, match score and must-have gap |
| Screenshot 5 [OPTIONAL] | 1280×800 | 🟡 Needs capture | Autofill filling a real ATS form |

Screenshot 4 came from a real capture on a live posting, so it had the signed-in
account in its header. That is replaced with `you@…` rather than blurred: a blur
still says something was there and invites the guess, while a neutral address
says nothing and reads as intended design. **The unmasked original is
deliberately not in this repo** — a store asset folder is exactly where a real
address quietly becomes permanent.

### How the ready ones were produced

Demo mode against fixtures (`VITE_DEMO=1`), so **no real personal data is in
them** — the profile shown is `DEMO_PROFILE_FIELDS`, which is fictional by
construction. That matters more than convenience: a store screenshot is public
forever, and the easiest way to publish someone's phone number is to screenshot
a real profile.

They were composed at a true 1280×800 layout and captured scaled, because this
machine's display is 1280×720 and an 800px-tall viewport does not exist on it.
Redo them the same way if the UI changes:

```bash
cd frontend && VITE_DEMO=1 npx vite --host 127.0.0.1
# then, in the page:
#   document.getElementById('root').style.cssText =
#     'width:1280px;height:800px;overflow:hidden;position:fixed;top:0;left:0;' +
#     'transform:scale(0.66125);transform-origin:0 0;'
# capture, then resize to exactly 1280x800 — the store validates the dimensions
```

The two remaining shots need a signed-in LinkedIn session and the extension
loaded. **Blur or fake anything identifying** before uploading: recruiter names,
your own contact details in a half-filled form, other tabs in the window.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Persists the user's session token, extension settings, and active auto-apply state locally across browser restarts. |
| `scripting` | permissions | Injects the content script into open job application tabs when the user grants permission for a specific job board platform. |
| `https://api.banapply.com/*` | host_permissions | Connects to the BanApply backend API to save captured job applications and synchronize candidate profile data. |
| `https://jobpilot-api.jobpilot.workers.dev/*` | host_permissions | The same API on its Cloudflare Workers hostname, kept as a fallback so the extension keeps working if the custom domain fails to resolve. |
| `https://boards.greenhouse.io/*` (and 27 others) | optional_host_permissions | Allows autofill and duplicate detection on applicant tracking systems (Greenhouse, Lever, Workday, etc.) only when requested by the user. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Authentication info | Yes | Yes (to BanApply Worker) | User login and session state | No |
| Website content | Yes (Job title, company, URL) | Yes (to BanApply Worker) | Saving application history to user dashboard | No |
| Personally identifiable info | Yes (Name, email, phone) | Yes (to BanApply Worker) | Autofilling job application forms | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL**: `https://banapply.com/privacy`

---

## Developer Info

**Publisher Name**: Bandan Pradhan
**Contact Email**: bandanpradhan456@gmail.com
**Support URL**: `https://banapply.com`
**Homepage URL**: `https://banapply.com`

---

## Pre-Publish Packaging Steps

One command. It builds, produces a store-shaped copy of the manifest, and
writes `extension/banapply-v<version>.zip` ready to upload:

```bash
npm run build:store
```

**Do not hand-zip `extension/dist`.** That was the old instruction here and it
was wrong in two ways, both silent:

- `dist` carries `http://localhost:8787/*` in `host_permissions`. It belongs in
  the source manifest — `npm run dev:api` and the popup's API override need it —
  and it must not ship. The only honest justification for a plain-HTTP
  localhost grant on a published extension is "used during development", which
  is an argument for removing it. `store.mjs` strips it and prints what it
  stripped.
- `Compress-Archive` writes entry names with backslashes, against the spec.
  Archives built that way have a history of being rejected or unpacked flat by
  tools that read the names literally. `store.mjs` writes the zip itself, so
  the paths are always `icons/icon128.png` and never `icons\icon128.png`.

The `.map` files **do** ship, deliberately — see the comment at the top of
`build.mjs`. A minified bundle with no map turned a real error report into
`content.js:322 (se)` and cost a debugging session; a .crx is a zip anyone can
unpack and Web Store review reads the source regardless, so there is nothing
protected by leaving them out. They cost ~700KB against a 2GB limit.

Verify before uploading:

```bash
# entries should use forward slashes, with manifest.json at the root
unzip -l extension/banapply-v0.1.0.zip
```
