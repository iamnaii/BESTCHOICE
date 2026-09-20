import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopCollectSettlementTemplate } from './shop-collect-settlement.template';

/**
 * ด่านกันล้างซ้ำสองทาง (ใบรับเครื่องคืน 2026-09-20 §6.4) + Σ deduction รวม deviceReturnAmount.
 * Runner: vitest — ไฟล์ใต้ cpa-templates/ ถูก jest ignore (testPathIgnorePatterns) และ CI รันด้วย glob
 * `src/modules/journal/cpa-templates/*.spec.ts` (deploy-gcp.yml L263) เหมือน shop-collect-shop-legs.template.spec.ts.
 * Prisma mock ทั้งก้อน: `$queryRaw` = deviceReturnFinanceBalance (sumTyped), `journalLine.findMany` =
 * outstanding 11-2107 ต่อสัญญา, `interCoSettlementItem.findMany` = deduction ของ batch,
 * `contract.findUnique` = resolveContractLabel, `journalEntry.findFirst` = requestId dedupe (null = ไม่ซ้ำ).
 */
const D = (v: string | number) => new Prisma.Decimal(v);

function build(opts: {
  deviceReturnBalance: string;
  history?: boolean;
  lines?: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>;
  deductionItems?: Array<{
    swapCreditAmount: Prisma.Decimal;
    recallAmount: Prisma.Decimal;
    deviceReturnAmount: Prisma.Decimal;
    batch: { status: string; batchNumber: string };
  }>;
}) {
  const createAndPost = vi.fn().mockResolvedValue({ id: 'je-1', entryNumber: 'JE-202609-00001' });
  const prisma = {
    journalEntry: {
      findFirst: vi
        .fn()
        .mockImplementation(async (args) =>
          args.select?.id && opts.history ? { id: 'historic-je' } : null,
        ),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ balance: opts.deviceReturnBalance }]),
    journalLine: { findMany: vi.fn().mockResolvedValue(opts.lines ?? []) },
    interCoSettlementItem: { findMany: vi.fn().mockResolvedValue(opts.deductionItems ?? []) },
    contract: { findUnique: vi.fn().mockResolvedValue({ contractNumber: 'DRTEST-001' }) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = new ShopCollectSettlementTemplate({ createAndPost } as any, prisma as any);
  return { template, prisma, createAndPost };
}

const baseInput = {
  contractId: 'c-1',
  depositAccountCode: '11-1201',
  amount: 7000,
  requestId: 'req-1',
};
const GUARD_MSG =
  'สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น';
const lineTuples = (input: {
  lines: Array<{
    accountCode: string;
    dr: Prisma.Decimal;
    cr: Prisma.Decimal;
    description?: string;
  }>;
}) => input.lines.map((l) => [l.accountCode, l.dr.toFixed(2), l.cr.toFixed(2), l.description]);

describe('history and retry semantics', () => {
  it.each(['SHOP_COLLECT', 'PAYOUT_RECALL'] as const)(
    'zero typed balance with history rejects %s before outstanding',
    async (typeStamp) => {
      const { template, prisma, createAndPost } = build({
        deviceReturnBalance: '0',
        history: true,
        lines: [{ debit: D(7000), credit: D(0) }],
      });
      await expect(template.execute({ ...baseInput, typeStamp })).rejects.toThrow(GUARD_MSG);
      expect(prisma.journalEntry.findFirst).toHaveBeenLastCalledWith({
        where: {
          status: 'POSTED',
          deletedAt: null,
          AND: [
            { metadata: { path: ['contractId'], equals: 'c-1' } },
            { metadata: { path: ['shopReceivableType'], equals: 'DEVICE_RETURN' } },
          ],
          lines: { some: { accountCode: '11-2107', deletedAt: null } },
        },
        select: { id: true },
      });
      expect(prisma.journalLine.findMany).not.toHaveBeenCalled();
      expect(createAndPost).not.toHaveBeenCalled();
    },
  );
  it('requestId retry succeeds before balance/history checks', async () => {
    const { template, prisma, createAndPost } = build({
      deviceReturnBalance: '7000',
      history: true,
    });
    prisma.journalEntry.findFirst.mockResolvedValueOnce({
      entryNumber: 'JE-existing',
      metadata: { amount: '7000.00' },
    });
    await expect(template.execute(baseInput)).resolves.toEqual({
      entryNo: 'JE-existing',
      deduped: true,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledTimes(1);
    expect(createAndPost).not.toHaveBeenCalled();
  });
});

describe('ShopCollectSettlementTemplate — ด่านค่าเครื่องคืน (§6.4)', () => {
  it('typeStamp เริ่มต้น (SHOP_COLLECT) + มีค่าเครื่องคืนค้าง → 400 ชี้ทางรอบจ่าย ไม่โพสต์ ไม่คำนวณ outstanding', async () => {
    const { template, prisma, createAndPost } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await expect(template.execute(baseInput)).rejects.toThrow(BadRequestException);
    await expect(template.execute(baseInput)).rejects.toThrow(GUARD_MSG);
    expect(createAndPost).not.toHaveBeenCalled();
    expect(prisma.journalLine.findMany).not.toHaveBeenCalled(); // ด่านอยู่ก่อน outstanding
    expect(prisma.journalEntry.findFirst).toHaveBeenCalled(); // แต่หลัง requestId idempotency
  });

  it('typeStamp PAYOUT_RECALL + มีค่าเครื่องคืนค้าง → ปฏิเสธเช่นกัน (ยกเว้นเฉพาะ DEVICE_RETURN)', async () => {
    const { template, createAndPost } = build({ deviceReturnBalance: '7000' });
    await expect(template.execute({ ...baseInput, typeStamp: 'PAYOUT_RECALL' })).rejects.toThrow(
      GUARD_MSG,
    );
    expect(createAndPost).not.toHaveBeenCalled();
  });

  it('typeStamp DEVICE_RETURN → ข้ามด่าน แล้วโพสต์ใบที่ stamp DEVICE_RETURN + คำอธิบายค่าเครื่องคืน', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    const result = await template.execute({ ...baseInput, typeStamp: 'DEVICE_RETURN' });
    expect(result).toEqual({ entryNo: 'JE-202609-00001', deduped: false });

    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe(
      'รับเงินค่าเครื่องคืนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107 ค่าเครื่องคืน)',
    );
    expect(input.reference).toBe('c-1:shop-collect-settlement:req-1');
    expect(input.metadata).toMatchObject({
      tag: 'SCS',
      flow: 'shop-collect-settlement',
      contractId: 'c-1',
      amount: '7000.00',
      depositAccountCode: '11-1201',
      requestId: 'req-1',
      shopReceivableType: 'DEVICE_RETURN',
      idempotencyKey: 'c-1:req-1',
    });
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับเงินค่าเครื่องคืนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (ค่าเครื่องคืน)'],
    ]);
  });

  it('ไม่มีค่าเครื่องคืนค้าง (0) → ด่านเงียบ ไปต่อด่านเดิม (ไม่มียอด 11-2107 ค้าง)', async () => {
    const { template } = build({ deviceReturnBalance: '0' });
    await expect(template.execute(baseInput)).rejects.toThrow(/ไม่มียอด 11-2107 ค้างชำระ/);
  });

  it('outstanding หัก deviceReturnAmount ของ batch POSTED ด้วย + where.OR ครอบคอลัมน์ใหม่', async () => {
    const { template, prisma } = build({
      deviceReturnBalance: '7000',
      lines: [{ debit: D(7000), credit: D(0) }],
      deductionItems: [
        {
          swapCreditAmount: D(0),
          recallAmount: D(0),
          deviceReturnAmount: D(7000),
          batch: { status: 'POSTED', batchNumber: 'IC-20260920-0001' },
        },
      ],
    });
    await expect(template.execute({ ...baseInput, typeStamp: 'DEVICE_RETURN' })).rejects.toThrow(
      /ไม่มียอด 11-2107 ค้างชำระ/,
    );
    const where = prisma.interCoSettlementItem.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { swapCreditAmount: { gt: 0 } },
      { recallAmount: { gt: 0 } },
      { deviceReturnAmount: { gt: 0 } },
    ]);
    const select = prisma.interCoSettlementItem.findMany.mock.calls[0][0].select;
    expect(select.deviceReturnAmount).toBe(true);
  });

  it('พฤติกรรมเดิม (SHOP_COLLECT ไม่มีค่าเครื่องคืน) byte-identical: คำอธิบาย/stamp เดิม', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '0',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await template.execute(baseInput);
    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe('รับโอนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107)');
    expect(input.metadata.shopReceivableType).toBe('SHOP_COLLECT');
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับโอนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (shop-collect)'],
    ]);
  });

  it('PAYOUT_RECALL ไม่มีค่าเครื่องคืน byte-identical: คำอธิบายเรียกคืนเดิม', async () => {
    const { template, createAndPost } = build({
      deviceReturnBalance: '0',
      lines: [{ debit: D(7000), credit: D(0) }],
    });
    await template.execute({ ...baseInput, typeStamp: 'PAYOUT_RECALL' });
    const input = createAndPost.mock.calls[0][0];
    expect(input.description).toBe(
      'รับเงินคืนจากหน้าร้าน — สัญญา DRTEST-001 (ล้าง 11-2107 เรียกคืน)',
    );
    expect(lineTuples(input)).toEqual([
      ['11-1201', '7000.00', '0.00', 'รับเงินคืนจากหน้าร้าน 7000.00 ฿'],
      ['11-2107', '0.00', '7000.00', 'ล้างลูกหนี้-หน้าร้าน (เรียกคืนยกเลิก)'],
    ]);
  });
});
