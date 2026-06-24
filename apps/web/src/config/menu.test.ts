import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole, resolveZoneForPath } from './menu';

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
    // owner-fin-collection removed — collection links merged into owner-fin-revenue
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
    // owner-ai removed (P3 collapse — reachable via settings panel)
    expect(keys).not.toContain('owner-ai');
  });

  it('OWNER settings zone contains panel entry + operational quick-links (P3 collapse)', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    const allPaths = sections.flatMap((s) => s.items.map((i) => i.path));
    // Must contain the panel entry and operational paths
    expect(allPaths).toContain('/settings');
    expect(allPaths).toContain('/users');
    expect(allPaths).toContain('/branches');
    // Must NOT contain config deep-links (now reachable only via the panel)
    expect(allPaths).not.toContain('/settings/ai/admin');
    expect(allPaths).not.toContain('/settings/finance/gfin');
    expect(allPaths).not.toContain('/settings/access/account-roles');
    expect(allPaths).not.toContain('/settings/products/pricing');
    expect(allPaths).not.toContain('/settings/company/entities');
  });

  it('OWNER settings owner-settings items match collapsed list exactly (P3)', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    const settingsSection = sections.find((s) => s.key === 'owner-settings');
    expect(settingsSection).toBeDefined();
    const paths = settingsSection!.items.map((i) => i.path);
    expect(paths).toEqual([
      '/settings',
      '/users',
      '/branches',
      '/contract-templates',
      '/promotions',
      '/pdpa',
    ]);
  });

  it('PDPA label is disambiguated in owner-settings (P3)', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    const settingsSection = sections.find((s) => s.key === 'owner-settings');
    const pdpaItem = settingsSection?.items.find((i) => i.path === '/pdpa');
    expect(pdpaItem?.label).toBe('PDPA (คำยินยอม/DSAR)');
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

describe('VIEWER role (Owner Q4 2026-05-17)', () => {
  it('VIEWER zone config is fin-only with no settings gear', () => {
    const cfg = getZoneConfigForRole('VIEWER');
    expect(cfg).toBeDefined();
    expect(cfg?.zones).toEqual(['fin']);
    expect(cfg?.defaultZone).toBe('fin');
    expect(cfg?.showSettingsGear).toBe(false);
  });

  it('VIEWER + fin returns the 4 expected read-only sections', () => {
    const keys = getSidebarForRole('VIEWER', 'fin').map((s) => s.key);
    expect(keys).toEqual([
      'viewer-accounting',
      'viewer-reports',
      'viewer-shop-accounting',
      'viewer-audit',
    ]);
  });

  it('VIEWER + shop returns empty (out of read-only scope)', () => {
    expect(getSidebarForRole('VIEWER', 'shop')).toEqual([]);
  });

  it('VIEWER + settings returns empty (no gear)', () => {
    expect(getSidebarForRole('VIEWER', 'settings')).toEqual([]);
  });

  it('VIEWER menu paths stay inside the Q4-approved scope', () => {
    const sections = getSidebarForRole('VIEWER', 'fin');
    const paths = sections.flatMap((s) => s.items.map((i) => i.path));
    // Every path must read /reports, /accounting/*, /audit-logs, /finance/*,
    // /profit-loss, /shop/accounting, or /financial-audit — all map to
    // backend GETs that PR #1036 wired with @Roles('VIEWER').
    const allowed = (p: string) =>
      p.startsWith('/reports') ||
      p.startsWith('/accounting') ||
      p === '/audit-logs' ||
      p.startsWith('/finance/') ||
      p === '/profit-loss' ||
      p === '/shop/accounting' ||
      p === '/financial-audit';
    expect(paths.every(allowed)).toBe(true);
  });
});

describe('Master data moved into settings zone (Option B, 2026-06-13)', () => {
  it('ข้อมูลหลัก section lives in the settings zone for OWNER/FM/ACC', () => {
    expect(getSidebarForRole('OWNER', 'settings').map((s) => s.key)).toContain('owner-fin-master');
    expect(getSidebarForRole('FINANCE_MANAGER', 'settings').map((s) => s.key)).toContain(
      'fm-fin-master',
    );
    expect(getSidebarForRole('ACCOUNTANT', 'settings').map((s) => s.key)).toContain('acc-fin-master');
  });

  it('ข้อมูลหลัก is no longer in the fin zone', () => {
    expect(getSidebarForRole('OWNER', 'fin').map((s) => s.key)).not.toContain('owner-fin-master');
    expect(getSidebarForRole('FINANCE_MANAGER', 'fin').map((s) => s.key)).not.toContain(
      'fm-fin-master',
    );
    expect(getSidebarForRole('ACCOUNTANT', 'fin').map((s) => s.key)).not.toContain('acc-fin-master');
  });

  it('FM/ACC now have settings-zone access (gear)', () => {
    expect(getZoneConfigForRole('FINANCE_MANAGER')?.showSettingsGear).toBe(true);
    expect(getZoneConfigForRole('ACCOUNTANT')?.showSettingsGear).toBe(true);
  });

  it('FM sees only ผู้ติดต่อ; ACC sees ผู้ติดต่อ เท่านั้น (พนักงาน tab ถูกรวมใน /users แล้ว)', () => {
    const fmPaths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    expect(fmPaths).toContain('/settings#contacts');
    expect(fmPaths).not.toContain('/settings#employees');

    const accPaths = getSidebarForRole('ACCOUNTANT', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    expect(accPaths).toContain('/settings#contacts');
    expect(accPaths).not.toContain('/settings#employees');
  });
});

describe('resolveZoneForPath — hash-aware (regression: FM/ACC must not bounce off /settings)', () => {
  it('/settings resolves to the settings zone for OWNER/FM/ACC', () => {
    expect(resolveZoneForPath('OWNER', '/settings')).toBe('settings');
    expect(resolveZoneForPath('FINANCE_MANAGER', '/settings')).toBe('settings');
    expect(resolveZoneForPath('ACCOUNTANT', '/settings')).toBe('settings');
  });

  it('non-hash fin-only paths still resolve to fin', () => {
    // /finance-portfolio is fin-only (the fin landing); proves the hash branch
    // didn't break plain-path resolution. (/payments lives in BOTH shop & fin
    // for FM, and shop wins the lookup order — that's pre-existing behavior.)
    expect(resolveZoneForPath('FINANCE_MANAGER', '/finance-portfolio')).toBe('fin');
  });

  it('SALES (no settings gear) does not resolve /settings', () => {
    expect(resolveZoneForPath('SALES', '/settings')).toBeNull();
  });

  it('a path not in any menu (e.g. standalone /contacts) returns null (pass-through)', () => {
    expect(resolveZoneForPath('OWNER', '/contacts')).toBeNull();
  });
});
