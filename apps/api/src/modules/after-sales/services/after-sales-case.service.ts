import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { AfterSalesDocNumberService } from './after-sales-doc-number.service';
import { AfterSalesLookupService } from './after-sales-lookup.service';
import { CreateCaseDto } from '../dto/create-case.dto';
import { assertEvidenceImage, evidenceImageExtension } from '../../../utils/upload-image.util';

type ReqUser = { id: string; role: string; branchId?: string | null };

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export const MAX_INTAKE_PHOTOS = 6;

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

    const id = randomUUID();
    const uploaded: string[] = [];
    const put = async (key: string, buf: Buffer, mime: string) => {
      await this.storage.upload(key, buf, mime);
      uploaded.push(key);
      return key;
    };

    try {
      const photoKeys = await Promise.all(
        files.map((f) =>
          put(
            `after-sales/${id}/intake-${Date.now()}-${randomUUID()}.${evidenceImageExtension(f.mimetype)}`,
            f.buffer,
            f.mimetype,
          ),
        ),
      );

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

      const result = await this.prisma.$transaction(async (tx) => {
        const caseNumber = await this.docNumber.nextCaseNumber(tx);
        const { ticket } = await this.repair.createInTx(
          {
            customerId,
            contractId: look.contract?.id,
            productId: look.product?.id,
            branchId: dto.branchId,
            deviceBrand: look.product?.brand ?? dto.deviceBrand,
            deviceModel: look.product?.model ?? dto.deviceModel,
            deviceImei: look.product?.imeiSerial ?? dto.imei,
            deviceSerial: dto.deviceSerial,
            defectDescription: dto.symptom,
            payer: dto.payer ?? outcome.payerDefault,
            estimatedCost: dto.estimatedCost,
            repairSupplierId: dto.repairSupplierId,
            notes: dto.note,
          } as never,
          user,
          tx,
        );
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
    } catch (err) {
      await Promise.all(uploaded.map((k) => this.storage.delete(k).catch(() => undefined)));
      throw err;
    }
  }
}
