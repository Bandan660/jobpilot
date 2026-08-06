import type { Education, ProfileInput, WorkExperience } from '@jobpilot/shared';

/**
 * Resume parsing, entirely in the browser.
 *
 * Two reasons it does not happen on the server:
 *
 * - The Worker free tier caps CPU at 10ms per request. PDF text extraction is
 *   nowhere near that.
 * - The file never has to leave the device. Only the fields the user reviews
 *   and confirms are sent, which is a materially smaller thing to ask for than
 *   "upload your resume to us".
 *
 * Extraction is heuristic and openly imperfect. Everything it produces is shown
 * for confirmation before it is saved — the point is to save typing, not to be
 * right unsupervised.
 */

export interface ParsedResume {
  fields: ProfileInput;
  /** Fields the parser is confident about, for highlighting in the review step. */
  found: string[];
  rawText: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** pdfjs ships a worker; loading it lazily keeps ~1MB out of the main bundle. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
    );
  }

  return pages.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Field extraction                                                           */
/* -------------------------------------------------------------------------- */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// Deliberately loose: international formats vary far too much to validate here,
// and the user confirms the value anyway.
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{2,4}/;
const LINKEDIN = /(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w-]+/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i;

/** Any http(s) URL that is not one of the profiles we already recognise. */
const URL_ANY = /(?:https?:\/\/)[\w.-]+\.[a-z]{2,}(?:\/[\w./#?=&-]*)?/gi;

function firstMatch(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m ? m[0].trim() : null;
}

function normaliseUrl(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('http') ? value : `https://${value}`;
}

/**
 * The name is the hardest field and the least safe to guess, so this is
 * conservative: the first line of the document, only if it looks like a name
 * and is not an email, phone, or heading.
 */
function guessName(text: string): { firstName: string | null; lastName: string | null } {
  const firstLines = text.split('\n').slice(0, 4);

  for (const line of firstLines) {
    const candidate = line.trim();
    if (!candidate || candidate.length > 60) continue;
    if (EMAIL.test(candidate) || /\d/.test(candidate)) continue;
    if (/resume|curriculum|vitae|profile/i.test(candidate)) continue;

    const words = candidate.split(/\s+/).filter((w) => /^[A-Za-z'.-]+$/.test(w));
    if (words.length < 2 || words.length > 4) continue;

    return { firstName: words[0], lastName: words[words.length - 1] };
  }

  return { firstName: null, lastName: null };
}

/**
 * Section splitting, used to keep experience and education apart. Resumes vary
 * enormously; when a heading is not found the section is simply skipped rather
 * than guessed at.
 */
function section(text: string, headings: RegExp): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => headings.test(line.trim()));
  if (start === -1) return null;

  const OTHER = /^(experience|employment|work|education|skills|projects|certifications|awards|interests|languages)\b/i;
  const rest: string[] = [];

  for (let i = start + 1; i < lines.length; i++) {
    if (OTHER.test(lines[i].trim())) break;
    rest.push(lines[i]);
  }

  return rest.join('\n').trim() || null;
}

const MONTHS =
  '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const DATE_RANGE = new RegExp(
  `(${MONTHS}\\.?\\s*)?(\\d{4})\\s*[-–—to]+\\s*((${MONTHS}\\.?\\s*)?(\\d{4})|present|current)`,
  'i'
);

function toIsoMonth(month: string | undefined, year: string): string {
  const index = month
    ? Math.max(0, ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
        .indexOf(month.slice(0, 3).toLowerCase()))
    : 0;
  return `${year}-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Experience entries are recognised by a date range on or near a line. Titles
 * and companies are taken from the same line, which is right often enough to
 * save typing and wrong often enough that the review step matters.
 */
function extractExperience(text: string): WorkExperience[] {
  const body = section(text, /^(work\s+)?(experience|employment history|professional experience)\b/i);
  if (!body) return [];

  const entries: WorkExperience[] = [];

  for (const line of body.split('\n')) {
    const match = line.match(DATE_RANGE);
    if (!match) continue;

    const label = line.replace(DATE_RANGE, '').replace(/[|•·,]+\s*$/, '').trim();
    if (!label) continue;

    // "Senior Engineer at Acme" / "Senior Engineer, Acme" / "Acme — Senior Engineer"
    const parts = label.split(/\s+(?:at|@|[|•·—–-])\s+|,\s+/).filter(Boolean);
    const current = /present|current/i.test(match[3] ?? '');

    entries.push({
      id: crypto.randomUUID(),
      title: parts[0]?.slice(0, 200) ?? label.slice(0, 200),
      company: parts[1]?.slice(0, 200) ?? '',
      startDate: match[2] ? toIsoMonth(match[1], match[2]) : null,
      endDate: current || !match[5] ? null : toIsoMonth(match[4], match[5]),
      current,
      location: null,
      description: null,
    });

    if (entries.length >= 12) break;
  }

  return entries;
}

function extractEducation(text: string): Education[] {
  const body = section(text, /^education\b/i);
  if (!body) return [];

  const entries: Education[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const year = trimmed.match(/\b(19|20)\d{2}\b/g);
    const looksLikeSchool = /university|college|institute|school|academy|polytechnic|iit|nit/i.test(trimmed);
    if (!looksLikeSchool && !year) continue;

    const level = /ph\.?d|doctor/i.test(trimmed)
      ? 'DOCTORATE'
      : /master|m\.?sc|m\.?tech|mba|m\.?s\b/i.test(trimmed)
        ? 'MASTERS'
        : /bachelor|b\.?sc|b\.?tech|b\.?e\b|b\.?a\b/i.test(trimmed)
          ? 'BACHELORS'
          : /diploma/i.test(trimmed)
            ? 'DIPLOMA'
            : null;

    entries.push({
      id: crypto.randomUUID(),
      school: trimmed.slice(0, 200),
      level,
      degree: null,
      field: null,
      startDate: null,
      endDate: year ? `${year[year.length - 1]}-06` : null,
      score: null,
      scoreType: null,
    });

    if (entries.length >= 6) break;
  }

  return entries;
}

export function extractFields(text: string): ParsedResume {
  const email = firstMatch(text, EMAIL);
  const phone = firstMatch(text, PHONE);
  const linkedinUrl = normaliseUrl(firstMatch(text, LINKEDIN));
  const githubUrl = normaliseUrl(firstMatch(text, GITHUB));
  const { firstName, lastName } = guessName(text);

  const otherUrls = (text.match(URL_ANY) ?? []).filter(
    (u) => !/linkedin\.com|github\.com/i.test(u)
  );

  const experience = extractExperience(text);
  const education = extractEducation(text);

  const fields: ProfileInput = {
    firstName,
    lastName,
    email,
    phone,
    linkedinUrl,
    githubUrl,
    portfolioUrl: otherUrls[0] ?? null,
    currentCompany: experience.find((e) => e.current)?.company || null,
    currentTitle: experience.find((e) => e.current)?.title || null,
    experience,
    education,
  };

  const found = Object.entries(fields)
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
    .map(([k]) => k);

  return { fields, found, rawText: text };
}

/* -------------------------------------------------------------------------- */

export class ResumeError extends Error {}

export async function parseResume(file: File): Promise<ParsedResume> {
  if (file.size > MAX_BYTES) {
    throw new ResumeError('That file is larger than 10MB. Try exporting a smaller PDF.');
  }

  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    const text = await extractPdfText(file);
    if (text.trim().length < 40) {
      throw new ResumeError(
        'No text found in that PDF — it may be a scan or an image. Paste your details instead, or upload a text-based PDF.'
      );
    }
    return extractFields(text);
  }

  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return extractFields(await file.text());
  }

  // Word documents need a separate parser; saying so beats failing vaguely.
  throw new ResumeError(
    name.endsWith('.docx') || name.endsWith('.doc')
      ? 'Word documents are not supported yet. Export the resume as a PDF and try again.'
      : 'Upload a PDF, or a plain text file.'
  );
}
