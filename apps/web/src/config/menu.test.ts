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

  it('OWNER + settings returns registry-driven settings sections', () => {
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

  it('OWNER settings zone is now registry-driven (P5): one section keyed "settings"', () => {
    const keys = getSidebarForRole('OWNER', 'settings').map((s) => s.key);
    // P5: old static keys removed; replaced by single registry section
    expect(keys).toEqual(['settings']);
    expect(keys).not.toContain('owner-settings');
    expect(keys).not.toContain('owner-settings-extra');
    expect(keys).not.toContain('owner-fin-master');
  });

  it('OWNER settings zone paths are all /settings/<catId> (P5 registry-driven)', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    const allPaths = sections.flatMap((s) => s.items.map((i) => i.path));
    // All paths are /settings/<categoryId> — registry-driven
    expect(allPaths.every((p) => p.startsWith('/settings/'))).toBe(true);
    // operational quick-links removed (now inside the panel)
    expect(allPaths).not.toContain('/users');
    expect(allPaths).not.toContain('/branches');
    expect(allPaths).not.toContain('/settings');  // bare root not listed
    // all 8 registry categories visible to OWNER
    expect(allPaths).toContain('/settings/company');
    expect(allPaths).toContain('/settings/access');
    expect(allPaths).toContain('/settings/accounting');
    expect(allPaths).toContain('/settings/finance');
    expect(allPaths).toContain('/settings/products');
    expect(allPaths).toContain('/settings/comms');
    expect(allPaths).toContain('/settings/ai');
    expect(allPaths).toContain('/settings/system');
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

describe('Master data moved into settings zone (Option B, 2026-06-13) — now registry-driven (P5)', () => {
  it('settings zone for OWNER/FM/ACC is registry-driven (single section keyed "settings")', () => {
    // P5: old static "ข้อมูลหลัก" sections replaced by registry-driven section
    expect(getSidebarForRole('OWNER', 'settings').map((s) => s.key)).toEqual(['settings']);
    expect(getSidebarForRole('FINANCE_MANAGER', 'settings').map((s) => s.key)).toEqual(['settings']);
    expect(getSidebarForRole('ACCOUNTANT', 'settings').map((s) => s.key)).toEqual(['settings']);
  });

  it('ข้อมูลหลัก static sections no longer exist in any zone', () => {
    // Removed in P5 — contacts now reachable via /settings/company
    expect(getSidebarForRole('OWNER', 'fin').map((s) => s.key)).not.toContain('owner-fin-master');
    expect(getSidebarForRole('FINANCE_MANAGER', 'fin').map((s) => s.key)).not.toContain('fm-fin-master');
    expect(getSidebarForRole('ACCOUNTANT', 'fin').map((s) => s.key)).not.toContain('acc-fin-master');
    expect(getSidebarForRole('OWNER', 'settings').map((s) => s.key)).not.toContain('owner-fin-master');
    expect(getSidebarForRole('FINANCE_MANAGER', 'settings').map((s) => s.key)).not.toContain('fm-fin-master');
    expect(getSidebarForRole('ACCOUNTANT', 'settings').map((s) => s.key)).not.toContain('acc-fin-master');
  });

  it('FM/ACC still have settings-zone access (gear)', () => {
    expect(getZoneConfigForRole('FINANCE_MANAGER')?.showSettingsGear).toBe(true);
    expect(getZoneConfigForRole('ACCOUNTANT')?.showSettingsGear).toBe(true);
  });

  it('FM/ACC settings zone includes /settings/company (contacts reachable via registry)', () => {
    const fmPaths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    // contacts is now under /settings/company (registry-driven)
    expect(fmPaths).toContain('/settings/company');
    expect(fmPaths).not.toContain('/settings#contacts');  // old hash-link gone

    const accPaths = getSidebarForRole('ACCOUNTANT', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    expect(accPaths).toContain('/settings/company');
    expect(accPaths).not.toContain('/settings#contacts');  // old hash-link gone
  });
});

describe('P5 Task 1 — registry-driven settings-zone sidebar', () => {
  it('OWNER settings zone = registry categories (8), as links to /settings/<cat>', () => {
    const secs = getSidebarForRole('OWNER', 'settings');
    const paths = secs.flatMap((s) => s.items.map((i) => i.path));
    expect(paths).toContain('/settings/company');
    expect(paths).toContain('/settings/system');
    expect(paths.every((p) => p.startsWith('/settings/'))).toBe(true);
    expect(paths).not.toContain('/users');      // operational no longer a sidebar quick-link
    expect(paths).not.toContain('/settings');   // bare panel root not listed; categories are
  });

  it('FINANCE_MANAGER settings zone = its visible categories (subset, no AI)', () => {
    const paths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) => s.items.map((i) => i.path));
    expect(paths).toContain('/settings/company');     // contacts
    expect(paths).not.toContain('/settings/ai');      // OWNER-only
  });

  it('resolveZoneForPath maps any /settings/* to settings zone (OWNER)', () => {
    expect(resolveZoneForPath('OWNER', '/settings/accounting')).toBe('settings');
    expect(resolveZoneForPath('OWNER', '/settings/accounting/chart')).toBe('settings');
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
