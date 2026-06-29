import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePODto, UpdatePODto, GoodsReceivingDto, UpdatePaymentDto, OrderPODto, DirectReceiveDto } from './dto/create-po.dto';
import { PoQueryService } from './services/po-query.service';
import { PoLifecycleService } from './services/po-lifecycle.service';
import { PoReceivingService } from './services/po-receiving.service';

/**
 * Facade for purchase-order operations. Keeps the original 16-method public
 * surface + 1-arg constructor so callers (controller), the module, and the
 * specs (which inject only PrismaService) stay untouched. Internally constructs
 * three plain sub-services and delegates:
 *  - PoQueryService     — reads, AP grouping, QC-pending, GR history/summary
 *  - PoLifecycleService — create (PO-number $tx), update/approve/reject/cancel/updatePayment
 *  - PoReceivingService — goodsReceiving (Serializable $tx), confirmQC
 */
@Injectable()
export class PurchaseOrdersService {
  private readonly query: PoQueryService;
  private readonly lifecycle: PoLifecycleService;
  private readonly receiving: PoReceivingService;

  constructor(private prisma: PrismaService) {
    this.query = new PoQueryService(prisma);
    this.lifecycle = new PoLifecycleService(prisma, this.query);
    this.receiving = new PoReceivingService(prisma);
  }

  findAll(filters: { status?: string; supplierId?: string; page?: number; limit?: number }) {
    return this.query.findAll(filters);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  create(dto: CreatePODto, userId: string) {
    return this.lifecycle.create(dto, userId);
  }

  update(id: string, dto: UpdatePODto) {
    return this.lifecycle.update(id, dto);
  }

  approve(id: string, userId: string) {
    return this.lifecycle.approve(id, userId);
  }

  order(id: string, userId: string, dto: OrderPODto) {
    return this.lifecycle.order(id, userId, dto);
  }

  reject(id: string, userId: string, reason: string) {
    return this.lifecycle.reject(id, userId, reason);
  }

  cancel(id: string) {
    return this.lifecycle.cancel(id);
  }

  updatePayment(id: string, dto: UpdatePaymentDto) {
    return this.lifecycle.updatePayment(id, dto);
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

  confirmQC(productIds: string[]) {
    return this.receiving.confirmQC(productIds);
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
