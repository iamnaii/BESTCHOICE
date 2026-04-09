import { CROSS_BRANCH_ROLES, hasCrossBranchAccess } from './branch-access.util';

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
});
