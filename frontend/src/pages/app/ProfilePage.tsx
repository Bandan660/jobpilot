import { useEffect, useState } from 'react';
import {
  PROFILE_REGIONS,
  profileReadiness,
  type MoneyAmount,
  type PayPeriod,
  type Profile,
  type ProfileInput,
  type ProfileRegion,
} from '@jobpilot/shared';
import { api } from '../../api.js';
import { usePageMeta } from '../../usePageMeta.js';

/**
 * The profile autofill reads from.
 *
 * Grouped the way application forms ask, not the way the database stores it —
 * someone editing this is thinking "what does a form want from me", not "which
 * column is this".
 */

const REGION_LABELS: Record<ProfileRegion, string> = {
  US: 'United States',
  IN: 'India',
  UK: 'United Kingdom',
  EU: 'Europe',
  CA: 'Canada',
  AU: 'Australia',
};

const PERIODS: PayPeriod[] = ['YEAR', 'MONTH', 'WEEK', 'DAY', 'HOUR'];

export function ProfilePage() {
  usePageMeta('Profile', undefined, '/dashboard/profile');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<ProfileInput>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProfile()
      .then(({ profile: p }) => {
        setProfile(p);
        setDraft(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your profile'))
      .finally(() => setLoading(false));
  }, []);

  function patch(fields: ProfileInput) {
    setDraft((current) => ({ ...current, ...fields }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { profile: updated } = await api.updateProfile(draft);
      setProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="centered">Loading…</p>;

  const readiness = profileReadiness({ ...profile, ...draft } as Profile);
  const dirty = profile ? JSON.stringify(draft) !== JSON.stringify(profile) : false;

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>Your profile</h1>
        <p className="muted">
          Autofill reads from here. Anything left blank is left blank on the form — it never
          guesses.
        </p>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>
            {readiness.complete} of {readiness.total} core fields ready
          </h2>
          <span className={`lamp lamp-${readiness.missing.length === 0 ? 'live' : 'wait'}`}>
            autofill
          </span>
        </div>
        {readiness.missing.length > 0 && (
          <p className="muted">Still blank: {readiness.missing.join(', ')}.</p>
        )}
      </section>

      <Group title="Contact" hint="Goes into the contact fields on every application.">
        <div className="form-grid">
          <Text label="First name" value={draft.firstName} onChange={(v) => patch({ firstName: v })} />
          <Text label="Last name" value={draft.lastName} onChange={(v) => patch({ lastName: v })} />
          <Text label="Preferred name" value={draft.preferredName} onChange={(v) => patch({ preferredName: v })} />
          <Text label="Email" type="email" value={draft.email} onChange={(v) => patch({ email: v })} />
          <Text label="Phone" type="tel" value={draft.phone} onChange={(v) => patch({ phone: v })} />
          <Text label="Address" value={draft.addressLine1} onChange={(v) => patch({ addressLine1: v })} />
          <Text label="City" value={draft.city} onChange={(v) => patch({ city: v })} />
          <Text label="State / region" value={draft.state} onChange={(v) => patch({ state: v })} />
          <Text label="Postal code" value={draft.postalCode} onChange={(v) => patch({ postalCode: v })} />
          <Text label="Country" value={draft.country} onChange={(v) => patch({ country: v })} />
        </div>
      </Group>

      <Group title="Links" hint="Asked for constantly, tedious to retype.">
        <div className="form-grid">
          <Text label="LinkedIn" type="url" value={draft.linkedinUrl} onChange={(v) => patch({ linkedinUrl: v })} />
          <Text label="GitHub" type="url" value={draft.githubUrl} onChange={(v) => patch({ githubUrl: v })} />
          <Text label="Portfolio" type="url" value={draft.portfolioUrl} onChange={(v) => patch({ portfolioUrl: v })} />
          <Text label="Other" type="url" value={draft.otherUrl} onChange={(v) => patch({ otherUrl: v })} />
        </div>
      </Group>

      <Group title="Current role">
        <div className="form-grid">
          <Text label="Job title" value={draft.currentTitle} onChange={(v) => patch({ currentTitle: v })} />
          <Text label="Company" value={draft.currentCompany} onChange={(v) => patch({ currentCompany: v })} />
        </div>
      </Group>

      <Group
        title="Work eligibility"
        hint="The questions that filter applications automatically, so worth getting right."
      >
        <YesNo
          label="Authorised to work without sponsorship"
          value={draft.authorizedToWork}
          onChange={(v) => patch({ authorizedToWork: v })}
        />
        <YesNo
          label="Requires visa sponsorship"
          value={draft.requiresSponsorship}
          onChange={(v) => patch({ requiresSponsorship: v })}
        />
        <YesNo
          label="Willing to relocate"
          value={draft.willingToRelocate}
          onChange={(v) => patch({ willingToRelocate: v })}
        />

        <fieldset className="ob-choice">
          <legend>Markets you apply in</legend>
          <p className="muted ob-legend-hint">
            Decides which market-specific questions autofill will answer. Anything not selected is
            skipped entirely.
          </p>
          <div className="ob-chips">
            {PROFILE_REGIONS.map((region) => {
              const on = (draft.regions ?? []).includes(region);
              return (
                <button
                  key={region}
                  type="button"
                  className="ob-chip"
                  data-selected={on}
                  onClick={() =>
                    patch({
                      regions: on
                        ? (draft.regions ?? []).filter((r) => r !== region)
                        : [...(draft.regions ?? []), region],
                    })
                  }
                >
                  {REGION_LABELS[region]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </Group>

      <Group title="Availability">
        <div className="form-grid">
          <NumberField
            label="Notice period (days)"
            value={draft.availability?.noticePeriodDays ?? null}
            onChange={(v) =>
              patch({ availability: { ...defaults(draft), noticePeriodDays: v } })
            }
          />
          <Text
            label="Earliest start date"
            type="date"
            value={draft.availability?.earliestStartDate}
            onChange={(v) => patch({ availability: { ...defaults(draft), earliestStartDate: v } })}
          />
          <Text
            label="Last working day"
            type="date"
            value={draft.availability?.lastWorkingDay}
            onChange={(v) => patch({ availability: { ...defaults(draft), lastWorkingDay: v } })}
          />
        </div>
      </Group>

      <Group
        title="Compensation"
        hint="Stored in whole units of the currency. Forms asking in lakhs get the converted figure."
      >
        <Money
          label="Current"
          value={draft.compensation?.current}
          onChange={(v) =>
            patch({
              compensation: {
                current: v,
                expected: draft.compensation?.expected ?? emptyMoney,
              },
            })
          }
        />
        <Money
          label="Expected"
          value={draft.compensation?.expected}
          onChange={(v) =>
            patch({
              compensation: {
                current: draft.compensation?.current ?? emptyMoney,
                expected: v,
              },
            })
          }
        />
      </Group>

      {(draft.experience?.length ?? 0) > 0 && (
        <Group title="Experience" hint="Parsed from your resume. Remove anything wrong.">
          <ul className="entry-list">
            {draft.experience?.map((role) => (
              <li key={role.id}>
                <div>
                  <strong>{role.title || 'Untitled role'}</strong>
                  <p className="muted">
                    {[role.company, role.startDate, role.current ? 'present' : role.endDate]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  className="btn-link"
                  onClick={() =>
                    patch({ experience: draft.experience?.filter((e) => e.id !== role.id) })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {(draft.savedAnswers?.length ?? 0) > 0 && (
        <Group title="Saved answers" hint="Reused when the same question comes up again.">
          <ul className="entry-list">
            {draft.savedAnswers?.map((answer) => (
              <li key={answer.id}>
                <div>
                  <strong>{answer.label}</strong>
                  <p className="muted">{answer.answer.slice(0, 140)}…</p>
                </div>
                <button
                  className="btn-link"
                  onClick={() =>
                    patch({ savedAnswers: draft.savedAnswers?.filter((a) => a.id !== answer.id) })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {error && <p className="banner-error">{error}</p>}

      {/* Sticky so the save button is reachable from anywhere on a long form. */}
      <div className="save-bar" data-active={dirty}>
        <span className="cell-dim">
          {saved && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}
        </span>
        <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const emptyMoney: MoneyAmount = { amountCents: null, currency: null, period: null };

function defaults(draft: ProfileInput) {
  return (
    draft.availability ?? {
      noticePeriodDays: null,
      servingNotice: null,
      lastWorkingDay: null,
      earliestStartDate: null,
    }
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel form-group">
      <div className="form-group-head">
        <h2>{title}</h2>
        {hint && <p className="muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Text({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  type?: string;
}) {
  return (
    <label className="ob-field">
      {label}
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="ob-field">
      {label}
      <input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  );
}

function YesNo({
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
    ['Not set', null],
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

/** Amount, currency and cadence together — a figure without all three is ambiguous. */
function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MoneyAmount | undefined;
  onChange: (v: MoneyAmount) => void;
}) {
  const money = value ?? emptyMoney;

  return (
    <fieldset className="ob-choice">
      <legend>{label}</legend>
      <div className="money-row">
        <input
          type="number"
          min={0}
          placeholder="Amount"
          aria-label={`${label} amount`}
          value={money.amountCents === null ? '' : money.amountCents / 100}
          onChange={(e) =>
            onChange({
              ...money,
              amountCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
            })
          }
        />
        <input
          type="text"
          placeholder="INR"
          aria-label={`${label} currency`}
          maxLength={8}
          value={money.currency ?? ''}
          onChange={(e) => onChange({ ...money, currency: e.target.value.toUpperCase() || null })}
        />
        <select
          aria-label={`${label} period`}
          value={money.period ?? ''}
          onChange={(e) => onChange({ ...money, period: (e.target.value || null) as PayPeriod | null })}
        >
          <option value="">per…</option>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
