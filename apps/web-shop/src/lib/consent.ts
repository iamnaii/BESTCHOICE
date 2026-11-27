export const CONSENT_POLICY_VERSION = 1;
export const CONSENT_STORAGE_KEY = 'bc_cookie_consent';

export type ConsentCategory = 'analytics' | 'marketing';
export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}
export interface ConsentState extends ConsentChoice {
  /** false until the visitor has chosen under the current policy version */
  decided: boolean;
}

type Listener = (state: ConsentState) => void;

const UNDECIDED: ConsentState = { analytics: false, marketing: false, decided: false };

let state: ConsentState | null = null;
let storageListenerAttached = false;
const listeners = new Set<Listener>();

function readStored(): ConsentState {
  if (typeof window === 'undefined') return { ...UNDECIDED };
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return { ...UNDECIDED };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...UNDECIDED };
    }
    const v = parsed as Record<string, unknown>;
    if (
      v.version !== CONSENT_POLICY_VERSION ||
      typeof v.analytics !== 'boolean' ||
      typeof v.marketing !== 'boolean'
    ) {
      return { ...UNDECIDED };
    }
    return { analytics: v.analytics, marketing: v.marketing, decided: true };
  } catch {
    return { ...UNDECIDED };
  }
}

function notify(next: ConsentState): void {
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch {
      // a failing listener must not block the others
    }
  }
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== CONSENT_STORAGE_KEY) return;
  state = readStored();
  notify(state);
}

/** Current state. Returns the SAME object reference until the state changes. */
export function getConsentState(): ConsentState {
  if (state === null) {
    state = readStored();
    if (typeof window !== 'undefined' && !storageListenerAttached) {
      window.addEventListener('storage', onStorage);
      storageListenerAttached = true;
    }
  }
  return state;
}

/** Persist a choice (stamps version + decidedAt), update state, notify listeners. */
export function saveConsent(choice: ConsentChoice): void {
  getConsentState();
  try {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_POLICY_VERSION,
        analytics: choice.analytics,
        marketing: choice.marketing,
        decidedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // blocked storage: the choice lasts for this page session only
  }
  state = { analytics: choice.analytics, marketing: choice.marketing, decided: true };
  notify(state);
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when the given category is currently consented. */
export function hasConsent(category: ConsentCategory): boolean {
  return getConsentState()[category];
}

/** Test-only: drop the in-memory state so the next read re-reads storage. */
export function __resetConsentForTest(): void {
  state = null;
}
