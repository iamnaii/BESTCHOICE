import { Test } from '@nestjs/testing';
import { TodosService } from './todos.service';
import { PrismaService } from '../../prisma/prisma.service';

/** นัดของห้องแชท (Todo.roomId) — กรอง/สร้าง/แก้ ต้องส่ง roomId ถึง Prisma */
describe('TodosService — roomId', () => {
  let service: TodosService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      todo: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 't1' }),
        findUnique: jest.fn().mockResolvedValue({ id: 't1' }),
        update: jest.fn().mockResolvedValue({ id: 't1' }),
      },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    const module = await Test.createTestingModule({
      providers: [TodosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TodosService);
  });

  it('findAll({ roomId }) → where.roomId (นัดของห้องเดียว ไม่ปนกับงานอื่นของทั้งร้าน)', async () => {
    await service.findAll({ roomId: 'room-1', currentUserId: 'u1' });
    const args = prisma.todo.findMany.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ deletedAt: null, roomId: 'room-1' }));
  });

  it('create ส่ง roomId ลง data', async () => {
    await service.create({ title: 'นัดรับเครื่อง', roomId: 'room-1' } as any, 'u1');
    expect(prisma.todo.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'นัดรับเครื่อง', roomId: 'room-1', createdById: 'u1' }) }),
    );
  });

  it('update: roomId ว่าง = ปลดออกจากห้อง · มีค่า = ย้ายห้อง · ไม่ส่ง = ไม่แตะ', async () => {
    await service.update('t1', { roomId: 'room-2' } as any);
    expect(prisma.todo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ room: { connect: { id: 'room-2' } } }) }),
    );
    await service.update('t1', { roomId: '' } as any);
    expect(prisma.todo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ room: { disconnect: true } }) }),
    );
    await service.update('t1', { title: 'x' } as any);
    expect(prisma.todo.update.mock.calls[2][0].data).not.toHaveProperty('room');
  });
});
