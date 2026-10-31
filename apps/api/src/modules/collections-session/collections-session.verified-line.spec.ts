import { CollectionsSessionService } from './collections-session.service';

/**
 * Task 24 RR-M2 — โหมดโฟกัส (`FocusContractCard`) เปิดปุ่ม "ส่ง LINE" ตาม `customer.hasVerifiedLine` = แถว OTP ที่ยังผูก
 * (เกณฑ์เดียวกับผู้ส่ง) ไม่ใช่คอลัมน์ · ตัวนับ "LINE" (ติดต่อได้ทาง LINE อย่างเดียว ไม่มีเบอร์) ใช้ค่าเดียวกัน · ไม่ส่ง U-id ของแถวออก
 */
describe('CollectionsSessionService.getMySession — hasVerifiedLine (Task 24 RR-M2)', () => {
  it('hasVerifiedLine มาจากแถว OTP · คอลัมน์อย่างเดียว = false · breakdown.lines นับเฉพาะที่ยืนยันแล้ว', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'a1',
        contractId: 'c1',
        escalationFlag: false,
        position: 0,
        status: 'PENDING',
        contract: { customer: { phone: null, lineIdFinance: 'U-typed', lineLinks: [] } },
      },
      {
        id: 'a2',
        contractId: 'c2',
        escalationFlag: false,
        position: 1,
        status: 'PENDING',
        contract: {
          customer: { phone: null, lineIdFinance: null, lineLinks: [{ lineUserId: 'U-otp' }] },
        },
      },
    ]);
    const service = new CollectionsSessionService({
      dailyAssignment: { findMany },
      contractDailySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);

    const result = await service.getMySession('u1');

    expect(findMany.mock.calls[0][0].include.contract.include.customer.select.lineLinks).toEqual({
      where: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
      select: { lineUserId: true },
      take: 1,
    });
    const byId = new Map(result.contracts.map((a) => [a.contractId, a.contract.customer]));
    expect(byId.get('c1')).toEqual({
      phone: null,
      lineIdFinance: 'U-typed',
      hasVerifiedLine: false,
    });
    expect(byId.get('c2')).toEqual({ phone: null, lineIdFinance: null, hasVerifiedLine: true });
    expect(JSON.stringify(result)).not.toContain('U-otp');
    expect(result.breakdown.lines).toBe(1);
  });
});
