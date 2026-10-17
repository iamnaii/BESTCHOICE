import { describe, expect, it } from 'vitest';
import {
  accessibleBranchIds,
  canAccess,
  DEFAULT_ACCESS_POSITIONS,
  isAssignablePermissionKey,
  isPermissionKey,
  PERMISSION_CATALOG,
  type AccessGrant,
  type AccessResource,
  type AccessSnapshot,
  type PermissionKey,
} from './employee-access';

const grant = (
  permissions: readonly PermissionKey[],
  overrides: Partial<AccessGrant> = {},
): AccessGrant => ({
  positionId: 'position-1',
  permissions,
  company: 'SHOP',
  scope: 'BRANCHES',
  branchIds: ['A'],
  ...overrides,
});
const snapshot = (
  grants: readonly AccessGrant[] = [],
  overrides: Partial<AccessSnapshot> = {},
): AccessSnapshot => ({
  userId: 'staff-1',
  isOwner: false,
  managed: true,
  revision: 1,
  grants,
  ...overrides,
});
const shopA: AccessResource = { company: 'SHOP', branchId: 'A' };
const shopB: AccessResource = { company: 'SHOP', branchId: 'B' };

// These tests catch flattening (permissions × branches) instead of evaluating each tuple.
describe('scoped employee access', () => {
  it('lets a manager in A sell in B without approving discounts in B', () => {
    const user = snapshot([
      grant(['sales.read', 'discounts.approve']),
      grant(['sales.read', 'sales.create'], { positionId: 'sales', branchIds: ['B'] }),
    ]);
    expect(canAccess(user, 'discounts.approve', shopA)).toBe(true);
    expect(canAccess(user, 'sales.create', shopB)).toBe(true);
    expect(canAccess(user, 'discounts.approve', shopB)).toBe(false);
    expect(accessibleBranchIds(user, 'discounts.approve', 'SHOP')).toEqual(['A']);
  });

  it('does not combine accountant A cost rights with sales B scope', () => {
    const user = snapshot([
      grant(['sensitive.cost.read', 'sensitive.profit.read']),
      grant(['sales.read'], { branchIds: ['B'] }),
    ]);
    expect(canAccess(user, 'sensitive.cost.read', shopA)).toBe(true);
    expect(canAccess(user, 'sensitive.cost.read', shopB)).toBe(false);
    expect(canAccess(user, 'sensitive.profit.read', shopB)).toBe(false);
  });

  it('keeps SHOP and FINANCE isolated even with matching branch IDs', () => {
    const user = snapshot([grant(['customers.read'])]);
    expect(canAccess(user, 'customers.read', shopA)).toBe(true);
    expect(canAccess(user, 'customers.read', { company: 'FINANCE', branchId: 'A' })).toBe(false);
    expect(accessibleBranchIds(user, 'customers.read', 'FINANCE')).toEqual([]);
  });

  it('denies empty branch scopes and branchless resources', () => {
    expect(
      canAccess(snapshot([grant(['sales.read'], { branchIds: [] })]), 'sales.read', shopA),
    ).toBe(false);
    expect(canAccess(snapshot([grant(['sales.read'])]), 'sales.read', { company: 'SHOP' })).toBe(
      false,
    );
    expect(
      accessibleBranchIds(
        snapshot([grant(['sales.read'], { branchIds: [] })]),
        'sales.read',
        'SHOP',
      ),
    ).toEqual([]);
  });

  it('requires explicit COMPANY grants for central or company-wide access', () => {
    const central = snapshot([
      grant(['payments.read'], { company: 'FINANCE', scope: 'COMPANY', branchIds: [] }),
    ]);
    expect(canAccess(central, 'payments.read', { company: 'FINANCE' })).toBe(true);
    expect(canAccess(central, 'payments.read', { company: 'SHOP' })).toBe(false);
    expect(accessibleBranchIds(central, 'payments.read', 'FINANCE')).toBe('ALL');
    expect(accessibleBranchIds(central, 'payments.create', 'FINANCE')).toEqual([]);
  });

  it('allows assigned central cases only when the current staff member owns the case', () => {
    const user = snapshot([
      grant(['collections.read'], { company: 'FINANCE', scope: 'ASSIGNED', branchIds: [] }),
    ]);
    expect(
      canAccess(user, 'collections.read', { company: 'FINANCE', assignedUserIds: ['staff-1'] }),
    ).toBe(true);
    expect(
      canAccess(user, 'collections.read', { company: 'FINANCE', assignedUserIds: ['other'] }),
    ).toBe(false);
    expect(canAccess(user, 'collections.read', { company: 'FINANCE' })).toBe(false);
    expect(
      canAccess(user, 'collections.read', { company: 'SHOP', assignedUserIds: ['staff-1'] }),
    ).toBe(false);
    // A branch-only query cannot express record ownership; never widen assigned access.
    expect(accessibleBranchIds(user, 'collections.read', 'FINANCE')).toEqual([]);
  });

  it('applies an assigned grant branch filter in addition to record ownership', () => {
    const user = snapshot([grant(['collections.read'], { scope: 'ASSIGNED' })]);
    expect(canAccess(user, 'collections.read', { ...shopA, assignedUserIds: ['staff-1'] })).toBe(
      true,
    );
    expect(canAccess(user, 'collections.read', { ...shopB, assignedUserIds: ['staff-1'] })).toBe(
      false,
    );
    expect(
      canAccess(user, 'collections.read', { company: 'SHOP', assignedUserIds: ['staff-1'] }),
    ).toBe(false);
    expect(canAccess(user, 'collections.read', { ...shopA, assignedUserIds: [] })).toBe(false);
    expect(accessibleBranchIds(user, 'collections.read', 'SHOP')).toEqual([]);
  });

  it('unions matching branch grants without broadening permission or mutating tuples', () => {
    const user = snapshot([
      grant(['sales.read'], { branchIds: ['B', 'A', 'B'] }),
      grant(['sales.read'], { branchIds: ['C'] }),
    ]);
    const before = JSON.stringify(user);
    expect(accessibleBranchIds(user, 'sales.read', 'SHOP')).toEqual(['B', 'A', 'C']);
    expect(accessibleBranchIds(user, 'discounts.approve', 'SHOP')).toEqual([]);
    expect(JSON.stringify(user)).toBe(before);
  });

  it('uses current permissions and does not cache a prior authorization', () => {
    const user = snapshot([grant(['sales.read'])]);
    expect(canAccess(user, 'sales.read', shopA)).toBe(true);
    expect(canAccess({ ...user, revision: 2, grants: [] }, 'sales.read', shopA)).toBe(false);
  });

  it('does not silently interpret unmanaged snapshots as legacy authorization', () => {
    const user = snapshot([grant(['sales.read'])], { managed: false });
    expect(canAccess(user, 'sales.read', shopA)).toBe(false);
    expect(accessibleBranchIds(user, 'sales.read', 'SHOP')).toEqual([]);
  });

  it('allows all active staff safe activity summaries without allowing source details or exports', () => {
    const user = snapshot([], { managed: false });
    expect(canAccess(user, 'activity.read', { company: 'SHOP' })).toBe(true);
    expect(canAccess(user, 'activity.read', { company: 'FINANCE' })).toBe(true);
    expect(canAccess(user, 'sales.read', shopA)).toBe(false);
    expect(canAccess(user, 'activity.export', shopA)).toBe(false);
    expect(canAccess(snapshot([], { userId: '' }), 'activity.read', shopA)).toBe(false);
  });

  it.each([
    'users.manage',
    'positions.manage',
    'assignments.manage',
    'sales.cancel.approve',
    'refunds.approve',
    'interest-reductions.approve',
    'penalty-waivers.approve',
  ] as const)(
    'reserves %s to the persisted owner flag, never position IDs or grants',
    (permission) => {
      const forged = snapshot([grant([permission], { positionId: 'OWNER', scope: 'COMPANY' })]);
      expect(canAccess(forged, permission, shopA)).toBe(false);
      expect(accessibleBranchIds(forged, permission, 'SHOP')).toEqual([]);
      expect(isAssignablePermissionKey(permission)).toBe(false);
      expect(canAccess(snapshot([], { isOwner: true }), permission, shopA)).toBe(true);
    },
  );

  it.each(['unknown.read', '*', 'constructor', '__proto__', 'activity.delete', 'activity.update'])(
    'rejects unknown permission %s even for owners',
    (permission) => {
      expect(isPermissionKey(permission)).toBe(false);
      expect(isAssignablePermissionKey(permission)).toBe(false);
      expect(canAccess(snapshot([], { isOwner: true }), permission, shopA)).toBe(false);
      expect(accessibleBranchIds(snapshot([], { isOwner: true }), permission, 'SHOP')).toEqual([]);
    },
  );

  it('fails closed when runtime company/resource/scope context is missing or invalid', () => {
    const owner = snapshot([], { isOwner: true });
    for (const resource of [undefined, {}, { company: 'OTHER' }]) {
      expect(canAccess(owner, 'sales.read', resource as AccessResource)).toBe(false);
    }
    expect(
      canAccess(
        snapshot([grant(['sales.read'], { scope: 'INVALID' as AccessGrant['scope'] })]),
        'sales.read',
        shopA,
      ),
    ).toBe(false);
    expect(accessibleBranchIds(owner, 'sales.read', 'OTHER' as AccessResource['company'])).toEqual(
      [],
    );
  });
});

describe('position defaults are editable templates, not runtime role allowlists', () => {
  it.each([
    ['OWNER', true, true],
    ['ACCOUNTANT', true, true],
    ['PURCHASING', true, false],
    ['BRANCH_MANAGER', false, false],
    ['SALES', false, false],
    ['STOCK', false, false],
    ['FINANCE', false, false],
    ['FINANCE_MANAGER', false, false],
    ['COLLECTIONS', false, false],
  ] as const)('%s has the agreed cost/profit defaults', (code, cost, profit) => {
    const position = DEFAULT_ACCESS_POSITIONS.find((item) => item.code === code)!;
    expect(position).toBeDefined();
    const user = snapshot([grant(position.permissions, { positionId: code })], {
      isOwner: code === 'OWNER',
    });
    expect(canAccess(user, 'sensitive.cost.read', shopA)).toBe(cost);
    expect(canAccess(user, 'sensitive.profit.read', shopA)).toBe(profit);
    expect(canAccess(user, 'sensitive.salary.read', shopA)).toBe(code === 'OWNER');
  });

  it('allows cost/profit/salary to be added to any scoped position and revoked from accountant', () => {
    const changedSales = snapshot([
      grant(['sensitive.cost.read', 'sensitive.profit.read', 'sensitive.salary.read'], {
        positionId: 'SALES',
      }),
    ]);
    for (const permission of [
      'sensitive.cost.read',
      'sensitive.profit.read',
      'sensitive.salary.read',
    ]) {
      expect(isAssignablePermissionKey(permission)).toBe(true);
      expect(canAccess(changedSales, permission, shopA)).toBe(true);
      expect(canAccess(changedSales, permission, shopB)).toBe(false);
      expect(
        canAccess(snapshot([grant([], { positionId: 'ACCOUNTANT' })]), permission, shopA),
      ).toBe(false);
    }
  });

  it('cannot bootstrap owner authority by assigning the owner template', () => {
    const ownerTemplate = DEFAULT_ACCESS_POSITIONS.find((item) => item.code === 'OWNER')!;
    expect(ownerTemplate.assignable).toBe(false);
    expect(
      canAccess(
        snapshot([grant(ownerTemplate.permissions, { positionId: 'OWNER' })]),
        'users.manage',
        shopA,
      ),
    ).toBe(false);
    for (const position of DEFAULT_ACCESS_POSITIONS.filter((item) => item.assignable)) {
      expect(position.permissions.every(isAssignablePermissionKey)).toBe(true);
    }
  });

  it('separates draft accounting from posting, reversal and closing permissions', () => {
    const accountant = DEFAULT_ACCESS_POSITIONS.find((item) => item.code === 'ACCOUNTANT')!;
    const user = snapshot([grant(accountant.permissions)]);
    expect(canAccess(user, 'journal.create', shopA)).toBe(true);
    expect(canAccess(user, 'journal.approve', shopA)).toBe(false);
    expect(canAccess(user, 'journal.post', shopA)).toBe(false);
    expect(canAccess(user, 'journal.reverse', shopA)).toBe(false);
    expect(canAccess(user, 'accounting.close', shopA)).toBe(false);
  });

  it('separates refund execution and discount approval from reserved approvals', () => {
    const finance = DEFAULT_ACCESS_POSITIONS.find((item) => item.code === 'FINANCE')!;
    const manager = DEFAULT_ACCESS_POSITIONS.find((item) => item.code === 'BRANCH_MANAGER')!;
    expect(canAccess(snapshot([grant(finance.permissions)]), 'refunds.execute', shopA)).toBe(true);
    expect(canAccess(snapshot([grant(finance.permissions)]), 'refunds.approve', shopA)).toBe(false);
    expect(canAccess(snapshot([grant(manager.permissions)]), 'discounts.approve', shopA)).toBe(
      true,
    );
    expect(canAccess(snapshot([grant(manager.permissions)]), 'refunds.execute', shopA)).toBe(false);
  });

  it('provides Thai catalog labels, group metadata and distinct known keys for the editor', () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThan(0);
    expect(new Set(PERMISSION_CATALOG.map((item) => item.key)).size).toBe(
      PERMISSION_CATALOG.length,
    );
    for (const permission of PERMISSION_CATALOG) {
      expect(isPermissionKey(permission.key)).toBe(true);
      expect(permission.label).toMatch(/[ก-๙]/);
      expect(permission.groupLabel).toMatch(/[ก-๙]/);
      expect(permission.group).not.toBe('');
    }
  });
});
