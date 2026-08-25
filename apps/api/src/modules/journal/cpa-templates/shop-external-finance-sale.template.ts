import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompanyResolverService } from '../company-resolver.service';
import {
  EXTERNAL_FINANCE_RECEIVABLE_CODE,
  externalFinanceAccountsReady,
} from './external-finance-accounts';

/**
 * ขายผ่านบริษัทไฟแนนซ์ภายนอก — ลงบัญชีฝั่ง SHOP (C1, คำวินิจฉัยผู้สอบ 2026-08-25)
 *
 * `createExternalFinanceSale` เคยไม่โพสต์ JE เลย (มีแต่คอมเมนต์
 * `// TODO: Implement perpetual inventory journal`) ⇒ ส่งมอบเครื่องจริง
 * รับเงินดาวน์จริง ตั้งลูกหนี้ไฟแนนซ์จริง **แต่ไม่มีอะไรขึ้นสมุด SHOP เลย**
 * — ประชากรใหญ่กว่าเคสใบจอง (A5) ด้วยซ้ำ
 *
 * ## JE (SHOP ฝั่งเดียว)
 *
 *   Dr <เงินสด/ธนาคารสาขา>            [downPayment]      ← ลูกค้าจ่ายดาวน์ที่ร้าน
 *   Dr S11-3101 ลูกหนี้ไฟแนนซ์ภายนอก   [financeAmount]    ← รอรับจากบริษัทไฟแนนซ์
 *     Cr <รายได้ขายตามหมวดสินค้า>       [netAmount]
 *
 *   Dr <ต้นทุนขายตามหมวด>             [costPrice]
 *     Cr <สินค้าคงเหลือตามหมวด>         [costPrice]
 *
 * `downPayment + financeAmount === netAmount` — ยืนยันด้วย assertion ก่อนโพสต์
 * (สูตรใน `sale-writer.service.ts` คือ `financeAmount = netAmount − downPayment`
 * แต่ DTO ยอมให้ส่ง `financeAmount` มาเองได้ จึงต้องตรวจ ไม่ใช่เชื่อ)
 *
 * ## ⛔ ยังไม่ทำงานจนกว่าผังจะพร้อม
 *
 * `execute` คืน `null` ทันทีถ้าบัญชีที่ต้องใช้ยังไม่มีในผัง — ดูเหตุผลใน
 * `external-finance-accounts.ts` · **ไม่ throw** เพราะการขายต้องไม่ล่มเพราะ
 * เรื่องผังบัญชี (ลูกค้ายืนรออยู่หน้าเคาน์เตอร์)
 *
 * ## หนึ่ง JE ต่อใบขาย (ต่างจากขายสด)
 *
 * `ShopCashSaleTemplate` โพสต์ **หนึ่ง JE ต่อ (ใบขาย, สินค้า)** เพราะขายสดมีของแถม
 * ที่ต้องปันรายได้ตามต้นทุน แต่เส้นทางนี้มีสินค้าหลักตัวเดียวที่ตั้งลูกหนี้ได้
 * (ของแถมถูก flip เป็น `SOLD_CASH` แยกและไม่มีราคาขายของตัวเอง) จึงเป็นใบเดียว
 * `reference = sale:<saleId>:external-finance` — ไม่ชนกับรูป `sale:<saleId>:<productId>`
 * ของขายสด (บทเรียนบั๊ก F1 เรื่อง partial unique index `journal_entries_ref_unique`)
 */
export interface ShopExternalFinanceSaleInput {
  /** กันโพสต์ซ้ำ — ใช้ `shop-ext-finance-sale:<saleId>` */
  idempotencyKey: string;
  saleId: string;
  saleNumber?: string;
  productId: string;
  /** บัญชีเงินสด/ธนาคารที่รับเงินดาวน์ (ต้องขึ้นต้น S) */
  cashAccountCode: string;
  inventoryAccountCode: string;
  cogsAccountCode: string;
  revenueAccountCode: string;
  /** เงินดาวน์ที่ลูกค้าจ่ายให้ร้าน — 0 ได้ (ไฟแนนซ์จ่ายเต็ม) */
  downPayment: Decimal;
  /** ยอดที่รอรับจากบริษัทไฟแนนซ์ */
  financeAmount: Decimal;
  /** ยอดขายสุทธิ = downPayment + financeAmount */
  netAmount: Decimal;
  inventoryCost: Decimal;
  financeCompany?: string;
  postedAt?: Date;
}

@Injectable()
export class ShopExternalFinanceSaleTemplate {
  private readonly logger = new Logger(ShopExternalFinanceSaleTemplate.name);

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  /** คืน `null` เมื่อผังยังไม่พร้อม (รอคำวินิจฉัยผู้สอบ) */
  async execute(
    input: ShopExternalFinanceSaleInput,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string; journalEntryId: string } | null> {
    const zero = new Decimal(0);
    const down = new Decimal(input.downPayment.toString());
    const financed = new Decimal(input.financeAmount.toString());
    const net = new Decimal(input.netAmount.toString());
    const cost = new Decimal(input.inventoryCost.toString());

    if (down.lt(zero) || financed.lt(zero) || cost.lt(zero)) {
      throw new BadRequestException('ShopExternalFinanceSale: จำนวนเงินติดลบไม่ได้');
    }
    if (!net.gt(zero)) {
      throw new BadRequestException('ShopExternalFinanceSale: netAmount ต้องมากกว่า 0');
    }
    if (!down.plus(financed).equals(net)) {
      throw new BadRequestException(
        `ShopExternalFinanceSale: downPayment (${down.toFixed(2)}) + financeAmount ` +
          `(${financed.toFixed(2)}) ต้องเท่ากับ netAmount (${net.toFixed(2)})`,
      );
    }
    for (const code of [
      input.cashAccountCode,
      input.inventoryAccountCode,
      input.cogsAccountCode,
      input.revenueAccountCode,
    ]) {
      if (!code.startsWith('S')) {
        throw new BadRequestException(
          `ShopExternalFinanceSale: ทุกรหัสบัญชีต้องเป็นฝั่ง SHOP (ขึ้นต้น S); พบ ${code}`,
        );
      }
    }

    const label = input.saleNumber ?? input.saleId;

    const run = async (
      tx: Prisma.TransactionClient,
    ): Promise<{ entryNo: string; journalEntryId: string } | null> => {
      const existing = await tx.journalEntry.findFirst({
        where: {
          AND: [
            { metadata: { path: ['flow'], equals: 'shop-external-finance-sale' } as any },
            { metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey } as any },
          ],
          deletedAt: null,
        },
      });
      if (existing) {
        this.logger.log(
          `ShopExternalFinanceSaleTemplate idempotency — JE ${existing.entryNumber} already exists for ${input.idempotencyKey}`,
        );
        return { entryNo: existing.entryNumber, journalEntryId: existing.id };
      }

      if (!(await externalFinanceAccountsReady(tx))) {
        this.logger.warn(
          `ShopExternalFinanceSaleTemplate ข้าม — ผังบัญชียังไม่มี ` +
            `${EXTERNAL_FINANCE_RECEIVABLE_CODE} (รอคำวินิจฉัยผู้สอบ ข้อ 3 รอบ 3) · ใบขาย ${label}`,
        );
        return null;
      }

      const lines: JeLineInput[] = [];
      if (down.gt(zero)) {
        lines.push({
          accountCode: input.cashAccountCode,
          dr: down,
          cr: zero,
          description: `รับเงินดาวน์จากลูกค้า — ใบขาย ${label}`,
        });
      }
      lines.push({
        accountCode: EXTERNAL_FINANCE_RECEIVABLE_CODE,
        dr: financed,
        cr: zero,
        description: `ลูกหนี้ ${input.financeCompany ?? 'บริษัทไฟแนนซ์'} — ใบขาย ${label}`,
      });
      lines.push({
        accountCode: input.revenueAccountCode,
        dr: zero,
        cr: net,
        description: `รายได้ขายผ่านไฟแนนซ์ภายนอก — ใบขาย ${label}`,
      });
      // ตัดสต็อกออกเฉพาะเมื่อมีต้นทุน — ของที่ต้นทุน 0 ไม่มีอะไรให้ตัด
      if (cost.gt(zero)) {
        lines.push({
          accountCode: input.cogsAccountCode,
          dr: cost,
          cr: zero,
          description: `ต้นทุนขาย — ใบขาย ${label}`,
        });
        lines.push({
          accountCode: input.inventoryAccountCode,
          dr: zero,
          cr: cost,
          description: `ตัดสินค้าคงเหลือ — ใบขาย ${label}`,
        });
      }

      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const result = await this.journal.createAndPost(
        {
          description: `ขายผ่านไฟแนนซ์ภายนอก — ใบขาย ${label} (SHOP)`,
          reference: `sale:${input.saleId}:external-finance`,
          metadata: {
            tag: 'SHOP_EXTERNAL_FINANCE_SALE',
            flow: 'shop-external-finance-sale',
            idempotencyKey: input.idempotencyKey,
            // saleId คือกุญแจที่การยกเลิกใบขายใช้กวาด JE
            saleId: input.saleId,
            saleNumber: input.saleNumber ?? null,
            productId: input.productId,
            companyCode: 'SHOP',
            downPayment: down.toFixed(2),
            financeAmount: financed.toFixed(2),
            netAmount: net.toFixed(2),
            inventoryCost: cost.toFixed(2),
            financeCompany: input.financeCompany ?? null,
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
