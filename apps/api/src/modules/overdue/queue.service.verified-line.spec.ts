import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueQueueService } from './queue.service';
import { NextBestActionService } from './next-best-action.service';
import { LineResponseState } from './dto/queue-query.dto';

/**
 * Task 24 RR-M2 — ปุ่ม "ส่ง LINE" ของคิวทวงถาม (`ContractCard` / `Customer360Actions`) เปิดตาม `customer.hasVerifiedLine`
 * = แถว OTP ที่ยังผูก (เกณฑ์เดียวกับผู้ส่ง `bulkSendLine` — `financeLineRecipient`) ไม่ใช่คอลัมน์ `lineIdFinance` ·
 * ตัวกรอง "ไม่มี LINE" ใช้ค่าเดียวกัน · U-id ของแถวไม่ถูกส่งออก
 */
const empty = jest.fn().mockResolvedValue([]);
const prisma = {
  contract: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), groupBy: empty },
  callLog: { groupBy: empty, findMany: empty },
  dunningAction: { groupBy: empty, findMany: empty },
  auditLog: { groupBy: empty },
  mdmLockRequest: { findMany: empty },
  contractLetter: { groupBy: empty },
  paymentEvidence: { groupBy: empty },
  contractDailySnapshot: { findMany: empty },
  contractSnooze: { findMany: empty },
  chatMessage: { findMany: empty },
};

function contract(id: string, lineIdFinance: string | null, linked: boolean) {
  return {
    id,
    contractNumber: `BC-${id}`,
    status: 'OVERDUE',
    dunningStage: 'STAGE_1',
    customerId: `cust-${id}`,
    noAnswerCount: 0,
    needsSkipTracing: false,
    deviceLocked: false,
    customer: {
      id: `cust-${id}`,
      name: id,
      phone: '0812345678',
      lineIdFinance,
      lineLinks: linked ? [{ lineUserId: `U-${id}` }] : [],
    },
    branch: { id: 'branch-1', name: 'สาขา' },
    assignedTo: null,
    payments: [
      {
        amountDue: '5000.00',
        amountPaid: '0.00',
        lateFee: '0.00',
        dueDate: new Date(Date.now() - 10 * 86400000),
        status: 'OVERDUE',
      },
    ],
    callLogs: [],
  };
}

describe('OverdueQueueService — hasVerifiedLine (Task 24 RR-M2)', () => {
  let service: OverdueQueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    empty.mockResolvedValue([]);
    const mod = await Test.createTestingModule({
      providers: [
        OverdueQueueService,
        NextBestActionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(OverdueQueueService);
  });

  it('อ่านแถว OTP ที่ยังผูก (select เดียวกับผู้ส่ง) · คอลัมน์อย่างเดียว = false · ไม่ส่ง U-id ของแถวออก', async () => {
    prisma.contract.findMany.mockResolvedValueOnce([
      contract('col-only', 'U-typed', false),
      contract('otp', null, true),
    ]);
    prisma.contract.count.mockResolvedValueOnce(2);

    const result = await service.getQueue({ tab: 'today', userRole: 'OWNER', userBranchId: null });

    expect(prisma.contract.findMany.mock.calls[0][0].include.customer.select.lineLinks).toEqual({
      where: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
      select: { lineUserId: true },
      take: 1,
    });
    const byId = new Map(result.data.map((r) => [r.id, r.customer]));
    expect(byId.get('col-only')).toMatchObject({
      lineIdFinance: 'U-typed',
      hasVerifiedLine: false,
    });
    expect(byId.get('otp')).toMatchObject({ lineIdFinance: null, hasVerifiedLine: true });
    expect(byId.get('otp')).not.toHaveProperty('lineLinks');
    expect(JSON.stringify(result.data)).not.toContain('U-otp');
  });

  it('ตัวกรอง "ไม่มี LINE" = ลูกค้าที่ไม่มีแถว OTP (รวมลูกค้าที่มีแต่คอลัมน์)', async () => {
    prisma.contract.findMany.mockResolvedValueOnce([
      contract('col-only', 'U-typed', false),
      contract('otp', null, true),
      contract('none', null, false),
    ]);
    prisma.contract.count.mockResolvedValueOnce(3);

    const result = await service.getQueue({
      tab: 'today',
      userRole: 'OWNER',
      userBranchId: null,
      lineResponse: LineResponseState.NO_LINE,
    });

    expect(result.data.map((r) => r.id).sort()).toEqual(['col-only', 'none']);
  });

  it('getRowById (เปิดกล่องบันทึกการโทรจากหน้าแชท) ได้ hasVerifiedLine เหมือนคิว', async () => {
    prisma.contract.findFirst.mockResolvedValueOnce(contract('otp', null, true));
    const row = await service.getRowById('otp', {
      userId: 'u1',
      userRole: 'OWNER',
      userBranchId: null,
    });
    expect(row?.customer).toMatchObject({ hasVerifiedLine: true });
    expect(row?.customer).not.toHaveProperty('lineLinks');
  });
});
