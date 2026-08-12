/**
 * Job sites the user can switch on, and the machinery that switches them on.
 *
 * WHY THIS EXISTS
 *
 * Three platforms ship enabled: LinkedIn, Indeed and Naukri, declared in
 * `content_scripts` and granted at install. Everything else is here, and the
 * difference is not what the code can do — every adapter is compiled into the
 * bundle either way — but whether the content script is allowed to run on that
 * host yet.
 *
 * The alternative was adding hosts to `content_scripts.matches` as each
 * platform was verified, and that carries a cost most of the way through a
 * release before anyone notices it: adding a *required* host permission to an
 * update is a permission increase, and Chrome disables the extension for every
 * existing install until each user re-accepts the prompt. Doing that once per
 * adapter, across two dozen adapters, would mean repeatedly knocking users
 * offline to ship something they did not ask for.
 *
 * Optional permissions have no such cost. Adding an entry below in a future
 * release disturbs nobody; the user grants a site when they want it, from the
 * popup, and can take it back. It also states the honest thing at the moment
 * it matters: these adapters are built from published markup conventions and
 * have not been driven against a live posting, so enabling one is opting into
 * something unproven rather than being handed it silently.
 *
 * ADDING A PLATFORM LATER
 *
 * Add it here, with the same host patterns the adapter's `matches()` accepts.
 * Nothing else — `ADAPTERS` already carries every adapter, and registration is
 * derived from what the user has granted. Every pattern here must also appear
 * in `optional_host_permissions` in the manifest, or the request is rejected
 * at runtime with no useful error.
 */

export interface Platform {
  /** Stable id. Used in storage and as the dynamic content-script id. */
  id: string;
  label: string;
  /** Match patterns, which are both the permission origins and the script matches. */
  origins: string[];
}

export const OPTIONAL_PLATFORMS: Platform[] = [
  // Proven on a live posting. The one to turn on first.
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    origins: ['https://boards.greenhouse.io/*', 'https://job-boards.greenhouse.io/*'],
  },
  { id: 'lever', label: 'Lever', origins: ['https://jobs.lever.co/*'] },
  { id: 'ashby', label: 'Ashby', origins: ['https://jobs.ashbyhq.com/*'] },
  {
    id: 'workday',
    label: 'Workday',
    // Both tenant domains. The newer one has never been in the manifest, which
    // is why the adapter appeared to do nothing on it.
    origins: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'],
  },
  { id: 'smartrecruiters', label: 'SmartRecruiters', origins: ['https://jobs.smartrecruiters.com/*'] },
  { id: 'workable', label: 'Workable', origins: ['https://apply.workable.com/*'] },
  { id: 'icims', label: 'iCIMS', origins: ['https://*.icims.com/*'] },
  { id: 'taleo', label: 'Taleo', origins: ['https://*.taleo.net/*'] },
  {
    id: 'successfactors',
    label: 'SAP SuccessFactors',
    origins: ['https://*.successfactors.com/*', 'https://*.successfactors.eu/*'],
  },
  { id: 'teamtailor', label: 'Teamtailor', origins: ['https://*.teamtailor.com/*'] },
  { id: 'recruitee', label: 'Recruitee', origins: ['https://*.recruitee.com/*'] },
  {
    id: 'personio',
    label: 'Personio',
    origins: ['https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*'],
  },
  { id: 'bamboohr', label: 'BambooHR', origins: ['https://*.bamboohr.com/*'] },
  { id: 'jobvite', label: 'Jobvite', origins: ['https://jobs.jobvite.com/*'] },
  { id: 'zohorecruit', label: 'Zoho Recruit', origins: ['https://*.zohorecruit.com/*'] },
  { id: 'darwinbox', label: 'Darwinbox', origins: ['https://*.darwinbox.in/*'] },
  { id: 'keka', label: 'Keka', origins: ['https://*.keka.com/*'] },
  {
    id: 'glassdoor',
    label: 'Glassdoor',
    origins: ['https://*.glassdoor.com/*', 'https://*.glassdoor.co.in/*'],
  },
  { id: 'foundit', label: 'Foundit (Monster)', origins: ['https://*.foundit.in/*'] },
  { id: 'instahyre', label: 'Instahyre', origins: ['https://www.instahyre.com/*'] },
  { id: 'cutshort', label: 'Cutshort', origins: ['https://cutshort.io/*'] },
  { id: 'hirist', label: 'Hirist', origins: ['https://www.hirist.tech/*'] },
  { id: 'seek', label: 'SEEK', origins: ['https://www.seek.com.au/*'] },
];

/** The file the content script is bundled to. Must match `build.mjs` output. */
const CONTENT_SCRIPT = 'content.js';

/**
 * Which platforms the user has actually granted.
 *
 * Read from `chrome.permissions`, never from storage. The browser is the only
 * authority on this — a user can revoke a site from Chrome's own extension
 * settings without the extension being told, and a cached list would then
 * offer to run somewhere it no longer can.
 */
export async function grantedPlatforms(): Promise<Platform[]> {
  const granted = await chrome.permissions.getAll();
  const origins = new Set(granted.origins ?? []);
  return OPTIONAL_PLATFORMS.filter((platform) =>
    platform.origins.every((origin) => origins.has(origin))
  );
}

/**
 * Ask for a platform. Must be called from a user gesture — a click handler in
 * the popup — or Chrome rejects the request without showing a prompt.
 */
export async function requestPlatform(platform: Platform): Promise<boolean> {
  const granted = await chrome.permissions.request({ origins: platform.origins });
  if (granted) await syncContentScripts();
  return granted;
}

export async function revokePlatform(platform: Platform): Promise<void> {
  await chrome.permissions.remove({ origins: platform.origins });
  await syncContentScripts();
}

/**
 * Make the registered content scripts match what has been granted.
 *
 * Everything granted goes into one registration rather than one per platform:
 * the set is rebuilt wholesale on every change, so there is no partial state to
 * reconcile, and a stale registration for a revoked host cannot survive.
 *
 * Registering for a host the extension no longer holds permission for throws,
 * which is why this unregisters first and why the whole thing is wrapped —
 * a failure here must not take down the service worker that also serves the
 * API calls.
 */
export async function syncContentScripts(): Promise<void> {
  try {
    const platforms = await grantedPlatforms();
    const matches = platforms.flatMap((platform) => platform.origins);

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [OPTIONAL_SCRIPT_ID],
    });

    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [OPTIONAL_SCRIPT_ID] });
    }

    if (matches.length === 0) return;

    await chrome.scripting.registerContentScripts([
      {
        id: OPTIONAL_SCRIPT_ID,
        matches,
        js: [CONTENT_SCRIPT],
        runAt: 'document_idle',
        // Survives browser restarts, so a granted site keeps working without
        // the popup ever being opened again.
        persistAcrossSessions: true,
      },
    ]);
  } catch (error) {
    console.warn('[banapply] could not sync optional content scripts:', error);
  }
}

const OPTIONAL_SCRIPT_ID = 'banapply-optional-platforms';

/**
 * Run the content script in tabs that are already open on a just-granted host.
 *
 * Registration only affects future navigations. Without this, enabling a
 * platform while looking at a posting on it does nothing until the user
 * reloads — which reads as the toggle not working.
 */
export async function injectIntoOpenTabs(platform: Platform): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: platform.origins });

    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [CONTENT_SCRIPT],
          });
        } catch {
          // A tab that cannot be scripted — mid-navigation, or a page the
          // browser protects. The next load picks it up from the registration.
        }
      })
    );
  } catch (error) {
    console.warn('[banapply] could not inject into open tabs:', error);
  }
}
