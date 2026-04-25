import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DunningRetryService } from './dunning-retry.service';

const mockPrisma = {
  dunningAction: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockNotifications = {
  send: jest.fn(),
};

const baseAction = {
  id: 'action-1',
  status: 'FAILED',
  deletedAt: null,
  messageContent: 'กรุณาชำระค่างวด',
  contractId: 'contract-1',
  dunningRule: { id: 'rule-1', name: 'LINE Reminder', channel: 'LINE' },
  contract: {
    id: 'contract-1',
    contractNumber: 'BC-2026-001',
    customer: { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', lineId: 'Uabc123' },
  },
};

describe('DunningRetryService', () => {
  let service: DunningRetryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DunningRetryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(DunningRetryService);
  });

  describe('listFailed', () => {
    it('queries status=FAILED ordered by createdAt desc', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([baseAction]);
      const result = await service.listFailed(50);
      expect(result).toEqual([baseAction]);
      const arg = mockPrisma.dunningAction.findMany.mock.calls[0][0];
      expect(arg.where.status).toBe('FAILED');
      expect(arg.where.deletedAt).toBeNull();
      expect(arg.orderBy).toEqual({ createdAt: 'desc' });
      expect(arg.take).toBe(50);
    });

    it('uses default limit 100 when not specified', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([]);
      await service.listFailed();
      const arg = mockPrisma.dunningAction.findMany.mock.calls[0][0];
      expect(arg.take).toBe(100);
    });
  });

  describe('retry', () => {
    it('throws NotFoundException if action not found', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(null);
      await expect(service.retry('nope', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequest if action status is not FAILED', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce({
        ...baseAction,
        status: 'SENT',
      });
      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('throws BadRequest if no recipient for channel', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce({
        ...baseAction,
        dunningRule: { id: 'rule-1', name: 'LINE Reminder', channel: 'LINE' },
        contract: {
          ...baseAction.contract,
          customer: { ...baseAction.contract.customer, lineId: null },
        },
      });
      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(/ไม่พบผู้รับ/);
      expect(mockNotifications.send).not.toHaveBeenCalled();
    });

    it('updates status=SENT and sets executedById on success', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
      mockNotifications.send.mockResolvedValueOnce({ id: 'notif-1', status: 'SENT' });
      const updatedAction = { ...baseAction, status: 'SENT', executedById: 'user-1' };
      mockPrisma.dunningAction.update.mockResolvedValueOnce(updatedAction);

      const result = await service.retry('action-1', 'user-1');
      expect(result.status).toBe('SENT');
      const updateArg = mockPrisma.dunningAction.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('SENT');
      expect(updateArg.data.executedById).toBe('user-1');
      expect(updateArg.data.result).toContain('manual retry OK');
    });

    it('keeps FAILED and throws BadRequest when send returns FAILED', async () => {
      mockPrisma.dunningAction.findUnique.mockResolvedValueOnce(baseAction);
      mockNotifications.send.mockResolvedValueOnce({ id: 'notif-2', status: 'FAILED', errorMsg: 'LINE token invalid' });
      mockPrisma.dunningAction.update.mockResolvedValueOnce({ ...baseAction });

      await expect(service.retry('action-1', 'user-1')).rejects.toThrow(BadRequestException);
      const updateArg = mockPrisma.dunningAction.update.mock.calls[0][0];
      expect(updateArg.data.result).toContain('manual retry failed');
    });
  });
});
