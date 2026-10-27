import { purchaseOrderScopeWhere, supplierScopeWhere } from './access-procurement-scope';
import { CollectionScope } from './access-policy.registry';
const scope: CollectionScope = { userId: 'u', company: 'FINANCE', permission: 'purchase-orders.read', tuples: [{ userId: 'u', scope: 'BRANCHES', branchIds: ['a'] }] };
test('explicit procurement origin keeps company and branch together; central is not every branch', () => {
  const predicate = JSON.stringify(purchaseOrderScopeWhere(scope));
  expect(predicate).toContain('FINANCE');
  expect(predicate).toContain('accessBranchId');
  expect(predicate).not.toContain('createdBy');
  expect(purchaseOrderScopeWhere({ ...scope, tuples: [] })).not.toEqual(purchaseOrderScopeWhere(scope));
});
test('supplier source visibility is explicit, never a shared definition exception', () => {
  const predicate = JSON.stringify(supplierScopeWhere(scope));
  expect(predicate).toContain('purchaseOrders');
  expect(predicate).toContain('products');
  expect(predicate).not.toContain('reference');
});

test('absent, assigned-only and foreign-user tuples produce explicit false predicates', () => {
  for (const tuples of [[], [{ userId: 'u', scope: 'ASSIGNED' as const, branchIds: ['a'] }], [{ userId: 'other', scope: 'COMPANY' as const, branchIds: [] }]]) {
    expect(purchaseOrderScopeWhere({ ...scope, tuples })).toEqual({ id: { in: [] } });
    expect(supplierScopeWhere({ ...scope, tuples })).toEqual({ id: { in: [] } });
  }
});
