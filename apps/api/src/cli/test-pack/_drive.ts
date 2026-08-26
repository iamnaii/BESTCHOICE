import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ContractWorkflowService } from '../../modules/contracts/contract-workflow.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { SalesService } from '../../modules/sales/sales.service';
import type { CreateSaleDto } from '../../modules/sales/dto/sale.dto';
import { BookingsService } from '../../modules/bookings/bookings.service';
import { ExpenseDocumentsService } from '../../modules/expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../modules/other-income/other-income.service';
import { AssetService } from '../../modules/asset/asset.service';
import { EquityService } from '../../modules/equity/equity.service';
import { TEST_CONTRACT_PREFIX, TEST_IMEI_PREFIX } from '../seed-test-contracts.cli';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import { bkkMonthKey, remainingInstallmentDue } from './_drive-helpers';
import { TestPackModule } from './_module';
import type { SeedContext } from './_types';

export interface DriveStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DriveResult {
  steps: DriveStep[];
}

const errMsg = (err: unknown): string => {
  if (err instanceof Error) {
    // NestJS HttpException — ข้อความไทยจริงอยู่ใน response.message
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object' && 'message' in (resp as Record<string, unknown>)) {
      const m = (resp as Record<string, unknown>).message;
      return Array.isArray(m) ? m.join(' · ') : String(m);
    }
    return err.message;
  }
  return String(err);
};

/**
 * เฟส 3 — เดินเรื่องผ่าน service จริง เพื่อให้ JE ทุกใบมาจากโค้ด production (R1:
 * ห้ามเขียน JournalEntry/JournalLine ตรง — ไฟล์นี้ไม่แตะสองตารางนั้นเลย)
 *
 * `postDate` = ค่าเดียวกับที่ orchestrator ส่งให้ runPreflight (POST_DATE หรือเที่ยงคืน
 * วันไทยวันนี้) — ห้ามคำนวณใหม่ในไฟล์นี้ ไม่งั้นด่านตรวจงวดบัญชีของ preflight คุ้มครอง
 * คนละเดือนกับที่โพสต์จริง. การใช้:
 *   - รับชำระค่างวด: ส่งเป็น paidDate ตรง ๆ (recordPayment รองรับ backdate — D4)
 *   - ก้าวที่ service ลงบัญชี ณ เวลาปัจจุบันเสมอ (activate / ขาย / มัดจำใบจอง — ไม่มี
 *     พารามิเตอร์วันที่): เดินได้เฉพาะเมื่อ postDate อยู่เดือนไทยเดียวกับวันนี้ ไม่งั้นข้าม
 *   - ก้าว post เอกสาร: JE ลงตามวันที่บนเอกสาร (documentDate/issueDate/purchaseDate/
 *     txnDate) — เดินได้เฉพาะเมื่อวันที่เอกสารอยู่เดือนเดียวกับ postDate ไม่งั้นข้าม
 *
 * แต่ละก้าวจับ error ของตัวเอง: ก้าวหนึ่งพังต้องไม่ล้มก้าวถัดไป และไม่ roll back งาน
 * เฟส 1-2 ที่ commit ไปแล้ว. ก้าวที่หาข้อมูลตั้งต้นไม่เจอ return "ข้าม — ..." ไม่ throw
 * (operator อาจรัน DOMAINS= บางส่วน).
 */
export async function runDrive(ctx: SeedContext, postDate: Date): Promise<DriveResult> {
  const steps: DriveStep[] = [];

  let app: INestApplicationContext;
  try {
    app = await NestFactory.createApplicationContext(TestPackModule, {
      logger: ['error', 'warn'],
    });
  } catch (err) {
    return {
      steps: [
        {
          name: 'เตรียมโมดูล (TestPackModule)',
          ok: false,
          detail: `bootstrap ไม่ผ่าน: ${errMsg(err)}`,
        },
      ],
    };
  }

  const run = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try {
      steps.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      steps.push({ name, ok: false, detail: errMsg(err) });
    }
  };

  const postMonth = bkkMonthKey(postDate);
  const nowMonth = bkkMonthKey(new Date());
  /** ก้าวที่ service ไม่มีพารามิเตอร์วันที่ (ลงบัญชี ณ ตอนนี้เสมอ) */
  const nowOnlyGuard =
    postMonth === nowMonth
      ? null
      : `ข้าม — POST_DATE ชี้เดือน ${postMonth} แต่ service นี้ลงบัญชี ณ วันปัจจุบัน (เดือน ${nowMonth}) เสมอ — ` +
        'เดินต่อจะโพสต์คนละเดือนกับที่ preflight ตรวจงวดไว้';
  /** ก้าว post เอกสาร — JE ลงตามวันที่บนเอกสาร */
  const docDateGuard = (docDate: Date, what: string): string | null =>
    bkkMonthKey(docDate) === postMonth
      ? null
      : `ข้าม — ${what} ลงวันที่เดือน ${bkkMonthKey(docDate)} ไม่ตรงเดือนที่ preflight ตรวจงวดไว้ (${postMonth})`;

  try {
    // ── ก้าว 1: เปิดสัญญาผ่อน → JE 1A + SHOP leg → คิวรอจ่าย INTER-CO มีของ ──────
    await run('เปิดสัญญาผ่อน (JE 1A + SHOP leg)', async () => {
      if (nowOnlyGuard) return nowOnlyGuard;
      const c = await ctx.prisma.contract.findFirst({
        where: {
          contractNumber: { startsWith: TEST_CONTRACT_PREFIX },
          status: 'DRAFT',
          workflowStatus: 'APPROVED',
          deletedAt: null,
        },
        orderBy: { contractNumber: 'asc' },
        select: { id: true, contractNumber: true },
      });
      if (!c) {
        return (
          'ข้าม — ไม่พบสัญญาทดสอบสถานะ DRAFT (workflow APPROVED) ให้เปิด — seeder ปัจจุบันสร้างสัญญา ' +
          'ACTIVE/TERMINATED โดยตรง (เปิดสัญญาใหม่ผ่านหน้า /contracts/create ระหว่างเทสได้)'
        );
      }
      const workflow = app.get(ContractWorkflowService, { strict: false });
      await workflow.activate(c.id);
      return `เปิดสัญญา ${c.contractNumber} แล้ว — ตรวจคิวรอจ่ายที่เมนูจ่ายให้หน้าร้าน (INTER-CO)`;
    });

    // ── ก้าว 2: รับชำระ 2 งวด → JE 2B + ใบเสร็จ ─────────────────────────────────
    await run('รับชำระค่างวด (JE 2B + ใบเสร็จ)', async () => {
      const contracts = await ctx.prisma.contract.findMany({
        where: {
          contractNumber: { startsWith: TEST_CONTRACT_PREFIX },
          status: 'ACTIVE',
          deletedAt: null,
        },
        orderBy: { contractNumber: 'asc' },
        select: { id: true, contractNumber: true },
      });
      if (!contracts.length) {
        return 'ข้าม — ไม่พบสัญญาทดสอบสถานะ ACTIVE (รันโดเมน contracts ก่อน)';
      }
      const payments = app.get(PaymentsService, { strict: false });
      for (const c of contracts) {
        // ห้ามข้ามงวด (คำสั่งเจ้าของ 2026-08-19) — ไล่จากงวดค้างที่เก่าที่สุดเสมอ
        const due = await ctx.prisma.payment.findMany({
          where: {
            contractId: c.id,
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            deletedAt: null,
          },
          orderBy: { installmentNo: 'asc' },
          select: {
            id: true,
            installmentNo: true,
            amountDue: true,
            amountPaid: true,
            lateFee: true,
            lateFeeWaived: true,
          },
          take: 2,
        });
        if (!due.length) continue;
        let paid = 0;
        for (const p of due) {
          const amount = remainingInstallmentDue(p);
          if (amount.lte(0)) continue;
          await payments.recordPayment(
            c.id,
            p.installmentNo,
            // Decimal ตลอดทาง — แปลงเป็น number เฉพาะขอบสุดท้ายตามลายเซ็น service
            amount.toNumber(),
            'CASH',
            ctx.refs.reviewerId,
            undefined, // evidenceUrl
            testNote('รับชำระจากโหมดเดินเรื่อง'),
            // recordPayment บังคับหลักฐาน (evidenceUrl หรือ transactionRef) —
            // ref ต่อแถวงวดจึง unique ต่อการรันซ้ำ (idempotency guard ฝั่ง service)
            `TEST-DRIVE-${p.id}`,
            '11-1101', // depositAccountCode — เงินสดฝั่ง FINANCE (อยู่ใน DRIVE_REQUIRED_ACCOUNTS)
            undefined, // toleranceApproverId
            undefined, // paymentCase
            true, // consumeAdvance
            postDate, // paidDate = วันเดียวกับที่ preflight ตรวจงวด (carry จาก Task 11)
          );
          paid += 1;
        }
        if (paid > 0) {
          return `รับชำระ ${paid} งวดของสัญญา ${c.contractNumber} — ตรวจใบเสร็จที่ /receipts และสมุดที่ /finance/general-journal`;
        }
      }
      return 'ข้าม — สัญญาทดสอบทุกใบไม่มีงวดค้างให้รับชำระ (อาจรันเดินเรื่องจนครบแล้ว)';
    });

    // ── ก้าว 3: ขายสดหน้าร้าน → SHOP JE (รายได้ + COGS) ─────────────────────────
    await run('ขายสดหน้าร้าน (SHOP JE)', async () => {
      if (nowOnlyGuard) return nowOnlyGuard;
      const customer = await ctx.prisma.customer.findFirst({
        where: { name: { startsWith: `${TEST_NAME_PREFIX} ลูกค้าใหม่` }, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true },
      });
      if (!customer) return 'ข้าม — ไม่พบลูกค้าทดสอบ (รันโดเมน contracts ก่อน)';
      const product = await ctx.prisma.product.findFirst({
        where: {
          imeiSerial: { startsWith: TEST_IMEI_PREFIX },
          status: 'IN_STOCK',
          deletedAt: null,
        },
        orderBy: { imeiSerial: 'asc' },
        select: { id: true, name: true, cashPrice: true, branchId: true },
      });
      if (!product) return 'ข้าม — ไม่พบเครื่องทดสอบสถานะ IN_STOCK (รันโดเมน contracts ก่อน)';
      const price = new Prisma.Decimal(product.cashPrice ?? 0);
      if (price.lte(0)) return `ข้าม — เครื่องทดสอบ "${product.name}" ไม่มีราคาเงินสด`;
      const sales = app.get(SalesService, { strict: false });
      const dto: CreateSaleDto = {
        saleType: 'CASH',
        customerId: customer.id,
        productId: product.id,
        branchId: product.branchId ?? ctx.refs.branchId,
        sellingPrice: price.toNumber(),
        discount: 0,
        // BANK_TRANSFER → S11-1201 (SHOP receiving bank) — ไม่พึ่ง branch.shopCashAccountCode
        // ซึ่ง fail-closed เมื่อสาขายังไม่ตั้งค่า (ShopAccountResolver.resolveInflowCashAccount)
        paymentMethod: 'BANK_TRANSFER',
        notes: testNote('ขายสดจากโหมดเดินเรื่อง'),
      };
      const sale = await sales.create(dto, ctx.refs.salespersonId, 'OWNER');
      const row = await ctx.prisma.sale.findUnique({
        where: { id: sale.id },
        select: { saleNumber: true },
      });
      return `ขายสดแล้ว ${row?.saleNumber ?? sale.id} (${product.name}) — ตรวจที่ /sales และงบทดลอง SHOP ที่ /shop/accounting`;
    });

    // ── ก้าว 4: ขายผ่านไฟแนนซ์ภายนอก → Dr S11-3101 + FinanceReceivable ─────────
    await run('ขายผ่านไฟแนนซ์ภายนอก (Dr S11-3101)', async () => {
      if (nowOnlyGuard) return nowOnlyGuard;
      const customer = await ctx.prisma.customer.findFirst({
        where: { name: { startsWith: `${TEST_NAME_PREFIX} ลูกค้าใหม่` }, deletedAt: null },
        orderBy: { name: 'desc' },
        select: { id: true },
      });
      if (!customer) return 'ข้าม — ไม่พบลูกค้าทดสอบ (รันโดเมน contracts ก่อน)';
      const product = await ctx.prisma.product.findFirst({
        where: {
          imeiSerial: { startsWith: TEST_IMEI_PREFIX },
          status: 'IN_STOCK',
          deletedAt: null,
        },
        orderBy: { imeiSerial: 'asc' },
        select: { id: true, name: true, cashPrice: true, branchId: true },
      });
      if (!product) {
        return 'ข้าม — ไม่เหลือเครื่องทดสอบสถานะ IN_STOCK (ก้าวขายสดอาจใช้เครื่องสุดท้ายไปแล้ว)';
      }
      const price = new Prisma.Decimal(product.cashPrice ?? 0);
      if (price.lte(0)) return `ข้าม — เครื่องทดสอบ "${product.name}" ไม่มีราคาเงินสด`;
      const financeCo = await ctx.prisma.externalFinanceCompany.findFirst({
        where: { name: { startsWith: TEST_NAME_PREFIX }, isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { name: true },
      });
      if (!financeCo) {
        return 'ข้าม — ไม่พบบริษัทไฟแนนซ์ภายนอกทดสอบ (รันโดเมน external-finance ก่อน)';
      }
      // ดาวน์ 10% (ปัด 2 ตำแหน่ง) — เดิน JE ทั้งขาเงินดาวน์และขาลูกหนี้ไฟแนนซ์
      const down = price.mul('0.10').toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const sales = app.get(SalesService, { strict: false });
      const dto: CreateSaleDto = {
        saleType: 'EXTERNAL_FINANCE',
        customerId: customer.id,
        productId: product.id,
        branchId: product.branchId ?? ctx.refs.branchId,
        sellingPrice: price.toNumber(),
        discount: 0,
        paymentMethod: 'BANK_TRANSFER',
        downPayment: down.toNumber(),
        financeCompany: financeCo.name,
        financeRefNumber: `TEST-DRIVE-EXTFIN-${ctx.dateStr}`,
        notes: testNote('ขายผ่านไฟแนนซ์ภายนอกจากโหมดเดินเรื่อง'),
      };
      const sale = await sales.create(dto, ctx.refs.salespersonId, 'OWNER');
      const row = await ctx.prisma.sale.findUnique({
        where: { id: sale.id },
        select: { saleNumber: true },
      });
      return `ขายผ่านไฟแนนซ์แล้ว ${row?.saleNumber ?? sale.id} (${financeCo.name}) — ลูกหนี้ S11-3101 ตรวจที่ /finance-receivable`;
    });

    // ── ก้าว 5: รับมัดจำใบจอง → Dr เงิน / Cr S21-2002 (คำวินิจฉัยผู้สอบ A5) ──────
    await run('รับมัดจำใบจอง (Cr S21-2002)', async () => {
      if (nowOnlyGuard) return nowOnlyGuard;
      const actor = await ctx.prisma.user.findUnique({
        where: { id: ctx.refs.ownerId },
        select: { id: true, role: true, branchId: true },
      });
      if (!actor) return 'ข้าม — ไม่พบผู้ใช้ OWNER สำหรับเป็นผู้บันทึก';
      const booking = await ctx.prisma.booking.findFirst({
        where: {
          bookingNumber: { startsWith: `${TEST_DOC_PREFIX}BK-` },
          status: 'PENDING_DEPOSIT',
          expireDate: { gt: new Date() },
          deletedAt: null,
        },
        orderBy: { bookingNumber: 'asc' },
        select: { id: true, bookingNumber: true },
      });
      if (!booking) {
        return 'ข้าม — ไม่พบใบจองทดสอบสถานะ PENDING_DEPOSIT ที่ยังไม่หมดอายุ (รันโดเมน bookings ก่อน)';
      }
      const bookings = app.get(BookingsService, { strict: false });
      await bookings.payDeposit(
        booking.id,
        {
          depositMethod: 'BANK_TRANSFER',
          // ฟิลด์นี้บังคับรหัสฝั่ง FINANCE (11-1101..1203) — JE ฝั่ง SHOP ใช้ resolver
          // ตามวิธีรับเงินแทน (BANK_TRANSFER → S11-1201) ดูคอมเมนต์ใน payDeposit
          depositAccountCode: '11-1201',
          notes: testNote('รับมัดจำจากโหมดเดินเรื่อง'),
        },
        actor,
      );
      return `รับมัดจำใบจอง ${booking.bookingNumber} — ตรวจ S21-2002 ในงบทดลอง SHOP ที่ /shop/accounting`;
    });

    // ── ก้าว 6: ลงบัญชีใบค่าใช้จ่าย (DRAFT → ACCRUAL) ───────────────────────────
    await run('ลงบัญชีใบค่าใช้จ่าย (ACCRUAL)', async () => {
      // V15: ACCRUAL ห้ามมี WHT (ม.50) — ใบ DRAFT ของ seeder ไม่มี paymentMethod
      // ⇒ post แล้วไปทาง ACCRUAL จึงเลือกเฉพาะใบที่ WHT = 0
      const doc = await ctx.prisma.expenseDocument.findFirst({
        where: {
          note: { startsWith: TEST_NOTE_MARKER },
          documentType: 'EXPENSE',
          status: 'DRAFT',
          withholdingTax: 0,
          totalAmount: { gt: 0.01 },
          deletedAt: null,
        },
        orderBy: { number: 'asc' },
        select: { id: true, number: true, documentDate: true },
      });
      if (!doc) {
        return 'ข้าม — ไม่พบใบค่าใช้จ่ายทดสอบ DRAFT ที่ไม่มีหัก ณ ที่จ่าย (รันโดเมน expenses ก่อน — ใบที่มี WHT ต้อง post แบบจ่ายทันทีผ่านหน้าจอ)';
      }
      const guard = docDateGuard(doc.documentDate, `ใบค่าใช้จ่าย ${doc.number}`);
      if (guard) return guard;
      const expenses = app.get(ExpenseDocumentsService, { strict: false });
      await expenses.post(doc.id, ctx.refs.ownerId, 'OWNER');
      return `ลงบัญชีแล้ว ${doc.number} (ACCRUAL — Dr ค่าใช้จ่าย / Cr เจ้าหนี้) — ตรวจที่ /expenses`;
    });

    // ── ก้าว 7: ลงบัญชีรายได้อื่น (DRAFT → POSTED) ──────────────────────────────
    await run('ลงบัญชีรายได้อื่น', async () => {
      const doc = await ctx.prisma.otherIncome.findFirst({
        where: { customerNote: { startsWith: TEST_NOTE_MARKER }, status: 'DRAFT', deletedAt: null },
        orderBy: { docNumber: 'asc' },
        select: { id: true, docNumber: true, issueDate: true },
      });
      if (!doc) return 'ข้าม — ไม่พบใบรายได้อื่นทดสอบสถานะ DRAFT (รันโดเมน other-income ก่อน)';
      const guard = docDateGuard(doc.issueDate, `ใบรายได้อื่น ${doc.docNumber}`);
      if (guard) return guard;
      const otherIncome = app.get(OtherIncomeService, { strict: false });
      await otherIncome.post(doc.id, {}, ctx.refs.ownerId);
      return `ลงบัญชีแล้ว ${doc.docNumber} — ตรวจที่ /other-income`;
    });

    // ── ก้าว 8: ลงบัญชีทรัพย์สิน (DRAFT → POSTED + เข้าคิวค่าเสื่อมรายเดือน) ────
    await run('ลงบัญชีทรัพย์สิน (JE ซื้อทรัพย์สิน)', async () => {
      const doc = await ctx.prisma.fixedAsset.findFirst({
        where: { description: { startsWith: TEST_NOTE_MARKER }, status: 'DRAFT', deletedAt: null },
        orderBy: { docNo: 'asc' },
        select: { id: true, docNo: true, purchaseDate: true },
      });
      if (!doc) return 'ข้าม — ไม่พบทรัพย์สินทดสอบสถานะ DRAFT (รันโดเมน assets ก่อน)';
      const guard = docDateGuard(doc.purchaseDate, `ทรัพย์สิน ${doc.docNo}`);
      if (guard) return guard;
      const assets = app.get(AssetService, { strict: false });
      const { entryNo } = await assets.post(doc.id, ctx.refs.ownerId);
      return `ลงบัญชีแล้ว ${doc.docNo} → ${entryNo} (ทรัพย์สินเริ่มเข้าคิวค่าเสื่อมรายเดือน)`;
    });

    // ── ก้าว 9: ลงบัญชีเอกสารส่วนของผู้ถือหุ้น (DRAW — โพสต์ได้ทันทีตาม seeder) ──
    await run('ลงบัญชีเอกสารส่วนของผู้ถือหุ้น (DRAW)', async () => {
      const doc = await ctx.prisma.equityDocument.findFirst({
        where: {
          description: { startsWith: TEST_NOTE_MARKER },
          txnType: 'DRAW',
          status: { in: ['DRAFT', 'READY'] },
          deletedAt: null,
        },
        orderBy: { docNumber: 'asc' },
        select: { id: true, docNumber: true, txnDate: true },
      });
      if (!doc) return 'ข้าม — ไม่พบเอกสาร DRAW ทดสอบสถานะ DRAFT/READY (รันโดเมน equity ก่อน)';
      const guard = docDateGuard(doc.txnDate, `เอกสารส่วนของผู้ถือหุ้น ${doc.docNumber}`);
      if (guard) return guard;
      const equity = app.get(EquityService, { strict: false });
      await equity.post(doc.id, ctx.refs.ownerId);
      return `ลงบัญชีแล้ว ${doc.docNumber} (Dr 22-1102 ถอนใช้ส่วนตัว / Cr 11-1201) — ตรวจที่ /finance/equity`;
    });
  } finally {
    await app.close();
  }

  return { steps };
}
