import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'stream';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AfterSalesQueryService } from './after-sales-query.service';
import { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';
import { buildAfterSalesDocHtml, type DocCompany } from '../documents/after-sales-doc-html';
import {
  composeHandoverDoc,
  composeReceiptDoc,
  handoverBlockReason,
  PHOTO_ANGLES,
  type DocPayer,
  type DocSource,
} from '../documents/after-sales-doc-compose';

type ReqUser = { id: string; role: string; branchId?: string | null };
type CaseDetail = Awaited<ReturnType<AfterSalesQueryService['getCase']>>;
export type AfterSalesDocKind = 'RECEIPT' | 'HANDOVER';

const DOC_NOTE: Record<AfterSalesDocKind, string> = {
  RECEIPT: 'ใบรับฝากเครื่อง',
  HANDOVER: 'ใบส่งมอบ',
};
const PRINT_DEDUPE_MS = 5 * 60 * 1000;
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const CONDITION_TEXT: Record<string, string> = { PHONE_USED: 'มือสอง', PHONE_NEW: 'เครื่องใหม่' };

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const toDate = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? new Date(v)
    : v instanceof Date
      ? v
      : null;

const label = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ');

/**
 * ใบรับฝากเครื่อง / ใบส่งมอบ (PR 4, สเปก 6) — `GET /after-sales/:id/receipt.pdf` | `/handover.pdf`.
 * ขอบเขตสาขา + stage จริงมาจาก `getCase` เสมอ (route มีแต่ :id — security.md) และต้องผ่านก่อนแตะ
 * storage หรือ Chromium · การพิมพ์ลงไทม์ไลน์เป็น `AfterSalesEvent` kind PRINTED (กันซ้ำ 5 นาที)
 */
@Injectable()
export class AfterSalesDocumentService {
  private readonly logger = new Logger(AfterSalesDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly query: AfterSalesQueryService,
    private readonly renderer: AfterSalesPdfRenderer,
  ) {}

  async render(
    caseId: string,
    kind: AfterSalesDocKind,
    user: ReqUser,
  ): Promise<{ pdf: Buffer; caseNumber: string }> {
    const c = await this.query.getCase(caseId, user);
    if (kind === 'HANDOVER') {
      const reason = handoverBlockReason({
        outcome: c.outcome,
        stage: c.stage,
        hasRepairTicket: !!c.repairTicket && !c.repairTicket.deletedAt,
      });
      if (reason) throw new BadRequestException(reason);
    }
    const source = await this.loadSource(c, kind, user);
    const doc = kind === 'RECEIPT' ? composeReceiptDoc(source) : composeHandoverDoc(source);
    const pdf = await this.renderer.htmlToPdf(buildAfterSalesDocHtml(doc));
    await this.recordPrinted(caseId, kind, user.id);
    return { pdf, caseNumber: c.caseNumber };
  }

  private async loadSource(
    c: CaseDetail,
    kind: AfterSalesDocKind,
    user: ReqUser,
  ): Promise<DocSource> {
    const ex = c.exchange;
    const [row, printer, company, contract, sale, product, newContract, newProduct] =
      await Promise.all([
        this.prisma.afterSalesCase.findUniqueOrThrow({
          where: { id: c.id },
          select: { photoKeys: true },
        }),
        this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
        this.loadCompany(c.branchId),
        c.contractId
          ? this.prisma.contract.findUnique({
              where: { id: c.contractId },
              select: { contractNumber: true, shopWarrantyEndDate: true },
            })
          : null,
        c.saleId
          ? this.prisma.sale.findUnique({ where: { id: c.saleId }, select: { saleNumber: true } })
          : null,
        c.productId
          ? this.prisma.product.findUnique({
              where: { id: c.productId },
              select: { color: true, category: true, warrantyExpireDate: true },
            })
          : null,
        kind === 'HANDOVER' && ex?.replacementContract
          ? this.prisma.contract.findUnique({
              where: { id: ex.replacementContract.id },
              select: { contractNumber: true, shopWarrantyEndDate: true },
            })
          : null,
        kind === 'HANDOVER' && ex?.newProduct
          ? this.prisma.product.findUnique({
              where: { id: ex.newProduct.id },
              select: { color: true, category: true, warrantyExpireDate: true },
            })
          : null,
      ]);
    const photos = kind === 'RECEIPT' ? await this.loadPhotos(row.photoKeys) : [];
    const w = (c.warrantySnapshot ?? {}) as Record<string, unknown>;
    const a = (c.accessories ?? {}) as Record<string, unknown>;
    const t = c.repairTicket && !c.repairTicket.deletedAt ? c.repairTicket : null;
    const shopWarrantyEnd = toDate(w.shopWarrantyEndDate);

    return {
      company,
      caseNumber: c.caseNumber,
      branchName: c.branch.name,
      receivedAt: c.receivedAt,
      receivedByName: c.receivedBy.name,
      printedAt: new Date(),
      printedByName: printer?.name ?? '—',
      customerName: c.customer.name,
      customerPhone: c.customer.phone ?? null,
      lineLinked: c.lineLinked,
      source: c.source,
      contractNumber: contract?.contractNumber ?? null,
      saleNumber: sale?.saleNumber ?? null,
      deviceLabel: label(
        [c.deviceBrand, c.deviceModel].filter(Boolean).join(' ') || 'ไม่ระบุรุ่น',
        product?.color,
        product ? CONDITION_TEXT[product.category] : null,
      ),
      deviceImei: c.deviceImei,
      deviceSerial: c.deviceSerial,
      accessories: {
        box: a.box === true,
        charger: a.charger === true,
        case: a.case === true,
        other: typeof a.other === 'string' && a.other.trim() ? a.other.trim() : null,
      },
      unlockConfirmed: c.unlockConfirmed,
      symptom: c.symptom,
      photoCount: row.photoKeys.length,
      photos,
      warranty: {
        purchasedAt: toDate(w.purchasedAt),
        shopWarrantyEnd,
        manufacturerWarrantyEnd: toDate(w.manufacturerWarrantyEndDate),
        within7Days:
          w.within7Days === true ||
          (typeof w.daysRemainingIn7Day === 'number' && w.daysRemainingIn7Day > 0),
      },
      outcome: c.outcome,
      stage: c.stage,
      closedAt: c.closedAt,
      repair: t
        ? {
            payer: t.payer as DocPayer,
            estimatedCost: t.estimatedCost ? t.estimatedCost.toString() : null,
            actualCost: t.actualCost ? t.actualCost.toString() : null,
            supplierName: t.repairSupplier?.name ?? null,
            externalClaimNo: t.externalClaimNo,
            sentToRepairAt: t.sentToRepairAt,
            repairedAt: t.repairedAt,
            returnedToCustomerAt: t.returnedToCustomerAt,
          }
        : null,
      exchange: ex
        ? {
            mode: ex.mode ?? null,
            // confirmSameModel ของเคส REPAIR (ซ่อมไม่ได้) ส่ง originRepairTicketId → DefectExchangeService
            // เรียก markReplaced ⇒ ใบซ่อมของเคสเป็น REPLACED (เคสเปลี่ยนรุ่นเดิมปกติไม่มีใบซ่อม)
            fromRepair: t?.status === 'REPLACED',
            oldDeviceLabel: ex.oldProduct
              ? [ex.oldProduct.brand, ex.oldProduct.model, ex.oldProduct.storage]
                  .filter(Boolean)
                  .join(' ')
              : [c.deviceBrand, c.deviceModel].filter(Boolean).join(' ') || 'ไม่ระบุรุ่น',
            oldImei: ex.oldProduct?.imeiSerial ?? c.deviceImei,
            newDeviceLabel: ex.newProduct
              ? label(
                  [ex.newProduct.brand, ex.newProduct.model, ex.newProduct.storage]
                    .filter(Boolean)
                    .join(' '),
                  newProduct?.color,
                )
              : null,
            newImei: ex.newProduct?.imeiSerial ?? null,
            replacementContractNumber:
              newContract?.contractNumber ?? ex.replacementContract?.contractNumber ?? null,
            newShopWarrantyEnd:
              newContract?.shopWarrantyEndDate ?? contract?.shopWarrantyEndDate ?? shopWarrantyEnd,
            newManufacturerWarrantyEnd: newProduct?.warrantyExpireDate ?? null,
          }
        : null,
    };
  }

  private async loadCompany(branchId: string): Promise<DocCompany> {
    const select = { nameTh: true, address: true, taxId: true, phone: true } as const;
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { company: { select } },
    });
    const company =
      branch?.company ??
      (await this.prisma.companyInfo.findFirst({
        where: { companyCode: 'SHOP', deletedAt: null },
        select,
      }));
    return company ?? { nameTh: 'BESTCHOICE', address: '', taxId: '', phone: null };
  }

  /** อ่านทีละรูป (หน่วยความจำไม่พุ่ง) · อ่านไม่ได้ = null → ช่อง "เปิดรูปไม่ได้" ไม่ทำให้ PDF ล้ม */
  private async loadPhotos(keys: string[]): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (const key of keys.slice(0, PHOTO_ANGLES.length)) {
      const mime = MIME_BY_EXT[key.split('.').pop()?.toLowerCase() ?? ''];
      if (!mime) {
        out.push(null);
        continue;
      }
      try {
        const buf = await readAll(await this.storage.getStream(key));
        out.push(`data:${mime};base64,${buf.toString('base64')}`);
      } catch (err) {
        this.logger.warn(
          `after-sales photo unreadable for PDF: ${key} (${(err as Error).message})`,
        );
        out.push(null);
      }
    }
    return out;
  }

  private async recordPrinted(caseId: string, kind: AfterSalesDocKind, actorId: string) {
    const note = DOC_NOTE[kind];
    try {
      const recent = await this.prisma.afterSalesEvent.findFirst({
        where: {
          caseId,
          kind: 'PRINTED',
          note,
          actorId,
          createdAt: { gte: new Date(Date.now() - PRINT_DEDUPE_MS) },
        },
        select: { id: true },
      });
      if (recent) return;
      await this.prisma.afterSalesEvent.create({
        data: { caseId, kind: 'PRINTED', note, actorId },
      });
    } catch (err) {
      this.logger.warn(
        `after-sales PRINTED event not recorded for ${caseId}: ${(err as Error).message}`,
      );
    }
  }
}
