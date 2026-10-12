import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AfterSalesStage, WarrantyStatus } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import {
  CreateRepairTicketDto,
  RepairPayerInput,
} from '../../repair-tickets/dto/create-repair-ticket.dto';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { ContractExchangeService } from '../../contract-exchange/contract-exchange.service';
import { deviceSwapClosed } from '../../contract-exchange/device-swap-closed.policy';
import { ExchangeCancelService } from '../../contract-exchange/contract-exchange-cancel.service';
import { AfterSalesQueryService } from './after-sales-query.service';
import { AfterSalesLookupService } from './after-sales-lookup.service';
import { AfterSalesLineService } from './after-sales-line.service';
import { reconcileStage, ReconcilableCase, RECONCILE_SELECT } from './after-sales-stage-reconcile';
import {
  payerDefaultFor,
  SWITCHED_TO_REPAIR_NOTE,
  WINDOW_REASON_RE,
} from '../utils/after-sales-outcomes.util';
import { ExchangeConfirmDto } from '../dto/exchange-confirm.dto';
import { ExchangeRejectDto } from '../dto/exchange-reject.dto';
import { SwitchToRepairDto } from '../dto/switch-to-repair.dto';
import { ApproveExchangeRequestDto } from '../dto/exchange-approve.dto';
import { ReplacementProductsDto } from '../dto/replacement-products.dto';
import { ShopCashExchangeTemplate } from '../../journal/cpa-templates/shop-cash-exchange.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { validatePeriodOpen } from '../../../utils/period-lock.util';
import { preemptReservationsInTx } from '../../../utils/reservation-preempt.util';
import { canSeeCost } from '../../products/cost-visibility.util';
import { mainProductStatusFor } from '../../sales/services/sale-product-status.util';
import { shopWarrantyDatesFor } from '../../sales/services/sale-shop-warranty.util';
import { saleSoldAt } from '../../repair-tickets/utils/sale-sold-at';
import { assertCashReplacement } from '../utils/assert-cash-replacement';
import { cashExchangeWindowOpen } from '../utils/cash-exchange-window';
import { CASH_OUT_OF_WINDOW_REASON } from '../utils/after-sales-outcomes.util';
import { ExchangeDeliverDto, deliveredAccessoriesText } from '../dto/exchange-deliver.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

/** M4 — stage ของเคส REPAIR ที่ยืนยันเปลี่ยนรุ่นเดิม (ซ่อมไม่ได้) ได้ — ตรงกับ markReplaced ของ engine */
const REPAIR_CONFIRM_STAGES: AfterSalesStage[] = ['RECEIVED', 'IN_REPAIR', 'READY_FOR_PICKUP'];

/** M4 — CAS ร่วมของ rejectSameModel/switchToRepair: ยังรออนุมัติจริง ยังไม่มีใครจอง/ยืนยัน/ยกเลิก */
const SAME_MODEL_PENDING_CAS = (id: string): Prisma.AfterSalesCaseWhereInput => ({
  id,
  deletedAt: null,
  outcome: { in: ['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'] }, // PR 5 — ปฏิเสธ/เปลี่ยนเป็นซ่อม ใช้กับเคสขายสดด้วย
  stage: 'AWAITING_APPROVAL',
  replacementContractId: null,
  replacementSaleId: null,
  approvedAt: null,
  cancelledAt: null,
});

/** PR 5 — ผลของ runCashConfirm ที่ confirmCashSameModel ใช้เขียน audit/คืนค่าหลัง commit */
interface CashConfirmPosted {
  saleNumber: string;
  oldProductId: string;
  oldCost: string;
  newCost: string;
  journalEntryNo: string | null;
  repairTicketId: string | null;
}

/** Task 6 — `preview()` เป็น proxy บาง ๆ เหนือ `ContractExchangeService.buildPreview`; ไม่มี DTO
 * ของตัวเอง (ตาม Interfaces ของบรีฟ) เพราะ Task 8 (controller) เป็นผู้ประกอบ query object นี้เอง */
interface PreviewQuery {
  imei: string;
  replacementProductId?: string;
  buybackPrice?: string;
  deviceCondition?: string;
  newTotalMonths?: number;
  newInterestRate?: string;
}

/**
 * ก้อนที่ `AfterSalesQueryService.getCase()` คืนมา — ไม่มี interface กลางที่ export ไว้ (return type
 * ของมันถูกอนุมานจากโค้ดจริง) แต่ `getCase()` โหลดแถวผ่าน Prisma `include` บน full model เสมอ ⇒
 * ฟิลด์สเกลาร์ทุกตัวของ `AfterSalesCase` (รวม `contractId`/`outcome`/`stage`/`symptom`/
 * `replacementProductId`/`replacementContractId`/`customerId`/`productId`/`branchId`/`deviceBrand`/
 * `deviceModel`/`deviceImei`/`deviceSerial`/`warrantySnapshot`/`repairTicketId`) และ `repairTicket`
 * (full row รวม `id`) มีอยู่ในก้อนนี้เสมอไม่ว่า `getCase()` จะแก้ selection เพิ่มยังไงในอนาคต — ใช้
 * `Awaited<ReturnType<...>>` แทนการเขียน interface มือเพื่อไม่ให้หลุดตามหลังของจริง
 */
type ExchangeCase = Awaited<ReturnType<AfterSalesQueryService['getCase']>>;

@Injectable()
export class AfterSalesExchangeService {
  private readonly logger = new Logger(AfterSalesExchangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly query: AfterSalesQueryService,
    private readonly defect: DefectExchangeService,
    private readonly repair: RepairTicketsService,
    private readonly audit: AuditService,
    private readonly contractExchange: ContractExchangeService,
    private readonly exchangeCancel: ExchangeCancelService,
    private readonly lookup: AfterSalesLookupService,
    private readonly line: AfterSalesLineService,
    private readonly cashExchange: ShopCashExchangeTemplate,
    private readonly shopAccounts: ShopAccountResolver,
    private readonly companyResolver: CompanyResolverService,
  ) {}

  private assertMgr(user: ReqUser) {
    if (!['OWNER', 'BRANCH_MANAGER'].includes(user.role)) {
      throw new ForbiddenException('เฉพาะ ผจก.สาขา หรือเจ้าของ');
    }
  }

  /** Task 6 — เฉพาะ rejectPriced (ปฏิเสธคำขอมีราคา) ต้อง OWNER เท่านั้น ต่างจาก assertMgr ทั่วไป */
  private assertOwner(user: ReqUser) {
    if (user.role !== 'OWNER') {
      throw new ForbiddenException('เฉพาะเจ้าของ');
    }
  }

  /** Task 6 — preview เปิดให้ STAFF (OWNER/BM/SALES) เท่านั้น ตาม Interfaces ของบรีฟ */

  /**
   * Task 6 — ด่านร่วมของ approvePriced/rejectPriced/cancelSwap: เคสต้องเป็นทางออกมีราคา,
   * มีคำขอผูกอยู่จริง (`exchangeRequestId`), และยังไม่จบ (ไม่ CLOSED/CANCELLED) คืนค่า
   * `exchangeRequestId` แบบ narrow แล้ว (ผ่านด่าน `!c.exchangeRequestId` มาแล้วจึงไม่เป็น null)
   * ให้ผู้เรียกส่งต่อ engine ได้ตรง ๆ โดยไม่ต้อง non-null assert ซ้ำ
   */
  private assertPricedCase(c: ExchangeCase, opts: { allowClosedApproved?: boolean } = {}): string {
    if (c.outcome !== 'PRICED_EXCHANGE') {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนเครื่องแบบมีราคา');
    }
    if (!c.exchangeRequestId) {
      throw new BadRequestException('เคสนี้ไม่มีคำขอเปลี่ยนเครื่อง');
    }
    // I3 — ยกเลิก swap ที่ลงผลแล้ว (MEMO applied / สัญญาใหม่เปิดใช้แล้ว → เคส CLOSED) ยังต้องทำได้
    // ตามสิทธิ์เดิมของหน้าคำขอเปลี่ยนเครื่องเก่า — เฉพาะเมื่อคำขอยัง APPROVED (engine ตัดสินต่อว่ามีการ
    // ชำระเงินแล้วหรือยัง) · เคส CANCELLED ปฏิเสธเสมอ
    const closedButCancellable =
      opts.allowClosedApproved && c.stage === 'CLOSED' && c.exchangeRequest?.status === 'APPROVED';
    if (['CLOSED', 'CANCELLED'].includes(c.stage) && !closedButCancellable) {
      throw new BadRequestException('เคสนี้จบแล้ว');
    }
    return c.exchangeRequestId;
  }

  /**
   * Task 6 — โหลดเคสด้วย select ของ `ReconcilableCase` แล้ว `reconcileStage` (self-healing,
   * ไม่ throw, ไม่เขียน audit —ดู jsdoc ของ `reconcileStage`) ใช้ร่วมกันทั้งสามเมธอด proxy
   * ของคำขอมีราคาหลัง engine call สำเร็จ เพื่อให้ `AfterSalesCase.stage` ตามผลของ engine ทัน
   * ก่อนจะเขียน event/approvedBy ต่อ
   */
  private async reconcile(caseId: string): Promise<ReconcilableCase> {
    const row = await this.prisma.afterSalesCase.findFirstOrThrow({
      where: { id: caseId, deletedAt: null },
      select: RECONCILE_SELECT,
    });
    return reconcileStage(this.prisma, row);
  }

  /**
   * ยืนยันเปลี่ยนรุ่นเดิม — ครอบทั้งเคส SAME_MODEL_EXCHANGE ปกติ (replacementProductId มาจากตอนแจ้ง
   * ปัญหาแล้ว) และเคส REPAIR ที่ซ่อมไม่ได้แล้วเปลี่ยนมาเป็นเปลี่ยนรุ่นเดิม (ต้องส่ง
   * dto.replacementProductId มาด้วยเพราะยังไม่เคยเลือกไว้). ต้นทาง bypass (นอกกรอบ 7 วัน) ส่ง
   * `originAfterSalesCaseId` เสมอ + `originRepairTicketId` เมื่อเคสมาจากใบซ่อม — engine ฝั่ง
   * defect-exchange เป็นผู้ตัดสินว่าต้องข้ามกรอบจริงไหมผ่าน `checkEligibility` ที่เราเรียกก่อนเอง
   */
  async confirmSameModel(caseId: string, dto: ExchangeConfirmDto, user: ReqUser) {
    this.assertMgr(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    // PR 5 — เคสขายสด/ไฟแนนซ์นอก (มี saleId ไม่มี contractId) เดินกิ่งของตัวเอง ไม่ผ่าน engine สัญญาผ่อน
    if (c.saleId && !c.contractId) return this.confirmCashSameModel(c, dto, user);
    if (!c.contractId) throw new BadRequestException('เปลี่ยนรุ่นเดิมใช้ได้กับสัญญาผ่อนเท่านั้น');
    const fromRepair = c.outcome === 'REPAIR';
    if (!fromRepair && c.outcome !== 'SAME_MODEL_EXCHANGE') {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    }
    if (['CLOSED', 'CANCELLED'].includes(c.stage)) throw new BadRequestException('เคสนี้จบแล้ว');
    if (c.replacementContractId) throw new ConflictException('ยืนยันไปแล้ว');
    const newProductId = fromRepair ? dto.replacementProductId : c.replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');

    const elig = await this.defect.checkEligibility(c.contractId, newProductId);
    // I1 (final fix wave) — bypassWindowCheck ทำให้ engine ข้าม checkEligibility ทั้งก้อน (ทั้งกติกา
    // PHONE_USED · สถานะสัญญา · เครดิตเทิร์น · เครื่องใหม่) แต่ ผจก. ข้ามได้ "เฉพาะกรอบ 7 วัน"
    // (spec §4.3) ⇒ ทุกเหตุผลที่ไม่ใช่กรอบ 7 วันต้องบล็อกที่นี่ก่อนเสมอ ทั้งเคสปกติและ fromRepair
    const blocking = elig.reasons.filter((r) => !WINDOW_REASON_RE.test(r));
    if (!elig.newProduct || blocking.length) {
      throw new BadRequestException(blocking[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย');
    }

    // P-H.1: "นอกกรอบ 7 วัน" (outOfWindow) กับ "มาจากใบซ่อม" (fromRepair) เป็นคนละแนวคิด —
    // เคส REPAIR ที่ยืนยันขณะยังอยู่ในกรอบก็ยังต้อง bypassWindowCheck=true
    // เพราะ defect-exchange.service.ts เช็ค repair-ticket status + เรียก markReplaced เฉพาะกิ่ง
    // `if (dto.bypassWindowCheck && dto.originRepairTicketId)` เท่านั้น — ถ้าไม่ bypass ใบซ่อมจะไม่ถูก
    // ปิด/ผูกสัญญาใหม่เลย (แม้ execute() จะสำเร็จ). ข้อความ "ข้ามกรอบ 7 วัน" ต้องขึ้นเฉพาะตอน
    // outOfWindow จริง ๆ (มีเหตุผลกรอบ 7 วัน — I1: ไม่ใช่ `!elig.eligible` ซึ่งจริงกับทุกเหตุผล)
    const outOfWindow = elig.reasons.some((r) => WINDOW_REASON_RE.test(r));
    const bypass = outOfWindow || fromRepair;

    // M4 (ปิด ruling P-I) — จองเคสก่อนเรียก engine: CAS บนแถวเคส (stage ที่ยืนยันได้ + ยังไม่มีสัญญาใหม่
    // + ยังไม่ยกเลิก + ยังไม่มีใครจอง) — สองคน/สองแท็บกดพร้อมกัน คนที่สองได้ 409 แทนการ execute ซ้ำ
    const claimedAt = new Date();
    const claim = await this.prisma.afterSalesCase.updateMany({
      where: {
        id: caseId,
        deletedAt: null,
        stage: { in: fromRepair ? REPAIR_CONFIRM_STAGES : ['AWAITING_APPROVAL'] },
        replacementContractId: null,
        cancelledAt: null,
        approvedAt: null,
      },
      data: { approvedAt: claimedAt, approvedById: user.id },
    });
    if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');

    let res: Awaited<ReturnType<DefectExchangeService['execute']>>;
    try {
      res = await this.defect.execute(
        {
          oldContractId: c.contractId,
          newProductId,
          defectReason: c.symptom,
          notes: dto.note,
          bypassWindowCheck: bypass || undefined,
          originRepairTicketId: fromRepair ? c.repairTicket?.id : undefined,
          originAfterSalesCaseId: c.id,
        },
        user,
      );
    } catch (err) {
      // engine ล้ม (rollback ทั้งก้อนแล้ว) → ปล่อยการจองคืน ให้ยืนยันใหม่ได้
      await this.prisma.afterSalesCase
        .updateMany({
          where: { id: caseId, approvedAt: claimedAt, replacementContractId: null },
          data: { approvedAt: null, approvedById: null },
        })
        .catch((releaseErr: unknown) => {
          // ไม่กลืนเงียบ — เคสจะค้างสถานะ "จองแล้ว" (ทางออก: ยกเลิกเคส M1 ซึ่งไม่ล็อก approvedAt)
          this.logger.error(
            `ปล่อยการจองยืนยันเปลี่ยนเครื่องไม่สำเร็จ caseId=${caseId}: ${
              releaseErr instanceof Error ? releaseErr.message : String(releaseErr)
            }`,
            releaseErr instanceof Error ? releaseErr.stack : undefined,
          );
        });
      throw err;
    }
    const newContract = res.newContract;

    await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        outcome: 'SAME_MODEL_EXCHANGE',
        replacementProductId: newProductId,
        replacementContractId: newContract.id,
        approvedById: user.id,
        approvedAt: claimedAt,
        stage: 'READY_FOR_PICKUP',
        events: {
          create: {
            kind: 'APPROVED',
            actorId: user.id,
            note: `ยืนยันเปลี่ยนเครื่อง · สัญญาใหม่ ${newContract.contractNumber}${
              outOfWindow ? ' · ข้ามกรอบ 7 วัน' : ''
            }${fromRepair ? ' · จากใบซ่อม (ซ่อมไม่ได้)' : ''}`,
          },
        },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_CONFIRMED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { newContractId: newContract.id, bypass: outOfWindow, fromRepair },
    });

    // Task 3 — จังหวะ 2 (READY): หลัง commit + audit เสมอ — fire-and-forget
    void this.line.notifyMoment(caseId, 'READY', user.id).catch(() => undefined);

    return {
      id: caseId,
      stage: 'READY_FOR_PICKUP' as const,
      replacementContractId: newContract.id,
      contractNumber: newContract.contractNumber,
    };
  }

  /**
   * ส่งมอบเครื่องใหม่ให้ลูกค้า — ต้องเปิดใช้สัญญาใหม่ (พ้นสถานะ DRAFT) ที่หน้าสัญญาก่อนเสมอ
   * ไม่งั้นลูกค้าจะถือเครื่องที่ยังไม่มีสัญญาผูกจริง (โครงสร้างเดียวกับสัญญาใหม่ทั่วไปที่ต้องเปิดใช้
   * ก่อนจึงนับว่าขายจริง)
   */
  /**
   * M1 (final review PR5) — ปิดเคสตอนส่งมอบแบบ compare-and-set: updateMany where stage READY_FOR_PICKUP
   * + closedAt null · count 0 = ถูกส่งมอบไปแล้ว (กดซ้อน) → 409 ทั้งธุรกรรมย้อนกลับ · events เขียนแยกผ่าน
   * createMany ใน tx เดียวกัน (nested create ของ update ใช้กับ updateMany ไม่ได้) · ใช้ร่วมทั้งกิ่งผ่อนและขายสด
   */
  private async closeDeliveredCase(
    tx: Prisma.TransactionClient,
    caseId: string,
    actorId: string,
    events: { kind: 'DELIVERED' | 'CLOSED'; note: string }[],
  ) {
    const claimed = await tx.afterSalesCase.updateMany({
      where: { id: caseId, stage: 'READY_FOR_PICKUP', closedAt: null },
      data: { stage: 'CLOSED', closedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictException('เคสนี้ถูกส่งมอบไปแล้ว');
    await tx.afterSalesEvent.createMany({
      data: events.map((e) => ({ caseId, kind: e.kind, actorId, note: e.note })),
    });
    return tx.afterSalesCase.findUniqueOrThrow({ where: { id: caseId } });
  }

  async deliver(caseId: string, user: ReqUser, dto?: ExchangeDeliverDto) {
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (c.outcome === 'CASH_SAME_MODEL_EXCHANGE') return this.deliverCash(c, dto ?? {}, user);
    if (c.outcome !== 'SAME_MODEL_EXCHANGE' || !c.replacementContractId) {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    }
    if (c.stage !== 'READY_FOR_PICKUP') {
      throw new BadRequestException('เคสนี้ยังไม่พร้อมส่งมอบ');
    }

    const newContract = await this.prisma.contract.findUnique({
      where: { id: c.replacementContractId, deletedAt: null },
      select: { status: true, contractNumber: true },
    });
    if (!newContract) throw new NotFoundException('ไม่พบสัญญาใหม่');
    if (newContract.status === 'DRAFT') {
      throw new BadRequestException(
        `ต้องเปิดใช้สัญญาใหม่ ${newContract.contractNumber} ที่หน้าสัญญาก่อนส่งมอบ`,
      );
    }

    // M1 (final review PR5) — กดซ้อน/ดับเบิลคลิกต้องไม่ได้ event DELIVERED+CLOSED/LINE สองชุด:
    // CAS บน stage READY_FOR_PICKUP + closedAt null (updateMany count 0 = คนอื่นส่งมอบไปแล้ว → 409)
    // แล้วค่อยเขียน events ใน tx เดียวกัน
    const updated = await this.prisma.$transaction(async (tx) =>
      this.closeDeliveredCase(tx, caseId, user.id, [
        {
          kind: 'DELIVERED',
          note: `ส่งมอบเครื่องใหม่ · สัญญา ${newContract.contractNumber}`,
        },
        { kind: 'CLOSED', note: 'ปิดเคส' },
      ]),
    );

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_DELIVERED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { replacementContractId: c.replacementContractId },
    });

    // Task 3 — จังหวะ 3 (CLOSED): หลัง commit + audit เสมอ — fire-and-forget
    void this.line.notifyMoment(caseId, 'CLOSED', user.id).catch(() => undefined);

    return updated;
  }

  /** PR 5 §5 — ยืนยันเปลี่ยนรุ่นเดิมบนใบขายสด/ไฟแนนซ์นอก (ทาง ก: สลับเครื่องบนใบขายเดิม + JE สลับต้นทุน) */
  private async confirmCashSameModel(c: ExchangeCase, dto: ExchangeConfirmDto, user: ReqUser) {
    const fromRepair = c.outcome === 'REPAIR';
    if (!fromRepair && c.outcome !== 'CASH_SAME_MODEL_EXCHANGE') {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    }
    if (['CLOSED', 'CANCELLED'].includes(c.stage)) throw new BadRequestException('เคสนี้จบแล้ว');
    if (c.replacementSaleId) throw new ConflictException('ยืนยันไปแล้ว');
    const newProductId = fromRepair ? dto.replacementProductId : c.replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    const saleId = c.saleId!;

    // CAS จองเคส (pattern M4) — ไม่มี engine ภายนอก แต่ยังต้องกันสองแท็บยืนยันซ้อนก่อนเปิด tx
    const claimedAt = new Date();
    const claim = await this.prisma.afterSalesCase.updateMany({
      where: {
        id: c.id,
        deletedAt: null,
        stage: { in: fromRepair ? REPAIR_CONFIRM_STAGES : ['AWAITING_APPROVAL'] },
        replacementContractId: null,
        replacementSaleId: null,
        cancelledAt: null,
        approvedAt: null,
      },
      data: { approvedAt: claimedAt, approvedById: user.id },
    });
    if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');

    let posted: CashConfirmPosted;
    try {
      posted = await this.prisma.$transaction(
        (tx) => this.runCashConfirm(tx, c, saleId, newProductId, fromRepair, user, claimedAt),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      await this.prisma.afterSalesCase
        .updateMany({
          where: { id: c.id, approvedAt: claimedAt, replacementSaleId: null },
          data: { approvedAt: null, approvedById: null },
        })
        .catch((releaseErr: unknown) =>
          this.logger.error(
            `ปล่อยการจองยืนยันเปลี่ยนเครื่อง (ขายสด) ไม่สำเร็จ caseId=${c.id}: ${String(releaseErr)}`,
          ),
        );
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2034' || err.code === 'P2002')
      ) {
        Sentry.captureMessage('[after-sales cash-exchange] write-conflict translated to 409', {
          level: 'warning',
          extra: { caseId: c.id, code: err.code },
        });
        throw new ConflictException('ระบบกำลังประมวลผลรายการของเคสนี้อยู่ — ลองใหม่อีกครั้ง');
      }
      throw err;
    }

    // database.md — audit หลัง commit เท่านั้น
    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_CASH_EXCHANGE_CONFIRMED',
      entity: 'after_sales_case',
      entityId: c.id,
      newValue: {
        saleId,
        saleNumber: posted.saleNumber,
        oldProductId: posted.oldProductId,
        newProductId,
        journalEntryNo: posted.journalEntryNo,
        fromRepair,
        ...(canSeeCost(user.role) ? { oldCost: posted.oldCost, newCost: posted.newCost } : {}),
      },
    });
    if (fromRepair && posted.repairTicketId) {
      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_REPLACED_BY_SALE',
        entity: 'repair_ticket',
        entityId: posted.repairTicketId,
        newValue: { saleId, afterSalesCaseId: c.id },
      });
    }
    void this.line.notifyMoment(c.id, 'READY', user.id).catch(() => undefined);
    return {
      id: c.id,
      stage: 'READY_FOR_PICKUP' as const,
      replacementSaleId: saleId,
      saleNumber: posted.saleNumber,
      journalEntryNo: posted.journalEntryNo,
    };
  }

  private async runCashConfirm(
    tx: Prisma.TransactionClient,
    c: ExchangeCase,
    saleId: string,
    newProductId: string,
    fromRepair: boolean,
    user: ReqUser,
    claimedAt: Date,
  ): Promise<CashConfirmPosted> {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        saleNumber: true,
        saleType: true,
        productId: true,
        customerId: true,
        deletedAt: true,
        exchangeCaseId: true,
        shopWarrantyStartDate: true,
        createdAt: true,
        costSnapshot: { select: { mainProductCost: true } },
      },
    });
    if (!sale || sale.deletedAt) {
      throw new BadRequestException('ใบขายถูกยกเลิกไปแล้ว — เปลี่ยนเครื่องไม่ได้');
    }
    if (sale.productId !== c.productId) {
      throw new ConflictException('เครื่องของใบขายเปลี่ยนไปแล้ว — เปิดเคสใหม่');
    }
    const expectedStatus = mainProductStatusFor(sale.saleType);
    if (!expectedStatus) {
      throw new BadRequestException('ใบขายประเภทนี้ไม่รองรับการเปลี่ยนรุ่นเดิมขายสด');
    }
    // §3.4 — ตรวจกรอบด้วยข้อมูลสด (ไม่ใช่ snapshot ตอนเปิดเคส) ทั้งเคสปกติและ fromRepair · ไม่มี override
    if (!cashExchangeWindowOpen(saleSoldAt(sale)!)) {
      throw new BadRequestException(CASH_OUT_OF_WINDOW_REASON);
    }
    const next = await assertCashReplacement(
      tx,
      {
        sale: { id: sale.id, productId: sale.productId, customerId: sale.customerId },
        caseBranchId: c.branchId,
      },
      newProductId,
    );
    if (!sale.costSnapshot) {
      throw new BadRequestException('ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน');
    }
    const oldCost = new Prisma.Decimal(sale.costSnapshot.mainProductCost.toString());
    const newCost = new Prisma.Decimal(next.costPrice.toString());
    const oldProduct = await tx.product.findUnique({
      where: { id: sale.productId },
      select: { category: true },
    });
    if (!oldProduct) throw new BadRequestException('ไม่พบเครื่องเดิมของใบขาย');

    const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
    await validatePeriodOpen(tx, new Date(), shopCompanyId);

    const oldFlip = await tx.product.updateMany({
      where: { id: sale.productId, status: expectedStatus, deletedAt: null },
      data: { status: 'DEFECT_RETURN' },
    });
    if (oldFlip.count !== 1) {
      throw new ConflictException('เครื่องเดิมไม่อยู่ในสถานะของใบขายนี้แล้ว');
    }
    const newFlip = await tx.product.updateMany({
      where: { id: newProductId, status: 'IN_STOCK', deletedAt: null },
      data: { status: expectedStatus },
    });
    if (newFlip.count !== 1) throw new ConflictException('เครื่องทดแทนถูกขาย/จองไปแล้ว');
    await preemptReservationsInTx(tx, [newProductId]);

    const je = await this.cashExchange.execute(
      {
        afterSalesCaseId: c.id,
        caseNumber: c.caseNumber,
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        oldProductId: sale.productId,
        newProductId,
        oldCost,
        newCost,
        oldAccounts: this.shopAccounts.resolveProductAccounts(oldProduct.category),
        newAccounts: this.shopAccounts.resolveProductAccounts(next.category),
      },
      tx,
    );

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        productId: newProductId,
        exchangeCaseId: c.id,
        costSnapshot: {
          upsert: { create: { mainProductCost: newCost }, update: { mainProductCost: newCost } },
        },
      },
      select: { saleNumber: true },
    });

    let repairTicketId: string | null = null;
    if (fromRepair && c.repairTicket?.id) {
      await this.repair.markReplacedBySale(
        c.repairTicket.id,
        { caseNumber: c.caseNumber, saleNumber: updatedSale.saleNumber },
        user,
        tx,
      );
      repairTicketId = c.repairTicket.id;
    }

    await tx.afterSalesCase.update({
      where: { id: c.id },
      data: {
        outcome: 'CASH_SAME_MODEL_EXCHANGE',
        replacementProductId: newProductId,
        replacementSaleId: sale.id,
        approvedById: user.id,
        approvedAt: claimedAt,
        stage: 'READY_FOR_PICKUP',
        events: {
          create: {
            kind: 'APPROVED',
            actorId: user.id,
            note: `ยืนยันเปลี่ยนเครื่อง · ใบขาย ${updatedSale.saleNumber} · เครื่องทดแทน IMEI ${next.imeiSerial ?? '—'}${fromRepair ? ' · จากใบซ่อม (ซ่อมไม่ได้)' : ''}`,
          },
        },
      },
    });
    return {
      saleNumber: updatedSale.saleNumber,
      oldProductId: sale.productId,
      oldCost: oldCost.toFixed(2),
      newCost: newCost.toFixed(2),
      journalEntryNo: je?.entryNo ?? null,
      repairTicketId,
    };
  }

  /** PR 5 §6 — ส่งมอบเครื่องทดแทนของเคสขายสด: ประกันร้าน + กรอบ 7 วันนับใหม่จากวันนี้ · ปิดเคส · ไม่มี JE */
  private async deliverCash(c: ExchangeCase, dto: ExchangeDeliverDto, user: ReqUser) {
    if (!c.replacementSaleId || !c.replacementProductId) {
      throw new BadRequestException('เคสนี้ยังไม่ได้ยืนยันเปลี่ยนเครื่อง');
    }
    if (c.stage !== 'READY_FOR_PICKUP') throw new BadRequestException('เคสนี้ยังไม่พร้อมส่งมอบ');
    const now = new Date();
    const { updated, saleNumber, shopWarrantyEndDate } = await this.prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: c.replacementProductId! },
          select: { category: true, shopWarrantyDays: true, deviceOrigin: true, warrantyTerms: true },
        });
        const w = await shopWarrantyDatesFor(tx, product, now);
        const sale = await tx.sale.update({
          where: { id: c.replacementSaleId! },
          data: {
            shopWarrantyStartDate: w.shopWarrantyStartDate,
            shopWarrantyEndDate: w.shopWarrantyEndDate,
          },
          select: { saleNumber: true },
        });
        const accessories = deliveredAccessoriesText(dto.accessories);
        const note = `ส่งมอบเครื่องทดแทน · ใบขาย ${sale.saleNumber}${accessories ? ` · อุปกรณ์: ${accessories}` : ''}${dto.note?.trim() ? ` · ${dto.note.trim()}` : ''}`;
        // M1 — CAS เดียวกับกิ่งผ่อน: แพ้ = 409 และ tx ย้อนประกันที่เพิ่งเขียนกลับด้วย
        const updated = await this.closeDeliveredCase(tx, c.id, user.id, [
          { kind: 'DELIVERED', note },
          { kind: 'CLOSED', note: 'ปิดเคส' },
        ]);
        return { updated, saleNumber: sale.saleNumber, shopWarrantyEndDate: w.shopWarrantyEndDate };
      },
    );
    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_CASH_EXCHANGE_DELIVERED',
      entity: 'after_sales_case',
      entityId: c.id,
      newValue: {
        replacementSaleId: c.replacementSaleId,
        saleNumber,
        shopWarrantyEndDate: shopWarrantyEndDate?.toISOString() ?? null,
      },
    });
    void this.line.notifyMoment(c.id, 'CLOSED', user.id).catch(() => undefined);
    return updated;
  }

  /** PR 5 §11 — กล่อง "รายการบัญชีที่จะลง" ในกล่องยืนยัน (MGR) — คำนวณจากแหล่งเดียวกับ runCashConfirm ไม่เขียน DB */
  async cashExchangePreview(
    caseId: string,
    replacementProductId: string | undefined,
    user: ReqUser,
  ) {
    this.assertMgr(user);
    if (!canSeeCost(user.role)) throw new ForbiddenException('ไม่มีสิทธิ์ดูต้นทุน');
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (!c.saleId || c.contractId) throw new BadRequestException('เคสนี้ไม่ใช่เคสขายสด');
    const newProductId = replacementProductId ?? c.replacementProductId;
    if (!newProductId) throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    // M2 (final review PR5) — ใบขายที่ยกเลิกแล้ว (soft delete) ไม่ควร preview ได้ (confirm ตรวจอยู่แล้ว)
    const sale = await this.prisma.sale.findFirst({
      where: { id: c.saleId, deletedAt: null },
      select: {
        saleNumber: true,
        productId: true,
        customerId: true,
        costSnapshot: { select: { mainProductCost: true } },
      },
    });
    if (!sale) throw new NotFoundException('ไม่พบใบขาย');
    const next = await assertCashReplacement(
      this.prisma,
      {
        sale: { id: c.saleId, productId: sale.productId, customerId: sale.customerId },
        caseBranchId: c.branchId,
      },
      newProductId,
    );
    if (!sale.costSnapshot) {
      throw new BadRequestException('ไม่พบต้นทุนที่ลงบัญชีตอนขาย — ให้ฝ่ายบัญชีตรวจก่อน');
    }
    const oldProduct = await this.prisma.product.findUnique({
      where: { id: sale.productId },
      select: { category: true },
    });
    const oldA = this.shopAccounts.resolveProductAccounts(oldProduct?.category ?? 'PHONE_USED');
    const newA = this.shopAccounts.resolveProductAccounts(next.category);
    const oldCost = new Prisma.Decimal(sale.costSnapshot.mainProductCost.toString());
    const newCost = new Prisma.Decimal(next.costPrice.toString());
    const z = '0.00';
    const lines = [
      ...(oldCost.gt(0)
        ? [
            { accountCode: oldA.inventoryAccountCode, dr: oldCost.toFixed(2), cr: z },
            { accountCode: oldA.cogsAccountCode, dr: z, cr: oldCost.toFixed(2) },
          ]
        : []),
      ...(newCost.gt(0)
        ? [
            { accountCode: newA.cogsAccountCode, dr: newCost.toFixed(2), cr: z },
            { accountCode: newA.inventoryAccountCode, dr: z, cr: newCost.toFixed(2) },
          ]
        : []),
    ];
    return {
      saleNumber: sale.saleNumber,
      oldCost: oldCost.toFixed(2),
      newCost: newCost.toFixed(2),
      replacementProductId: newProductId,
      lines,
    };
  }

  /** ปฏิเสธคำขอเปลี่ยนรุ่นเดิม — เฉพาะตอนยังรออนุมัติ (ยังไม่ยืนยัน) */
  async rejectSameModel(caseId: string, dto: ExchangeRejectDto, user: ReqUser) {
    this.assertMgr(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (!['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'].includes(c.outcome ?? '')) {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    }
    if (c.stage !== 'AWAITING_APPROVAL') {
      throw new BadRequestException('เคสนี้ไม่ได้อยู่ระหว่างรออนุมัติ');
    }

    // M4 — CAS: ปฏิเสธได้เฉพาะเคสที่ยังรออนุมัติจริงและยังไม่มีใครจองยืนยัน (แข่งกับ confirm/switch)
    // residual sweep — CAS + event REJECTED ในทรานแซกชันเดียว (audit หลัง commit)
    const cancelledAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.afterSalesCase.updateMany({
        where: SAME_MODEL_PENDING_CAS(caseId),
        data: { cancelledAt, cancelReason: dto.reason, stage: 'CANCELLED' },
      });
      if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');
      return tx.afterSalesCase.update({
        where: { id: caseId },
        data: { events: { create: { kind: 'REJECTED', actorId: user.id, note: dto.reason } } },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_REJECTED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { reason: dto.reason },
    });

    return updated;
  }

  /**
   * เปลี่ยนใจ — จากทางออกเปลี่ยนรุ่นเดิมเป็นซ่อมแทน (ยังไม่ยืนยัน, ยังไม่เคยมีใบซ่อม) เปิดใบซ่อม +
   * อัปเดตเคสในทรานแซกชันเดียวกัน (เหมือน `AfterSalesCaseService.createCase` REPAIR branch)
   */
  async switchToRepair(caseId: string, dto: SwitchToRepairDto, user: ReqUser) {
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (!['SAME_MODEL_EXCHANGE', 'CASH_SAME_MODEL_EXCHANGE'].includes(c.outcome ?? '')) {
      throw new BadRequestException('เคสนี้ไม่ใช่ทางออกเปลี่ยนรุ่นเดิม');
    }
    if (c.stage !== 'AWAITING_APPROVAL') {
      throw new BadRequestException('เคสนี้ไม่ได้อยู่ระหว่างรออนุมัติ');
    }
    if (c.repairTicketId) throw new ConflictException('เคสนี้มีใบซ่อมอยู่แล้ว');

    const warrantyStatus = (c.warrantySnapshot as unknown as { status: WarrantyStatus }).status;
    const payer = dto.payer ?? payerDefaultFor(warrantyStatus);

    const repairDto: CreateRepairTicketDto = {
      customerId: c.customerId,
      contractId: c.contractId ?? undefined,
      productId: c.productId ?? undefined,
      branchId: c.branchId,
      deviceBrand: c.deviceBrand ?? undefined,
      deviceModel: c.deviceModel ?? undefined,
      deviceImei: c.deviceImei ?? undefined,
      deviceSerial: c.deviceSerial ?? undefined,
      defectDescription: c.symptom,
      payer: payer as RepairPayerInput,
      estimatedCost: dto.estimatedCost,
      repairSupplierId: dto.repairSupplierId,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      // M4 — CAS ก่อนเปิดใบซ่อม: แพ้การแข่งกับ confirm/reject → 409 (rollback ทั้ง tx ไม่มีใบซ่อมค้าง)
      const claim = await tx.afterSalesCase.updateMany({
        where: SAME_MODEL_PENDING_CAS(caseId),
        data: { outcome: 'REPAIR', stage: 'RECEIVED' },
      });
      if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');
      const { ticket } = await this.repair.createInTx(repairDto, user, tx);
      return tx.afterSalesCase.update({
        where: { id: caseId },
        data: {
          outcome: 'REPAIR',
          repairTicketId: ticket.id,
          replacementProductId: null,
          stage: 'RECEIVED',
          events: {
            create: {
              kind: 'OUTCOME_SET',
              actorId: user.id,
              note: `${SWITCHED_TO_REPAIR_NOTE} · ผู้จ่าย ${payer}`,
            },
          },
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_OUTCOME_SWITCHED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { repairTicketId: updated.repairTicketId ?? null, payer },
    });

    return updated;
  }

  /**
   * อนุมัติคำขอเปลี่ยนเครื่องแบบมีราคา (ทั้ง MEMO และ PRICED) — **ปิดใช้ 2026-10-06** (คำตัดสินเจ้าของ:
   * ลูกค้าต้องปิดยอดสัญญาเดิมก่อนทำสัญญาผ่อนใหม่) → 410 ก่อนแตะ role/getCase/engine. คำขอที่ค้างรออนุมัติ
   * ปิดได้ทางเดียวคือ `rejectPriced` (OWNER); ที่อนุมัติไปแล้วก่อนปิดยกเลิกผ่าน `cancelSwap` ตามเดิม.
   * คงเมธอดไว้ให้ route `POST /after-sales/:id/approve` ได้ข้อความชี้ทาง ไม่ใช่ 404 เงียบ ๆ.
   */
  async approvePriced(
    _caseId: string,
    _dto: ApproveExchangeRequestDto,
    _user: ReqUser,
  ): Promise<never> {
    throw deviceSwapClosed();
  }

  /** ปฏิเสธคำขอเปลี่ยนเครื่องแบบมีราคา — OWNER เท่านั้น (ต่างจาก rejectSameModel ที่เป็น MGR) */
  async rejectPriced(caseId: string, dto: ExchangeRejectDto, user: ReqUser) {
    this.assertOwner(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    const requestId = this.assertPricedCase(c);

    await this.contractExchange.reject(requestId, dto.reason, user.id);

    await this.reconcile(caseId);

    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        events: { create: { kind: 'REJECTED', actorId: user.id, note: dto.reason } },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_REJECTED_PRICED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { exchangeRequestId: requestId, reason: dto.reason },
    });

    return updated;
  }

  /** ยกเลิกคำขอเปลี่ยนเครื่องแบบมีราคาที่อนุมัติไปแล้ว — MGR (engine บังคับสถานะ APPROVED เอง) */
  async cancelSwap(caseId: string, dto: ExchangeRejectDto, user: ReqUser) {
    this.assertMgr(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    const requestId = this.assertPricedCase(c, { allowClosedApproved: true });

    await this.exchangeCancel.cancel(requestId, dto.reason, user);

    await this.reconcile(caseId);

    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        events: {
          create: {
            kind: 'CANCELLED',
            actorId: user.id,
            note: `ยกเลิกคำขอเปลี่ยนเครื่อง: ${dto.reason}`,
          },
        },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_CANCELLED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { exchangeRequestId: requestId, reason: dto.reason },
    });

    return updated;
  }

  /**
   * ตัวเลข NCV/tier/plan ก่อนอนุมัติจริง — **ปิดใช้ 2026-10-06** พร้อมเมนูเปลี่ยนเครื่องแบบมีราคา → 410
   * ก่อนแตะ role/lookup/engine (ไม่มีอะไรให้ preview เมื่อยื่นคำขอใหม่ไม่ได้แล้ว).
   */
  async preview(_q: PreviewQuery, _user: ReqUser): Promise<never> {
    throw deviceSwapClosed();
  }

  /**
   * รายการเครื่องทดแทนให้เลือกตอนส่งคำขอ — `sameModel: true` กรองยี่ห้อ/รุ่น/ความจุของเครื่องเดิม
   * (จาก IMEI) + `category: 'PHONE_USED'` (defect-exchange ต้องการ PHONE_USED เท่านั้น — ดู
   * `checkEligibility`) ส่วน `sameModel: false` คือเลือกรุ่นใหม่แบบมีราคาจึงไม่กรองรุ่น. ทุกกรณี
   * ต้อง `IN_STOCK` + ยังไม่ถูกลบ. สาขา: role ที่ไม่ข้ามสาขาได้ถูกปักที่สาขาตัวเองเสมอ (ไม่มี
   * branchId ติดตัว = คืนว่าง แทนที่จะรั่วข้ามสาขา) — role ข้ามสาขาใช้ `q.branchId` เมื่อส่งมา
   */
  async replacementProducts(q: ReplacementProductsDto, user: ReqUser) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: 'IN_STOCK',
    };

    if (q.sameModel) {
      // T6-2 — ค้นเครื่องเดิมเฉพาะตอนต้องกรองรุ่นเดิม (sameModel=false ไม่ใช้ผลนี้เลย)
      const found = await this.lookup.lookup({ imei: q.imei }, user);
      if (!found.product) throw new BadRequestException('ไม่พบเครื่องเดิมจากเลข IMEI นี้');
      where.brand = found.product.brand;
      where.model = found.product.model;
      where.storage = found.product.storage;
      where.category = 'PHONE_USED';
    }

    if (hasCrossBranchAccess(user)) {
      if (q.branchId) where.branchId = q.branchId;
    } else if (user.branchId) {
      where.branchId = user.branchId;
    } else {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        brand: true,
        model: true,
        storage: true,
        color: true,
        imeiSerial: true,
        cashPrice: true,
        branchId: true,
      },
      take: 200,
      orderBy: { createdAt: 'asc' },
    });

    return products.map((p) => ({ ...p, cashPrice: p.cashPrice?.toString() ?? null }));
  }
}
