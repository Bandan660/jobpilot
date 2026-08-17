import { answerKey } from '@jobpilot/shared';
import type {
  AuthResponse,
  CaptureResponse,
  Contact,
  DuplicateCheckResponse,
  Profile,
  ReferralAsk,
  UserReport,
} from '@jobpilot/shared';
import type { Message, Response, SessionState, StoredResumePayload } from './messages.js';
import { syncContentScripts } from './platforms.js';
import {
  clearSession,
  getApiBaseUrl,
  getEmail,
  getToken,
  setApiBaseUrl,
  setSession,
} from './storage.js';

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const base = await getApiBaseUrl();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  if (auth) {
    const token = await getToken();
    if (!token) throw new ApiError('Not signed in', 401);
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${base}${path}`, { ...init, headers });

  if (response.status === 401 && auth) {
    // Token expired or revoked. Drop it so the popup shows the login form
    // instead of failing silently on every subsequent page.
    await clearSession();
    throw new ApiError('Session expired - please sign in again', 401);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed (${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * The resume to attach: the most recently uploaded one.
 *
 * `GET /api/resumes` already returns them newest first, so "most recent" needs
 * no extra state and no preference to keep in sync. With the per-account cap
 * at five there is rarely a choice to make anyway, and picking the newest is
 * the behaviour someone who just uploaded a tailored resume expects.
 *
 * `api()` cannot serve this one: it sets a JSON content type and parses the
 * body as JSON, and this response is a PDF.
 */
async function currentResume(): Promise<StoredResumePayload | null> {
  const { resumes } = await api<{ resumes: { id: string; fileName: string }[] }>('/api/resumes');
  const newest = resumes[0];
  if (!newest) return null;

  const base = await getApiBaseUrl();
  const token = await getToken();
  if (!token) throw new ApiError('Not signed in', 401);

  const response = await fetch(`${base}/api/resumes/${newest.id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new ApiError(`Could not download your resume (${response.status})`, response.status);
  }

  const buffer = await response.arrayBuffer();

  return {
    fileName: newest.fileName,
    contentType: response.headers.get('Content-Type') ?? 'application/pdf',
    data: toBase64(buffer),
  };
}

/**
 * Chunked because `String.fromCharCode(...bytes)` on a multi-megabyte array
 * blows the argument limit and throws — a failure that only shows up on large
 * files, which is to say in front of a user and never in a test.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  return btoa(binary);
}

/**
 * Merge hand-typed answers into the saved profile.
 *
 * Read-modify-write, because `PUT /api/profile` replaces the whole document.
 * Matched on the server's own `answerKey` so an answer stored today is found
 * by the matcher tomorrow — the endpoint recomputes the key regardless, and
 * using the same function here means the dedupe below agrees with it.
 */
async function saveAnswers(
  answers: { label: string; answer: string }[]
): Promise<{ saved: number }> {
  if (answers.length === 0) return { saved: 0 };

  const { profile } = await api<{ profile: Profile }>('/api/profile');

  const merged = [...profile.savedAnswers];
  for (const entry of answers) {
    const key = answerKey(entry.label);
    if (!key) continue;

    const existing = merged.findIndex((saved) => saved.key === key);
    const record = { id: existing >= 0 ? merged[existing].id : crypto.randomUUID(), key, ...entry };

    // Overwrite rather than append: the newest answer to a question is the
    // one the user just gave, and two rows with one key make the lookup a
    // coin toss.
    if (existing >= 0) merged[existing] = record;
    else merged.push(record);
  }

  await api('/api/profile', { method: 'PUT', body: JSON.stringify({ ...profile, savedAnswers: merged }) });
  return { saved: answers.length };
}

async function currentSession(): Promise<SessionState> {
  let [token, email, apiBaseUrl] = await Promise.all([getToken(), getEmail(), getApiBaseUrl()]);
  if (token && (!email || !email.trim())) {
    try {
      const { profile } = await api<{ profile: Profile }>('/api/profile');
      if (profile?.email) {
        email = profile.email;
        await setSession(token, email);
      }
    } catch {
      /* Silent error fallback */
    }
  }
  return { authenticated: Boolean(token), email: email && email.trim() ? email : null, apiBaseUrl };
}

/** Page-scoped messages are answered by the content script, not the worker. */
type WorkerMessage = Exclude<
  Message,
  { type: 'GET_PAGE_JOB' } | { type: 'AUTOFILL_PAGE' } | { type: 'GET_FORM_COVERAGE' }
>;

/** Type guard rather than a Set lookup, so the switch below narrows correctly. */
function isPageMessage(message: Message): message is Exclude<Message, WorkerMessage> {
  return (
    message?.type === 'GET_PAGE_JOB' ||
    message?.type === 'AUTOFILL_PAGE' ||
    message?.type === 'GET_FORM_COVERAGE'
  );
}

async function handle(message: WorkerMessage): Promise<unknown> {
  switch (message.type) {
    case 'GET_SESSION':
      return currentSession();

    case 'SIGNUP':
    case 'LOGIN': {
      const path = message.type === 'SIGNUP' ? '/api/auth/signup' : '/api/auth/login';
      const result = await api<AuthResponse>(
        path,
        { method: 'POST', body: JSON.stringify(message.payload) },
        false
      );
      await setSession(result.token, result.user.email);
      return currentSession();
    }

    case 'LOGOUT':
      await clearSession();
      return currentSession();

    /*
     * A session the website handed over after signing in there.
     *
     * Trusted because of where it can come from, not because of what it says.
     * The only sender is the content script, and that script only runs on
     * jobpilot's own origin — the manifest's `matches` decides that, and it is
     * the actual security boundary here. The content script additionally
     * refuses messages that did not originate from its own window, so a framed
     * third-party page cannot post one through it.
     *
     * The token is not verified here. It does not need to be: an invalid one
     * simply 401s on the first API call and the session is cleared, which is
     * the same path an expired token already takes.
     */
    case 'ADOPT_SESSION': {
      let email = message.payload.email;
      await setSession(message.payload.token, email);
      if (!email || !email.trim()) {
        try {
          const { profile } = await api<{ profile: Profile }>('/api/profile');
          if (profile?.email) {
            email = profile.email;
            await setSession(message.payload.token, email);
          }
        } catch {
          /* Fallback */
        }
      }
      return currentSession();
    }

    case 'SET_API_BASE_URL':
      await setApiBaseUrl(message.payload.apiBaseUrl);
      return currentSession();

    case 'GET_PROFILE':
      return api<{ profile: Profile }>('/api/profile');

    case 'GET_REFERRALS':
      return api<{ referrals: ReferralAsk[] }>('/api/referrals');

    /*
     * Writes go to the per-application sub-resource, not to /api/referrals.
     * That route is read-only on purpose — ownership there is enforced by the
     * join, and a write path would have to re-derive it. `loadOwned` in
     * applications.ts already answers "is this the caller's application".
     */
    case 'UPDATE_REFERRAL':
      return api<{ referral: Contact }>(
        `/api/applications/${encodeURIComponent(
          message.payload.applicationId
        )}/referrals/${encodeURIComponent(message.payload.referralId)}`,
        { method: 'PATCH', body: JSON.stringify({ status: message.payload.status }) }
      );

    case 'GET_RESUME':
      return currentResume();

    case 'SAVE_ANSWERS':
      return saveAnswers(message.payload.answers);

    case 'SUBMIT_REPORT':
      return api<{ report: UserReport }>('/api/reports', {
        method: 'POST',
        body: JSON.stringify(message.payload),
      });

    case 'DRAFT_ANSWER':
      return api<{ answer: string }>('/api/analyze/answer', {
        method: 'POST',
        body: JSON.stringify(message.payload),
      });

    case 'CHECK_DUPLICATE':
      return api<DuplicateCheckResponse>('/api/capture/check-duplicate', {
        method: 'POST',
        body: JSON.stringify(message.payload),
      });

    case 'CAPTURE':
      return api<CaptureResponse>('/api/capture', {
        method: 'POST',
        body: JSON.stringify(message.payload),
      });

    default: {
      const exhaustive: never = message;
      throw new Error(`Unknown message: ${JSON.stringify(exhaustive)}`);
    }
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (isPageMessage(message)) return false;

  handle(message)
    .then((data) => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : 'Unexpected error';
      sendResponse({ ok: false, error: text } satisfies Response<never>);
    });

  // Keeps the message channel open for the async response above. Without this
  // the sender's promise resolves to undefined immediately.
  return true;
});

/* ------------------------- optional platform sites ------------------------ */

/*
 * Keep the dynamic content-script registrations matching what Chrome has
 * actually granted.
 *
 * Driven off `chrome.permissions` events rather than off the popup, because
 * the popup is not the only way a permission changes: a user can revoke a site
 * from Chrome's own extension settings, and an extension that kept a stale
 * registration would be trying to run somewhere it no longer may.
 *
 * `onStartup` and `onInstalled` both re-sync. Registrations are declared
 * `persistAcrossSessions`, so this is belt-and-braces — but the case it covers
 * is an update that changes the script filename or the platform list, where
 * what was persisted no longer describes what should be running.
 */
chrome.runtime.onStartup.addListener(() => void syncContentScripts());
chrome.runtime.onInstalled.addListener(() => void syncContentScripts());
chrome.permissions.onAdded.addListener(() => void syncContentScripts());
chrome.permissions.onRemoved.addListener(() => void syncContentScripts());
