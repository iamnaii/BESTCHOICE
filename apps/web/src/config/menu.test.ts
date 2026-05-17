import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole } from './menu';

describe('getSidebarForRole — empty ZONE_CONFIG fallback', () => {
  it('returns empty array for unknown role', () => {
    expect(getSidebarForRole('UNKNOWN_ROLE', 'shop')).toEqual([]);
  });

  it('returns empty array for currently-empty OWNER (Task 6 will populate)', () => {
    // ZONE_CONFIG is empty in PR-1, so even OWNER returns []
    expect(getSidebarForRole('OWNER', 'shop')).toEqual([]);
  });

  it('returns empty array for settings zone (no roles have gear yet)', () => {
    expect(getSidebarForRole('OWNER', 'settings')).toEqual([]);
  });

  it('returns undefined zone config for unknown role', () => {
    expect(getZoneConfigForRole('UNKNOWN_ROLE')).toBeUndefined();
  });

  it('returns undefined zone config for any role until Task 6 populates ZONE_CONFIG', () => {
    expect(getZoneConfigForRole('OWNER')).toBeUndefined();
    expect(getZoneConfigForRole('SALES')).toBeUndefined();
  });
});
