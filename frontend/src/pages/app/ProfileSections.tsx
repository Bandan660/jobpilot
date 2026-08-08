import { useState } from 'react';
import { BuildingIcon, CapIcon, PencilIcon, PlusIcon, TrashIcon } from '../../components/icons.js';
import {
  EDUCATION_LEVELS,
  type Education,
  type EducationLevel,
  type WorkExperience,
} from '@jobpilot/shared';

/**
 * Repeating profile sections: experience, education, and chip lists.
 *
 * Kept out of ProfilePage so that file stays a layout rather than a thousand
 * lines of form.
 */

/**
 * Edit and remove, as icons.
 *
 * Icon-only, so they stay quiet next to the entry itself — but each carries a
 * real label and a title, because an unlabelled glyph is unusable with a
 * screen reader and ambiguous with a mouse. Remove is tinted only on hover:
 * permanently red draws the eye to the one action nobody wants to take by
 * accident.
 */
function EntryActions({ onEdit, onRemove, what }: { onEdit: () => void; onRemove: () => void; what: string }) {
  return (
    <div className="entry-actions">
      <button className="icon-action" onClick={onEdit} aria-label={`Edit ${what}`} title="Edit">
        <PencilIcon />
      </button>
      <button
        className="icon-action danger"
        onClick={onRemove}
        aria-label={`Remove ${what}`}
        title="Remove"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

/** Company or school initial, so a long list is scannable down the left edge. */
function EntryMark({ label, fallback }: { label: string; fallback: React.ReactNode }) {
  const initial = label.trim()[0]?.toUpperCase();
  return <span className="entry-mark">{initial || fallback}</span>;
}

const LEVEL_LABELS: Record<EducationLevel, string> = {
  SECONDARY: 'Secondary / 10th',
  HIGHER_SECONDARY: 'Higher secondary / 12th',
  DIPLOMA: 'Diploma',
  BACHELORS: "Bachelor's",
  MASTERS: "Master's",
  DOCTORATE: 'Doctorate',
  CERTIFICATION: 'Certification',
};

/* -------------------------------------------------------------------------- */
/* Chips                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Free-text list. Enter or comma commits an entry, backspace on an empty input
 * removes the last one — the conventions people already expect from a tag box.
 */
export function ChipList({
  label,
  hint,
  placeholder,
  icon,
  tone,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  icon?: React.ReactNode;
  tone?: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    // Splitting on comma lets someone paste a list in one go.
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const next = [...values];
    for (const part of parts) {
      if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    onChange(next);
    setDraft('');
  }

  return (
    <section className="panel form-group">
      <div className="form-group-head">
        <div className="group-title">
          {icon && (
            <span className="tile-icon tile-icon-sm" data-tone={tone}>
              {icon}
            </span>
          )}
          <h2>{label}</h2>
        </div>
        {hint && <p className="muted">{hint}</p>}
      </div>

      {values.length > 0 && (
        <div className="chip-set">
          {values.map((value) => (
            <span className="chip" key={value}>
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                aria-label={`Remove ${value}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (draft.trim()) commit(draft);
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Experience                                                                 */
/* -------------------------------------------------------------------------- */

export function ExperienceSection({
  entries,
  onChange,
  icon,
  tone,
}: {
  entries: WorkExperience[];
  onChange: (next: WorkExperience[]) => void;
  icon?: React.ReactNode;
  tone?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  function update(id: string, patch: Partial<WorkExperience>) {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function add() {
    const entry: WorkExperience = {
      id: crypto.randomUUID(),
      company: '',
      title: '',
      startDate: null,
      endDate: null,
      current: false,
      location: null,
      description: null,
    };
    onChange([entry, ...entries]);
    setEditing(entry.id);
  }

  return (
    <section className="panel form-group">
      <div className="form-group-head section-head-row">
        <div className="group-title-block">
          <div className="group-title">
            {icon && (
              <span className="tile-icon tile-icon-sm" data-tone={tone}>
                {icon}
              </span>
            )}
            <h2>Work experience</h2>
          </div>
        </div>
        <button className="icon-action add" onClick={add} aria-label="Add a role" title="Add a role">
          <PlusIcon />
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id} className="entry-block">
              {editing === entry.id ? (
                <div className="entry-edit">
                  <div className="form-grid">
                    <label className="ob-field">
                      Job title
                      <input
                        value={entry.title}
                        onChange={(e) => update(entry.id, { title: e.target.value })}
                      />
                    </label>
                    <label className="ob-field">
                      Company
                      <input
                        value={entry.company}
                        onChange={(e) => update(entry.id, { company: e.target.value })}
                      />
                    </label>
                    <label className="ob-field">
                      Location
                      <input
                        value={entry.location ?? ''}
                        onChange={(e) => update(entry.id, { location: e.target.value || null })}
                      />
                    </label>
                    <label className="ob-field">
                      Start
                      {/* Month precision: no application form has ever asked
                          which day a job started. */}
                      <input
                        type="month"
                        value={entry.startDate ?? ''}
                        onChange={(e) => update(entry.id, { startDate: e.target.value || null })}
                      />
                    </label>
                    <label className="ob-field" data-disabled={entry.current}>
                      End
                      <input
                        type="month"
                        value={entry.current ? '' : (entry.endDate ?? '')}
                        disabled={entry.current}
                        onChange={(e) => update(entry.id, { endDate: e.target.value || null })}
                      />
                    </label>
                  </div>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={entry.current}
                      onChange={(e) =>
                        update(entry.id, {
                          current: e.target.checked,
                          endDate: e.target.checked ? null : entry.endDate,
                        })
                      }
                    />
                    <span>I currently work here</span>
                  </label>

                  <label className="ob-field">
                    What you did
                    <textarea
                      rows={4}
                      value={entry.description ?? ''}
                      onChange={(e) => update(entry.id, { description: e.target.value || null })}
                    />
                  </label>

                  <div className="entry-actions">
                    <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <EntryMark label={entry.company} fallback={<BuildingIcon />} />
                  <div className="entry-body">
                    <strong>{entry.title || 'Untitled role'}</strong>
                    <p className="muted">{entry.company || 'No company'}</p>
                    <div className="entry-chips">
                      {entry.location && <span className="chip chip-static">{entry.location}</span>}
                      {entry.startDate && (
                        <span className="chip chip-static">
                          {entry.startDate} – {entry.current ? 'present' : (entry.endDate ?? '?')}
                        </span>
                      )}
                    </div>
                    {entry.description && <p className="entry-desc">{entry.description}</p>}
                  </div>

                  <EntryActions
                    what={entry.title || 'this role'}
                    onEdit={() => setEditing(entry.id)}
                    onRemove={() => onChange(entries.filter((e) => e.id !== entry.id))}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Education                                                                  */
/* -------------------------------------------------------------------------- */

export function EducationSection({
  entries,
  onChange,
  icon,
  tone,
}: {
  entries: Education[];
  onChange: (next: Education[]) => void;
  icon?: React.ReactNode;
  tone?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  function update(id: string, patch: Partial<Education>) {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function add() {
    const entry: Education = {
      id: crypto.randomUUID(),
      school: '',
      level: 'BACHELORS',
      degree: null,
      field: null,
      startDate: null,
      endDate: null,
      score: null,
      scoreType: 'PERCENTAGE',
    };
    onChange([entry, ...entries]);
    setEditing(entry.id);
  }

  return (
    <section className="panel form-group">
      <div className="form-group-head section-head-row">
        <div className="group-title-block">
          <div className="group-title">
            {icon && (
              <span className="tile-icon tile-icon-sm" data-tone={tone}>
                {icon}
              </span>
            )}
            <h2>Education</h2>
          </div>
          <p className="muted">
            Add school results too — some markets ask for them on every application.
          </p>
        </div>
        <button
          className="icon-action add"
          onClick={add}
          aria-label="Add education"
          title="Add education"
        >
          <PlusIcon />
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted">Nothing added yet.</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.id} className="entry-block">
              {editing === entry.id ? (
                <div className="entry-edit">
                  <div className="form-grid">
                    <label className="ob-field">
                      School or university
                      <input
                        value={entry.school}
                        onChange={(e) => update(entry.id, { school: e.target.value })}
                      />
                    </label>
                    <label className="ob-field">
                      Level
                      <select
                        value={entry.level ?? ''}
                        onChange={(e) =>
                          update(entry.id, { level: (e.target.value || null) as EducationLevel })
                        }
                      >
                        <option value="">Not specified</option>
                        {EDUCATION_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {LEVEL_LABELS[level]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="ob-field">
                      Degree
                      <input
                        value={entry.degree ?? ''}
                        onChange={(e) => update(entry.id, { degree: e.target.value || null })}
                      />
                    </label>
                    <label className="ob-field">
                      Field of study
                      <input
                        value={entry.field ?? ''}
                        onChange={(e) => update(entry.id, { field: e.target.value || null })}
                      />
                    </label>
                    <label className="ob-field">
                      Finished
                      <input
                        type="month"
                        value={entry.endDate ?? ''}
                        onChange={(e) => update(entry.id, { endDate: e.target.value || null })}
                      />
                    </label>
                    <label className="ob-field">
                      Score
                      {/* Value and grading system together: "71" means nothing
                          without knowing whether it is a percentage or a CGPA. */}
                      <div className="score-row">
                        <input
                          value={entry.score ?? ''}
                          onChange={(e) => update(entry.id, { score: e.target.value || null })}
                        />
                        <select
                          value={entry.scoreType ?? ''}
                          onChange={(e) =>
                            update(entry.id, {
                              scoreType: (e.target.value || null) as Education['scoreType'],
                            })
                          }
                        >
                          <option value="PERCENTAGE">%</option>
                          <option value="CGPA">CGPA</option>
                          <option value="GPA">GPA</option>
                          <option value="GRADE">Grade</option>
                        </select>
                      </div>
                    </label>
                  </div>

                  <div className="entry-actions">
                    <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <EntryMark label={entry.school} fallback={<CapIcon />} />
                  <div className="entry-body">
                    <strong>{entry.school || 'Unnamed school'}</strong>
                    <div className="entry-chips">
                      {entry.level && <span className="chip chip-static">{LEVEL_LABELS[entry.level]}</span>}
                      {entry.field && <span className="chip chip-static">{entry.field}</span>}
                      {entry.endDate && <span className="chip chip-static">{entry.endDate}</span>}
                      {entry.score && (
                        <span className="chip chip-static">
                          {entry.score}
                          {entry.scoreType === 'PERCENTAGE' ? '%' : ` ${entry.scoreType}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <EntryActions
                    what={entry.school || 'this entry'}
                    onEdit={() => setEditing(entry.id)}
                    onRemove={() => onChange(entries.filter((e) => e.id !== entry.id))}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
