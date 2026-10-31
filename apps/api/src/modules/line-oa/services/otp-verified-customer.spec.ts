import {
  ACTIVE_FINANCE_LINK_WHERE,
  FINANCE_LINE_RECIPIENT_SELECT,
  LEGACY_SHOP_LINE_ID_CUTOFF,
  financeLineRecipient,
  findFinanceLineRecipient,
  findOtpVerifiedCustomerId,
  findShopLiffCustomerId,
} from './otp-verified-customer';

/**
 * Task 22 (task-20-report ข้อกังวล 1 — ทางเลือก ก) — หน้า LIFF ฝั่งร้าน ("ประกันของฉัน" / เคสหลังการขาย) อ่านตัวตนจากแถว OTP
 * (customer_line_links ช่อง FINANCE ของ LINE เดียวกัน) · `line_id_shop` เป็นทางสำรองเฉพาะแถวที่ไม่ถูกแก้เลยตั้งแต่ก่อน Task 20
 * (ค่าที่พนักงาน/บอทเขียนหลังจากนั้นยังไม่ผ่าน OTP — ไม่นับ)
 */
describe('findShopLiffCustomerId', () => {
  let prisma: {
    customerLineLink: { findFirst: jest.Mock };
    customer: { findFirst: jest.Mock };
  };
  beforeEach(() => {
    prisma = {
      customerLineLink: { findFirst: jest.fn().mockResolvedValue(null) },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  });

  it('LINE ยืนยัน OTP แล้ว → ลูกค้าของแถว OTP (ไม่ค้น line_id_shop)', async () => {
    prisma.customerLineLink.findFirst.mockResolvedValue({ customerId: 'c-otp' });
    await expect(findShopLiffCustomerId(prisma as never, 'U1')).resolves.toBe('c-otp');
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('ยังไม่ยืนยัน OTP → สำรองด้วย line_id_shop เฉพาะแถวที่แก้ล่าสุดก่อน Task 20', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'c-legacy' });
    await expect(findShopLiffCustomerId(prisma as never, 'U1')).resolves.toBe('c-legacy');
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { lineIdShop: 'U1', deletedAt: null, updatedAt: { lt: LEGACY_SHOP_LINE_ID_CUTOFF } },
      select: { id: true },
    });
  });

  it('ไม่มีทั้งสองทาง (รวม line_id_shop ที่พนักงาน/บอทเขียนหลัง Task 20) → null', async () => {
    await expect(findShopLiffCustomerId(prisma as never, 'U1')).resolves.toBeNull();
  });

  it('จุดตัด = ก่อน Task 20 (31 ต.ค. 2569 00:00 เวลาไทย)', () => {
    expect(LEGACY_SHOP_LINE_ID_CUTOFF.toISOString()).toBe('2026-10-30T17:00:00.000Z');
  });
});

describe('findOtpVerifiedCustomerId', () => {
  it('แถว FINANCE ที่ยังผูก ของลูกค้าที่ยังไม่ถูกลบ', async () => {
    const prisma = {
      customerLineLink: { findFirst: jest.fn().mockResolvedValue({ customerId: 'c1' }) },
    };
    await expect(findOtpVerifiedCustomerId(prisma as never, 'U1')).resolves.toBe('c1');
    expect(prisma.customerLineLink.findFirst.mock.calls[0][0].where).toEqual({
      lineUserId: 'U1',
      channel: 'FINANCE',
      unlinkedAt: null,
      deletedAt: null,
      customer: { deletedAt: null },
    });
  });
});

/**
 * Task 22 fix round 1 I-1 (ง) — ปลายทางข้อความการเงินทาง LINE อ่าน U-id จากแถว OTP ของลูกค้าคนนั้น ไม่ใช่คอลัมน์
 * `line_id_finance` (ค่าค้าง/พนักงานพิมพ์ก่อน Task 22 ต้องไม่ทำให้ข้อความไปผิดคน)
 */
describe('financeLineRecipient / FINANCE_LINE_RECIPIENT_SELECT', () => {
  it('select = แถว FINANCE ที่ยังผูกของลูกค้าคนนั้น (unique ต่อลูกค้า — take 1) · ไม่เลือกคอลัมน์', () => {
    expect(ACTIVE_FINANCE_LINK_WHERE).toEqual({
      channel: 'FINANCE',
      unlinkedAt: null,
      deletedAt: null,
    });
    expect(FINANCE_LINE_RECIPIENT_SELECT).toEqual({
      lineLinks: { where: ACTIVE_FINANCE_LINK_WHERE, select: { lineUserId: true }, take: 1 },
    });
    expect(FINANCE_LINE_RECIPIENT_SELECT).not.toHaveProperty('lineIdFinance');
  });

  it('มีแถว OTP → U-id ของแถว', () => {
    expect(financeLineRecipient({ lineLinks: [{ lineUserId: 'U-otp' }] })).toBe('U-otp');
  });

  it.each([
    ['ไม่มีแถว OTP (คอลัมน์ค้างไม่ถูกอ่าน)', { lineIdFinance: 'U-stale', lineLinks: [] }],
    ['ไม่ได้เลือก lineLinks', { lineIdFinance: 'U-stale' }],
    ['ไม่มีลูกค้า', null],
    ['undefined', undefined],
  ])('%s → null (ไม่ส่งทาง LINE)', (_label, customer) => {
    expect(financeLineRecipient(customer as never)).toBeNull();
  });
});

describe('findFinanceLineRecipient (ผู้ส่งที่มีแค่ customerId)', () => {
  it('ค้นแถว FINANCE ที่ยังผูกของลูกค้าคนนี้ → U-id · ไม่มี = null', async () => {
    const prisma = {
      customerLineLink: { findFirst: jest.fn().mockResolvedValue({ lineUserId: 'U-otp' }) },
    };
    await expect(findFinanceLineRecipient(prisma as never, 'c1')).resolves.toBe('U-otp');
    expect(prisma.customerLineLink.findFirst.mock.calls[0][0]).toEqual({
      where: { customerId: 'c1', channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
      select: { lineUserId: true },
    });
    prisma.customerLineLink.findFirst.mockResolvedValue(null);
    await expect(findFinanceLineRecipient(prisma as never, 'c1')).resolves.toBeNull();
  });
});
