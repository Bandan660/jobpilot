import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from './api.js';
import { handOffWhenReady } from './extensionBridge.js';

interface AuthValue {
  isAuthenticated: boolean;
  /** `remember` false keeps the session only until the tab closes. */
  signIn: (token: string, remember?: boolean) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Token state lives here rather than being read from localStorage at each call
 * site, so the header, route guards, and dashboard all re-render together on
 * sign-in and sign-out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [email, setEmail] = useState<string | null>(null);

  const signIn = useCallback((next: string, remember = true) => {
    setToken(next, remember);
    setTokenState(next);
  }, []);

  const signOut = useCallback(() => {
    /*
     * Tell the server first, then forget locally.
     *
     * Deleting the local copy was all this used to do, which meant signing out
     * on a shared machine left a token valid for the rest of its 30 days —
     * still working for anyone who had captured it. `POST /api/auth/logout`
     * moves the account's revocation cutoff forward, which ends every session
     * on every device.
     *
     * Not awaited, and failure is ignored on purpose: sign-out must never
     * appear to fail or hang. The local state is cleared regardless, and a
     * request that did not land leaves exactly the situation that existed
     * before this call was added.
     */
    void api.logout().catch(() => undefined);

    clearToken();
    setTokenState(null);
    setEmail(null);
    if (typeof window !== 'undefined') {
      window.postMessage({ source: 'banapply-web', type: 'LOGOUT' }, window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setEmail(null);
      return;
    }

    let cancelled = false;
    api
      .getProfile()
      .then(({ profile }) => {
        if (!cancelled && profile?.email) {
          setEmail(profile.email);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [token]);

  /*
   * Pass the session to the extension whenever there is one.
   */
  useEffect(() => {
    if (token) {
      return handOffWhenReady(token, email);
    }
  }, [token, email]);

  const value = useMemo(
    () => ({ isAuthenticated: Boolean(token), signIn, signOut }),
    [token, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
