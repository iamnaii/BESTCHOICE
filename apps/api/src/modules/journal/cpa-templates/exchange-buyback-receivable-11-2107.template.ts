import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ExchangeBuybackReceivableInput {
  newContractId: string;
  /** ราคารับซื้อเครื่องเดิม (ที่ A.2 พักไว้ที่ 21-1106) — ต้อง > 0 */
  buyback: Decimal;
}

/**
 * Exchange A.3 — ปิดบัญชีพัก 21-1106 ด้วยการตั้ง "ลูกหนี้-หน้าร้าน" 11-2107
 * (คำสั่งเจ้าของ 2026-08-03 — SUPERSEDES D5 สำหรับเส้นทางเปลี่ยนเครื่อง)
 *
 *   Dr 11-2107 ลูกหนี้-หน้าร้าน            [buyback]
 *     Cr 21-1106 บัญชีพักเครดิตเปลี่ยนเครื่อง [buyback]
 *
 * ทิศทางเดียวเสมอ ไม่มีการแตกกรณี ไม่มีขาเงินสด และ balanced โดยโครงสร้าง.
 *
 * WHAT CHANGED (และทำไม)
 * ----------------------
 * เดิม (D5, 2026-07-29) template นี้ชื่อ `ExchangeClearVendor21_1106Template`
 * และโพสต์ `Dr 21-1101 + Dr 21-1102 + ขาเงินสด / Cr 21-1106` — คือ **หักกลบ**
 * เจ้าหนี้หน้าร้านของสัญญาใหม่กับเครดิตราคารับซื้อของเครื่องเดิม แล้วโอนส่วนต่าง
 * เป็นเงินสดทันทีในทรานแซคชันเดียวกับ finalize ("สมมติฐานโอนวันเดียวกัน").
 *
 * เจ้าของสั่งเปลี่ยน 2026-08-03: **ห้ามมีการเคลื่อนไหวเงินสดในวันเปลี่ยนเครื่อง**
 *   1. ราคารับซื้อ = เงินที่ SHOP ติด FINANCE อยู่ → เป็น **ลูกหนี้ฝั่ง FINANCE**
 *      บัญชี 11-2107 (บัญชีเดิมที่มีอยู่แล้ว ใช้ร่วมกับเส้นทาง shop-collect —
 *      ล้างเมื่อหน้าร้านโอนเงินเข้า FINANCE ด้วย `Dr <cash> / Cr 11-2107` ผ่าน
 *      `ContractPaymentService.settleShopCollect`).
 *   2. เจ้าหนี้ยอดจัด/ค่าคอมของสัญญาใหม่ (21-1101 / 21-1102 ที่ A.1 ตั้งไว้)
 *      **ค้างไว้ตามปกติ** เพื่อให้ไหลเข้าคิว "จ่ายให้หน้าร้าน (INTER-CO)"
 *      เหมือนสัญญาขายปกติทุกประการ (เจ้าของ: "จ่ายหน้าร้านเหมือนขายปกติ").
 *
 * ผลข้างเคียงที่ตั้งใจ: สัญญาเปลี่ยนเครื่อง**จะปรากฏ**ใน
 * `IntercoPendingService.getPendingContracts()` แล้ว (ต่างจากเดิมที่ไม่เคยโผล่
 * เพราะ 21-1101/21-1102 ถูกล้างทันที) โดยมี `legacyNoShop = false` เพราะ
 * `ShopInventoryTransferTemplate` ตั้ง S11-3001/S11-3002 ฝั่ง SHOP ไว้แล้ว
 * ตั้งแต่ finalize.
 *
 * ASYMMETRY ที่รู้ตัว (ไม่ประดิษฐ์บัญชีใหม่): ผัง SHOP ไม่มีบัญชี
 * "เจ้าหนี้ FINANCE" ดังนั้นสมุด SHOP **ไม่มี** ขาคู่ของ 11-2107 — เหมือนกับ
 * เส้นทาง shop-collect เดิมที่ 11-2107 เป็น FINANCE-side-only อยู่แล้ว. รอ CPA
 * ตัดสินว่าจะเปิดบัญชีเจ้าหนี้ฝั่ง SHOP หรือไม่.
 *
 * Idempotency: `flow + idempotencyKey(newContractId)` ผ่าน partial unique index
 * `journal_entries_idempotency_idx` — หนึ่งใบต่อสัญญาใหม่หนึ่งสัญญา.
 * `metadata.contractId = newContractId` ทำให้ sweep ของ
 * `ExchangeCancelReversalTemplate` เก็บ JE ใบนี้ไปกลับรายการตอนยกเลิกได้เอง.
 */
@Injectable()
export class ExchangeBuybackReceivable11_2107Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    input: ExchangeBuybackReceivableInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    const buyback = new Decimal(input.buyback.toString());
    if (buyback.lte(0)) {
      throw new BadRequestException(
        'ราคารับซื้อเครื่องเดิมต้องมากกว่า 0 — ไม่สามารถตั้งลูกหนี้หน้าร้านได้',
      );
    }
    const zero = new Decimal(0);

    return this.journal.createAndPost(
      {
        description: `Exchange A.3 — ตั้งลูกหนี้หน้าร้าน 11-2107 ล้างบัญชีพัก 21-1106 (ราคารับซื้อ ${buyback.toFixed(2)})`,
        metadata: {
          flow: 'exchange-buyback-receivable-11-2107',
          idempotencyKey: input.newContractId,
          contractId: input.newContractId,
          newContractId: input.newContractId,
          buyback: buyback.toString(),
        },
        lines: [
          {
            accountCode: '11-2107',
            dr: buyback,
            cr: zero,
            description: 'ลูกหนี้-หน้าร้าน (ราคารับซื้อเครื่องเดิม — เปลี่ยนเครื่อง)',
          },
          {
            accountCode: '21-1106',
            dr: zero,
            cr: buyback,
            description: 'ล้างบัญชีพักเครดิตเปลี่ยนเครื่อง',
          },
        ],
      },
      tx,
    );
  }
}
