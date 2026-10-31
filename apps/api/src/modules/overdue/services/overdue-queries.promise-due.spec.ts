import { OverdueQueriesService } from './overdue-queries.service';

/**
 * Task 24 RR-M2 — แบนเนอร์ "นัดครบกำหนดวันนี้" (`BrokenPromiseBanner`) ส่ง LINE รวดเดียวเฉพาะแถว `hasLine` ⇒ `hasLine`/`withLine`
 * ต้องใช้เกณฑ์เดียวกับผู้ส่ง (`bulkSendLine` — แถว OTP ที่ยังผูก) ไม่ใช่คอลัมน์ lineIdFinance
 */
describe('OverdueQueriesService.listPromiseDueRemindersToday — hasLine (Task 24 RR-M2)', () => {
  it('hasLine/withLine มาจากแถว OTP ที่ยังผูก · คอลัมน์อย่างเดียว = false · ไม่ส่ง U-id ออก', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'd1',
        contractId: 'c1',
        createdAt: new Date(),
        contract: {
          id: 'c1',
          contractNumber: 'BC-1',
          branchId: 'b1',
          customer: { id: 'cu1', name: 'ก', phone: '081', lineIdFinance: 'U-typed', lineLinks: [] },
        },
      },
      {
        id: 'd2',
        contractId: 'c2',
        createdAt: new Date(),
        contract: {
          id: 'c2',
          contractNumber: 'BC-2',
          branchId: 'b1',
          customer: { id: 'cu2', name: 'ข', phone: '082', lineLinks: [{ lineUserId: 'U-otp' }] },
        },
      },
    ]);
    const service = new OverdueQueriesService(
      { dunningAction: { findMany } } as never,
      {} as never,
    );

    const result = await service.listPromiseDueRemindersToday(null);

    expect(findMany.mock.calls[0][0].select.contract.select.customer.select.lineLinks).toEqual({
      where: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
      select: { lineUserId: true },
      take: 1,
    });
    expect(result.withLine).toBe(1);
    expect(result.data.map((r) => [r.contractId, r.hasLine])).toEqual([
      ['c1', false],
      ['c2', true],
    ]);
    expect(JSON.stringify(result)).not.toContain('U-otp');
  });
});
