import { PaymentMethod, Prisma, ShopTenderKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalAutoService, JeLineInput } from '../journal/journal-auto.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { NormalizedTender } from './shop-tender.util';

export type ShopInflowKind = Extract<ShopTenderKind, 'CASH_SALE' | 'EXTERNAL_FINANCE_DOWN' | 'CONTRACT_DOWN' | 'BOOKING_DEPOSIT'>;

const REFUND_KIND: Record<ShopInflowKind, ShopTenderKind> = {
  CASH_SALE: 'SALE_VOID_REFUND',
  EXTERNAL_FINANCE_DOWN: 'SALE_VOID_REFUND',
  CONTRACT_DOWN: 'CONTRACT_DOWN_REFUND',
  BOOKING_DEPOSIT: 'BOOKING_DEPOSIT_REFUND',
};

/** เอกสารต้นทางของเงิน — ใส่ได้ตัวเดียว */
export interface TenderDoc {
  saleId?: string;
  contractId?: string;
  bookingId?: string;
}

export const SHOP_TENDER_SPLIT_FLOW = 'shop-tender-split';

interface RecorderDeps {
  journal: Pick<JournalAutoService, 'createAndPost'>;
  companies: Pick<CompanyResolverService, 'getShopCompanyId'>;
  accounts: Pick<ShopAccountResolver, 'resolveInflowCashAccount'>;
  reversal: Pick<ExchangeCancelReversalTemplate, 'reverse'>;
}

function docKey(doc: TenderDoc): { type: 'sale' | 'contract' | 'booking'; id: string } {
  if (doc.saleId) return { type: 'sale', id: doc.saleId };
  if (doc.contractId) return { type: 'contract', id: doc.contractId };
  if (doc.bookingId) return { type: 'booking', id: doc.bookingId };
  throw new Error('ShopTenderRecorder: ต้องระบุเอกสารต้นทางของเงิน');
}

/**
 * เขียนสมุดเงินเข้า/ออกหน้าร้าน (`shop_tenders`) ใน tx เดียวกับ JE ของเอกสาร
 * (สเปค 2026-09-20-shop-tenders-daily-cash). สร้างแบบ `new ShopTenderRecorder(this.prisma)`
 * ตามแบบ TradeInCreditService — ไม่เพิ่ม dependency ให้ constructor ของ service เดิม.
 *
 * บิลจ่ายผสม: template รับเงินเดิมลงเต็มยอดเข้าบัญชีของ tender แรก (primary) ตามเดิมทุกประการ
 * แล้ว recorder โพสต์ JE "แยกยอด" 1 ใบ ย้ายส่วนของวิธีอื่นออกจากบัญชี primary:
 *   Dr บัญชีของวิธีอื่น / Cr บัญชี primary
 * จึงไม่ต้องแตะ JE ขายสดรายสินค้า, TradeInCreditService.claim, deposit-applied หรือด่านลบร่างสัญญา
 * ที่ต่างก็ผูกกับ "บัญชีรับเงินบัญชีเดียวต่อเอกสาร".
 */
export class ShopTenderRecorder {
  private readonly deps: RecorderDeps;

  constructor(prisma: PrismaService, deps?: RecorderDeps) {
    if (deps) {
      this.deps = deps;
      return;
    }
    const journal = new JournalAutoService(prisma);
    this.deps = {
      journal,
      companies: new CompanyResolverService(prisma),
      accounts: new ShopAccountResolver(prisma),
      reversal: new ExchangeCancelReversalTemplate(journal, prisma),
    };
  }

  async recordInflow(
    tx: Prisma.TransactionClient,
    input: {
      kind: ShopInflowKind;
      branchId: string;
      /** ผู้รับเงิน = ผู้ใช้ที่ล็อกอินและกดบันทึก (ไม่ใช่ salespersonId ที่เลือกได้) */
      actorId: string;
      doc: TenderDoc;
      docNumber?: string | null;
      tenders: NormalizedTender[];
      occurredAt?: Date;
      /** false = เขียนแถว tender อย่างเดียว ไม่โพสต์ JE แยกยอด (ใช้เมื่อ JE รับเงินหลักไม่ได้ถูกโพสต์) */
      postSplitJe?: boolean;
    },
  ): Promise<{ primaryAccountCode: string | null; splitJournalEntryId: string | null }> {
    const { tenders } = input;
    if (!tenders.length) return { primaryAccountCode: null, splitJournalEntryId: null };
    const occurredAt = input.occurredAt ?? new Date();

    await tx.shopTender.createMany({
      data: tenders.map((t) => ({
        direction: 'IN' as const,
        kind: input.kind,
        branchId: input.branchId,
        method: t.method as PaymentMethod,
        amount: t.amount,
        reference: t.reference,
        actorId: input.actorId,
        occurredAt,
        seq: t.seq,
        seqTotal: t.seqTotal,
        ...input.doc,
      })),
    });

    if (input.postSplitJe === false) return { primaryAccountCode: null, splitJournalEntryId: null };

    const primaryAccountCode = await this.deps.accounts.resolveInflowCashAccount(input.branchId, tenders[0].method, tx);
    const moved = new Map<string, Prisma.Decimal>();
    for (const t of tenders.slice(1)) {
      const account = await this.deps.accounts.resolveInflowCashAccount(input.branchId, t.method, tx);
      if (account === primaryAccountCode) continue;
      moved.set(account, (moved.get(account) ?? new Prisma.Decimal(0)).plus(t.amount));
    }
    if (!moved.size) return { primaryAccountCode, splitJournalEntryId: null };

    const key = docKey(input.doc);
    const idempotencyKey = `${SHOP_TENDER_SPLIT_FLOW}:${key.type}:${key.id}`;
    const existing = await this.findSplitJe(tx, key);
    if (existing) return { primaryAccountCode, splitJournalEntryId: existing.id };

    const zero = new Prisma.Decimal(0);
    let total = zero;
    const lines: JeLineInput[] = [];
    for (const [accountCode, amount] of moved) {
      lines.push({ accountCode, dr: amount, cr: zero, description: 'แยกยอดรับเงิน (บิลจ่ายผสม)' });
      total = total.plus(amount);
    }
    lines.push({ accountCode: primaryAccountCode, dr: zero, cr: total, description: 'ย้ายส่วนที่รับด้วยวิธีอื่นออก (บิลจ่ายผสม)' });

    const entry = await this.deps.journal.createAndPost(
      {
        description: `แยกยอดรับเงิน บิลจ่ายผสม — ${input.docNumber ?? key.id} (SHOP)`,
        reference: `${key.type}:${key.id}:tender-split`,
        metadata: {
          tag: 'SHOP_TENDER_SPLIT',
          flow: SHOP_TENDER_SPLIT_FLOW,
          idempotencyKey,
          tenderDocType: key.type,
          tenderDocId: key.id,
          companyCode: 'SHOP',
          // ใบขายเท่านั้น: ให้ SaleVoidService (sweep metadata.saleId) mirror ใบนี้ไปด้วยตอนยกเลิกใบขาย.
          // สัญญา: ห้ามใส่ contractId — การยกเลิกสัญญา/ยกเลิกเปลี่ยนเครื่อง sweep ตาม contractId และ throw เมื่อเจอบรรทัดเงินสด.
          ...(input.doc.saleId ? { saleId: input.doc.saleId } : {}),
        },
        postedAt: occurredAt,
        companyId: await this.deps.companies.getShopCompanyId(tx),
        lines,
      },
      tx,
    );
    return { primaryAccountCode, splitJournalEntryId: entry.id };
  }

  /**
   * คืนเงินตามวิธีที่รับมา: แถว IN ที่ยังไม่ถูกคืน → แถว OUT คู่กัน (ผู้จ่าย = ผู้กดยกเลิก).
   * เอกสารเก่าที่ไม่มีแถว IN = ไม่เขียนอะไร. คืนจำนวนแถว OUT ที่เขียน.
   * `reverseSplitJe`: ลบร่างสัญญา/ยกเลิกใบจอง ต้อง mirror JE แยกยอดเอง; ยกเลิกใบขายไม่ต้อง (sweep saleId ทำให้แล้ว).
   */
  async recordRefund(
    tx: Prisma.TransactionClient,
    input: {
      doc: TenderDoc;
      kinds: ShopInflowKind[];
      actorId: string;
      reverseSplitJe: boolean;
      descriptionPrefix?: string;
      occurredAt?: Date;
    },
  ): Promise<number> {
    const rows = await tx.shopTender.findMany({
      where: { direction: 'IN', kind: { in: input.kinds }, ...input.doc, reversedBy: { none: {} } },
      orderBy: { seq: 'asc' },
    });
    if (!rows.length) return 0;
    const occurredAt = input.occurredAt ?? new Date();

    await tx.shopTender.createMany({
      data: rows.map((row) => ({
        direction: 'OUT' as const,
        kind: REFUND_KIND[row.kind as ShopInflowKind],
        branchId: row.branchId,
        method: row.method,
        amount: row.amount,
        reference: row.reference,
        actorId: input.actorId,
        occurredAt,
        seq: row.seq,
        seqTotal: row.seqTotal,
        saleId: row.saleId,
        contractId: row.contractId,
        bookingId: row.bookingId,
        reversesTenderId: row.id,
      })),
    });

    if (input.reverseSplitJe) {
      const split = await this.findSplitJe(tx, docKey(input.doc));
      if (split) {
        await this.deps.reversal.reverse(
          { jeIds: [split.id], flowLabel: `${SHOP_TENDER_SPLIT_FLOW}-reversed`, descriptionPrefix: input.descriptionPrefix ?? '[คืนเงิน]' },
          tx,
        );
      }
    }
    return rows.length;
  }

  /** จ่ายรับซื้อมือสอง — เงินออกก้อนเดียว. TradeIn เก็บวิธีจ่ายเป็น 'CASH' | 'TRANSFER'. */
  async recordPayout(
    tx: Prisma.TransactionClient,
    input: { tradeInId: string; branchId: string; actorId: string; method: string; amount: Prisma.Decimal; occurredAt?: Date },
  ): Promise<void> {
    if (!input.amount.gt(0)) return;
    await tx.shopTender.createMany({
      data: [{
        direction: 'OUT' as const,
        kind: 'TRADE_IN_PAYOUT' as const,
        branchId: input.branchId,
        method: (input.method === 'CASH' ? 'CASH' : 'BANK_TRANSFER') as PaymentMethod,
        amount: input.amount,
        reference: null,
        actorId: input.actorId,
        occurredAt: input.occurredAt ?? new Date(),
        seq: 1,
        seqTotal: 1,
        tradeInId: input.tradeInId,
      }],
    });
  }

  private findSplitJe(tx: Prisma.TransactionClient, key: { type: string; id: string }) {
    return tx.journalEntry.findFirst({
      where: {
        AND: [
          { metadata: { path: ['flow'], equals: SHOP_TENDER_SPLIT_FLOW } as Prisma.JsonFilter<'JournalEntry'> },
          { metadata: { path: ['idempotencyKey'], equals: `${SHOP_TENDER_SPLIT_FLOW}:${key.type}:${key.id}` } as Prisma.JsonFilter<'JournalEntry'> },
        ],
        deletedAt: null,
      },
      select: { id: true, entryNumber: true },
    });
  }
}
