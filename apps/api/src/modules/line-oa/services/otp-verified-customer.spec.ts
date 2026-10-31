import {
  ACTIVE_FINANCE_LINK_WHERE,
  FINANCE_LINE_RECIPIENT_SELECT,
  FINANCE_LINE_STATUS_SELECT,
  LEGACY_SHOP_LINE_ID_CUTOFF,
  financeLineRecipient,
  findFinanceLineRecipient,
  findFinanceLineRoomStatuses,
  findOtpVerifiedCustomerId,
  findOtpVerifiedRoomCustomerId,
  VERIFIED_FINANCE_LINK_WHERE,
  findShopLiffCustomerId,
  withFinanceLineStatus,
  withVerifiedFinanceLine,
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

/**
 * Task 24 RR-M2 — หน้าจอพนักงานเปิดปุ่ม "ส่ง LINE" ตามเกณฑ์เดียวกับผู้ส่งจริง (แถว OTP ที่ยังผูก) ไม่ใช่คอลัมน์ · ไม่ส่ง U-id ของแถวออกไปหน้าเว็บ
 */
describe('withVerifiedFinanceLine', () => {
  it('มีแถว OTP ที่ยังผูก → hasVerifiedLine = true · ตัด lineLinks ออก (ไม่ส่ง U-id) · ช่องอื่นคงเดิม', () => {
    const out = withVerifiedFinanceLine({
      id: 'c1',
      name: 'ก',
      lineIdFinance: null,
      lineLinks: [{ lineUserId: 'U-otp' }],
    });
    expect(out).toEqual({ id: 'c1', name: 'ก', lineIdFinance: null, hasVerifiedLine: true });
    expect(JSON.stringify(out)).not.toContain('U-otp');
  });

  it('คอลัมน์มีค่าแต่ไม่มีแถว OTP → hasVerifiedLine = false (ผู้ส่งจะไม่ส่ง)', () => {
    expect(withVerifiedFinanceLine({ id: 'c2', lineIdFinance: 'U-typed', lineLinks: [] })).toEqual({
      id: 'c2',
      lineIdFinance: 'U-typed',
      hasVerifiedLine: false,
    });
  });

  it('เกณฑ์เดียวกับ financeLineRecipient ทุกกรณี', () => {
    for (const lineLinks of [undefined, [], [{ lineUserId: 'U1' }]]) {
      expect(withVerifiedFinanceLine({ lineLinks }).hasVerifiedLine).toBe(
        financeLineRecipient({ lineLinks }) !== null,
      );
    }
  });
});

/**
 * Task 27 — ฟอร์มแก้ไขลูกค้าแสดง "สถานะ" LINE น้องเบส (การเงิน) แทนช่องพิมพ์: `financeLine.verified` ใช้เกณฑ์เดียวกับผู้ส่ง/ปุ่ม "ส่ง LINE"
 * (แถว OTP ที่ยังผูก — `financeLineRecipient`) + วันที่ผูกของแถวนั้น · ไม่ส่ง U-id ของแถวออกไปหน้าเว็บ
 */
describe('withFinanceLineStatus / FINANCE_LINE_STATUS_SELECT', () => {
  it('select = แถว FINANCE ที่ยังผูก (ACTIVE_FINANCE_LINK_WHERE ตัวเดิม) + linkedAt · take 1', () => {
    expect(FINANCE_LINE_STATUS_SELECT).toEqual({
      lineLinks: {
        where: ACTIVE_FINANCE_LINK_WHERE,
        select: { lineUserId: true, linkedAt: true },
        take: 1,
      },
    });
  });

  it('มีแถว OTP ที่ยังผูก → verified + linkedAt (ISO) · ตัด lineLinks ออก ไม่ส่ง U-id', () => {
    const out = withFinanceLineStatus({
      id: 'c1',
      lineIdFinance: null,
      lineLinks: [{ lineUserId: 'U-otp', linkedAt: new Date('2026-10-30T03:00:00.000Z') }],
    });
    expect(out).toEqual({
      id: 'c1',
      lineIdFinance: null,
      financeLine: { verified: true, linkedAt: '2026-10-30T03:00:00.000Z' },
    });
    expect(JSON.stringify(out)).not.toContain('U-otp');
  });

  it.each([
    ['ไม่มีแถว (ปิดแล้ว/ไม่เคยผูก) แม้คอลัมน์มีค่า', 'U-typed', []],
    ['ไม่ได้เลือก lineLinks มา', 'U-typed', undefined],
  ])('%s → verified false · linkedAt null', (_label, column, lineLinks) => {
    expect(withFinanceLineStatus({ id: 'c2', lineIdFinance: column, lineLinks })).toEqual({
      id: 'c2',
      lineIdFinance: column,
      financeLine: { verified: false, linkedAt: null },
    });
  });

  it('เกณฑ์ verified เดียวกับ withVerifiedFinanceLine (ปุ่ม "ส่ง LINE") ทุกกรณี', () => {
    const at = new Date('2026-10-30T03:00:00.000Z');
    for (const lineLinks of [undefined, [], [{ lineUserId: 'U1', linkedAt: at }]]) {
      expect(withFinanceLineStatus({ lineLinks }).financeLine.verified).toBe(
        withVerifiedFinanceLine({ lineLinks }).hasVerifiedLine,
      );
    }
  });
});

/**
 * Task 33 (mockup A2/A3) — สถานะ LINE การเงินของห้องในอินบ็อกซ์: `verified` ใช้กติกาเดียวกับข้อความสำเร็จรูปของห้องการเงิน
 * (Task 24 round 3 — `findOtpVerifiedRoomCustomerId` ย้ายมาจาก CannedResponseSenderService) · ไม่คืน U-id
 */
describe('findOtpVerifiedRoomCustomerId (กติกาเดียวของ "ห้องนี้ยืนยัน OTP กับลูกค้าของห้อง")', () => {
  const prisma = { customerLineLink: { findFirst: jest.fn() } };
  beforeEach(() => prisma.customerLineLink.findFirst.mockReset());

  it('LINE ของห้องยืนยัน OTP กับลูกค้าของห้อง → ลูกค้าคนนั้น (เกณฑ์ VERIFIED_FINANCE_LINK_WHERE)', async () => {
    prisma.customerLineLink.findFirst.mockResolvedValue({ customerId: 'c1' });
    await expect(
      findOtpVerifiedRoomCustomerId(prisma as never, { lineUserId: 'U1', customerId: 'c1' }),
    ).resolves.toBe('c1');
    expect(prisma.customerLineLink.findFirst).toHaveBeenCalledWith({
      where: { lineUserId: 'U1', ...VERIFIED_FINANCE_LINK_WHERE },
      select: { customerId: true },
    });
  });

  it('ยืนยันกับลูกค้าคนอื่น / ไม่มีแถว / ห้องไม่มี LINE หรือลูกค้า → undefined', async () => {
    prisma.customerLineLink.findFirst.mockResolvedValue({ customerId: 'c2' });
    await expect(
      findOtpVerifiedRoomCustomerId(prisma as never, { lineUserId: 'U1', customerId: 'c1' }),
    ).resolves.toBeUndefined();
    prisma.customerLineLink.findFirst.mockResolvedValue(null);
    await expect(
      findOtpVerifiedRoomCustomerId(prisma as never, { lineUserId: 'U1', customerId: 'c1' }),
    ).resolves.toBeUndefined();
    await expect(
      findOtpVerifiedRoomCustomerId(prisma as never, { lineUserId: null, customerId: 'c1' }),
    ).resolves.toBeUndefined();
  });
});

describe('findFinanceLineRoomStatuses', () => {
  const prisma = { customerLineLink: { findMany: jest.fn() } };
  const at = new Date('2026-10-30T05:00:00.000Z');
  const legacy = new Date('2026-10-20T04:00:00.000Z');
  beforeEach(() => prisma.customerLineLink.findMany.mockReset());

  const room = (over: Record<string, unknown>) => ({
    id: 'r',
    channel: 'LINE_FINANCE',
    lineUserId: 'U1',
    customerId: 'c1',
    financeLineUnlinkedAt: null as Date | null,
    ...over,
  });

  it('ไม่มีห้อง LINE การเงินที่มีลูกค้า → ไม่ query · ห้องช่องอื่น/ไม่มีลูกค้า/ไม่มี LINE ไม่อยู่ในผล', async () => {
    const result = await findFinanceLineRoomStatuses(prisma as never, [
      room({ id: 'shop', channel: 'LINE_SHOP' }),
      room({ id: 'fb', channel: 'FACEBOOK', lineUserId: null }),
      room({ id: 'orphan', customerId: null }),
    ]);
    expect(prisma.customerLineLink.findMany).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('verified / ยกเลิกผูก (เวลาของห้องก่อน · ถอยไปแถว link ที่ปิดของคู่ LINE-ลูกค้าเดียวกัน) / ไม่เคยผูก', async () => {
    prisma.customerLineLink.findMany
      // แถว OTP ที่ยังผูก (VERIFIED_FINANCE_LINK_WHERE)
      .mockResolvedValueOnce([
        { lineUserId: 'U-ok', customerId: 'c1' },
        { lineUserId: 'U-moved', customerId: 'c9' },
      ])
      // แถวที่ปิดแล้ว (ข้อมูลก่อนห้องมีเวลาของตัวเอง)
      .mockResolvedValueOnce([
        { lineUserId: 'U-legacy', customerId: 'c1', unlinkedAt: legacy },
        { lineUserId: 'U-other', customerId: 'c7', unlinkedAt: legacy },
      ]);
    const result = await findFinanceLineRoomStatuses(prisma as never, [
      room({ id: 'ok', lineUserId: 'U-ok', financeLineUnlinkedAt: at }),
      room({ id: 'stamped', lineUserId: 'U-gone', financeLineUnlinkedAt: at }),
      room({ id: 'legacy', lineUserId: 'U-legacy' }),
      room({ id: 'other', lineUserId: 'U-other' }),
      room({ id: 'moved', lineUserId: 'U-moved' }),
      room({ id: 'never', lineUserId: 'U-never' }),
    ]);
    expect(Object.fromEntries(result)).toEqual({
      ok: { verified: true, unlinkedAt: null },
      stamped: { verified: false, unlinkedAt: at.toISOString() },
      legacy: { verified: false, unlinkedAt: legacy.toISOString() },
      // แถวที่ปิดเป็นของลูกค้าคนอื่น — ไม่ใช่ "LINE นี้ยกเลิกผูกกับลูกค้าของห้อง"
      other: { verified: false, unlinkedAt: null },
      // LINE ยืนยันกับลูกค้าอื่นอยู่ (ไม่ใช่ลูกค้าของห้อง) = ไม่ verified
      moved: { verified: false, unlinkedAt: null },
      never: { verified: false, unlinkedAt: null },
    });
    expect(prisma.customerLineLink.findMany).toHaveBeenNthCalledWith(1, {
      where: { lineUserId: { in: expect.any(Array) }, ...VERIFIED_FINANCE_LINK_WHERE },
      select: { lineUserId: true, customerId: true },
    });
    expect(JSON.stringify(Object.fromEntries(result))).not.toContain('U-');
  });
});
