import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../audit/audit.service';
import { InstallmentInputVatTemplate } from '../../journal/cpa-templates/installment-input-vat.template';
import { claimPendingInputVatForReceiving, ClaimedForReceiving } from '../../journal/input-vat/installment-input-vat.claim';
import { normalizeSupplierDoc } from './supplier-doc.util';
import { evidenceImageExtension, isEvidenceImage } from '../../../utils/upload-image.util';
import { bkkYyyymmdd } from '../../../utils/document-number-format.util';
import { bangkokDateString } from '../../../utils/date.util';
import { RecordTaxInvoiceDto } from '../dto/create-po.dto';

export interface TaxInvoiceActor { id: string; role: string }
const EDIT_ROLES = ['OWNER', 'ACCOUNTANT'];

/**
 * ผู้แพ้ของการกดพร้อมกันใต้ Serializable: P2034 (SSI abort จาก Prisma query) · P2002 (unique index ของ JE) ·
 * **P2010** = `$queryRaw` (`SELECT … FOR UPDATE`) ล้มด้วย Postgres `40001` (could not serialize access due to concurrent update)
 * หรือ `40P01` (deadlock) — Prisma ห่อ error ของ raw query เป็น P2010 ไม่ใช่ P2034 (พิสูจน์ด้วย integration เคส 7)
 */
export function isConcurrentWriteConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034' || err.code === 'P2002') return true;
  if (err.code === 'P2010') {
    const pg = (err.meta as { code?: unknown } | undefined)?.code;
    return pg === '40001' || pg === '40P01';
  }
  return false;
}

/**
 * ก้อน 5 (Q1/Q2) — ใบกำกับภาษีที่มาหลังรับของ (ใบรับของเป็นใบส่งของ/บิลเงินสด/ไม่มีเอกสาร).
 * บันทึกเลข/วันที่/รูป แล้วเคลมย้อนสัญญาที่ `PENDING_INVOICE` ของทุกเครื่องในใบ **ใน tx เดียวกัน** (ล็อกแถวใบรับของกันกดซ้ำ).
 * ตรวจเลขซ้ำของผู้จัดจำหน่ายเดิมเป็นเรื่องของหน้าจอ (`GET /purchase-orders/receiving-doc-check`) — ไม่บล็อกที่นี่ (กติกาเดียวกับตอนรับของ)
 */
@Injectable()
export class GoodsReceivingTaxInvoiceService {
  private readonly logger = new Logger(GoodsReceivingTaxInvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inputVatTemplate: InstallmentInputVatTemplate,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async record(poId: string, receivingId: string, dto: RecordTaxInvoiceDto, photo: Express.Multer.File | undefined, actor: TaxInvoiceActor) {
    const now = new Date();
    const doc = normalizeSupplierDoc({ supplierDocType: 'TAX_INVOICE', supplierDocNumber: dto.number, supplierDocDate: dto.date }, now);
    if (photo && !isEvidenceImage(photo)) throw new BadRequestException('รูปใบกำกับภาษีต้องเป็น JPEG, PNG หรือ WEBP');

    const before = await this.prisma.goodsReceiving.findFirst({
      where: { id: receivingId, poId, deletedAt: null },
      include: { po: { select: { id: true, poNumber: true, supplier: { select: { id: true, name: true, hasVat: true } } } } },
    });
    if (!before) throw new NotFoundException('ไม่พบใบรับของ');
    if (before.supplierDocType === 'TAX_INVOICE') throw new BadRequestException('ใบรับของนี้รับด้วยใบกำกับภาษีอยู่แล้ว');
    if (!before.po.supplier.hasVat) throw new BadRequestException('ผู้จัดจำหน่ายไม่จด VAT — ไม่มีภาษีซื้อให้เคลม');
    const isUpdate = !!before.taxInvoiceNumber;
    if (isUpdate && !EDIT_ROLES.includes(actor.role)) {
      throw new ForbiddenException('แก้ใบกำกับที่บันทึกแล้วได้เฉพาะเจ้าของหรือฝ่ายบัญชี');
    }

    let photoKey: string | null = null;
    if (photo) {
      photoKey = `goods-receivings/tax-invoices/${bkkYyyymmdd(now)}/${randomUUID()}.${evidenceImageExtension(photo.mimetype)}`;
      await this.storage.upload(photoKey, photo.buffer, photo.mimetype);
    }

    let claimed: ClaimedForReceiving[] = [];
    let accountingNotified = false;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM goods_receivings WHERE id = ${receivingId} FOR UPDATE`;
          const fresh = await tx.goodsReceiving.findFirst({ where: { id: receivingId, deletedAt: null }, select: { taxInvoiceNumber: true } });
          if (!fresh) throw new NotFoundException('ไม่พบใบรับของ');
          if (!!fresh.taxInvoiceNumber && !EDIT_ROLES.includes(actor.role)) {
            throw new ForbiddenException('แก้ใบกำกับที่บันทึกแล้วได้เฉพาะเจ้าของหรือฝ่ายบัญชี');
          }
          await tx.goodsReceiving.update({
            where: { id: receivingId },
            data: {
              taxInvoiceNumber: doc.number,
              taxInvoiceDate: doc.date,
              taxInvoicePhotoKey: photoKey ?? before.taxInvoicePhotoKey ?? null,
              taxInvoiceRecordedAt: now,
              taxInvoiceRecordedById: actor.id,
            },
          });
          const result = await claimPendingInputVatForReceiving(tx, this.inputVatTemplate, { receivingId, now, actorId: actor.id });
          claimed = result.claimed;
          accountingNotified = result.accountingNotified;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
      );
    } catch (err) {
      if (photoKey) await this.storage.delete(photoKey).catch((e) => this.logger.warn(`ลบรูปที่อัปโหลดค้างไม่สำเร็จ ${photoKey}: ${(e as Error).message}`));
      if (isConcurrentWriteConflict(err)) {
        throw new ConflictException('มีการบันทึกใบกำกับของใบรับของนี้พร้อมกัน — กรุณาโหลดหน้าใหม่แล้วตรวจผล');
      }
      throw err;
    }

    await this.audit.log({
      userId: actor.id,
      action: isUpdate ? 'GOODS_RECEIVING_TAX_INVOICE_UPDATED' : 'GOODS_RECEIVING_TAX_INVOICE_RECORDED',
      entity: 'goods_receiving',
      entityId: receivingId,
      ...(isUpdate ? { oldValue: { taxInvoiceNumber: before.taxInvoiceNumber, taxInvoiceDate: before.taxInvoiceDate ? bangkokDateString(before.taxInvoiceDate) : null } } : {}),
      newValue: { grNumber: before.grNumber, poNumber: before.po.poNumber, taxInvoiceNumber: doc.number, taxInvoiceDate: bangkokDateString(doc.date!), photoKey, claimed: claimed.map((c) => c.contractNumber), accountingNotified },
    });

    return {
      receiving: { id: before.id, grNumber: before.grNumber, taxInvoice: { number: doc.number!, date: bangkokDateString(doc.date!), source: 'LATER' as const } },
      claimed,
      accountingNotified,
    };
  }
}
