import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';

/**
 * เงินมัดจำใบจอง — บันทึก **ตอนรับเงิน** (คำวินิจฉัยผู้สอบบัญชี A5, 2026-08-25)
 *
 * ก่อนหน้านี้โมดูล `bookings` **ไม่โพสต์ JE เลยแม้แต่ใบเดียว** ⇒ เงินมัดจำที่รับจาก
 * ลูกค้าจริงไม่เคยขึ้นสมุด และบัญชี `S21-2002 เงินรับล่วงหน้า - มัดจำสินค้า`
 * มีอยู่ในผังแต่ไม่มีผู้สร้างรายการที่ไหนเลย
 *
 * ผู้สอบตอบว่าให้บันทึก "ตอนรับเงิน" (ไม่ใช่รอตอนแปลงเป็นใบขาย) เพราะเงินสด
 * เข้าลิ้นชักจริงตั้งแต่วันวางมัดจำ ⇒ ปล่อยให้สมุดเงียบระหว่างนั้นไม่ได้
 *
 * ## JE (SHOP ฝั่งเดียว — ไม่มีขา FINANCE)
 *
 *   Dr <บัญชีเงินสด/ธนาคารของสาขา>            [depositAmount]
 *     Cr S21-2002 เงินรับล่วงหน้า - มัดจำสินค้า  [depositAmount]
 *
 * `S21-2002` ค้างไว้จนกว่าจะเกิดหนึ่งใน 3 ทาง:
 *   1. **ลูกค้ามารับของ** → `convertToSale` ล้าง `Dr S21-2002` พร้อมโพสต์ขายตามปกติ
 *   2. **ยกเลิกใบจอง** → กลับรายการ `Dr S21-2002 / Cr เงินสด` (คืนเงินลูกค้า)
 *   3. **หมดอายุ ริบมัดจำ** → ⛔ **ยังทำไม่ได้** — ผังไม่มีบัญชีรายได้ริบมัดจำ
 *      (เสนอ `S41-1203` ให้ผู้สอบยืนยันแล้ว ดู `docs/accounting/cpa-questions-round3-2026-08-25.txt`
 *      ข้อ 2) **ห้ามเดารหัสบัญชีเอง** — หลักเดียวกับ "ห้ามเดา JE ปิดช่องว่าง"
 *
 * ## บัญชีเงินสดมาจากไหน
 *
 * **ไม่ได้ใช้ `Booking.depositAccountCode`** — ฟิลด์นั้น validate ด้วย regex
 * `/^11-1[12]0[123]$/` ซึ่งเป็นรหัสฝั่ง **FINANCE** ทั้งที่เงินเข้าหน้าร้าน
 * (คลาสเดียวกับ "JE ลงผิดสมุด" ที่เจอบน prod)
 *
 * ผู้เรียกต้อง resolve ผ่าน `ShopAccountResolver.resolveInflowCashAccount(branchId, method)`
 * ซึ่ง fail-closed ถ้าสาขายังไม่ได้ตั้ง `shopCashAccountCode` — เงินสด → ลิ้นชักสาขา,
 * โอน/QR → ธนาคารรับเงิน `S11-1201`
 */
export interface ShopBookingDepositInput {
  /** กันโพสต์ซ้ำ — ใช้ `booking-deposit:<bookingId>` */
  idempotencyKey: string;
  bookingId: string;
  bookingNumber?: string;
  /** ต้องเป็นรหัสฝั่ง SHOP (ขึ้นต้น S) — ได้จาก ShopAccountResolver */
  cashAccountCode: string;
  depositAmount: Decimal;
  postedAt?: Date;
}

@Injectable()
export class ShopBookingDepositTemplate {
  private readonly logger = new Logger(ShopBookingDepositTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  async execute(
    input: ShopBookingDepositInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string }> {
    const zero = new Decimal(0);
    const deposit = new Decimal(input.depositAmount.toString());
    if (!deposit.gt(zero)) {
      throw new BadRequestException('ShopBookingDeposit: depositAmount must be > 0');
    }
    if (!input.cashAccountCode.startsWith('S')) {
      throw new BadRequestException(
        `ShopBookingDeposit: cashAccountCode must be SHOP-side (S-prefix); got ${input.cashAccountCode}`,
      );
    }

    const label = input.bookingNumber ?? input.bookingId;
    const lines: JeLineInput[] = [
      {
        accountCode: input.cashAccountCode,
        dr: deposit,
        cr: zero,
        description: `รับเงินมัดจำใบจอง ${label}`,
      },
      {
        accountCode: 'S21-2002',
        dr: zero,
        cr: deposit,
        description: 'เงินรับล่วงหน้า - มัดจำสินค้า รอส่งมอบ',
      },
    ];

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string }> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-booking-deposit' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopBookingDepositTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `รับเงินมัดจำ — ใบจอง ${label} (SHOP)`,
          reference: `booking:${input.bookingId}:deposit`,
          metadata: {
            tag: 'SHOP_BOOKING_DEPOSIT',
            flow: 'shop-booking-deposit',
            idempotencyKey: input.idempotencyKey,
            bookingId: input.bookingId,
            bookingNumber: input.bookingNumber ?? null,
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
