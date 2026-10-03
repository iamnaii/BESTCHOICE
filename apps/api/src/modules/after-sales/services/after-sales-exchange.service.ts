import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AfterSalesStage, Prisma, WarrantyStatus } from '@prisma/client';
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

type ReqUser = { id: string; role: string; branchId?: string | null };

/** M4 — stage ของเคส REPAIR ที่ยืนยันเปลี่ยนรุ่นเดิม (ซ่อมไม่ได้) ได้ — ตรงกับ markReplaced ของ engine */
const REPAIR_CONFIRM_STAGES: AfterSalesStage[] = ['RECEIVED', 'IN_REPAIR', 'READY_FOR_PICKUP'];

/** M4 — CAS ร่วมของ rejectSameModel/switchToRepair: ยังรออนุมัติจริง ยังไม่มีใครจอง/ยืนยัน/ยกเลิก */
const SAME_MODEL_PENDING_CAS = (id: string): Prisma.AfterSalesCaseWhereInput => ({
  id,
  deletedAt: null,
  outcome: 'SAME_MODEL_EXCHANGE',
  stage: 'AWAITING_APPROVAL',
  replacementContractId: null,
  approvedAt: null,
  cancelledAt: null,
});

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
  private assertStaff(user: ReqUser) {
    if (!['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user.role)) {
      throw new ForbiddenException('เฉพาะเจ้าของ ผจก.สาขา หรือพนักงานขาย');
    }
  }

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
  async deliver(caseId: string, user: ReqUser) {
    const c: ExchangeCase = await this.query.getCase(caseId, user);
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

    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        closedAt: new Date(),
        stage: 'CLOSED',
        events: {
          create: [
            {
              kind: 'DELIVERED',
              actorId: user.id,
              note: `ส่งมอบเครื่องใหม่ · สัญญา ${newContract.contractNumber}`,
            },
            { kind: 'CLOSED', actorId: user.id, note: 'ปิดเคส' },
          ],
        },
      },
    });

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

  /** ปฏิเสธคำขอเปลี่ยนรุ่นเดิม — เฉพาะตอนยังรออนุมัติ (ยังไม่ยืนยัน) */
  async rejectSameModel(caseId: string, dto: ExchangeRejectDto, user: ReqUser) {
    this.assertMgr(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    if (c.outcome !== 'SAME_MODEL_EXCHANGE') {
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
    if (c.outcome !== 'SAME_MODEL_EXCHANGE') {
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
   * อนุมัติคำขอเปลี่ยนเครื่องแบบมีราคา — MGR (engine บังคับ ESCALATE=OWNER เอง ที่นี่ไม่เช็คซ้ำ).
   * MEMO mode ไม่มีสัญญาใหม่ (`newContractId: null`) เพราะแค่สลับ productId บนสัญญาเดิม; PRICED
   * mode ต้องเปิดใช้สัญญาใหม่ที่หน้าสัญญาต่อก่อนเคสจะปิด (`reconcile` จึงได้ READY_FOR_PICKUP
   * ไม่ใช่ CLOSED ทันที — CLOSED มาทีหลังตอนสัญญาใหม่พ้น DRAFT).
   */
  async approvePriced(caseId: string, dto: ApproveExchangeRequestDto, user: ReqUser) {
    this.assertMgr(user);
    const c: ExchangeCase = await this.query.getCase(caseId, user);
    const requestId = this.assertPricedCase(c);

    const res = await this.contractExchange.approve(requestId, user, dto);

    let note: string;
    if (res.mode === 'MEMO') {
      note = 'อนุมัติ · MEMO ลงผลแล้ว';
    } else {
      // res.newContractId is only null for MEMO — PRICED always creates a new contract, but
      // read the contract number defensively (fall back to the raw id) rather than assume.
      const newContract = res.newContractId
        ? await this.prisma.contract.findUnique({
            where: { id: res.newContractId, deletedAt: null },
            select: { contractNumber: true },
          })
        : null;
      const contractNumber = newContract?.contractNumber ?? res.newContractId ?? '';
      note = `อนุมัติ · PRICED สัญญาใหม่ ${contractNumber} รอเปิดใช้`;
    }

    await this.reconcile(caseId);

    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        approvedById: user.id,
        approvedAt: new Date(),
        events: { create: { kind: 'APPROVED', actorId: user.id, note } },
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_EXCHANGE_APPROVED',
      entity: 'after_sales_case',
      entityId: caseId,
      newValue: { exchangeRequestId: requestId, mode: res.mode, newContractId: res.newContractId },
    });

    // Task 3 — MEMO ลงผลแล้ว = เคสจบ (CLOSED); PRICED ยังต้องเปิดใช้สัญญาใหม่ที่หน้าสัญญาก่อน
    // เคสจึงยัง READY_FOR_PICKUP รอส่งมอบ (READY) — หลัง commit + audit เสมอ, fire-and-forget
    void this.line
      .notifyMoment(caseId, res.mode === 'MEMO' ? 'CLOSED' : 'READY', user.id)
      .catch(() => undefined);

    return updated;
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
   * ตัวเลข NCV/tier/plan ก่อนอนุมัติจริง — หาสัญญาจาก IMEI แล้วส่งต่อ engine ตรง ๆ (คืนผลเดิม
   * ไม่แปลง). STAFF เท่านั้น (OWNER/BM/SALES) เพราะเห็นเลขการเงินของสัญญา.
   */
  async preview(q: PreviewQuery, user: ReqUser) {
    this.assertStaff(user);
    const found = await this.lookup.lookup({ imei: q.imei }, user);
    if (!found.contract) throw new BadRequestException('ไม่พบสัญญาผ่อนของเครื่องนี้');

    return this.contractExchange.buildPreview(
      {
        oldContractId: found.contract.id,
        newProductId: q.replacementProductId,
        buybackPrice: q.buybackPrice,
        deviceCondition: q.deviceCondition,
        newTotalMonths: q.newTotalMonths,
        newInterestRate: q.newInterestRate,
      },
      user,
    );
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
