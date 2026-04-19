import { Test } from '@nestjs/testing';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      staffChatActivity: {
        create: jest.fn(),
        createMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
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

    // T4-C11: commission hijack guard
    it('allows handoff when customer has NO signed contract', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        customerId: 'cust-1',
      });
      prisma.contract.findFirst.mockResolvedValue(null); // no signed contract
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.createMany.mockResolvedValue({});

      await expect(
        service.transfer('room-1', 'staff-A', 'staff-B', 'BRANCH_MANAGER'),
      ).resolves.toBeUndefined();
      expect(prisma.chatRoom.update).toHaveBeenCalled();
    });

    it('T4-C11: rejects handoff after customer signed contract (non-OWNER)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        customerId: 'cust-1',
      });
      prisma.contract.findFirst.mockResolvedValue({
        id: 'contract-99',
        contractNumber: 'CT-2026-0099',
      });

      await expect(
        service.transfer('room-1', 'staff-A', 'staff-B', 'BRANCH_MANAGER'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.chatRoom.update).not.toHaveBeenCalled();
    });

    it('T4-C11: OWNER can override handoff post-signature with audit log', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({
        id: 'room-1',
        customerId: 'cust-1',
      });
      prisma.contract.findFirst.mockResolvedValue({
        id: 'contract-99',
        contractNumber: 'CT-2026-0099',
      });
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.createMany.mockResolvedValue({});
      prisma.auditLog.create.mockResolvedValue({});

      await service.transfer('room-1', 'owner-1', 'staff-B', 'OWNER');

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CHAT_HANDOFF_POST_SIGNATURE_OVERRIDE',
          }),
        }),
      );
      expect(prisma.chatRoom.update).toHaveBeenCalled();
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
