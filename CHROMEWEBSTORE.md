# Chrome Web Store Listing — BanApply

> Last Updated: 2026-08-12

## Store Listing

**Extension Name** [REQUIRED]
`BanApply - Autofill & Job Application Tracker`

**Short Description** [REQUIRED]
`Autofills job applications from one profile, warns you before you apply twice, and tells you when a posting comes down.`

**Detailed Description** [REQUIRED]
BanApply automates the tedious parts of your job hunt. Fill out application forms with one click, track every job you apply to automatically, and get alerted the moment a posting comes down.

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
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `extension/icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | 🟡 Needs capture | Overlay panel on LinkedIn Easy Apply |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | 🟡 Needs capture | Autofill in action on Greenhouse form |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | 🟡 Needs capture | BanApply Web Dashboard & Tracker |

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Persists the user's session token, extension settings, and active auto-apply state locally across browser restarts. |
| `scripting` | permissions | Injects the content script into open job application tabs when the user grants permission for a specific job board platform. |
| `https://api.banapply.com/*` | host_permissions | Connects to the BanApply backend API to save captured job applications and synchronize candidate profile data. |
| `http://localhost:8787/*` | host_permissions | Connects to the local development API server during extension testing and debugging. |
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

To build the zip file ready for submission to Chrome Web Store Developer Dashboard:

```bash
# 1. Build the extension bundle
npm run build:extension

# 2. Package extension/dist into a zip file (excluding source / node_modules)
# Windows PowerShell:
Compress-Archive -Path extension/dist/* -DestinationPath banapply-extension-v0.1.0.zip -Force
```
