import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/** 6 cash/bank accounts (accounting.md — Cash Account Dimension) */
export const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export interface ExchangeClearVendorInput {
  newContractId: string;
  buyback: Decimal;
  newVendorYodjat: Decimal;
  newVendorCommission: Decimal;
  /** จำเป็นเมื่อ buyback ≠ vendorSum (มีขาเงินสด) — 1 ใน CASH_ACCOUNT_CODES */
  depositAccountCode?: string;
}

/**
 * Exchange A.3 — Clear 21-1106 ตัดกับเจ้าหนี้หน้าร้านของสัญญาใหม่ + ขาเงินสด
 * (Device Swap 2026-07, spec §7.3 — workbook JE จุดที่ 3)
 *
 *   Dr 21-1101 [newVendorYodjat]
 *   Dr 21-1102 [newVendorCommission]
 *   Dr {cash}  [buyback − vendorSum]   ← ถ้า buyback > vendorSum (คืนเงินลูกค้า — Case 2G)
 *     Cr 21-1106 [buyback]
 *     Cr {cash}  [vendorSum − buyback] ← ถ้า buyback < vendorSum (โอนเพิ่มให้ SHOP — Cases 2A-2E)
 *
 * buyback == vendorSum → ไม่มีขาเงินสด (SP2 เดิม / Case 2F)
 * D5: ขาเงินสด post ทันทีตอน finalize (สมมติฐานโอนวันเดียวกัน — owner decision 2026-07-29)
 */
@Injectable()
export class ExchangeClearVendor21_1106Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeClearVendorInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const vendorSum = input.newVendorYodjat.plus(input.newVendorCommission);
    const diff = input.buyback.minus(vendorSum); // + = คืนลูกค้า, − = โอนเพิ่มให้ SHOP
    const zero = new Decimal(0);

    if (!diff.isZero()) {
      if (!input.depositAccountCode) {
        throw new BadRequestException(
          'ต้องระบุบัญชีเงินสด (depositAccountCode) เมื่อราคารับซื้อไม่เท่ากับเจ้าหนี้สัญญาใหม่',
        );
      }
      if (!(CASH_ACCOUNT_CODES as readonly string[]).includes(input.depositAccountCode)) {
        throw new BadRequestException(`บัญชีเงินสดไม่ถูกต้อง: ${input.depositAccountCode}`);
      }
    }

    const lines: Array<{ accountCode: string; dr: Decimal; cr: Decimal; description?: string }> = [
      {
        accountCode: '21-1101',
        dr: input.newVendorYodjat,
        cr: zero,
        description: 'เจ้าหนี้-หน้าร้าน (ยอดจัดเครื่องใหม่)',
      },
      {
        accountCode: '21-1102',
        dr: input.newVendorCommission,
        cr: zero,
        description: 'เจ้าหนี้ค่าคอม-หน้าร้าน (เครื่องใหม่)',
      },
    ];

    if (diff.gt(0)) {
      lines.push({
        accountCode: input.depositAccountCode!,
        dr: diff,
        cr: zero,
        description: 'จ่ายคืนลูกค้า (ราคารับซื้อ > เจ้าหนี้สัญญาใหม่ — Case 2G)',
      });
    }

    lines.push({
      accountCode: '21-1106',
      dr: zero,
      cr: input.buyback,
      description: 'ล้างบัญชีพักเครดิตเปลี่ยนเครื่อง',
    });

    if (diff.lt(0)) {
      lines.push({
        accountCode: input.depositAccountCode!,
        dr: zero,
        cr: diff.abs(),
        description: 'เงินสด/ธนาคาร โอนเพิ่มให้หน้าร้าน (ราคารับซื้อ < เจ้าหนี้)',
      });
    }

    return this.journal.createAndPost(
      {
        description: `Exchange A.3 — clear 21-1106 (${diff.isZero() ? 'perfect offset' : diff.gt(0) ? 'refund customer' : 'top-up to SHOP'})`,
        metadata: {
          flow: 'exchange-clear-vendor-21-1106',
          idempotencyKey: input.newContractId,
          contractId: input.newContractId,
          newContractId: input.newContractId,
          buyback: input.buyback.toString(),
          cashDiff: diff.toString(),
        },
        lines,
      },
      tx,
    );
  }
}
