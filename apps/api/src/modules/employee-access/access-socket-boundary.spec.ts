import { AccessSocketBoundary } from './access-socket-boundary';
describe('socket revocation boundary', () => {
  it('rechecks subscriptions before delivery and disconnects a newly managed recipient', async () => {
    const snapshots = { forUser: jest.fn().mockResolvedValueOnce({ managed: false }).mockResolvedValue({ managed: true }) };
    const boundary = new AccessSocketBoundary(snapshots as any, { user: { findUnique: async () => ({ role: 'SALES', branchId: 'a' }) } } as any);
    const client = { id: 's', data: { staffUserId: 'u' }, disconnect: jest.fn(), emit: jest.fn() };
    expect(await boundary.allowLegacy(client)).toBe(true);
    const server = { in: () => ({ fetchSockets: async () => [client] }) };
    await (boundary as any).deliver(server, 'all', 'payment:received', { amount: 999 });
    expect(client.emit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(snapshots.forUser).toHaveBeenCalledTimes(2);
  });
  it('revokes an old role subscription before outgoing delivery', async () => {
    const boundary = new AccessSocketBoundary({ forUser: async () => ({ managed: false }) } as any, { user: { findUnique: async () => ({ role: 'SALES', branchId: 'a' }) } } as any);
    const client = { data: { staffUserId: 'u', staffRole: 'OWNER', staffBranchId: 'a' }, disconnect: jest.fn() };
    expect(await boundary.allowLegacy(client)).toBe(false);
    expect(client.disconnect).toHaveBeenCalled();
  });
  it('denies commands when the account has been disabled', async () => {
    const boundary = new AccessSocketBoundary({ forUser: jest.fn().mockRejectedValue(new Error('disabled')) } as any, {} as any);
    const client = { data: { staffUserId: 'u' }, disconnect: jest.fn() };
    expect(await boundary.allowLegacy(client)).toBe(false);
    expect(client.disconnect).toHaveBeenCalled();
  });
});
