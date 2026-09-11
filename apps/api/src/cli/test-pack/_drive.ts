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
import { loadLateFeeConfig } from '../../utils/late-fee.util';
import { TEST_CONTRACT_PREFIX, TEST_IMEI_PREFIX } from '../seed-test-contracts.cli';
import {
  TEST_DOC_PREFIX,
  TEST_NAME_PREFIX,
  TEST_NOTE_MARKER,
  bkkDateStr,
  testNote,
} from './_context';
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
      const r = resp as Record<string, unknown>;
      const m = r.message;
      const head = Array.isArray(m) ? m.join(' · ') : String(m);
      // โมดูลที่ validate เป็นชุด (other-income / expense-documents) โยน
      // BadRequestException({ message, errors }) — `message` เป็นสรุปกว้าง ๆ
      // (เช่น "ไม่ผ่านการตรวจสอบก่อน POST") ส่วนเหตุผลจริงอยู่ใน `errors`.
      // ไม่ดึงมาด้วย = คนอ่าน log ไม่รู้ว่าตกกฎข้อไหน
      // (เสียเวลาไล่จริงตอน DRIVE ล้มบน prod 2026-08-27)
      const details = r.errors;
      if (Array.isArray(details) && details.length) {
        const lines = details.map((d) => {
          if (d && typeof d === 'object') {
            const o = d as Record<string, unknown>;
            const rule = o.rule ?? o.code ?? o.field;
            const text = o.message ?? o.detail ?? JSON.stringify(o);
            return rule ? `[${String(rule)}] ${String(text)}` : String(text);
          }
          return String(d);
        });
        return `${head}: ${lines.join(' · ')}`;
      }
      return head;
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
 *     และค่าปรับต้อง resolve ณ postDate ให้ตรงกับที่ orchestrator จะคิด (fix round 1)
 *   - ก้าวที่ service ลงบัญชี ณ เวลาปัจจุบันเสมอ (activate / ขาย / มัดจำใบจอง — ไม่มี
 *     พารามิเตอร์วันที่): เดินได้เฉพาะเมื่อ postDate อยู่เดือนไทยเดียวกับวันนี้ ไม่งั้นข้าม;
 *     ถ้าเดือนตรงแต่วันไม่ตรง เดินต่อได้ (งวดเดิม) แต่ต้องบอกในผลลัพธ์ว่าลงคนละวัน
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
  // MINOR 9: ถ้า onModuleInit ตัวที่วิ่งหลัง PrismaService พัง (เคสจริง: ยังไม่รัน seed:coa
  // — ExpenseDocumentsService/AccountRoleService validate CoA ตอน boot) Nest reject โดย
  // ไม่คืน handle และ close() ของ context ที่ init ค้างก็ rethrow initializationPromise —
  // จึงจับ instance ที่มี $disconnect (PrismaService/PrismaFinanceService) ตอน DI
  // instantiate ผ่าน instrument.instanceDecorator (public API — วิ่งก่อน init hook ทุกตัว)
  // เพื่อให้ปิด connection ได้เสมอไม่ว่า bootstrap จะล้มที่ชั้นไหน
  const disconnectables = new Set<{ $disconnect: () => Promise<unknown> }>();
  try {
    app = await NestFactory.createApplicationContext(TestPackModule, {
      logger: ['error', 'warn'],
      // IMPORTANT 3: default abortOnError=true ทำให้ scan ที่พัง (โมดูลขาด/DI ผิด — คลาส
      // ความพังที่น่าจะเจอบ่อยสุด) เรียก DEFAULT_TEARDOWN = process.exit(1) จากใน
      // createApplicationContext เอง — catch ด้านล่าง, SUMMARY ของ CLI และ
      // finally { $disconnect() } ของ orchestrator จะไม่ได้ทำงานเลย; false = rejection ปกติ
      abortOnError: false,
      instrument: {
        instanceDecorator: (instance) => {
          const candidate = instance as { $disconnect?: unknown } | null;
          if (candidate && typeof candidate.$disconnect === 'function') {
            disconnectables.add(candidate as { $disconnect: () => Promise<unknown> });
          }
          return instance;
        },
      },
    });
  } catch (err) {
    await Promise.allSettled([...disconnectables].map((c) => c.$disconnect()));
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

  /**
   * `DRIVE_STEPS=<คำ,คำ>` — รันเฉพาะก้าวที่ชื่อ**มี**คำเหล่านี้ (ว่าง = รันทุกก้าว — พฤติกรรมเดิม)
   *
   * มีไว้เพราะ **ก้าวส่วนใหญ่ไม่ idempotent**: ก้าวรับชำระจะจ่ายงวดถัดไปเพิ่ม
   * ก้าวขายจะออกใบขายใบใหม่ ⇒ รัน runDrive ซ้ำทั้งชุดเพื่อแก้ก้าวที่ล้ม = สร้าง JE เกินจริง
   * (เจอจริงบน prod 2026-08-27 — 3 ก้าวล้มจาก 9 แต่รันซ้ำไม่ได้เพราะอีก 6 ก้าวจะทำซ้ำ)
   *
   * ก้าวที่ไม่ถูกเลือก **ไม่โผล่ในสรุปเลย** (ไม่ใช่ "ข้าม") — ผู้อ่านจะได้เห็นเฉพาะ
   * ก้าวที่ตั้งใจรัน ไม่ปนกับก้าวที่ข้ามเพราะเงื่อนไขของข้อมูลไม่ครบ
   */
  const stepTokens = (process.env.DRIVE_STEPS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const stepSelected = (name: string): boolean =>
    stepTokens.length === 0 || stepTokens.some((t) => name.includes(t));

  const run = async (name: string, fn: () => Promise<string>): Promise<void> => {
    if (!stepSelected(name)) return;
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
  const postDayStr = bkkDateStr(postDate);
  const nowDayStr = bkkDateStr(new Date());
  /**
   * เดือนตรง (nowOnlyGuard ผ่าน) แต่วันไม่ตรง — ก้าว now-only โพสต์ "วันนี้" ส่วนก้าว
   * รับชำระโพสต์ POST_DATE ⇒ สมุดมีสองวันที่ในรันเดียว. งวดบัญชีเป็นรายเดือนจึงยังถูก
   * ด่าน preflight คุ้มครอง แต่ต้องบอกคนอ่านตัวเลข ไม่ปล่อยให้ต่างกันเงียบ ๆ (MINOR 6)
   */
  const nowOnlyDayNote =
    !nowOnlyGuard && postDayStr !== nowDayStr
      ? ` · หมายเหตุ: ก้าวนี้ลงบัญชีวันนี้ (${nowDayStr}) ไม่ใช่ POST_DATE (${postDayStr}) — เดือนไทยเดียวกัน งวดบัญชีที่ preflight ตรวจยังคุ้มครอง`
      : '';
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
      return `เปิดสัญญา ${c.contractNumber} แล้ว — ตรวจคิวรอจ่ายที่เมนูจ่ายให้หน้าร้าน (INTER-CO)${nowOnlyDayNote}`;
    });

    // ── ก้าว 2: รับชำระ 2 งวด → JE 2B + ใบเสร็จ ─────────────────────────────────
    await run('รับชำระค่างวด (JE 2B + ใบเสร็จ)', async () => {
      // กันส่ง LINE push จริง (MINOR 5): hook หลังรับเงิน (sendPaymentSuccessLine) เช็คแค่
      // customer.lineIdFinance + notifReceipt — ไม่มีเงื่อนไข "ข้อมูลทดสอบ" ใด ๆ. สัญญา
      // ทดสอบที่ tester ผูก LINE ผ่าน /liff/register (สคริปต์เทสของ pack เองแนะนำให้ทำ)
      // จึงต้องถูกข้ามทั้งใบ พร้อมบอกชื่อสัญญาที่ข้าม
      const activeWhere: Prisma.ContractWhereInput = {
        contractNumber: { startsWith: TEST_CONTRACT_PREFIX },
        status: 'ACTIVE',
        deletedAt: null,
      };
      const candidates = await ctx.prisma.contract.findMany({
        where: { ...activeWhere, customer: { is: { lineIdFinance: null } } },
        orderBy: { contractNumber: 'asc' },
        select: { id: true, contractNumber: true },
      });
      const lineLinked = await ctx.prisma.contract.findMany({
        where: { ...activeWhere, customer: { is: { lineIdFinance: { not: null } } } },
        orderBy: { contractNumber: 'asc' },
        select: { contractNumber: true },
      });
      const lineSkipNote = lineLinked.length
        ? ` · ข้ามสัญญา ${lineLinked.map((r) => r.contractNumber).join(', ')} — ลูกค้าผูก LINE (lineIdFinance) แล้ว รับชำระจะยิง Flex ถึงลูกค้าจริง`
        : '';
      // B1 (2026-08-26): รับชำระได้เฉพาะสัญญาที่มี JE 1A (POSTED) จริงเท่านั้น — สัญญาจาก
      // seed-test-contracts.cli ถูกสร้างเป็น ACTIVE ตรง ๆ โดย "ไม่โพสต์ activation journal"
      // (docblock ของ CLI เดิม) ⇒ 2B บนสัญญาพวกนั้นเครดิต 11-2101/11-2103 + ล้าง 21-2102
      // ที่ไม่เคยถูกตั้ง — ทุกบรรทัดในใบ balance กันเอง งบทดลองจึงยังสมดุลทั้งที่บัญชีจริง
      // ติดเครื่องหมายผิด (11-2101 ติดลบ). ตัวชี้ = metadata ที่ ContractActivation1ATemplate
      // stamp จริง: `{ tag: '1A', contractId }` (contract-activation-1a.template.ts)
      const contracts: typeof candidates = [];
      const no1A: string[] = [];
      for (const c of candidates) {
        const je = await ctx.prisma.journalEntry.findFirst({
          where: {
            status: 'POSTED',
            deletedAt: null,
            AND: [
              { metadata: { path: ['tag'], equals: '1A' } },
              { metadata: { path: ['contractId'], equals: c.id } },
            ],
          },
          select: { id: true },
        });
        if (je) contracts.push(c);
        else no1A.push(c.contractNumber);
      }
      const no1ASkipNote = no1A.length
        ? ` · ข้ามสัญญา ${no1A.join(', ')} — ไม่มี JE 1A ในสมุด (seed สร้างเป็น ACTIVE ตรงโดยไม่ผ่าน activate) รับชำระจะทำ 11-2101/11-2103 ติดเครื่องหมายผิดทั้งที่งบทดลองยังสมดุล`
        : '';
      const skipNotes = no1ASkipNote + lineSkipNote;
      if (!contracts.length) {
        if (no1A.length || lineLinked.length) {
          return `ข้าม — ไม่มีสัญญาทดสอบ ACTIVE ที่รับชำระได้${skipNotes}`;
        }
        return 'ข้าม — ไม่พบสัญญาทดสอบสถานะ ACTIVE (รันโดเมน contracts ก่อน)';
      }
      const payments = app.get(PaymentsService, { strict: false });
      // ค่าปรับต้อง resolve ณ postDate แบบเดียวกับ orchestrator (single source —
      // loadLateFeeConfig + resolveLateFee ชุดเดียวกับ service ผ่าน _drive-helpers):
      // จ่ายตามค่าที่ stamp ตอน seed จะขาด/เกิน 50-100฿ ทันทีที่ POST_DATE คนละวันกับ
      // วัน seed แล้วงวดค้าง PARTIALLY_PAID ทั้งที่ใบเสร็จสั้นออกไปแล้ว (fix round 1)
      const lateFeeCfg = await loadLateFeeConfig(ctx.prisma);
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
            dueDate: true,
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
          const amount = remainingInstallmentDue(p, lateFeeCfg, postDate);
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
            // recordPayment บังคับหลักฐาน (evidenceUrl หรือ transactionRef) — ref ต้องพก
            // เลขครั้ง (Date.now) ด้วย: idempotency probe ของ service จับทั้ง PAID และ
            // PARTIALLY_PAID ⇒ ref คงที่ต่อแถวจะล็อกงวดที่เคยจ่ายพร่องไว้ถาวร รันซ้ำไม่ได้
            `TEST-DRIVE-${p.id}-${Date.now()}`,
            '11-1101', // depositAccountCode — เงินสดฝั่ง FINANCE (อยู่ใน DRIVE_REQUIRED_ACCOUNTS)
            undefined, // toleranceApproverId
            undefined, // paymentCase
            true, // consumeAdvance
            postDate, // paidDate = วันเดียวกับที่ preflight ตรวจงวด (carry จาก Task 11)
          );
          // ยอดที่ส่งต้องปิดงวดพอดี — ถ้าไม่ PAID (ยอดเราไม่ตรงกับที่ service ตัดจริง)
          // ต้องหยุดก่อนงวดถัดไปชนด่านห้ามข้ามงวด แล้วรายงานเป็นข้ามที่อธิบายตัวเอง
          const after = await ctx.prisma.payment.findUnique({
            where: { id: p.id },
            select: { status: true },
          });
          if (after?.status !== 'PAID') {
            return (
              `ข้าม — งวด ${p.installmentNo} ของสัญญา ${c.contractNumber} หลังบันทึกได้สถานะ ` +
              `${after?.status ?? 'ไม่พบแถว'} ไม่ใช่ PAID (ยอดที่คำนวณไม่ตรงกับที่ service ตัดจริง) — ` +
              'หยุดก้าวนี้กันชนด่านห้ามข้ามงวด · รันเดินเรื่องซ้ำได้ ระบบจะจ่ายส่วนที่เหลือของงวดนี้ต่อเอง' +
              skipNotes
            );
          }
          paid += 1;
        }
        if (paid > 0) {
          return (
            `รับชำระ ${paid} งวดของสัญญา ${c.contractNumber} — ตรวจใบเสร็จที่ /receipts และสมุดที่ /finance/general-journal` +
            skipNotes
          );
        }
      }
      return `ข้าม — สัญญาทดสอบทุกใบไม่มีงวดค้างให้รับชำระ (อาจรันเดินเรื่องจนครบแล้ว)${skipNotes}`;
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
      const salesperson = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ctx.refs.salespersonId }, select: { branchId: true },
      });
      if (!salesperson.branchId) return 'ข้าม — พนักงานขายทดสอบยังไม่ได้ผูกสาขา';
      const product = await ctx.prisma.product.findFirst({
        where: {
          imeiSerial: { startsWith: TEST_IMEI_PREFIX },
          status: 'IN_STOCK',
          branchId: salesperson.branchId,
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
      // role จริงของ actor — resolveRefs หา salespersonId ด้วย where { role: 'SALES' }.
      // ห้ามส่ง OWNER: DiscountPolicy ใช้ role คู่นี้ตัดสินเพดานส่วนลด/ผู้อนุมัติคนที่สอง/
      // cost floor — ส่ง role เกินจริง = มอบอำนาจ OWNER ให้พนักงานขายทันทีที่ใครเติม discount
      const sale = await sales.create(dto, ctx.refs.salespersonId, 'SALES', salesperson.branchId);
      const row = await ctx.prisma.sale.findUnique({
        where: { id: sale.id },
        select: { saleNumber: true },
      });
      return `ขายสดแล้ว ${row?.saleNumber ?? sale.id} (${product.name}) — ตรวจที่ /sales และงบทดลอง SHOP ที่ /shop/accounting${nowOnlyDayNote}`;
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
      const salesperson = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ctx.refs.salespersonId }, select: { branchId: true },
      });
      if (!salesperson.branchId) return 'ข้าม — พนักงานขายทดสอบยังไม่ได้ผูกสาขา';
      const product = await ctx.prisma.product.findFirst({
        where: {
          imeiSerial: { startsWith: TEST_IMEI_PREFIX },
          status: 'IN_STOCK',
          branchId: salesperson.branchId,
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
      // role จริงของ actor (เหตุผลเดียวกับก้าวขายสด — DiscountPolicy อ่าน role นี้)
      const sale = await sales.create(dto, ctx.refs.salespersonId, 'SALES', salesperson.branchId);
      const row = await ctx.prisma.sale.findUnique({
        where: { id: sale.id },
        select: { saleNumber: true },
      });
      return `ขายผ่านไฟแนนซ์แล้ว ${row?.saleNumber ?? sale.id} (${financeCo.name}) — ลูกหนี้ S11-3101 ตรวจที่ /finance-receivable${nowOnlyDayNote}`;
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
          // Backend resolves the SHOP receiving bank and persists the actual account.
          notes: testNote('รับมัดจำจากโหมดเดินเรื่อง'),
        },
        actor,
      );
      return `รับมัดจำใบจอง ${booking.bookingNumber} — ตรวจ S21-2002 ในงบทดลอง SHOP ที่ /shop/accounting${nowOnlyDayNote}`;
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
      // MINOR 7: environment ที่เปิด Maker-Checker คือระบบที่ตั้งค่าถูกต้อง ไม่ใช่ความพัง —
      // EquityService.post จะ 409 เมื่อเอกสารไม่ READY และ 403 เมื่อ maker = ผู้โพสต์
      // (seeder สร้างเอกสารด้วย ownerId คนเดียวกับที่ก้าวนี้ใช้โพสต์) ⇒ อ่าน flag ก่อน
      // แล้วข้ามอย่างมีคำอธิบาย แทนที่จะรายงานเป็น ✗ ล้มเหลว
      const mc = await ctx.prisma.systemConfig.findUnique({
        where: { key: 'EQUITY_MAKER_CHECKER_ENABLED' },
        select: { value: true },
      });
      if (mc?.value === 'true') {
        return (
          'ข้าม — Maker-Checker ของเอกสารส่วนของผู้ถือหุ้นเปิดอยู่ (EQUITY_MAKER_CHECKER_ENABLED=true) — ' +
          'ต้องส่งอนุมัติแล้วให้ผู้อนุมัติคนละคนกดลงบัญชีผ่านหน้า /finance/equity เอง'
        );
      }
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
