import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole } from './menu';

describe('getSidebarForRole — empty ZONE_CONFIG fallback', () => {
  it('returns empty array for unknown role', () => {
    expect(getSidebarForRole('UNKNOWN_ROLE', 'shop')).toEqual([]);
  });

  it('returns sections for known role (OWNER after ZONE_CONFIG populated)', () => {
    expect(getSidebarForRole('OWNER', 'shop').length).toBeGreaterThan(0);
  });

  it('OWNER settings zone returns settings sections (has gear)', () => {
    expect(getSidebarForRole('OWNER', 'settings').length).toBeGreaterThan(0);
  });

  it('returns undefined zone config for unknown role', () => {
    expect(getZoneConfigForRole('UNKNOWN_ROLE')).toBeUndefined();
  });

  it('returns config for known roles after ZONE_CONFIG populated', () => {
    expect(getZoneConfigForRole('OWNER')).toBeDefined();
    expect(getZoneConfigForRole('SALES')).toBeDefined();
  });
});

describe('getSidebarForRole — populated ZONE_CONFIG', () => {
  it('OWNER + shop returns sections all tagged shop', () => {
    const sections = getSidebarForRole('OWNER', 'shop');
    expect(sections.length).toBeGreaterThan(3);
    expect(sections.every((s) => s.zone === 'shop')).toBe(true);
  });

  it('OWNER + fin returns sections all tagged fin', () => {
    const sections = getSidebarForRole('OWNER', 'fin');
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => s.zone === 'fin')).toBe(true);
  });

  it('OWNER + settings returns settings sections', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every((s) => s.zone === 'settings')).toBe(true);
  });

  it('SALES + shop returns sales sections', () => {
    const sections = getSidebarForRole('SALES', 'shop');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('SALES + fin returns empty (no access)', () => {
    expect(getSidebarForRole('SALES', 'fin')).toEqual([]);
  });

  it('SALES + settings returns empty (no gear)', () => {
    expect(getSidebarForRole('SALES', 'settings')).toEqual([]);
  });

  it('ACCOUNTANT + shop returns empty', () => {
    expect(getSidebarForRole('ACCOUNTANT', 'shop')).toEqual([]);
  });

  it('ACCOUNTANT + fin returns accounting sections', () => {
    const sections = getSidebarForRole('ACCOUNTANT', 'fin');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('getZoneConfigForRole returns config for known roles', () => {
    expect(getZoneConfigForRole('OWNER')).toBeDefined();
    expect(getZoneConfigForRole('SALES')).toBeDefined();
    expect(getZoneConfigForRole('OWNER')?.showSettingsGear).toBe(true);
    expect(getZoneConfigForRole('SALES')?.showSettingsGear).toBe(false);
  });
});
