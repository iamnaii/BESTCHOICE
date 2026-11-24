import { describe, expect, it } from 'vitest';
import { PERMISSION_CATALOG, type EmployeeAccessContext } from '@installment/shared';
import type { AccessPosition, Assignment } from './api';
import {
  assignmentProblems,
  clonePosition,
  comparePermissions,
  permissionAdvisories,
  proposedGrants,
} from './preview';

const position: AccessPosition = {
  id: 'sales',
  code: 'SALES',
  name: 'ฝ่ายขาย',
  permissions: ['sales.read', 'sales.create'],
  isActive: true,
  revision: 4,
  affectedEmployeeCount: 2,
};
const finance: AccessPosition = {
  ...position,
  id: 'finance',
  code: 'FINANCE_POS',
  permissions: ['contracts.read'],
};
const context: EmployeeAccessContext = {
  companies: ['SHOP', 'FINANCE'],
  branches: [
    { id: 'shop', name: 'สาขาหน้าร้าน', companyCode: 'SHOP' },
    { id: 'other-shop', name: 'สาขาอื่น', companyCode: 'SHOP' },
    { id: 'finance', name: 'สาขาการเงิน', companyCode: 'FINANCE' },
  ],
};

describe('access review', () => {
  it('clones permissions under an available new code', () => {
    const clone = clonePosition(position, [position, { ...position, code: 'SALES_COPY' }]);
    expect(clone.code).toBe('SALES_COPY_2');
    expect(clone.permissions).toEqual(['sales.read', 'sales.create']);
  });

  it('shows added and removed permissions separately', () => {
    expect(comparePermissions(['sales.read', 'sales.create'], ['sales.read', 'contracts.read'])).toEqual({
      added: ['contracts.read'],
      removed: ['sales.create'],
    });
  });

  it('keeps independent position, work and branch tuples, including assigned-only access', () => {
    const assignments: Assignment[] = [
      { positionId: 'sales', company: 'SHOP', scope: 'BRANCHES', branchIds: ['shop'] },
      { positionId: 'finance', company: 'FINANCE', scope: 'ASSIGNED', branchIds: ['other-shop'] },
    ];
    expect(assignmentProblems(assignments, [position, finance], context)).toEqual([]);
    expect(proposedGrants(assignments, [position, finance])).toEqual([
      { ...assignments[0], permissions: ['sales.read', 'sales.create'] },
      { ...assignments[1], permissions: ['contracts.read'] },
    ]);
  });

  it('rejects empty branch scope, non-eligible branches, and duplicate tuples', () => {
    const base: Assignment = { positionId: 'sales', company: 'SHOP', scope: 'BRANCHES', branchIds: [] };
    expect(assignmentProblems([base], [position], context)).not.toHaveLength(0);
    expect(assignmentProblems([{ ...base, branchIds: ['finance'] }], [position], context)).not.toHaveLength(
      0,
    );
    expect(
      assignmentProblems(
        [
          { ...base, branchIds: ['shop', 'other-shop'] },
          { ...base, branchIds: ['other-shop', 'shop'] },
        ],
        [position],
        context,
      ),
    ).not.toHaveLength(0);
  });

  it('warns about a missing read dependency without granting it', () => {
    const selected = ['sales.create'] as const;
    expect(permissionAdvisories(selected, PERMISSION_CATALOG)).toEqual([
      { permission: 'sales.create', dependency: 'sales.read' },
    ]);
    expect(selected).toEqual(['sales.create']);
  });
});
