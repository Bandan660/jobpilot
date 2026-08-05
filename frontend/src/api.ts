import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  AuthResponse,
  FunnelStats,
  Note,
} from '@jobpilot/shared';
import { DEMO_APPLICATIONS, DEMO_DEAD_POSTINGS, DEMO_STATS } from './demo.js';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:8787';
const TOKEN_KEY = 'jobpilot.token';

/** Set VITE_DEMO=1 to render the UI against fixtures with no API or database. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

export function getToken(): string | null {
  // Demo mode does NOT auto-authenticate: the marketing site and the sign-in
  // flow are part of what needs reviewing, so the gate stays in place and
  // demo credentials simply always succeed.
  //
  // Guarded for the prerender pass, which runs in Node with no localStorage.
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');

  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    throw new ApiError('Session expired', 401);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed (${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const liveApi = {
  signup: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  listApplications: (params: { status?: string; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.q) search.set('q', params.q);
    const suffix = search.toString() ? `?${search}` : '';
    return request<{ applications: Application[] }>(`/api/applications${suffix}`);
  },

  getApplication: (id: string) =>
    request<{ application: Application; events: ApplicationEvent[]; notes: Note[] }>(
      `/api/applications/${id}`
    ),

  updateStatus: (id: string, status: ApplicationStatus) =>
    request<{ application: Application }>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  deleteApplication: (id: string) =>
    request<void>(`/api/applications/${id}`, { method: 'DELETE' }),

  createApplication: (input: {
    title: string;
    company: string;
    jobUrl?: string | null;
    status?: ApplicationStatus;
  }) =>
    request<{ application: Application }>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  funnel: () => request<FunnelStats>('/api/stats/funnel'),

  deadPostings: () =>
    request<{
      alerts: { id: string; title: string; postingStatus: string; appliedAt: string | null }[];
    }>('/api/stats/dead-postings'),
};

/* -------------------------------------------------------------------------- */
/* Demo mode                                                                  */
/* -------------------------------------------------------------------------- */

/** Swapped in at the module boundary so components never branch on DEMO. */
function buildDemoApi(): typeof liveApi {
  let rows = [...DEMO_APPLICATIONS];
  const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), 120));

  const session = (email: string) => ({
    token: 'demo-token',
    user: { id: 'demo-user', email, createdAt: new Date().toISOString() },
  });

  return {
    ...liveApi,

    login: (email: string) => delay(session(email)),
    signup: (email: string) => delay(session(email)),

    listApplications: ({ q }: { status?: string; q?: string } = {}) => {
      const needle = q?.toLowerCase().trim();
      const filtered = needle
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(needle) ||
              r.company.name.toLowerCase().includes(needle)
          )
        : rows;
      return delay({ applications: filtered });
    },

    updateStatus: (id: string, status: ApplicationStatus) => {
      rows = rows.map((r) => (r.id === id ? { ...r, status } : r));
      const application = rows.find((r) => r.id === id)!;
      return delay({ application });
    },

    funnel: () => {
      const byStatus = { ...DEMO_STATS.byStatus };
      for (const key of Object.keys(byStatus) as ApplicationStatus[]) byStatus[key] = 0;
      for (const row of rows) byStatus[row.status] += 1;
      return delay({ ...DEMO_STATS, total: rows.length, byStatus });
    },

    deadPostings: () => delay({ alerts: DEMO_DEAD_POSTINGS }),
  };
}

export const api = DEMO ? buildDemoApi() : liveApi;
