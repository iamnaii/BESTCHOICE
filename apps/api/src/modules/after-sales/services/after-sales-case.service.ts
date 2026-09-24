import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
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
import { ContractExchangeService } from '../../contract-exchange/contract-exchange.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService, LookupResult } from './after-sales-lookup.service';
import { reconcileStage } from './after-sales-stage-reconcile';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';
import { hasCrossBranchAccess } from '../../auth/branch-access.util';

type ReqUser = { id: string; role: string; branchId?: string | null };

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

// R28 (Task 4) — regex ที่จับเฉพาะเหตุผลเกี่ยวกับ "เครื่องใหม่" (ไม่พร้อมขาย / รุ่น-ความจุไม่ตรง)
// จาก DefectExchangeService.checkEligibility ห้ามจับเหตุผลเรื่องกรอบ 7 วัน/สถานะสัญญา —
// สองอย่างนั้นเป็นของที่ผจก.สาขาตัดสินตอนยืนยัน ไม่ใช่ตอนยื่นเรื่อง (ดู task-4-brief.md)
export const NEW_PRODUCT_REASON_RE = /สินค้าใหม่ไม่พร้อมจำหน่าย|รุ่น\/ความจุ ไม่ตรงกับของเดิม/;

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
    private readonly contractExchange: ContractExchangeService,
    private readonly defect: DefectExchangeService,
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
    // R16 (fix round 1, Critical) — BranchGuard อ่าน request.body?.branchId แต่ guards รันก่อน
    // FilesInterceptor แกะ multipart/form-data เสร็จ ⇒ ตอนถึง guard body ยังว่าง (ไม่มี branchId
    // ให้เห็น) จึงปล่อยผ่านเสมอบน POST /after-sales — ต้องบังคับ scope สาขาที่ service เอง ก่อนแตะ
    // storage/lookup/tx ใด ๆ (แบบเดียวกับ security.md "Branch scope บน route ที่มีแต่ :id")
    if (!hasCrossBranchAccess(user) && dto.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
    }
    if (!files?.length) throw new BadRequestException('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป');
    if (files.length > MAX_INTAKE_PHOTOS) {
      throw new BadRequestException(`รูปตอนรับฝากได้ไม่เกิน ${MAX_INTAKE_PHOTOS} รูป`);
    }
    files.forEach((f) => assertEvidenceImage(f, 'รูปตอนรับฝาก'));

    const look = await this.lookupSvc.lookup({ imei: dto.imei }, user);
    // R12 fast path — เช็คซ้ำอีกครั้งใน tx ด้วย advisory lock ก่อนสร้างจริง (กัน TOCTOU)
    if (look.openCase) {
      throw new ConflictException(
        `เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${look.openCase.caseNumber}`,
      );
    }
    const customerId = look.customer?.id ?? dto.customerId;
    if (!customerId) throw new BadRequestException('ไม่พบเครื่องในระบบ — ต้องเลือกลูกค้า');
    const outcome = look.outcomes.find((o) => o.outcome === dto.outcome);
    if (!outcome?.enabled)
      throw new BadRequestException(outcome?.reason ?? 'ทางออกนี้ทำไม่ได้กับเครื่องนี้');

    // Task 4 — เปิดทางออกเปลี่ยนเครื่องตอนแจ้งปัญหา (SAME_MODEL_EXCHANGE / PRICED_EXCHANGE)
    const isSameModel = dto.outcome === 'SAME_MODEL_EXCHANGE';
    const isPriced = dto.outcome === 'PRICED_EXCHANGE';
    if ((isSameModel || isPriced) && !dto.replacementProductId) {
      throw new BadRequestException('ต้องเลือกเครื่องทดแทนจากสต๊อก');
    }
    if ((isSameModel || isPriced) && !look.contract) {
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
      // อ่านข้อความจริงใน defect-exchange.service.ts checkEligibility ก่อนแล้ว — จับเฉพาะเหตุผล
      // เกี่ยวกับ "เครื่องใหม่" (ไม่พร้อมขาย/รุ่น-ความจุไม่ตรง) ไม่ใช่กรอบ 7 วัน/สถานะสัญญา ซึ่งเป็น
      // สิ่งที่ผจก.สาขาตัดสินตอนยืนยัน ไม่ใช่ตอนยื่นเรื่อง
      const productReasons = elig.reasons.filter((r) => NEW_PRODUCT_REASON_RE.test(r));
      if (!elig.newProduct || productReasons.length) {
        throw new BadRequestException(
          productReasons[0] ?? 'เครื่องทดแทนไม่ตรงรุ่น/ความจุ หรือไม่พร้อมขาย',
        );
      }
      replacementProduct = await this.prisma.product.findUnique({
        where: { id: dto.replacementProductId, deletedAt: null },
        select: { brand: true, model: true, storage: true, imeiSerial: true },
      });
    }

    const imei = look.product?.imeiSerial ?? dto.imei;
    const id = randomUUID();
    const uploaded: string[] = [];
    const put = async (key: string, buf: Buffer, mime: string) => {
      await this.storage.upload(key, buf, mime);
      uploaded.push(key);
      return key;
    };

    let result: CreateCaseResult;
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
          select: {
            id: true,
            caseNumber: true,
            stage: true,
            outcome: true,
            cancelledAt: true,
            closedAt: true,
            replacementContractId: true,
            repairTicket: { select: { status: true, deletedAt: true, returnedToCustomerAt: true } },
            exchangeRequest: {
              select: {
                status: true,
                mode: true,
                memoAppliedAt: true,
                rejectionReason: true,
                cancelReason: true,
                newContract: { select: { status: true } },
              },
            },
          },
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
          return repairResult;
        }

        // กิ่งเปลี่ยนเครื่อง (SAME_MODEL_EXCHANGE / PRICED_EXCHANGE) — ไม่เรียก repair.createInTx
        // events: RECEIVED เสมอ + OUTCOME_SET เฉพาะ SAME_MODEL (ข้อความ (a)) — PRICED_EXCHANGE
        // ยังไม่รู้ mode/tier ตอนนี้ (ต้องรอ contractExchange.submit หลัง tx commit) จึงเติม
        // OUTCOME_SET ของมันทีหลังผ่าน update() แทน (ดู (d))
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
        return exchangeResult;
      });
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }

    // Task 4 — PRICED_EXCHANGE: ยื่นคำขอเปลี่ยนเครื่องแบบมีราคาหลัง tx commit (นอก try/catch ของรูป
    // ด้านบน — Review Focus 3). ทำไม compensation ไม่ใช่ tx เดียว: contractExchange.submit() เปิด
    // $transaction ของตัวเองและมี preview/ราคากลางภายใน ไม่แตะ engine ตามข้อจำกัด · เคสที่ถูกยกเลิก
    // ยังอยู่เป็นประวัติ (IMEI เปิดใหม่ได้เพราะ stage CANCELLED) รูปที่อัปโหลดไปแล้วไม่ถูกลบ
    if (isPriced) {
      // R30 (fix round 1, Important — ruling P-G) — เฉพาะ submit() เท่านั้นที่อยู่ใน try/catch
      // ของ compensation นี้: ถ้า submit() เองล้มเหลว คำขอเปลี่ยนเครื่องไม่เคยถูกสร้างขึ้นจริง
      // จึงยกเลิกเคสเป็น CANCELLED ได้อย่างปลอดภัย. แต่ถ้า submit() สำเร็จแล้ว (คำขอถูกสร้างจริง
      // ในอีก $transaction หนึ่ง) การ update ที่ตามมาเป็นเพียงการ "เชื่อมโยง" exchangeRequestId
      // กลับมาไว้บนเคส — ถ้า update นี้พังทีหลัง ต้องปล่อยให้ error หลุดออกไปตามจริง (เคสค้างที่
      // AWAITING_APPROVAL) ไม่ใช่ไปยกเลิกเคสเป็น CANCELLED เพราะคำขอที่สร้างไปแล้วจะกลายเป็น
      // คำขอกำพร้า (ไม่มีเคสไหนอ้างถึง) ในขณะที่ข้อความบอกผู้ใช้ว่า "ยื่นคำขอไม่สำเร็จ" ซึ่งไม่จริง
      let req: { id: string; mode: string; approvalTier: string | null };
      try {
        req = await this.contractExchange.submit(
          {
            oldContractId: look.contract!.id,
            oldProductId: look.product!.id,
            newProductId: dto.replacementProductId!,
            conditionNote: dto.conditionNote ?? dto.symptom,
            buybackPrice: dto.buybackPrice,
            deviceCondition: dto.deviceCondition,
            newTotalMonths: dto.newTotalMonths,
            newInterestRate: dto.newInterestRate,
          },
          user,
        );
      } catch (err) {
        const reason = `ยื่นคำขอไม่สำเร็จ: ${
          err instanceof HttpException
            ? ((err.getResponse() as any)?.message ?? err.message)
            : 'ระบบขัดข้อง'
        }`;
        await this.prisma.afterSalesCase.update({
          where: { id: result.id },
          data: {
            stage: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: reason,
            events: { create: { kind: 'CANCELLED', actorId: user.id, note: reason } },
          },
        });
        throw err;
      }

      // เชื่อมโยง exchangeRequestId กลับมาไว้บนเคส — อยู่นอก try/catch ด้านบนโดยตั้งใจ (ดูคอมเมนต์)
      await this.prisma.afterSalesCase.update({
        where: { id: result.id },
        data: {
          exchangeRequestId: req.id,
          events: {
            create: {
              kind: 'OUTCOME_SET',
              actorId: user.id,
              note: `เปลี่ยนแบบมีราคา · ${req.mode} · tier ${req.approvalTier ?? '-'}`,
            },
          },
        },
      });
      result = { ...result, exchangeRequestId: req.id };
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
      },
    });
    return result;
  }
}
