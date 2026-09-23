import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import {
  CreateRepairTicketDto,
  RepairPayerInput,
} from '../../repair-tickets/dto/create-repair-ticket.dto';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService } from './after-sales-lookup.service';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';
import { hashLockKey } from '../../../utils/advisory-lock.util';

type ReqUser = { id: string; role: string; branchId?: string | null };

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

export interface CreateCaseResult {
  id: string;
  caseNumber: string;
  repairTicketId: string | null;
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
  ) {}

  async createCase(dto: CreateCaseDto, files: Express.Multer.File[], user: ReqUser) {
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
        const dup = await tx.afterSalesCase.findFirst({
          where: { deviceImei: imei, deletedAt: null, stage: { notIn: ['CLOSED', 'CANCELLED'] } },
          select: { caseNumber: true },
        });
        if (dup)
          throw new ConflictException(`เครื่องนี้มีเคสที่ยังไม่ปิดอยู่แล้ว: ${dup.caseNumber}`);

        const caseNumber = await this.docNumber.nextCaseNumber(tx);
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
            id,
            caseNumber,
            branchId: dto.branchId,
            customerId,
            source: look.source,
            contractId: look.contract?.id ?? null,
            saleId: look.sale?.id ?? null,
            productId: look.product?.id ?? null,
            deviceBrand: ticket.deviceBrand,
            deviceModel: ticket.deviceModel,
            deviceImei: ticket.deviceImei,
            deviceSerial: ticket.deviceSerial,
            symptom: dto.symptom,
            accessories: dto.accessories ?? {},
            unlockConfirmed: dto.unlockConfirmed,
            photoKeys,
            purchasePhotoKeys,
            warrantySnapshot: {
              ...look.warranty,
              within7Days: look.warranty.daysRemainingIn7Day > 0,
            },
            outcome: 'REPAIR',
            repairTicketId: ticket.id,
            stage: 'RECEIVED',
            receivedById: user.id,
            events: {
              create: [
                {
                  kind: 'RECEIVED',
                  actorId: user.id,
                  note: `รับเรื่องแล้ว · รูป ${photoKeys.length} · รูปตอนซื้อ ${purchasePhotoKeys.length}`,
                },
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
        return c;
      });
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
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
        outcome: 'REPAIR',
        repairTicketId: result.repairTicketId,
      },
    });
    return result;
  }
}
