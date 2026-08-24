import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ด่านของ `update()` สำหรับสองฟิลด์ที่เพิ่มเข้ามา 2026-08-24 (`companyId`,
 * `shopCashAccountCode`).
 *
 * ทำไมต้องมีเทส: `shopCashAccountCode` เป็น **fail-closed** — `ShopAccountResolver`
 * โยน 400 ทั้งใบเมื่อค่าว่าง ⇒ ขายสดเงินสด / รับเทิร์นจ่ายสด / activate สัญญาที่มี
 * เงินดาวน์สด ทำไม่ได้เลย. DTO ตรวจได้แค่รูปแบบ ส่วน "มีอยู่จริงในผังบัญชีไหม"
 * ต้องตรวจที่ service — ถ้าหลุด จะไปพังตอนขายจริงหน้าลูกค้าแทนที่จะพังตอนตั้งค่า
 */
describe('BranchesService.update — ด่านของ companyId / shopCashAccountCode', () => {
  let service: BranchesService;
  let prisma: any;

  const existingBranch = { id: 'br-1', name: 'สำนักงานใหญ่', deletedAt: null };

  beforeEach(async () => {
    prisma = {
      branch: {
        findUnique: jest.fn().mockResolvedValue(existingBranch),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existingBranch, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      companyInfo: { findFirst: jest.fn() },
      chartOfAccount: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [BranchesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(BranchesService);
  });

  describe('shopCashAccountCode', () => {
    it('ตั้งได้เมื่อบัญชีมีอยู่จริงและใช้งานอยู่', async () => {
      prisma.chartOfAccount.findFirst.mockResolvedValue({ code: 'S11-1101' });

      const result = await service.update('br-1', { shopCashAccountCode: 'S11-1101' });

      expect(result.shopCashAccountCode).toBe('S11-1101');
      expect(prisma.chartOfAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { code: 'S11-1101', status: 'ใช้งาน', deletedAt: null },
        }),
      );
    });

    it('ปฏิเสธเมื่อบัญชียังไม่มีในผัง — พร้อมบอกให้รัน seed:coa', async () => {
      // เคสจริงบน prod 2026-08-24: ผัง SHOP ยังเป็นชุดเก่า บัญชีใหม่ยังไม่ถูก seed
      prisma.chartOfAccount.findFirst.mockResolvedValue(null);

      await expect(service.update('br-1', { shopCashAccountCode: 'S11-1102' })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.update('br-1', { shopCashAccountCode: 'S11-1102' })).rejects.toThrow(
        /seed:coa/,
      );
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });

    it('ไม่แตะผังบัญชีเมื่อไม่ได้ส่งฟิลด์นี้มา', async () => {
      await service.update('br-1', { name: 'ชื่อใหม่' });

      expect(prisma.chartOfAccount.findFirst).not.toHaveBeenCalled();
      expect(prisma.branch.update).toHaveBeenCalled();
    });
  });

  describe('companyId', () => {
    it('ตั้งได้เมื่อบริษัทมีอยู่จริง', async () => {
      prisma.companyInfo.findFirst.mockResolvedValue({ id: 'co-shop' });

      const result = await service.update('br-1', { companyId: 'co-shop' });

      expect(result.companyId).toBe('co-shop');
    });

    it('ปฏิเสธเมื่อไม่พบบริษัท — กันสาขากำพร้าที่ทำให้ cron ข้ามด่านงวดบัญชี', async () => {
      // `installment-accrual.cron.ts` ส่ง `branch?.companyId ?? undefined` เข้า
      // `validatePeriodOpen` ซึ่งคืนค่าผ่านทันทีเมื่อไม่มี companyId
      prisma.companyInfo.findFirst.mockResolvedValue(null);

      await expect(service.update('br-1', { companyId: 'ไม่มีจริง' })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.branch.update).not.toHaveBeenCalled();
    });
  });

  it('ยังคงพฤติกรรมเดิม: ตั้งคลังกลางแล้วปลดคลังกลางเดิมก่อน', async () => {
    await service.update('br-1', { isMainWarehouse: true });

    expect(prisma.branch.updateMany).toHaveBeenCalledWith({
      where: { isMainWarehouse: true, id: { not: 'br-1' } },
      data: { isMainWarehouse: false },
    });
  });
});
