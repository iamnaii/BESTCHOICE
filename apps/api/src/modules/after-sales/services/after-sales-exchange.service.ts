import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WarrantyStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import {
  CreateRepairTicketDto,
  RepairPayerInput,
} from '../../repair-tickets/dto/create-repair-ticket.dto';
import { AfterSalesQueryService } from './after-sales-query.service';
import { NEW_PRODUCT_REASON_RE } from './after-sales-case.service';
import { payerDefaultFor } from '../utils/after-sales-outcomes.util';
import { ExchangeConfirmDto } from '../dto/exchange-confirm.dto';
import { ExchangeRejectDto } from '../dto/exchange-reject.dto';
import { SwitchToRepairDto } from '../dto/switch-to-repair.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: AfterSalesQueryService,
    private readonly defect: DefectExchangeService,
    private readonly repair: RepairTicketsService,
    private readonly audit: AuditService,
  ) {}

  private assertMgr(user: ReqUser) {
    if (!['OWNER', 'BRANCH_MANAGER'].includes(user.role)) {
      throw new ForbiddenException('เฉพาะ ผจก.สาขา หรือเจ้าของ');
    }
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
    // P-H.2: bypassWindowCheck ทำให้ engine ข้าม checkEligibility ทั้งก้อน (เช็คแค่ว่าสินค้ามีแถวจริง
    // — ไม่ตรวจ IN_STOCK หรือรุ่น/ความจุ) ⇒ ทุกเส้นทาง bypass (นอกกรอบ 7 วัน และ fromRepair ที่บังคับ
    // bypass เสมอตาม P-H.1 ด้านล่าง) ต้องบังคับเหตุผลเกี่ยวกับ "เครื่องใหม่" เองที่นี่ก่อนเสมอ —
    // สูตรเดียวกับที่ Task 4 ใช้ใน createCase (NEW_PRODUCT_REASON_RE)
    const productReasons = elig.reasons.filter((r) => NEW_PRODUCT_REASON_RE.test(r));
    if (!elig.newProduct || productReasons.length) {
      throw new BadRequestException(
        productReasons[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย',
      );
    }

    // P-H.1: "นอกกรอบ 7 วัน" (outOfWindow) กับ "มาจากใบซ่อม" (fromRepair) เป็นคนละแนวคิด —
    // เคส REPAIR ที่ยืนยันขณะยังอยู่ในกรอบ (elig.eligible = true) ก็ยังต้อง bypassWindowCheck=true
    // เพราะ defect-exchange.service.ts เช็ค repair-ticket status + เรียก markReplaced เฉพาะกิ่ง
    // `if (dto.bypassWindowCheck && dto.originRepairTicketId)` เท่านั้น — ถ้าไม่ bypass ใบซ่อมจะไม่ถูก
    // ปิด/ผูกสัญญาใหม่เลย (แม้ execute() จะสำเร็จ). ข้อความ "ข้ามกรอบ 7 วัน" ต้องขึ้นเฉพาะตอน
    // outOfWindow จริง ๆ ไม่ใช่ทุกครั้งที่ fromRepair (ซึ่งอาจยังอยู่ในกรอบ 7 วัน).
    const outOfWindow = !elig.eligible;
    const bypass = outOfWindow || fromRepair;
    const res = await this.defect.execute(
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
    const newContract = res.newContract;

    await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        outcome: 'SAME_MODEL_EXCHANGE',
        replacementProductId: newProductId,
        replacementContractId: newContract.id,
        approvedById: user.id,
        approvedAt: new Date(),
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
      where: { id: c.replacementContractId },
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

    const updated = await this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        cancelledAt: new Date(),
        cancelReason: dto.reason,
        stage: 'CANCELLED',
        events: { create: { kind: 'REJECTED', actorId: user.id, note: dto.reason } },
      },
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
              note: `เปลี่ยนเป็น "ซ่อม" แทน · ผู้จ่าย ${payer}`,
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
}
