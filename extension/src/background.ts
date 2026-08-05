import type {
  AuthResponse,
  CaptureResponse,
  DuplicateCheckResponse,
  Profile,
} from '@jobpilot/shared';
import type { Message, Response, SessionState } from './messages.js';
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

async function currentSession(): Promise<SessionState> {
  const [token, email, apiBaseUrl] = await Promise.all([getToken(), getEmail(), getApiBaseUrl()]);
  return { authenticated: Boolean(token), email, apiBaseUrl };
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

    case 'SET_API_BASE_URL':
      await setApiBaseUrl(message.payload.apiBaseUrl);
      return currentSession();

    case 'GET_PROFILE':
      return api<{ profile: Profile }>('/api/profile');

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
