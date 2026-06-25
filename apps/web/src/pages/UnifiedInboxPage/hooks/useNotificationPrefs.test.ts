import { describe, it, expect } from 'vitest';
import { computeIsMuted } from './useNotificationPrefs';

describe('computeIsMuted', () => {
  it('mutes everything when muteAll is on', () => {
    expect(computeIsMuted(true, new Set(), 'roomA')).toBe(true);
  });
  it('mutes only the listed room when muteAll is off', () => {
    expect(computeIsMuted(false, new Set(['roomA']), 'roomA')).toBe(true);
    expect(computeIsMuted(false, new Set(['roomA']), 'roomB')).toBe(false);
  });
  it('is not muted with no prefs', () => {
    expect(computeIsMuted(false, new Set(), 'roomA')).toBe(false);
  });
});
