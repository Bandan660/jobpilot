import { EMPTY_PROFILE, REFERRAL_ACCEPTED } from '@jobpilot/shared';
import type { ImportRow } from './csv.js';
import type {
  AdminMetrics,
  Application,
  ApplicationEvent,
  ApplicationStatus,
  AuthResponse,
  Contact,
  EmploymentType,
  FunnelStats,
  Note,
  Profile,
  ProfileInput,
  ReferralStatus,
  Resume,
} from '@jobpilot/shared';
import {
  DEMO_APPLICATIONS,
  DEMO_DEAD_POSTINGS,
  DEMO_PROFILE_FIELDS,
  DEMO_STATS,
} from './demo.js';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? 'http://localhost:8787';
const TOKEN_KEY = 'jobpilot.token';

/** Set VITE_DEMO=1 to render the UI against fixtures with no API or database. */
export const DEMO = import.meta.env.VITE_DEMO === '1';

/**
 * Token storage.
 *
 * localStorage persists across browser restarts; sessionStorage is wiped when
 * the tab closes. That difference is what "remember this device" actually
 * means — without it the checkbox would be decoration.
 */
export function getToken(): string | null {
  // Demo mode does NOT auto-authenticate: the marketing site and the sign-in
  // flow are part of what needs reviewing, so the gate stays in place and
  // demo credentials simply always succeed.
  //
  // Guarded for the prerender pass, which runs in Node with no localStorage.
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string, remember = true): void {
  // Always clear both first: switching the preference between sign-ins must
  // not leave a stale copy in the other store.
  clearToken();
  if (remember) localStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
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

  listApplications: (
    params: {
      status?: string;
      q?: string;
      archived?: 'true' | 'false' | 'all';
      starred?: 'true';
      from?: string;
      to?: string;
      sort?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      // `offset: 0` is a real value and has to survive. Dropping it as falsy
      // sends page two with no offset — which is page one, again.
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
    const suffix = search.toString() ? `?${search}` : '';
    return request<{ applications: Application[]; total: number }>(
      `/api/applications${suffix}`
    );
  },

  updateApplication: (
    id: string,
    patch: { status?: ApplicationStatus; archived?: boolean; starred?: boolean; title?: string }
  ) =>
    request<{ application: Application }>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  importApplications: (rows: ImportRow[]) =>
    request<{ imported: number; skipped: number; failures: { row: number; reason: string }[] }>(
      '/api/applications/import',
      { method: 'POST', body: JSON.stringify({ rows }) }
    ),

  getApplication: (id: string) =>
    request<{
      application: Application;
      events: ApplicationEvent[];
      notes: Note[];
      referrals: Contact[];
    }>(`/api/applications/${id}`),

  /* --------------------------- referral asks --------------------------- */

  listReferrals: (applicationId: string) =>
    request<{ referrals: Contact[] }>(`/api/applications/${applicationId}`).then(
      (r) => r.referrals
    ),

  addReferral: (
    applicationId: string,
    input: {
      name: string;
      role?: string | null;
      linkedinUrl?: string | null;
      status?: 'INVITED' | 'ASKED';
    }
  ) =>
    request<{ referral: Contact }>(`/api/applications/${applicationId}/referrals`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateReferral: (
    applicationId: string,
    referralId: string,
    patch: { status?: ReferralStatus; name?: string; role?: string | null; linkedinUrl?: string | null }
  ) =>
    request<{ referral: Contact }>(
      `/api/applications/${applicationId}/referrals/${referralId}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    ),

  deleteReferral: (applicationId: string, referralId: string) =>
    request<void>(`/api/applications/${applicationId}/referrals/${referralId}`, {
      method: 'DELETE',
    }),

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
    location?: string | null;
    employmentType?: EmploymentType | null;
    resumeId?: string | null;
    status?: ApplicationStatus;
    appliedAt?: string | null;
  }) =>
    request<{ application: Application }>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Trade a Firebase ID token for a jobpilot session token. */
  firebaseExchange: (idToken: string) =>
    request<AuthResponse>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),

  /** Who the caller is and whether the admin surface is open to them. */
  session: () => request<{ userId: string; isAdmin: boolean }>('/api/auth/session'),

  /** Service-wide aggregates. 403s for anyone not on the admin allowlist. */
  adminMetrics: () => request<AdminMetrics>('/api/admin/metrics'),

  /* -------------------------------------------------------------------------- */
  /* Blog API                                                                  */
  /* -------------------------------------------------------------------------- */
  getPublicBlogPosts: () => request<import('@jobpilot/shared').DynamicBlogPost[]>('/api/blog'),
  getPublicBlogPostBySlug: (slug: string) =>
    request<import('@jobpilot/shared').DynamicBlogPost>(`/api/blog/${encodeURIComponent(slug)}`),
  getAdminBlogPosts: () => request<import('@jobpilot/shared').DynamicBlogPost[]>('/api/admin/blog'),
  createBlogPost: (input: import('@jobpilot/shared').CreateBlogPostInput) =>
    request<import('@jobpilot/shared').DynamicBlogPost>('/api/admin/blog', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateBlogPost: (id: string, input: Partial<import('@jobpilot/shared').CreateBlogPostInput>) =>
    request<import('@jobpilot/shared').DynamicBlogPost>(`/api/admin/blog/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteBlogPost: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/blog/${id}`, { method: 'DELETE' }),

  /* -------------------------------------------------------------------------- */
  /* Reports API                                                                */
  /* -------------------------------------------------------------------------- */
  submitReport: (input: import('@jobpilot/shared').CreateReportInput) =>
    request<{ report: import('@jobpilot/shared').UserReport }>('/api/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getAdminReports: () => request<import('@jobpilot/shared').UserReport[]>('/api/admin/reports'),
  updateReportStatus: (id: string, status: string) =>
    request<{ report: import('@jobpilot/shared').UserReport }>(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  /**
   * Ends every session for this account, not just this browser's copy of the
   * token. See `authRoutes.post('/logout')` — the token itself stays
   * cryptographically valid for 30 days, so the only way to retire one early
   * is the server-side cutoff this moves.
   */
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  getProfile: () => request<{ profile: Profile }>('/api/profile'),

  updateProfile: (input: ProfileInput & { onboardingComplete?: boolean }) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  listResumes: () => request<{ resumes: Resume[] }>('/api/resumes'),

  /**
   * Raw body upload, not multipart — the API takes one file with its name in a
   * header. Content-Type must be set explicitly, since the browser would
   * otherwise leave it off for a File body.
   *
   * `file.type` is not reliable. It comes from the OS association rather than
   * from the bytes, and it is empty often enough to matter — files dragged from
   * some Windows apps, files with no registered handler, files restored from an
   * archive. Empty reaches the API as no Content-Type at all and comes back
   * "Upload a PDF or Word document" about a genuine PDF, which reads as a bug
   * in the file rather than in the header. The extension decides it when the
   * browser will not; the server still verifies the magic bytes either way, so
   * this widens no hole.
   */
  uploadResume: async (file: File) => {
    const token = getToken();
    const byExtension: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const contentType = file.type || byExtension[extension] || 'application/octet-stream';

    const response = await fetch(`${BASE_URL}/api/resumes`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-File-Name': encodeURIComponent(file.name),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(body?.message ?? 'Upload failed', response.status);
    }
    return (await response.json()) as { resume: Resume };
  },

  setDefaultResume: (id: string) =>
    request<{ resume: Resume }>(`/api/resumes/${id}`, { method: 'PATCH' }),

  deleteResume: (id: string) => request<void>(`/api/resumes/${id}`, { method: 'DELETE' }),

  /** Fetched with auth, then handed to the browser as a blob. */
  downloadResume: async (id: string, fileName: string) => {
    const token = getToken();
    const response = await fetch(`${BASE_URL}/api/resumes/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError('Could not download', response.status);

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Fetches the file and hands back an object URL for the caller to render.
   *
   * Resume objects sit behind auth and have deliberately no public URL, so an
   * iframe cannot point at the endpoint directly — it has to be fetched with
   * the bearer token first. Revoking is the caller's job, since only it knows
   * when the viewer has gone away.
   */
  previewResume: async (id: string): Promise<string> => {
    const token = getToken();
    const response = await fetch(`${BASE_URL}/api/resumes/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new ApiError('Could not open that file', response.status);

    return URL.createObjectURL(await response.blob());
  },

  funnel: () => request<FunnelStats>('/api/stats/funnel'),

  deadPostings: () =>
    request<{
      alerts: { id: string; title: string; postingStatus: string; appliedAt: string | null }[];
    }>('/api/stats/dead-postings'),

  activity: () => request<{ events: ActivityEvent[] }>('/api/stats/activity'),
};

export interface ActivityEvent {
  id: string;
  type: string;
  actor: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredAt: string;
  applicationId: string;
  title: string;
  companyName: string;
}

/* -------------------------------------------------------------------------- */
/* Demo mode                                                                  */
/* -------------------------------------------------------------------------- */

/** Swapped in at the module boundary so components never branch on DEMO. */
function buildDemoApi(): typeof liveApi {
  let rows = [...DEMO_APPLICATIONS];
  const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), 120));

  const demoReferrals = new Map<string, Contact[]>();
  let demoReferralSeq = 0;

  /** Keeps the row's counts in step with the map, using the shared definition. */
  const syncDemoCounts = (applicationId: string) => {
    const list = demoReferrals.get(applicationId) ?? [];
    rows = rows.map((r) =>
      r.id === applicationId
        ? {
            ...r,
            referralCount: list.length,
            referralAccepted: list.filter((x) => REFERRAL_ACCEPTED.includes(x.status)).length,
          }
        : r
    );
  };

  const session = (email: string) => ({
    token: 'demo-token',
    user: { id: 'demo-user', email, createdAt: new Date().toISOString() },
  });

  // Kept in memory so the onboarding flow can be walked end to end in demo
  // mode without a database behind it.
  let demoProfile: Profile = {
    ...EMPTY_PROFILE,
    // Filled in rather than blank: an empty profile demonstrates the empty
    // state, which is not what a demo is for. See DEMO_PROFILE_FIELDS.
    ...DEMO_PROFILE_FIELDS,
    id: 'demo-profile',
    userId: 'demo-user',
    /*
     * Onboarded, or demo mode cannot show the thing it exists to show. The app
     * routes anyone whose profile has no completion timestamp back into
     * onboarding, and `EMPTY_PROFILE` has none — so "renders the whole UI
     * against fixtures" landed on step 1 of 5 and stopped there, with the
     * tracker and the dashboard unreachable behind a five-step form that saves
     * to a fixture.
     */
    onboardingCompletedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    ...liveApi,

    login: (email: string) => delay(session(email)),
    signup: (email: string) => delay(session(email)),

    getProfile: () => delay({ profile: demoProfile }),

    updateProfile: (input: ProfileInput & { onboardingComplete?: boolean }) => {
      const { onboardingComplete, ...fields } = input;
      demoProfile = {
        ...demoProfile,
        ...fields,
        onboardingCompletedAt: onboardingComplete
          ? new Date().toISOString()
          : demoProfile.onboardingCompletedAt,
        updatedAt: new Date().toISOString(),
      } as Profile;
      return delay({ profile: demoProfile });
    },

    listApplications: ({
      q,
      limit,
      offset = 0,
    }: { status?: string; q?: string; limit?: number; offset?: number } = {}) => {
      const needle = q?.toLowerCase().trim();
      const filtered = needle
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(needle) ||
              r.company.name.toLowerCase().includes(needle)
          )
        : rows;
      // Sliced the way the API slices, so demo mode exercises the pager rather
      // than rendering every fixture on one page.
      const page = limit === undefined ? filtered : filtered.slice(offset, offset + limit);
      return delay({ applications: page, total: filtered.length });
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
    activity: () => delay({ events: [] as ActivityEvent[] }),
    // Demo mode has no server and no admin. False keeps the link hidden
    // rather than routing to a page that cannot load.
    session: () => delay({ userId: 'demo', isAdmin: false }),
    listResumes: () => delay({ resumes: [] as Resume[] }),

    /*
     * Referrals are held in memory so the whole log-an-ask flow can be walked
     * end to end with no API and no database, the same way onboarding can.
     * The counts on the tracker row are recomputed from this map on every
     * list, because a stale count is the one bug this screen can have that
     * looks like working software.
     */
    getApplication: (id: string) =>
      delay({
        application: rows.find((r) => r.id === id)!,
        events: [] as ApplicationEvent[],
        notes: [] as Note[],
        referrals: demoReferrals.get(id) ?? [],
      }),

    listReferrals: (applicationId: string) => delay(demoReferrals.get(applicationId) ?? []),

    addReferral: (
      applicationId: string,
      input: {
        name: string;
        role?: string | null;
        linkedinUrl?: string | null;
        status?: 'INVITED' | 'ASKED';
      }
    ) => {
      const referral: Contact = {
        id: `demo-ref-${(demoReferralSeq += 1)}`,
        applicationId,
        name: input.name,
        email: null,
        role: input.role ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        status: input.status ?? 'INVITED',
        statusAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      demoReferrals.set(applicationId, [...(demoReferrals.get(applicationId) ?? []), referral]);
      syncDemoCounts(applicationId);
      return delay({ referral });
    },

    updateReferral: (
      applicationId: string,
      referralId: string,
      patch: {
        status?: ReferralStatus;
        name?: string;
        role?: string | null;
        linkedinUrl?: string | null;
      }
    ) => {
      const list = (demoReferrals.get(applicationId) ?? []).map((r) =>
        r.id === referralId
          ? {
              ...r,
              ...patch,
              statusAt:
                patch.status && patch.status !== r.status ? new Date().toISOString() : r.statusAt,
            }
          : r
      );
      demoReferrals.set(applicationId, list);
      syncDemoCounts(applicationId);
      return delay({ referral: list.find((r) => r.id === referralId)! });
    },

    deleteReferral: (applicationId: string, referralId: string) => {
      demoReferrals.set(
        applicationId,
        (demoReferrals.get(applicationId) ?? []).filter((r) => r.id !== referralId)
      );
      syncDemoCounts(applicationId);
      return delay(undefined as void);
    },
    submitReport: (input: import('@jobpilot/shared').CreateReportInput) =>
      delay({
        report: {
          id: 'demo-report-1',
          userId: 'demo-user',
          userEmail: 'user@example.com',
          category: input.category,
          subject: input.subject,
          description: input.description,
          pageUrl: input.pageUrl ?? null,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      }),
    getAdminReports: () => delay([] as import('@jobpilot/shared').UserReport[]),
    updateReportStatus: (id: string, status: string) =>
      delay({
        report: {
          id,
          userId: 'demo-user',
          userEmail: 'user@example.com',
          category: 'bug',
          subject: 'Demo Report',
          description: 'Demo description',
          pageUrl: null,
          status: status as any,
          createdAt: new Date().toISOString(),
        },
      }),
  };
}

export const api = DEMO ? buildDemoApi() : liveApi;
