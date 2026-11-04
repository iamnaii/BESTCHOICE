/**
 * Task 41 — ลูกค้าปิดยอดเองผ่าน QR ในไลน์ (`LiffEarlyPayoff` → `create-intent` → webhook PaySolutions) บน Postgres จริง (คำตัดสินเจ้าของ #43):
 * - intent ปิดยอด: ยอดมาจาก quote ของ server (ไม่เชื่อยอดจาก client) + เก็บ snapshot ของ quote ไว้บนแถวติดตาม · ยอดจาก client ไม่ตรง = 400
 * - เงินเข้าเท่ายอดปิด ณ เวลาที่เงินเข้า (±0.01) → JP4 จริง (ตัวเดียวกับปิดยอดของพนักงานทางสลิปตรง) ในธุรกรรมเดียวกับการ claim ลิงก์ ·
 *   ใบ EARLY_PAYOFF + การ์ดปิดยอดเดิม · ส่งซ้ำไม่ซ้ำ
 * - ยอดไม่ตรง / คำขอคืนเงินรอธนาคาร (#24) → กระจายเงินทีละงวดแบบเดิม (FIFO) + งาน HIGH ให้พนักงานปิดยอดต่อ + Sentry warning หลัง commit
 *
 * ฐานทดสอบสร้างด้วย `prisma migrate deploy` อย่างเดียว (CI ไม่ seed) — สเปคสร้างผังบัญชี (`seedFinanceCoa`) บริษัท FINANCE ผู้ใช้ระบบ
 * (`admin@bestchoice.com` ของ JournalAutoService) และแถวของตัวเอง (stamp) · แถวทิ้งไว้ ฐานถูก drop หลังรัน
 *
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand <ไฟล์นี้>
 */
jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

import * as Sentry from '@sentry/nestjs';
import { randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { LineChannelType, Prisma, PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../prisma/seed-coa-finance';
import { bangkokCalendarParts, bangkokMidnight } from '../../utils/date.util';
import { formatDateTime } from '../../utils/thai-date.util';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { EarlyPayoffJP4Template } from '../journal/cpa-templates/early-payoff-jp4.template';
import { Vat60dayReversalTemplate } from '../journal/cpa-templates/vat-60day-reversal.template';
import { ShopCollectSettlementTemplate } from '../journal/cpa-templates/shop-collect-settlement.template';
import { EclStageReverseTemplate } from '../journal/cpa-templates/ecl-stage-reverse.template';
import { PaymentReceiptTemplate } from '../journal/cpa-templates/payment-receipt.template';
import { ProductsService } from '../products/products.service';
import { ReceiptIssuanceService } from '../receipts/services/receipt-issuance.service';
import { ReceiptNumberService } from '../receipts/services/receipt-number.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { ContractPaymentService } from '../contracts/contract-payment.service';
import { PaySolutionsIntentService } from './services/paysolutions-intent.service';
import { PaySolutionsWebhookService } from './services/paysolutions-webhook.service';
import { PaySolutionsConfirmationService } from './services/paysolutions-confirmation.service';
import { assertTestDatabase } from '../notifications/__tests__/finance-line-fixtures';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const money = (v: { toString(): string } | null | undefined) =>
  new Prisma.Decimal((v ?? 0).toString()).toFixed(2);

type Line = [accountCode: string, debit: string, credit: string];

/**
 * ตัวอย่างทองของ accounting.md (17,000/12 · ยังไม่จ่ายเลย · ส่วนลด 50%) — บัญชีรับเงินของ Pay Solutions = บัญชี QR ค่าเริ่มต้นของ
 * `PaymentMethodConfig` (seed ของ migration = 11-1201 กสิกร · คำตัดสินเจ้าของ #45)
 */
const GOLDEN_JP4: Line[] = [
  ['11-1201', '15189.98', '0.00'],
  ['11-2106', '6000.00', '0.00'],
  ['21-2102', '1190.00', '0.00'],
  ['52-1106', '3000.02', '0.00'],
  ['11-2101', '0.00', '17000.00'],
  ['11-2105', '0.00', '1190.00'],
  ['41-1101', '0.00', '6000.00'],
  ['21-2101', '0.00', '1190.00'],
];

/** PR5ข (เจ้าของเคาะ 01/10/2569): เครดิต 300 + เงินรับล่วงหน้าถังรวม 500 → ลูกค้าจ่าย 14,612.63 */
const GOLDEN_JP4_CREDIT_ADVANCE: Line[] = [
  ['11-1201', '14612.63', '0.00'],
  ['21-1103', '500.00', '0.00'],
  ['21-5101', '300.00', '0.00'],
  ['11-2106', '6000.00', '0.00'],
  ['21-2102', '1190.00', '0.00'],
  ['52-1106', '2777.37', '0.00'],
  ['11-2101', '0.00', '17000.00'],
  ['11-2105', '0.00', '1190.00'],
  ['41-1101', '0.00', '6000.00'],
  ['21-2101', '0.00', '1190.00'],
];

const sortLines = (lines: Line[]) =>
  [...lines].sort((a, b) => `${a[0]}|${a[1]}|${a[2]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}`));

describeDb(
  'PaySolutions — ลูกค้าปิดยอดเองผ่าน QR ลงเป็น JP4 (Task 41 · คำตัดสินเจ้าของ #43) — Postgres จริง',
  () => {
    const prisma = new PrismaClient();
    const stamp = `t41-${Date.now().toString(36)}`;
    let seq = 0;
    let branchId = '';
    let ownerId = '';

    const createUiPayment = jest.fn(async (_payload: { amount: number; returnUrl: string }) => ({
      gatewayResponse: {},
      paymentUrl: 'https://gw.test/pay',
    }));
    const gateway = {
      getMerchantId: async () => 'M-TEST',
      getTerminalId: async () => 'T-TEST',
      createUiPayment,
    };
    const host = {
      handlePartialPaymentCallback: jest.fn(),
      confirmSavingPlanPayment: jest.fn(),
      confirmOnlineOrderPayment: jest.fn(),
      sendPaymentSuccessNotification: jest.fn(async () => undefined),
      sendEarlyPayoffSuccessNotification: jest.fn(async () => undefined),
    };

    let contractPayment: ContractPaymentService;
    let intent: PaySolutionsIntentService;
    let webhook: PaySolutionsWebhookService;

    function buildServices() {
      const journal = new JournalAutoService(prisma as never);
      const vat60 = new Vat60dayReversalTemplate(journal, prisma as never);
      const products = new ProductsService(prisma as never);
      const receipts = new ReceiptIssuanceService(
        prisma as never,
        undefined,
        new ReceiptNumberService(prisma as never),
      );
      contractPayment = new ContractPaymentService(
        prisma as never,
        products,
        journal,
        new EarlyPayoffJP4Template(journal, prisma as never, vat60),
        new ShopCollectSettlementTemplate(journal, prisma as never),
        receipts as never,
        new EclStageReverseTemplate(journal, prisma as never),
        new JourneyEntryWriter(prisma as never),
      );
      const config = { get: (_k: string, def?: string) => def ?? '' };
      intent = new PaySolutionsIntentService(
        gateway as never,
        prisma as never,
        {} as never,
        config as never,
        contractPayment,
      );
      webhook = new PaySolutionsWebhookService(
        gateway as never,
        prisma as never,
        {} as never,
        products,
        journal,
        new PaymentReceiptTemplate(journal, prisma as never),
        vat60,
        { reverseStageOnPayment: jest.fn(async () => undefined) } as never,
        host,
        receipts as never,
        contractPayment,
      );
    }

    /** วันครบกำหนดแบบที่ระบบเก็บ (เที่ยงคืนไทย) — ห่างจากวันนี้ `months` เดือน + `days` วัน */
    function dueIn(months: number, days = 0): Date {
      const { year, month, day } = bangkokCalendarParts(new Date());
      return bangkokMidnight(year, month + months, day + days);
    }

    /** สัญญา 17,000/12 (ขายสด 12,000 ดาวน์ 2,000 ค่าคอม 1,000 ดอกเบี้ย 6,000 VAT 1,190) ยังไม่จ่ายเลย + 1A + ลูกค้าผูก LINE การเงิน */
    async function createPayoffContract(opts: { credit?: string; advance?: string } = {}) {
      const label = `${stamp}-${++seq}`;
      const lineUserId = `U${label}`;
      const customer = await prisma.customer.create({ data: { name: `ทดสอบระบบ ${label}` } });
      await prisma.customerLineLink.create({
        data: {
          customerId: customer.id,
          lineUserId,
          channel: LineChannelType.FINANCE,
          linkedAt: new Date(),
        },
      });
      const product = await prisma.product.create({
        data: {
          name: `spec ${label}`,
          brand: 'Apple',
          model: 'iPhone 15',
          category: 'PHONE_NEW',
          costPrice: new Prisma.Decimal('8000.00'),
          branchId,
          imeiSerial: `IMEI-${label}`,
        },
      });
      const contract = await prisma.contract.create({
        data: {
          contractNumber: `CT-${label}`,
          customerId: customer.id,
          productId: product.id,
          branchId,
          salespersonId: ownerId,
          planType: 'STORE_WITH_INTEREST',
          sellingPrice: new Prisma.Decimal('12000.00'),
          downPayment: new Prisma.Decimal('2000.00'),
          financedAmount: new Prisma.Decimal('10000.00'),
          interestRate: new Prisma.Decimal('0.6000'),
          totalMonths: 12,
          interestTotal: new Prisma.Decimal('6000.00'),
          storeCommission: new Prisma.Decimal('1000.00'),
          vatAmount: new Prisma.Decimal('1190.00'),
          vatPct: new Prisma.Decimal('0.0700'),
          monthlyPayment: new Prisma.Decimal('1515.83'),
          creditBalance: new Prisma.Decimal(opts.credit ?? '0'),
          advanceBalance: new Prisma.Decimal(opts.advance ?? '0'),
          status: 'ACTIVE',
        },
      });
      for (let installmentNo = 1; installmentNo <= 12; installmentNo++) {
        const dueDate = dueIn(installmentNo);
        await prisma.installmentSchedule.create({
          data: {
            contractId: contract.id,
            installmentNo,
            dueDate,
            principal: new Prisma.Decimal('833.33'),
            interest: new Prisma.Decimal('500.00'),
            amountDue: new Prisma.Decimal('1515.83'),
          },
        });
        await prisma.payment.create({
          data: {
            contractId: contract.id,
            installmentNo,
            dueDate,
            amountDue: new Prisma.Decimal('1515.83'),
            status: 'PENDING',
          },
        });
      }
      const journal = new JournalAutoService(prisma as never);
      await new ContractActivation1ATemplate(journal, prisma as never).execute(contract.id);
      // เงินของลูกค้าที่มีอยู่จริงในบัญชีของสัญญา (คอลัมน์ = บัญชี): 21-1103 ถังรวม · 21-5101 เครดิต
      const credit = new Prisma.Decimal(opts.credit ?? '0');
      const advance = new Prisma.Decimal(opts.advance ?? '0');
      if (credit.gt(0) || advance.gt(0)) {
        await journal.createAndPost({
          description: `spec เงินของลูกค้า ${label}`,
          metadata: { contractId: contract.id, tag: 'spec-customer-money' },
          lines: [
            { accountCode: '11-1202', dr: credit.plus(advance), cr: new Prisma.Decimal(0) },
            ...(advance.gt(0)
              ? [{ accountCode: '21-1103', dr: new Prisma.Decimal(0), cr: advance }]
              : []),
            ...(credit.gt(0)
              ? [{ accountCode: '21-5101', dr: new Prisma.Decimal(0), cr: credit }]
              : []),
          ],
        });
      }
      return {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        customerId: customer.id,
        lineUserId,
      };
    }

    async function createPayoffIntent(
      f: { contractId: string; lineUserId: string },
      amount: number,
    ) {
      const result = await intent.createPaymentIntent(
        f.contractId,
        amount,
        'ปิดยอดก่อนกำหนด',
        f.lineUserId,
        undefined,
        undefined,
      );
      const tracking = await prisma.paymentLink.findUniqueOrThrow({
        where: { id: result.paymentId },
      });
      return { result, tracking };
    }

    const webhookData = (tracking: { token: string }, total: string) => ({
      refno: tracking.token,
      result_code: '00',
      total,
      transaction_id: `TX-${tracking.token}`,
      merchantid: 'M-TEST',
    });

    async function jp4Of(contractId: string) {
      return prisma.journalEntry.findMany({
        where: {
          AND: [
            { metadata: { path: ['contractId'], equals: contractId } },
            { metadata: { path: ['flow'], equals: 'early-payoff' } },
          ],
        },
        include: { lines: true },
      });
    }

    /** tag ของทุกรายการบัญชีของสัญญา (เรียง) — แยก JP4 ออกจากใบรับชำระงวด (FIFO) / เงินส่วนเกิน */
    async function entryTagsOf(contractId: string) {
      const entries = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: contractId } },
        select: { metadata: true },
      });
      return entries.map((e) => String((e.metadata as Record<string, unknown>).tag)).sort();
    }

    /** บรรทัดบัญชีธนาคาร (11-12xx) ทุกบรรทัดของรายการของสัญญา ยกเว้นรายการเงินของลูกค้าที่สเปคตั้งเอง */
    async function bankLinesOf(contractId: string) {
      const entries = await prisma.journalEntry.findMany({
        where: { metadata: { path: ['contractId'], equals: contractId } },
        include: { lines: true },
      });
      return entries
        .filter((e) => (e.metadata as Record<string, unknown>).tag !== 'spec-customer-money')
        .flatMap((e) => e.lines)
        .filter((l) => l.accountCode.startsWith('11-12'));
    }

    /** เปลี่ยนบัญชี QR ค่าเริ่มต้นของ `PaymentMethodConfig` ชั่วคราว (คืนค่าเดิมเสมอ) */
    async function withQrDefaultAccount(accountCode: string, run: () => Promise<void>) {
      const qr = await prisma.paymentMethodConfig.findFirst({
        where: { method: 'QR', isDefault: true, enabled: true, deletedAt: null },
      });
      const created = qr
        ? null
        : await prisma.paymentMethodConfig.create({
            data: { method: 'QR', accountCode, isDefault: true, enabled: true },
          });
      if (qr)
        await prisma.paymentMethodConfig.update({ where: { id: qr.id }, data: { accountCode } });
      try {
        await run();
      } finally {
        if (qr) {
          await prisma.paymentMethodConfig.update({
            where: { id: qr.id },
            data: { accountCode: qr.accountCode },
          });
        }
        if (created) {
          await prisma.paymentMethodConfig.update({
            where: { id: created.id },
            data: { deletedAt: new Date(), isDefault: false },
          });
        }
      }
    }

    const linesOf = (je: {
      lines: Array<{ accountCode: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>;
    }) => sortLines(je.lines.map((l) => [l.accountCode, money(l.debit), money(l.credit)] as Line));

    const fallbackTodo = (trackingId: string) =>
      prisma.todo.findMany({ where: { requestKey: `paysolutions-payoff-fallback:${trackingId}` } });

    beforeAll(async () => {
      assertTestDatabase();
      await seedFinanceCoa(prisma);
      if (
        !(await prisma.companyInfo.findFirst({
          where: { companyCode: 'FINANCE', deletedAt: null },
        }))
      ) {
        await prisma.companyInfo.create({
          data: {
            nameTh: 'BESTCHOICE FINANCE',
            taxId: '0000000000002',
            companyCode: 'FINANCE',
            address: '1 Finance Rd.',
            directorName: 'Test Director',
            vatRegistered: true,
            vatRate: new Prisma.Decimal('0.0700'),
          },
        });
      }
      // JournalAutoService ใช้ผู้ใช้ระบบตัวนี้เป็น createdById ของรายการอัตโนมัติ
      if (!(await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } }))) {
        await prisma.user.create({
          data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
        });
      }
      ownerId = (
        await prisma.user.create({
          data: {
            email: `${stamp}-owner@bestchoice.test`,
            password: 'x',
            name: 'owner',
            role: 'OWNER',
          },
        })
      ).id;
      branchId = (await prisma.branch.create({ data: { name: `${stamp} สาขา` } })).id;
      buildServices();
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('intent ปิดยอด — server ตัดสินยอด', () => {
      it('ยอดที่ส่ง gateway = ยอดปิดของ server · แถวติดตามเก็บ snapshot (ยอด · % ส่วนลด · วันที่ของ quote) · กลับหน้า /liff/contract ด้วย id ของแถวติดตาม', async () => {
        const f = await createPayoffContract();
        const { result, tracking } = await createPayoffIntent(f, 15189.98);

        expect(createUiPayment).toHaveBeenCalledTimes(1);
        const payload = createUiPayment.mock.calls[0][0];
        expect(payload.amount).toBe(15189.98);
        expect(payload.returnUrl).toContain(`/liff/contract?ref=${tracking.id}`);
        expect(result.paymentId).toBe(tracking.id);
        expect(tracking.purpose).toBe('PAYOFF');
        expect(money(tracking.amount)).toBe('15189.98');
        const snapshot = tracking.payoffQuote as Record<string, unknown>;
        expect(snapshot).toMatchObject({ v: 1, totalPayoff: '15189.98', discountPct: 50 });
        expect(snapshot.quoteDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('ยอดจาก client ไม่ตรงยอดปิดของ server → 400 ข้อความไทยที่บอกยอดล่าสุดและทางไปต่อ · ไม่ถึง gateway · ไม่มีแถวติดตาม', async () => {
        const f = await createPayoffContract();
        const attempt = intent.createPaymentIntent(f.contractId, 100, 'ปิดยอด', f.lineUserId);
        await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          intent.createPaymentIntent(f.contractId, 15189.0, 'ปิดยอด', f.lineUserId),
        ).rejects.toThrow(/ยอดปิดสัญญาเปลี่ยนแล้ว.*15,189\.98.*กลับไปดูสัญญา/);
        expect(createUiPayment).not.toHaveBeenCalled();
        expect(await prisma.paymentLink.count({ where: { contractId: f.contractId } })).toBe(0);
      });

      it('ลิงก์ PAYOFF ที่ยอดของลิงก์ไม่ตรงยอดปิดของ server แล้ว → 400 ก่อนตัดเงิน (ไม่ถึง gateway · ไม่มีแถวติดตาม) · ยอดตรง = จ่ายได้', async () => {
        const f = await createPayoffContract();
        const linkOf = (amount: string) =>
          prisma.paymentLink.create({
            data: {
              token: randomBytes(32).toString('hex'),
              contractId: f.contractId,
              amount: new Prisma.Decimal(amount),
              purpose: 'PAYOFF',
              status: 'ACTIVE',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        const stale = await linkOf('15500.00');
        await expect(
          intent.createPaymentIntent(
            f.contractId,
            15500,
            'ปิดยอด',
            f.lineUserId,
            undefined,
            stale.token,
          ),
        ).rejects.toThrow(
          'ลิงก์ปิดยอดนี้ใช้ไม่ได้แล้ว เพราะยอดปิดสัญญาเปลี่ยน (ยอดล่าสุด 15,189.98 บาท) — กด "กลับไปดูสัญญา" ด้านล่าง แล้วกด "ปิดยอดก่อนกำหนด · ลดดอกเบี้ย" เพื่อดูยอดล่าสุดและชำระ',
        );
        expect(createUiPayment).not.toHaveBeenCalled();
        expect(await prisma.paymentLink.count({ where: { sourceLinkId: stale.id } })).toBe(0);

        const fresh = await linkOf('15189.98');
        await intent.createPaymentIntent(
          f.contractId,
          15189.98,
          'ปิดยอด',
          f.lineUserId,
          undefined,
          fresh.token,
        );
        expect(createUiPayment).toHaveBeenCalledTimes(1);
        expect(createUiPayment.mock.calls[0][0].amount).toBe(15189.98);
      });
    });

    describe('Task 41 (ค) — มี QR ปิดยอดที่ยังเปิดอยู่ → สร้าง QR ปิดยอดใบที่สองไม่ได้', () => {
      const openIntentText = (expiresAt: Date) =>
        `มี QR ปิดยอดของสัญญานี้ที่สร้างไว้แล้ว ใช้ได้ถึง ${formatDateTime(expiresAt)} น. — ถ้าชำระไปแล้ว กด "กลับไปดูสัญญา" ด้านล่าง แล้วกด "ประวัติชำระเงิน" เพื่อดูผล · ถ้ายังไม่ได้ชำระ กรุณารอให้เลยเวลานั้นแล้วกดชำระใหม่`;
      const openPayoffRows = (contractId: string) =>
        prisma.paymentLink.findMany({
          where: {
            contractId,
            purpose: 'PAYOFF',
            status: 'ACTIVE',
            expiresAt: { gt: new Date() },
            NOT: { payoffQuote: { equals: Prisma.DbNull } },
          },
        });
      const payoffLink = (contractId: string) =>
        prisma.paymentLink.create({
          data: {
            token: randomBytes(32).toString('hex'),
            contractId,
            amount: new Prisma.Decimal('15189.98'),
            purpose: 'PAYOFF',
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });

      it('ทีละคำขอ: ใบที่สอง (ทั้งทางหน้าปิดยอดและลิงก์ PAYOFF) → 400 ไทยบอกเวลาหมดอายุและทางไปต่อ · ไม่ถึง gateway · แถวติดตามเปิดอยู่ใบเดียว', async () => {
        const f = await createPayoffContract();
        const first = await createPayoffIntent(f, 15189.98);
        expect(createUiPayment).toHaveBeenCalledTimes(1);

        await expect(
          intent.createPaymentIntent(f.contractId, 15189.98, 'ปิดยอด', f.lineUserId),
        ).rejects.toThrow(openIntentText(first.tracking.expiresAt));
        const link = await payoffLink(f.contractId);
        await expect(
          intent.createPaymentIntent(
            f.contractId,
            15189.98,
            'ปิดยอด',
            f.lineUserId,
            undefined,
            link.token,
          ),
        ).rejects.toThrow(openIntentText(first.tracking.expiresAt));

        expect(createUiPayment).toHaveBeenCalledTimes(1); // ปฏิเสธก่อนเรียก gateway
        expect((await openPayoffRows(f.contractId)).map((r) => r.id)).toEqual([first.tracking.id]);
      });

      it('QR ใบเดิมปิดไปแล้ว (ชำระไม่สำเร็จ → EXPIRED · เลยเวลาหมดอายุ) และลิงก์ /pay/:token ต้นทางไม่นับ → สร้างใบใหม่ได้', async () => {
        const f = await createPayoffContract();
        const failed = await createPayoffIntent(f, 15189.98);
        await prisma.paymentLink.update({
          where: { id: failed.tracking.id },
          data: { status: 'EXPIRED' },
        });
        const timedOut = await createPayoffIntent(f, 15189.98);
        await prisma.paymentLink.update({
          where: { id: timedOut.tracking.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await payoffLink(f.contractId); // ลิงก์ต้นทาง (ไม่มี snapshot) ไม่ใช่ QR ที่สร้างแล้ว
        const third = await createPayoffIntent(f, 15189.98);
        expect(createUiPayment).toHaveBeenCalledTimes(3);
        expect((await openPayoffRows(f.contractId)).map((r) => r.id)).toEqual([third.tracking.id]);
      });

      it('สองคำขอพร้อมกัน (ผ่านด่านแรกและถึง gateway ทั้งคู่) → ผ่านคำขอเดียว · อีกคำขอได้ 400 ไทยและไม่ได้ลิงก์ชำระ · แถวติดตามเปิดอยู่ใบเดียว', async () => {
        const f = await createPayoffContract();
        // gateway ตอบเมื่อทั้งสองคำขอมาถึงแล้ว ⇒ ทั้งคู่ผ่านด่านก่อนเรียก gateway (ยังไม่มีแถวติดตาม) — ที่กันได้คือด่านใต้ล็อกในธุรกรรมที่สร้างแถว
        let arrived = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const safety = setTimeout(() => release(), 10_000);
        const waitAtGate = async () => {
          arrived += 1;
          if (arrived === 2) release();
          await gate;
          return { gatewayResponse: {}, paymentUrl: 'https://gw.test/pay' };
        };
        createUiPayment.mockImplementationOnce(waitAtGate).mockImplementationOnce(waitAtGate);

        const results = await Promise.allSettled([
          intent.createPaymentIntent(f.contractId, 15189.98, 'ปิดยอด', f.lineUserId),
          intent.createPaymentIntent(f.contractId, 15189.98, 'ปิดยอด', f.lineUserId),
        ]);
        clearTimeout(safety);

        expect(arrived).toBe(2);
        const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
        const open = await openPayoffRows(f.contractId);
        expect(open).toHaveLength(1);
        expect(ok[0].paymentId).toBe(open[0].id);
        expect((rejected[0].reason as Error).message).toBe(openIntentText(open[0].expiresAt));
        expect(Sentry.captureException).not.toHaveBeenCalled(); // ไม่ใช่ orphan intent — ลิงก์ชำระของคำขอที่แพ้ไม่ถูกส่งออกไป
      });
    });

    describe('webhook — ยอดตรงยอดปิด ณ เวลาที่เงินเข้า → JP4', () => {
      it('ปิดสัญญาเป็น EARLY_PAYOFF · รายการ JP4 = ตัวเลขทอง · ใบ EARLY_PAYOFF หนึ่งใบผูก JP4 · การ์ดปิดยอดเดิม · แถวติดตาม USED', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);

        await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

        const contract = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
        expect(contract.status).toBe('EARLY_PAYOFF');
        expect(money(contract.creditBalance)).toBe('0.00');
        const payments = await prisma.payment.findMany({ where: { contractId: f.contractId } });
        expect(payments.every((p) => p.status === 'PAID')).toBe(true);
        expect(payments.every((p) => p.gatewayRef === tracking.token)).toBe(true);
        expect(payments.every((p) => p.paymentMethod === 'ONLINE_GATEWAY')).toBe(true);
        // คำตัดสินเจ้าของ #45: แถวงวดบอกบัญชีรับเงินเดียวกับขา Dr ของ JP4
        expect(payments.every((p) => p.depositAccountCode === '11-1201')).toBe(true);

        const jp4 = await jp4Of(f.contractId);
        expect(jp4).toHaveLength(1);
        expect(linesOf(jp4[0])).toEqual(sortLines(GOLDEN_JP4));

        const receipts = await prisma.receipt.findMany({
          where: { contractId: f.contractId, deletedAt: null },
        });
        expect(receipts.map((r) => r.receiptType)).toEqual(['EARLY_PAYOFF']);
        expect(receipts[0].sourceJournalEntryId).toBe(jp4[0].id);
        expect(money(receipts[0].amount)).toBe('15189.98');
        expect(receipts[0].transactionRef).toBe(`TX-${tracking.token}`);
        // ไม่มีใบรับชำระงวด (FIFO) — เงินก้อนนี้คือการปิดยอด
        expect(await entryTagsOf(f.contractId)).toEqual(['1A', 'JP4']);

        const after = await prisma.paymentLink.findUniqueOrThrow({ where: { id: tracking.id } });
        expect(after.status).toBe('USED');
        expect(host.sendEarlyPayoffSuccessNotification).toHaveBeenCalledTimes(1);
        expect(host.sendPaymentSuccessNotification).not.toHaveBeenCalled();
        const audit = await prisma.auditLog.findMany({
          where: { entityId: f.contractId, action: 'EARLY_PAYOFF_GATEWAY_MATCHED' },
        });
        expect(audit).toHaveLength(1);
        expect(audit[0].newValue).toMatchObject({
          totalPayoff: '15189.98',
          paidAmount: '15189.98',
          refno: tracking.token,
        });
        const journey = await prisma.customerJourneyEntry.findMany({
          where: { customerId: f.customerId, kind: 'EARLY_PAYOFF' },
        });
        expect(journey).toHaveLength(1);
        expect(journey[0].actorType).toBe('CUSTOMER');
        expect(await fallbackTodo(tracking.id)).toHaveLength(0);
        // หน้า /liff/contract?ref=<id ของแถวติดตาม> poll สถานะ → "ชำระเงินสำเร็จ!" เดิม (เดิมได้ 400 เพราะเลขอ้างอิง 12 หลัก)
        const confirmation = new PaySolutionsConfirmationService(
          prisma as never,
          {} as never,
          {} as never,
          {} as never,
        );
        await expect(confirmation.getPaymentStatus(tracking.id)).resolves.toMatchObject({
          status: 'PAID',
        });
      });

      it('PaySolutions ส่ง webhook ซ้ำ → ไม่มี JP4 / ใบเสร็จ / audit / การ์ดซ้ำ', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);
        const data = webhookData(tracking, '15189.98');

        await webhook.handlePaymentCallback(data);
        await webhook.handlePaymentCallback(data);
        await webhook.handlePaymentCallback(data);

        expect(await jp4Of(f.contractId)).toHaveLength(1);
        expect(
          await prisma.receipt.count({ where: { contractId: f.contractId, deletedAt: null } }),
        ).toBe(1);
        expect(
          await prisma.auditLog.count({
            where: { entityId: f.contractId, action: 'EARLY_PAYOFF_GATEWAY_MATCHED' },
          }),
        ).toBe(1);
        expect(host.sendEarlyPayoffSuccessNotification).toHaveBeenCalledTimes(1);
      });

      it('เครดิต 300 + เงินรับล่วงหน้าถังรวม 500 → ลูกค้าจ่าย 14,612.63 · JP4 ลง Dr 21-1103 / Dr 21-5101 ตามกติกา JP4 (ไม่ตั้งศูนย์เงียบ) · คอลัมน์เป็น 0', async () => {
        const f = await createPayoffContract({ credit: '300', advance: '500' });
        const { tracking } = await createPayoffIntent(f, 14612.63);
        expect(money(tracking.amount)).toBe('14612.63');

        await webhook.handlePaymentCallback(webhookData(tracking, '14612.63'));

        const jp4 = await jp4Of(f.contractId);
        expect(jp4).toHaveLength(1);
        expect(linesOf(jp4[0])).toEqual(sortLines(GOLDEN_JP4_CREDIT_ADVANCE));
        const contract = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
        expect(contract.status).toBe('EARLY_PAYOFF');
        expect(money(contract.creditBalance)).toBe('0.00');
        expect(money(contract.advanceBalance)).toBe('0.00');
        // ไม่มีใบรับชำระงวด / เงินส่วนเกินพักเป็นเงินรับล่วงหน้า (ทาง FIFO เดิมไม่เกิด)
        expect(await entryTagsOf(f.contractId)).toEqual(['1A', 'JP4', 'spec-customer-money']);
      });
    });

    describe('webhook — ลง JP4 ไม่ได้ → FIFO แบบเดิม + งาน HIGH + Sentry warning หลัง commit', () => {
      it('ยอดปิดเปลี่ยนระหว่างสร้าง QR กับเงินเข้า (ข้ามวัน งวด 1 ถึงกำหนด) → FIFO · สัญญายังไม่ปิด · งาน HIGH หนึ่งใบต่อ intent · ลูกค้าได้ข้อความชำระสำเร็จ', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);
        // ข้ามวัน: งวด 1 ครบกำหนดเมื่อวาน ⇒ ส่วนลดเฉพาะงวดที่ยังไม่ถึงกำหนด (18.1) เล็กลง ⇒ ยอดปิดตอนเงินเข้าสูงขึ้น
        const yesterday = dueIn(0, -1);
        await prisma.installmentSchedule.updateMany({
          where: { contractId: f.contractId, installmentNo: 1 },
          data: { dueDate: yesterday },
        });
        await prisma.payment.updateMany({
          where: { contractId: f.contractId, installmentNo: 1 },
          data: { dueDate: yesterday },
        });

        const data = webhookData(tracking, '15189.98');
        await webhook.handlePaymentCallback(data);
        await webhook.handlePaymentCallback(data);

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        const contract = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
        expect(contract.status).toBe('ACTIVE');
        const payments = await prisma.payment.findMany({
          where: { contractId: f.contractId },
          orderBy: { installmentNo: 'asc' },
        });
        // FIFO: 15,189.98 = 10 งวดเต็ม (15,158.30) + 31.68 ของงวด 11
        expect(payments.filter((p) => p.status === 'PAID').map((p) => p.installmentNo)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
        expect(payments[10].status).toBe('PARTIALLY_PAID');
        expect(money(payments[10].amountPaid)).toBe('31.68');
        // คำตัดสินเจ้าของ #45: ใบรับชำระงวดของ FIFO ลงบัญชี QR ของ Pay Solutions (11-1201) และแถวงวดบอกบัญชีเดียวกัน
        const bank = await bankLinesOf(f.contractId);
        expect(bank.every((l) => l.accountCode === '11-1201')).toBe(true);
        expect(money(bank.reduce((sum, l) => sum.plus(l.debit), new Prisma.Decimal(0)))).toBe(
          '15189.98',
        );
        expect(
          payments
            .filter((p) => p.installmentNo <= 11)
            .every((p) => p.depositAccountCode === '11-1201'),
        ).toBe(true);
        expect(host.sendPaymentSuccessNotification).toHaveBeenCalledTimes(1);
        expect(host.sendEarlyPayoffSuccessNotification).not.toHaveBeenCalled();

        const todos = await fallbackTodo(tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].priority).toBe('HIGH');
        expect(todos[0].title).toContain(f.contractNumber);
        expect(todos[0].description).toContain('15,189.98');
        expect(todos[0].description).toMatch(/ยอดปิด ณ เวลาที่เงินเข้า[^\n]*\d/);
        expect(todos[0].description).toContain('ยอดที่ลูกค้าจ่ายไม่ตรงยอดปิด');
        // I-1: บอกสิ่งที่เกิดจริง — ตัดงวด 1–11 · สัญญายังไม่ปิด · ทางไปต่อ = ปิดยอดส่วนที่เหลือ
        expect(todos[0].description).toContain(
          'ระบบลงเงินก้อนนี้เป็นค่างวดตามลำดับงวดแล้ว: งวดที่ 1–11',
        );
        expect(todos[0].description).toContain('สัญญายังไม่ปิด');
        expect(todos[0].description).toContain('ปุ่ม "ปิดก่อนกำหนด"');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.stringContaining('paysolutions payoff'),
          expect.objectContaining({
            level: 'warning',
            tags: expect.objectContaining({
              action: 'paysolutions-payoff-fallback',
              reason: 'QUOTE_MISMATCH',
            }),
          }),
        );
      });

      it('มีคำขอคืนเงินที่อนุมัติแล้วรอธนาคาร (#24) → ไม่ลง JP4 · FIFO + งาน HIGH เหตุผลคืนเงิน', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);
        // คำขอคืนเงินถูกอนุมัติหลังสร้าง QR (ลิงก์ยังจ่ายได้ — webhook ห้ามปฏิเสธเงินที่ตัดแล้ว)
        const firstPayment = await prisma.payment.findFirstOrThrow({
          where: { contractId: f.contractId, installmentNo: 1 },
        });
        const approver = await prisma.user.create({
          data: {
            email: `${stamp}-${++seq}-fm@bestchoice.test`,
            password: 'x',
            name: 'fm',
            role: 'FINANCE_MANAGER',
          },
        });
        await prisma.refund.create({
          data: {
            paymentId: firstPayment.id,
            contractId: f.contractId,
            amount: new Prisma.Decimal('500.00'),
            reason: 'spec',
            status: 'APPROVED',
            requestedById: ownerId,
            approvedById: approver.id,
            approvedAt: new Date(),
          },
        });

        await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } })).status,
        ).toBe('ACTIVE');
        expect(
          await prisma.payment.count({ where: { contractId: f.contractId, status: 'PAID' } }),
        ).toBe(10);
        const todos = await fallbackTodo(tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].priority).toBe('HIGH');
        expect(todos[0].description).toContain('คำขอคืนเงิน');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ tags: expect.objectContaining({ reason: 'REFUND_PENDING' }) }),
        );
        expect(
          await prisma.auditLog.count({
            where: { entityId: f.contractId, action: 'EARLY_PAYOFF_GATEWAY_MATCHED' },
          }),
        ).toBe(0);
      });

      it('สัญญาถูกบอกเลิกระหว่างสร้าง QR กับเงินเข้า → ไม่ลง JP4 · FIFO + งาน HIGH เหตุผลสถานะสัญญา', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);
        await prisma.contract.update({
          where: { id: f.contractId },
          data: { status: 'TERMINATED' },
        });

        await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        expect(
          await prisma.payment.count({ where: { contractId: f.contractId, status: 'PAID' } }),
        ).toBe(10);
        const todos = await fallbackTodo(tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].description).toContain('สถานะสัญญา');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ tags: expect.objectContaining({ reason: 'CONTRACT_STATUS' }) }),
        );
      });

      it('แถวติดตาม PAYOFF ที่ไม่มี snapshot (สร้างก่อน migration) → FIFO + งาน HIGH · ไม่ลง JP4', async () => {
        const f = await createPayoffContract();
        const tracking = await prisma.paymentLink.create({
          data: {
            token: `${Date.now()}`.slice(-12),
            contractId: f.contractId,
            amount: new Prisma.Decimal('15189.98'),
            purpose: 'PAYOFF',
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });

        await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        expect(
          await prisma.payment.count({ where: { contractId: f.contractId, status: 'PAID' } }),
        ).toBe(10);
        const todos = await fallbackTodo(tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].description).toContain('15,189.98'); // ยอดปิด ณ เวลาที่เงินเข้า (ส่วนลดค่าเริ่มต้น) ช่วยพนักงานตัดสิน
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            tags: expect.objectContaining({ reason: 'NO_QUOTE_SNAPSHOT' }),
          }),
        );
      });

      it('I-1 ลูกค้าจ่าย QR ปิดยอดสองใบ (ใบแรกเลยเวลาหมดอายุแล้วจึงสร้างใบที่สองได้ — (ค)) → ใบแรกปิดสัญญา (JP4) · ใบที่สองไม่ตัดงวดใด เงินทั้งก้อนเป็นเงินรับล่วงหน้า · สถานะ EARLY_PAYOFF ไม่ถูกเขียนทับ · งานบอกให้คืนเงินตามจริง', async () => {
        const f = await createPayoffContract();
        const first = await createPayoffIntent(f, 15189.98);
        // (ค) — สร้างใบที่สองได้เมื่อใบแรกเลยเวลาหมดอายุ (30 นาที) แล้วเท่านั้น · webhook ไม่ดูเวลาหมดอายุ (แถวยัง ACTIVE) ⇒ ลูกค้าจ่ายใบแรกช้า
        // แล้วจ่ายใบที่สองด้วย = ทางที่ยังเหลือของเหตุการณ์นี้ (อีกทาง: พนักงานปิดยอดด้วยสลิปขณะ QR ของลูกค้ายังเปิด)
        await prisma.paymentLink.update({
          where: { id: first.tracking.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        const second = await createPayoffIntent(f, 15189.98);

        await webhook.handlePaymentCallback(webhookData(first.tracking, '15189.98'));
        jest.clearAllMocks();
        await webhook.handlePaymentCallback(webhookData(second.tracking, '15189.98'));

        const contract = await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } });
        expect(contract.status).toBe('EARLY_PAYOFF'); // FIFO ของใบที่สองไม่เขียน COMPLETED ทับ
        expect(money(contract.advanceBalance)).toBe('15189.98');
        expect(await jp4Of(f.contractId)).toHaveLength(1);
        expect(await entryTagsOf(f.contractId)).toEqual([
          '1A',
          'JP4',
          'paysolutions-surplus-advance',
        ]);
        const receipts = await prisma.receipt.findMany({
          where: { contractId: f.contractId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        expect(receipts.map((r) => r.receiptType)).toEqual(['EARLY_PAYOFF', 'ADVANCE_SURPLUS']);
        expect(await fallbackTodo(first.tracking.id)).toHaveLength(0);

        const todos = await fallbackTodo(second.tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].priority).toBe('HIGH');
        expect(todos[0].title).toBe(
          `เงินปิดยอดผ่าน QR เข้าสัญญาที่ปิดยอดไม่ได้ — สัญญา ${f.contractNumber} รับเงิน 15,189.98 บาท (ต้องคืนลูกค้า)`,
        );
        const text = todos[0].description ?? '';
        expect(text).toContain('สัญญาอยู่ในสถานะ EARLY_PAYOFF ตอนเงินเข้า');
        expect(text).toContain(
          'ระบบไม่ได้ตัดงวดใด — เงินทั้งก้อน 15,189.98 บาทพักเป็นเงินรับล่วงหน้า (21-1103) ของสัญญา และออกใบรับเงินส่วนเกิน (ADVANCE_SURPLUS) ให้ลูกค้าแล้ว · สถานะสัญญาคงเดิม (EARLY_PAYOFF)',
        );
        expect(text).toContain('เงินก้อนนี้ต้องคืนลูกค้า แต่ระบบยังไม่มีทางคืน');
        expect(text).toContain('00:40 น.');
        expect(text).not.toContain('ค่างวดตามลำดับงวด');
        expect(text).not.toContain('ปุ่ม "ปิดก่อนกำหนด"');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            tags: expect.objectContaining({ reason: 'CONTRACT_STATUS', outcome: 'ADVANCE_ONLY' }),
          }),
        );
      });

      it('statement ของ Postgres ล้มจริงใน savepoint (เลขอ้างอิงรายการ JP4 ชน unique) → ถอย savepoint · FIFO commit ได้ · งานแจ้ง JP4_ERROR', async () => {
        const f = await createPayoffContract();
        const { tracking } = await createPayoffIntent(f, 15189.98);
        // รายการที่ถือเลขอ้างอิงเดียวกับ JP4 ของสัญญานี้ (ไม่ผูก contractId — ไม่กระทบยอดของสัญญา) ⇒ INSERT ของ JP4 ชน journal_entries_ref_unique
        await new JournalAutoService(prisma as never).createAndPost({
          description: 'spec — ชนเลขอ้างอิง JP4',
          reference: `${f.contractId}:early-payoff`,
          metadata: { tag: 'spec-ref-collision' },
          lines: [
            { accountCode: '11-1103', dr: new Prisma.Decimal('0.01'), cr: new Prisma.Decimal(0) },
            { accountCode: '11-1102', dr: new Prisma.Decimal(0), cr: new Prisma.Decimal('0.01') },
          ],
        });

        await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        expect(
          await prisma.auditLog.count({
            where: { entityId: f.contractId, action: 'EARLY_PAYOFF_GATEWAY_MATCHED' },
          }),
        ).toBe(0);
        expect(
          (await prisma.contract.findUniqueOrThrow({ where: { id: f.contractId } })).status,
        ).toBe('ACTIVE');
        expect(
          await prisma.payment.count({ where: { contractId: f.contractId, status: 'PAID' } }),
        ).toBe(10);
        expect(
          (await prisma.paymentLink.findUniqueOrThrow({ where: { id: tracking.id } })).status,
        ).toBe('USED');
        const todos = await fallbackTodo(tracking.id);
        expect(todos).toHaveLength(1);
        expect(todos[0].description).toContain('ลงรายการปิดยอดไม่สำเร็จ');
        expect(Sentry.captureMessage).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ tags: expect.objectContaining({ reason: 'JP4_ERROR' }) }),
        );
      });

      it('คำตัดสินเจ้าของ #45: บัญชี QR ค่าเริ่มต้นที่ตั้งไว้ (เช่น 11-1203) เป็นขา Dr ของ JP4 และแถวงวด', async () => {
        await withQrDefaultAccount('11-1203', async () => {
          const f = await createPayoffContract();
          const { tracking } = await createPayoffIntent(f, 15189.98);

          await webhook.handlePaymentCallback(webhookData(tracking, '15189.98'));

          const jp4 = await jp4Of(f.contractId);
          expect(jp4).toHaveLength(1);
          expect(linesOf(jp4[0])).toContainEqual(['11-1203', '15189.98', '0.00']);
          expect(jp4[0].lines.some((l) => l.accountCode === '11-1201')).toBe(false);
          const payments = await prisma.payment.findMany({ where: { contractId: f.contractId } });
          expect(payments.every((p) => p.depositAccountCode === '11-1203')).toBe(true);
        });
      });

      it('แถวติดตามที่ไม่ใช่การปิดยอด (AMOUNT) → FIFO เดิม ไม่มีงานแจ้ง ไม่มี Sentry ของทางปิดยอด', async () => {
        const f = await createPayoffContract();
        const tracking = await prisma.paymentLink.create({
          data: {
            token: `${Date.now() + 1}`.slice(-12),
            contractId: f.contractId,
            amount: new Prisma.Decimal('3031.66'),
            purpose: 'AMOUNT',
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });

        await webhook.handlePaymentCallback(webhookData(tracking, '3031.66'));

        expect(await jp4Of(f.contractId)).toHaveLength(0);
        expect(
          await prisma.payment.count({ where: { contractId: f.contractId, status: 'PAID' } }),
        ).toBe(2);
        expect(await fallbackTodo(tracking.id)).toHaveLength(0);
        expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            tags: expect.objectContaining({ action: 'paysolutions-payoff-fallback' }),
          }),
        );
      });
    });
  },
);
