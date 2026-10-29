import { Prisma } from '@prisma/client';
import {
  LEGACY_OPENING_FLOW,
  LEGACY_PRIOR_RECEIPT_FLOW,
  LEGACY_VAT_CATCHUP_FLOW,
} from '../../modules/accounting/peak-export-exclusion';
import type { AuditEntry } from '../../modules/audit/audit.service';
import { isImmutableContractDocument } from '../../modules/contracts/contract-documents.service';
import type { CustomerPiiService } from '../../modules/customers/customer-pii.service';
import type { JeLineInput, JournalAutoService } from '../../modules/journal/journal-auto.service';
import {
  LEGACY_OPENING_TAG,
  LEGACY_PRIOR_RECEIPT_TAG,
  LEGACY_VAT_CATCHUP_TAG,
  legacyOpeningReference,
  legacyPriorReceiptReference,
  legacyVatCatchUpReference,
} from '../../modules/journal/legacy-import-journal';
import { OPENING_EQUITY_ACCOUNT } from './opening';
import {
  linkOrCreateLegacyCustomer,
  lockLegacyCustomerPhones,
  type CustomerLinkResult,
  type LegacyCustomerWrite,
} from './customer';
import type { LegacyFileDetail } from './files';
import type { ImportBlocker, ImportPlan, PlannedContract } from './plan-import';

/**
 * เขียนแผนนำเข้า (`planImport`) ลงฐาน **ในธุรกรรมของผู้เรียกทั้งหมด** (Task 10) — ตัวเขียนไม่เปิดธุรกรรมเอง ไม่เรียก
 * `audit.log` (ผู้เรียกเขียน AuditLog หลัง commit ด้วย `legacyImportAuditEntry`) · dry-run = ผู้เรียกครอบด้วย
 * `$transaction` แล้วโยน sentinel ให้ rollback
 *
 * ลำดับในธุรกรรม (`.claude/rules/database.md` กติกาล็อก):
 * 1. `lockLegacyCustomerPhones` ของลูกค้าทุกสัญญาในแผน = **คำสั่งแรกของธุรกรรม**
 * 2. สัญญาที่ `legacyContractCode` มีอยู่แล้ว → ข้ามทั้งสัญญา (`skippedExisting`) · ถูกลบไปแล้ว = ตัวบล็อก
 * 3. ตรวจชนกับข้อมูลใน BESTCHOICE (อ่านอย่างเดียว): เลขสัญญา · รหัสเครื่องเดิม · IMEI ของสัญญา ACTIVE · รหัสงวดเดิม
 * 4. ลูกค้า**ต่อสัญญา** `linkOrCreateLegacyCustomer(…, { phoneLocked: true })` — ผลที่ไม่ใช่ CREATED/LINKED เก็บเป็นแถว
 *    ตัวบล็อก · ข้อ 2–4 มีแถวใด = โยน `LegacyWriteBlocked` พร้อม**ทุกแถว** (error ของฐานข้อมูลทำให้ธุรกรรมใช้ต่อไม่ได้ → โยนทันที)
 *    · ผู้เรียกต้อง rollback ทั้งธุรกรรม (ไม่มีการนำเข้าบางส่วน)
 * 5. ต่อสัญญา: เครื่อง → สัญญา → ตารางงวด → งวด (Payment) → สลิป → เอกสาร → รายการยกมา → marker → รายการไล่ VAT → stamp
 *
 * **เลขสัญญา** = เลขสัญญาเดิม (`BCPyymm-NNNNN` รูปเดียวกับ `generateContractNumber` — ลูกค้าเห็นเลขเดิมบนใบเสร็จ/ไลน์) ·
 * **เครื่อง** = หนึ่งแถวใหม่ต่อสัญญา (`legacyProductCode` — มีแถวใดถือรหัสนี้อยู่แล้ว รวมแถวที่ถูกลบ = `PRODUCT_CODE_TAKEN`) ·
 * `SOLD_INSTALLMENT` · กรรมสิทธิ์ FINANCE ยกเว้นสัญญา COMPLETED / EARLY_PAYOFF = null (ลูกค้าเป็นเจ้าของ) · ราคาทุน 0
 * (ระบบเก่าไม่มีราคาทุนของหน้าร้าน — แบบ `MigrationService.importContracts`) · ไม่ขึ้นหน้าร้านออนไลน์
 * · error ของฐานข้อมูลในขั้นนี้ = `LegacyWriteError` (ขั้น/เลขสัญญาเดิม/คลาส/รหัส — ไม่มีข้อความเดิม)
 *
 * **บัญชี (สัญญา ACTIVE เท่านั้น — สัญญาประวัติไม่มีตารางงวด ไม่มีรายการบัญชี ไม่มี stamp):**
 * - รายการยกมา: `reference` `legacy-opening:<เลขเดิม>` · `metadata { tag, flow: legacy-opening, idempotencyKey, contractId,
 *   importBatch }` · ลงวันตัด · `peakSyncedAt` = วันตัด
 * - marker หนึ่งรายการต่องวดที่จ่ายบางส่วน: Dr 32-1101 / Cr 11-2103 · `reference` `legacy-prior:<scheduleId>` ·
 *   `metadata { tag: '2B', flow: legacy-prior-receipt, contractId, installmentScheduleId, importBatch }` (**ไม่มี paymentId** —
 *   ตัวยกเลิกใบเสร็จหาใบเดิมด้วย paymentId) · ลงวันตัด · `peakSyncedAt` = วันตัด
 * - รายการไล่ VAT: `reference` `legacy-vat-catchup:<เลขเดิม>` · `metadata { tag/flow: legacy-vat-catchup, contractId, importBatch }`
 *   · ลง `plan.catchUpAt` (00:05 วันถัดจากวันตัด) **ในธุรกรรมเดียวกับรายการยกมา** · ไม่ตั้ง `peakSyncedAt` (ต้องเข้า PEAK)
 * - stamp: `accrued` → `accrualJournalEntryId` = เลขที่รายการยกมา + ยอดสะสม · บางส่วน → ยอดสะสมอย่างเดียว ·
 *   **ไม่เคยแตะ `vat60dayJournalEntryId`** · สัญญา ACTIVE ที่ไม่มีอะไรยกมาไม่มาถึงตัวเขียน (`planImport` บล็อก) — stamp
 *   `accrued` โดยไม่มีรายการยกมาให้ลิงก์ = throw (ห้ามเกิด)
 *
 * **งวด:** `lateFee` 0 · ยอดแยก (เงินต้น/ดอกเบี้ย/ค่าคอม/VAT) จากแผน (`paymentBreakdowns`) · `recordedById` = ผู้ใช้ระบบเมื่อมียอดจ่าย
 * · **สลิป:** `APPROVED` `imageUrl` = key ของ storage · **เอกสาร:** `fileUrl` = key · ชนิด/ขนาด/hash จาก `files` · `isImmutable`
 * ตาม `isImmutableContractDocument` · ไฟล์ที่ไม่อยู่ใน `files` = ไม่สร้างแถว รายงานใน `missingAttachments`
 * (ไม่ใช่ตัวบล็อก — เจ้าของตัดสินภายหลัง)
 *
 * ลูกค้าที่สร้างใหม่ไม่มี `accessCompanyCode` / `accessBranchId` (แบบ `MigrationService.importCustomers` — `customer.ts`)
 */

const ZERO = new Prisma.Decimal(0);
const SOURCE_NOTE = 'ยกมาจากระบบเก่า';
/** สถานะที่ลูกค้าเป็นเจ้าของเครื่องแล้ว (ระบบปลด `ownedByCompanyId` เป็น null ตอนผ่อนครบ — `payment-helpers.ts`) */
const CUSTOMER_OWNED_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'EARLY_PAYOFF']);

export type WriterDeps = {
  journal: Pick<JournalAutoService, 'createAndPost'>;
  pii: CustomerPiiService;
  financeCompanyId: string;
  /** สาขาที่ผูกสัญญา/เครื่อง (`--branch-id`) */
  branchId: string;
  /** ผู้ใช้ระบบ "ย้ายจากระบบเก่า" — ผู้ขาย/ผู้บันทึก/ผู้สร้างรายการบัญชี */
  systemUserId: string;
  /** ผลอัปโหลด (`uploadLegacyFiles(...).details`) — key = path เดิมใน dump */
  files: ReadonlyMap<string, LegacyFileDetail>;
  /** รหัสรอบนำเข้า → `metadata.importBatch` ของทุกรายการบัญชี */
  importBatch: string;
  /** เขียน `plan.items` ทั้งที่แผนมีตัวบล็อก — สำหรับซ้อม dry-run เท่านั้น (ค่าเริ่มต้นปฏิเสธก่อนส่งคำสั่งใด) */
  allowPlanBlockers?: boolean;
};

export type WriteReport = {
  importBatch: string;
  created: {
    customers: number;
    products: number;
    contracts: number;
    schedules: number;
    payments: number;
    evidences: number;
    documents: number;
    journalEntries: number;
  };
  /** เลขสัญญาเดิมที่มีอยู่แล้ว — ข้ามทั้งสัญญา */
  skippedExisting: string[];
  /** เลขสัญญาเดิม → id สัญญาใน BESTCHOICE (เฉพาะที่สร้างในรอบนี้) */
  contractIds: Map<string, string>;
  /** ผลผูกลูกค้าต่อสัญญา — `writes` ใช้เขียน audit หลัง commit */
  customers: Array<{
    code: string;
    legacyMemberCode: string;
    customerId: string;
    outcome: 'CREATED' | 'LINKED';
    writes: LegacyCustomerWrite[];
    phoneInvalid: boolean;
  }>;
  journalEntries: Array<{
    code: string;
    contractId: string;
    kind: 'opening' | 'marker' | 'catch-up';
    id: string;
    entryNumber: string;
    installmentNo?: number;
  }>;
  /** ไฟล์แนบ/สลิปที่ไม่อยู่ใน `deps.files` ต่อสัญญา */
  missingAttachments: Array<{ code: string; paths: string[] }>;
};

/**
 * นำเข้าไม่ได้เพราะข้อมูลใน BESTCHOICE (หรือแผนมีตัวบล็อก) — `rows` = ทุกแถวที่พบ ไม่มีข้อมูลส่วนบุคคล ·
 * ผู้เรียกแปลงเป็นแถวตัวบล็อกแล้ว rollback ทั้งธุรกรรม
 */
export class LegacyWriteBlocked extends Error {
  readonly code = 'LEGACY_WRITE_BLOCKED';

  constructor(readonly rows: ImportBlocker[]) {
    super(
      `LEGACY_WRITE_BLOCKED: นำเข้าไม่ได้ ${rows.length} แถว — ดู rows แล้ว rollback ทั้งธุรกรรม`,
    );
    this.name = 'LegacyWriteBlocked';
  }
}

/**
 * error ของฐานข้อมูลระหว่างเขียนสัญญา (หลังผ่านด่านทั้งหมดแล้ว — ธุรกรรมใช้ต่อไม่ได้) — มีแค่ขั้น เลขสัญญาเดิม ชื่อคลาส
 * และรหัสของ Prisma · **ไม่เก็บข้อความของ error เดิม** (`PrismaClientValidationError` พิมพ์ข้อมูลทั้งแถว: หมายเหตุสัญญา IMEI ฯลฯ)
 */
export class LegacyWriteError extends Error {
  readonly code = 'LEGACY_WRITE_FAILED';

  constructor(
    readonly step: string,
    readonly legacyCode: string,
    readonly errorClass: string,
    readonly prismaCode: string | null,
  ) {
    super(
      `LEGACY_WRITE_FAILED: สัญญา ${legacyCode} ขั้น ${step} — ${errorClass}${prismaCode ? ` ${prismaCode}` : ''}`,
    );
    this.name = 'LegacyWriteError';
  }
}

const PRISMA_ERRORS = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientInitializationError,
];
const isPrismaError = (error: unknown) => PRISMA_ERRORS.some((cls) => error instanceof cls);

/** แถวตัวบล็อกของ error — Prisma: ชื่อคลาส + รหัสเท่านั้น (ข้อความอาจยกค่าในแถว) · error ของ `customer.ts`: ข้อความ (ไม่มี PII) */
function errorDetail(error: unknown): Record<string, string> {
  const name = error instanceof Error ? error.name || error.constructor.name : 'Error';
  const code = (error as { code?: unknown } | null)?.code;
  if (isPrismaError(error)) {
    return typeof code === 'string' ? { errorClass: name, prismaCode: code } : { errorClass: name };
  }
  return { errorClass: name, message: error instanceof Error ? error.message : String(error) };
}

/** ผลผูกลูกค้าที่ไม่ใช่ CREATED/LINKED → แถวตัวบล็อก (รหัสสมาชิก + id ลูกค้า/รหัส PEAK ที่ชน — ไม่มีข้อมูลส่วนบุคคล) */
function customerBlocker(
  item: PlannedContract,
  result: Extract<CustomerLinkResult, { customerId: null }>,
): ImportBlocker {
  const base: Record<string, string> = { memberCode: item.memberCode };
  if (result.phoneInvalid) base.phoneInvalid = 'yes';
  switch (result.outcome) {
    case 'PHONE_TAKEN':
    case 'NATIONAL_ID_CONFLICT':
    case 'INVALID_NATIONAL_ID': {
      const reason =
        result.outcome === 'PHONE_TAKEN'
          ? 'CUSTOMER_PHONE_TAKEN'
          : result.outcome === 'NATIONAL_ID_CONFLICT'
            ? 'CUSTOMER_NATIONAL_ID_CONFLICT'
            : 'CUSTOMER_INVALID_NATIONAL_ID';
      return {
        code: item.code,
        reason,
        detail: result.relatedCustomerId
          ? { ...base, relatedCustomerId: result.relatedCustomerId }
          : base,
      };
    }
    case 'PEAK_CODE_CONFLICT':
      return {
        code: item.code,
        reason: 'CUSTOMER_PEAK_CODE_CONFLICT',
        detail: {
          ...base,
          ...(result.relatedCustomerId ? { relatedCustomerId: result.relatedCustomerId } : {}),
          peakContactCode: result.requestedPeakContactCode,
          otherPeakContactCode: result.existingPeakContactCode,
        },
      };
  }
}

/** ชนกับข้อมูลใน BESTCHOICE (อ่านอย่างเดียว) — คืนแถวตัวบล็อก + เครื่องที่ใช้ซ้ำได้ (`legacyProductCode` → id) */
async function findCollisions(
  tx: Prisma.TransactionClient,
  items: readonly PlannedContract[],
): Promise<ImportBlocker[]> {
  const rows: ImportBlocker[] = [];
  if (items.length === 0) return rows;

  const numbers = await tx.contract.findMany({
    where: { contractNumber: { in: items.map((i) => i.code) } },
    select: { contractNumber: true },
  });
  const takenNumbers = new Set(numbers.map((c) => c.contractNumber));

  // unique ของ legacyProductCode ครอบแถวที่ถูกลบด้วย ⇒ แถวใดก็ตามที่ถือรหัสนี้ = ตัวบล็อก (ไม่ใช้แถวเดิมซ้ำ — M-3)
  const takenProducts = new Map(
    (
      await tx.product.findMany({
        where: { legacyProductCode: { in: items.map((i) => i.product.legacyProductCode) } },
        select: { id: true, legacyProductCode: true, deletedAt: true },
      })
    ).map((p) => [p.legacyProductCode, p]),
  );

  const imeis = items.flatMap((i) => (i.product.imeiSerial ? [i.product.imeiSerial] : []));
  const imeiHolders = imeis.length
    ? await tx.product.findMany({
        where: { imeiSerial: { in: imeis }, deletedAt: null },
        select: { id: true, imeiSerial: true },
      })
    : [];

  const installmentCodes = items.flatMap((i) => i.payments.map((p) => p.legacyInstallmentCode));
  const takenInstallments = new Set(
    (
      await tx.payment.findMany({
        where: { legacyInstallmentCode: { in: installmentCodes } },
        select: { legacyInstallmentCode: true },
      })
    ).map((p) => p.legacyInstallmentCode),
  );

  for (const item of items) {
    if (takenNumbers.has(item.code))
      rows.push({ code: item.code, reason: 'CONTRACT_NUMBER_TAKEN' });
    const takenProduct = takenProducts.get(item.product.legacyProductCode);
    if (takenProduct) {
      rows.push({
        code: item.code,
        reason: 'PRODUCT_CODE_TAKEN',
        detail: {
          productId: takenProduct.id,
          ...(takenProduct.deletedAt ? { deleted: 'yes' } : {}),
        },
      });
    }
    const holder = imeiHolders.find((h) => h.imeiSerial === item.product.imeiSerial);
    if (item.product.imeiSerial && holder) {
      rows.push({ code: item.code, reason: 'IMEI_TAKEN', detail: { productId: holder.id } });
    }
    const codes = item.payments
      .map((p) => p.legacyInstallmentCode)
      .filter((c) => takenInstallments.has(c));
    if (codes.length > 0) {
      rows.push({
        code: item.code,
        reason: 'INSTALLMENT_CODE_TAKEN',
        detail: { installmentCodes: codes.join(',') },
      });
    }
  }
  return rows;
}

export async function writeLegacyImport(
  tx: Prisma.TransactionClient,
  plan: ImportPlan,
  deps: WriterDeps,
): Promise<WriteReport> {
  if (plan.blockers.length > 0 && !deps.allowPlanBlockers)
    throw new LegacyWriteBlocked(plan.blockers);

  // ① คำสั่งแรกของธุรกรรม — ล็อกเบอร์ของลูกค้าทุกสัญญา (เรียงคีย์ ไม่ซ้ำ)
  await lockLegacyCustomerPhones(
    tx,
    deps.pii,
    plan.items.map((i) => i.customer),
  );

  const report: WriteReport = {
    importBatch: deps.importBatch,
    created: {
      customers: 0,
      products: 0,
      contracts: 0,
      schedules: 0,
      payments: 0,
      evidences: 0,
      documents: 0,
      journalEntries: 0,
    },
    skippedExisting: [],
    contractIds: new Map(),
    customers: [],
    journalEntries: [],
    missingAttachments: [],
  };

  // ② สัญญาที่นำเข้าแล้ว (unique ครอบแถวที่ถูกลบ — ไม่กรอง deletedAt)
  const existing = await tx.contract.findMany({
    where: { legacyContractCode: { in: plan.items.map((i) => i.code) } },
    select: { legacyContractCode: true, deletedAt: true },
  });
  const rows: ImportBlocker[] = [];
  const existingCodes = new Set<string>();
  for (const c of existing) {
    if (!c.legacyContractCode) continue;
    existingCodes.add(c.legacyContractCode);
    if (c.deletedAt) rows.push({ code: c.legacyContractCode, reason: 'CONTRACT_CODE_DELETED' });
    else report.skippedExisting.push(c.legacyContractCode);
  }
  const todo = plan.items.filter((i) => !existingCodes.has(i.code));

  // ③ ชนกับข้อมูลเดิม (อ่านอย่างเดียว)
  rows.push(...(await findCollisions(tx, todo)));

  // ④ ลูกค้าต่อสัญญา
  const customerOf = new Map<string, string>();
  for (const item of todo) {
    let result: CustomerLinkResult;
    try {
      result = await linkOrCreateLegacyCustomer(tx, deps.pii, item.customer, { phoneLocked: true });
    } catch (error) {
      rows.push({
        code: item.code,
        reason: 'CUSTOMER_LINK_ERROR',
        detail: { memberCode: item.memberCode, ...errorDetail(error) },
      });
      // error ของฐานข้อมูลทำให้ธุรกรรมใช้ต่อไม่ได้ — หยุดเก็บแถว
      if (isPrismaError(error)) throw new LegacyWriteBlocked(rows);
      continue;
    }
    if (result.customerId === null) {
      rows.push(customerBlocker(item, result));
      continue;
    }
    customerOf.set(item.code, result.customerId);
    if (result.outcome === 'CREATED') report.created.customers++;
    report.customers.push({
      code: item.code,
      legacyMemberCode: item.memberCode,
      customerId: result.customerId,
      outcome: result.outcome,
      writes: result.writes,
      phoneInvalid: result.phoneInvalid === true,
    });
  }
  if (rows.length > 0) throw new LegacyWriteBlocked(rows);

  // ⑤ ต่อสัญญา — error ของฐานข้อมูลเหลือแค่ขั้น/เลขสัญญาเดิม/คลาส/รหัส (M-4)
  for (const item of todo) {
    const track = { step: 'product' };
    try {
      await writeContract(tx, plan, deps, item, {
        customerId: customerOf.get(item.code) as string,
        report,
        track,
      });
    } catch (error) {
      if (!isPrismaError(error)) throw error;
      const code = (error as { code?: unknown }).code;
      throw new LegacyWriteError(
        track.step,
        item.code,
        (error as Error).name || (error as Error).constructor.name,
        typeof code === 'string' ? code : null,
      );
    }
  }
  return report;
}

async function writeContract(
  tx: Prisma.TransactionClient,
  plan: ImportPlan,
  deps: WriterDeps,
  item: PlannedContract,
  ctx: { customerId: string; report: WriteReport; track: { step: string } },
): Promise<void> {
  const { report, track } = ctx;
  const m = item.money;

  // เครื่อง — สัญญาที่ผ่อนจบ/ปิดก่อนกำหนด: ลูกค้าเป็นเจ้าของ (`ownedByCompanyId` null แบบ `checkContractCompletion`
  // ใน `payment-helpers.ts` ที่ปลดกรรมสิทธิ์ตอนผ่อนครบ) · สถานะอื่น FINANCE ถือ
  track.step = 'product';
  const p = item.product;
  const productId = (
    await tx.product.create({
      data: {
        name: p.name,
        brand: p.brand,
        model: p.model,
        color: p.color,
        storage: p.storage,
        imeiSerial: p.imeiSerial,
        serialNumber: p.serialNumber,
        category: p.category,
        costPrice: ZERO,
        branchId: deps.branchId,
        ownedByCompanyId: CUSTOMER_OWNED_STATUSES.has(item.status) ? null : deps.financeCompanyId,
        status: 'SOLD_INSTALLMENT',
        isOnlineVisible: false,
        legacyProductCode: p.legacyProductCode,
        createdAt: item.contractDate,
      },
      select: { id: true },
    })
  ).id;
  report.created.products++;

  // สัญญา
  track.step = 'contract';
  const contractId = (
    await tx.contract.create({
      data: {
        contractNumber: item.code,
        legacyContractCode: item.code,
        customerId: ctx.customerId,
        productId,
        branchId: deps.branchId,
        salespersonId: deps.systemUserId,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: m.sellingPrice,
        downPayment: m.downPayment,
        interestRate: m.interestRate,
        totalMonths: m.totalMonths,
        interestTotal: m.interestTotal,
        financedAmount: m.financedAmount,
        storeCommission: m.storeCommission,
        vatAmount: m.vatAmount,
        vatPct: m.vatPct,
        monthlyPayment: m.monthlyPayment,
        status: item.status,
        workflowStatus: 'APPROVED',
        reviewedById: deps.systemUserId,
        reviewedAt: item.contractDate,
        reviewNotes: SOURCE_NOTE,
        paymentDueDay: item.paymentDueDay,
        interestConfigId: null,
        notes: item.notes,
        createdAt: item.contractDate,
        deviceReceivedAt: item.contractDate,
      },
      select: { id: true },
    })
  ).id;
  report.created.contracts++;
  report.contractIds.set(item.code, contractId);

  // ตารางงวด (ACTIVE)
  track.step = 'schedule';
  const scheduleIdByNo = new Map<number, string>();
  if (item.schedule.length > 0) {
    await tx.installmentSchedule.createMany({
      data: item.schedule.map((row) => ({ contractId, ...row })),
    });
    for (const row of await tx.installmentSchedule.findMany({
      where: { contractId },
      select: { id: true, installmentNo: true },
    })) {
      scheduleIdByNo.set(row.installmentNo, row.id);
    }
    report.created.schedules += item.schedule.length;
  }

  // งวด
  track.step = 'payments';
  await tx.payment.createMany({
    data: item.payments.map((p) => ({
      contractId,
      installmentNo: p.installmentNo,
      dueDate: p.dueDate,
      amountDue: p.amountDue,
      amountPaid: p.amountPaid,
      paidDate: p.paidDate,
      status: p.status,
      lateFee: ZERO,
      monthlyPrincipal: p.monthlyPrincipal,
      monthlyInterest: p.monthlyInterest,
      monthlyCommission: p.monthlyCommission,
      vatAmount: p.vatAmount,
      notes: p.notes,
      legacyInstallmentCode: p.legacyInstallmentCode,
      recordedById: p.amountPaid.gt(0) ? deps.systemUserId : null,
    })),
  });
  report.created.payments += item.payments.length;
  const paymentIdByNo = new Map(
    (
      await tx.payment.findMany({
        where: { contractId },
        select: { id: true, installmentNo: true },
      })
    ).map((p) => [p.installmentNo, p.id]),
  );

  // สลิป + เอกสาร (ไฟล์ที่ไม่ได้อัปโหลด = ไม่สร้างแถว)
  const missing = new Set<string>();
  const evidences = item.evidences.flatMap((e) => {
    const file = deps.files.get(e.slipPath);
    if (!file) {
      missing.add(e.slipPath);
      return [];
    }
    return [
      {
        contractId,
        paymentId: e.installmentNo === null ? null : (paymentIdByNo.get(e.installmentNo) ?? null),
        imageUrl: file.key,
        amount: e.amount,
        status: 'APPROVED' as const,
        reviewedById: deps.systemUserId,
        reviewedAt: e.date,
        reviewNote: `${SOURCE_NOTE} · ใบรับเงินเดิม ${e.legacyReceiptId}`,
        createdAt: e.date,
      },
    ];
  });
  track.step = 'evidences';
  if (evidences.length > 0) await tx.paymentEvidence.createMany({ data: evidences });
  report.created.evidences += evidences.length;

  const documents = item.documents.flatMap((d) => {
    const file = deps.files.get(d.path);
    if (!file) {
      missing.add(d.path);
      return [];
    }
    const fileName = file.key.split('/').pop() || file.key;
    return [
      {
        contractId,
        documentType: d.documentType,
        fileName,
        originalName: fileName,
        fileUrl: file.key,
        fileSize: file.size,
        mimeType: file.contentType,
        fileHash: file.sha256,
        notes: d.notes ? `${SOURCE_NOTE} · ${d.notes}` : SOURCE_NOTE,
        // กติกาเดียวกับตอนอัปโหลด: สัญญาที่ลงนามแล้ว ฯลฯ ของสัญญาที่ยังเดิน/ปิดแล้ว ลบ/อัปโหลดทับไม่ได้ (M-1)
        isImmutable: isImmutableContractDocument(d.documentType, item.status),
        uploadedById: deps.systemUserId,
      },
    ];
  });
  track.step = 'documents';
  if (documents.length > 0) await tx.contractDocument.createMany({ data: documents });
  report.created.documents += documents.length;
  if (missing.size > 0)
    report.missingAttachments.push({ code: item.code, paths: [...missing].sort() });

  if (!item.opening) return;
  await writeOpening(tx, plan, deps, item, contractId, scheduleIdByNo, report, track);
}

async function writeOpening(
  tx: Prisma.TransactionClient,
  plan: ImportPlan,
  deps: WriterDeps,
  item: PlannedContract,
  contractId: string,
  scheduleIdByNo: ReadonlyMap<number, string>,
  report: WriteReport,
  track: { step: string },
): Promise<void> {
  const opening = item.opening!;
  const post = async (
    kind: WriteReport['journalEntries'][number]['kind'],
    input: {
      description: string;
      reference: string;
      metadata: Record<string, string>;
      lines: JeLineInput[];
      postedAt: Date;
    },
    installmentNo?: number,
  ) => {
    const entry = await deps.journal.createAndPost(
      {
        ...input,
        companyId: deps.financeCompanyId,
        createdById: deps.systemUserId,
      },
      tx,
    );
    report.created.journalEntries++;
    report.journalEntries.push({
      code: item.code,
      contractId,
      kind,
      id: entry.id,
      entryNumber: entry.entryNumber,
      ...(installmentNo === undefined ? {} : { installmentNo }),
    });
    return entry;
  };

  const synced: string[] = [];
  let openingEntryNumber: string | null = null;
  track.step = 'opening';
  if (opening.openingLines.length > 0) {
    const entry = await post('opening', {
      description: `ยกมาจากระบบเก่า — สัญญา ${item.code}`,
      reference: legacyOpeningReference(item.code),
      metadata: {
        tag: LEGACY_OPENING_TAG,
        flow: LEGACY_OPENING_FLOW,
        idempotencyKey: item.code,
        contractId,
        importBatch: deps.importBatch,
      },
      lines: opening.openingLines,
      postedAt: plan.cutoff,
    });
    openingEntryNumber = entry.entryNumber;
    synced.push(entry.id);
  }

  track.step = 'markers';
  for (const marker of opening.priorReceiptMarkers) {
    const installmentScheduleId = scheduleIdByNo.get(marker.installmentNo);
    if (!installmentScheduleId) {
      throw new Error(
        `writeLegacyImport: สัญญา ${item.code} ไม่มีแถวตารางงวด ${marker.installmentNo} ของ marker`,
      );
    }
    const entry = await post(
      'marker',
      {
        description: `ยอดรับก่อนวันตัดระบบ งวด ${marker.installmentNo} — สัญญา ${item.code}`,
        reference: legacyPriorReceiptReference(installmentScheduleId),
        metadata: {
          tag: LEGACY_PRIOR_RECEIPT_TAG,
          flow: LEGACY_PRIOR_RECEIPT_FLOW,
          contractId,
          installmentScheduleId,
          importBatch: deps.importBatch,
        },
        lines: [
          {
            accountCode: OPENING_EQUITY_ACCOUNT,
            dr: marker.amount,
            cr: ZERO,
            description: `ยกมาจากระบบเก่า: ยอดรับก่อนวันตัดของงวด ${marker.installmentNo}`,
          },
          {
            accountCode: '11-2103',
            dr: ZERO,
            cr: marker.amount,
            description: `ยอดรับก่อนวันตัดของงวด ${marker.installmentNo} (ระบบเก่า)`,
          },
        ],
        postedAt: plan.cutoff,
      },
      marker.installmentNo,
    );
    synced.push(entry.id);
  }
  if (synced.length > 0) {
    await tx.journalEntry.updateMany({
      where: { id: { in: synced } },
      data: { peakSyncedAt: plan.cutoff },
    });
  }

  track.step = 'catch-up';
  if (opening.catchUpLines.length > 0) {
    await post('catch-up', {
      description: `ไล่ภาษีขายของงวดที่ค้างก่อนวันตัดระบบ — สัญญา ${item.code}`,
      reference: legacyVatCatchUpReference(item.code),
      metadata: {
        tag: LEGACY_VAT_CATCHUP_TAG,
        flow: LEGACY_VAT_CATCHUP_FLOW,
        contractId,
        importBatch: deps.importBatch,
      },
      lines: opening.catchUpLines,
      postedAt: plan.catchUpAt,
    });
  }

  track.step = 'stamps';
  for (const stamp of opening.stamps) {
    const id = scheduleIdByNo.get(stamp.installmentNo);
    if (!id) {
      throw new Error(
        `writeLegacyImport: สัญญา ${item.code} ไม่มีแถวตารางงวด ${stamp.installmentNo}`,
      );
    }
    const accrued = {
      accruedAmount: stamp.accruedAmount,
      accruedVat: stamp.accruedVat,
      accruedInterest: stamp.accruedInterest,
    };
    if (stamp.accrued) {
      if (!openingEntryNumber) {
        throw new Error(
          `writeLegacyImport: สัญญา ${item.code} งวด ${stamp.installmentNo} ตั้งลูกหนี้แล้วแต่ไม่มีรายการยกมาให้ลิงก์`,
        );
      }
      await tx.installmentSchedule.update({
        where: { id },
        data: { accrualJournalEntryId: openingEntryNumber, ...accrued },
      });
    } else if (!stamp.accruedAmount.isZero()) {
      await tx.installmentSchedule.update({ where: { id }, data: accrued });
    }
  }
}

/** AuditLog หนึ่งแถวต่อรอบนำเข้า — ผู้เรียกส่งให้ `AuditService.log` **หลัง commit** เท่านั้น */
export function legacyImportAuditEntry(report: WriteReport, userId: string): AuditEntry {
  return {
    userId,
    action: 'LEGACY_IMPORT_COMMITTED',
    entity: 'legacy-import',
    entityId: report.importBatch,
    newValue: {
      created: report.created,
      skippedExisting: report.skippedExisting,
      contracts: [...report.contractIds.entries()].map(([code, contractId]) => ({
        code,
        contractId,
      })),
      customerWrites: report.customers.map((c) => ({
        code: c.code,
        legacyMemberCode: c.legacyMemberCode,
        customerId: c.customerId,
        outcome: c.outcome,
        writes: c.writes,
      })),
      missingAttachments: report.missingAttachments.reduce((n, m) => n + m.paths.length, 0),
    },
  };
}
