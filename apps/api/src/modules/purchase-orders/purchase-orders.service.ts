import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, GoodsReceivingDto, UpdatePaymentDto, OrderPODto, ApprovePODto, DirectReceiveDto } from './dto/create-po.dto';
import { PoQueryService } from './services/po-query.service';
import { PoLifecycleService } from './services/po-lifecycle.service';
import { PoReceivingService } from './services/po-receiving.service';
import { ShopGoodsReceivingTemplate } from '../journal/cpa-templates/shop-goods-receiving.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ShopSupplierPaymentTemplate } from '../journal/cpa-templates/shop-supplier-payment.template';
import { DepositOutcomeInput, RecordSupplierPaymentInput, SupplierPaymentService } from './services/supplier-payment.service';
import { SupplierLedgerService } from './services/supplier-ledger.service';

/**
 * Facade for purchase-order operations. Keeps the original 16-method public
 * surface so the controller stays untouched. Internally constructs three plain
 * sub-services and delegates. The journal dependencies (2026-09-29 — รับสินค้าเข้า
 * ลงบัญชี) are REQUIRED, not @Optional(): a missing provider must fail at boot,
 * never silently receive stock without posting. Specs get mocks from
 * `po-journal.test-helpers.ts`.
 *  - PoQueryService     — reads, AP grouping, QC-pending, GR history/summary
 *  - PoLifecycleService — create (PO-number $tx), update/approve/reject/cancel/updatePayment
 *  - SupplierPaymentService — บันทึก/ยกเลิกการจ่ายเงินผู้จัดจำหน่าย + มัดจำ (ก้อน 2 · 2026-10-05)
 *  - PoReceivingService — goodsReceiving (Serializable $tx + SHOP journal entry), rejectQC
 */
@Injectable()
export class PurchaseOrdersService {
  private readonly query: PoQueryService;
  private readonly lifecycle: PoLifecycleService;
  private readonly receiving: PoReceivingService;
  private readonly supplierPayments: SupplierPaymentService;
  private readonly supplierLedger: SupplierLedgerService;

  constructor(
    private prisma: PrismaService,
    goodsReceivingTemplate: ShopGoodsReceivingTemplate,
    shopAccountResolver: ShopAccountResolver,
    companyResolver: CompanyResolverService,
    supplierPaymentTemplate: ShopSupplierPaymentTemplate,
  ) {
    this.query = new PoQueryService(prisma);
    // ก้อน 2 (2026-10-05) — จ่ายเงินผู้จัดจำหน่าย / มัดจำ: template มาจาก JournalModule เช่นเดียวกับรับของ
    this.supplierPayments = new SupplierPaymentService(prisma, {
      template: supplierPaymentTemplate,
      accounts: shopAccountResolver,
      companies: companyResolver,
    });
    this.supplierLedger = new SupplierLedgerService(prisma, companyResolver);
    this.lifecycle = new PoLifecycleService(prisma, this.query, this.supplierPayments);
    this.receiving = new PoReceivingService(prisma, {
      goodsReceivingTemplate,
      shopAccountResolver,
      companyResolver,
      supplierPayments: this.supplierPayments,
    });
  }

  findAll(filters: { status?: string; supplierId?: string; page?: number; limit?: number }) {
    return this.query.findAll(filters);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  create(dto: CreatePODto, userId: string, userRole?: string) {
    return this.lifecycle.create(dto, userId, userRole);
  }

  update(id: string, dto: UpdatePODto) {
    return this.lifecycle.update(id, dto);
  }

  approve(id: string, userId: string, dto?: ApprovePODto) {
    return this.lifecycle.approve(id, userId, dto);
  }

  order(id: string, userId: string, dto: OrderPODto) {
    return this.lifecycle.order(id, userId, dto);
  }

  reject(id: string, userId: string, reason: string) {
    return this.lifecycle.reject(id, userId, reason);
  }

  cancel(id: string, userId: string, outcome?: DepositOutcomeInput) {
    return this.lifecycle.cancel(id, userId, outcome);
  }

  updatePayment(id: string, dto: UpdatePaymentDto) {
    return this.lifecycle.updatePayment(id, dto);
  }

  // ───── ก้อน 2 จ่ายเงินผู้จัดจำหน่าย (2026-10-05) ─────
  recordSupplierPayment(poId: string, input: RecordSupplierPaymentInput, userId: string) {
    return this.supplierPayments.recordPayment(poId, input, userId);
  }

  voidSupplierPayment(poId: string, paymentId: string, userId: string, reason: string) {
    return this.supplierPayments.voidPayment(poId, paymentId, userId, reason);
  }

  listSupplierPayments(poId: string) {
    return this.supplierPayments.listPayments(poId);
  }

  getSupplierLedger(month?: string) {
    return this.supplierLedger.ledger(month);
  }

  getSupplierLedgerMovements(supplierId: string, month?: string) {
    return this.supplierLedger.movements(supplierId, month);
  }

  getAccountsPayable(page = 1, limit = 50) {
    return this.query.getAccountsPayable(page, limit);
  }

  getGoodsReceivings(poId: string, filters: {
    status?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  } = {}) {
    return this.query.getGoodsReceivings(poId, filters);
  }

  getGoodsReceivingById(poId: string, receivingId: string) {
    return this.query.getGoodsReceivingById(poId, receivingId);
  }

  getReceivingSummary(poId: string, filters: {
    startDate?: string;
    endDate?: string;
  } = {}) {
    return this.query.getReceivingSummary(poId, filters);
  }

  goodsReceiving(id: string, dto: GoodsReceivingDto, userId: string) {
    return this.receiving.goodsReceiving(id, dto, userId);
  }

  directReceive(dto: DirectReceiveDto, userId: string) {
    return this.receiving.directReceive(dto, userId);
  }

  checkReceivingDoc(input: { supplierId: string; docNumber?: string; docDate?: string }) {
    return this.receiving.checkReceivingDoc(input);
  }

  rejectQC(productIds: string[], reason: string) {
    return this.receiving.rejectQC(productIds, reason);
  }

  getQCPending(filters: { branchId?: string; poId?: string; includePhotoPending?: boolean; page?: number; limit?: number }) {
    return this.query.getQCPending(filters);
  }

  getSummary() {
    return this.query.getSummary();
  }
}
