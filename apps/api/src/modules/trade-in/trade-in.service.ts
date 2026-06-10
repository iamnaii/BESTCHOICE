import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateTradeInDto,
  AppraiseTradeInDto,
  AcceptTradeInDto,
  UpdateTradeInDto,
  QuickBuyTradeInDto,
  UpsertValuationDto,
} from './dto/trade-in.dto';
import { TradeInVoucherService } from './services/voucher.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { TradeInValuationService } from './services/trade-in-valuation.service';
import { TradeInQueryService } from './services/trade-in-query.service';
import { TradeInLifecycleService } from './services/trade-in-lifecycle.service';
import {
  normalizeNationalId,
  buildTradeInPiiEncryptedFields,
} from './helpers/trade-in.helpers';

/**
 * TradeInService — facade. Keeps the public method surface + 5-arg constructor
 * stable while delegating to three internally-constructed sub-services:
 *  - TradeInValuationService  (valuation-table CRUD)
 *  - TradeInQueryService      (reads / IMEI check / voucher / id-card upload)
 *  - TradeInLifecycleService  (create / update / appraise / accept / reject /
 *                              complete / quickBuy — owns the 4 $transactions)
 */
@Injectable()
export class TradeInService {
  private readonly valuation: TradeInValuationService;
  private readonly query: TradeInQueryService;
  private readonly lifecycle: TradeInLifecycleService;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private voucher: TradeInVoucherService,
    private contactResolver: ContactResolverService,
    private pii: CustomerPiiService,
  ) {
    // Build Valuation + Query first, then wire them into Lifecycle (cross-refs).
    this.valuation = new TradeInValuationService(prisma);
    this.query = new TradeInQueryService(prisma, storage, voucher);
    this.lifecycle = new TradeInLifecycleService(
      prisma,
      storage,
      voucher,
      contactResolver,
      pii,
      this.query,
      this.valuation,
    );
  }

  // ─── Shared helpers (kept on facade for spec compatibility) ──────────────
  private normalizeNationalId(raw: string): string {
    return normalizeNationalId(raw);
  }

  private buildTradeInPiiEncryptedFields(input: {
    paymentMethod?: string;
    transferAccountNumber?: string | null;
    transferAccountName?: string | null;
  }): Record<string, unknown> {
    return buildTradeInPiiEncryptedFields(input);
  }

  // ─── Query / read delegations ────────────────────────────────────────────
  checkImei(imei: string) {
    return this.query.checkImei(imei);
  }

  findAll(filters: {
    customerId?: string;
    branchId?: string;
    status?: string;
    search?: string;
    submissionSource?: string;
    flow?: string;
    page?: number;
    limit?: number;
  }) {
    return this.query.findAll(filters);
  }

  findOne(id: string) {
    return this.query.findOne(id);
  }

  sellerHistory(idCardNumber: string) {
    return this.query.sellerHistory(idCardNumber);
  }

  uploadIdCardPhoto(id: string, photoBase64: string, source: 'card_reader' | 'upload') {
    return this.query.uploadIdCardPhoto(id, photoBase64, source);
  }

  verifyByVoucherNumber(voucherNumber: string) {
    return this.query.verifyByVoucherNumber(voucherNumber);
  }

  generateVoucher(id: string) {
    return this.query.generateVoucher(id);
  }

  getVoucherPdf(id: string) {
    return this.query.getVoucherPdf(id);
  }

  // ─── Lifecycle delegations (write-heavy) ─────────────────────────────────
  create(dto: CreateTradeInDto) {
    return this.lifecycle.create(dto);
  }

  update(id: string, dto: UpdateTradeInDto) {
    return this.lifecycle.update(id, dto);
  }

  appraise(id: string, dto: AppraiseTradeInDto, userId: string, userRole?: string) {
    return this.lifecycle.appraise(id, dto, userId, userRole);
  }

  accept(id: string, dto: AcceptTradeInDto, userId: string) {
    return this.lifecycle.accept(id, dto, userId);
  }

  quickBuy(dto: QuickBuyTradeInDto, userId: string, userBranchId?: string | null) {
    return this.lifecycle.quickBuy(dto, userId, userBranchId);
  }

  reject(id: string) {
    return this.lifecycle.reject(id);
  }

  complete(id: string) {
    return this.lifecycle.complete(id);
  }

  // ─── Valuation delegations ───────────────────────────────────────────────
  lookupValuation(brand: string, model: string, storage: string, condition: string) {
    return this.valuation.lookupValuation(brand, model, storage, condition);
  }

  getValuationBrands() {
    return this.valuation.getValuationBrands();
  }

  getValuationModels(brand: string) {
    return this.valuation.getValuationModels(brand);
  }

  upsertValuation(dto: UpsertValuationDto) {
    return this.valuation.upsertValuation(dto);
  }

  listValuations(filters: { brand?: string; model?: string; page?: number; limit?: number }) {
    return this.valuation.listValuations(filters);
  }
}
