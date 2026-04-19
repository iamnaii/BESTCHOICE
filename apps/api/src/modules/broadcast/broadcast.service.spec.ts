import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { BroadcastService } from './broadcast.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { LineFinanceClientService } from '../chatbot-finance/services/line-finance-client.service';

describe('BroadcastService (T4-C6: large-audience + trigger-word 2nd approval)', () => {
  let service: BroadcastService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineOa: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lineFinance: any;

  beforeEach(async () => {
    prisma = {
      customerLineLink: { findMany: jest.fn().mockResolvedValue([]) },
      chatRoom: { findMany: jest.fn().mockResolvedValue([]) },
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
      broadcastMessage: {
        create: jest.fn().mockResolvedValue({ id: 'bm-1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      broadcastApproval: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'ba-' + data.approverId, ...data }),
        ),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    lineOa = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    lineFinance = { pushText: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: lineOa },
        { provide: LineFinanceClientService, useValue: lineFinance },
      ],
    }).compile();

    service = module.get<BroadcastService>(BroadcastService);
  });

  describe('evaluateApprovalRequirement (pure)', () => {
    it('does NOT require approval for small benign broadcast', () => {
      const v = service.evaluateApprovalRequirement('สวัสดีครับ', 10);
      expect(v.required).toBe(false);
    });

    it('requires approval when audience > 1000', () => {
      const v = service.evaluateApprovalRequirement('ข้อความธรรมดา', 1001);
      expect(v.required).toBe(true);
      expect(v.reason).toBe('AUDIENCE_SIZE');
    });

    it('requires approval on trigger word regardless of size', () => {
      const v = service.evaluateApprovalRequirement(
        'ถ้าไม่จ่ายจะยึดคืน',
        5,
      );
      expect(v.required).toBe(true);
      expect(v.reason).toBe('TRIGGER_WORD');
      expect(v.triggerMatched).toBe('ยึด');
    });
  });

  describe('sendBroadcast', () => {
    // Helper to stub targets via customerLineLink
    const stubTargets = (count: number) => {
      const links = Array.from({ length: count }, (_, i) => ({
        customerId: `cust-${i}`,
        lineUserId: `U${i}`,
        customer: { name: `ลูกค้า ${i}` },
      }));
      prisma.customerLineLink.findMany.mockResolvedValue(links);
    };

    it('small benign audience → sends without approval gate', async () => {
      stubTargets(5);
      const result = await service.sendBroadcast(
        {
          channel: ChatChannel.LINE_FINANCE,
          message: 'สวัสดีครับ',
        },
        'owner-1',
      );
      expect(result.total).toBe(5);
      expect(prisma.broadcastMessage.create).not.toHaveBeenCalled();
      expect(lineFinance.pushText).toHaveBeenCalled();
    });

    it('audience > 1000 with 1 approver → ForbiddenException + queue row created', async () => {
      stubTargets(1500);
      await expect(
        service.sendBroadcast(
          {
            channel: ChatChannel.LINE_FINANCE,
            message: 'ข้อความธรรมดา',
          },
          'owner-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.broadcastMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING_APPROVAL',
            audienceCount: 1500,
            createdById: 'owner-1',
          }),
        }),
      );
      expect(lineFinance.pushText).not.toHaveBeenCalled();
    });

    it('trigger word triggers approval gate even when audience is small', async () => {
      stubTargets(10);
      await expect(
        service.sendBroadcast(
          {
            channel: ChatChannel.LINE_FINANCE,
            message: 'ถ้าไม่จ่ายจะดำเนินคดีตามกฎหมาย',
          },
          'owner-1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.broadcastMessage.create).toHaveBeenCalled();
    });
  });

  describe('approveBroadcast — 2-person SoD', () => {
    it('rejects non-OWNER approver', async () => {
      await expect(
        service.approveBroadcast('bm-1', 'u-1', 'FINANCE_MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when approver is the creator (SoD)', async () => {
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bm-1',
        createdById: 'owner-1',
        audienceCount: 2000,
        messages: [{ type: 'text', content: 'bulk' }],
        approvals: [],
      });
      await expect(
        service.approveBroadcast('bm-1', 'owner-1', 'OWNER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records 1st approval but does NOT flip status to APPROVED', async () => {
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bm-1',
        createdById: 'owner-1',
        audienceCount: 2000,
        messages: [{ type: 'text', content: 'bulk' }],
        approvals: [],
      });
      const result = await service.approveBroadcast('bm-1', 'owner-2', 'OWNER');
      expect(result.cleared).toBe(false);
      expect(result.totalApprovals).toBe(1);
      expect(prisma.broadcastApproval.create).toHaveBeenCalled();
      expect(prisma.broadcastMessage.update).not.toHaveBeenCalled();
    });

    it('2nd distinct approver flips status → APPROVED', async () => {
      prisma.broadcastMessage.findUnique.mockResolvedValue({
        id: 'bm-1',
        createdById: 'owner-1',
        audienceCount: 2000,
        messages: [{ type: 'text', content: 'bulk' }],
        approvals: [
          { id: 'ba-1', approverId: 'owner-2' }, // one prior approval
        ],
      });
      const result = await service.approveBroadcast('bm-1', 'owner-3', 'OWNER');
      expect(result.cleared).toBe(true);
      expect(result.totalApprovals).toBe(2);
      expect(prisma.broadcastMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED' }),
        }),
      );
    });
  });
});
