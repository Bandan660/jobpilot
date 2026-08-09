/**
 * Attaching the stored resume to an application form.
 *
 * The one thing autofill structurally could not do. Every other field is a
 * string written into a control; a file input holds a `FileList`, which is
 * read-only and cannot be constructed — the only supported way to populate one
 * is to hand it a `DataTransfer`, which is what the browser itself does on a
 * drag-and-drop. That is the whole trick here.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not replace a file the user has already attached. Overwriting the
 * tailored resume someone just picked with the generic one on file is the kind
 * of silent wrong answer the rest of this codebase exists to avoid, and unlike
 * a wrong text value there is no visible trace of what it replaced.
 *
 * It will not touch an input it cannot identify as a resume field. Application
 * forms carry file inputs for cover letters, portfolios, transcripts and
 * right-to-work documents, and a resume in the transcript slot is worse than
 * an empty one.
 */

export interface StoredResume {
  fileName: string;
  contentType: string;
  /** base64 — `chrome.runtime` messaging is JSON, so bytes cannot cross it. */
  data: string;
}

export type AttachOutcome =
  | { status: 'attached'; fileName: string; label: string }
  | { status: 'already-attached'; label: string }
  | { status: 'no-field' }
  | { status: 'failed'; reason: string };

/**
 * Words that identify the resume input, and words that rule one out.
 *
 * Checked against the input's own attributes and its visible label. The
 * exclusions matter more than the inclusions: "upload your cover letter"
 * contains none of the resume words, but "attach resume or cover letter" is a
 * real label on some forms and the negative list is what stops a portfolio
 * field two rows down from winning on a loose match.
 */
const RESUME_WORDS = /\b(resume|résumé|resumé|cv|curriculum\s*vitae)\b/i;
const NOT_RESUME_WORDS =
  /\b(cover\s*letter|portfolio|transcript|certificate|photo|photograph|passport|visa|id\s*proof|payslip|reference\s*letter|writing\s*sample)\b/i;

function describe(input: HTMLInputElement): string {
  const label =
    input.labels?.[0]?.textContent ??
    input.closest('label')?.textContent ??
    input
      .closest('[data-test-form-element], [data-automation-id], .field, .form-group, fieldset')
      ?.querySelector('label, legend')?.textContent ??
    '';

  return [
    label,
    input.getAttribute('name') ?? '',
    input.getAttribute('id') ?? '',
    input.getAttribute('aria-label') ?? '',
    input.getAttribute('placeholder') ?? '',
    input.getAttribute('data-qa') ?? '',
    input.getAttribute('data-ui') ?? '',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Visible, or hidden behind a styled drop zone.
 *
 * A zero-size file input is the normal way to build a custom upload control —
 * the real input is hidden and a styled button triggers it — so the visibility
 * test that guards everything else in this codebase would reject exactly the
 * forms most likely to have one. Presence in the layout is the test instead.
 */
function reachable(input: HTMLInputElement): boolean {
  if (input.disabled) return false;
  return input.isConnected && Boolean(input.offsetParent ?? input.getClientRects().length);
}

export function findResumeInput(scope: ParentNode = document): HTMLInputElement | null {
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input[type="file"]')].filter(
    (input) => reachable(input) || input.closest('form') !== null
  );

  if (inputs.length === 0) return null;

  const described = inputs.map((input) => ({ input, text: describe(input) }));

  const named = described.find(
    ({ text }) => RESUME_WORDS.test(text) && !NOT_RESUME_WORDS.test(text)
  );
  if (named) return named.input;

  /*
   * Exactly one file input on the form and nothing marking it as something
   * else: on an application form that is the resume. With more than one, an
   * unlabelled guess is not worth making — the user attaches it themselves and
   * knows which slot they used.
   */
  const unclaimed = described.filter(({ text }) => !NOT_RESUME_WORDS.test(text));
  return unclaimed.length === 1 ? unclaimed[0].input : null;
}

function toBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

/**
 * Put the file in the input the way a drop would.
 *
 * `input.files` has no setter of its own, but assigning a `DataTransfer`'s
 * `files` is the supported path and is what the drag-and-drop API produces.
 * The events after it are the same pair the text fields dispatch, for the same
 * reason: React is listening for those, not for the assignment.
 */
export function attachResume(
  resume: StoredResume,
  options: { scope?: ParentNode; overwrite?: boolean } = {}
): AttachOutcome {
  const { scope = document, overwrite = false } = options;

  const input = findResumeInput(scope);
  if (!input) return { status: 'no-field' };

  const label = describe(input).slice(0, 80) || 'the resume field';

  if (!overwrite && (input.files?.length ?? 0) > 0) {
    return { status: 'already-attached', label };
  }

  try {
    const file = new File([toBytes(resume.data)], resume.fileName, {
      type: resume.contentType,
      lastModified: Date.now(),
    });

    /*
     * Some forms constrain `accept`. Attaching a PDF to an input that only
     * takes .doc would be rejected by the page on submit, silently, after the
     * user believed it was done.
     */
    if (!accepts(input, file)) {
      return {
        status: 'failed',
        reason: `This form does not accept ${file.name.split('.').pop() ?? 'that'} files here.`,
      };
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Some drop-zone components listen for the drop rather than the change.
    input.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    );

    if ((input.files?.length ?? 0) === 0) {
      return { status: 'failed', reason: 'The form rejected the file.' };
    }

    return { status: 'attached', fileName: resume.fileName, label };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Could not attach the file.',
    };
  }
}

/** Does the input's `accept` list allow this file? An absent list allows all. */
function accepts(input: HTMLInputElement, file: File): boolean {
  const accept = input.getAttribute('accept')?.trim();
  if (!accept) return true;

  const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;

  return accept.split(',').some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*/*') return true;
    if (rule.startsWith('.')) return rule === extension;
    if (rule.endsWith('/*')) return file.type.startsWith(rule.slice(0, -1));
    return rule === file.type.toLowerCase();
  });
}
