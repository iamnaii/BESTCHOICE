import { Prisma } from '@prisma/client';

import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';
import { cleanupTestContracts } from '../cleanup-test-contracts.cli';
import {
  TEST_CONTRACT_PREFIX,
  TEST_CUSTOMER_ADDRESS,
  TEST_IMEI_PREFIX,
  seedTestContracts,
} from '../seed-test-contracts.cli';
import { round2 } from './_helpers';

/** จำนวน scenario ของ seeder เดิม — ตรงกับ SCENARIOS.length ใน seed-test-contracts.cli.ts */
const CONTRACT_COUNT = 7;

/**
 * seedTestContracts ต้องการ Refs รูปของตัวเอง (มี interestConfigId ที่ SeedRefs ไม่มี)
 * แปลงตรงนี้ที่เดียว — ไม่ไปแก้ไฟล์เดิมซึ่งยังต้องรันด้วยตัวเองได้อยู่
 */
async function adaptRefs(ctx: SeedContext) {
  const ic = await ctx.prisma.interestConfig.findFirst({ select: { id: true } });
  return {
    branchId: ctx.refs.branchId,
    branchName: ctx.refs.branchName,
    salespersonId: ctx.refs.salespersonId,
    reviewerId: ctx.refs.reviewerId,
    interestConfigId: ic?.id ?? null,
    shopCompanyId: ctx.refs.shopCompanyId,
    financeCompanyId: ctx.refs.financeCompanyId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// สัญญา DRAFT (workflow APPROVED) 1 ใบ — input ของโหมดเดินเรื่อง (DRIVE=1) ก้าว 1
//
// seeder เดิมสร้างทุก scenario เป็น ACTIVE/TERMINATED ตรง ๆ ⇒ ก้าว "เปิดสัญญาผ่อน"
// ของ _drive.ts ไม่มีอะไรให้ activate และคิวรอจ่าย INTER-CO ว่างตลอด (ช่องว่างที่
// Task 12 พบ). wrapper จึงสร้างสัญญา DRAFT เพิ่มเองที่นี่ — ห้ามแก้ CLI เดิม
// (มันต้องรันเดี่ยวได้เหมือนเดิม). ตัว JE (1A + SHOP leg) เป็นงานของโหมดเดินเรื่อง
// ผ่าน ContractWorkflowService.activate ของจริง — seeder ไม่โพสต์อะไรเอง (R1/R2).
//
// ด่านของ activate (contract-workflow.service.ts:341) ที่แถวนี้ต้องผ่านครบ:
//   1. workflowStatus = APPROVED (:345) + status = DRAFT (:348)
//   2. pdpaConsentId ไม่เป็น null (:353) → สร้าง PDPAConsent สถานะ GRANTED ผูกไว้
//   3. verifyContractHash (:361) — contractHash = null ⇒ ข้ามตามทาง legacy (:143)
//   4. ลายเซ็นครบ 4 ฝ่าย: CUSTOMER + COMPANY/STAFF + WITNESS_1 + WITNESS_2 (:364-376)
//   5. ลูกค้าไม่มี birthDate ⇒ ไม่ติดด่านผู้ปกครอง (:379-387)
//   6. เครื่องคู่สัญญา deletedAt = null + สถานะ RESERVED/IN_STOCK (:394-399, เช็คซ้ำใน tx
//      :437-442) → สร้างเป็น RESERVED ของ SHOP (activate เป็นคนย้ายกรรมสิทธิ์ไป FINANCE)
//   7. downPayment = 0 โดยเจตนา — ด่าน catch-up ShopDownPayment ใน activate เรียก
//      resolveBranchCashAccount ซึ่ง throw ถ้าสาขาไม่ได้ตั้ง shopCashAccountCode;
//      0 บาททำให้ก้าวเดินเรื่องไม่พึ่ง config สาขา และสมุดไม่ขาด JE เงินดาวน์
//      (R1 ห้าม seeder โพสต์ JE — สัญญาดาวน์ 0 คือสัญญาที่สมุด "ครบ" โดยไม่ต้องโพสต์)
//   8. ไม่สร้าง installment_schedules — activate สร้างเองเมื่อยังไม่มี
//      (generateInstallmentSchedules) จาก createdAt + paymentDueDay ด้วยสูตร local-time
//      เดียวกับ dueDate ของ Payment ด้านล่าง ⇒ สองตารางตรงกันโดยโครงสร้าง
//   9. สิ่งที่ activate "ส่งออก" ไม่ใช่แค่สิ่งที่มันอ่าน: sendContractActivatedNotification
//      (contract-workflow.service.ts:713-735) — ลูกค้าไม่มี lineIdFinance ⇒ ตกสาขา
//      `else if (customer.phone)` แล้วส่ง SMS **จริง** ผ่าน NotificationsService.send
//      (Customer.phone เป็นคอลัมน์ non-nullable — เว้นว่างไม่ได้) ⇒ เบอร์ลูกค้าทดสอบ
//      ต้องอยู่ใน block สำรอง 08990000NN เดียวกับลูกค้าเปล่าของ CLI เดิม
//      (seed-test-contracts.cli.ts:255) — ห้ามใช้ 09xxxxxxxx ที่ route ถึงคนจริงได้
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_SELLING_PRICE = 19900;
/** 80% ของราคาขาย — สัดส่วนเดียวกับเครื่องคู่สัญญาของ CLI เดิม (sellingPrice * 0.8) */
const DRAFT_COST_PRICE = 15920;
const DRAFT_MONTHS = 6;
const DRAFT_RATE = '0.08'; // flat ต่อเดือน — ช่วงเดียวกับ SCENARIOS ของ CLI เดิม
const DRAFT_COMMISSION_PCT = '0.1';
const DRAFT_VAT_PCT = '0.07';

/** เงื่อนไขเดียวกับที่ _drive.ts ก้าว 1 ใช้หาสัญญาให้ activate — และใช้เป็น probe กันสร้างซ้ำ */
const DRAFT_CONTRACT_WHERE: Prisma.ContractWhereInput = {
  contractNumber: { startsWith: TEST_CONTRACT_PREFIX },
  status: 'DRAFT',
  workflowStatus: 'APPROVED',
  deletedAt: null,
};

/** PNG โปร่งใส 1×1 (base64) — activate ตรวจแค่ signerType ครบ; รูปจริงไม่จำเป็นกับข้อมูลทดสอบ */
const TEST_SIGNATURE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const DRAFT_SIGNERS = [
  { signerType: 'CUSTOMER', signerName: 'ลูกค้าทดสอบระบบ', staff: false },
  { signerType: 'COMPANY', signerName: 'พนักงานขายทดสอบระบบ', staff: true },
  { signerType: 'WITNESS_1', signerName: 'พยานทดสอบระบบ 1', staff: false },
  { signerType: 'WITNESS_2', signerName: 'พยานทดสอบระบบ 2', staff: false },
] as const;

/**
 * mirror ของ calc() ใน CLI เดิม (Math.round 2 ตำแหน่ง → ROUND_HALF_UP, Math.ceil ค่างวด
 * → ROUND_CEIL 0 ตำแหน่ง) แต่คิดใน Prisma.Decimal ทั้งหมดตาม Global Constraint ห้าม float.
 * down = 0 ⇒ principal = ราคาขาย และ "ยอดจัด" (Contract.financedAmount) = principal base
 * ตามหมายเหตุใน CLI เดิม — 1A บวกค่าคอม+ดอกเบี้ย+VAT ทับเองตอนตั้งลูกหนี้ Gross.
 */
function draftCalc() {
  const principal = round2(new Prisma.Decimal(DRAFT_SELLING_PRICE));
  const storeCommission = round2(principal.mul(DRAFT_COMMISSION_PCT));
  const interestTotal = round2(principal.mul(DRAFT_RATE).mul(DRAFT_MONTHS));
  const vatAmount = round2(principal.plus(storeCommission).plus(interestTotal).mul(DRAFT_VAT_PCT));
  const grandTotal = principal.plus(storeCommission).plus(interestTotal).plus(vatAmount);
  const monthlyPayment = grandTotal.div(DRAFT_MONTHS).toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL);
  return { principal, storeCommission, interestTotal, vatAmount, monthlyPayment };
}

/**
 * งวดชำระแบบเดียวกับ CLI เดิม: ceil ต่องวดสำหรับงวด 1..N-1, เศษที่เหลือลงงวดสุดท้าย,
 * VAT ต่องวด = ค่างวด − ต้น − ดอก − คอม. ทุกงวดเป็นอนาคต (PENDING) เพราะสัญญายังไม่เปิด.
 * dueDate ใช้สูตร local-time เดียวกับ buildInstallmentScheduleRows เป๊ะ ๆ —
 * `new Date(createdAt.getFullYear(), createdAt.getMonth() + i, dueDay)` — เพื่อให้ตารางงวด
 * ที่ activate สร้างทีหลังตรงกับ Payment ทุกแถว.
 */
function draftInstallmentRows(
  contractId: string,
  createdAt: Date,
  dueDay: number,
  c: ReturnType<typeof draftCalc>,
): Prisma.PaymentCreateManyInput[] {
  const perInst = (total: Prisma.Decimal) =>
    total.div(DRAFT_MONTHS).toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL);
  const mpPrincipal = perInst(c.principal);
  const mpInterest = perInst(c.interestTotal);
  const mpCommission = perInst(c.storeCommission);
  let usedP = new Prisma.Decimal(0);
  let usedI = new Prisma.Decimal(0);
  let usedC = new Prisma.Decimal(0);
  const rows: Prisma.PaymentCreateManyInput[] = [];
  for (let i = 1; i <= DRAFT_MONTHS; i++) {
    const isLast = i === DRAFT_MONTHS;
    const principal = isLast ? round2(c.principal.minus(usedP)) : mpPrincipal;
    const interest = isLast ? round2(c.interestTotal.minus(usedI)) : mpInterest;
    const commission = isLast ? round2(c.storeCommission.minus(usedC)) : mpCommission;
    const vat = round2(c.monthlyPayment.minus(principal).minus(interest).minus(commission));
    usedP = usedP.plus(principal);
    usedI = usedI.plus(interest);
    usedC = usedC.plus(commission);
    rows.push({
      contractId,
      installmentNo: i,
      dueDate: new Date(createdAt.getFullYear(), createdAt.getMonth() + i, dueDay),
      amountDue: c.monthlyPayment,
      amountPaid: 0,
      status: 'PENDING',
      monthlyPrincipal: principal,
      monthlyInterest: interest,
      monthlyCommission: commission,
      vatAmount: vat,
    });
  }
  return rows;
}

async function seedDraftContract(
  ctx: SeedContext,
  refs: Awaited<ReturnType<typeof adaptRefs>>,
): Promise<{ created: number; skipped: number; note: string }> {
  // Re-run safe: มีสัญญา DRAFT (workflow APPROVED) ค้างอยู่แล้ว = ไม่สร้างซ้ำ —
  // เงื่อนไขชุดเดียวกับที่ก้าวเดินเรื่องใช้หา จึง "มีของให้ activate อยู่แล้ว" โดยนิยาม
  const existing = await ctx.prisma.contract.findFirst({
    where: DRAFT_CONTRACT_WHERE,
    select: { contractNumber: true },
  });
  if (existing) {
    return {
      created: 0,
      skipped: 1,
      note: `สัญญา DRAFT มีอยู่แล้ว (${existing.contractNumber}) — ข้าม ไม่สร้างซ้ำ`,
    };
  }

  // ต่อคิวเลขรายวันชุดเดียวกับ CLI เดิม (count รวมแถว soft-deleted โดยเจตนา —
  // เลขไม่ถูกนำกลับมาใช้ซ้ำ) — รันหลัง delegate จึงนับต่อจาก 7 ใบของ CLI ให้เอง
  const contractSeq =
    (await ctx.prisma.contract.count({
      where: { contractNumber: { startsWith: `${TEST_CONTRACT_PREFIX}${ctx.dateStr}-` } },
    })) + 1;
  const contractNumber = `${TEST_CONTRACT_PREFIX}${ctx.dateStr}-${String(contractSeq).padStart(3, '0')}`;
  const imeiSeq =
    (await ctx.prisma.product.count({
      where: { imeiSerial: { startsWith: `${TEST_IMEI_PREFIX}${ctx.dateStr}-` } },
    })) + 1;
  const imeiSerial = `${TEST_IMEI_PREFIX}${ctx.dateStr}-${String(imeiSeq).padStart(3, '0')}`;

  const c = draftCalc();
  // createdAt ต้องเป็นค่าเดียวกับที่ใช้คำนวณ dueDate — generateInstallmentSchedules ของ
  // activate อ่าน contract.createdAt + paymentDueDay ด้วยสูตรเดียวกัน ⇒ lockstep โดยโครงสร้าง
  const createdAt = new Date();
  const paymentDueDay = createdAt.getDate();

  await ctx.prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        name: `ทดสอบ รอเปิดสัญญา (DRAFT) ${contractSeq}`,
        // block สำรอง 08990000NN (convention เดียวกับลูกค้าเปล่าของ CLI เดิม) — สัญญาใบนี้
        // เป็นใบเดียวที่ไปถึง activate ซึ่งส่ง SMS จริงถึงเบอร์นี้ (ดูด่านข้อ 9 ด้านบน);
        // ชนกับลูกค้าเปล่า (NN=01,02) ได้ ไม่เป็นไร — คอลัมน์ phone ไม่ unique
        phone: `08990000${String(contractSeq % 100).padStart(2, '0')}`,
        prefix: 'นาย',
        occupation: 'ทดสอบ',
        addressCurrent: TEST_CUSTOMER_ADDRESS, // marker ให้ cleanup เดิมกวาดเจอ
        // birthDate จงใจไม่ใส่ — activate ข้ามด่านลายเซ็นผู้ปกครองเมื่อไม่มีวันเกิด
      },
    });
    const consent = await tx.pDPAConsent.create({
      data: {
        customerId: customer.id,
        consentVersion: 'TEST-1.0',
        privacyNoticeText:
          'ยินยอมตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (ข้อมูลทดสอบระบบ — ลบได้)',
        purposes: ['ทดสอบระบบ — สัญญาผ่อนชำระ'],
        status: 'GRANTED',
        grantedAt: createdAt,
      },
    });
    // เครื่องคู่สัญญาของตัวเอง (IMEI ขึ้นต้น TEST-) — activate ห้ามไปแตะเครื่องจริง
    const product = await tx.product.create({
      data: {
        name: `ทดสอบระบบ มือถือคู่สัญญา ${contractNumber}`,
        brand: 'ทดสอบระบบ',
        model: `TEST-DRAFT-${contractSeq}`,
        color: 'ดำ',
        storage: '128GB',
        imeiSerial,
        category: 'PHONE_NEW',
        costPrice: DRAFT_COST_PRICE,
        cashPrice: DRAFT_SELLING_PRICE,
        installmentPrice: DRAFT_SELLING_PRICE,
        branchId: refs.branchId,
        // ยังเป็นของ SHOP — activate เป็นคนย้ายกรรมสิทธิ์ไป FINANCE เอง (transferOwnership)
        ownedByCompanyId: refs.shopCompanyId,
        // RESERVED = สภาพเดียวกับสัญญา DRAFT ที่เปิดผ่าน UI จริง (contract-lifecycle
        // จองเครื่องตอนสร้างสัญญา) — activate รับทั้ง RESERVED และ IN_STOCK
        status: 'RESERVED',
        isOnlineVisible: false,
        stockInDate: createdAt,
      },
    });
    const contract = await tx.contract.create({
      data: {
        contractNumber,
        customerId: customer.id,
        productId: product.id,
        branchId: refs.branchId,
        salespersonId: refs.salespersonId,
        reviewedById: refs.reviewerId,
        reviewedAt: createdAt,
        interestConfigId: refs.interestConfigId,
        pdpaConsentId: consent.id,
        createdAt,
        planType: 'STORE_DIRECT',
        sellingPrice: c.principal, // down = 0 ⇒ ราคาขาย = principal
        downPayment: 0,
        interestRate: new Prisma.Decimal(DRAFT_RATE),
        totalMonths: DRAFT_MONTHS,
        interestTotal: c.interestTotal,
        // ยอดจัด = principal base (sellingPrice − down) — หมายเหตุเดียวกับ CLI เดิม
        financedAmount: c.principal,
        storeCommission: c.storeCommission,
        vatAmount: c.vatAmount,
        vatPct: new Prisma.Decimal(DRAFT_VAT_PCT),
        monthlyPayment: c.monthlyPayment,
        status: 'DRAFT',
        workflowStatus: 'APPROVED',
        paymentDueDay,
        // contractHash จงใจไม่ใส่ (null) — verifyContractHash ข้ามแถว legacy ที่ไม่มี hash
        hasOwnershipClause: true,
        hasRepossessionClause: true,
        hasEarlyPayoffClause: true,
        hasNoTransferClause: true,
        hasAcknowledgement: true,
      },
    });
    await tx.signature.createMany({
      data: DRAFT_SIGNERS.map((s) => ({
        contractId: contract.id,
        signerType: s.signerType,
        signerName: s.signerName,
        staffUserId: s.staff ? refs.salespersonId : null,
        signatureImage: TEST_SIGNATURE_IMAGE,
        signedAt: createdAt,
      })),
    });
    // งวดชำระสร้างตอนเปิดสัญญาผ่าน UI จริง (contract-lifecycle.create) — DRAFT จึงต้องมี
    // Payment ครบเหมือนสัญญาจริง ให้ก้าวรับชำระหลัง activate ทำงานต่อได้
    await tx.payment.createMany({
      data: draftInstallmentRows(contract.id, createdAt, paymentDueDay, c),
    });
    // จงใจไม่สร้าง installment_schedules — activate สร้างเอง (idempotent) จากสัญญาแถวนี้
  });

  console.log(
    `[test-pack:contracts] CREATED ${contractNumber} (DRAFT/APPROVED — input ของโหมดเดินเรื่องก้าว 1)`,
  );
  return {
    created: 2, // สัญญา 1 + เครื่องคู่สัญญา 1 — นับแบบเดียวกับ created + productsCreated ของ CLI
    skipped: 0,
    note: `สัญญา DRAFT สำหรับโหมดเดินเรื่อง: ${contractNumber}`,
  };
}

export const contractsSeeder: DomainSeeder = {
  key: 'contracts',
  label: 'สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า',
  routes: [
    '/payments',
    '/contracts',
    '/contracts/:id',
    '/overdue',
    '/collections',
    '/letters',
    '/repossessions',
    '/early-payoff',
    '/pos',
    '/receipts',
    '/finance/contract-cancellation',
  ],
  markerDoc: `Contract.contractNumber ขึ้นต้น "${TEST_CONTRACT_PREFIX}" · Customer.addressCurrent = "${TEST_CUSTOMER_ADDRESS}" · Product.imeiSerial ขึ้นต้น "${TEST_IMEI_PREFIX}" (สัญญาที่เปิดผ่าน UI ระหว่างเทสจะได้เลขจริง BCP- แต่ถูกกวาดตามลูกค้า/เครื่อง)`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const refs = await adaptRefs(ctx);
    await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: true });
    const existingDraft = await ctx.prisma.contract.findFirst({
      where: DRAFT_CONTRACT_WHERE,
      select: { contractNumber: true },
    });
    return [
      {
        label: `สัญญาทดสอบ ${CONTRACT_COUNT} ใบ`,
        detail:
          'ครบกำหนดวันนี้ · ค้าง 1/2/3 งวด · งวดอนาคต · TERMINATED รอยึด · ใกล้ปิดยอด (รายละเอียดพิมพ์ด้านบนจาก seeder เดิม)',
      },
      {
        label: 'สัญญา DRAFT (workflow APPROVED) 1 ใบ',
        detail: existingDraft
          ? `มีอยู่แล้ว (${existingDraft.contractNumber}) — จะข้าม ไม่สร้างซ้ำ`
          : 'ให้โหมดเดินเรื่อง (DRIVE=1) เปิดผ่าน activate → JE 1A + SHOP leg → คิวรอจ่าย INTER-CO มีของ',
      },
      { label: 'เครื่องว่าง 3 เครื่อง', detail: 'มือถือใหม่ · มือสอง · หูฟัง (IN_STOCK)' },
      { label: 'ลูกค้าเปล่า 2 คน', detail: 'ไม่มีสัญญา — สำหรับลูกค้าใหม่ / trade-in / จอง' },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const refs = await adaptRefs(ctx);
    const r = await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: false });
    // สัญญา DRAFT ของ wrapper — สร้างหลัง delegate เพื่อต่อคิวเลข TEST-<วัน>-NNN ต่อจาก 7 ใบแรก
    const draft = await seedDraftContract(ctx, refs);
    return {
      created: r.created + r.productsCreated + r.blankCustomersCreated + draft.created,
      skipped: draft.skipped,
      notes: [
        `เลขสัญญา: ${r.contractNumbers[0] ?? '-'} .. ${r.contractNumbers[r.contractNumbers.length - 1] ?? '-'}`,
        draft.note,
      ],
    };
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    // ── รูที่ปิด (2026-08-26): CLI เดิมลบ JE เฉพาะ metadata.contractId แต่ JE ของใบขาย
    // (ShopCashSaleTemplate ต่อชิ้น · ShopExternalFinanceSale/ReceiptTemplate — รวมใบขายจาก
    // การแปลงใบจอง/ยืนยันออเดอร์ออนไลน์ซึ่งสร้าง Sale เหมือนกัน) stamp metadata.saleId
    // ⇒ ตัวใบขายถูก soft-delete จนหน้าจอสะอาด แต่งบทดลองยังถือรายการค้างถาวร.
    // wrapper นี้กวาดส่วนนั้นเพิ่มเอง — ห้ามแก้ CLI เดิม (ต้องรันเดี่ยวได้เหมือนเดิม).

    // เก็บ id ใบขายทดสอบ "ก่อน" delegate — marker ชุดเดียวกับ CLI ทุกประการ แต่จงใจ
    // "ไม่กรอง deletedAt" ทุกชั้น (ลูกค้า/เครื่อง/สัญญา/ใบขาย) เพราะ:
    //   1. CLI กำลังจะ soft-delete ใบขายในรอบนี้ (กรองแล้วไปหาใหม่หลัง delegate จะไม่เจอ)
    //   2. รอบก่อนอาจ soft-delete ไปแล้วแต่ JE ยังค้าง (โค้ดยุคก่อนปิดรูนี้ / crash กลางคัน
    //      — การลบ JE ของ wrapper อยู่คนละ transaction กับของ CLI จึงต้องทน re-run ได้)
    //   3. ใบขายที่ถูก "ยกเลิก" (void) ระหว่างเทสมี deletedAt อยู่แล้ว แต่ JE ต้นฉบับ
    //      + ใบกลับรายการยังอยู่ทั้งคู่
    const [testCustomers, testProducts] = await Promise.all([
      ctx.prisma.customer.findMany({
        where: { addressCurrent: TEST_CUSTOMER_ADDRESS },
        select: { id: true },
      }),
      ctx.prisma.product.findMany({
        where: { imeiSerial: { startsWith: TEST_IMEI_PREFIX } },
        select: { id: true },
      }),
    ]);
    const testCustomerIds = testCustomers.map((c) => c.id);
    const testProductIds = testProducts.map((p) => p.id);
    const testContracts = await ctx.prisma.contract.findMany({
      where: {
        OR: [
          { contractNumber: { startsWith: TEST_CONTRACT_PREFIX } },
          ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
          ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const testContractIds = testContracts.map((c) => c.id);
    const saleWhereOr = [
      ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
      ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
      ...(testContractIds.length ? [{ contractId: { in: testContractIds } }] : []),
    ];
    const sales = saleWhereOr.length
      ? await ctx.prisma.sale.findMany({
          where: { OR: saleWhereOr },
          select: { id: true, saleNumber: true },
        })
      : [];

    // ── CLI เดิมทำงานตามปกติ (JE ที่ stamp contractId + soft delete ทุกอย่าง) ──
    const r = await cleanupTestContracts(ctx.prisma, { dryRun });

    // ── กวาด JE ของใบขาย (metadata.saleId) + ใบกลับรายการของมัน ──
    // query "หลัง" delegate เพื่อไม่นับซ้ำกับใบที่ CLI เพิ่งลบไปแล้ว (โหมดจริง)
    const saleJes = sales.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: sales.map((s) => ({ metadata: { path: ['saleId'], equals: s.id } as never })),
          },
          select: { id: true, metadata: true },
        })
      : [];
    const saleJeIds = saleJes.map((j) => j.id);
    // ใบกลับรายการจากการยกเลิกใบขาย (flow 'shop-cash-sale-void') "จงใจไม่ carry saleId"
    // (กัน sweep ของ void เจอ mirror ตัวเอง — sale-void.service.ts) จึงตามด้วย
    // metadata.reversesEntryId แทน: ลบต้นฉบับแต่ทิ้ง mirror ไว้ = งบทดลองเพี้ยนหนักกว่าเดิม
    // (ขากลับรายการยืนโดดโดยไม่มีคู่หักล้าง)
    const mirrorJes = saleJeIds.length
      ? await ctx.prisma.journalEntry.findMany({
          where: {
            OR: saleJeIds.map((id) => ({
              metadata: { path: ['reversesEntryId'], equals: id } as never,
            })),
          },
          select: { id: true },
        })
      : [];
    const jeIds = [...new Set([...saleJeIds, ...mirrorJes.map((j) => j.id)])];

    if (jeIds.length) {
      // identity ให้คนตรวจก่อน/หลังลบ — พิมพ์ทั้ง dry-run และโหมดจริง
      const affected = new Set<string>();
      for (const je of saleJes) {
        const saleId = (je.metadata as Record<string, unknown> | null)?.saleId;
        const sale = sales.find((s) => s.id === saleId);
        if (sale) affected.add(sale.saleNumber);
      }
      console.log(
        `  รายการบัญชีใบขาย (metadata.saleId): ${saleJeIds.length} ใบ + ใบกลับรายการ ${mirrorJes.length} ใบ จากใบขาย:`,
      );
      for (const n of affected) console.log(`    ${n}`);
      if (dryRun) {
        console.log(`  (dry-run) จะลบถาวร ${jeIds.length} รายการบัญชีใบขาย — ยังไม่ลบ`);
      } else {
        // ไม่มีคอลัมน์เอกสารใดชี้มาที่ JE กลุ่มนี้ (Sale ไม่มี journalEntryId — ตรวจ
        // schema.prisma 2026-08-26) ⇒ ล้างเฉพาะ FK Restrict สองตัว ตามลำดับบังคับ
        // เดียวกับ CLI เดิม: audit log → lines → entries
        await ctx.prisma.$transaction(async (tx) => {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        });
      }
    }

    // ── ลายเซ็น + ความยินยอม PDPA ของสัญญา DRAFT ที่ wrapper สร้างเพิ่ม ──
    // CLI เดิมไม่แตะสองตารางนี้ (สัญญา ACTIVE/TERMINATED ของมันไม่มีลายเซ็น/consent)
    // แต่สัญญา DRAFT ต้องมีครบเพื่อผ่านด่าน activate ⇒ wrapper กวาดเอง (soft delete
    // ตามกติกา — Signature เป็นหลักฐาน eIDAS, FK เป็น Restrict ห้าม hard delete)
    let signaturesSwept = 0;
    let consentsSwept = 0;
    if (dryRun) {
      signaturesSwept = testContractIds.length
        ? await ctx.prisma.signature.count({
            where: { contractId: { in: testContractIds }, deletedAt: null },
          })
        : 0;
      consentsSwept = testCustomerIds.length
        ? await ctx.prisma.pDPAConsent.count({
            where: { customerId: { in: testCustomerIds }, deletedAt: null },
          })
        : 0;
    } else {
      const sweptAt = new Date();
      if (testContractIds.length) {
        signaturesSwept = (
          await ctx.prisma.signature.updateMany({
            where: { contractId: { in: testContractIds }, deletedAt: null },
            data: { deletedAt: sweptAt },
          })
        ).count;
      }
      if (testCustomerIds.length) {
        consentsSwept = (
          await ctx.prisma.pDPAConsent.updateMany({
            where: { customerId: { in: testCustomerIds }, deletedAt: null },
            data: { deletedAt: sweptAt },
          })
        ).count;
      }
    }

    return {
      removed: {
        สัญญา: r.contracts,
        งวดชำระ: r.payments,
        ตารางงวด: r.installmentSchedules,
        ใบเสร็จ: r.receipts,
        'รายการบัญชี (ลบถาวร)': r.journalEntries,
        'รายการบัญชีใบขาย (ลบถาวร)': jeIds.length,
        ใบขาย: r.sales,
        ลูกหนี้ไฟแนนซ์: r.financeReceivables,
        ค่าคอม: r.salesCommissions,
        รับซื้อมือสอง: r.tradeIns,
        รายการยึด: r.repossessions,
        หนังสือทวง: r.letters,
        คำขอยกเลิกสัญญา: r.cancellations,
        ลายเซ็นสัญญาทดสอบ: signaturesSwept,
        'ความยินยอม PDPA ทดสอบ': consentsSwept,
        เครื่องทดสอบ: r.products,
        ลูกค้าทดสอบ: r.customers,
      },
      warnings: [],
    };
  },
};
