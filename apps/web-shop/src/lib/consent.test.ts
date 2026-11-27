import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CONSENT_POLICY_VERSION,
  CONSENT_STORAGE_KEY,
  __resetConsentForTest,
  getConsentState,
  hasConsent,
  saveConsent,
  subscribeConsent,
} from './consent';

const UNDECIDED = { analytics: false, marketing: false, decided: false };

beforeEach(() => {
  __resetConsentForTest();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading stored consent', () => {
  test('no stored value is undecided', () => {
    expect(getConsentState()).toEqual(UNDECIDED);
  });

  test('valid stored value with the current version is decided', () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_POLICY_VERSION,
        analytics: true,
        marketing: false,
        decidedAt: '2026-11-27T00:00:00.000Z',
      }),
    );
    expect(getConsentState()).toEqual({ analytics: true, marketing: false, decided: true });
  });

  test('older policy version is undecided', () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ version: 0, analytics: true, marketing: true, decidedAt: 'x' }),
    );
    expect(getConsentState()).toEqual(UNDECIDED);
  });

  test.each([
    ['malformed JSON', '{not json'],
    ['a JSON array', '[1,2]'],
    [
      'a non-boolean analytics',
      JSON.stringify({ version: CONSENT_POLICY_VERSION, analytics: 'yes', marketing: false }),
    ],
  ])('%s is undecided', (_name, raw) => {
    localStorage.setItem(CONSENT_STORAGE_KEY, raw);
    expect(getConsentState()).toEqual(UNDECIDED);
  });

  test('getItem throwing is undecided and does not throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => getConsentState()).not.toThrow();
    expect(getConsentState()).toEqual(UNDECIDED);
  });
});

describe('saveConsent', () => {
  test('persists the choice and updates state', () => {
    saveConsent({ analytics: true, marketing: false });
    const stored = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) as string);
    expect(stored.version).toBe(1);
    expect(stored.analytics).toBe(true);
    expect(stored.marketing).toBe(false);
    expect(new Date(stored.decidedAt).toISOString()).toBe(stored.decidedAt);
    expect(getConsentState()).toEqual({ analytics: true, marketing: false, decided: true });
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('marketing')).toBe(false);
  });

  test('state reference is stable until saveConsent replaces it', () => {
    const a = getConsentState();
    expect(getConsentState()).toBe(a);
    saveConsent({ analytics: false, marketing: false });
    const b = getConsentState();
    expect(b).not.toBe(a);
    expect(getConsentState()).toBe(b);
  });

  test('setItem throwing does not throw and state still updates', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveConsent({ analytics: true, marketing: true })).not.toThrow();
    expect(getConsentState()).toEqual({ analytics: true, marketing: true, decided: true });
  });
});

describe('subscribeConsent', () => {
  test('notifies once per save with the new state, stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsent(listener);
    saveConsent({ analytics: true, marketing: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ analytics: true, marketing: false, decided: true });
    unsubscribe();
    saveConsent({ analytics: false, marketing: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('notifies even when values are unchanged', () => {
    saveConsent({ analytics: true, marketing: true });
    const listener = vi.fn();
    subscribeConsent(listener);
    saveConsent({ analytics: true, marketing: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a throwing listener does not stop the others', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    subscribeConsent(bad);
    subscribeConsent(good);
    expect(() => saveConsent({ analytics: true, marketing: false })).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('cross-tab sync', () => {
  test('storage event re-reads storage and notifies', () => {
    getConsentState();
    const listener = vi.fn();
    subscribeConsent(listener);
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        version: CONSENT_POLICY_VERSION,
        analytics: true,
        marketing: true,
        decidedAt: '2026-11-27T00:00:00.000Z',
      }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    expect(getConsentState()).toEqual({ analytics: true, marketing: true, decided: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('storage event for another key is ignored', () => {
    getConsentState();
    const listener = vi.fn();
    subscribeConsent(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(listener).not.toHaveBeenCalled();
  });
});
