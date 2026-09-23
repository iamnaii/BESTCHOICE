import { AfterSalesDocNumberService } from '../services/after-sales-doc-number.service';

describe('AfterSalesDocNumberService', () => {
  const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), afterSalesCase: { findFirst: jest.fn() } };
  const svc = new AfterSalesDocNumberService({} as never);
  const bkkNoon = new Date('2026-09-24T05:00:00.000Z'); // 12:00 BKK

  it('เริ่มที่ 0001 เมื่อวันนั้นยังไม่มีเคส', async () => {
    tx.afterSalesCase.findFirst.mockResolvedValue(null);
    await expect(svc.nextCaseNumber(tx as never, bkkNoon)).resolves.toBe('AS-20260924-0001');
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
  });
  it('ต่อจากเลขสูงสุดของวัน (นับตามวัน BKK ไม่ใช่ UTC)', async () => {
    tx.afterSalesCase.findFirst.mockResolvedValue({ caseNumber: 'AS-20260924-0012' });
    await expect(svc.nextCaseNumber(tx as never, new Date('2026-09-23T17:30:00.000Z'))).resolves.toBe('AS-20260924-0013');
  });
});
