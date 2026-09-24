import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { SendDto } from '../../repair-tickets/dto/send.dto';
import { MarkRepairedDto } from '../../repair-tickets/dto/mark-repaired.dto';
import { SendBackDto } from '../../repair-tickets/dto/send-back.dto';
import { ReturnToCustomerDto } from '../../repair-tickets/dto/return-to-customer.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { AuditService } from '../../audit/audit.service';
import { AfterSalesQueryService } from './after-sales-query.service';
import { deriveStage } from '../utils/after-sales-stage.util';
import { MAX_INTAKE_PHOTOS } from './after-sales-case.service';
import { CancelCaseDto } from '../dto/cancel-case.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };
type Kind =
  | 'REPAIR_SENT'
  | 'REPAIR_DONE'
  | 'REPAIR_SENT_BACK'
  | 'DELIVERED'
  | 'PHOTO_ADDED'
  | 'CANCELLED'
  | 'CLOSED';

/**
 * Proxy หน้าบ้าน — ทุก write โยนต่อไปที่ RepairTicketsService (ใบซ่อมคือความจริงเพียงหนึ่งเดียว)
 * แล้วเขียน `AfterSalesCase.stage` กลับผ่าน deriveStage เสมอหลังใบซ่อมเปลี่ยนสถานะ +
 * บันทึก AfterSalesEvent เป็น timeline ของเคส (Task 5 filter tabs จาก stage คอลัมน์นี้).
 */
@Injectable()
export class AfterSalesRepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly repair: RepairTicketsService,
    private readonly query: AfterSalesQueryService,
    private readonly audit: AuditService,
  ) {}

  /** โหลดเคส (เช็คสิทธิ์สาขาผ่าน query.getCase) แล้วคืน ticketId */
  private async ticketOf(caseId: string, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    if (!c.repairTicket) throw new BadRequestException('เคสนี้ไม่ได้เลือกทางออก "ซ่อม"');
    return { c, ticketId: c.repairTicket.id };
  }

  /**
   * เขียน stage กลับ + event หลังใบซ่อมเปลี่ยนสถานะ (นอก tx ของใบซ่อม — ใบซ่อมคือความจริง
   * เคสตามหลัง). `replacementContractId: null` / `closedAt: null` / `exchange: null` เพราะ
   * proxy นี้คุมเฉพาะ flow REPAIR (R7 ของ SAME_MODEL_EXCHANGE/PRICED_EXCHANGE เป็นคนละ service —
   * PR 2 เพิ่มกิ่งของทางออกเหล่านั้นใน deriveStage แต่ proxy ซ่อมนี้ไม่ต้องรู้จักมัน).
   */
  private async sync(
    caseId: string,
    user: ReqUser,
    kind: Kind,
    note: string,
    extra: Record<string, unknown> = {},
  ) {
    const t = await this.prisma.repairTicket.findFirst({
      where: { afterSalesCase: { id: caseId } },
      select: { status: true, deletedAt: true },
    });
    const stage = deriveStage({
      outcome: 'REPAIR',
      cancelledAt: null,
      closedAt: null,
      repairStatus: t?.status ?? null,
      repairDeleted: !!t?.deletedAt,
      replacementContractId: null,
      exchange: null,
    });
    return this.prisma.afterSalesCase.update({
      where: { id: caseId },
      data: {
        stage,
        ...(stage === 'CLOSED' ? { closedAt: new Date() } : {}),
        ...extra,
        events: { create: { kind, note, actorId: user.id } },
      },
      select: { id: true, stage: true },
    });
  }

  async send(caseId: string, dto: SendDto, user: ReqUser) {
    const { ticketId } = await this.ticketOf(caseId, user);
    await this.repair.send(ticketId, dto, user);
    return this.sync(
      caseId,
      user,
      'REPAIR_SENT',
      `ส่งซ่อม${dto.externalClaimNo ? ` · เลขเคลม ${dto.externalClaimNo}` : ''}`,
    );
  }

  async markRepaired(caseId: string, dto: MarkRepairedDto, user: ReqUser) {
    const { c, ticketId } = await this.ticketOf(caseId, user);
    await this.repair.markRepaired(ticketId, dto, user);
    // R21 — ไม่มีศูนย์ซ่อม (ซ่อมที่ร้าน) ใช้คำในไทม์ไลน์ต่างจากส่งซ่อมศูนย์ภายนอก
    const label = c.repairTicket!.repairSupplier ? 'ซ่อมเสร็จ' : 'ซ่อมที่ร้านเสร็จ';
    return this.sync(
      caseId,
      user,
      'REPAIR_DONE',
      `${label} · ค่าซ่อมจริง ${dto.actualCost} · ผู้จ่าย ${dto.payer}`,
    );
  }

  async sendBack(caseId: string, dto: SendBackDto, user: ReqUser) {
    const { ticketId } = await this.ticketOf(caseId, user);
    await this.repair.sendBack(ticketId, dto, user);
    return this.sync(caseId, user, 'REPAIR_SENT_BACK', dto.note);
  }

  async returnToCustomer(caseId: string, dto: ReturnToCustomerDto, user: ReqUser) {
    const { ticketId } = await this.ticketOf(caseId, user);
    await this.repair.returnToCustomer(ticketId, dto, user);
    await this.sync(caseId, user, 'DELIVERED', 'ส่งมอบคืนลูกค้าแล้ว');
    return this.sync(caseId, user, 'CLOSED', 'ปิดเคส');
  }

  async cancelCase(caseId: string, dto: CancelCaseDto, user: ReqUser) {
    const found = await this.query.getCase(caseId, user);
    if (
      !found.repairTicket &&
      (found.outcome === 'SAME_MODEL_EXCHANGE' || found.outcome === 'PRICED_EXCHANGE')
    ) {
      return this.cancelBareExchangeCase(found, dto, user);
    }
    if (!found.repairTicket) throw new BadRequestException('เคสนี้ไม่ได้เลือกทางออก "ซ่อม"');
    const c = found;
    const ticketId = found.repairTicket.id;
    if (c.repairTicket!.status === 'IN_PROGRESS') {
      throw new BadRequestException(
        'ยกเลิกไม่ได้ เครื่องอยู่ที่ศูนย์ — บันทึกส่งซ่อมต่อ/ซ่อมเสร็จก่อน',
      );
    }
    if (['CLOSED', 'REPLACED', 'CANCELLED'].includes(c.repairTicket!.status)) {
      throw new BadRequestException('เคสนี้จบแล้ว');
    }
    await this.repair.cancel(ticketId, { note: dto.reason }, user);
    return this.sync(caseId, user, 'CANCELLED', dto.reason, {
      cancelledAt: new Date(),
      cancelReason: dto.reason,
    });
  }

  /**
   * M1/M2 (partial, final fix wave) — ทางออกเปลี่ยนเครื่องที่ "ยังไม่มีอะไรฝั่ง engine เลย" (ไม่มีใบซ่อม
   * ไม่มีสัญญาใหม่ ไม่มีคำขอผูก — เช่น รอ ผจก. ยืนยันแล้วลูกค้าไม่มาต่อ หรือเคส PRICED ที่ผูกคำขอไม่สำเร็จ)
   * ยกเลิกได้ที่นี่ (route เป็น MGR) — ไม่มีอะไรต้องย้อนฝั่ง engine. เคสที่มีของฝั่ง engine แล้วต้องใช้
   * ขั้นตอนของทางออกนั้น (ยกเลิก swap / ปฏิเสธ) — การย้อนเปลี่ยนรุ่นเดิมที่ยืนยันแล้วเป็นเรื่องของ engine
   * (known limitation). CAS กันแข่งกับการผูกสัญญาใหม่/คำขอพร้อมกัน — ไม่ล็อก `approvedAt` (residual
   * sweep): เคสที่ถูก "จอง" ค้าง (approvedAt ตั้งอยู่แต่ไม่มีสัญญาใหม่ — confirm ล้มแล้วปล่อยจองไม่สำเร็จ)
   * คือเคสติดที่ต้องยกเลิกได้ ส่วน confirm ที่กำลังรันจริงจะชนที่ replacementContractId/engine แทน
   */
  private async cancelBareExchangeCase(
    c: {
      id: string;
      outcome: string | null;
      stage: string;
      repairTicketId: string | null;
      replacementContractId: string | null;
      exchangeRequestId: string | null;
    },
    dto: CancelCaseDto,
    user: ReqUser,
  ) {
    if (c.repairTicketId || c.replacementContractId || c.exchangeRequestId) {
      throw new BadRequestException(
        'เคสนี้มีรายการเปลี่ยนเครื่องในระบบแล้ว — ยกเลิกผ่านขั้นตอนของคำขอเปลี่ยนเครื่อง',
      );
    }
    if (['CLOSED', 'CANCELLED'].includes(c.stage)) throw new BadRequestException('เคสนี้จบแล้ว');
    const cancelledAt = new Date();
    // CAS + event ในทรานแซกชันเดียว (ไม่มีเคส CANCELLED ที่ขาด event) — audit หลัง commit
    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.afterSalesCase.updateMany({
        where: {
          id: c.id,
          deletedAt: null,
          outcome: c.outcome as 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE',
          repairTicketId: null,
          replacementContractId: null,
          exchangeRequestId: null,
          cancelledAt: null,
          stage: { notIn: ['CLOSED', 'CANCELLED'] },
        },
        data: { stage: 'CANCELLED', cancelledAt, cancelReason: dto.reason },
      });
      if (!claim.count) throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว');
      return tx.afterSalesCase.update({
        where: { id: c.id },
        data: { events: { create: { kind: 'CANCELLED', actorId: user.id, note: dto.reason } } },
        select: { id: true, stage: true },
      });
    });
    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_CASE_CANCELLED',
      entity: 'after_sales_case',
      entityId: c.id,
      newValue: { outcome: c.outcome, reason: dto.reason },
    });
    return updated;
  }

  async addPhoto(caseId: string, file: Express.Multer.File, user: ReqUser) {
    const c = await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { photoKeys: true },
    });
    if (row.photoKeys.length >= MAX_INTAKE_PHOTOS) {
      throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    }
    assertEvidenceImage(file, 'รูปตอนรับฝาก');
    const key = `after-sales/${caseId}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    try {
      await this.prisma.afterSalesCase.update({
        where: { id: caseId },
        data: {
          photoKeys: { push: key },
          events: {
            create: {
              kind: 'PHOTO_ADDED',
              actorId: user.id,
              note: `เพิ่มรูป (${row.photoKeys.length + 1}/${MAX_INTAKE_PHOTOS})`,
            },
          },
        },
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
    return { photoCount: row.photoKeys.length + 1, stage: c.stage };
  }

  async getPhoto(caseId: string, index: number, user: ReqUser) {
    await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { photoKeys: true },
    });
    const key = row.photoKeys[index];
    if (!key) throw new NotFoundException('ไม่มีรูปลำดับนี้');
    return { key, stream: await this.storage.getStream(key) };
  }

  async getPurchasePhoto(caseId: string, angle: string, user: ReqUser) {
    await this.query.getCase(caseId, user);
    const row = await this.prisma.afterSalesCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { purchasePhotoKeys: true },
    });
    const key = row.purchasePhotoKeys.find((k) => k.includes(`/purchase-${angle}.`));
    if (!key) throw new NotFoundException('ไม่มีรูปตอนซื้อมุมนี้');
    return { key, stream: await this.storage.getStream(key) };
  }
}
