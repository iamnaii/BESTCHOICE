import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueTimelineService } from './timeline.service';

/**
 * Golden ของ GET /overdue/contracts/:id/full-timeline — ล็อกผลลัพธ์ "ก่อน" แยก contract-event-sources.ts
 * ครอบทุกกิ่งของตัวแปลง: ผลโทรที่ไม่มีป้าย · ผู้โทรว่าง · ยอด Decimal มีเศษ · messageContent ยาวเกิน/พอดี 80/ว่าง ·
 * audit ทุก action + default · จดหมายไม่มี dispatchedAt/tracking · เวลาเท่ากันต้องคงลำดับ call ก่อน payment (sort เสถียร)
 * 🚨 ห้ามแก้ค่าในไฟล์นี้เพื่อให้ refactor ผ่าน — ถ้าแดงหลัง refactor แปลว่าผลลัพธ์เปลี่ยน ให้แก้โค้ด
 */
const mockPrisma = {
  contract: { findFirst: jest.fn() },
  callLog: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  dunningAction: { findMany: jest.fn() },
  auditLog: { findMany: jest.fn() },
  contractLetter: { findMany: jest.fn() },
};

const LONG_MESSAGE = '1234567890'.repeat(9);
const EXACT_80_MESSAGE = 'abcdefghij'.repeat(8);

function seedSources() {
  mockPrisma.contract.findFirst.mockResolvedValue({ id: 'c1' });
  mockPrisma.callLog.findMany.mockResolvedValue([
    {
      id: 'cl-a',
      contractId: 'c1',
      callerId: 'u-nan',
      calledAt: new Date('2026-08-20T03:15:00.000Z'),
      result: 'PROMISED',
      notes: 'นัดโอนสิ้นเดือน',
      settlementDate: new Date('2026-08-31T00:00:00.000Z'),
      voiceMemoUrl: 'https://storage.example/memo-a.m4a',
      voiceMemoTier: 'HOT',
      caller: { id: 'u-nan', name: 'แนน' },
    },
    {
      id: 'cl-b',
      contractId: 'c1',
      callerId: null,
      calledAt: new Date('2026-08-18T09:00:00.000Z'),
      result: 'LEFT_VOICEMAIL',
      notes: null,
      settlementDate: null,
      voiceMemoUrl: null,
      voiceMemoTier: null,
      caller: null,
    },
  ]);
  mockPrisma.payment.findMany.mockResolvedValue([
    {
      id: 'pm-6',
      contractId: 'c1',
      recordedById: 'u-fin',
      updatedAt: new Date('2026-08-20T03:15:00.000Z'),
      amountPaid: new Prisma.Decimal('35000'),
      installmentNo: 6,
      paymentMethod: null,
    },
    {
      id: 'pm-7',
      contractId: 'c1',
      recordedById: null,
      updatedAt: new Date('2026-08-19T02:00:00.000Z'),
      amountPaid: new Prisma.Decimal('1234.50'),
      installmentNo: 7,
      paymentMethod: 'BANK_TRANSFER',
    },
  ]);
  mockPrisma.dunningAction.findMany.mockResolvedValue([
    {
      id: 'da-long',
      contractId: 'c1',
      executedById: null,
      createdAt: new Date('2026-08-17T01:00:00.000Z'),
      channel: 'LINE',
      messageContent: LONG_MESSAGE,
      status: 'SENT',
      dunningRule: { name: 'เตือนเลยกำหนด 3 วัน', channel: 'LINE' },
    },
    {
      id: 'da-short',
      contractId: 'c1',
      executedById: null,
      createdAt: new Date('2026-08-16T01:00:00.000Z'),
      channel: 'SMS',
      messageContent: EXACT_80_MESSAGE,
      status: 'DELIVERED',
      dunningRule: { name: 'SMS เลยกำหนด 7 วัน', channel: 'SMS' },
    },
    {
      id: 'da-null',
      contractId: 'c1',
      executedById: 'u-nan',
      createdAt: new Date('2026-08-15T01:00:00.000Z'),
      channel: 'CALL_TASK',
      messageContent: null,
      status: 'FAILED',
      dunningRule: { name: 'งานโทร', channel: 'CALL_TASK' },
    },
  ]);
  mockPrisma.auditLog.findMany.mockResolvedValue([
    { id: 'au-status', userId: 'u-sys', entity: 'contract', entityId: 'c1', action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' }, createdAt: new Date('2026-08-14T05:00:00.000Z') },
    { id: 'au-status-null', userId: 'u-sys', entity: 'contract', entityId: 'c1', action: 'STATUS_CHANGE', newValue: null, createdAt: new Date('2026-08-13T05:00:00.000Z') },
    { id: 'au-esc', userId: 'u-owner', entity: 'contract', entityId: 'c1', action: 'DUNNING_ESCALATION_APPROVED', newValue: { dunningStage: 'NOTICE' }, createdAt: new Date('2026-08-12T05:00:00.000Z') },
    { id: 'au-lock', userId: 'u-owner', entity: 'mdm_lock_request', entityId: 'c1', action: 'MDM_LOCK_APPROVED', newValue: { requestId: 'mdm-1' }, createdAt: new Date('2026-08-11T05:00:00.000Z') },
    { id: 'au-unlock', userId: 'u-owner', entity: 'mdm_lock_request', entityId: 'c1', action: 'MDM_UNLOCK', newValue: null, createdAt: new Date('2026-08-10T05:00:00.000Z') },
    { id: 'au-other', userId: 'u-owner', entity: 'contract', entityId: 'c1', action: 'MDM_WALLPAPER_SET', newValue: null, createdAt: new Date('2026-08-09T05:00:00.000Z') },
  ]);
  mockPrisma.contractLetter.findMany.mockResolvedValue([
    {
      id: 'lt-1',
      contractId: 'c1',
      dispatchedById: 'u-bm',
      createdAt: new Date('2026-08-07T04:00:00.000Z'),
      dispatchedAt: new Date('2026-08-08T04:00:00.000Z'),
      letterType: 'RETURN_DEVICE_45D',
      letterNumber: 'LT-2569-0001',
      trackingNumber: 'EE123456789TH',
      status: 'DISPATCHED',
    },
    {
      id: 'lt-2',
      contractId: 'c1',
      dispatchedById: null,
      createdAt: new Date('2026-08-06T04:00:00.000Z'),
      dispatchedAt: null,
      letterType: 'CONTRACT_TERMINATION_60D',
      letterNumber: 'LT-2569-0002',
      trackingNumber: null,
      status: 'DELIVERED',
    },
  ]);
}

const GOLDEN = [
  {
    id: 'call-cl-a',
    type: 'CALL',
    timestamp: '2026-08-20T03:15:00.000Z',
    title: 'นัดชำระ',
    subtitle: 'แนน',
    metadata: {
      result: 'PROMISED',
      notes: 'นัดโอนสิ้นเดือน',
      settlementDate: new Date('2026-08-31T00:00:00.000Z'),
      callLogId: 'cl-a',
      voiceMemoUrl: 'https://storage.example/memo-a.m4a',
      voiceMemoTier: 'HOT',
    },
  },
  {
    id: 'payment-pm-6',
    type: 'PAYMENT',
    timestamp: '2026-08-20T03:15:00.000Z',
    title: 'ชำระ 35,000 ฿ (งวด 6)',
    metadata: { amount: '35000', method: undefined },
  },
  {
    id: 'payment-pm-7',
    type: 'PAYMENT',
    timestamp: '2026-08-19T02:00:00.000Z',
    title: 'ชำระ 1,234.5 ฿ (งวด 7)',
    metadata: { amount: '1234.5', method: 'BANK_TRANSFER' },
  },
  {
    id: 'call-cl-b',
    type: 'CALL',
    timestamp: '2026-08-18T09:00:00.000Z',
    title: 'LEFT_VOICEMAIL',
    subtitle: undefined,
    metadata: {
      result: 'LEFT_VOICEMAIL',
      notes: undefined,
      settlementDate: undefined,
      callLogId: 'cl-b',
      voiceMemoUrl: undefined,
      voiceMemoTier: undefined,
    },
  },
  {
    id: 'dunning-da-long',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-17T01:00:00.000Z',
    title: 'ส่ง LINE: เตือนเลยกำหนด 3 วัน',
    subtitle: `${'1234567890'.repeat(8)}…`,
    metadata: { status: 'SENT', channel: 'LINE' },
  },
  {
    id: 'dunning-da-short',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-16T01:00:00.000Z',
    title: 'ส่ง SMS: SMS เลยกำหนด 7 วัน',
    subtitle: EXACT_80_MESSAGE,
    metadata: { status: 'DELIVERED', channel: 'SMS' },
  },
  {
    id: 'dunning-da-null',
    type: 'DUNNING_ACTION',
    timestamp: '2026-08-15T01:00:00.000Z',
    title: 'ส่ง CALL_TASK: งานโทร',
    subtitle: undefined,
    metadata: { status: 'FAILED', channel: 'CALL_TASK' },
  },
  {
    id: 'audit-au-status',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-14T05:00:00.000Z',
    title: 'สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE',
    metadata: { action: 'STATUS_CHANGE', newValue: { from: 'ACTIVE', to: 'OVERDUE' } },
  },
  {
    id: 'audit-au-status-null',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-13T05:00:00.000Z',
    title: 'สถานะสัญญาเปลี่ยน: ? → ?',
    metadata: { action: 'STATUS_CHANGE', newValue: undefined },
  },
  {
    id: 'audit-au-esc',
    type: 'STATUS_CHANGE',
    timestamp: '2026-08-12T05:00:00.000Z',
    title: 'อนุมัติเลื่อนระดับเตือน: NOTICE',
    metadata: { action: 'DUNNING_ESCALATION_APPROVED', newValue: { dunningStage: 'NOTICE' } },
  },
  {
    id: 'audit-au-lock',
    type: 'MDM',
    timestamp: '2026-08-11T05:00:00.000Z',
    title: 'ล็อคเครื่องแล้ว',
    metadata: { action: 'MDM_LOCK_APPROVED', newValue: { requestId: 'mdm-1' } },
  },
  {
    id: 'audit-au-unlock',
    type: 'MDM',
    timestamp: '2026-08-10T05:00:00.000Z',
    title: 'ปลดล็อคเครื่องแล้ว',
    metadata: { action: 'MDM_UNLOCK', newValue: undefined },
  },
  {
    id: 'audit-au-other',
    type: 'MDM',
    timestamp: '2026-08-09T05:00:00.000Z',
    title: 'MDM_WALLPAPER_SET',
    metadata: { action: 'MDM_WALLPAPER_SET', newValue: undefined },
  },
  {
    id: 'letter-lt-1',
    type: 'LETTER',
    timestamp: '2026-08-08T04:00:00.000Z',
    title: 'ส่งหนังสือ: RETURN_DEVICE_45D (EMS: EE123456789TH)',
    metadata: { status: 'DISPATCHED', letterNumber: 'LT-2569-0001' },
  },
  {
    id: 'letter-lt-2',
    type: 'LETTER',
    timestamp: '2026-08-06T04:00:00.000Z',
    title: 'ส่งหนังสือ: CONTRACT_TERMINATION_60D (EMS: —)',
    metadata: { status: 'DELIVERED', letterNumber: 'LT-2569-0002' },
  },
];

describe('OverdueTimelineService.getFullTimeline — golden (ห้ามเปลี่ยนผลลัพธ์)', () => {
  let service: OverdueTimelineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [OverdueTimelineService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = moduleRef.get(OverdueTimelineService);
    seedSources();
  });

  it('ผลลัพธ์ตรง golden ทุกฟิลด์ รวมคีย์ที่เป็น undefined', async () => {
    const result = await service.getFullTimeline('c1');
    expect(result).toStrictEqual(GOLDEN);
  });

  it('JSON ที่ส่งออก HTTP ตรง golden ทั้งลำดับ event และลำดับคีย์', async () => {
    const result = await service.getFullTimeline('c1');
    expect(JSON.stringify(result)).toBe(JSON.stringify(GOLDEN));
  });

  it('ไม่แตะตาราง source เมื่อไม่พบสัญญา', async () => {
    mockPrisma.contract.findFirst.mockResolvedValue(null);
    await expect(service.getFullTimeline('nope')).rejects.toThrow('ไม่พบสัญญา');
    expect(mockPrisma.callLog.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.contractLetter.findMany).not.toHaveBeenCalled();
  });
});
