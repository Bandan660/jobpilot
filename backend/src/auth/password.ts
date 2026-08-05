/**
 * Password hashing on Web Crypto (PBKDF2-SHA256).
 *
 * bcrypt/argon2 are native modules and do not run on Workers, so PBKDF2 via
 * `crypto.subtle` is the only real option in this runtime.
 *
 * CPU NOTE: the Workers *free* plan caps CPU at 10ms per invocation, and
 * 100k PBKDF2 iterations exceeds that. Signup/login may therefore need the $5
 * Workers Paid plan. Do not "fix" this by dropping iterations -- that trades a
 * real security property for a hosting bill. See README "Known limits".
 */

const ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;
const PREFIX = 'pbkdf2-sha256';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );

  return new Uint8Array(bits);
}

/** Returns `pbkdf2-sha256$<iterations>$<salt>$<hash>`, all base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time compare, so verification time leaks nothing about the hash. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  try {
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    // Reuse the stored iteration count so old hashes stay verifiable if
    // ITERATIONS is raised later.
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
