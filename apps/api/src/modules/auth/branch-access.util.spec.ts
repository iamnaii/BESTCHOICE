import {
  CROSS_BRANCH_ROLES,
  getBranchScope,
  hasCrossBranchAccess,
} from './branch-access.util';

describe('branch-access.util', () => {
  describe('CROSS_BRANCH_ROLES', () => {
    it('contains exactly OWNER, FINANCE_MANAGER, ACCOUNTANT', () => {
      expect(CROSS_BRANCH_ROLES.has('OWNER')).toBe(true);
      expect(CROSS_BRANCH_ROLES.has('FINANCE_MANAGER')).toBe(true);
      expect(CROSS_BRANCH_ROLES.has('ACCOUNTANT')).toBe(true);
      expect(CROSS_BRANCH_ROLES.size).toBe(3);
    });

    it('does NOT include branch-scoped roles', () => {
      expect(CROSS_BRANCH_ROLES.has('SALES')).toBe(false);
      expect(CROSS_BRANCH_ROLES.has('BRANCH_MANAGER')).toBe(false);
    });
  });

  describe('hasCrossBranchAccess', () => {
    it.each([['OWNER'], ['FINANCE_MANAGER'], ['ACCOUNTANT']])(
      'returns true for %s',
      (role) => {
        expect(hasCrossBranchAccess({ role })).toBe(true);
      },
    );

    it.each([['SALES'], ['BRANCH_MANAGER']])(
      'returns false for branch-scoped role %s',
      (role) => {
        expect(hasCrossBranchAccess({ role })).toBe(false);
      },
    );

    it('returns false for null / undefined input', () => {
      expect(hasCrossBranchAccess(null)).toBe(false);
      expect(hasCrossBranchAccess(undefined)).toBe(false);
    });

    it('returns false when role is missing from the object', () => {
      expect(hasCrossBranchAccess({})).toBe(false);
      expect(hasCrossBranchAccess({ role: undefined })).toBe(false);
      expect(hasCrossBranchAccess({ role: null })).toBe(false);
    });

    it('returns false for an unknown role string', () => {
      expect(hasCrossBranchAccess({ role: 'SUPERADMIN' })).toBe(false);
      expect(hasCrossBranchAccess({ role: '' })).toBe(false);
    });
  });

  describe('getBranchScope', () => {
    it.each([['OWNER'], ['FINANCE_MANAGER'], ['ACCOUNTANT']])(
      'returns { all: true } for cross-branch role %s',
      (role) => {
        expect(getBranchScope({ role, branchId: null })).toEqual({ all: true });
      },
    );

    it('returns branchId for branch-scoped role with an assigned branch', () => {
      expect(getBranchScope({ role: 'SALES', branchId: 'br-1' })).toEqual({ branchId: 'br-1' });
      expect(getBranchScope({ role: 'BRANCH_MANAGER', branchId: 'br-2' })).toEqual({
        branchId: 'br-2',
      });
    });

    it('returns branchId: null for branch-scoped role with no assigned branch (defensive)', () => {
      expect(getBranchScope({ role: 'SALES', branchId: null })).toEqual({ branchId: null });
      expect(getBranchScope({ role: 'SALES' })).toEqual({ branchId: null });
    });

    it('returns branchId: null for null / undefined input (defensive)', () => {
      expect(getBranchScope(null)).toEqual({ branchId: null });
      expect(getBranchScope(undefined)).toEqual({ branchId: null });
    });
  });
});
