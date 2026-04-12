import { Test } from '@nestjs/testing';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { ChatSessionStatus } from '@prisma/client';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      chatSession: {
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
    it('should assign session and log activity', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'sess-1' });
      prisma.chatSession.update.mockResolvedValue({});
      prisma.staffChatActivity.create.mockResolvedValue({});

      await service.assign('sess-1', 'staff-1');

      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { assignedToId: 'staff-1', sessionStatus: ChatSessionStatus.PENDING },
      });
      expect(prisma.staffChatActivity.create).toHaveBeenCalledWith({
        data: { staffId: 'staff-1', action: 'assign', metadata: { sessionId: 'sess-1' } },
      });
    });

    it('should throw NotFoundException if session not found', async () => {
      prisma.chatSession.findUnique.mockResolvedValue(null);

      await expect(service.assign('not-exist', 'staff-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('transfer', () => {
    it('should transfer and log both sides', async () => {
      prisma.chatSession.findUnique.mockResolvedValue({ id: 'sess-1' });
      prisma.chatSession.update.mockResolvedValue({});
      prisma.staffChatActivity.createMany.mockResolvedValue({});

      await service.transfer('sess-1', 'staff-A', 'staff-B');

      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
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
    it('should resolve session and set resolvedAt', async () => {
      prisma.chatSession.update.mockResolvedValue({});
      prisma.staffChatActivity.create.mockResolvedValue({});

      await service.resolve('sess-1', 'staff-1');

      expect(prisma.chatSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: expect.objectContaining({
          sessionStatus: ChatSessionStatus.RESOLVED,
          handoffMode: false,
          resolvedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getStaffSessionCounts', () => {
    it('should return counts grouped by staff', async () => {
      prisma.chatSession.groupBy.mockResolvedValue([
        { assignedToId: 'staff-1', _count: { id: 3 } },
        { assignedToId: 'staff-2', _count: { id: 1 } },
      ]);

      const result = await service.getStaffSessionCounts();

      expect(result).toEqual([
        { staffId: 'staff-1', openCount: 3 },
        { staffId: 'staff-2', openCount: 1 },
      ]);
    });
  });
});
