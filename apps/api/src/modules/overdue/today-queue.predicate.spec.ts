import { ContractStatus, PaymentStatus } from '@prisma/client';
import {
  TODAY_QUEUE_CONTRACT_STATUSES,
  UNSETTLED_PAYMENT_STATUSES,
  todayQueueWhere,
} from './today-queue.predicate';

// เทสชุดนี้มีขึ้นเพราะบั๊กจริง 2 รอบติด:
//  1. `['OVERDUE','PENDING'] as any` — ค่าที่ไม่มีใน enum ทำ cron พังเงียบ 10 รอบเช้า (#1507)
//  2. เงื่อนไข "คิววันนี้" ถูกคัดลอกด้วยมือไว้ 2 ที่ แล้วแยกจากกัน — แท็บว่าง 0 แถว
//     ทั้งที่มีลูกหนี้ค้าง 101 วัน (#1511 ต่อเนื่อง)
describe('todayQueueWhere', () => {
  const now = new Date('2026-09-05T04:30:00.000Z'); // 11:30 ตามเวลาไทย

  it('สถานะสัญญาทุกตัวต้องมีอยู่จริงใน ContractStatus', () => {
    const valid = Object.values(ContractStatus) as string[];
    expect(TODAY_QUEUE_CONTRACT_STATUSES.length).toBeGreaterThan(0);
    expect(TODAY_QUEUE_CONTRACT_STATUSES.filter((s) => !valid.includes(s))).toEqual([]);
  });

  it('สถานะงวดทุกตัวต้องมีอยู่จริงใน PaymentStatus และต้องไม่มี PAID', () => {
    const valid = Object.values(PaymentStatus) as string[];
    expect(UNSETTLED_PAYMENT_STATUSES.filter((s) => !valid.includes(s))).toEqual([]);
    expect(UNSETTLED_PAYMENT_STATUSES).not.toContain(PaymentStatus.PAID);
  });

  it('ต้องรวม DEFAULT — สัญญาผิดนัดคือกลุ่มที่ต้องตามหนักที่สุด ไม่ใช่กลุ่มที่หลุดคิว', () => {
    // DEFAULT ต่อจาก OVERDUE และไม่มีทางกลับ ⇒ ถ้าลิสต์นี้ขาดไป
    // สัญญาจะหลุดคิวตอนที่มันแย่ลง (วัดบน prod: แท็บว่าง 0 แถว ทั้งที่ค้าง 40/70/101 วัน)
    expect(TODAY_QUEUE_CONTRACT_STATUSES).toContain(ContractStatus.DEFAULT);
    expect(TODAY_QUEUE_CONTRACT_STATUSES).toContain(ContractStatus.OVERDUE);
    // ACTIVE ต้องอยู่ด้วย — สัญญาที่เพิ่งเลยกำหนดยังไม่ถูก cron เลื่อนสถานะ
    expect(TODAY_QUEUE_CONTRACT_STATUSES).toContain(ContractStatus.ACTIVE);
  });

  it('ต้องมีด่านครบทั้ง 3 ชั้น: งวดค้าง · การพักของผู้จัดการ · ยังไม่ได้โทรวันนี้', () => {
    const w = todayQueueWhere(now) as any;

    expect(w.payments.some.dueDate).toEqual({ lte: now });
    expect(w.payments.some.status.in).toEqual(UNSETTLED_PAYMENT_STATUSES);

    expect(w.OR).toEqual([
      { blockAutoEscalation: null },
      { blockAutoEscalation: { lt: now } },
    ]);

    // เที่ยงคืน "ตามเวลาไทย" ไม่ใช่ของเซิร์ฟเวอร์ (Cloud Run เป็น UTC) —
    // ถ้าใช้ของเซิร์ฟเวอร์ พนักงานจะเห็นคิวของเมื่อวานทั้งเช้าจนถึง 7 โมง
    expect(w.callLogs.none.calledAt.gte.toISOString()).toBe('2026-09-04T17:00:00.000Z');

    expect(w.deletedAt).toBeNull();
  });

  it('branchScope ต้องถูกผสมเข้าไป และต้องไม่ทับด่านใด ๆ', () => {
    const w = todayQueueWhere(now, { branchId: 'branch-1' }) as any;
    expect(w.branchId).toBe('branch-1');
    expect(w.status.in).toEqual(TODAY_QUEUE_CONTRACT_STATUSES);
    expect(w.OR).toBeDefined();
    expect(w.callLogs).toBeDefined();
  });
});
