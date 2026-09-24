import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { computeOutcomes, OutcomeOption } from '../utils/after-sales-outcomes.util';
import { reconcileStage } from './after-sales-stage-reconcile';
import { LookupDto } from '../dto/lookup.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

export interface LookupResult {
  found: boolean;
  source: 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
  product: {
    id: string;
    brand: string;
    model: string;
    storage?: string | null;
    imeiSerial: string | null;
  } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  contract: { id: string; contractNumber: string; status: string } | null;
  sale: { id: string; saleType: string } | null;
  warranty: {
    status: string;
    daysRemainingIn7Day: number;
    purchasedAt: string | null;
    shopWarrantyEndDate: string | null;
    manufacturerWarrantyEndDate: string | null;
    checkedAt: string;
  };
  purchasePhotos: {
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    top: string | null;
    bottom: string | null;
  } | null; // data URL จาก ProductPhoto (null = ไม่มีรูปตอนซื้อ)
  openCase: { id: string; caseNumber: string; stage: string } | null; // เคสที่ยังไม่ปิดของ IMEI นี้ (กันเปิดซ้ำ)
  outcomes: OutcomeOption[];
}

/** แปลง Date | null → ISO string | null — lookupByImei คืน Date จริง แต่ LookupResult ประกาศเป็น string เพื่อให้ serialize ข้าม HTTP ได้ตรงกันเสมอ */
function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

@Injectable()
export class AfterSalesLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repair: RepairTicketsService,
    private readonly defect: DefectExchangeService,
    private readonly photos: ProductPhotosService,
  ) {}

  async lookup(dto: LookupDto, user: ReqUser): Promise<LookupResult> {
    // C7 (final-fix brief) — ข้อความเดิม "เลือกเครื่องก่อน (productId)" ชี้ไปหน้าจอค้นด้วยลูกค้า
    // ที่ PR 1 ไม่มี UI รองรับจริง (มีแค่ query param `productId` ใน DTO เผื่ออนาคต) — เปลี่ยนเป็น
    // ข้อความที่ตรงกับสิ่งที่ผู้ใช้ทำได้จริงวันนี้ (ค้นด้วย IMEI เท่านั้น)
    if (!dto.imei) throw new NotFoundException('ไม่พบเครื่องจากเลข IMEI นี้ — ตรวจเลข IMEI แล้วลองใหม่');
    const r = await this.repair.lookupByImei(dto.imei, user);
    const checkedAt = new Date().toISOString();
    if (!r.found) {
      return {
        found: false,
        source: 'WALK_IN',
        product: null,
        customer: null,
        contract: null,
        sale: null,
        purchasePhotos: null,
        openCase: null,
        warranty: {
          status: 'WALK_IN',
          daysRemainingIn7Day: 0,
          purchasedAt: null,
          shopWarrantyEndDate: null,
          manufacturerWarrantyEndDate: null,
          checkedAt,
        },
        outcomes: computeOutcomes({
          source: 'WALK_IN',
          warrantyStatus: 'WALK_IN',
          daysRemainingIn7Day: 0,
          defectEligible: false,
          defectReasons: [],
          viewerRole: user.role,
        }),
      };
    }

    const source = r.contract ? 'INSTALLMENT_CONTRACT' : r.sale ? 'CASH_SALE' : 'WALK_IN'; // Review Focus 1: พบเครื่องแต่ไม่มีใบขาย/สัญญา = walk-in
    let defectEligible = false;
    let defectReasons: string[] = [];
    if (r.contract) {
      // R10: checkEligibility can throw (e.g. NotFoundException('ไม่พบสัญญา') on a
      // race where the contract was deleted between lookupByImei and here) — a
      // throw here must not fail this whole read-only lookup. Fail closed:
      // treat as ineligible and surface the error message as the disabled reason.
      try {
        const e = await this.defect.checkEligibility(r.contract.id);
        defectEligible = e.eligible;
        defectReasons = e.reasons;
      } catch (err) {
        defectEligible = false;
        // C8 (final-fix brief) — whitelist เฉพาะ HttpException (ข้อความที่ตั้งใจสื่อสารกับผู้ใช้
        // อยู่แล้ว) ส่วน error อื่นทั้งหมด (Prisma/JS ดิบ) ต้องไม่หลุดไปถึง UI — ใช้เหตุผลกลาง
        defectReasons = [
          err instanceof HttpException ? err.message : 'ตรวจสิทธิ์เปลี่ยนเครื่องไม่สำเร็จ',
        ];
      }
    }
    const photos = await this.photos.getPhotos(r.product.id);
    // A1 (final-fix brief) — reconcile ก่อนตัดสิน "มีเคสเปิดค้างไหม": stored stage อาจดริฟท์จาก
    // ใบซ่อมจริง (sync() ของ proxy ไม่เคยรัน) ⇒ ไม่ reconcile จุดนี้ = createCase บล็อก IMEI นี้
    // ตลอดไปด้วย 409 ทั้งที่เคสเก่าปิดไปแล้วจริง ๆ
    const openCaseRaw = await this.prisma.afterSalesCase.findFirst({
      where: {
        deviceImei: r.product.imeiSerial ?? dto.imei,
        deletedAt: null,
        stage: { notIn: ['CLOSED', 'CANCELLED'] },
      },
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
      orderBy: { receivedAt: 'desc' },
    });
    const openCaseReconciled = openCaseRaw
      ? await reconcileStage(this.prisma, openCaseRaw)
      : null;
    const openCase =
      openCaseReconciled && !['CLOSED', 'CANCELLED'].includes(openCaseReconciled.stage)
        ? {
            id: openCaseReconciled.id,
            caseNumber: openCaseReconciled.caseNumber,
            stage: openCaseReconciled.stage,
          }
        : null;
    const warrantyStatus = source === 'WALK_IN' ? 'WALK_IN' : r.warrantyStatus;
    return {
      found: true,
      source,
      product: r.product,
      customer: r.customer,
      contract: r.contract,
      sale: r.sale,
      openCase,
      warranty: {
        status: warrantyStatus,
        daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0,
        purchasedAt: toIso(r.purchasedAt),
        shopWarrantyEndDate: toIso(r.shopWarrantyEndDate),
        manufacturerWarrantyEndDate: toIso(r.manufacturerWarrantyEndDate),
        checkedAt,
      },
      purchasePhotos: photos.photos ?? null,
      outcomes: computeOutcomes({
        source,
        warrantyStatus,
        daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0,
        contractStatus: r.contract?.status,
        defectEligible,
        defectReasons,
        viewerRole: user.role,
      }),
    };
  }
}
