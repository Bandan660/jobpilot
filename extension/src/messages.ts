import type {
  CaptureRequest,
  CaptureResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
  Profile,
} from '@jobpilot/shared';

/** Summary of one autofill run, returned to the popup. */
export interface AutofillSummary {
  filled: number;
  skipped: number;
  unanswered: { label: string }[];
}

/**
 * Content and popup never call the API directly -- everything goes through the
 * service worker. That keeps the auth token out of page-injected scripts and
 * gives one place to handle 401s.
 */
export type Message =
  | { type: 'CHECK_DUPLICATE'; payload: DuplicateCheckRequest }
  | { type: 'CAPTURE'; payload: CaptureRequest }
  | { type: 'GET_SESSION' }
  | { type: 'LOGIN'; payload: { email: string; password: string } }
  | { type: 'SIGNUP'; payload: { email: string; password: string } }
  | { type: 'LOGOUT' }
  | { type: 'SET_API_BASE_URL'; payload: { apiBaseUrl: string } }
  | { type: 'GET_PROFILE' }
  /**
   * The stored resume, bytes and all.
   *
   * Fetched by the worker because only it holds the token, and returned as
   * base64 because `chrome.runtime` messaging serialises as JSON — an
   * ArrayBuffer crosses it as `{}`. Costs a third in size on a file already
   * capped at 3MB, which is the cheapest part of this.
   */
  | { type: 'GET_RESUME' }
  /** Metadata only. The panel shows a filename; it must not pull 3MB to do it. */
  | { type: 'GET_RESUMES' }
  | { type: 'DRAFT_ANSWER'; payload: DraftAnswerRequest }
  /**
   * Answers the user typed by hand, merged into the profile by key.
   *
   * Merged in the worker rather than here: the profile endpoint replaces the
   * whole document, so the read-modify-write has to happen somewhere that
   * already holds a complete one. Doing it from a content script would mean
   * shipping the entire profile through two message hops to change one field.
   */
  | { type: 'SAVE_ANSWERS'; payload: { answers: { label: string; answer: string }[] } }
  // Handled by the content script, not the worker: only it can touch the page.
  | { type: 'GET_PAGE_JOB' }
  | { type: 'AUTOFILL_PAGE'; payload: { overwrite: boolean } }
  | { type: 'GET_FORM_COVERAGE' };

export interface StoredResumePayload {
  fileName: string;
  contentType: string;
  /** base64 */
  data: string;
}

export interface DraftAnswerRequest {
  question: string;
  title: string | null;
  company: string | null;
  jobUrl: string;
}

export interface SessionState {
  authenticated: boolean;
  email: string | null;
  apiBaseUrl: string;
}

/** Uniform envelope so callers never have to guess between shapes. */
export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export type MessageResult =
  | { type: 'CHECK_DUPLICATE'; data: DuplicateCheckResponse }
  | { type: 'CAPTURE'; data: CaptureResponse }
  | { type: 'GET_SESSION'; data: SessionState }
  | { type: 'GET_PROFILE'; data: { profile: Profile } };

export async function send<T>(message: Message): Promise<Response<T>> {
  /*
   * chrome.runtime.sendMessage rejects rather than resolving in two ordinary
   * situations, and an unhandled rejection here surfaces as a stack trace
   * pointing at content.js:1 with no useful frame:
   *
   * - the extension was reloaded or updated while this page stayed open. The
   *   injected script keeps running against a context that no longer exists,
   *   and every call fails with "Extension context invalidated". This happens
   *   constantly during development.
   * - the service worker is asleep and does not wake for this message.
   *
   * Neither is worth crashing over. Callers already handle { ok: false }, so
   * the failure is converted into one rather than thrown.
   */
  try {
    // Absent once the context is torn down — cheaper than waiting for the
    // rejection, and it distinguishes this case from a genuine send failure.
    if (!chrome.runtime?.id) {
      return { ok: false, error: 'jobpilot was reloaded — refresh this page to reconnect.' };
    }

    return (await chrome.runtime.sendMessage(message)) as Response<T>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('Extension context invalidated')) {
      return { ok: false, error: 'jobpilot was reloaded — refresh this page to reconnect.' };
    }
    return { ok: false, error: detail };
  }
}
