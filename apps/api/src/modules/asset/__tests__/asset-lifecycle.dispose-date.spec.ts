import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { AssetLifecycleService } from '../services/asset-lifecycle.service';

/**
 * AssetLifecycleService.dispose — ด่าน "วันที่จำหน่ายต้องไม่อยู่ในอนาคต" นับตามวันปฏิทินไทย (2026-11-18)
 *
 * disposalDate 'YYYY-MM-DD' ถูกแปลงเป็น 00:00 UTC = 07:00 น. ไทยของวันนั้น (ค่านี้ยังเป็นวันที่ลงรายการบัญชี — ไม่เปลี่ยน)
 * เดิมเทียบ getTime() กับ Date.now() ⇒ ช่วง 00:00–06:59 น. ไทย การจำหน่าย "วันนี้" ถูกปฏิเสธว่าเป็นอนาคต
 * เทสต์นี้ hand-built mock (ไม่แตะ DB) — เคสเต็มของ dispose อยู่ที่ asset.service.spec.ts (DB spec)
 */
describe('AssetLifecycleService.dispose — ด่านวันที่ในอนาคต', () => {
  const asset = {
    id: 'asset-1',
    assetCode: 'EQ-0001',
    status: 'POSTED',
    netBookValue: new Decimal(1000),
  };
  const dto = {
    disposalType: 'WRITE_OFF' as const,
    disposalDate: '2026-11-18',
    reason: 'ตัดจำหน่ายทดสอบ',
  };

  function build() {
    const tx = {
      fixedAsset: {
        findUnique: jest.fn().mockResolvedValue({ status: 'WRITTEN_OFF' }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      fixedAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'finance-co-1' }) },
      accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    const disposalTemplate = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) };
    const service = new AssetLifecycleService(
      prisma as never,
      {} as never,
      {} as never,
      disposalTemplate as never,
      {} as never,
      {} as never,
    );
    return { service, disposalTemplate };
  }

  afterEach(() => jest.useRealTimers());

  it('03:00 น. ไทยของ 18 พ.ย. (= 17 พ.ย. 20:00Z) จำหน่ายวันที่ 18 พ.ย. ได้ · วันที่ลงรายการยังเป็น 07:00 น. ไทยเหมือนเดิม', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
    const { service, disposalTemplate } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
    expect(disposalTemplate.execute.mock.calls[0][0].disposalDate.toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  it('00:00 น. ไทยตรง (= 17 พ.ย. 17:00:00.000Z) จำหน่ายวันนี้ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T17:00:00.000Z'));
    const { service } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
  });

  it('17:00 น. ไทยของวันเดียวกัน จำหน่ายวันนี้ได้ (เหมือนเดิม)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const { service } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).resolves.toEqual({ entryNo: 'JE-1' });
  });

  it('23:59:59.999 น. ไทยของ 17 พ.ย. จำหน่ายวันที่ 18 พ.ย. (พรุ่งนี้) ไม่ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T16:59:59.999Z'));
    const { service, disposalTemplate } = build();
    await expect(service.dispose('asset-1', dto, 'user-1')).rejects.toThrow(BadRequestException);
    await expect(service.dispose('asset-1', dto, 'user-1')).rejects.toThrow(/อนาคต/);
    expect(disposalTemplate.execute).not.toHaveBeenCalled();
  });

  it('03:00 น. ไทยของ 18 พ.ย. จำหน่ายวันที่ 19 พ.ย. ไม่ได้', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T20:00:00.000Z'));
    const { service, disposalTemplate } = build();
    await expect(
      service.dispose('asset-1', { ...dto, disposalDate: '2026-11-19' }, 'user-1'),
    ).rejects.toThrow(/อนาคต/);
    expect(disposalTemplate.execute).not.toHaveBeenCalled();
  });
});
