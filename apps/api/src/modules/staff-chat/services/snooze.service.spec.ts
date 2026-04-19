import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SnoozeService } from './snooze.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SnoozeService', () => {
  let service: SnoozeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatRoom: {
        findFirst: jest.fn().mockResolvedValue({ id: 'room-1', deletedAt: null }),
      },
      chatSnooze: {
        create: jest.fn((args) => Promise.resolve({ id: 'snooze-1', ...args.data })),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [SnoozeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(SnoozeService);
  });

  describe('createSnooze', () => {
    it('creates snooze when room exists', async () => {
      const remindAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await service.createSnooze('room-1', 'u-1', remindAt, 'follow up');
      const args = prisma.chatSnooze.create.mock.calls[0][0];
      expect(args.data.roomId).toBe('room-1');
      expect(args.data.staffId).toBe('u-1');
      expect(args.data.remindAt).toBe(remindAt);
      expect(args.data.note).toBe('follow up');
    });

    it('throws NotFound when room missing', async () => {
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      await expect(
        service.createSnooze('missing', 'u-1', new Date()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when room soft-deleted (deletedAt filter)', async () => {
      // findFirst with deletedAt: null returns null when soft-deleted
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      await expect(
        service.createSnooze('deleted-room', 'u-1', new Date()),
      ).rejects.toThrow(NotFoundException);
    });

    it('stores null note when undefined', async () => {
      await service.createSnooze('room-1', 'u-1', new Date());
      expect(prisma.chatSnooze.create.mock.calls[0][0].data.note).toBeNull();
    });
  });

  describe('cancelSnooze', () => {
    it('marks completed=true when found', async () => {
      prisma.chatSnooze.findUnique.mockResolvedValue({ id: 'snooze-1' });
      await service.cancelSnooze('snooze-1');
      expect(prisma.chatSnooze.update).toHaveBeenCalledWith({
        where: { id: 'snooze-1' },
        data: { completed: true },
      });
    });

    it('throws NotFound when snooze missing', async () => {
      prisma.chatSnooze.findUnique.mockResolvedValue(null);
      await expect(service.cancelSnooze('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getActiveSnoozes', () => {
    it('filters by staffId + completed=false', async () => {
      await service.getActiveSnoozes('u-1');
      const where = prisma.chatSnooze.findMany.mock.calls[0][0].where;
      expect(where.staffId).toBe('u-1');
      expect(where.completed).toBe(false);
    });

    it('orders by remindAt asc (next-due first)', async () => {
      await service.getActiveSnoozes('u-1');
      expect(prisma.chatSnooze.findMany.mock.calls[0][0].orderBy).toEqual({
        remindAt: 'asc',
      });
    });
  });

  describe('getRoomSnoozes', () => {
    it('filters by roomId + includes staff name', async () => {
      await service.getRoomSnoozes('room-1');
      const args = prisma.chatSnooze.findMany.mock.calls[0][0];
      expect(args.where.roomId).toBe('room-1');
      expect(args.include.staff.select).toEqual({ id: true, name: true });
    });

    it('orders by createdAt desc (most recent first)', async () => {
      await service.getRoomSnoozes('room-1');
      expect(prisma.chatSnooze.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'desc',
      });
    });
  });
});
