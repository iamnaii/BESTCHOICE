import { describe, it, expect } from 'vitest';
import { PRODUCT_DETAIL_ROLES } from './App';

/**
 * B1 Task 12 fix round 1 [I2]: repo has no route-render-test pattern (rendering the whole
 * <App/> to exercise React Router + all lazy chunks + ProtectedRoute is heavy and not done
 * anywhere else in this codebase) — this is the lightest regression guard for "someone
 * removes FINANCE_MANAGER/ACCOUNTANT from the /products/:id route roles and nothing fails".
 * `PRODUCT_DETAIL_ROLES` is exported from App.tsx specifically so this assertion binds to
 * the SAME array the route actually renders with, not a hand-typed copy that could drift.
 */
describe('PRODUCT_DETAIL_ROLES (/products/:id route roles)', () => {
  it('includes all 5 roles — OWNER/BRANCH_MANAGER/SALES (pre-existing) + FINANCE_MANAGER/ACCOUNTANT (B1 Task 12)', () => {
    expect(PRODUCT_DETAIL_ROLES).toEqual(
      expect.arrayContaining(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES']),
    );
    expect(PRODUCT_DETAIL_ROLES).toHaveLength(5);
  });
});
