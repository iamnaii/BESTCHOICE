import { TodosService } from './todos.service';

describe('TodosService personal tab counts', () => {
  function setup() {
    const prisma = { todo: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
    return { prisma, service: new TodosService(prisma as any, { context: jest.fn().mockResolvedValue({ actor: { id: 'staff-1' }, scope: { company: 'SHOP' } }) } as any, { currentActor: jest.fn().mockResolvedValue({ id: 'staff-1', role: 'SALES' }), roomWhere: jest.fn().mockResolvedValue({ deletedAt: null }) } as any) };
  }

  it('scopes every tab count to the authenticated assignee, search, branch and room', async () => {
    const { prisma, service } = setup();
    await service.findAll({ currentUserId: 'staff-1', assigneeId: 'me', branchId: 'branch-1', roomId: 'room-1', search: 'นัด', view: 'today' });
    expect(prisma.todo.count).toHaveBeenCalledTimes(7);
    for (const [query] of prisma.todo.count.mock.calls) {
      expect(query.where).toMatchObject({ deletedAt: null, assigneeId: 'staff-1', branchId: 'branch-1', roomId: 'room-1', OR: [{ title: { contains: 'นัด', mode: 'insensitive' } }, { description: { contains: 'นัด', mode: 'insensitive' } }] });
    }
    // Other tabs must retain their own status/time criteria, not the active 'today' view.
    expect(prisma.todo.count).toHaveBeenCalledWith({ where: expect.objectContaining({ assigneeId: 'staff-1', status: 'DONE' }) });
  });

  it('leaves team counts unscoped when no assignee filter is selected', async () => {
    const { prisma, service } = setup();
    await service.findAll({ currentUserId: 'staff-1', view: 'all' });
    for (const [query] of prisma.todo.count.mock.calls) {
      expect(query.where).not.toHaveProperty('assigneeId');
    }
  });
});
