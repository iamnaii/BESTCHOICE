import { Test } from '@nestjs/testing';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { ChatRoomStatus } from '@prisma/client';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatRoom: {
        findUnique: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
      },
      staffChatActivity: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AssignmentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AssignmentService);
  });

  describe('assign', () => {
    it('should assign room and log activity', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.create.mockResolvedValue({});

      await service.assign('room-1', 'staff-1');

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { assignedToId: 'staff-1', status: ChatRoomStatus.ACTIVE },
      });
      expect(prisma.staffChatActivity.create).toHaveBeenCalledWith({
        data: { staffId: 'staff-1', action: 'assign', metadata: { roomId: 'room-1' } },
      });
    });

    it('should throw NotFoundException if room not found', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);

      await expect(service.assign('not-exist', 'staff-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('transfer', () => {
    it('should transfer and log both sides', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.createMany.mockResolvedValue({});

      await service.transfer('room-1', 'staff-A', 'staff-B');

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { assignedToId: 'staff-B' },
      });
      expect(prisma.staffChatActivity.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ staffId: 'staff-A', action: 'transfer_out' }),
          expect.objectContaining({ staffId: 'staff-B', action: 'transfer_in' }),
        ]),
      });
    });
  });

  describe('resolve', () => {
    it('should resolve room and set resolvedAt', async () => {
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.create.mockResolvedValue({});

      await service.resolve('room-1', 'staff-1');

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({
          status: ChatRoomStatus.IDLE,
          handoffMode: false,
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getStaffRoomCounts', () => {
    it('should return counts grouped by staff', async () => {
      prisma.chatRoom.groupBy.mockResolvedValue([
        { assignedToId: 'staff-1', _count: { id: 3 } },
        { assignedToId: 'staff-2', _count: { id: 1 } },
      ]);

      const result = await service.getStaffRoomCounts();

      expect(result).toEqual([
        { staffId: 'staff-1', activeCount: 3 },
        { staffId: 'staff-2', activeCount: 1 },
      ]);
    });
  });
});
