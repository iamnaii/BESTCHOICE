import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../../journal/cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../../journal/cpa-templates/installment-accrual-2a.template';
import { RepossessionJP5Template } from '../../journal/cpa-templates/repossession-jp5.template';
import { ShopCollectSettlementTemplate } from '../../journal/cpa-templates/shop-collect-settlement.template';
import { classifyShopReceivable } from '../../journal/shop-receivable-type.util';
import { CreditNoteDocumentService } from '../../receipts/services/credit-note-document.service';
import { RepossessionsService } from '../../repossessions/repossessions.service';
import { AuditService } from '../../audit/audit.service';
import { CustomerTagsService } from '../../customer-tags/customer-tags.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { IntercoPendingService } from '../../interco-settlement/interco-pending.service';
import { IntercoAgingService } from '../../interco-settlement/interco-aging.service';
import {
  deviceReturnFinanceBalance,
  deviceReturnShopBalance,
} from '../../interco-settlement/interco-typed-balance';
import { DeviceReturnsService } from '../device-returns.service';
import { DeviceReturnNumberService } from '../device-return-number.service';
import { DeviceReturnNotifyService } from '../device-return-notify.service';

/**
 * ใบรับเครื่องคืน — flow จริงบน DB จริง (spec 2026-09-20 §6.5 golden + §6.2 anti-drift + §5.6/§5.7).
 *
 * สัญญา X: 17,000/12 งวด (CPA golden 17K/12M), งวด 1-4 accrual (2A) + จ่ายแล้ว (ใบเสร็จ Dr 11-1101 /
 * Cr 11-2103 — recipe เดียวกับ repossession-jp5.template.spec.ts "CSV golden case"), งวด 5-12 ค้าง.
 * ราคาประเมิน 7,000 → JP5 ตรง golden §6.5 ทุกบรรทัด + SHOP Dr S11-2002 / Cr S21-1104 typed DEVICE_RETURN.
 *
 * Runner: vitest (jest ignore *.integration.spec.ts). ต้องมี DB:
 *   cd apps/api && npx vitest run --no-file-parallelism src/modules/device-returns/__tests__/device-return-flow.integration.spec.ts
 * CI: glob DEVRET_FILES ใน .github/workflows/deploy-gcp.yml (directory ใหม่ = glob ใหม่ — glob ไม่ recurse)
 *
 * Cleanup: SCOPED ตาม id ที่สเปคนี้สร้าง (audit_logs ลบไม่ได้ — DB trigger immutable ตามดีไซน์)
 */

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Service wiring (instance จริง ไม่ผ่าน Nest DI — pattern interco-netting / product-lifecycle)
// ---------------------------------------------------------------------------
const journal = new JournalAutoService(prisma as never);
const audit = new AuditService(prisma as never);
const repossessionsService = new RepossessionsService(
  prisma as never,
  journal,
  new RepossessionJP5Template(journal, prisma as never),
  null as never, // refundPayoutTemplate — legacy เท่านั้น ไม่ถูกเรียก
  null as never, // refundWaiveTemplate — legacy เท่านั้น ไม่ถูกเรียก
  new CreditNoteDocumentService(prisma as never),
  { deliver: async () => ({ delivered: false }) } as never,
);
// ไลน์: NotificationsService ปลอม (ไม่ยิงออกเน็ต) แต่ DeviceReturnNotifyService ของจริง → lineNotifyStatus ถูกเขียนจริง
const sendFromTemplate = vi.fn().mockResolvedValue({ id: 'notif-test', status: 'SENT' });
const notifyService = new DeviceReturnNotifyService(prisma as never, { sendFromTemplate } as never);
const deviceReturns = new DeviceReturnsService(
  prisma as never,
  repossessionsService,
  new DeviceReturnNumberService(prisma as never),
  notifyService,
  new CustomerTagsService(prisma as never),
  new JourneyEntryWriter(prisma as never),
  audit,
  { deliver: async () => ({ delivered: false }) } as never,
);
const pendingService = new IntercoPendingService(prisma as never);
const agingService = new IntercoAgingService(prisma as never);
const shopCollectSettlement = new ShopCollectSettlementTemplate(journal, prisma as never);

// ---------------------------------------------------------------------------
// Tracked rows (SCOPED cleanup)
// ---------------------------------------------------------------------------
const createdContractIds: string[] = [];
const createdProductIds: string[] = [];
const createdCustomerIds: string[] = [];
const createdBranchIds: string[] = [];

let adminId: string;
let shopId: string;
let financeId: string;
let originBranchId: string;
let receivingBranchId: string;

const RUN = Date.now().toString(36).toUpperCase();
const RUN_NUM = String(Date.now() % 1_000_000).padStart(6, '0');
const PREFIX = 'DEVRETTEST-';
const dec = (s: string) => new Decimal(s);
const INSTALLMENT_TOTAL = dec('1515.83');

const OWNER = () => ({ id: adminId, role: 'OWNER', branchId: null });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ลูกค้า (มี lineIdFinance → ไลน์ส่งได้) + เครื่อง + สัญญา 17K/12M + 12 งวด (schedule + payment) */
async function seedContract(seq: number, status: 'ACTIVE' | 'TERMINATED') {
  const tag = `${RUN}-${seq}`;
  const customer = await prisma.customer.create({
    data: {
      name: `${PREFIX}Customer ${tag}`,
      phone: `096${RUN_NUM}${seq}`.slice(0, 12),
      nationalId: `${PREFIX}${tag}`,
      lineIdFinance: `U-devret-${tag}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const product = await prisma.product.create({
    data: {
      name: `${PREFIX}Phone ${tag}`,
      brand: `${PREFIX}Brand`,
      model: `${PREFIX}Model-${tag}`,
      storage: '128GB',
      imeiSerial: `${PREFIX}${tag}`,
      category: 'PHONE_NEW',
      costPrice: dec('6000.00'),
      branchId: originBranchId,
      status: 'SOLD_INSTALLMENT',
      ownedByCompanyId: financeId,
    },
  });
  createdProductIds.push(product.id);

  const contract = await prisma.contract.create({
    data: {
      contractNumber: `${PREFIX}${tag}`,
      customerId: customer.id,
      productId: product.id,
      branchId: originBranchId,
      salespersonId: adminId,
      planType: 'STORE_WITH_INTEREST',
      sellingPrice: dec('12000.00'),
      downPayment: dec('2000.00'),
      financedAmount: dec('10000.00'),
      interestRate: dec('0.6000'),
      totalMonths: 12,
      interestTotal: dec('6000.00'),
      storeCommission: dec('1000.00'),
      vatAmount: dec('1190.00'),
      vatPct: dec('0.0700'),
      monthlyPayment: INSTALLMENT_TOTAL,
      status,
    },
  });
  createdContractIds.push(contract.id);

  // 12 งวด — รูปเดียวกับ scenario-helpers.seedStandard17k12m (principal 833.33 + interest 500 + vat 99.17)
  const startDate = new Date('2025-01-01');
  const principalPerInst = dec('10000.00').div(12).toDecimalPlaces(2);
  const interestPerInst = dec('6000.00').div(12).toDecimalPlaces(2);
  const vatPerInst = dec('1190.00').div(12).toDecimalPlaces(2);
  for (let i = 1; i <= 12; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    await prisma.installmentSchedule.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        principal: principalPerInst,
        interest: interestPerInst,
        amountDue: principalPerInst.plus(interestPerInst).plus(vatPerInst),
      },
    });
    await prisma.payment.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        amountDue: INSTALLMENT_TOTAL,
        amountPaid: dec('0'),
        status: 'PENDING',
      },
    });
  }
  return { contract, product, customer };
}

/** 1A + งวด 1..paidCount: 2A accrual แล้วจ่ายจริง (recipe ของ repossession-jp5.template.spec.ts) */
async function activateAndPay(contractId: string, paidCount: number) {
  await new ContractActivation1ATemplate(journal, prisma as never).execute(contractId);
  const accrual = new InstallmentAccrual2ATemplate(journal, prisma as never);
  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const insts = await prisma.installmentSchedule.findMany({
    where: { contractId },
    orderBy: { installmentNo: 'asc' },
  });
  for (let i = 0; i < paidCount; i++) {
    await accrual.execute(insts[i].id);
    const payment = await prisma.payment.update({
      where: { contractId_installmentNo: { contractId, installmentNo: insts[i].installmentNo } },
      data: {
        amountPaid: INSTALLMENT_TOTAL,
        paidDate: new Date(),
        paidAt: new Date(),
        status: 'PAID',
      },
    });
    await journal.createAndPost({
      description: `รับชำระงวด #${insts[i].installmentNo} — สัญญา ${contract.contractNumber}`,
      reference: payment.id,
      metadata: {
        tag: 'receipt',
        contractId,
        installmentScheduleId: insts[i].id,
        paymentId: payment.id,
      },
      lines: [
        { accountCode: '11-1101', dr: INSTALLMENT_TOTAL, cr: dec('0'), description: 'รับเงิน' },
        {
          accountCode: '11-2103',
          dr: dec('0'),
          cr: INSTALLMENT_TOTAL,
          description: 'ล้างลูกหนี้ค้างชำระ',
        },
      ],
    });
  }
}

async function jeByFlow(contractId: string, flow: string) {
  const rows = await prisma.journalEntry.findMany({
    where: {
      AND: [
        { metadata: { path: ['contractId'], equals: contractId } } as never,
        { metadata: { path: ['flow'], equals: flow } } as never,
      ],
      deletedAt: null,
    },
    include: { lines: true },
  });
  return rows;
}

const tuples = (lines: Array<{ accountCode: string; debit: Decimal; credit: Decimal }>) =>
  lines
    .map((l) => [l.accountCode, l.debit.toFixed(2), l.credit.toFixed(2)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

describe('ใบรับเครื่องคืน — create → confirm บน DB จริง (spec 2026-09-20)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    // แม่แบบไลน์มาจาก migration 20261003200000_seed_device_return_templates (ไม่มี seeder) —
    // DB เทสได้แถวจาก `prisma migrate deploy`; ถ้าหายแปลว่า migration ยังไม่ apply
    expect(
      await prisma.notificationTemplate.findUnique({ where: { eventType: 'DEVICE_RETURNED' } }),
      'ไม่พบแม่แบบ DEVICE_RETURNED — รัน `npx prisma migrate deploy` (20261003200000_seed_device_return_templates)',
    ).not.toBeNull();

    shopId = (
      await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } })
    ).id;
    financeId = (
      await prisma.companyInfo.findFirstOrThrow({
        where: { companyCode: 'FINANCE', deletedAt: null },
      })
    ).id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    for (const name of ['__device_return_origin_branch__', '__device_return_receiving_branch__']) {
      const existing = await prisma.branch.findFirst({ where: { name, deletedAt: null } });
      const id = existing
        ? existing.id
        : (await prisma.branch.create({ data: { name, companyId: shopId } })).id;
      if (!existing) createdBranchIds.push(id);
      if (name.includes('origin')) originBranchId = id;
      else receivingBranchId = id;
    }
  }, 120_000);

  afterAll(async () => {
    try {
      const jeIds = new Set<string>();
      for (const cid of createdContractIds) {
        const rows = await prisma.journalEntry.findMany({
          where: { metadata: { path: ['contractId'], equals: cid } as never },
          select: { id: true },
        });
        rows.forEach((r) => jeIds.add(r.id));
      }
      const jeIdList = [...jeIds];
      await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIdList } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIdList } } });

      await prisma.receipt.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.deviceReturn.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.repossession.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.badDebtProvision.deleteMany({
        where: { contractId: { in: createdContractIds } },
      });
      await prisma.installmentSchedule.deleteMany({
        where: { contractId: { in: createdContractIds } },
      });
      await prisma.payment.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.customerJourneyEntry.deleteMany({
        where: { customerId: { in: createdCustomerIds } },
      });
      await prisma.customerTag.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
      for (const id of createdBranchIds) {
        try {
          await prisma.branch.delete({ where: { id } });
        } catch (error) {
          // A shared parent branch may remain referenced by retained audit/fixture rows.
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2003') {
            throw error;
          }
        }
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  it('สัญญา X (คืนเอง): create หยุดสัญญา + tag + ไลน์ → confirm โพสต์ JP5 ตรง golden §6.5 + SHOP legs typed DEVICE_RETURN, เข้าคิวหักรอบจ่าย, drift ไม่ขยับ, journey, ใบรับโอนสดถูกปฏิเสธ', async () => {
    const { contract, product, customer } = await seedContract(1, 'ACTIVE');
    await activateAndPay(contract.id, 4);
    const schedules = await prisma.installmentSchedule.findMany({
      where: { contractId: contract.id },
      orderBy: { installmentNo: 'asc' },
    });
    expect(schedules).toHaveLength(12);
    expect(
      schedules.filter((row) => row.accrualJournalEntryId).map((row) => row.installmentNo),
    ).toEqual([1, 2, 3, 4]);
    const payments = await prisma.payment.findMany({
      where: { contractId: contract.id },
      orderBy: { installmentNo: 'asc' },
    });
    expect(payments).toHaveLength(12);
    for (const payment of payments) {
      expect(payment.status).toBe(payment.installmentNo <= 4 ? 'PAID' : 'PENDING');
      expect(payment.amountPaid.toFixed(2)).toBe(payment.installmentNo <= 4 ? '1515.83' : '0.00');
    }
    const driftBefore = await agingService.getTypedAccountDrift();

    // --- สาขาบันทึก (OWNER ระบุสาขาที่รับ — D7 รับข้ามสาขาได้)
    const intake = await deviceReturns.create(
      {
        contractId: contract.id,
        deviceReceivedAt: new Date().toISOString(),
        conditionGrade: 'B',
        appraisalPrice: 7000,
        returnReason: 'UNAFFORDABLE',
        receivingBranchId,
      },
      OWNER() as never,
    );
    expect(intake.docNumber).toMatch(/^DR-\d{8}-\d{4}$/);
    expect(intake).toMatchObject({
      status: 'PENDING_CONFIRM',
      returnKind: 'VOLUNTARY',
      appraisalPrice: '7000.00',
      lineNotifyStatus: 'SENT',
    });
    expect(sendFromTemplate).toHaveBeenLastCalledWith(
      'DEVICE_RETURNED',
      expect.objectContaining({
        docNumber: intake.docNumber,
        contractNumber: contract.contractNumber,
      }),
      `U-devret-${RUN}-1`,
      { customerId: customer.id, relatedId: intake.id },
    );
    // D4: สัญญาหยุดทันที + audit CONTRACT_STATUS_LEGAL ใน tx
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'TERMINATED',
    );
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'CONTRACT_STATUS_LEGAL', entity: 'contract', entityId: contract.id },
      }),
    ).toMatchObject({
      newValue: expect.objectContaining({
        from: 'ACTIVE',
        to: 'TERMINATED',
        reason: 'DEVICE_RETURN_INTAKE',
      }),
    });
    // §5.6 tag ติดทันทีตอนสร้าง (recompute หลัง commit)
    expect(
      await prisma.customerTag.findFirst({
        where: { customerId: customer.id, tag: 'RETURNED_DEVICE', deletedAt: null },
      }),
    ).toMatchObject({ source: 'AUTO' });
    // ยังไม่มี JE ใด ๆ ของการยึดก่อนยืนยัน
    expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(0);
    expect(await jeByFlow(contract.id, 'shop-repossession-intake')).toHaveLength(0);

    // --- FINANCE ยืนยัน
    const confirmed = await deviceReturns.confirm(intake.id, {}, OWNER() as never);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.repossessionId).toBeTruthy();
    expect(confirmed.creditNote?.outcome).toBe('SKIPPED_NO_ACCRUED'); // งวด accrual 1-4 จ่ายครบ → ไม่มี CN

    // golden §6.5 — JP5 (FINANCE)
    const jp5Entries = await jeByFlow(contract.id, 'repossession');
    expect(jp5Entries).toHaveLength(1);
    const [jp5] = jp5Entries;
    expect(jp5.companyId).toBe(financeId);
    expect(jp5.status).toBe('POSTED');
    expect(tuples(jp5.lines)).toEqual([
      ['11-2101', '0.00', '11333.36'],
      ['11-2105', '0.00', '793.32'],
      ['11-2106', '4000.00', '0.00'],
      ['11-2107', '7000.00', '0.00'],
      ['21-2101', '0.00', '793.32'],
      ['21-2102', '793.32', '0.00'],
      ['41-1101', '0.00', '4000.00'],
      ['51-1102', '5126.68', '0.00'],
    ]);
    const jp5Meta = jp5.metadata as Record<string, unknown>;
    expect(jp5Meta.shopReceivableType).toBe('DEVICE_RETURN');
    expect(jp5Meta.shopReceivable).toBe('11-2107');
    expect(jp5Meta.deviceReturnId).toBe(intake.id);
    expect(jp5Meta.collectedByShop).toBeUndefined();
    expect(classifyShopReceivable(jp5Meta)).toBe('DEVICE_RETURN');

    // golden §6.5 — SHOP intake
    const shopEntries = await jeByFlow(contract.id, 'shop-repossession-intake');
    expect(shopEntries).toHaveLength(1);
    const [shopIntake] = shopEntries;
    expect(shopIntake.status).toBe('POSTED');
    expect(shopIntake.companyId).toBe(shopId);
    expect(tuples(shopIntake.lines)).toEqual([
      ['S11-2002', '7000.00', '0.00'],
      ['S21-1104', '0.00', '7000.00'],
    ]);
    const intakeMeta = shopIntake.metadata as Record<string, unknown>;
    expect(intakeMeta.shopReceivableType).toBe('DEVICE_RETURN');
    expect(intakeMeta.deviceReturnId).toBe(intake.id);
    expect(classifyShopReceivable(intakeMeta)).toBe('DEVICE_RETURN');

    // §6.2 typed balances สองสมุด + คิวหักรอบจ่าย (Phase 1 lens)
    expect((await deviceReturnFinanceBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');
    expect((await deviceReturnShopBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');
    const queue = await pendingService.getPendingDeviceReturns();
    const queued = queue.find((q) => q.contractId === contract.id);
    expect(queued).toBeDefined();
    expect(queued!.deviceReturnGl.toFixed(2)).toBe('7000.00');
    expect(queued!.shopDeviceReturnGl.toFixed(2)).toBe('7000.00');
    expect(queued!.contractNumber).toBe(contract.contractNumber);

    // §6.2 anti-drift: ใบใหม่ทั้งสองต้องถูกเลนส์ classify ได้ครบ — drift ระดับบัญชีไม่ขยับ, lensTotal +7,000
    const driftAfter = await agingService.getTypedAccountDrift();
    const expectedAccounts = ['11-2107', 'S21-1104'];
    expect(driftBefore.map((row) => row.accountCode).sort()).toEqual(expectedAccounts);
    expect(driftAfter.map((row) => row.accountCode).sort()).toEqual(expectedAccounts);
    for (const after of driftAfter) {
      const before = driftBefore.find((b) => b.accountCode === after.accountCode)!;
      expect(after.drift.minus(before.drift).toFixed(2), `${after.accountCode} drift delta`).toBe(
        '0.00',
      );
      expect(
        after.lensTotal.minus(before.lensTotal).toFixed(2),
        `${after.accountCode} lens delta`,
      ).toBe('7000.00');
    }

    // สถานะสัญญา/เครื่อง/แถวยึด (§5.2 ข้อ 3)
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'CLOSED_BAD_DEBT',
    );
    const afterProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(afterProduct.status).toBe('REPOSSESSED');
    expect(afterProduct.ownedByCompanyId).toBe(shopId);
    expect(afterProduct.category).toBe('PHONE_USED');
    expect(afterProduct.branchId).toBe(receivingBranchId); // ที่อยู่เครื่องจริง = สาขาที่รับ
    const repossession = await prisma.repossession.findUniqueOrThrow({
      where: { id: confirmed.repossessionId! },
    });
    expect(repossession.appraisedById).toBe(adminId);
    expect(repossession.appraisalPrice.toFixed(2)).toBe('7000.00');
    expect(repossession.notes).toContain('เหตุผลคืนเครื่อง: ลูกค้าไม่สามารถผ่อนต่อได้');
    expect(
      await prisma.deviceReturn.findFirst({
        where: { contractId: contract.id, status: 'PENDING_CONFIRM' },
      }),
    ).toBeNull();

    // journey (§5.6) หลัง commit
    expect(
      await prisma.customerJourneyEntry.findFirst({
        where: { dedupeKey: `DEVICE_RETURNED:${intake.id}` },
      }),
    ).toMatchObject({
      customerId: customer.id,
      kind: 'DEVICE_RETURNED',
      refType: 'contract',
      refId: contract.id,
      data: {
        docNumber: intake.docNumber,
        contractNumber: contract.contractNumber,
        returnKind: 'VOLUNTARY',
        returnReason: 'UNAFFORDABLE',
      },
    });
    // audit หลัง commit (hash chain)
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'DEVICE_RETURN_CONFIRMED', entityId: intake.id },
      }),
    ).toBeTruthy();
    expect(
      await prisma.auditLog.findFirst({
        where: { action: 'SHOP_COLLECT_REPOSSESSION', entityId: contract.id },
      }),
    ).toBeNull();

    // §6.4 ล้างซ้ำสองทางไม่ได้ — ใบรับโอนสดของแถวเก่า (SHOP_COLLECT) ถูกด่าน Phase 1 ปฏิเสธ
    await expect(
      shopCollectSettlement.execute({
        contractId: contract.id,
        depositAccountCode: '11-1201',
        amount: dec('7000.00'),
      }),
    ).rejects.toThrow(/ค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO/);
    expect((await deviceReturnFinanceBalance(prisma, contract.id)).toFixed(2)).toBe('7000.00');

    // ยืนยันซ้ำ / สร้างใบซ้ำบนสัญญาที่ปิดแล้ว → 409/400 ไม่มี JE เพิ่ม
    await expect(deviceReturns.confirm(intake.id, {}, OWNER() as never)).rejects.toThrow(
      /ถูกยืนยัน\/ส่งกลับ\/ยกเลิกไปแล้ว/,
    );
    expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(1);
  }, 120_000);

  // -------------------------------------------------------------------------
  it('สัญญา R: create (ACTIVE → TERMINATED) → reject คืนสถานะเดิม + ใบ REJECTED + ไลน์ยกเลิก + tag หลุด — ไม่มี JE ใด ๆ', async () => {
    const { contract, customer } = await seedContract(2, 'ACTIVE');
    await activateAndPay(contract.id, 0);

    const intake = await deviceReturns.create(
      {
        contractId: contract.id,
        deviceReceivedAt: new Date().toISOString(),
        conditionGrade: 'C',
        appraisalPrice: 5000,
        returnReason: 'NO_LONGER_NEEDED',
        receivingBranchId,
      },
      OWNER() as never,
    );
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'TERMINATED',
    );

    // ใบที่สองบนสัญญาเดียวกันขณะยังรอ → 409 (partial unique + ด่าน 5)
    await expect(
      deviceReturns.create(
        {
          contractId: contract.id,
          deviceReceivedAt: new Date().toISOString(),
          conditionGrade: 'C',
          appraisalPrice: 5000,
          returnReason: 'OTHER',
          notes: 'ซ้ำ',
          receivingBranchId,
        },
        OWNER() as never,
      ),
    ).rejects.toThrow(/รอยืนยันอยู่แล้ว/);

    const rejected = await deviceReturns.reject(
      intake.id,
      { reason: 'ใบผิดสัญญา กรุณาตรวจใหม่' },
      OWNER() as never,
    );
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'ใบผิดสัญญา กรุณาตรวจใหม่',
      notice: null,
    });
    expect(sendFromTemplate).toHaveBeenLastCalledWith(
      'DEVICE_RETURN_CANCELED',
      expect.anything(),
      `U-devret-${RUN}-2`,
      expect.anything(),
    );
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'ACTIVE',
    );
    const legal = await prisma.auditLog.findMany({
      where: { action: 'CONTRACT_STATUS_LEGAL', entity: 'contract', entityId: contract.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(legal.map((a) => (a.newValue as { reason: string }).reason)).toEqual([
      'DEVICE_RETURN_INTAKE',
      'DEVICE_RETURN_REJECTED',
    ]);
    // tag หลุดเอง (ไม่มีใบเปิด ไม่มีแถวยึด)
    expect(
      await prisma.customerTag.findFirst({
        where: { customerId: customer.id, tag: 'RETURNED_DEVICE', deletedAt: null },
      }),
    ).toBeNull();
    expect(await jeByFlow(contract.id, 'repossession')).toHaveLength(0);
    expect(await prisma.repossession.findFirst({ where: { contractId: contract.id } })).toBeNull();
    // ส่งกลับแล้วสร้างใบใหม่ได้ (partial unique นับเฉพาะ PENDING_CONFIRM)
    const again = await deviceReturns.create(
      {
        contractId: contract.id,
        deviceReceivedAt: new Date().toISOString(),
        conditionGrade: 'C',
        appraisalPrice: 5000,
        returnReason: 'UNAFFORDABLE',
        receivingBranchId,
      },
      OWNER() as never,
    );
    expect(again.status).toBe('PENDING_CONFIRM');
    const canceled = await deviceReturns.cancel(again.id, OWNER() as never);
    expect(canceled.status).toBe('CANCELED');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'ACTIVE',
    );
  }, 120_000);

  it.each([0.001, 0.004])(
    'rejects sub-cent appraisal %s without an intake or contract status change',
    async (appraisalPrice) => {
      const { contract } = await seedContract(appraisalPrice === 0.001 ? 101 : 102, 'ACTIVE');
      // Direct service regression: real persistence, not an HTTP/ValidationPipe test.
      const outcome = await deviceReturns
        .create(
          {
            contractId: contract.id,
            deviceReceivedAt: new Date().toISOString(),
            conditionGrade: 'A',
            appraisalPrice,
            receivingBranchId,
            returnReason: 'UNAFFORDABLE',
          },
          OWNER() as never,
        )
        .then(
          () => null,
          (error: unknown) => error,
        );

      // Check persisted state even when a regression unexpectedly creates an intake;
      // cleanup tracks contracts, so those unexpected rows are also removed.
      expect.soft(await prisma.deviceReturn.count({ where: { contractId: contract.id } })).toBe(0);
      expect
        .soft((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status)
        .toBe('ACTIVE');
      expect(outcome).toMatchObject({ message: 'กรุณาระบุราคาประเมินมากกว่า 0 บาท' });
    },
  );

  it.each([0.01, 0.005])('accepts appraisal %s and persists one cent', async (appraisalPrice) => {
    const { contract } = await seedContract(appraisalPrice === 0.01 ? 103 : 104, 'ACTIVE');
    const intake = await deviceReturns.create(
      {
        contractId: contract.id,
        deviceReceivedAt: new Date().toISOString(),
        conditionGrade: 'A',
        appraisalPrice,
        receivingBranchId,
        returnReason: 'UNAFFORDABLE',
      },
      OWNER() as never,
    );
    expect(intake.appraisalPrice).toBe('0.01');
    expect(
      (
        await prisma.deviceReturn.findUniqueOrThrow({ where: { id: intake.id } })
      ).appraisalPrice.toFixed(2),
    ).toBe('0.01');
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe(
      'TERMINATED',
    );
  });

  // -------------------------------------------------------------------------
  it('สัญญา T (TERMINATED รอยึด): อยู่ในรายการ awaiting → create ใบประเภท REPOSSESSION (เหตุผลตั้งให้เอง) → หายจากรายการ', async () => {
    const { contract } = await seedContract(3, 'TERMINATED');
    await activateAndPay(contract.id, 0);

    const before = await deviceReturns.awaitingRepossession(OWNER() as never);
    expect(before.data.map((r) => r.id)).toContain(contract.id);

    const intake = await deviceReturns.create(
      {
        contractId: contract.id,
        deviceReceivedAt: new Date().toISOString(),
        conditionGrade: 'A',
        appraisalPrice: 9000,
        receivingBranchId,
      },
      OWNER() as never,
    );
    expect(intake.returnKind).toBe('REPOSSESSION');
    expect(intake.returnReason).toBe('AFTER_TERMINATION');
    expect(intake.receivingBranch.id).toBe(receivingBranchId);

    const after = await deviceReturns.awaitingRepossession(OWNER() as never);
    expect(after.data.map((r) => r.id)).not.toContain(contract.id);
    // preview บอกล่วงหน้าว่าสร้างซ้ำไม่ได้
    const preview = await deviceReturns.preview(
      { contractId: contract.id, conditionGrade: 'A' },
      OWNER() as never,
    );
    expect(preview.eligibility).toEqual({
      canCreate: false,
      reason: 'สัญญานี้มีใบรับเครื่องคืนที่รอยืนยันอยู่แล้ว',
    });
    expect(preview.returnKind).toBe('REPOSSESSION');
    expect(preview.allowedReasons).toEqual(['AFTER_TERMINATION']);
  }, 120_000);
});
