import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * ล้างเงินมัดจำเมื่อใบจองกลายเป็นใบขาย (A5, คำวินิจฉัยผู้สอบ 2026-08-25)
 *
 * ## ทำไมต้องเป็น JE แยกใบ ไม่ใช่บรรทัดเพิ่มในใบขาย
 *
 * ตอนแปลงใบจองเป็นใบขาย ระบบโพสต์ `ShopCashSaleTemplate` ตามปกติ ซึ่งเดบิต
 * **เงินสดเต็มยอดขาย** — แต่ความจริงเงินเข้ามาสองครั้ง: มัดจำ (วันจอง) + ส่วนที่เหลือ
 * (วันรับของ) และมัดจำถูกเดบิตเงินสดไปแล้วตั้งแต่วันจอง
 *
 * ใบนี้จึงปรับให้ตรงความจริง:
 *
 *   Dr S21-2002 เงินรับล่วงหน้า - มัดจำสินค้า  [depositAmount]
 *     Cr <บัญชีเงินสด/ธนาคารของสาขา>          [depositAmount]
 *
 * รวมสองใบแล้วได้ผลถูกต้อง — สมมติขาย 20,000 มัดจำ 2,000:
 *
 *   วันจอง      Dr เงินสด 2,000   / Cr S21-2002 2,000
 *   วันรับของ   Dr เงินสด 20,000  / Cr รายได้ 20,000   (ใบขาย)
 *               Dr S21-2002 2,000 / Cr เงินสด 2,000     (ใบนี้)
 *   ───────────────────────────────────────────────────
 *   เงินสดสุทธิ 20,000 · S21-2002 = 0 · รายได้ 20,000
 *
 * เงินสดสุทธิเท่ากับเงินที่รับจริงทั้งหมด และหนี้สินมัดจำถูกล้างหมดพอดี
 *
 * **เหตุที่ไม่ไปเพิ่มขาใน `ShopCashSaleTemplate`:** เทมเพลตนั้นใช้ร่วมกับการขายสด
 * ปกติซึ่งเป็นเส้นทางหลักของหน้าร้าน และเพิ่งแก้บั๊ก F1 เรื่องรูป `reference`
 * ที่ทำให้ขายสดพร้อมของแถมล่มทั้งใบ — การเพิ่มพารามิเตอร์ใหม่เข้าไปเสี่ยงกว่าการ
 * แยกใบ และแยกใบยังอ่านง่ายกว่าเวลาตรวจสอบย้อนหลัง (แต่ละใบเล่าเหตุการณ์เดียว)
 */
export interface ShopBookingDepositAppliedInput {
  /** กันโพสต์ซ้ำ — ใช้ `booking-deposit-applied:<bookingId>` */
  idempotencyKey: string;
  bookingId: string;
  bookingNumber?: string;
  saleId: string;
  saleNumber?: string;
  /** ต้องเป็นรหัสฝั่ง SHOP — บัญชีเดียวกับที่ใบขายเดบิตเงินสดเข้าไป */
  cashAccountCode: string;
  depositAmount: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopBookingDepositAppliedTemplate {
  private readonly logger = new Logger(ShopBookingDepositAppliedTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /** คืน `null` เมื่อใบจองนั้นไม่มี JE ตั้งหนี้มัดจำ (ยุคก่อนฟีเจอร์นี้) */
  async execute(
    input: ShopBookingDepositAppliedInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const deposit = new Decimal(input.depositAmount.toString());
    if (!deposit.gt(zero)) {
      throw new BadRequestException('ShopBookingDepositApplied: depositAmount must be > 0');
    }
    if (!input.cashAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopBookingDepositApplied: cashAccountCode must be SHOP-side (S-prefix); got ${input.cashAccountCode}`,
      );
    }

    const label = input.bookingNumber ?? input.bookingId;
    const lines: JeLineInput[] = [
      {
        accountCode: 'S21-2002',
        dr: deposit,
        cr: zero,
        description: `ล้างเงินรับล่วงหน้า - มัดจำใบจอง ${label} (ส่งมอบแล้ว)`,
      },
      {
        accountCode: input.cashAccountCode,
        dr: zero,
        cr: deposit,
        description: 'ปรับเงินสดที่นับซ้ำ — มัดจำเดบิตไปแล้วตั้งแต่วันจอง',
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string } | null> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-deposit-applied' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopBookingDepositAppliedTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      // ด่านเดียวกับขาริบ: ไม่มีขาตั้งหนี้ = ล้างไม่ได้ ไม่งั้น S21-2002 ติดลบ
      const depositJe = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-deposit' } as any },
            { metadata: { path: ['bookingId'], equals: input.bookingId } as any },
          ],
          status: 'POSTED',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!depositJe) {
        this.logger.warn(
          `ShopBookingDepositAppliedTemplate ข้าม — ใบจอง ${label} ไม่มี JE รับมัดจำ ` +
            `(วางมัดจำก่อนฟีเจอร์นี้ขึ้น) · forward-only`,
        );
        return null;
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ล้างมัดจำเข้าการขาย — ใบจอง ${label} → ใบขาย ${input.saleNumber ?? input.saleId} (SHOP)`,
          reference: `booking:${input.bookingId}:deposit-applied`,
          metadata: {
            tag: 'SHOP_BOOKING_DEPOSIT_APPLIED',
            flow: 'shop-booking-deposit-applied',
            idempotencyKey: input.idempotencyKey,
            bookingId: input.bookingId,
            bookingNumber: input.bookingNumber ?? null,
            // stamp saleId ด้วย — การยกเลิกใบขายกวาด JE ด้วยคีย์นี้
            saleId: input.saleId,
            saleNumber: input.saleNumber ?? null,
            companyCode: 'SHOP',
            depositAmount: deposit.toFixed(2),
          },
          postedAt: input.postedAt ?? new Date(),
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );
      return { entryNo: result.entryNumber, journalEntryId: result.id };
    };

    return outerTx ? run(outerTx) : this.prisma.$transaction(run);
  }
}
