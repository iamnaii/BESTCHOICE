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

  it('OWNER shop sections have exact expected keys (regression guard)', () => {
    const keys = getSidebarForRole('OWNER', 'shop').map((s) => s.key);
    expect(keys).toEqual([
      'owner-inventory',
      'owner-sales',
      'owner-aftersales',
      'owner-online-shop',
      'owner-shop-accounting',
      'owner-marketing',
    ]);
  });

  it('OWNER fin sections include all FIN-zone keys (regression guard)', () => {
    const keys = getSidebarForRole('OWNER', 'fin').map((s) => s.key);
    // Union of all FIN zone sections (SP5 + P4 SP1-5)
    expect(keys).toContain('owner-overview');
    expect(keys).toContain('owner-fin-collection');
    expect(keys).toContain('owner-fin-revenue');
    expect(keys).toContain('owner-fin-expense');
    expect(keys).toContain('owner-tax');
    expect(keys).toContain('owner-accounting');
    expect(keys).toContain('owner-reports');
    expect(keys).toContain('owner-bank');
    expect(keys).toContain('owner-doc-config');
    expect(keys).toContain('owner-fin-integrations');
    expect(keys).toContain('owner-fin-notifications');
  });

  it('OWNER settings sections have expected keys', () => {
    const keys = getSidebarForRole('OWNER', 'settings').map((s) => s.key);
    // owner-doc-config moved to FIN zone per CSV §8
    expect(keys).toContain('owner-settings');
    expect(keys).toContain('owner-settings-extra');
  });

  it('FINANCE_MANAGER fin sections include payments (regression for fm-payments zone fix)', () => {
    const sections = getSidebarForRole('FINANCE_MANAGER', 'fin');
    const allPaths = sections.flatMap((s) => s.items.map((i) => i.path));
    expect(allPaths).toContain('/payments');
    expect(allPaths).toContain('/contracts');
  });

  it('ACCOUNTANT fin sections include doc-config and bank', () => {
    const keys = getSidebarForRole('ACCOUNTANT', 'fin').map((s) => s.key);
    expect(keys).toContain('acc-doc-config');
    expect(keys).toContain('acc-bank');
  });
});
