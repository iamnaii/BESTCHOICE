import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, StockAdjustmentReason, StockAdjustmentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { bkkYyyymmdd } from '../../utils/document-number-format.util';
import { evidenceImageExtension, isEvidenceImage } from '../../utils/upload-image.util';
import { AuditService } from '../audit/audit.service';
import { CROSS_BRANCH_ROLES } from '../auth/branch-access.util';
import { CompanyResolverService } from '../journal/company-resolver.service';
import {
  STOCK_WRITEOFF_LOSS_ACCOUNT,
  ShopStockWriteOffTemplate,
} from '../journal/cpa-templates/shop-stock-writeoff.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { assertProductNotHeld } from '../products/product-hold.util';
import { ReceivingAcceptanceJournal } from '../purchase-orders/services/receiving-acceptance-journal';
import { StorageService } from '../storage/storage.service';
import { BookedInventory, resolveBookedInventory } from './booked-inventory.util';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { RejectStockAdjustmentDto } from './dto/reject-stock-adjustment.dto';
import { StockAdjustmentNumberService } from './stock-adjustment-number.service';

/**
 * ก้อน 3 — คำขอตัดสินค้า (2026-10-05). Spec: `~/Desktop/App/output/plans/2026-10-05-k3-stock-writeoff.md`
 *
 * เดิม "ปรับสต๊อก" มีผลทันทีโดยผู้ขอเลือกชื่อผู้อนุมัติเอง (4-eyes แบบกระดาษ). คำตัดสินเจ้าของ: **เจ้าของอนุมัติทุกใบ**
 * — ผู้ขอ (SALES / BM / OWNER · สาขาตัวเอง) ส่งคำขอ → เครื่องถูกพักขายด้วยสถานะ `ADJUSTMENT_PENDING` (เฉพาะเหตุผลที่
 * เอาเครื่องออกจากคลัง) → Todo ถึงเจ้าของ → เจ้าของอนุมัติ (ลงบัญชี `Dr S53-1102 / Cr S11-200x` เฉพาะเครื่องที่เคยลงบัญชี
 * รับเข้า — `resolveBookedInventory`) หรือไม่อนุมัติ/ผู้ขอยกเลิก (เครื่องกลับสถานะเดิม).
 *
 * คำตอบฝ่ายบัญชี 29–30/09/2569: ข6 สูญหาย/ตัดจำหน่าย `Dr S53-1102 / Cr S11-200x` ที่ต้นทุน ณ วันอนุมัติ · FOUND = กลับรายการ
 * ใบเดิม · CORRECTION/OTHER ไม่ลงบัญชี · **ข7 เครื่องเสียหายที่ยังอยู่ = คงในสต๊อก ไม่ลงบัญชี ไม่ลบ** · ข้อ 8 เครื่องที่ยังไม่ลง
 * บัญชีรับเข้าตัดได้โดยไม่มี JE แล้วแจ้งฝ่ายบัญชี.
 */
export interface AdjustmentActor {
  id: string;
  role: string;
  branchId?: string | null;
}

export const STOCK_ADJUSTMENT_TODO_TAG = 'stock-adjustment';
export const STOCK_ADJUSTMENT_UNBOOKED_TODO_TAG = 'stock-adjustment-unbooked';
export const adjustmentTodoKey = (requestNumber: string) => `sa:${requestNumber}`;

/** เหตุผลที่เอาเครื่องออกจากคลัง — ส่งคำขอแล้วเครื่องถูกพักขายจนเจ้าของตัดสิน */
export const EXIT_REASONS: ReadonlySet<StockAdjustmentReason> = new Set<StockAdjustmentReason>([
  'DAMAGED',
  'LOST',
  'WRITE_OFF',
]);
/** เหตุผลที่ลงบัญชี (เมื่อเครื่องเคยลงบัญชีรับเข้า) */
export const BOOKED_EXIT_REASONS: ReadonlySet<StockAdjustmentReason> = new Set<StockAdjustmentReason>([
  'LOST',
  'WRITE_OFF',
]);
export const EXIT_TARGET_STATUS: Record<'DAMAGED' | 'LOST' | 'WRITE_OFF', ProductStatus> = {
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  WRITE_OFF: 'WRITTEN_OFF',
};
export const REASON_LABEL: Record<StockAdjustmentReason, string> = {
  DAMAGED: 'เสียหาย',
  LOST: 'สูญหาย',
  FOUND: 'พบของคืน',
  CORRECTION: 'แก้ไขข้อมูล',
  WRITE_OFF: 'ตัดจำหน่าย',
  OTHER: 'อื่น ๆ',
};

export const REQUESTABLE_STATUSES: Record<'EXIT' | 'FOUND' | 'NOTE', readonly ProductStatus[]> = {
  // เครื่องที่ "อยู่ในมือร้าน" และยังไม่ถูกขาย/จอง/ยึด — DAMAGED เพิ่มเฉพาะเหตุผล WRITE_OFF (ของเสียที่เก็บไว้แล้วตัดทิ้ง)
  EXIT: ['IN_STOCK', 'PHOTO_PENDING', 'QC_PENDING', 'INSPECTION', 'REFURBISHED', 'PO_RECEIVED'],
  FOUND: ['LOST', 'DAMAGED', 'WRITTEN_OFF'], // + แถวที่ถูกลบทุกสถานะ (กู้แถว — `assertFoundAllowed`)
  NOTE: Object.values(ProductStatus),
};

/**
 * Phase 5 fix round 3 [Important 1] — `FOUND` เป็น **allow-list** ไม่ใช่ deny ทีละสถานะ
 *
 * `FOUND` = "พบของที่หายไป" ⇒ มีความหมายเฉพาะกลุ่มของหาย/ของเสีย. รอบ 2 ปฏิเสธเฉพาะ
 * `REFURBISHED` แต่ `repossessions.service.ts` ตั้ง `REPOSSESSED` ตอนยึด (REFURBISHED
 * มาทีหลังตอน `markReadyForSale` ที่บังคับตีราคาใหม่) ⇒ เครื่องยึดที่ยังถือราคาขายเดิม
 * flip เข้า `IN_STOCK` ได้ทางนี้ โดยไม่เช็คราคา ไม่มี AuditLog เข้าคลัง — ทั้งที่ปุ่ม
 * "นำเข้าคลังพร้อมขาย" ปฏิเสธมัน. allow-list ปิดสถานะที่ยังไม่มีใครนึกถึงด้วย
 * (`SOLD_INSTALLMENT → IN_STOCK` แย่กว่าเคส REPOSSESSED เสียอีก)
 *
 * `toInStock: true` = กลุ่มที่ "พบคืน" แล้วกลับมาขายได้จริง. สถานะอื่น **ยังกู้แถวที่ถูก
 * soft-delete คืนได้** (`deletedAt: null`) แต่กลับไปสถานะเดิมของมัน ไม่ใช่ `IN_STOCK`
 * — นี่คือทางกู้เครื่องที่ถูกลบทางเดียวที่ระบบมี จึงห้ามปิด แต่ก็ต้องไม่กลายเป็นประตูลัด
 * เข้าคลัง (เครื่อง REFURBISHED ที่กู้คืนมายังต้องผ่านปุ่มยืนยันราคาอยู่ดี)
 */
const FOUND_POLICY = {
  // ── พบคืนแล้วกลับเข้าคลังได้ ──
  LOST: { toInStock: true, hint: '' }, // ความหมายตรงตัวของ "พบของที่หายไป"
  DAMAGED: { toInStock: true, hint: '' }, // ของเสียที่กู้ได้ (เจ้าของอนุมัติทุกใบ)
  WRITTEN_OFF: { toInStock: true, hint: '' }, // ตัดจำหน่ายแล้วเจอของ (เจ้าของอนุมัติ)

  // ── ไม่ใช่ของหาย/ของเสีย: มี flow ของตัวเอง ──
  REFURBISHED: {
    toInStock: false,
    hint: 'เครื่องมือสองที่รับคืน — ใช้ปุ่ม "นำเข้าคลังพร้อมขาย" ที่หน้ารายละเอียดสินค้า เพื่อยืนยันราคาขายก่อน',
  },
  REPOSSESSED: {
    toInStock: false,
    hint: 'เครื่องที่ยึดมา — ต้องผ่าน flow ยึดเครื่อง (ตีราคาขายต่อ/พร้อมขาย) ก่อน แล้วจึงกดปุ่ม "นำเข้าคลังพร้อมขาย"',
  },
  SOLD_INSTALLMENT: {
    toInStock: false,
    hint: 'เครื่องที่สัญญาผ่อนยังถืออยู่ — คืนเข้าสต็อกผ่านยกเลิกสัญญา / ยึดเครื่อง / เปลี่ยนเครื่องเท่านั้น',
  },
  /**
   * Fix round 4 [Minor 4]: ข้อความเดิมชี้ไป "ยกเลิกการขาย" ซึ่ง **ไม่มีอยู่จริง** —
   * โมดูล `sales` มีแค่ findAll/findOne/create (controller มี `@Post()` ตัวเดียว)
   * ไม่มี cancel/void เลย และ `SOLD_CASH`/`SOLD_RESELL` อยู่ใน `SYSTEM_MANAGED_STATUSES`
   * ⇒ PATCH สถานะก็ไม่ได้ ⇒ วันนี้ไม่มีเส้นทางในระบบเลย ต้องให้เจ้าของ/ฝ่ายบัญชีแก้
   * รายการขายให้ก่อน (ห้ามชี้ไป flow ที่ไม่มี — failure mode เดียวกับ Important 2)
   */
  SOLD_CASH: {
    toInStock: false,
    hint: 'เครื่องที่บันทึกขายสดไปแล้ว — ระบบยังไม่มีเมนูยกเลิกการขาย ต้องให้เจ้าของ/ฝ่ายบัญชีแก้รายการขายใบนั้นก่อน',
  },
  SOLD_RESELL: {
    toInStock: false,
    hint: 'เครื่องที่บันทึกขายต่อไปแล้ว — ระบบยังไม่มีเมนูยกเลิกการขาย ต้องให้เจ้าของ/ฝ่ายบัญชีแก้รายการขายใบนั้นก่อน',
  },
  RESERVED: { toInStock: false, hint: 'เครื่องที่ติดจองอยู่ — ปลดผ่านการยกเลิกจอง/ยกเลิกออเดอร์' },
  PO_RECEIVED: { toInStock: false, hint: 'เครื่องที่เพิ่งรับเข้าจากใบสั่งซื้อ — เดินตามขั้นตอนรับของ/ตรวจ QC ตามปกติ' },
  QC_PENDING: { toInStock: false, hint: 'เครื่องที่รอตรวจ QC — เข้าคลังเมื่อผ่าน QC ตามขั้นตอน' },
  PHOTO_PENDING: {
    toInStock: false,
    hint: 'เครื่องที่รอถ่ายรูป 6 มุม — เข้าคลังโดยอัปโหลดรูปให้ครบแล้วกดยืนยันรูป (ต้องมีราคาขายก่อน)',
  },
  INSPECTION: { toInStock: false, hint: 'เครื่องที่อยู่ระหว่างตรวจสภาพ — เข้าคลังเมื่อตรวจเสร็จตามขั้นตอน' },
  DEFECT_RETURN: { toInStock: false, hint: 'เครื่องเคลม/ส่งซ่อม — จัดการผ่านใบซ่อม/เปลี่ยนเครื่องชำรุด' },
  IN_STOCK: { toInStock: false, hint: 'เครื่องนี้อยู่ในคลังอยู่แล้ว' },
  ADJUSTMENT_PENDING: {
    toInStock: false,
    hint: 'เครื่องนี้มีคำขอตัดสินค้ารออนุมัติอยู่ — ให้เจ้าของพิจารณา หรือยกเลิกคำขอก่อน',
  },
} satisfies Record<ProductStatus, { toInStock: boolean; hint: string }>;

/** สถานะที่เหตุผล "พบของ" พาเข้า `IN_STOCK` ได้จริง */
export const FOUND_TO_IN_STOCK: ReadonlySet<ProductStatus> = new Set(
  (Object.keys(FOUND_POLICY) as ProductStatus[]).filter((s) => FOUND_POLICY[s].toInStock),
);

/**
 * ปฏิเสธ `FOUND` บนสถานะที่ไม่ใช่ของหาย/ของเสีย — ยกเว้นแถวที่ถูก soft-delete
 * (กู้คืนได้ แต่กลับไปสถานะเดิม ไม่ใช่ `IN_STOCK`)
 */
function assertFoundAllowed(status: ProductStatus, deletedAt: Date | null): void {
  if (FOUND_POLICY[status].toInStock || deletedAt) return;
  throw new BadRequestException(
    `สินค้าอยู่สถานะ ${status} — เหตุผล "พบของ" ใช้ได้เฉพาะเครื่องที่หาย/เสียหาย/ตัดจำหน่าย (LOST, DAMAGED, WRITTEN_OFF) ` +
      `หรือเครื่องที่ถูกลบไปแล้วและต้องการกู้แถวคืน: ${FOUND_POLICY[status].hint}`,
  );
}

const ADJ_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      brand: true,
      model: true,
      color: true,
      storage: true,
      imeiSerial: true,
      serialNumber: true,
      costPrice: true,
      category: true,
      status: true,
      deletedAt: true,
    },
  },
  branch: { select: { id: true, name: true } },
  adjustedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  rejectedBy: { select: { id: true, name: true } },
  canceledBy: { select: { id: true, name: true } },
} satisfies Prisma.StockAdjustmentInclude;

export type StockAdjustmentView = Prisma.StockAdjustmentGetPayload<{ include: typeof ADJ_INCLUDE }>;

export interface ProductLookupRow {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  status: ProductStatus;
  deletedAt: Date | null;
  branch: { id: string; name: string };
  costPrice: string;
  category: string;
  /** เลขคำขอที่ยังรออนุมัติของเครื่องนี้ (ถ้ามี) */
  pendingRequestNumber: string | null;
}

export interface AdjustmentJournalLine {
  accountCode: string;
  name: string;
  debit: string;
  credit: string;
}

export interface AdjustmentPreview {
  /** สถานะเครื่องเมื่ออนุมัติ (CORRECTION/OTHER = null — ไม่เปลี่ยน) */
  productStatusAfter: ProductStatus | null;
  /** ส่งคำขอแล้วเครื่องถูกพักขายไหม */
  holdsProduct: boolean;
  costAmount: string | null;
  inventoryAccountCode: string | null;
  booked: BookedInventory;
  /** ว่าง = ไม่ลงบัญชี */
  journalLines: AdjustmentJournalLine[];
  journalNote: string;
  /** เหตุผล DAMAGED ต้องแนบรูป */
  requiresPhoto: boolean;
}

export interface ApproveResult {
  adjustment: StockAdjustmentView;
  journalEntryNo: string | null;
  inventoryBooked: boolean | null;
  productStatus: ProductStatus;
  accountingNotified: boolean;
}

type LoadedProduct = Prisma.ProductGetPayload<{ include: { branch: { select: { id: true; name: true } } } }>;

const NOTE_UNBOOKED = 'ไม่ลงบัญชี — เครื่องนี้ยังไม่มีรายการบัญชีรับเข้า (จะแจ้งฝ่ายบัญชีเมื่ออนุมัติ)';
const NOTE_DAMAGED = 'ไม่ลงบัญชี — เครื่องเสียหายคงในสต๊อกจนกว่าจะขายหรือตัดจำหน่าย (คำตอบฝ่ายบัญชี ข7)';
const NOTE_NONE = 'ไม่ลงบัญชี — เหตุผลนี้เป็นการบันทึกข้อมูลอย่างเดียว';
const NOTE_ZERO_COST = 'ไม่ลงบัญชี — เครื่องนี้ไม่มีต้นทุน (0 บาท)';

const money = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v).toFixed(2);
const isP2002 = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class StockAdjustmentsService {
  private readonly logger = new Logger(StockAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: ShopStockWriteOffTemplate,
    private readonly accounts: ShopAccountResolver,
    private readonly companies: CompanyResolverService,
    private readonly storage: StorageService,
    private readonly numbers: StockAdjustmentNumberService,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // ขอบเขตสาขา
  // ────────────────────────────────────────────────────────────────────────────

  /** ผู้ขอ/ผู้ยกเลิก: OWNER ทุกสาขา · อื่น ๆ เฉพาะสาขาตัวเอง (ไม่มี branchId = fail-closed) */
  private assertRequesterScope(actor: AdjustmentActor, productBranchId: string, verb: string): void {
    if (actor.role === 'OWNER') return;
    if (!actor.branchId || actor.branchId !== productBranchId) {
      throw new ForbiddenException(`${verb}ได้เฉพาะเครื่องในสาขาของคุณ`);
    }
  }

  /** ผู้อ่าน: OWNER/FM/ACCOUNTANT ข้ามสาขา · BM/SALES เฉพาะสาขาตัวเอง */
  private assertReaderScope(actor: AdjustmentActor, branchId: string): void {
    if (CROSS_BRANCH_ROLES.has(actor.role)) return;
    if (!actor.branchId || actor.branchId !== branchId) {
      throw new ForbiddenException('ดูได้เฉพาะรายการของสาขาคุณ');
    }
  }

  private readerBranchFilter(actor: AdjustmentActor): { branchId?: string; adjustedById?: string } {
    if (CROSS_BRANCH_ROLES.has(actor.role)) return {};
    // ไม่มี branchId ติดตัว = เห็นได้แค่ใบที่ตัวเองขอ (fail-closed)
    return actor.branchId ? { branchId: actor.branchId } : { adjustedById: actor.id };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // กติกาเหตุผล vs สถานะเครื่อง
  // ────────────────────────────────────────────────────────────────────────────

  private assertReasonAllowed(reason: StockAdjustmentReason, product: LoadedProduct): void {
    if (reason === 'FOUND') {
      if (!product.deletedAt && product.status === 'IN_STOCK') {
        throw new BadRequestException('สินค้านี้อยู่ในสต๊อกอยู่แล้ว ไม่สามารถใช้เหตุผล "พบของคืน" ได้');
      }
      assertFoundAllowed(product.status, product.deletedAt);
      return;
    }
    if (product.deletedAt) {
      throw new BadRequestException(
        'เครื่องนี้ถูกลบออกจากระบบไปแล้ว — ถ้าพบของจริงให้ส่งคำขอเหตุผล "พบของคืน" เพื่อกู้แถวก่อน',
      );
    }
    if (!EXIT_REASONS.has(reason)) return; // CORRECTION / OTHER — บันทึกอย่างเดียว
    const allowed =
      REQUESTABLE_STATUSES.EXIT.includes(product.status) ||
      (reason === 'WRITE_OFF' && product.status === 'DAMAGED');
    if (allowed) return;
    if (product.status === 'ADJUSTMENT_PENDING') {
      throw new ConflictException('เครื่องนี้มีคำขอตัดสินค้ารออนุมัติอยู่แล้ว — รอเจ้าของพิจารณา หรือยกเลิกคำขอเดิมก่อน');
    }
    const hint = FOUND_POLICY[product.status]?.hint;
    throw new BadRequestException(
      `ขอ${REASON_LABEL[reason]}ไม่ได้ — เครื่องอยู่สถานะ ${product.status} ` +
        `(ขอได้เฉพาะเครื่องที่อยู่ในมือร้าน: ${REQUESTABLE_STATUSES.EXIT.join(', ')}` +
        (reason === 'WRITE_OFF' ? ', DAMAGED' : '') +
        `)${hint ? `: ${hint}` : ''}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // รูปหลักฐาน
  // ────────────────────────────────────────────────────────────────────────────

  private async uploadPhotos(files: Express.Multer.File[], now: Date): Promise<string[]> {
    for (const f of files) {
      if (!isEvidenceImage(f)) {
        throw new BadRequestException(`รูปหลักฐานต้องเป็น JPEG/PNG/WebP (${f.originalname ?? 'ไฟล์'} ไม่ใช่)`);
      }
    }
    const keys: string[] = [];
    try {
      for (const f of files) {
        const key = `stock-adjustments/${bkkYyyymmdd(now)}/${randomUUID()}.${evidenceImageExtension(f.mimetype)}`;
        await this.storage.upload(key, f.buffer, f.mimetype);
        keys.push(key);
      }
    } catch (err) {
      await this.discardPhotos(keys);
      throw err;
    }
    return keys;
  }

  private async discardPhotos(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (err) {
        this.logger.warn(`ลบรูปหลักฐานที่อัปโหลดค้างไม่สำเร็จ ${key}: ${(err as Error).message}`);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // สร้างคำขอ
  // ────────────────────────────────────────────────────────────────────────────

  async createRequest(
    dto: CreateStockAdjustmentDto,
    photos: Express.Multer.File[],
    actor: AdjustmentActor,
  ): Promise<StockAdjustmentView> {
    const reason = dto.reason as StockAdjustmentReason;
    const files = photos ?? [];
    if (reason === 'DAMAGED' && files.length === 0) {
      throw new BadRequestException('เหตุผล เสียหาย ต้องแนบรูปหลักฐานอย่างน้อย 1 รูป');
    }

    // ตรวจเครื่อง/สิทธิ์ก่อนอัปโหลด — ไม่ให้รูปของคำขอที่ไม่มีทางผ่านไปค้างใน storage
    const probe = await this.prisma.product.findUnique({
      where: { id: dto.productId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!probe) throw new NotFoundException('ไม่พบสินค้า');
    this.assertRequesterScope(actor, probe.branchId, 'ขอตัดสินค้า');
    this.assertReasonAllowed(reason, probe);

    const now = new Date();
    const photoKeys = await this.uploadPhotos(files, now);
    const holdsProduct = EXIT_REASONS.has(reason);

    let created: StockAdjustmentView;
    try {
      created = await this.prisma.$transaction(
        async (tx) => {
          const product = await tx.product.findUnique({
            where: { id: dto.productId },
            include: { branch: { select: { id: true, name: true } } },
          });
          if (!product) throw new NotFoundException('ไม่พบสินค้า');
          this.assertRequesterScope(actor, product.branchId, 'ขอตัดสินค้า');

          const pending = await tx.stockAdjustment.findFirst({
            where: { productId: product.id, status: 'PENDING_APPROVAL', deletedAt: null },
            select: { requestNumber: true },
          });
          if (pending) {
            throw new ConflictException(
              `เครื่องนี้มีคำขอ ${pending.requestNumber ?? ''} รออนุมัติอยู่ — รอเจ้าของพิจารณา หรือยกเลิกคำขอเดิมก่อน`,
            );
          }
          this.assertReasonAllowed(reason, product);
          if (holdsProduct) {
            await assertProductNotHeld(tx, product, 'STOCK_ADJUST');
          }

          const requestNumber = await this.numbers.next(tx, now);
          let row: StockAdjustmentView;
          try {
            row = await tx.stockAdjustment.create({
              data: {
                productId: product.id,
                branchId: product.branchId,
                reason,
                previousStatus: product.status,
                status: 'PENDING_APPROVAL',
                notes: dto.notes,
                photos: photoKeys,
                adjustedById: actor.id,
                requestNumber,
              },
              include: ADJ_INCLUDE,
            });
          } catch (err) {
            if (isP2002(err)) {
              throw new ConflictException('เครื่องนี้มีคำขอตัดสินค้ารออนุมัติอยู่แล้ว — รีเฟรชหน้าจอแล้วตรวจใหม่');
            }
            throw err;
          }

          if (holdsProduct) {
            await tx.product.update({ where: { id: product.id }, data: { status: 'ADJUSTMENT_PENDING' } });
          }

          const owner = await tx.user.findFirst({
            where: { role: 'OWNER', isActive: true, deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          const deviceLabel = `${product.brand} ${product.model}${product.imeiSerial ? ` · ${product.imeiSerial}` : ''}`;
          await tx.todo.create({
            data: {
              title: `คำขอตัดสินค้า ${requestNumber} · ${REASON_LABEL[reason]} · ${deviceLabel} (${product.branch.name})`,
              description:
                `ผู้ขอ ${actor.id} · ต้นทุน ${money(product.costPrice)} บาท · สถานะเดิม ${product.status}` +
                (dto.notes ? `\nหมายเหตุ: ${dto.notes}` : '') +
                (holdsProduct ? '\nเครื่องถูกพักขายจนกว่าจะพิจารณา' : '') +
                '\nเปิดเมนู คลังสินค้า › ตัดสินค้า เพื่ออนุมัติหรือไม่อนุมัติ',
              priority: 'HIGH',
              tags: [STOCK_ADJUSTMENT_TODO_TAG, adjustmentTodoKey(requestNumber)],
              createdById: actor.id,
              assigneeId: owner?.id ?? null,
              branchId: product.branchId,
            },
          });
          return row;
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      await this.discardPhotos(photoKeys);
      throw err;
    }

    await this.audit.log({
      userId: actor.id,
      action: 'STOCK_ADJUSTMENT_REQUESTED',
      entity: 'stock_adjustment',
      entityId: created.id,
      newValue: {
        requestNumber: created.requestNumber,
        reason,
        productId: dto.productId,
        previousStatus: created.previousStatus,
        holdsProduct,
        photoCount: photoKeys.length,
      },
    });
    return created;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ยกเลิกคำขอ (ผู้ขอเอง หรือเจ้าของ)
  // ────────────────────────────────────────────────────────────────────────────

  async cancel(id: string, actor: AdjustmentActor): Promise<StockAdjustmentView> {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockPending(tx, id);
      if (row.adjustedById !== actor.id && actor.role !== 'OWNER') {
        throw new ForbiddenException('ยกเลิกได้เฉพาะผู้ส่งคำขอหรือเจ้าของ');
      }
      if (EXIT_REASONS.has(row.reason)) {
        await tx.product.updateMany({
          where: { id: row.productId, status: 'ADJUSTMENT_PENDING' },
          data: { status: row.previousStatus },
        });
      }
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: { status: 'CANCELED', canceledById: actor.id, canceledAt: now },
        include: ADJ_INCLUDE,
      });
      await this.closeOwnerTodo(tx, row.requestNumber, now);
      return updated;
    });

    await this.audit.log({
      userId: actor.id,
      action: 'STOCK_ADJUSTMENT_CANCELED',
      entity: 'stock_adjustment',
      entityId: id,
      newValue: { requestNumber: result.requestNumber, reason: result.reason, productId: result.productId },
    });
    return result;
  }

  /** ล็อกแถวคำขอแล้วอ่าน — ต้องยัง PENDING_APPROVAL */
  private async lockPending(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM stock_adjustments WHERE id = ${id} FOR UPDATE`;
    const row = await tx.stockAdjustment.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('ไม่พบคำขอตัดสินค้า');
    if (row.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`คำขอนี้ถูกพิจารณาไปแล้ว (สถานะ ${row.status})`);
    }
    if (!row.requestNumber) {
      throw new ConflictException('คำขอนี้เป็นรายการยุคเก่าที่ไม่มีเลขคำขอ — ไม่มีอะไรให้พิจารณา');
    }
    return { ...row, requestNumber: row.requestNumber };
  }

  private async closeOwnerTodo(tx: Prisma.TransactionClient, requestNumber: string, now: Date): Promise<void> {
    await tx.todo.updateMany({
      where: { tags: { hasEvery: [STOCK_ADJUSTMENT_TODO_TAG, adjustmentTodoKey(requestNumber)] }, status: { not: 'DONE' } },
      data: { status: 'DONE', completedAt: now },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // อนุมัติ / ไม่อนุมัติ (Task 6)
  // ────────────────────────────────────────────────────────────────────────────

  async approve(_id: string, _actor: AdjustmentActor): Promise<ApproveResult> {
    throw new Error('Task 6');
  }

  async reject(_id: string, _dto: RejectStockAdjustmentDto, _actor: AdjustmentActor): Promise<StockAdjustmentView> {
    throw new Error('Task 6');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ค้นเครื่อง / preview
  // ────────────────────────────────────────────────────────────────────────────

  async lookupProduct(
    q: { imei?: string; search?: string; reason: StockAdjustmentReason },
    actor: AdjustmentActor,
  ): Promise<ProductLookupRow[]> {
    const imei = q.imei?.trim();
    const search = q.search?.trim();
    if (!imei && !search) return [];
    const where: Prisma.ProductWhereInput = {};
    if (imei) where.OR = [{ imeiSerial: imei }, { serialNumber: imei }];
    else if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { imeiSerial: { contains: search } },
      ];
    }
    if (actor.role !== 'OWNER') {
      if (!actor.branchId) return [];
      where.branchId = actor.branchId;
    }
    if (q.reason === 'FOUND') {
      // ของหาย/ของเสีย/ตัดจำหน่าย หรือแถวที่ถูกลบ (กู้แถว)
      where.AND = [{ OR: [{ status: { in: [...REQUESTABLE_STATUSES.FOUND] } }, { deletedAt: { not: null } }] }];
    } else {
      where.deletedAt = null;
    }
    const rows = await this.prisma.product.findMany({
      where,
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        brand: true,
        model: true,
        imeiSerial: true,
        serialNumber: true,
        status: true,
        deletedAt: true,
        costPrice: true,
        category: true,
        branch: { select: { id: true, name: true } },
        stockAdjustments: {
          where: { status: 'PENDING_APPROVAL', deletedAt: null },
          select: { requestNumber: true },
          take: 1,
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      model: p.model,
      imeiSerial: p.imeiSerial,
      serialNumber: p.serialNumber,
      status: p.status,
      deletedAt: p.deletedAt,
      branch: p.branch,
      costPrice: money(p.costPrice),
      category: p.category,
      pendingRequestNumber: p.stockAdjustments?.[0]?.requestNumber ?? null,
    }));
  }

  async preview(productId: string, reason: StockAdjustmentReason, actor: AdjustmentActor): Promise<AdjustmentPreview> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('ไม่พบสินค้า');
    this.assertReaderScope(actor, product.branchId);

    const booked = await resolveBookedInventory(this.prisma, productId);
    const cost = new Prisma.Decimal(product.costPrice);
    const inventoryAccountCode = this.accounts.resolveProductAccounts(product.category).inventoryAccountCode;
    const holdsProduct = EXIT_REASONS.has(reason);
    const requiresPhoto = reason === 'DAMAGED';

    let productStatusAfter: ProductStatus | null = null;
    if (reason === 'DAMAGED' || reason === 'LOST' || reason === 'WRITE_OFF') productStatusAfter = EXIT_TARGET_STATUS[reason];
    else if (reason === 'FOUND') productStatusAfter = FOUND_TO_IN_STOCK.has(product.status) ? 'IN_STOCK' : product.status;

    let journalLines: AdjustmentJournalLine[] = [];
    let journalNote = NOTE_NONE;
    if (reason === 'DAMAGED') {
      journalNote = NOTE_DAMAGED;
    } else if (BOOKED_EXIT_REASONS.has(reason)) {
      if (!booked.booked) journalNote = NOTE_UNBOOKED;
      else if (cost.lte(0)) journalNote = NOTE_ZERO_COST;
      else {
        journalLines = await this.nameLines([
          { accountCode: STOCK_WRITEOFF_LOSS_ACCOUNT, debit: money(cost), credit: '0.00' },
          { accountCode: inventoryAccountCode, debit: '0.00', credit: money(cost) },
        ]);
        journalNote = `ลงบัญชีเมื่ออนุมัติ — ${REASON_LABEL[reason]} ที่ต้นทุน ${money(cost)} บาท (ที่มา: ${booked.source}${booked.journalEntryNo ? ` · ${booked.journalEntryNo}` : ''})`;
      }
    } else if (reason === 'FOUND') {
      const original = await this.findReversibleWriteOff(this.prisma, productId);
      if (original?.journalEntryId) {
        const je = await this.prisma.journalEntry.findUnique({
          where: { id: original.journalEntryId },
          include: { lines: { where: { deletedAt: null } } },
        });
        if (je) {
          journalLines = await this.nameLines(
            je.lines.map((l) => ({ accountCode: l.accountCode, debit: money(l.credit), credit: money(l.debit) })),
          );
          journalNote = `กลับรายการ ${je.entryNumber} (ใบตัด ${original.requestNumber ?? original.id})`;
        }
      } else {
        journalNote = 'ไม่ลงบัญชี — ไม่มีรายการตัดจำหน่ายเดิมของเครื่องนี้ให้กลับ';
      }
    }

    return {
      productStatusAfter,
      holdsProduct,
      costAmount: BOOKED_EXIT_REASONS.has(reason) ? money(cost) : null,
      inventoryAccountCode: BOOKED_EXIT_REASONS.has(reason) ? inventoryAccountCode : null,
      booked,
      journalLines,
      journalNote,
      requiresPhoto,
    };
  }

  /** ใบตัด LOST/WRITE_OFF ที่อนุมัติแล้ว มี JE และยังไม่มีใบ FOUND ที่กลับรายการมัน */
  private async findReversibleWriteOff(client: Prisma.TransactionClient | PrismaService, productId: string) {
    const original = await client.stockAdjustment.findFirst({
      where: {
        productId,
        status: 'APPROVED',
        reason: { in: ['LOST', 'WRITE_OFF'] },
        journalEntryId: { not: null },
        deletedAt: null,
      },
      orderBy: { approvedAt: 'desc' },
    });
    if (!original) return null;
    const reversed = await client.stockAdjustment.findFirst({
      where: { reversesAdjustmentId: original.id, status: 'APPROVED', deletedAt: null },
      select: { id: true },
    });
    return reversed ? null : original;
  }

  private async nameLines(
    lines: { accountCode: string; debit: string; credit: string }[],
  ): Promise<AdjustmentJournalLine[]> {
    const codes = [...new Set(lines.map((l) => l.accountCode))];
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes } },
      select: { code: true, name: true },
    });
    const names = new Map(accounts.map((a) => [a.code, a.name]));
    return lines.map((l) => ({ ...l, name: names.get(l.accountCode) ?? l.accountCode }));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // อ่าน
  // ────────────────────────────────────────────────────────────────────────────

  async pendingCount(actor: AdjustmentActor): Promise<{ total: number }> {
    const total = await this.prisma.stockAdjustment.count({
      where: { status: 'PENDING_APPROVAL', deletedAt: null, ...this.readerBranchFilter(actor) },
    });
    return { total };
  }

  async findAll(
    filters: {
      branchId?: string;
      reason?: string;
      status?: string;
      mine?: boolean;
      productId?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      page?: number;
      limit?: number;
    },
    actor: AdjustmentActor,
  ) {
    const where: Prisma.StockAdjustmentWhereInput = { deletedAt: null, ...this.readerBranchFilter(actor) };
    if (filters.branchId && CROSS_BRANCH_ROLES.has(actor.role)) where.branchId = filters.branchId;
    if (filters.mine) where.adjustedById = actor.id;
    if (filters.reason) where.reason = filters.reason as StockAdjustmentReason;
    if (filters.status) where.status = filters.status as StockAdjustmentStatus;
    if (filters.productId) where.productId = filters.productId;
    if (filters.search) {
      where.OR = [
        { requestNumber: { contains: filters.search, mode: 'insensitive' } },
        {
          product: {
            is: {
              OR: [
                { name: { contains: filters.search, mode: 'insensitive' } },
                { brand: { contains: filters.search, mode: 'insensitive' } },
                { model: { contains: filters.search, mode: 'insensitive' } },
                { imeiSerial: { contains: filters.search } },
              ],
            },
          },
        },
      ];
    }
    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 50));

    const [data, total] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        include: ADJ_INCLUDE,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockAdjustment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(
    id: string,
    actor: AdjustmentActor,
  ): Promise<StockAdjustmentView & { photoUrls: string[]; booked: BookedInventory | null }> {
    const adjustment = await this.prisma.stockAdjustment.findUnique({ where: { id }, include: ADJ_INCLUDE });
    if (!adjustment || adjustment.deletedAt) throw new NotFoundException('ไม่พบคำขอตัดสินค้า');
    this.assertReaderScope(actor, adjustment.branchId);

    const photoUrls: string[] = [];
    for (const key of adjustment.photos) {
      if (key.startsWith('data:')) continue; // แถวยุคเก่าเคยเก็บ data URI — ไม่ส่งออก
      try {
        photoUrls.push(await this.storage.getSignedDownloadUrl(key));
      } catch (err) {
        this.logger.warn(`สร้างลิงก์รูปหลักฐานไม่สำเร็จ ${key}: ${(err as Error).message}`);
      }
    }
    const booked =
      adjustment.status === 'PENDING_APPROVAL' && BOOKED_EXIT_REASONS.has(adjustment.reason)
        ? await resolveBookedInventory(this.prisma, adjustment.productId)
        : null;
    return { ...adjustment, photoUrls, booked };
  }

  async getSummary(filters: { branchId?: string; startDate?: string; endDate?: string }) {
    const where: Prisma.StockAdjustmentWhereInput = { deletedAt: null, status: 'APPROVED' };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const grouped = await this.prisma.stockAdjustment.groupBy({ by: ['reason'], where, _count: true });
    const adjustments = await this.prisma.stockAdjustment.findMany({
      where,
      select: { reason: true, costAmount: true, product: { select: { costPrice: true } } },
    });

    const byReason: Record<string, { count: number; totalValue: string }> = {};
    const sums: Record<string, Prisma.Decimal> = {};
    for (const g of grouped) {
      byReason[g.reason] = { count: g._count, totalValue: '0.00' };
      sums[g.reason] = new Prisma.Decimal(0);
    }
    for (const adj of adjustments) {
      if (sums[adj.reason]) {
        sums[adj.reason] = sums[adj.reason].plus(adj.costAmount ?? adj.product?.costPrice ?? 0);
      }
    }
    let totalValue = new Prisma.Decimal(0);
    for (const reason of Object.keys(byReason)) {
      byReason[reason].totalValue = money(sums[reason]);
      totalValue = totalValue.plus(sums[reason]);
    }
    const totalCount = grouped.reduce((sum, g) => sum + g._count, 0);
    return { byReason, totalCount, totalValue: money(totalValue) };
  }
}
