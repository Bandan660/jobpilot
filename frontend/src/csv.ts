import type { Application } from '@jobpilot/shared';

/**
 * CSV import and export.
 *
 * Hand-rolled rather than a dependency: this is one quoting rule in each
 * direction, and the file people actually arrive with is a spreadsheet export
 * with inconsistent headers — which no parser library solves for you anyway.
 */

const EXPORT_COLUMNS = [
  'Role',
  'Company',
  'Status',
  'Applied',
  'Location',
  'Posting',
  'URL',
  'Source',
  'Archived',
] as const;

function escape(value: string): string {
  // Quote only when needed, and double any embedded quote.
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(applications: Application[]): string {
  const rows = applications.map((a) =>
    [
      a.title,
      a.company.name,
      a.status.toLowerCase(),
      a.appliedAt ? a.appliedAt.slice(0, 10) : '',
      a.location ?? '',
      a.postingStatus.toLowerCase(),
      a.jobUrl ?? '',
      a.source.toLowerCase(),
      a.archived ? 'yes' : 'no',
    ]
      .map((v) => escape(String(v)))
      .join(',')
  );

  // BOM so Excel opens UTF-8 correctly instead of mangling accented names.
  return `﻿${EXPORT_COLUMNS.join(',')}\n${rows.join('\n')}\n`;
}

export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

/** Splits one CSV line, honouring quotes and doubled quotes inside them. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      out.push(field.trim());
      field = '';
    } else field += char;
  }

  out.push(field.trim());
  return out;
}

export interface ImportRow {
  title: string;
  company: string;
  status?: string;
  appliedAt?: string | null;
  jobUrl?: string | null;
  location?: string | null;
}

/**
 * Header aliases.
 *
 * People import a spreadsheet they already keep, not a file in our format, so
 * the column names are whatever they chose. Matching loosely here is the
 * difference between an importer that works and one that always says
 * "unrecognised file".
 */
const ALIASES: Record<keyof ImportRow, string[]> = {
  title: ['role', 'title', 'job title', 'position', 'job'],
  company: ['company', 'employer', 'organisation', 'organization'],
  status: ['status', 'stage'],
  appliedAt: ['applied', 'applied at', 'applied on', 'date applied', 'date', 'application date'],
  jobUrl: ['url', 'link', 'posting', 'job url', 'job link'],
  location: ['location', 'city', 'place'],
};

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface ParsedCsv {
  rows: ImportRow[];
  /** Headers that matched nothing, so the UI can say what was ignored. */
  ignored: string[];
  missing: string[];
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');

  if (lines.length < 2) return { rows: [], ignored: [], missing: ['Role', 'Company'] };

  const headers = splitLine(lines[0]).map(normaliseHeader);
  const index: Partial<Record<keyof ImportRow, number>> = {};
  const matched = new Set<number>();

  for (const [field, aliases] of Object.entries(ALIASES) as [keyof ImportRow, string[]][]) {
    const at = headers.findIndex((h) => aliases.includes(h));
    if (at >= 0) {
      index[field] = at;
      matched.add(at);
    }
  }

  const missing: string[] = [];
  if (index.title === undefined) missing.push('Role');
  if (index.company === undefined) missing.push('Company');
  if (missing.length > 0) {
    return { rows: [], ignored: [], missing };
  }

  const ignored = headers.filter((h, i) => !matched.has(i) && h !== '');

  const rows: ImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const pick = (field: keyof ImportRow) => {
      const at = index[field];
      return at === undefined ? '' : (cells[at] ?? '');
    };

    const title = pick('title');
    const company = pick('company');
    if (!title || !company) continue;

    const status = pick('status').toUpperCase().replace(/\s+/g, '_');

    rows.push({
      title: title.slice(0, 300),
      company: company.slice(0, 200),
      status: status || undefined,
      appliedAt: pick('appliedAt') || null,
      jobUrl: pick('jobUrl') || null,
      location: pick('location') || null,
    });
  }

  return { rows, ignored, missing: [] };
}
