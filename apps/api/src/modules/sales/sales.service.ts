import { AuditService } from '../audit/audit.service';
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/sale.dto';
import { InterCompanyService } from '../inter-company/inter-company.service';
import { SalesQueryService } from './services/sales-query.service';
import { SaleWriterService } from './services/sale-writer.service';
import { SaleCreationService } from './services/sale-creation.service';
import { SaleWarrantyNotifierService } from './services/sale-warranty-notifier.service';
import { ShopCashSaleTemplate } from '../journal/cpa-templates/shop-cash-sale.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';
import { ShopExternalFinanceSaleTemplate } from '../journal/cpa-templates/shop-external-finance-sale.template';
import type { SalesReadActor, SalesReadFilters } from './sales-read.types';

/**
 * SalesService — facade over the decomposed sales sub-services.
 *
 * Read methods require the authenticated actor. Sub-services are constructed
 * INTERNALLY in the constructor body. SaleWriterService now requires
 * ShopCashSaleTemplate + ShopAccountResolver (injected via NestJS DI from
 * JournalModule which is imported in SalesModule).
 *
 *  - SalesQueryService   — read-side queries + role-dependent response shaping
 *  - SaleWriterService   — the 3 per-type $transaction writers (cash/external =
 *                          Serializable, installment = default) + tx-scoped helpers
 *  - SaleCreationService — create orchestrator + post-commit loyalty redemption $tx
 *
 * Money/$transaction behavior is preserved exactly — see the sub-services.
 */
@Injectable()
export class SalesService {
  private readonly query: SalesQueryService;
  private readonly writer: SaleWriterService;
  private readonly creation: SaleCreationService;

  constructor(
    private prisma: PrismaService,
    private interCompanyService: InterCompanyService,
    private shopCashSaleTemplate: ShopCashSaleTemplate,
    private shopAccountResolver: ShopAccountResolver,
    private shopExternalFinanceSaleTemplate: ShopExternalFinanceSaleTemplate,
    private warrantyNotifier: SaleWarrantyNotifierService,
    @Optional() private audit?: AuditService,
  ) {
    this.query = new SalesQueryService(this.prisma);
    this.writer = new SaleWriterService(
      this.prisma,
      this.shopCashSaleTemplate,
      this.shopAccountResolver,
      this.shopExternalFinanceSaleTemplate,
    );
    this.creation = new SaleCreationService(
      this.prisma,
      this.writer,
      this.interCompanyService,
      this.warrantyNotifier,
    );
  }

  async findAll(filters: SalesReadFilters, actor: SalesReadActor) {
    return this.query.findAll(filters, actor);
  }

  async exportRows(filters: SalesReadFilters, actor: SalesReadActor) {
    const result = await this.query.exportRows(filters, actor);
    await (this.audit ?? new AuditService(this.prisma)).log({ userId: actor.id, action: 'SALES_REPORT_EXPORTED', entity: 'sale',
      newValue: { rowCount: result.total, asOf: result.asOf, role: actor.role } });
    return result;
  }

  async getSalespersons(actor: SalesReadActor) {
    return this.query.getSalespersons(actor);
  }

  async findOne(id: string, actor: SalesReadActor) {
    return this.query.findOne(id, actor);
  }

  async create(dto: CreateSaleDto, salespersonId: string, userRole = 'SALES', userBranchId?: string | null) {
    return this.creation.create(dto, salespersonId, userRole, userBranchId);
  }

  async getPosConfig() {
    return this.query.getPosConfig();
  }

  async getTopSellingProducts(actor: SalesReadActor, limit = 6) {
    return this.query.getTopSellingProducts(actor, limit);
  }

  async getDailySummary(date: string, actor: SalesReadActor, branchId?: string) {
    return this.query.getDailySummary(date, actor, branchId);
  }
}
