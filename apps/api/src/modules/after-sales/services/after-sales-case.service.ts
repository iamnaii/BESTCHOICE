import { ChatServiceCaseLinkService } from './chat-service-case-link.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AfterSalesOutcome, AfterSalesStage } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import {
  CreateRepairTicketDto,
  RepairPayerInput,
} from '../../repair-tickets/dto/create-repair-ticket.dto';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService, LookupResult } from './after-sales-lookup.service';
import { AfterSalesLineService } from './after-sales-line.service';
import { reconcileStage, RECONCILE_SELECT } from './after-sales-stage-reconcile';
import { WINDOW_REASON_RE } from '../utils/after-sales-outcomes.util';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';
import { deviceSwapClosed } from '../../contract-exchange/device-swap-closed.policy';

type ReqUser = { id: string; role: string; branchId?: string | null };

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

export interface CreateCaseResult {
  id: string;
  caseNumber: string;
  repairTicketId: string | null;
  outcome: AfterSalesOutcome;
  exchangeRequestId: string | null;
  stage: AfterSalesStage;
}

@Injectable()
export class AfterSalesCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly repair: RepairTicketsService,
    private readonly docNumber: AfterSalesDocNumberService,
    private readonly lookupSvc: AfterSalesLookupService,
    private readonly defect: DefectExchangeService,
    private readonly line: AfterSalesLineService,
    @Optional() private readonly chatLinks?: ChatServiceCaseLinkService,
  ) {}

  // R29 (fix round 1) — ฟิลด์ที่ REPAIR กับกิ่งเปลี่ยนเครื่องเหมือนกันทุกประการ (~15 ฟิลด์)
  // เคยก็อปสองชุดโดยไม่มีอะไรบังคับให้ตรงกัน — รวมเป็นจุดเดียว ต่างกันแค่ที่มาของ device*
  // (REPAIR อ่านจาก repair ticket ที่ผ่าน createInTx แล้ว ส่วนเปลี่ยนเครื่องอ่านจาก look/dto ตรงๆ)
  private buildBaseCaseData(params: {
    id: string;
    caseNumber: string;
    dto: CreateCaseDto;
    customerId: string;
    look: LookupResult;
    user: ReqUser;
    deviceBrand: string | null | undefined;
    deviceModel: string | null | undefined;
    deviceImei: string | null | undefined;
    deviceSerial: string | null | undefined;
    photoKeys: string[];
    purchasePhotoKeys: string[];
  }) {
    const { id, caseNumber, dto, customerId, look, user, photoKeys, purchasePhotoKeys } = params;
    return {
      id,
      caseNumber,
      branchId: dto.branchId,
      customerId,
      source: look.source,
      contractId: look.contract?.id ?? null,
      saleId: look.sale?.id ?? null,
      productId: look.product?.id ?? null,
      deviceBrand: params.deviceBrand,
      deviceModel: params.deviceModel,
      deviceImei: params.deviceImei,
      deviceSerial: params.deviceSerial,
      symptom: dto.symptom,
      accessories: dto.accessories ?? {},
      unlockConfirmed: dto.unlockConfirmed,
      photoKeys,
      purchasePhotoKeys,
      warrantySnapshot: {
        ...look.warranty,
        within7Days: look.warranty.daysRemainingIn7Day > 0,
      },
      receivedById: user.id,
    };
  }

  async createCase(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
    // คำตัดสินเจ้าของ 2026-10-06 — เมนูเปลี่ยนเครื่องแบบมีราคาปิดทั้งหมด: 410 ตั้งแต่บรรทัดแรก ก่อนแตะ
    // สาขา/รูป/lookup/storage/tx/engine (DTO ยังรับค่า PRICED_EXCHANGE เพื่อให้ไคลเอนต์เก่าได้ข้อความชี้ทาง)
    if (dto.outcome === 'PRICED_EXCHANGE') throw deviceSwapClosed();
    if (dto.serviceRequestId) {
      if (!this.chatLinks) throw new BadRequestException('ระบบเชื่อมใบรับเรื่องยังไม่พร้อม');
      const existing = await this.chatLinks.existingForCreation(dto.serviceRequestId, user);
      if (existing) return existing;
    }
    // R16 (fix round 1, Critical) — BranchGuard อ่าน request.body?.branchId แต่ guards รันก่อน
    // FilesInterceptor แกะ multipart/form-data เสร็จ ⇒ ตอนถึง guard body ยังว่าง (ไม่มี branchId
    // ให้เห็น) จึงปล่อยผ่านเสมอบน POST /after-sales — ต้องบังคับ scope สาขาที่ service เอง ก่อนแตะ
    // storage/lookup/tx ใด ๆ (แบบเดียวกับ security.md "Branch scope บน route ที่มีแต่ :id")
    if (!hasCrossBranchAccess(user) && dto.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    // DTO ไม่บังคับ UUID แล้ว (seed ใช้ `branch-001`) — ตรวจว่าสาขามีจริงแทน ให้ role ข้ามสาขาที่ส่ง
    // รหัสมั่วได้ 400 ภาษาไทย แทน FK error ตอนสร้างแถว
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('ไม่พบสาขา');
    if (!files?.length) throw new BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
    if (files.length > MAX_INTAKE_PHOTOS) {
      throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    }
    files.forEach((f) => assertEvidenceImage(f, 'รูปตอนรับฝาก'));

    const look = await this.lookupSvc.lookup({ imei: dto.imei }, user);
    // R12 fast path — เช็คซ้ำอีกครั้งใน tx ด้วย advisory lock ก่อนสร้างจริง (กัน TOCTOU)
    if (look.openCase) {
      if (dto.serviceRequestId) {
        const existing = await this.chatLinks!.existingForCreation(dto.serviceRequestId, user);
        if (existing) return existing;
      }
      throw new ConflictException(
        `เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${look.openCase.caseNumber}`,
      );
    }
    const customerId = look.customer?.id ?? dto.customerId;
    if (!customerId) throw new BadRequestException('ไม่พบเครื่องในระบบ — ต้องเลือกลูกค้า');
    const outcome = look.outcomes.find((o) => o.outcome === dto.outcome);
    if (!outcome?.enabled)
      throw new BadRequestException(outcome?.reason ?? 'ทางออกนี้ทำไม่ได้กับเครื่องนี้');

    // Task 4 — เปิดทางออกเปลี่ยนเครื่องตอนแจ้งปัญหา (SAME_MODEL_EXCHANGE — PRICED_EXCHANGE ถูกปิด 410 ด้านบน)
    const isSameModel = dto.outcome === 'SAME_MODEL_EXCHANGE';
    if (isSameModel && !dto.replacementProductId) {
      throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    }
    if (isSameModel && !look.contract) {
      throw new BadRequestException('ทางออกนี้ใช้ได้กับสัญญาผ่อนเท่านั้น');
    }
    // R28 — ข้อมูลเครื่องทดแทน (สำหรับข้อความ event OUTCOME_SET ของ (a)) ต้องมาจากการค้นจริง
    // ไม่ใช่จาก DefectExchangeService.checkEligibility ซึ่งไม่คืน imeiSerial กลับมา
    let replacementProduct: {
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
    } | null = null;
    if (isSameModel) {
      const elig = await this.defect.checkEligibility(look.contract!.id, dto.replacementProductId);
      // I1 — กติกาเปลี่ยนรุ่นเดิมของ engine คงเดิมทุกข้อ (spec §4.3): ผจก. ข้ามได้ "เฉพาะกรอบ 7 วัน"
      // (ตัดสินตอนยืนยัน) — เหตุผลอื่นทุกข้อ (PHONE_USED · สถานะสัญญา · เครดิตเทิร์น · เครื่องใหม่
      // ไม่พร้อมขาย · รุ่น/ความจุไม่ตรง) บล็อกตั้งแต่ตอนแจ้ง
      const blocking = elig.reasons.filter((r) => !WINDOW_REASON_RE.test(r));
      if (!elig.newProduct || blocking.length) {
        throw new BadRequestException(
          blocking[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย',
        );
      }
      replacementProduct = await this.prisma.product.findUnique({
        where: { id: dto.replacementProductId, deletedAt: null },
        select: { brand: true, model: true, storage: true, imeiSerial: true },
      });
    }

    const imei = look.product?.imeiSerial ?? dto.imei;
    if (dto.serviceRequestId)
      await this.chatLinks!.candidateForCreation(
        dto.serviceRequestId,
        {
          branchId: dto.branchId,
          customerId,
          productId: look.product?.id ?? null,
          contractId: look.contract?.id ?? null,
          saleId: look.sale?.id ?? null,
          deviceImei: imei,
        },
        user,
      );
    const id = randomUUID();
    const uploaded: string[] = [];
    const put = async (key: string, buf: Buffer, mime: string) => {
      await this.storage.upload(key, buf, mime);
      uploaded.push(key);
      return key;
    };

    let result: CreateCaseResult;
    let reusedChatCase = false;
    try {
      // R14: sequential — ทุก key ที่อัปโหลดสำเร็จต้องถูกจดไว้ใน `uploaded` ก่อนไฟล์ถัดไป
      // (Promise.all ปล่อยให้ upload ที่ยังไม่ resolve ตอนตัวอื่นพัง หลุดจากการ cleanup)
      const photoKeys: string[] = [];
      for (const f of files) {
        photoKeys.push(
          await put(
            `after-sales/${id}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(f.mimetype)}`,
            f.buffer,
            f.mimetype,
          ),
        );
      }

      const purchasePhotoKeys: string[] = [];
      for (const angle of ANGLES) {
        // สำเนา ProductPhoto (data URL) ณ วันแจ้ง — D6
        const dataUrl = look.purchasePhotos?.[angle];
        if (!dataUrl) continue;
        const [head, b64] = dataUrl.split(',');
        const mime = /^data:(image\/[a-z]+);base64$/.exec(head)?.[1] ?? 'image/jpeg';
        purchasePhotoKeys.push(
          await put(
            `after-sales/${id}/purchase-${angle}.${evidenceImageExtension(mime)}`,
            Buffer.from(b64, 'base64'),
            mime,
          ),
        );
      }

      result = await this.prisma.$transaction(async (tx) => {
        if (dto.serviceRequestId) {
          const existing = await this.chatLinks!.creationInTx(tx, dto.serviceRequestId, user);
          if (existing) {
            reusedChatCase = true;
            return existing;
          }
        }
        // R12 — re-check ภายใน tx ด้วย advisory lock ก่อน nextCaseNumber (กัน 2 คำขอพร้อมกันสำหรับ IMEI เดียวกัน
        // ทั้งคู่ผ่าน pre-tx fast-path แล้วคอมมิตสำเร็จทั้งคู่ — Review Focus 2)
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${hashLockKey(`as-imei:${imei}`)})`,
        );
        // A1 (final-fix brief) — โหลดผู้สมัคร stored-open ของ IMEI นี้พร้อมใบซ่อม แล้ว reconcile
        // ทีละแถวก่อนตัดสิน "ยังเปิดอยู่จริงไหม" — stage ที่เก็บไว้อาจดริฟท์จากใบซ่อมจริง (sync()
        // ของ proxy ไม่เคยรัน เพราะใบซ่อมถูกแก้นอก proxy) ไม่งั้น IMEI นี้จะถูกบล็อก 409 ตลอดไป
        // แม้เคสเก่าจะปิดไปแล้วจริง ๆ
        const candidates = await tx.afterSalesCase.findMany({
          where: { deviceImei: imei, deletedAt: null, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
          select: { ...RECONCILE_SELECT, caseNumber: true },
        });
        const reconciledCandidates = await Promise.all(
          candidates.map((c) => reconcileStage(tx, c)),
        );
        const stillOpen = reconciledCandidates.find(
          (c) => !['CLOSED', 'CANCELLED'].includes(c.stage),
        );
        if (stillOpen)
          throw new ConflictException(
            `เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${stillOpen.caseNumber}`,
          );

        const caseNumber = await this.docNumber.nextCaseNumber(tx);
        const receivedEvent = {
          kind: 'RECEIVED' as const,
          actorId: user.id,
          note: `รับเรื่องแล้ว · รูป ${photoKeys.length} · รูปตอนซื้อ ${purchasePhotoKeys.length}`,
        };

        if (dto.outcome === 'REPAIR') {
          const repairDto: CreateRepairTicketDto = {
            customerId,
            contractId: look.contract?.id,
            productId: look.product?.id,
            branchId: dto.branchId,
            deviceBrand: look.product?.brand ?? dto.deviceBrand,
            deviceModel: look.product?.model ?? dto.deviceModel,
            deviceImei: imei,
            deviceSerial: dto.deviceSerial,
            defectDescription: dto.symptom,
            payer: (dto.payer ?? outcome.payerDefault) as RepairPayerInput,
            estimatedCost: dto.estimatedCost,
            repairSupplierId: dto.repairSupplierId,
            notes: dto.note,
          };
          const { ticket } = await this.repair.createInTx(repairDto, user, tx);
          const c = await tx.afterSalesCase.create({
            data: {
              ...this.buildBaseCaseData({
                id,
                caseNumber,
                dto,
                customerId,
                look,
                user,
                deviceBrand: ticket.deviceBrand,
                deviceModel: ticket.deviceModel,
                deviceImei: ticket.deviceImei,
                deviceSerial: ticket.deviceSerial,
                photoKeys,
                purchasePhotoKeys,
              }),
              outcome: 'REPAIR',
              repairTicketId: ticket.id,
              stage: 'RECEIVED',
              events: {
                create: [
                  receivedEvent,
                  {
                    kind: 'OUTCOME_SET',
                    actorId: user.id,
                    note: `ซ่อม · ผู้จ่าย ${ticket.payer}${ticket.repairSupplierId ? ' · ส่งศูนย์' : ' · ซ่อมที่ร้าน'}`,
                  },
                ],
              },
            },
            select: { id: true, caseNumber: true, repairTicketId: true },
          });
          const repairResult: CreateCaseResult = {
            id: c.id,
            caseNumber: c.caseNumber,
            repairTicketId: c.repairTicketId,
            outcome: 'REPAIR',
            exchangeRequestId: null,
            stage: 'RECEIVED',
          };
          if (dto.serviceRequestId)
            await this.chatLinks!.linkInTx(tx, {
              requestId: dto.serviceRequestId,
              caseId: c.id,
              actor: user,
            });
          return repairResult;
        }

        // กิ่งเปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE) — ไม่เรียก repair.createInTx
        // events: RECEIVED เสมอ + OUTCOME_SET (ข้อความ (a)) · PRICED_EXCHANGE ปิด 410 ตั้งแต่ต้นเมธอด
        // (2026-10-06) จึงไม่มีกิ่ง submit หลัง commit อีกต่อไป
        const exchangeEvents = isSameModel
          ? [
              receivedEvent,
              {
                kind: 'OUTCOME_SET' as const,
                actorId: user.id,
                note: `เปลี่ยนรุ่นเดิม · รอ ผจก.สาขา ยืนยัน · เครื่องทดแทน ${replacementProduct?.brand ?? ''} ${replacementProduct?.model ?? ''} ${replacementProduct?.storage ?? ''} IMEI ${replacementProduct?.imeiSerial ?? ''}`,
              },
            ]
          : [receivedEvent];
        const c = await tx.afterSalesCase.create({
          data: {
            ...this.buildBaseCaseData({
              id,
              caseNumber,
              dto,
              customerId,
              look,
              user,
              deviceBrand: look.product?.brand ?? dto.deviceBrand,
              deviceModel: look.product?.model ?? dto.deviceModel,
              deviceImei: imei,
              deviceSerial: dto.deviceSerial,
              photoKeys,
              purchasePhotoKeys,
            }),
            outcome: dto.outcome,
            repairTicketId: null,
            replacementProductId: dto.replacementProductId,
            stage: 'AWAITING_APPROVAL',
            events: { create: exchangeEvents },
          },
          select: { id: true, caseNumber: true },
        });
        const exchangeResult: CreateCaseResult = {
          id: c.id,
          caseNumber: c.caseNumber,
          repairTicketId: null,
          outcome: dto.outcome,
          exchangeRequestId: null,
          stage: 'AWAITING_APPROVAL',
        };
        if (dto.serviceRequestId)
          await this.chatLinks!.linkInTx(tx, {
            requestId: dto.serviceRequestId,
            caseId: c.id,
            actor: user,
          });
        return exchangeResult;
      });
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }

    // A competing request may have uploaded temporary images before winning the room lock.
    // Discard only this attempt's uploads and skip all document/LINE/exchange side effects.
    if (reusedChatCase) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      return result;
    }

    // R13 — audit.log อยู่นอก try/catch: ถ้ามันเองพังหลัง tx commit แล้ว ต้องไม่ไปลบรูปของ
    // เคสที่บันทึกสำเร็จแล้ว (catch ด้านบนมีไว้กัน storage/tx เท่านั้น)
    await this.audit.log({
      userId: user.id,
      action: 'AFTER_SALES_CASE_CREATED',
      entity: 'after_sales_case',
      entityId: result.id,
      newValue: {
        caseNumber: result.caseNumber,
        outcome: dto.outcome,
        repairTicketId: result.repairTicketId,
        exchangeRequestId: result.exchangeRequestId,
      },
    });

    // Task 3 — จังหวะ 1 (RECEIVED): หลัง commit + audit เสมอ — ทุก outcome ที่ยังเปิด (REPAIR = RECEIVED ·
    // SAME_MODEL = AWAITING_APPROVAL; PRICED_EXCHANGE ปิด 410 ตั้งแต่ต้นเมธอด จึงไม่มีจังหวะ READY/CLOSED
    // ต่อท้ายตอนสร้างเคสอีก). fire-and-forget: LINE ล้มต้องไม่ทำให้การบันทึกล้ม (Global Constraints) —
    // `.catch` เป็นเข็มขัดคู่กับ notifyMoment เองที่ไม่ throw.
    void this.line.notifyMoment(result.id, 'RECEIVED', user.id).catch(() => undefined);

    return result;
  }
}
