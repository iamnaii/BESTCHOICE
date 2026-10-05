import { StockAdjustmentNumberService } from './stock-adjustment-number.service';
import { bkkYyyymmdd } from '../../utils/document-number-format.util';

/** เลขคำขอตัดสินค้า SA-YYYYMMDD-NNNN — advisory lock ต่อวันไทย แบบ IntercoBatchNumberService */
describe('StockAdjustmentNumberService.next', () => {
  const day = new Date('2026-10-05T03:00:00Z');
  const ymd = bkkYyyymmdd(day);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (last: string | null) => {
    const tx: any = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      stockAdjustment: { findFirst: jest.fn().mockResolvedValue(last ? { requestNumber: last } : null) },
    };
    return { tx, svc: new StockAdjustmentNumberService({} as never) };
  };

  it('วันแรกของวัน → 0001 และล็อก advisory ก่อนอ่าน', async () => {
    const { tx, svc } = build(null);
    await expect(svc.next(tx, day)).resolves.toBe(`SA-${ymd}-0001`);
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toMatch(/pg_advisory_xact_lock/);
    expect(tx.stockAdjustment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { requestNumber: { startsWith: `SA-${ymd}-` } }, orderBy: { requestNumber: 'desc' } }),
    );
  });

  it('มีใบล่าสุด -0042 → 0043', async () => {
    const { tx, svc } = build(`SA-${ymd}-0042`);
    await expect(svc.next(tx, day)).resolves.toBe(`SA-${ymd}-0043`);
  });
});
