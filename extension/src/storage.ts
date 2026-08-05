import { DEFAULT_API_BASE_URL } from './config.js';

const TOKEN_KEY = 'authToken';
const EMAIL_KEY = 'userEmail';
const API_BASE_KEY = 'apiBaseUrl';

/**
 * chrome.storage.local, not sync: the JWT should not replicate across a user's
 * signed-in Chrome profiles.
 */
export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return (result[TOKEN_KEY] as string | undefined) ?? null;
}

export async function setSession(token: string, email: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token, [EMAIL_KEY]: email });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove([TOKEN_KEY, EMAIL_KEY]);
}

export async function getEmail(): Promise<string | null> {
  const result = await chrome.storage.local.get(EMAIL_KEY);
  return (result[EMAIL_KEY] as string | undefined) ?? null;
}

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get(API_BASE_KEY);
  return (result[API_BASE_KEY] as string | undefined) ?? DEFAULT_API_BASE_URL;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [API_BASE_KEY]: url.replace(/\/+$/, '') });
}
