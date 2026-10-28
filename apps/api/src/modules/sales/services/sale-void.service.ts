import { currentDomainAccess, domainAccessClient } from '../../employee-access/access-execution-context';
import { TradeInCreditService } from '../../trade-in/services/trade-in-credit.service';
import { ShopTenderRecorder } from '../../shop-tenders/shop-tender.recorder';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CommissionStatus, PayoutStatus, Prisma, ProductStatus, RepairStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { clawBackCommissions, clawbackAmountOf } from '../../commission/commission-clawback.util';
import { isCoveredByPayout, isLockedPayout } from '../../commission/commission-payout-cover.util';
import { assertProductNotHeld } from '../../products/product-hold.util';
import { reopenRepossessionOnUnsale } from '../../repossessions/repossession-resale.util';
import { ExchangeCancelReversalTemplate } from '../../journal/cpa-templates/exchange-cancel-reversal.template';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { SALE_TYPE_PRODUCT_STATUS } from './sale-product-status.util';

/**
 * ยกเลิกใบขาย (void sale) — spec `docs/superpowers/specs/2026-08-22-void-sale-design.md`
 *
 * ก่อนหน้านี้ระบบไม่เหลือทางแก้ "บันทึกขายผิด" เลย: `SalesService` มีแค่ findAll/findOne/create
 * และ `SOLD_*` อยู่ใน `SYSTEM_MANAGED_STATUSES` จึงแก้สถานะสินค้าด้วยมือไม่ได้ด้วย
 *
 * ขอบเขต: `CASH` + `EXTERNAL_FINANCE` เท่านั้น (D1) — `INSTALLMENT` มีเส้นทางยกเลิกสัญญา
 * ของตัวเองอยู่แล้ว (Phase 3 C-1/C-2) การทำซ้อนคือกติกาชุดที่สอง
 *
 * **ทุกด่านอ่านในทรานแซกชันเดียวกันก่อนแตะ state ใด ๆ** — ไม่ใช่ "เขียนไปก่อนแล้ว rollback"
 * เพราะข้อความผิดพลาดต้องบอกได้ว่าติดอะไรโดยไม่ต้องพึ่งการย้อนกลับ (มีเทสปักทุกด่าน)
 */

/**
 * สถานะที่ใบขายแต่ละแบบตั้งให้ **สินค้าหลัก** — ส่งเป็น `expectedStatus` ของด่าน G5
 *
 * `sale-writer.service.ts`: ขายสดตั้ง `SOLD_CASH` (บรรทัด ~203) / ขายผ่านไฟแนนซ์ภายนอก
 * ตั้ง `SOLD_INSTALLMENT` (บรรทัด ~505) ⇒ สถานะที่ยังตรงกับค่านี้ = ไม่มีใครมาผูกเครื่องต่อ
 */
// PR 5 — แผนที่ย้ายไป sale-product-status.util.ts (ใช้ร่วมกับเปลี่ยนรุ่นเดิมขายสด) — ชื่อเดิมใช้ต่อได้ทุกจุด

/**
 * **ของแถมเป็น `SOLD_CASH` เสมอ ไม่ว่าใบขายจะเป็นแบบไหน** — `markBundleProductsSold`
 * (`sale-writer.service.ts` บรรทัด ~167) hardcode `SOLD_CASH` และถูกเรียกจากทั้ง
 * `createCashSale` และ `createExternalFinanceSale` ขณะที่สินค้าหลักของ EXTERNAL_FINANCE
 * ถูกตั้งเป็น `SOLD_INSTALLMENT`
 *
 * ⇒ ใบขายผ่านไฟแนนซ์ภายนอกที่มีของแถมมีสองสถานะในใบเดียว: ถ้าใช้ `expectedStatus`
 * ตัวเดียวทั้งใบ ด่าน G5 จะบล็อกของแถมทุกชิ้นด้วยข้อความ "มีรายการอื่นผูกเครื่องนี้ไปแล้ว"
 * ซึ่ง **ไม่จริง** และทำให้ยกเลิกใบขายแบบนั้นไม่ได้เลย
 */
const BUNDLE_PRODUCT_STATUS: ProductStatus = ProductStatus.SOLD_CASH;

/**
 * สถานะใบซ่อมที่ถือว่า "ปิดแล้ว" — เจตนาเป็น **exclude list** (`notIn`) ไม่ใช่ include list
 * ของสถานะที่ยังเปิด: สถานะใหม่ที่เพิ่มใน `RepairStatus` วันหลังจะถูกกันไว้โดยปริยาย
 * ไม่หลุดด่านเงียบ ๆ (หลักเดียวกับ `FINISHED_CONTRACT_STATUSES` ใน product-hold.util)
 */
const CLOSED_REPAIR_STATUSES: readonly RepairStatus[] = [
  RepairStatus.CLOSED,
  RepairStatus.CANCELLED,
  RepairStatus.REPLACED,
];

/**
 * G4 — ค่าคอมของใบขายแต่ละสถานะทำอะไรตอนยกเลิก (P2-R9 — D4 ส่วนที่ 2: ค่าคอมที่จ่ายแล้วไม่บล็อกอีก)
 *
 * - `CLAW_BACK` → `clawBackCommissions` 100%: ยังไม่จ่าย = CLAWED_BACK ยอด null · จ่ายแล้ว (paidAt) =
 *   CLAWED_BACK ยอด = paidAmount แล้วใบเงินเดือนงวดถัดไปหักคืน (Tasks 3–4) — รวม PARTIALLY_CLAWED_BACK
 *   (เคยถูกเรียกคืนบางส่วน → เรียกคืนเต็ม)
 * - `SKIP` → CLAWED_BACK อยู่แล้ว ไม่มีอะไรให้เรียกคืนอีก (เดิมบล็อกด้วยข้อความเท็จ "เงินออกไปแล้ว")
 *
 * `satisfies Record<CommissionStatus, …>` ⇒ ค่าใหม่ใน enum compile ไม่ผ่านจนกว่าจะตัดสินใจ · ค่าที่ไม่อยู่ใน
 * ตาราง ณ runtime ยังถูก **บล็อก** (หลัก exclude list เดียวกับ `CLOSED_REPAIR_STATUSES`) ไม่ใช่ผ่านเงียบ ๆ
 */
const G4_COMMISSION_ACTION = {
  PENDING: 'CLAW_BACK',
  APPROVED: 'CLAW_BACK',
  PAID: 'CLAW_BACK',
  PARTIALLY_CLAWED_BACK: 'CLAW_BACK',
  CLAWED_BACK: 'SKIP',
} as const satisfies Record<CommissionStatus, 'CLAW_BACK' | 'SKIP'>;

/*
 * สถานะ **รอบจ่ายค่าคอม** (`CommissionPayout`) ที่ยังไม่ผูกเงิน ⇒ ยกเลิกใบขายทับได้ — รายการเดียว
 * `UNPAID_PAYOUT_STATUSES` / `isLockedPayout` ใน commission-payout-cover.util.ts (P2-R27 — ห้ามมีสำเนา)
 *
 * exclude list โดยเจตนา (ค่าจริง `PayoutStatus` = DRAFT / APPROVED / PAID / CANCELLED) —
 * สถานะใหม่จะถูกนับว่า "ผูกเงินแล้ว" และบล็อกไว้ก่อน ไม่ใช่ผ่านเงียบ ๆ
 *
 * - `DRAFT` — **คำตัดสินเจ้าของ 2026-08-23: ร่างยกเลิกได้** ⇒ ไม่บล็อก แต่ต้อง
 *   **soft-delete ร่างนั้นทิ้งใน tx เดียวกัน** — ยอดของร่างไม่ถูกคำนวณใหม่ ⇒ ปล่อยร่างไว้ = ยอดค้าง
 *   เกินจริงแล้วถูกอนุมัติตามยอดเก่า. (D4 ส่วนที่ 2: สร้างรอบจ่ายตอบ 410 แล้ว — ค่าคอมที่เหลือของคู่
 *   พนักงาน+งวดนั้นเข้าใบเงินเดือนแทน)
 * - `CANCELLED` — รอบถูกยกเลิก ไม่ผูกเงิน ⇒ ปล่อยผ่านเฉย ๆ ไม่ต้องลบ
 *
 * **ห้ามแก้เป็นการหักยอด** (`totalCommission -= commissionAmount`) แทนการลบร่าง:
 * รอบที่ generate **ก่อน** ค่าคอมใบนี้เกิดไม่เคยนับใบนี้ ⇒ หักยอด = จ่ายพนักงานขาด
 */

/**
 * สถานะลูกหนี้ไฟแนนซ์ที่แปลว่า **เงินเข้าจริงแล้ว** — allow-list ตามเจตนา D2
 * ("บล็อกเมื่อเงินขยับจริง")
 *
 * `FinanceReceivableStatus` มี 5 ค่า แต่ `DISPUTED`/`OVERDUE` แปลว่า **ยังไม่ได้เงิน** —
 * รายงานของระบบเองยืนยัน (`finance-receivable.service.ts` จัด DISPUTED เป็น
 * `disputedAmount` เต็มจำนวน `netExpectedAmount` และ OVERDUE เป็นยอดค้าง) ⇒ การอ่าน
 * `status !== 'PENDING'` ว่า "โอนมาแล้ว" เป็น false positive ที่ล็อกใบขายไว้ถาวร
 * (ปุ่ม "แจ้งปัญหา" ตั้ง `DISPUTED` ได้ แต่ไม่มีคอนโทรลบน UI พากลับ `PENDING`)
 *
 * เคสเงินเข้าจริงถูกครอบอีกชั้นด้วย `receivedAmount > 0` อยู่แล้ว
 */
const RECEIVED_FINANCE_STATUSES: readonly string[] = ['RECEIVED', 'PARTIALLY_RECEIVED'];

export interface VoidSaleResult {
  saleNumber: string;
  restoredProductIds: string[];
  reversalEntryNumbers: string[];
  /** ยอดค่าคอมที่จ่ายไปแล้วและถูกเรียกคืน (2 ตำแหน่ง, '0.00' เมื่อไม่มี) — ใบเงินเดือนงวดถัดไปหักคืน */
  paidCommissionClawback: string;
}

/**
 * ผู้กดยกเลิก — ต้องส่งทั้งก้อน (ไม่ใช่แค่ id) เพราะ branch scope เป็นหน้าที่ของ
 * service ชั้นนี้: `BranchGuard` ทำงานเฉพาะ request ที่มี `branchId` ใน
 * params/query/body ซึ่ง `POST /sales/:id/void` ไม่มี (doc ของ guard เองระบุว่า
 * "service layer is expected to scope")
 */
export interface VoidSaleActor {
  id: string;
  role: string;
  branchId?: string | null;
}

@Injectable()
export class SaleVoidService {
  private readonly logger = new Logger(SaleVoidService.name);

  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }

  constructor(
    private readonly basePrisma: PrismaService,
    private reversalTemplate: ExchangeCancelReversalTemplate,
  ) {}

  async voidSale(saleId: string, user: VoidSaleActor, reason: string): Promise<VoidSaleResult> {
    try {
      return await this.prisma.$transaction((tx) => this.run(tx, saleId, user, reason), {
        // Serializable — เท่ากับตอนสร้างการขาย (`sale-writer.service.ts`): ด่านทุกข้ออ่าน
        // แถวที่การเขียนของเราจะเปลี่ยนผลการอ่านนั้น (สถานะสินค้า/ค่าคอม/JE) ⇒ ใต้
        // READ COMMITTED สองคำขอพร้อมกันบนใบเดียวผ่านด่านได้ทั้งคู่
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (currentDomainAccess()) throw err;
      // ผู้แพ้ SSI race (40001 → Prisma P2034) โผล่ได้ทั้งกลาง tx และตอน commit
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        this.logger.warn(
          `[sale-void] write conflict (P2034) on sale ${saleId} — rejecting with 409, user should retry`,
        );
        // `SentryExceptionFilter` จับเฉพาะ status >= 500 — 409 ใบนี้จึงมองไม่เห็นจาก
        // monitoring ถ้าไม่ยิงเอง (pattern เดียวกับ `approveBatch` / shop-collect)
        Sentry.captureMessage('[sale-void] P2034 write-conflict translated to 409', {
          level: 'warning',
          extra: { saleId, userId: user.id },
        });
        throw new ConflictException(
          'ใบขายนี้ชนกับรายการอื่นที่กำลังบันทึกอยู่ (write conflict) — กรุณาลองยกเลิกอีกครั้ง',
        );
      }
      throw err;
    }
  }

  private async run(
    tx: Prisma.TransactionClient,
    saleId: string,
    user: VoidSaleActor,
    reason: string,
  ): Promise<VoidSaleResult> {
    // ══ ด่านทั้งหมด (อ่านอย่างเดียว) ═══════════════════════════════════════════

    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        saleNumber: true,
        saleType: true,
        productId: true,
        bundleProductIds: true,
        contractId: true,
        onlineOrderId: true,
        deletedAt: true,
        branchId: true,
        netAmount: true,
        tradeInCreditSnapshot: true,
        exchangeCaseId: true, // PR 5 — G9
        exchangeCase: { select: { caseNumber: true } },
      },
    });
    if (!sale) throw new NotFoundException('ไม่พบใบขายที่ต้องการยกเลิก');

    // ── G1 — idempotency ────────────────────────────────────────────────────
    if (sale.deletedAt) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} ถูกยกเลิกไปแล้วเมื่อ ${sale.deletedAt.toLocaleString('th-TH')} — ` +
          'ถ้าต้องแก้ไขข้อมูลการขาย ให้บันทึกใบขายใหม่แทน',
      );
    }

    // ── G9 (PR 5) — ใบขายที่สลับเครื่องแล้ว (เปลี่ยนรุ่นเดิมขายสด) ─────────────────
    // JE สลับต้นทุน stamp saleId จึงอยู่ใน sweep ด้านล่างได้ แต่เครื่องเดิมอยู่ DEFECT_RETURN/ถูกตัดจำหน่าย
    // และเครื่องทดแทนถูกส่งมอบไปแล้ว — ย้อนทั้งชุดเป็นงานฝ่ายบัญชี (คำตัดสินเจ้าของ ⑦ ปิดถาวร)
    if (sale.exchangeCaseId) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} เปลี่ยนเครื่องแล้ว (เคส ${sale.exchangeCase?.caseNumber ?? sale.exchangeCaseId}) — ` +
          'ยกเลิกใบขายไม่ได้ ให้ฝ่ายบัญชีแก้รายการถ้าจำเป็น',
      );
    }

    // ── ขอบเขตสาขา — BM ยกเลิกได้เฉพาะใบขายสาขาตัวเอง ───────────────────────
    // `BranchGuard` ปล่อย request ที่ไม่มี branchId ผ่านเสมอ (route นี้มีแต่ :id)
    // จึงบังคับที่นี่ตาม precedent `contract-exchange-cancel.service.ts` —
    // OWNER (+role ข้ามสาขาอื่นที่ได้สิทธิ์ route นี้) ข้ามสาขาได้ตามเดิม.
    // BM ที่ไม่มี branchId ติดตัว (ข้อมูลผิดปกติ) = fail closed
    if (!currentDomainAccess() && user.role === 'BRANCH_MANAGER' && sale.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถยกเลิกใบขายของสาขาอื่นได้');
    }

    // ── นอกขอบเขต (D1) — ใบขายผ่อนของเรามีเส้นทางของตัวเอง ────────────────────
    if (sale.saleType === 'INSTALLMENT') {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} เป็นการขายผ่อนของเรา ต้องยกเลิกผ่านเส้นทางยกเลิกสัญญา ` +
          'ไม่ใช่ที่นี่ (เส้นทางนั้นคืนเครื่อง กวาดรายการบัญชี และปลดสำรองหนี้สูญให้ครบในตัว) — ' +
          'ยังไม่มีปุ่มเปิดคำขอบนหน้าจอ ให้แจ้งเจ้าของ/ผจก.การเงิน อนุมัติที่เมนู "เอกสารยกเลิกสัญญา"',
      );
    }
    // ชนิดการขายที่ยังไม่รู้จัก = กันไว้ก่อน (หลัก exclude list เดียวกับด่านอื่น) —
    // ถ้าปล่อยผ่าน `SALE_TYPE_PRODUCT_STATUS[...]` จะเป็น undefined แล้วไปตายเป็น 500
    // ที่ `assertProductNotHeld` แทนที่จะเป็นข้อความไทยที่คนอ่านรู้เรื่อง
    if (!(sale.saleType in SALE_TYPE_PRODUCT_STATUS)) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} เป็นการขายชนิด ${sale.saleType} ซึ่งยังไม่รองรับการยกเลิกที่นี่ — ` +
          'ให้แจ้งผู้ดูแลระบบ',
      );
    }

    // ── ข้อมูลเพี้ยน — CASH/EXTERNAL_FINANCE ไม่ควรมีสัญญาผูก ────────────────
    // เดินต่อ = ทิ้งสัญญาลอยโดยที่ใบขายหายไป จึงต้องหยุดให้คนมาดู
    if (sale.contractId) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} มีสัญญาผูกอยู่ทั้งที่เป็นการขาย` +
          `${sale.saleType === 'CASH' ? 'สด' : 'ผ่านไฟแนนซ์ภายนอก'} — ข้อมูลผิดปกติ ` +
          'ให้แจ้งผู้ดูแลระบบตรวจสอบก่อน (ยกเลิกที่นี่จะทิ้งสัญญาลอย)',
      );
    }

    // ── G6 — ออเดอร์ออนไลน์ ─────────────────────────────────────────────────
    if (sale.onlineOrderId) {
      // ตรวจปลายทางจริงแล้ว (`shop-orders.service.ts`) — ทั้งสองทางที่เคยแนะนำใช้ไม่ได้:
      // `markRefunded` บังคับ `status === 'PAYMENT_RECEIVED_UNFULFILLABLE'` ซึ่งโดยนิยาม
      // แปลว่าไม่มีใบขาย ⇒ ออเดอร์ที่มีใบขาย (ประชากรเดียวที่มาถึงบรรทัดนี้) เข้าเงื่อนไข
      // ไม่ได้ตลอดกาล · `cancelOrder` แตะแค่ `onlineOrder.status` + `productReservation`
      // ไม่แตะ Sale / product.status / JE ⇒ ทำตามแล้วได้สถานะสองฝั่งไม่ตรงกันพอดี
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} มาจากออเดอร์ออนไลน์ — ระบบยังไม่มีเส้นทางยกเลิกที่ล้างทั้ง` +
          'ออเดอร์และใบขายพร้อมกัน (การยกเลิกออเดอร์ที่หน้าออเดอร์ออนไลน์ไม่ล้างใบขาย ' +
          'สถานะสินค้า และรายการบัญชี ส่วนการบันทึกคืนเงินกดได้เฉพาะออเดอร์ที่อยู่ในคิวคืนเงิน) ' +
          '⇒ ให้เจ้าของตรวจก่อน',
      );
    }

    // ── G8 — ใบขายที่แปลงมาจากใบจอง (sibling ของ G6) ─────────────────────────
    // `bookings.service.ts convertToSale` สร้างใบขายสดโดย `downPaymentAmount = มัดจำ`
    // (เงินรับจริงแล้ว) และ flip Booking → `CONVERTED` ซึ่งเป็นสถานะสุดท้าย
    // (`cancel()` รับเฉพาะ PENDING_DEPOSIT/PAID) ⇒ ยกเลิกใบนี้ได้ = ใบจอง CONVERTED ชี้ไป
    // ใบขายที่ยกเลิก + มัดจำคืนผ่านเมนูไหนไม่ได้ + เงินมัดจำหายจากรายงานทั้งที่รับจริง.
    // `Sale` ไม่เก็บ bookingId — FK อยู่ฝั่ง `Booking.convertedToSaleId` (relation SaleBooking)
    const sourceBooking = await tx.booking.findFirst({
      where: { convertedToSaleId: sale.id, deletedAt: null },
      select: { bookingNumber: true, depositAmount: true },
    });
    if (sourceBooking) {
      throw new BadRequestException(
        `ใบขาย ${sale.saleNumber} แปลงมาจากใบจอง ${sourceBooking.bookingNumber} ` +
          `(มัดจำ ${sourceBooking.depositAmount.toFixed(2)} บาท รับจริงแล้ว) — ` +
          'ระบบยังไม่มีเส้นทางยกเลิกที่คืนสถานะใบจอง/มัดจำพร้อมกัน (ใบจองที่แปลงแล้ว ' +
          'ยกเลิกที่เมนูจองไม่ได้ และยกเลิกที่นี่จะทำให้เงินมัดจำหายจากรายงาน) ⇒ ให้เจ้าของตรวจก่อน',
      );
    }

    // สินค้าหลัก + ของแถม — dedupe กันกรณีของแถมซ้ำกับสินค้าหลัก (จะทำให้
    // count check ด้านล่างเข้าใจผิดว่า "หาไม่ครบ")
    const productIds = [...new Set([sale.productId, ...sale.bundleProductIds])];

    // ── G7 — ใบซ่อมที่ยังเปิดอยู่บนเครื่องของใบขายนี้ ─────────────────────────
    // `RepairTicket` ไม่มี `saleId` (ผูกกับ productId/contractId) จึงตรวจผ่าน productId
    const openTicket = await tx.repairTicket.findFirst({
      where: {
        productId: { in: productIds },
        deletedAt: null,
        status: { notIn: [...CLOSED_REPAIR_STATUSES] },
      },
      select: { ticketNumber: true, status: true },
    });
    if (openTicket) {
      throw new BadRequestException(
        `มีใบซ่อม ${openTicket.ticketNumber} (สถานะ ${openTicket.status}) ที่ยังไม่ปิดบนเครื่องของใบขายนี้ — ` +
          'ปิดหรือยกเลิกใบซ่อมที่เมนู "รับซ่อม/รับประกัน" ก่อน แล้วจึงยกเลิกใบขาย ' +
          '(สิทธิ์ประกันอิงใบขาย ยกเลิกก่อนจะทำให้เคลมลอย)',
      );
    }

    // ── G5 — เครื่องทุกชิ้นต้องยังอยู่ในสถานะที่ใบขายนี้ตั้งไว้เอง ──────────────
    // สินค้าหลักกับของแถมใช้คนละสถานะได้ (ดูคอมเมนต์ `BUNDLE_PRODUCT_STATUS`)
    const mainStatus = SALE_TYPE_PRODUCT_STATUS[sale.saleType as 'CASH' | 'EXTERNAL_FINANCE'];
    const expectedStatusOf = (productId: string): ProductStatus =>
      productId === sale.productId ? mainStatus : BUNDLE_PRODUCT_STATUS;
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      // `name` ไม่ใช่ของประดับ: ใบขายที่มีของแถมตรวจหลายเครื่องในรอบเดียว ⇒ ข้อความ
      // ต้องบอกว่า **ชิ้นไหน** ติด (สเปค §2 G5) ไม่ใช่แค่สถานะ
      select: { id: true, name: true, status: true, deletedAt: true },
    });
    // ตรวจจำนวน **ก่อน** วนด่าน: แถวที่หายไปคือแถวที่ไม่มีใครตรวจ ถ้าวนก่อนแล้วค่อยนับ
    // เครื่องที่หายจะผ่านด่านไปเงียบ ๆ แล้วถูกคืนสถานะโดยไม่เคยถูกตรวจ
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        `หาสินค้าของใบขาย ${sale.saleNumber} ไม่ครบ (พบ ${products.length} จาก ${productIds.length} ชิ้น) — ` +
          'ข้อมูลผิดปกติ ให้แจ้งผู้ดูแลระบบตรวจสอบก่อน',
      );
    }
    for (const p of products) {
      // ด่านเดียวกับลบ/แก้ IMEI/ยกเลิกเปลี่ยนเครื่อง — ห้ามเขียนกติกาชุดที่สอง
      await assertProductNotHeld(
        tx,
        { ...p, expectedStatus: expectedStatusOf(p.id) },
        'RESTORE_TO_STOCK',
      );
    }

    // ── G3 — ไฟแนนซ์โอนเงินมาแล้ว ───────────────────────────────────────────
    // ตรวจจากข้อมูลที่มีจริง ไม่ผูกกับ `saleType`: ใบขายสดที่ดันมี FinanceReceivable
    // คือข้อมูลเพี้ยน — ถ้ามีเงินเข้าก็ต้องบล็อกเหมือนกัน ไม่ใช่มองข้ามเพราะผิดชนิด
    const receivable = await tx.financeReceivable.findFirst({
      where: { saleId: sale.id, deletedAt: null },
      select: { id: true, status: true, receivedAmount: true, financeCompany: true },
    });
    if (receivable) {
      const moneyMoved =
        RECEIVED_FINANCE_STATUSES.includes(receivable.status) ||
        (!!receivable.receivedAmount && receivable.receivedAmount.greaterThan(0));
      if (moneyMoved) {
        throw new BadRequestException(
          `ไฟแนนซ์ ${receivable.financeCompany} โอนเงินของใบขายนี้มาแล้ว (สถานะ ${receivable.status}) — ` +
            'ต้องบันทึกคืนเงิน/ปรับรายการรับจากไฟแนนซ์ที่หน้าติดตามเงินรับจากไฟแนนซ์ ' +
            '(/finance-receivable) ให้เรียบร้อยก่อน จึงจะยกเลิกใบขายได้ ' +
            '(หน้านั้น ผจก.สาขาเปิดดูได้แต่แก้ไม่ได้ — การบันทึกรับเงิน/แก้ไขเป็นสิทธิ์ของ ' +
            'เจ้าของ/ผจก.การเงิน/ฝ่ายบัญชี)',
        );
      }
    }

    // ── G4 — ค่าคอมของใบขายนี้ (ตาราง `G4_COMMISSION_ACTION`) ─────────────────
    // อ่านครั้งเดียวใช้สองงาน: ตัดสิน G4 และเก็บแถวที่จะเรียกคืนในขั้นเขียน (พร้อมยอดเงินที่ตัวช่วยต้องใช้)
    const commissions = await tx.salesCommission.findMany({
      where: { saleId: sale.id, deletedAt: null },
      select: {
        id: true,
        status: true,
        period: true,
        salespersonId: true,
        createdAt: true,
        commissionAmount: true,
        paidAt: true,
        paidAmount: true,
      },
    });
    const unknownCommission = commissions.find(
      (c) => !Object.prototype.hasOwnProperty.call(G4_COMMISSION_ACTION, c.status),
    );
    if (unknownCommission) {
      throw new BadRequestException(
        `ค่าคอมของใบขายนี้อยู่สถานะ ${unknownCommission.status} (งวด ${unknownCommission.period}) ` +
          'ซึ่งระบบยังไม่รองรับการยกเลิกที่นี่ — ให้แจ้งผู้ดูแลระบบ',
      );
    }
    const commissionsToClawBack = commissions.filter(
      (c) => G4_COMMISSION_ACTION[c.status] === 'CLAW_BACK',
    );

    // ── G4b — รอบจ่ายค่าคอมที่ผูกเงินไว้แล้ว ────────────────────────────────
    // `markPayoutPaid` อัปเดต **เฉพาะแถว `CommissionPayout`** ไม่แตะ `SalesCommission.status`
    // ⇒ ด่านสถานะค่าคอมอย่างเดียวปิดประตูเงินได้แค่บานเดียว: ขายสด → ค่าคอม PENDING →
    // generate + approve + paid ที่รอบจ่ายเดิม (พนักงานได้เงินจริง) → ค่าคอมยัง PENDING ไม่มี paidAt
    // ⇒ ตัวช่วยเรียกคืนเห็นเป็น "ยังไม่จ่าย" ไม่มีอะไรให้ใบเงินเดือนหักคืน. รอบจ่ายเดิมยังอยู่ในฐานได้
    // (สร้าง/บันทึกจ่ายรอบตอบ 410 แล้ว แต่อนุมัติรอบยังเปิด) จึงยังต้องบล็อก. รอบจ่ายผูกกับคู่
    // (salespersonId, period) ไม่ใช่ saleId จึงต้องค้นด้วยคู่นั้นของค่าคอมที่จะเรียกคืน
    let draftPayoutsToVoid: { id: string; period: string; salespersonId: string }[] = [];
    if (commissionsToClawBack.length > 0) {
      const payouts = await tx.commissionPayout.findMany({
        where: {
          deletedAt: null,
          OR: commissionsToClawBack.map((c) => ({ salespersonId: c.salespersonId, period: c.period })),
        },
        select: {
          id: true,
          period: true,
          status: true,
          salespersonId: true,
          generatedAt: true,
        },
      });

      // รอบที่ "ครอบค่าคอมใบนี้จริง" เท่านั้นที่เกี่ยว — `generatePayouts` ไม่คำนวณรอบที่
      // สร้างไปแล้วใหม่ ⇒ ค่าคอมที่เกิด **หลัง** กดสร้างรอบไม่เคยอยู่ในยอดของรอบนั้น
      // (เคสจริง: สร้างรอบ 20 ส.ค. → คีย์ใบขายผิด 21 ส.ค. → ต้องยกเลิกได้)
      // `generatedAt = null` = รอบยุคก่อนมีคอลัมน์ ⇒ พิสูจน์ไม่ได้ = ถือว่าครอบไว้ก่อน (กติกาเดียว `isCoveredByPayout`)
      const covering = payouts.filter((p) =>
        commissionsToClawBack.some((c) => isCoveredByPayout(c, p)),
      );

      const lockedPayout = covering.find(isLockedPayout);
      if (lockedPayout) {
        throw new BadRequestException(
          `ค่าคอมของใบขายนี้ถูกนับอยู่ในรอบจ่ายค่าคอมงวด ${lockedPayout.period} ` +
            // D4 ส่วนที่ 2 (P2-R26): รอบจ่ายแบบเดิมจ่ายไม่ได้แล้ว (markPayoutPaid = 410) — ห้ามเขียนว่า "รอจ่าย"
            `ซึ่ง${lockedPayout.status === PayoutStatus.PAID ? 'จ่ายเงินไปแล้ว' : 'อนุมัติไว้แล้ว (รอบจ่ายแบบเดิม — ระบบไม่จ่ายรอบนี้แล้ว ค่าคอมจ่ายผ่านใบเงินเดือนเท่านั้น)'} — ` +
            'ยกเลิกใบขายไม่ได้ เพราะระบบไม่คำนวณยอดของรอบที่สร้างไปแล้วใหม่ ' +
            'และยังไม่มีเมนูยกเลิก/แก้ไขรอบจ่าย ⇒ ให้เจ้าของ/ผจก.การเงินตัดสินใจก่อน ' +
            '(ถ้ารอบนั้นจ่ายไปแล้ว = ต้องเรียกคืนจากพนักงาน)',
        );
      }

      // ร่างที่ครอบใบนี้ → ลบทิ้งในขั้นเขียน (ไม่บล็อก ตามคำตัดสินเจ้าของ)
      draftPayoutsToVoid = covering
        .filter((p) => p.status === PayoutStatus.DRAFT)
        .map((p) => ({ id: p.id, period: p.period, salespersonId: p.salespersonId }));
    }

    const clawbackIds = commissionsToClawBack.map((c) => c.id);

    // ── G2 — งวดบัญชีของวันที่จะโพสต์กลับรายการ (เฉพาะใบที่มี JE) ─────────────
    const saleJes = await tx.journalEntry.findMany({
      where: {
        metadata: { path: ['saleId'], equals: sale.id } as Prisma.JsonFilter,
        status: 'POSTED',
        deletedAt: null,
      },
      select: { id: true, companyId: true },
    });
    const now = new Date();
    // mirror ลงวันที่ **วันที่ยกเลิก** — `JournalAutoService.createAndPost` ตั้ง
    // `entryDate = postedAt = new Date()` เมื่อไม่ส่ง override ⇒ งวดที่ต้องตรวจคือ
    // งวดของ `now` ไม่ใช่งวดของ JE ต้นทาง
    //
    // หมายเหตุตามความจริง: เพราะวันที่โพสต์เป็น "วันนี้" เสมอ ด่านนี้จะทำงานจริงเฉพาะ
    // ปลายหน้าต่าง grace ของงวดปัจจุบัน (`period_grace_days` — ดู period-lock.util)
    // ส่วนใหญ่จึงเป็น no-op โดยธรรมชาติ — เก็บไว้เป็นด่านกันพลาดตามสเปค ไม่ใช่โค้ดตาย
    for (const companyId of [...new Set(saleJes.map((j) => j.companyId))]) {
      await validatePeriodOpen(tx, now, companyId);
    }

    // ══ ผ่านด่านครบแล้ว — เริ่มเขียน ═══════════════════════════════════════════

    // 1. คืนเครื่องหลัก + ของแถมเข้าสต็อก (ตอนขายบังคับว่าต้องเป็น IN_STOCK มาก่อน
    //    ⇒ คืนที่เดิมถูกต้องตามนิยาม ไม่ต้องยืนยันราคาใหม่)
    //
    //    **จงใจไม่ผ่าน `product-enter-stock.util`** (ประตูที่บังคับยืนยันราคา) — คลาสยกเว้น
    //    เดียวกับเส้นทางยกเลิกสัญญา/ยกเลิกเปลี่ยนเครื่อง: เครื่องกลับมาพร้อมราคาของตัวเอง
    //    ที่ไม่มี flow ไหนแตะระหว่างขาย ต่างจากเครื่องมือสองที่รับคืนแล้วถือราคาเครื่องใหม่
    //    ติดมา (สเปค §3 ข้อ 1 อนุญาตชัดเจน)
    //
    //    **ข้อจำกัดที่ยอมรับ (สเปค §1):** คิวจองบนเว็บที่ `preemptReservationsInTx` ตัดทิ้ง
    //    ตอนขาย **ไม่ถูกคืน** — ลูกค้าที่ถูกตัดคิวอาจไปซื้อที่อื่น/ได้รับแจ้งไปแล้ว คืนคิวให้
    //    เป็นการสัญญาสิ่งที่รักษาไม่ได้ ⇒ ไม่ใช่บั๊ก
    await tx.product.updateMany({
      where: { id: { in: productIds } },
      data: { status: ProductStatus.IN_STOCK },
    });
    // เครื่องยึดที่ขายผ่าน POS แล้ว void → เปิดรายการยึดกลับเป็น "พร้อมขาย" (คู่ของ
    // closeRepossessionOnSale ใน repossession-resale.util — 2026-09-05). คงราคาขายเดิมไว้เป็นราคาตั้ง.
    await reopenRepossessionOnUnsale(tx, productIds);

    // 2. กลับรายการ JE ทุกใบที่ `metadata.saleId = <saleId>` (ขายสดเท่านั้นที่มี JE)
    let reversalEntryNumbers: string[] = [];
    if (saleJes.length > 0) {
      const { reversalJeIds } = await this.reversalTemplate.reverse(
        {
          // กวาดด้วย metadata ล้วน — `jeIds` ว่างเพราะใบขายไม่ได้เก็บรายการ JE ไว้บนแถว
          jeIds: [],
          sweepBy: { path: 'saleId', value: sale.id },
          flowLabel: 'shop-cash-sale-void',
          descriptionPrefix: '[ยกเลิกใบขาย]',
        },
        tx,
      );
      if (reversalJeIds.length > 0) {
        const created = await tx.journalEntry.findMany({
          where: { id: { in: reversalJeIds } },
          select: { entryNumber: true },
        });
        reversalEntryNumbers = created.map((c) => c.entryNumber);
      }
    }

    await new TradeInCreditService(this.prisma).release(tx, sale.tradeInCreditSnapshot, { saleId: sale.id }, user.id, reason);
    // สมุดเงินหน้าร้าน: คืนเงินตามวิธีที่รับมา — แถว OUT คู่กับแถว IN ของใบขาย (ผู้จ่าย = ผู้กดยกเลิก).
    // JE แยกยอดของบิลจ่ายผสม stamp `metadata.saleId` ไว้ ⇒ sweep ข้างบน mirror ให้แล้ว ไม่ต้องกลับรายการซ้ำ.
    // ใบขายก่อนมีสมุดนี้ไม่มีแถว IN ⇒ ไม่เขียนอะไร.
    await new ShopTenderRecorder(this.prisma).recordRefund(tx, { doc: { saleId: sale.id },
      kinds: ['CASH_SALE', 'EXTERNAL_FINANCE_DOWN'], actorId: user.id, reverseSplitJe: false, occurredAt: now });

    // 3. FinanceReceivable → soft delete (G3 การันตีแล้วว่ายังไม่มีเงินเข้า)
    if (receivable) {
      await tx.financeReceivable.updateMany({
        where: { saleId: sale.id, deletedAt: null },
        data: { deletedAt: now },
      });
    }

    // 4. ค่าคอม → CLAWED_BACK 100% ผ่านตัวช่วยเดียว (เขียนทีละแถวแบบมีเงื่อนไข (id, status) — สถานะเปลี่ยน
    //    ระหว่างทาง เช่นใบเงินเดือนลงบัญชีพร้อมกัน = 409 ทั้งใบ). ที่จ่ายแล้ว = clawbackAmount = paidAmount ⇒
    //    ใบเงินเดือนงวดถัดไปหักคืน. ขายผ่านไฟแนนซ์ภายนอกไม่สร้างค่าคอมตั้งแต่แรก ⇒ ไม่มีแถว
    const commissionClawback = await clawBackCommissions(tx, commissionsToClawBack, {
      reason: `ยกเลิกใบขาย ${sale.saleNumber}: ${reason}`,
      now,
    });
    const paidCommissionClawback = commissionClawback.paidTotal.toFixed(2);

    // 4b. ร่างรอบจ่ายค่าคอมที่ครอบใบนี้ → soft-delete (ยอดในร่างรวมค่าคอมที่เพิ่งถูก
    //     เรียกคืนไปแล้ว และยอดของร่างไม่ถูกคำนวณใหม่ ⇒ ปล่อยไว้ = ยอดเกินจริง
    //     — สร้างรอบจ่ายใหม่ตอบ 410 แล้ว ค่าคอมที่เหลือเข้าใบเงินเดือน (D4 ส่วนที่ 2))
    if (draftPayoutsToVoid.length > 0) {
      await tx.commissionPayout.updateMany({
        where: { id: { in: draftPayoutsToVoid.map((p) => p.id) } },
        data: { deletedAt: now },
      });
      for (const p of draftPayoutsToVoid) {
        await tx.auditLog.create({
          data: {
            action: 'COMMISSION_PAYOUT_DRAFT_VOIDED',
            entity: 'commission_payout',
            entityId: p.id,
            userId: user.id,
            newValue: {
              period: p.period,
              salespersonId: p.salespersonId,
              saleId: sale.id,
              saleNumber: sale.saleNumber,
              reason: `ลบร่างรอบจ่ายเพราะยกเลิกใบขาย ${sale.saleNumber}`,
            },
          },
        });
      }
    }

    // 5. ใบขาย → ยกเลิก (เวลาที่ยกเลิก = `deletedAt` ⇒ ผู้อ่านที่กรอง deletedAt
    //    อยู่แล้วหักใบนี้ออกเองโดยไม่ต้องเดินแก้ทีละจุด)
    //
    //    **จงใจไม่ล้าง `shopWarrantyStartDate`/`shopWarrantyEndDate`** — ผู้อ่านประกัน
    //    ทุกตัวกรอง `deletedAt: null` อยู่แล้ว (repair-warranty.service ทั้งเส้น IMEI และ
    //    เส้นค้นด้วยลูกค้า) ⇒ ประกันของใบที่ยกเลิกไม่มีทางโผล่ ส่วนตัวเลขที่ค้างไว้คือ
    //    หลักฐานว่าเคยให้ประกันอะไรลูกค้าไว้ ล้างทิ้ง = ทำลายหลักฐานโดยไม่ได้อะไรเพิ่ม
    await tx.sale.update({
      where: { id: sale.id },
      data: { deletedAt: now, voidReason: reason, voidedById: user.id },
    });

    // 6. Audit — `tx.auditLog.create` ในทรานแซกชันเดียวกัน **ห้ามเรียก
    //    `AuditService.log`** (เปิด root `$transaction` ซ้อน → P2028 ถูกกลืน →
    //    audit หายเงียบ; Phase 5 พิสูจน์แล้วว่าเกิดจริง 100%)
    await tx.auditLog.create({
      data: {
        action: 'SALE_VOIDED',
        entity: 'sale',
        entityId: sale.id,
        userId: user.id,
        newValue: {
          saleNumber: sale.saleNumber,
          saleType: sale.saleType,
          netAmount: sale.netAmount.toString(),
          reason,
          restoredProductIds: productIds,
          reversalEntryNumbers,
          commissionIds: clawbackIds,
          // ค่าคอมที่จ่ายแล้วและถูกเรียกคืน (ใบเงินเดือนงวดถัดไปหัก) + ยอดต่อแถว (P2-R9)
          paidCommissionIds: commissionClawback.paidIds,
          paidCommissionClawback,
          commissionClawbacks: commissionsToClawBack.map((c) => ({
            id: c.id,
            statusBefore: c.status,
            paid: c.paidAt !== null,
            clawbackAmount: clawbackAmountOf(c, 100)?.toFixed(2) ?? null,
          })),
          financeReceivableId: receivable?.id ?? null,
          voidedDraftPayoutIds: draftPayoutsToVoid.map((p) => p.id),
        },
      },
    });

    this.logger.log(
      `[sale-void] ${sale.saleNumber} ยกเลิกแล้ว — คืนเครื่อง ${productIds.length} ชิ้น, ` +
        `กลับรายการ ${reversalEntryNumbers.length} ใบ, เรียกคืนค่าคอม ${clawbackIds.length} รายการ`,
    );

    return {
      saleNumber: sale.saleNumber,
      restoredProductIds: productIds,
      reversalEntryNumbers,
      paidCommissionClawback,
    };
  }
}
