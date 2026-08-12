import { formatDate } from '@jobpilot/shared';
import { usePageMeta } from '../usePageMeta.js';
import { SITE } from '../content/site.js';

/**
 * Policy pages.
 *
 * The content below describes what this codebase actually does — the data it
 * stores, where the extension runs, what leaves the browser. That accuracy is
 * the part that matters for the Chrome Web Store review.
 *
 * It is NOT legal advice and has not been reviewed by a lawyer. Have someone
 * qualified check it before you take real users, and fill in SITE in
 * content/site.ts first.
 */

function updated(): string {
  return formatDate(SITE.policyUpdated);
}

export function Privacy() {
  usePageMeta(
    'Privacy',
    'What BanApply stores, what the browser extension can access, and what is never collected or sold.',
    '/privacy'
  );

  return (
    <div className="shell">
      <div className="page-head">
        <span className="eyebrow">Privacy</span>
        <h1>Privacy policy</h1>
        <p className="post-meta">Last updated {updated()}</p>
      </div>

      <article className="prose">
        <p>
          {SITE.name} is a job application tracker. This page describes what it stores, what the
          browser extension can access, and what happens to that data.
        </p>

        <h2>What is stored</h2>
        <ul>
          <li>
            <strong>Account:</strong> your email address and a hashed password. The password itself
            is never stored and cannot be recovered from the hash.
          </li>
          <li>
            <strong>Profile, for autofill:</strong> the details you enter so you do not have to
            retype them — name, email, phone, address, professional links, work history, education,
            work authorization, notice period, salary expectation, and any answers you choose to
            save to recurring application questions. You control every field and can clear any of
            them.
          </li>
          <li>
            <strong>Voluntary self-identification:</strong> if, and only if, you turn it on. Gender,
            ethnicity, veteran and disability status are treated as a separate opt-in group, are off
            by default, and are never filled into a form while that group is disabled.
          </li>
          <li>
            <strong>Applications:</strong> job title, company, posting URL, location, listed salary
            where the employer published one, the date you applied, and the status you or the system
            assigns.
          </li>
          <li>
            <strong>Activity:</strong> a log of changes to each application — when it was created,
            when its status changed, and the result of each posting liveness check.
          </li>
          <li>
            <strong>Anything you add:</strong> notes and contacts you enter yourself.
          </li>
        </ul>

        <h2>What the extension can access</h2>
        <p>
          The extension runs only on the job boards listed in its permissions. It cannot read other
          tabs, your browsing history, or any site outside that list.
        </p>
        <p>
          On a supported posting it reads the publicly visible job details. Nothing is sent to the
          server unless you apply to the job or explicitly save it. Your sign-in token is stored in
          the browser&rsquo;s local extension storage and is not synced across devices.
        </p>

        <h2>How autofill works</h2>
        <p>
          When you ask it to fill a form, the extension reads the field labels on that page,
          matches them against your profile, and writes your saved values in. Your profile is sent
          from our server to your browser to do this; the values you enter go directly from your
          browser into the employer&rsquo;s form.
        </p>
        <p>
          We do not receive a copy of the application you submit, and the contents of forms you fill
          in are not read back or stored. Autofill never submits an application on your behalf.
        </p>

        <h2>What is never collected</h2>
        <ul>
          <li>
            Passwords, payment or bank details, government identifiers, or dates of birth. Autofill
            refuses these fields outright and none are stored.
          </li>
          <li>Keystrokes, or page text beyond the job details and form labels described above.</li>
          <li>The contents of applications you submit.</li>
          <li>Browsing activity on any site the extension is not explicitly permitted on.</li>
        </ul>

        <h2>Sharing</h2>
        <p>
          Your application data is not sold, rented, or shared with employers, recruiters, or
          advertisers. It is used to operate your tracker and nothing else.
        </p>
        <p>
          Aggregate statistics — for example, typical response times at a given company — may be
          derived across accounts in future. Any such figure would be reported only in a form that
          cannot identify you or your individual applications.
        </p>

        <h2>Service providers</h2>
        <p>
          The service runs on third-party infrastructure for hosting and database storage. Those
          providers process data only to run the service and under their own security obligations.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Your data is kept while your account exists. Deleting an application removes it and its
          history. You can request account deletion at any time, which removes your applications,
          notes, and contacts.
        </p>

        <h2>Your data is yours</h2>
        <p>
          You can export your applications at any time. A tracker you cannot leave is worse than the
          spreadsheet it replaced.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy, or a deletion request: <strong>{SITE.contactEmail}</strong>.
        </p>
      </article>
    </div>
  );
}

export function Terms() {
  usePageMeta('Terms', `The terms covering use of ${SITE.name}.`, '/terms');

  return (
    <div className="shell">
      <div className="page-head">
        <span className="eyebrow">Terms</span>
        <h1>Terms of service</h1>
        <p className="post-meta">Last updated {updated()}</p>
      </div>

      <article className="prose">
        <p>
          By creating an account or installing the extension you agree to these terms. If you do not
          agree, do not use the service.
        </p>

        <h2>The service</h2>
        <p>
          {SITE.name} records job applications you submit and reports on their status. It is provided
          free during early access. Features may change, and access may be limited or discontinued.
        </p>

        <h2>Your account</h2>
        <p>
          You are responsible for keeping your password secure and for activity under your account.
          Use an address you control, and tell us promptly if you believe your account has been
          accessed by someone else.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Do not use the service to send automated applications or otherwise spam employers.</li>
          <li>Do not attempt to access another user&rsquo;s data.</li>
          <li>
            Do not attempt to disrupt the service, circumvent rate limits, or reverse engineer it to
            build a competing scraper.
          </li>
        </ul>

        <h2>Accuracy</h2>
        <p>
          Automatic capture, duplicate detection, and posting checks are best-effort. Job boards
          change without notice, and detection can miss an application or flag one incorrectly. Do
          not rely on {SITE.name} as the sole record of your job search, and verify anything that
          matters.
        </p>

        <h2>No warranty</h2>
        <p>
          The service is provided &ldquo;as is&rdquo;, without warranties of any kind. It may be
          unavailable, lose data, or behave incorrectly. To the extent permitted by law,{' '}
          {SITE.legalEntity} is not liable for any loss arising from your use of it — including any
          missed opportunity or duplicated application.
        </p>

        <h2>Ending it</h2>
        <p>
          You can stop using the service and delete your account at any time. We may suspend or
          terminate accounts that breach these terms.
        </p>

        <h2>Changes</h2>
        <p>
          These terms may be updated. Material changes will be reflected in the date above, and
          continued use after a change means you accept it.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: <strong>{SITE.contactEmail}</strong>.
        </p>
      </article>
    </div>
  );
}
