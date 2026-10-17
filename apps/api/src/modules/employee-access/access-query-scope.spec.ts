import { scopeWhere, productScopeWhere } from './access-query-scope';
import { CollectionScope } from './access-policy.registry';
const scope: CollectionScope = { userId: 'u', company: 'SHOP', permission: 'products.read', tuples: [{ scope: 'BRANCHES', branchIds: ['A'], userId: 'u' }, { scope: 'ASSIGNED', branchIds: ['B'], userId: 'u' }] };
describe('tuple-preserving query scope', () => {
  it('keeps assigned identity inside its original branch tuple', () => {
    expect(scopeWhere<Record<string, unknown>>(scope, { company: () => ({ company: 'SHOP' }), branch: ids => ({ branchId: { in: ids } }), assigned: id => ({ assigneeId: id }) })).toEqual({ AND: [{ company: 'SHOP' }, { OR: [{ branchId: { in: ['A'] } }, { AND: [{ assigneeId: 'u' }, { branchId: { in: ['B'] } }] }] }] });
  });
  it('never makes missing assignment or empty branches global', () => {
    expect(scopeWhere<Record<string, unknown>>({ ...scope, tuples: [{ scope: 'BRANCHES', branchIds: [], userId: 'u' }, scope.tuples[1]] }, { company: () => ({ company: 'SHOP' }), branch: ids => ({ branchId: { in: ids } }) })).toEqual({ AND: [{ company: 'SHOP' }, { OR: [] }] });
  });
  it('requires an explicit source company predicate', () => {
    expect(() => scopeWhere<Record<string, unknown>>(scope, { company: () => null, branch: ids => ({ branchId: { in: ids } }) })).toThrow();
  });
  it('binds product company to ownership before branch fallback', () => {
    expect(JSON.stringify(productScopeWhere(scope))).toContain('ownedByCompanyId');
    expect(JSON.stringify(productScopeWhere(scope))).not.toContain('"B"');
  });
});
