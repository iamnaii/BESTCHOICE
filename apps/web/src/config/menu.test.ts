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
    // owner-fin-integrations removed (dedupe 2026-06-24) — LINE OA + การเชื่อมต่อ both lived in the settings submenu
    expect(keys).not.toContain('owner-fin-integrations');
    expect(keys).toContain('owner-fin-notifications');
  });

  it('OWNER settings zone is a single registry-driven "settings" section (contacts moved inside it)', () => {
    const keys = getSidebarForRole('OWNER', 'settings').map((s) => s.key);
    // contacts is now an item inside the ตั้งค่าระบบ submenu — no separate master-data section
    expect(keys).toEqual(['settings']);
    expect(keys).not.toContain('owner-settings');
    expect(keys).not.toContain('owner-settings-extra');
    expect(keys).not.toContain('owner-fin-master');
  });

  it('OWNER settings zone paths: /contacts (first) + /settings/<catId> registry, single section', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    expect(sections).toHaveLength(1);
    const settingsSection = sections[0];
    expect(settingsSection.key).toBe('settings');
    const paths = settingsSection.items.map((i) => i.path);
    // contacts is the first item, then every other item is /settings/<categoryId>
    expect(paths[0]).toBe('/contacts');
    expect(paths.filter((p) => p !== '/contacts').every((p) => p.startsWith('/settings/'))).toBe(true);
    // operational quick-links removed (now inside the panel)
    expect(paths).not.toContain('/users');
    expect(paths).not.toContain('/branches');
    expect(paths).not.toContain('/settings');  // bare root not listed
    // all 9 registry categories visible to OWNER
    expect(paths).toContain('/settings/company');
    expect(paths).toContain('/settings/access');
    expect(paths).toContain('/settings/accounting');
    expect(paths).toContain('/settings/finance');
    expect(paths).toContain('/settings/products');
    expect(paths).toContain('/settings/comms');
    expect(paths).toContain('/settings/ai');
    expect(paths).toContain('/settings/integrations');
    expect(paths).toContain('/settings/system');
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

describe('Master data moved into settings zone (Option B, 2026-06-13) — now registry-driven (P5) + own group (P6)', () => {
  it('settings zone for OWNER/FM/ACC is a single "settings" section (contacts is an item within it)', () => {
    // contacts moved INSIDE the ตั้งค่าระบบ submenu — one section, no separate master-data group
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

  it('FM/ACC settings zone includes /contacts (inside the settings submenu) — company registry no longer visible', () => {
    const fmPaths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    // /contacts is an item inside the settings submenu; /settings/company NOT in registry (contacts removed → company is OWNER-only)
    expect(fmPaths).toContain('/contacts');
    expect(fmPaths).not.toContain('/settings/company');
    expect(fmPaths).not.toContain('/settings#contacts');  // old hash-link gone

    const accPaths = getSidebarForRole('ACCOUNTANT', 'settings').flatMap((s) =>
      s.items.map((i) => i.path),
    );
    expect(accPaths).toContain('/contacts');
    expect(accPaths).not.toContain('/settings/company');
    expect(accPaths).not.toContain('/settings#contacts');  // old hash-link gone
  });
});

describe('P5 Task 1 — registry-driven settings-zone sidebar (updated for P6)', () => {
  it('OWNER settings zone = one "ตั้งค่าระบบ" section: /contacts (first) + registry categories (9) as /settings/<cat>', () => {
    const secs = getSidebarForRole('OWNER', 'settings');
    // contacts now lives INSIDE the ตั้งค่าระบบ submenu (single section), not a separate group
    expect(secs).toHaveLength(1);
    const settingsSec = secs[0];
    expect(settingsSec.key).toBe('settings');
    const paths = settingsSec.items.map((i) => i.path);
    expect(paths[0]).toBe('/contacts');         // รายชื่อผู้ติดต่อ is the first item
    expect(paths).toContain('/settings/company');
    expect(paths).toContain('/settings/system');
    expect(paths).not.toContain('/users');      // operational no longer a sidebar quick-link
    expect(paths).not.toContain('/settings');   // bare panel root not listed; categories are
    // every non-contacts item is a /settings/<cat> path
    expect(paths.filter((p) => p !== '/contacts').every((p) => p.startsWith('/settings/'))).toBe(true);
  });

  it('FINANCE_MANAGER settings zone = /contacts + visible categories (subset, no AI, no company)', () => {
    const paths = getSidebarForRole('FINANCE_MANAGER', 'settings').flatMap((s) => s.items.map((i) => i.path));
    expect(paths).toContain('/contacts');             // inside the settings submenu
    expect(paths).not.toContain('/settings/company'); // contacts removed → company is OWNER-only
    expect(paths).not.toContain('/settings/ai');      // OWNER-only
  });

  it('resolveZoneForPath maps any /settings/* to settings zone (OWNER)', () => {
    expect(resolveZoneForPath('OWNER', '/settings/accounting')).toBe('settings');
    expect(resolveZoneForPath('OWNER', '/settings/accounting/chart')).toBe('settings');
  });
});

describe('FM/ACC bottomNav contacts shortcut — stale hash fix (2026-06-24)', () => {
  it('FM/ACC bottomNav settings zone does not contain stale /settings#contacts', () => {
    for (const role of ['FINANCE_MANAGER', 'ACCOUNTANT']) {
      const bn = getZoneConfigForRole(role)?.bottomNav.settings ?? [];
      const paths = bn.map((i) => i.path);
      expect(paths).not.toContain('/settings#contacts');
    }
  });

  it('FM bottomNav contacts shortcut now points to /contacts', () => {
    const bn = getZoneConfigForRole('FINANCE_MANAGER')?.bottomNav.settings ?? [];
    const paths = bn.map((i) => i.path);
    expect(paths).toContain('/contacts');
  });

  it('ACC bottomNav contacts shortcut now points to /contacts', () => {
    const bn = getZoneConfigForRole('ACCOUNTANT')?.bottomNav.settings ?? [];
    const paths = bn.map((i) => i.path);
    expect(paths).toContain('/contacts');
  });
});

describe('contacts inside settings submenu — รายชื่อผู้ติดต่อ → /contacts (2026-06-24)', () => {
  it('OWNER settings zone is a single "ตั้งค่าระบบ" section with รายชื่อผู้ติดต่อ as the first item', () => {
    const secs = getSidebarForRole('OWNER', 'settings');
    expect(secs).toHaveLength(1);
    expect(secs[0].key).toBe('settings');
    expect(secs[0].items[0]).toMatchObject({ label: 'รายชื่อผู้ติดต่อ', path: '/contacts' });
  });
  it('FM/ACC also get /contacts inside the settings submenu', () => {
    for (const r of ['FINANCE_MANAGER', 'ACCOUNTANT']) {
      const paths = getSidebarForRole(r, 'settings').flatMap((s) => s.items.map((i) => i.path));
      expect(paths).toContain('/contacts');
    }
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

  it('/contacts resolves to settings zone for OWNER (item inside the settings submenu)', () => {
    // /contacts is the first item inside the ตั้งค่าระบบ submenu (settings zone)
    expect(resolveZoneForPath('OWNER', '/contacts')).toBe('settings');
  });
});
