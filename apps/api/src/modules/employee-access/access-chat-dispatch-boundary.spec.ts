import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessSnapshot } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatDispatchController } from '../staff-chat/chat-dispatch.controller';
import { AccessChatDispatchBoundary, CHAT_DISPATCH_ROUTES } from './access-chat-dispatch-boundary';
import { AccessPolicyService } from './access-policy';
import { ACCESS_BOUNDARIES } from './access-policy.registry';

describe('chat dispatch production access policy', () => {
  const prisma = { user: { findFirst: jest.fn(async () => ({ branchId: 'own-branch' })) } };
  const policy = new AccessPolicyService(new Reflector());
  const snapshot = (overrides: Partial<AccessSnapshot> = {}): AccessSnapshot => ({
    userId: 'staff', isOwner: false, managed: true, revision: 1,
    grants: [{ positionId: 'sales', company: 'SHOP', scope: 'BRANCHES', branchIds: ['own-branch'], permissions: ['chat.read', 'chat.update'] }],
    ...overrides,
  });
  const context = (method: 'read' | 'ready' | 'heartbeat', access = snapshot(), query = { company: 'shop' }, role = 'SALES') => ({
    getType: () => 'http', getClass: () => ChatDispatchController,
    getHandler: () => ChatDispatchController.prototype[method],
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'staff', role, aud: 'admin', access }, query }) }),
  }) as unknown as ExecutionContext;
  beforeAll(() => new AccessChatDispatchBoundary(prisma as unknown as PrismaService).onModuleInit());
  afterAll(() => CHAT_DISPATCH_ROUTES.forEach(route => ACCESS_BOUNDARIES.delete(route)));

  it.each(['read', 'ready', 'heartbeat'] as const)('classifies %s for legacy, managed staff and OWNER', async method => {
    await expect(policy.authorize(context(method, snapshot({ managed: false })))).resolves.toBeUndefined();
    await expect(policy.authorize(context(method))).resolves.toBeUndefined();
    await expect(policy.authorize(context(method, snapshot({ isOwner: true, grants: [] }), { company: 'FINANCE' }, 'OWNER'))).resolves.toBeUndefined();
  });
  it('rejects empty, other-company and other-branch grants even if the caller spoofs branchId', async () => {
    const base = snapshot().grants[0];
    for (const grants of [[], [{ ...base, company: 'FINANCE' as const }], [{ ...base, branchIds: ['another-branch'] }]]) {
      await expect(policy.authorize(context('ready', snapshot({ grants }), { company: 'shop', branchId: 'another-branch' } as {company: string}))).rejects.toThrow('ไม่มีสิทธิ์');
    }
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'staff' }) }));
  });
  it('read-only grants cannot join or renew and CUSTOMER cannot use staff routes', async () => {
    const readOnly = snapshot({ grants: [{ ...snapshot().grants[0], permissions: ['chat.read'] }] });
    await expect(policy.authorize(context('read', readOnly))).resolves.toBeUndefined();
    for (const method of ['ready', 'heartbeat'] as const)
      await expect(policy.authorize(context(method, readOnly))).rejects.toThrow('ไม่มีสิทธิ์');
    await expect(policy.authorize(context('read', snapshot(), { company: 'SHOP' }, 'CUSTOMER'))).rejects.toThrow('ไม่มีสิทธิ์');
  });
});
