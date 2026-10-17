import { contractWarrantySource } from '../../employee-access/access-repair-scope';
import { saleSource } from '../../employee-access/access-sales-scope';
import { liveShopServiceBranch } from '../../employee-access/access-service-origin';
import { optionalSource } from '../../employee-access/access-after-sales-source.service';
import { Optional, ForbiddenException } from '@nestjs/common';
import { canAccess } from '@installment/shared';
import {
  domainAccessClient,
  currentDomainAccess,
} from '../../employee-access/access-execution-context';
import {
  afterSalesActor,
  currentAfterSalesWhere,
} from '../../employee-access/access-after-sales-source.service';
import { AccessAfterSalesProjectionService } from '../../employee-access/access-after-sales-projection.service';
import { AccessExchangeSourceService } from '../../employee-access/access-exchange-source.service';
import { AccessResourceService } from '../../employee-access/access-resource.service';
import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RepairTicketsService } from '../../repair-tickets/repair-tickets.service';
import { DefectExchangeService } from '../../defect-exchange/defect-exchange.service';
import { ProductPhotosService } from '../../quality-control/product-photos.service';
import { computeOutcomes, OutcomeOption, OutcomeInput } from '../utils/after-sales-outcomes.util';
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
  openCase: { id: string; caseNumber: string; stage: string; stageVerified?: boolean } | null; // เคสที่ยังไม่ปิดของ IMEI นี้ (กันเปิดซ้ำ)
  outcomes: OutcomeOption[];
  /**
   * PR 3 Task 3 (PF-4) — ลูกค้าผูก LINE ไว้แล้วหรือยัง (customer.lineIdShop มีค่าจริง). อ่าน
   * `lineIdShop` แยกด้วย select ของตัวเองในเมธอดนี้เท่านั้น แล้วแปลงเป็น boolean — ห้ามใส่
   * `lineIdShop` ดิบลงใน `LookupResult` หรือ `customer` (PII, `repair-warranty.service.ts` เอง
   * ก็จงใจไม่คืนค่านี้ — ห้ามไป widen select ของมัน).
   */
  lineLinked: boolean;
}

/** แปลง Date | null → ISO string | null — lookupByImei คืน Date จริง แต่ LookupResult ประกาศเป็น string เพื่อให้ serialize ข้าม HTTP ได้ตรงกันเสมอ */
function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

@Injectable()
export class AfterSalesLookupService {
  constructor(
    private readonly basePrisma: PrismaService,
    private readonly repair: RepairTicketsService,
    private readonly defect: DefectExchangeService,
    private readonly photos: ProductPhotosService,
    @Optional() private readonly projection?: AccessAfterSalesProjectionService,
    @Optional() private readonly exchanges?: AccessExchangeSourceService,
    @Optional() private readonly resources?: AccessResourceService,
  ) {}

  private async outcomes(
    input: OutcomeInput,
    found?: {
      contract?: { id: string } | null;
      sale?: { id: string } | null;
      product?: { id: string };
    },
  ) {
    const ctx = currentDomainAccess();
    if (!ctx) return computeOutcomes(input);
    const source = found?.contract
      ? await contractWarrantySource(ctx.client, found.contract.id, true)
      : found?.sale
        ? await saleSource(ctx.client, found.sale.id, true)
        : found?.product
          ? await this.resources!.product(ctx.client, found.product.id, true).then((p) =>
              this.resources!.branch(ctx.client, p.branchId!, true),
            )
          : null;
    const candidates = source
      ? [source]
      : (
          await ctx.client.branch.findMany({ where: liveShopServiceBranch, select: { id: true } })
        ).map((branch) => ({ company: 'SHOP' as const, branchId: branch.id }));
    const repair = candidates.some(
      (s) =>
        canAccess(ctx.snapshot, 'after-sales.create', s) &&
        canAccess(ctx.snapshot, 'repair-tickets.create', s),
    );
    const exchangeSources = found?.contract
      ? await optionalSource(() => this.exchanges!.sources({ oldContractId: found.contract!.id }))
      : null;
    const createCase = !!source && canAccess(ctx.snapshot, 'after-sales.create', source);
    const sameModel =
      createCase &&
      !!exchangeSources &&
      this.exchanges!.permits('defect-exchanges.create', exchangeSources);
    const priced =
      createCase &&
      !!exchangeSources &&
      this.exchanges!.permits('contract-exchanges.create', exchangeSources);
    const approve =
      !!exchangeSources && this.exchanges!.permits('defect-exchanges.approve', exchangeSources);
    return computeOutcomes({ ...input, viewerRole: approve ? 'BRANCH_MANAGER' : 'SALES' }).map(
      (option) => {
        const permitted =
          option.outcome === 'REPAIR'
            ? repair
            : option.outcome === 'SAME_MODEL_EXCHANGE'
              ? sameModel
              : option.outcome === 'PRICED_EXCHANGE'
                ? priced
                : false;
        return permitted
          ? option
          : { ...option, enabled: false, reason: 'ไม่มีสิทธิ์ดำเนินการในแหล่งนี้' };
      },
    );
  }

  private get prisma() {
    return domainAccessClient(this.basePrisma);
  }

  async lookup(dto: LookupDto, user: ReqUser): Promise<LookupResult> {
    const ctx = await afterSalesActor(this.basePrisma, user.id);
    if (ctx && (!this.projection || !this.exchanges || !this.resources))
      throw new ForbiddenException('ไม่มีตัวตรวจแหล่งเคส');
    // C7 (final-fix brief) — ข้อความเดิม "เลือกเครื่องก่อน (productId)" ชี้ไปหน้าจอค้นด้วยลูกค้า
    // ที่ PR 1 ไม่มี UI รองรับจริง (มีแค่ query param `productId` ใน DTO เผื่ออนาคต) — เปลี่ยนเป็น
    // ข้อความที่ตรงกับสิ่งที่ผู้ใช้ทำได้จริงวันนี้ (ค้นด้วย IMEI เท่านั้น)
    if (!dto.imei)
      throw new NotFoundException('ไม่พบเครื่องจากเลข IMEI นี้ — ตรวจเลข IMEI แล้วลองใหม่');
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
        lineLinked: false, // ไม่พบเครื่อง — ไม่มีลูกค้าให้ผูก LINE
        warranty: {
          status: 'WALK_IN',
          daysRemainingIn7Day: 0,
          purchasedAt: null,
          shopWarrantyEndDate: null,
          manufacturerWarrantyEndDate: null,
          checkedAt,
        },
        outcomes: await this.outcomes({
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
          !ctx && err instanceof HttpException ? err.message : 'ตรวจสิทธิ์เปลี่ยนเครื่องไม่สำเร็จ',
        ];
      }
    }
    // This is a fresh Product load, independently authorized under current ownership.
    if (ctx) {
      const source = await this.resources!.product(ctx.client, r.product.id, true);
      if (!canAccess(ctx.snapshot, 'products.read', source))
        throw new ForbiddenException('ไม่มีสิทธิ์อ่านสินค้า');
    }
    const photos = await this.photos.getPhotos(r.product.id);
    // A1 (final-fix brief) — reconcile ก่อนตัดสิน "มีเคสเปิดค้างไหม": stored stage อาจดริฟท์จาก
    // ใบซ่อมจริง (sync() ของ proxy ไม่เคยรัน) ⇒ ไม่ reconcile จุดนี้ = createCase บล็อก IMEI นี้
    // ตลอดไปด้วย 409 ทั้งที่เคสเก่าปิดไปแล้วจริง ๆ
    const openCaseRaw = ctx
      ? null
      : await this.prisma.afterSalesCase.findFirst({
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
    const openCaseReconciled = openCaseRaw ? await reconcileStage(this.prisma, openCaseRaw) : null;
    let openCase: LookupResult['openCase'] =
      openCaseReconciled && !['CLOSED', 'CANCELLED'].includes(openCaseReconciled.stage)
        ? {
            id: openCaseReconciled.id,
            caseNumber: openCaseReconciled.caseNumber,
            stage: openCaseReconciled.stage,
          }
        : null;
    if (ctx) {
      let cursor: string | undefined;
      for (;;) {
        const candidates = await ctx.client.afterSalesCase.findMany({
          where: {
            AND: [currentAfterSalesWhere(), { deviceImei: r.product.imeiSerial ?? dto.imei }],
          },
          select: { id: true },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          take: 100,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const candidate of candidates) {
          const view = await this.projection!.project(candidate.id);
          if (!['CLOSED', 'CANCELLED'].includes(view.stage)) {
            openCase = {
              id: view.id,
              caseNumber: view.caseNumber,
              stage: view.stage,
              stageVerified: view.stageVerified,
            };
            break;
          }
        }
        if (openCase || candidates.length < 100) break;
        cursor = candidates[candidates.length - 1].id;
      }
    }
    const warrantyStatus = source === 'WALK_IN' ? 'WALK_IN' : r.warrantyStatus;
    // PF-4 — อ่าน lineIdShop แยกที่นี่เท่านั้น (`lookupByImei`/`r.customer` ไม่มีคอลัมน์นี้เลย —
    // select ของมันคือ {id,name,phone} ตายตัว ห้าม widen) แล้วแปลงเป็น boolean ก่อนคืนค่า
    const lineLinked = r.customer?.id
      ? !!(
          await this.prisma.customer.findFirst({
            where: { id: r.customer.id, deletedAt: null },
            select: { lineIdShop: true },
          })
        )?.lineIdShop
      : false;
    return {
      found: true,
      source,
      product: r.product,
      customer: r.customer,
      contract: r.contract,
      sale: r.sale,
      openCase,
      lineLinked,
      warranty: {
        status: warrantyStatus,
        daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0,
        purchasedAt: toIso(r.purchasedAt),
        shopWarrantyEndDate: toIso(r.shopWarrantyEndDate),
        manufacturerWarrantyEndDate: toIso(r.manufacturerWarrantyEndDate),
        checkedAt,
      },
      purchasePhotos: photos.photos ?? null,
      outcomes: await this.outcomes(
        {
          source,
          warrantyStatus,
          daysRemainingIn7Day: r.daysRemainingIn7Day ?? 0,
          contractStatus: r.contract?.status,
          defectEligible,
          defectReasons,
          viewerRole: user.role,
        },
        r,
      ),
    };
  }
}
