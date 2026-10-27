import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessPolicyService } from './access-policy';
import { assertAccess, accessCompanies, permissionScopes } from './access-context';

const snapshot = (permissions = ['products.read']) => ({ userId: 'u', isOwner: false, managed: true, revision: 1, grants: [{ positionId: 'p', permissions, company: 'SHOP', scope: 'BRANCHES', branchIds: ['a'] }] });
function context(controller: string, method: string, user: any, extra: any = {}) {
  const request = { user, ...extra };
  return { getType: () => 'http', getClass: () => ({ name: controller }), getHandler: () => ({ name: method }), switchToHttp: () => ({ getRequest: () => request }) } as any;
}
describe('managed runtime policy', () => {
  const service = new AccessPolicyService(new Reflector());
  it('uses position tuples independently of legacy role and denies another branch', () => {
    const user = { id: 'u', role: 'SALES', access: snapshot() } as any;
    expect(() => assertAccess(user, 'products.read', { company: 'SHOP', branchId: 'a' })).not.toThrow();
    expect(() => assertAccess(user, 'products.read', { company: 'SHOP', branchId: 'b' })).toThrow(ForbiddenException);
    user.access = snapshot([]);
    expect(() => assertAccess(user, 'products.read', { company: 'SHOP', branchId: 'a' })).toThrow(ForbiddenException);
  });
  it('preserves ASSIGNED ownership and permission-specific tuples for collection predicates', () => {
    const user = { id: 'u', access: { ...snapshot(), grants: [
      { positionId: 'manager-a', company: 'SHOP', scope: 'BRANCHES', branchIds: ['a'], permissions: ['products.read'] },
      { positionId: 'case-b', company: 'SHOP', scope: 'ASSIGNED', branchIds: ['b'], permissions: ['products.read'] },
      { positionId: 'finance', company: 'FINANCE', scope: 'COMPANY', branchIds: [], permissions: ['products.read'] },
      { positionId: 'sales-c', company: 'SHOP', scope: 'BRANCHES', branchIds: ['c'], permissions: ['sales.read'] },
    ] } } as any;
    expect(permissionScopes(user, 'products.read', 'SHOP')).toEqual([
      { scope: 'BRANCHES', branchIds: ['a'], userId: 'u' },
      { scope: 'ASSIGNED', branchIds: ['b'], userId: 'u' },
    ]);
  });
  it('never defaults empty managed grants to role company rights', () => {
    expect(accessCompanies({ ...snapshot(), grants: [] }, 'OWNER', [], null).accessibleCompanies).toEqual([]);
  });
  it('denies an unknown managed route and captures only safe denial metadata', async () => {
    const denied = jest.fn(); service.onDenied = denied;
    await expect(service.authorize(context('NewController', 'exportSecrets', { id: 'u', role: 'OWNER', access: snapshot() }))).rejects.toThrow(ForbiddenException);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', route: 'NewController.exportSecrets', reason: 'UNCLASSIFIED' }));
  });
  it('rejects customer token on staff route even without Roles metadata', async () => {
    await expect(service.authorize(context('ProductsController', 'findAll', { id: 'c', role: 'CUSTOMER', aud: 'shop' }))).rejects.toThrow(ForbiddenException);
  });
  it('preserves public integrations with their own authentication', async () => {
    await expect(service.authorize(context('FacebookWebhookController', 'handleWebhook', undefined))).resolves.toBeUndefined();
  });
  it('does not accept client branch as record ownership or permit an unintegrated list', async () => {
    await expect(service.authorize(context('ProductsController', 'findAll', { id: 'u', role: 'OWNER', access: snapshot() }, { query: { company: 'SHOP', branchId: 'a' } }))).rejects.toThrow(ForbiddenException);
  });
  it('exposes the explicitly unmigrated path', async () => {
    const ctx = context('ProductsController', 'findAll', { id: 'u', role: 'SALES', access: { ...snapshot(), managed: false } });
    await service.authorize(ctx);
    expect(ctx.switchToHttp().getRequest().accessMode).toBe('LEGACY_UNMIGRATED');
  });
});
