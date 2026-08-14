import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MAX_RESUME_BYTES,
  PROFILE_REGIONS,
  extractSkills,
  profileReadiness,
  type Profile,
  type ProfileInput,
  type ProfileRegion,
} from '@jobpilot/shared';
import { api } from '../api.js';
import { LoadingSpinner } from '../components/LoadingSpinner.js';
import { useAuth } from '../auth.js';
import { usePageMeta } from '../usePageMeta.js';
import { Brand } from '../components/SiteChrome.js';
import { MAX_RESUME_TEXT, ResumeError, parseResume } from '../resume.js';

/**
 * Onboarding.
 *
 * Every question here exists because autofill will need the answer later.
 * Nothing is asked to feed job matching or our own analytics — this product
 * does not match people to jobs, and a question asked for our benefit is a
 * question that should not be asked at all.
 *
 * Which is also the promise worth making explicitly: answer it once here,
 * never type it into an application form again.
 */

const STEPS = ['Resume', 'About you', 'Links', 'Eligibility', 'Availability'] as const;

const REGION_LABELS: Record<ProfileRegion, string> = {
  US: 'United States',
  IN: 'India',
  UK: 'United Kingdom',
  EU: 'Europe',
  CA: 'Canada',
  AU: 'Australia',
};

type Draft = ProfileInput;

export function Onboarding() {
  usePageMeta('Set up your profile', undefined, '/onboarding');

  const navigate = useNavigate();
  const { signOut } = useAuth();

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load whatever already exists so a half-finished onboarding resumes rather
  // than starting over.
  useEffect(() => {
    let cancelled = false;
    api
      .getProfile()
      .then(({ profile }) => {
        if (cancelled) return;
        if (profile.onboardingCompletedAt) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setDraft(profile);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your profile'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const patch = useCallback((fields: Draft) => {
    setDraft((current) => ({ ...current, ...fields }));
  }, []);

  /** Saves progress so far. Called on every step change, not only at the end. */
  const save = useCallback(
    async (extra: Draft & { onboardingComplete?: boolean } = {}) => {
      setSaving(true);
      setError(null);
      try {
        await api.updateProfile({ ...draft, ...extra });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [draft]
  );

  async function next() {
    if (!(await save())) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo(0, 0);
    } else {
      if (await save({ onboardingComplete: true })) navigate('/dashboard', { replace: true });
    }
  }

  if (loading) return <LoadingSpinner label="Setting up your account…" fullPage />;

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="ob">
      <header className="ob-bar">
        <Brand />
        <button className="btn-link" onClick={signOut}>
          Sign out
        </button>
      </header>

      <div className="ob-progress-row">
        <button
          className="ob-back"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          aria-label="Previous step"
        >
          ←
        </button>
        <div className="ob-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="ob-step-count">
          {step + 1}/{STEPS.length}
        </span>
      </div>

      <main className="ob-main">
        {step === 0 && <ResumeStep draft={draft} patch={patch} />}
        {step === 1 && <AboutStep draft={draft} patch={patch} />}
        {step === 2 && <LinksStep draft={draft} patch={patch} />}
        {step === 3 && <EligibilityStep draft={draft} patch={patch} />}
        {step === 4 && <AvailabilityStep draft={draft} patch={patch} />}

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </main>

      <footer className="ob-footer">
        <div className="ob-footer-inner">
          <span className="ob-hint">{STEPS[step]}</span>
          <button className="btn btn-primary" onClick={() => void next()} disabled={saving}>
            {saving ? 'Saving…' : step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}
          </button>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

interface StepProps {
  draft: Draft;
  patch: (fields: Draft) => void;
}

/**
 * Only the fields the parser actually found.
 *
 * `extractFields` returns the full shape with null for everything it could not
 * read, and spreading that into the draft overwrote real answers with those
 * nulls — the email captured at sign-up disappeared whenever a resume printed
 * it in a form the regex missed, and a second upload could empty the roles the
 * first one found. A resume is evidence to add, never a reason to forget
 * something already known.
 */
function foundOnly(fields: ProfileInput): ProfileInput {
  const kept: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    kept[key] = value;
  }

  return kept as ProfileInput;
}

/** Case-insensitive union, keeping whatever spelling was already there. */
function mergeSkills(existing: string[] | undefined, found: string[]): string[] {
  const seen = new Set((existing ?? []).map((skill) => skill.toLowerCase()));
  const merged = [...(existing ?? [])];

  for (const skill of found) {
    if (seen.has(skill.toLowerCase())) continue;
    seen.add(skill.toLowerCase());
    merged.push(skill);
  }

  return merged;
}

/**
 * Keep the file itself, so the profile has a resume without a second upload.
 *
 * Returns null when it is stored and a sentence when it is not. Not throwing,
 * and deliberately not `setProblem`: the parsed fields are what this step is
 * for and they are already saved by the time this runs, so a file that cannot
 * be stored is a footnote, never a failed step. Silence would be worse than
 * either — someone who is told nothing assumes their resume is on the account
 * and finds out otherwise the first time an application needs it.
 *
 * The two rejections are known in advance, so they are answered here rather
 * than as a round trip that comes back 415 or 413:
 *
 * - The API takes PDF and Word. The picker also accepts .txt and .md because
 *   parsing them works fine, and storing them does not.
 * - `MAX_RESUME_BYTES` is 200KB, far below the 10MB this can *read*. The two
 *   limits are unrelated — one bounds a parse in this tab, the other bounds
 *   what the free tier stores — and conflating them would refuse a file the
 *   user could perfectly well have parsed.
 */
async function storeResume(file: File): Promise<string | null> {
  if (!/\.(pdf|docx?)$/i.test(file.name)) {
    return 'Read and saved to your profile. The file itself is only kept for PDF and Word — upload one of those later if you want it attached to applications.';
  }

  if (file.size > MAX_RESUME_BYTES) {
    return `Read and saved to your profile, but the file is over ${Math.round(
      MAX_RESUME_BYTES / 1024
    )}KB so it was not kept. Re-export it smaller from your profile to attach it to applications.`;
  }

  try {
    await api.uploadResume(file);
    return null;
  } catch (err) {
    return err instanceof Error
      ? `Read and saved to your profile, but the file could not be stored: ${err.message}`
      : 'Read and saved to your profile, but the file could not be stored.';
  }
}

function ResumeStep({ draft, patch }: StepProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [stored, setStored] = useState(false);
  /** Why the file was not kept, when the fields were read anyway. */
  const [note, setNote] = useState<string | null>(null);
  /*
   * A ref, not the `busy` state, because the state this closure can see is the
   * one from its own render. Two drops inside a single tick would both read
   * false and both start, which is exactly the case the guard exists for.
   */
  const running = useRef(false);

  async function handleFile(file: File) {
    /*
     * One at a time. The button disables itself while this runs but the drop
     * zone cannot, and two files in flight is a genuine mess: the uploads race,
     * the API keeps one resume per user so the loser silently wins if it lands
     * second, and the fields on screen would describe a different document from
     * the one stored.
     */
    if (running.current) return;
    running.current = true;

    setBusy(true);
    setProblem(null);
    setNote(null);
    setStored(false);

    try {
      const parsed = await parseResume(file);

      /*
       * `rawText` was already extracted to find the fields below and was
       * thrown away here. Keeping it is what lets skills matching see the
       * whole CV rather than only the handful of fields this parser
       * recognises — and it costs nothing, the work is already done.
       *
       * The skills chips come out of the same text, through the same
       * dictionary the matcher uses, so what is on the profile and what a
       * posting is compared against cannot disagree. Merged rather than
       * assigned: someone re-picking a file after typing a skill by hand
       * should not lose it.
       */
      patch({
        ...foundOnly(parsed.fields),
        skills: mergeSkills(draft.skills, extractSkills(parsed.rawText)),
        resumeFileName: file.name,
        resumeText: parsed.rawText.trim().slice(0, MAX_RESUME_TEXT) || null,
      });
      setFound(parsed.found);

      /*
       * After the parse, never instead of it. A file that stores but does not
       * parse leaves someone typing everything by hand with a PDF attached,
       * which is the wrong half of this step to get right.
       */
      const failure = await storeResume(file);
      setNote(failure);
      setStored(failure === null);
    } catch (err) {
      setProblem(
        err instanceof ResumeError ? err.message : 'Could not read that file. Try a different PDF.'
      );
    } finally {
      // Both flags here, and in a finally: an early return that cleared the
      // state but not the ref would leave the picker dead for the rest of the
      // step, with a working button that does nothing when pressed.
      setBusy(false);
      running.current = false;
    }
  }

  return (
    <section className="ob-step">
      <h1>Start from your resume</h1>
      {/*
        This used to promise the file never leaves the device, which stopped
        being true the moment it was stored — and a privacy line that has
        quietly gone stale is worse than none. Reading still happens entirely
        in this tab; the file is kept so applications can attach it and so
        nobody has to upload the same document twice.
      */}
      <p className="ob-sub">
        We read it in your browser to fill in what we can, and keep a copy on your account so you
        never have to upload it again. Only the details you confirm on the next screens are saved
        to your profile.
      </p>

      <div
        className="ob-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        <input
          ref={input}
          type="file"
          accept=".pdf,.txt,.md"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <button className="btn btn-ghost" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Reading…' : 'Choose a PDF'}
        </button>
        <span className="ob-drop-hint">
          or drop it here · PDF or plain text, up to 10MB · kept on your account if it is a PDF or
          Word file under {Math.round(MAX_RESUME_BYTES / 1024)}KB
        </span>
      </div>

      {problem && <p className="error-text">{problem}</p>}

      {found && (
        <div className="ob-found">
          <strong>{draft.resumeFileName}</strong>
          <p className="muted">
            Picked up {found.length} field{found.length === 1 ? '' : 's'}
            {draft.experience?.length ? `, including ${draft.experience.length} roles` : ''}
            {draft.skills?.length ? ` and ${draft.skills.length} skills` : ''}. Check them on the
            next screens — parsing is a shortcut, not a source of truth.
          </p>
          {/*
            Said plainly either way. "Saved" is the whole reason this step
            uploads at all, and the failures are the cases where someone would
            otherwise believe their resume is on the account when it is not.
          */}
          {stored && <p className="muted">Saved to your account — no need to upload it again.</p>}
          {note && <p className="muted">{note}</p>}
        </div>
      )}

      <p className="ob-skip muted">
        No resume handy? Continue and type the details instead — it takes a couple of minutes, once.
      </p>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="ob-field">
      {label}
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function AboutStep({ draft, patch }: StepProps) {
  return (
    <section className="ob-step">
      <h1>Confirm your details</h1>
      <p className="ob-sub">These go into the contact fields on every application form.</p>

      <div className="ob-grid">
        <Field label="First name" value={draft.firstName} onChange={(v) => patch({ firstName: v })} />
        <Field label="Last name" value={draft.lastName} onChange={(v) => patch({ lastName: v })} />
        <Field label="Email" type="email" value={draft.email} onChange={(v) => patch({ email: v })} />
        <Field label="Phone" type="tel" value={draft.phone} onChange={(v) => patch({ phone: v })} />
        <Field label="City" value={draft.city} onChange={(v) => patch({ city: v })} />
        <Field label="Country" value={draft.country} onChange={(v) => patch({ country: v })} />
        <Field
          label="Current title"
          value={draft.currentTitle}
          onChange={(v) => patch({ currentTitle: v })}
        />
        <Field
          label="Current company"
          value={draft.currentCompany}
          onChange={(v) => patch({ currentCompany: v })}
        />
      </div>
    </section>
  );
}

function LinksStep({ draft, patch }: StepProps) {
  return (
    <section className="ob-step">
      <h1>Your links</h1>
      <p className="ob-sub">
        Asked for on most applications, and tedious to retype. Leave any of them blank.
      </p>

      <div className="ob-grid ob-grid-1">
        <Field
          label="LinkedIn"
          type="url"
          value={draft.linkedinUrl}
          onChange={(v) => patch({ linkedinUrl: v })}
          placeholder="https://linkedin.com/in/…"
        />
        <Field
          label="GitHub"
          type="url"
          value={draft.githubUrl}
          onChange={(v) => patch({ githubUrl: v })}
          placeholder="https://github.com/…"
        />
        <Field
          label="Portfolio or website"
          type="url"
          value={draft.portfolioUrl}
          onChange={(v) => patch({ portfolioUrl: v })}
        />
      </div>
    </section>
  );
}

function Choice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const options: [string, boolean | null][] = [
    ['Yes', true],
    ['No', false],
    ['Prefer not to say', null],
  ];

  return (
    <fieldset className="ob-choice">
      <legend>{label}</legend>
      <div className="ob-choice-row">
        {options.map(([text, option]) => (
          <button
            key={text}
            type="button"
            className="ob-option"
            data-selected={value === option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function EligibilityStep({ draft, patch }: StepProps) {
  const regions = draft.regions ?? [];

  return (
    <section className="ob-step">
      <h1>Work eligibility</h1>
      <p className="ob-sub">
        These are the questions that actually filter applications automatically, so they are worth
        getting right.
      </p>

      <Choice
        label="Are you authorised to work without sponsorship?"
        value={draft.authorizedToWork}
        onChange={(v) => patch({ authorizedToWork: v })}
      />
      <Choice
        label="Will you require visa sponsorship?"
        value={draft.requiresSponsorship}
        onChange={(v) => patch({ requiresSponsorship: v })}
      />
      <Choice
        label="Are you willing to relocate?"
        value={draft.willingToRelocate}
        onChange={(v) => patch({ willingToRelocate: v })}
      />

      <fieldset className="ob-choice">
        <legend>Where are you applying?</legend>
        <p className="muted ob-legend-hint">
          Forms differ by market. This decides which extra questions autofill answers — Indian forms
          ask for CTC and notice period, US forms ask about work authorisation and self-identification.
        </p>
        <div className="ob-chips">
          {PROFILE_REGIONS.map((region) => {
            const on = regions.includes(region);
            return (
              <button
                key={region}
                type="button"
                className="ob-chip"
                data-selected={on}
                onClick={() =>
                  patch({
                    regions: on ? regions.filter((r) => r !== region) : [...regions, region],
                  })
                }
              >
                {REGION_LABELS[region]}
              </button>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

function AvailabilityStep({ draft, patch }: StepProps) {
  const availability = draft.availability ?? {
    noticePeriodDays: null,
    servingNotice: null,
    lastWorkingDay: null,
    earliestStartDate: null,
  };

  const notices: [string, number][] = [
    ['Immediately', 0],
    ['2 weeks', 14],
    ['1 month', 30],
    ['2 months', 60],
    ['3 months', 90],
  ];

  return (
    <section className="ob-step">
      <h1>Availability</h1>
      <p className="ob-sub">
        Every application asks when you can start. Answer once here and stop doing the arithmetic on
        each form.
      </p>

      <fieldset className="ob-choice">
        <legend>Notice period</legend>
        <div className="ob-chips">
          {notices.map(([text, days]) => (
            <button
              key={text}
              type="button"
              className="ob-chip"
              data-selected={availability.noticePeriodDays === days}
              onClick={() => patch({ availability: { ...availability, noticePeriodDays: days } })}
            >
              {text}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="ob-grid ob-grid-1">
        <label className="ob-field">
          Earliest start date
          <input
            type="date"
            value={availability.earliestStartDate ?? ''}
            onChange={(e) =>
              patch({
                availability: { ...availability, earliestStartDate: e.target.value || null },
              })
            }
          />
        </label>
      </div>

      <ReadinessSummary draft={draft} />
    </section>
  );
}

/** Final honesty check: what autofill will and will not be able to answer. */
function ReadinessSummary({ draft }: { draft: Draft }) {
  const readiness = profileReadiness(draft as Profile);

  return (
    <div className="ob-readiness">
      <div className="ob-readiness-head">
        <strong>
          {readiness.complete} of {readiness.total} core fields ready
        </strong>
        <span className="lamp lamp-live">autofill</span>
      </div>
      {readiness.missing.length > 0 ? (
        <p className="muted">
          Still blank: {readiness.missing.join(', ')}. Autofill will leave those fields alone rather
          than guess — you can fill them in later from your profile.
        </p>
      ) : (
        <p className="muted">Everything autofill needs is set. You can change any of it later.</p>
      )}
    </div>
  );
}
