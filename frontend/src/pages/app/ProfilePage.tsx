import { useEffect, useRef, useState } from 'react';
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
import { Resumes } from './Resumes.js';
import { ChipList, EducationSection, ExperienceSection } from './ProfileSections.js';
import { ReadinessRing, useScrollSpy } from './ProfileChrome.js';
import { ExtensionBanner } from '../../components/ExtensionBanner.js';
import {
  BuildingIcon,
  CalendarIcon,
  CapIcon,
  CloseIcon,
  CoinIcon,
  FileTextIcon,
  PencilIcon,
  GlobeIcon,
  GithubIcon,
  LinkIcon,
  LinkedInIcon,
  SparkIcon,
  UserIcon,
} from '../../components/icons.js';

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

/** Booleans read as words in a readout; "false" is not an answer people write. */
function yesNo(value: boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value ? 'Yes' : 'No';
}

/** Minor units back to something readable, currency first. */
function money(value: { amountCents: number | null; currency: string | null } | undefined): string | null {
  if (!value || value.amountCents === null) return null;
  const amount = (value.amountCents / 100).toLocaleString();
  return [value.currency, amount].filter(Boolean).join(' ');
}

type SectionId =
  | 'contact'
  | 'resumes'
  | 'links'
  | 'experience'
  | 'education'
  | 'skills'
  | 'eligibility'
  | 'availability'
  | 'compensation';

/**
 * Tones repeat after six, but never on adjacent sections — the colour is only
 * there to tell one panel from the next while scrolling.
 */
const SECTIONS: { id: SectionId; label: string; tone: string }[] = [
  { id: 'contact', label: 'Contact', tone: 'a' },
  { id: 'resumes', label: 'Resumes', tone: 'c' },
  { id: 'links', label: 'Links', tone: 'e' },
  { id: 'experience', label: 'Work experience', tone: 'b' },
  { id: 'education', label: 'Education', tone: 'f' },
  { id: 'skills', label: 'Skills', tone: 'a' },
  { id: 'eligibility', label: 'Work eligibility', tone: 'c' },
  { id: 'availability', label: 'Availability', tone: 'e' },
  { id: 'compensation', label: 'Compensation', tone: 'b' },
];

const SECTION_IDS = SECTIONS.map((s) => s.id);

export function ProfilePage() {
  usePageMeta('Profile', undefined, '/dashboard/profile');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<ProfileInput>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Above the loading early-return: hooks cannot be called conditionally.
  const activeSection = useScrollSpy(SECTION_IDS);

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

  /*
   * What the draft looked like when an edit dialog opened. Cancel restores it,
   * which is the only way a cancel button can mean anything — inputs write
   * straight into the draft as you type.
   */
  const snapshot = useRef<ProfileInput | null>(null);

  const beginEdit = () => {
    snapshot.current = draft;
  };

  const cancelEdit = () => {
    if (snapshot.current) setDraft(snapshot.current);
    snapshot.current = null;
  };

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
  const percent = Math.round((readiness.complete / readiness.total) * 100);
  const initials =
    [draft.firstName, draft.lastName]
      .filter(Boolean)
      .map((n) => n![0])
      .join('')
      .toUpperCase() || '?';

  /**
   * Whether each section has anything in it. Drives the ticks in the nav, so
   * the sidebar answers "what have I not done yet" without scrolling.
   */
  const filled: Record<SectionId, boolean> = {
    contact: Boolean(draft.firstName && draft.lastName && draft.email),
    resumes: true,
    links: Boolean(draft.linkedinUrl || draft.githubUrl || draft.portfolioUrl),
    experience: (draft.experience?.length ?? 0) > 0,
    education: (draft.education?.length ?? 0) > 0,
    skills: (draft.skills?.length ?? 0) > 0,
    eligibility: draft.authorizedToWork != null || (draft.workAuthCountries?.length ?? 0) > 0,
    availability: draft.availability?.noticePeriodDays != null,
    compensation: draft.compensation?.expected?.amountCents != null,
  };

  const dirty = profile ? JSON.stringify(draft) !== JSON.stringify(profile) : false;

  return (
    <div className="dash">
      {/*
        The visible title is gone, but the page still needs one heading for
        document structure — without an h1 a screen reader has nothing to
        announce the page as, and heading-level navigation skips straight into
        the section titles from nowhere.
      */}
      <h1 className="sr-only">Your profile</h1>

      <div className="profile-layout">
        <aside className="profile-aside">
          <div className="panel identity">
            <div className="identity-ring">
              <ReadinessRing percent={percent} />
              <span className="identity-avatar">{initials}</span>
            </div>

            <strong>
              {[draft.firstName, draft.lastName].filter(Boolean).join(' ') || 'Your name'}
            </strong>
            {draft.currentTitle && (
              <p className="muted">
                {draft.currentTitle}
                {draft.currentCompany ? ` @ ${draft.currentCompany}` : ''}
              </p>
            )}

            <div className="strength">
              <div className="strength-head">
                <span>Autofill readiness</span>
                <strong>{percent}%</strong>
              </div>
              {readiness.missing.length > 0 ? (
                <p className="muted">Still blank: {readiness.missing.join(', ')}.</p>
              ) : (
                <p className="muted">Everything autofill needs is set.</p>
              )}
            </div>
          </div>

          <nav className="profile-nav" aria-label="Profile sections">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                data-active={activeSection === section.id}
                aria-current={activeSection === section.id ? 'true' : undefined}
              >
                <span className="nav-dot" data-filled={filled[section.id]} aria-hidden="true" />
                {section.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="profile-main">
          {/* In the content column rather than spanning the page: it belongs
              with the form it is asking you to make useful, and full width
              above everything read as a site-wide announcement. */}
          <ExtensionBanner />


      <EditSection
        id="contact"
        title="Contact"
        icon={<UserIcon />}
        tone="a"
        hint="Goes into the contact fields on every application."
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          ['Name', [draft.firstName, draft.lastName].filter(Boolean).join(' ')],
          ['Preferred name', draft.preferredName],
          ['Email', draft.email],
          ['Phone', draft.phone],
          ['Address', [draft.addressLine1, draft.city, draft.state, draft.postalCode, draft.country].filter(Boolean).join(', ')],
        ]}
      >
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
      </EditSection>

      <div id="resumes">
        <Resumes />
      </div>

      <EditSection
        id="links"
        title="Portfolio & links"
        icon={<LinkIcon />}
        tone="e"
        hint="Asked for constantly, tedious to retype."
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          ['LinkedIn', draft.linkedinUrl],
          ['GitHub', draft.githubUrl],
          ['Portfolio', draft.portfolioUrl],
          ['Other', draft.otherUrl],
        ]}
      >
        <div className="link-grid">
          <LinkCard
            brand="linkedin"
            label="LinkedIn"
            icon={<LinkedInIcon />}
            placeholder="linkedin.com/in/you"
            value={draft.linkedinUrl}
            onChange={(v) => patch({ linkedinUrl: v })}
          />
          <LinkCard
            brand="github"
            label="GitHub"
            icon={<GithubIcon />}
            placeholder="github.com/you"
            value={draft.githubUrl}
            onChange={(v) => patch({ githubUrl: v })}
          />
          <LinkCard
            brand="site"
            label="Portfolio"
            icon={<GlobeIcon />}
            placeholder="yoursite.com"
            value={draft.portfolioUrl}
            onChange={(v) => patch({ portfolioUrl: v })}
          />
          <LinkCard
            brand="other"
            label="Other"
            icon={<LinkIcon />}
            value={draft.otherUrl}
            onChange={(v) => patch({ otherUrl: v })}
          />
        </div>
      </EditSection>

      <EditSection
        title="Current role"
        icon={<BuildingIcon />}
        tone="b"
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          ['Title', draft.currentTitle],
          ['Company', draft.currentCompany],
        ]}
      >
        <div className="form-grid">
          <Text label="Job title" value={draft.currentTitle} onChange={(v) => patch({ currentTitle: v })} />
          <Text label="Company" value={draft.currentCompany} onChange={(v) => patch({ currentCompany: v })} />
        </div>
      </EditSection>

      <EditSection
        id="eligibility"
        icon={<GlobeIcon />}
        tone="c"
        title="Work eligibility"
        hint="The questions that filter applications automatically, so worth getting right."
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          ['Authorised to work', yesNo(draft.authorizedToWork)],
          ['Needs sponsorship', yesNo(draft.requiresSponsorship)],
          ['Will relocate', yesNo(draft.willingToRelocate)],
        ]}
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
      </EditSection>

      <EditSection
        id="availability"
        title="Availability"
        icon={<CalendarIcon />}
        tone="e"
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          [
            'Notice period',
            draft.availability?.noticePeriodDays != null
              ? `${draft.availability.noticePeriodDays} days`
              : null,
          ],
          ['Earliest start', draft.availability?.earliestStartDate],
        ]}
      >
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
      </EditSection>

      <EditSection
        id="compensation"
        icon={<CoinIcon />}
        tone="b"
        title="Compensation"
        hint="Stored in whole units of the currency. Forms asking in lakhs get the converted figure."
        saving={saving}
        onCancel={cancelEdit}
        onSave={save}
        values={[
          ['Current', money(draft.compensation?.current)],
          ['Expected', money(draft.compensation?.expected)],
        ]}
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
      </EditSection>

      <div id="experience">
        <ExperienceSection
          icon={<BuildingIcon />}
          tone="b"
          entries={draft.experience ?? []}
          onChange={(next) => patch({ experience: next })}
        />
      </div>

      <div id="education">
        <EducationSection
          icon={<CapIcon />}
          tone="f"
          entries={draft.education ?? []}
          onChange={(next) => patch({ education: next })}
        />
      </div>

      <div id="skills">
        <ChipList
          label="Skills"
          icon={<SparkIcon />}
          tone="a"
          hint="Asked for directly on many forms, and searched by recruiters."
          placeholder="Type a skill and press Enter"
          values={draft.skills ?? []}
          onChange={(next) => patch({ skills: next })}
        />
        <ChipList
          label="Languages"
          icon={<GlobeIcon />}
          tone="f"
          placeholder="Type a language and press Enter"
          values={draft.languages ?? []}
          onChange={(next) => patch({ languages: next })}
        />
      </div>

      {(draft.savedAnswers?.length ?? 0) > 0 && (
        <section className="panel form-group">
          <div className="form-group-head">
            <div className="group-title">
              <span className="tile-icon tile-icon-sm" data-tone="f">
                <FileTextIcon />
              </span>
              <h2>Saved answers</h2>
            </div>
            <p className="muted">Reused when the same question comes up again.</p>
          </div>
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
        </section>
      )}

        </div>
      </div>

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

/**
 * A profile section: values on the page, inputs in a modal.
 *
 * A profile is read far more often than it is edited — you come here to check
 * what autofill will send, and occasionally to correct one thing. Showing
 * every field as a live input makes the common case look like unfinished work
 * and buries the actual content in chrome.
 *
 * So the panel renders what you have, and the pencil opens the same inputs in
 * a dialog. Cancel restores the snapshot taken when it opened, which is the
 * behaviour a cancel button has to have — without it, "cancel" would leave
 * every keystroke already applied to the draft.
 */
function EditSection({
  id,
  title,
  hint,
  icon,
  tone,
  values,
  onCancel,
  onSave,
  saving,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: string;
  /** Label/value pairs shown when the section is not being edited. */
  values: [string, string | null | undefined][];
  onCancel: () => void;
  onSave: () => Promise<void> | void;
  saving: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const close = () => {
    onCancel();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const filled = values.filter(([, value]) => value);

  return (
    <section className="panel form-group" id={id}>
      <div className="form-group-head section-head-row">
        <div className="group-title-block">
          <div className="group-title">
            {icon && (
              <span className="tile-icon tile-icon-sm" data-tone={tone}>
                {icon}
              </span>
            )}
            <h2>{title}</h2>
          </div>
          {hint && <p className="muted">{hint}</p>}
        </div>

        <button
          className="icon-action"
          onClick={() => setOpen(true)}
          aria-label={`Edit ${title.toLowerCase()}`}
          title="Edit"
        >
          <PencilIcon />
        </button>
      </div>

      {filled.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <dl className="field-readout">
          {filled.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {open && (
        <div className="modal-backdrop" onClick={close} role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal edit-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <strong>{title}</strong>
              <button className="icon-action" onClick={close} aria-label="Close" title="Close">
                <CloseIcon />
              </button>
            </header>

            <div className="modal-body">{children}</div>

            <footer className="modal-foot">
              <button className="btn btn-ghost" onClick={close}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => {
                  void Promise.resolve(onSave()).then(() => setOpen(false));
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

function LinkCard({
  brand,
  label,
  icon,
  placeholder,
  value,
  onChange,
}: {
  brand: 'linkedin' | 'github' | 'site' | 'other';
  label: string;
  icon: React.ReactNode;
  placeholder?: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="link-card" data-brand={brand}>
      <span className="link-tile">{icon}</span>
      <span className="link-body">
        <span className="link-label">{label}</span>
        <input
          type="url"
          value={value ?? ''}
          placeholder={placeholder ?? 'Not added'}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </span>
    </label>
  );
}

function Text({
  label,
  value,
  onChange,
  type = 'text',
  icon,
  brand,
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  type?: string;
  /** Sits inside the input. Used for the link fields, where the mark
      identifies the field faster than its label does. */
  icon?: React.ReactNode;
  /** Paints the mark in that service's own colour. */
  brand?: 'linkedin' | 'github' | 'site';
  placeholder?: string;
}) {
  return (
    <label className="ob-field">
      {label}
      {icon ? (
        <span className="input-icon" data-brand={brand}>
          {icon}
          <input
            type={type}
            value={value ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </span>
      ) : (
        <input
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )}
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
