import { TodosService } from './todos.service';
/** Real scope, CAS and immutable room binding are covered by chat-operations-follow-up.e2e-spec. */
describe('TodosService legacy non-room tasks', () => {
  const prisma = { todo: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() } };
  const service = new TodosService(prisma as any, {} as any, {} as any);
  beforeEach(() => jest.clearAllMocks());
  it('keeps original non-room creation behavior', async () => {
    await service.create({ title: 'ตรวจสต็อก' }, 'staff');
    expect(prisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'ตรวจสต็อก', createdById: 'staff' }) }));
  });
  it('keeps original non-room editing but rejects attaching existing tasks to arbitrary rooms', async () => {
    prisma.todo.findUnique.mockResolvedValue({ id: 'task', roomId: null });
    await service.update('task', { title: 'นับสต็อก' }, 'staff');
    expect(prisma.todo.update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: 'นับสต็อก' } }));
    await expect(service.update('task', { roomId: 'other' }, 'staff')).rejects.toThrow();
  });
});
