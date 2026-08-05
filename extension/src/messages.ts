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
  // Handled by the content script, not the worker: only it can touch the page.
  | { type: 'GET_PAGE_JOB' }
  | { type: 'AUTOFILL_PAGE'; payload: { overwrite: boolean } }
  | { type: 'GET_FORM_COVERAGE' };

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

export function send<T>(message: Message): Promise<Response<T>> {
  return chrome.runtime.sendMessage(message) as Promise<Response<T>>;
}
