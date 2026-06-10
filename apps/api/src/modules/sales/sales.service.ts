import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/sale.dto';
import { InterCompanyService } from '../inter-company/inter-company.service';
import { SalesQueryService } from './services/sales-query.service';
import { SaleWriterService } from './services/sale-writer.service';
import { SaleCreationService } from './services/sale-creation.service';

/**
 * SalesService — facade over the decomposed sales sub-services.
 *
 * The 8-method public surface + constructor `(prisma, interCompanyService)` are
 * preserved byte-identically so the forwardRef token in
 * `online-order-sale.adapter.ts`, the `sales.module.ts` provider wiring, and the
 * existing spec all stay untouched. Sub-services are plain classes constructed
 * INTERNALLY in the constructor body (no DI provider entries needed):
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
  ) {
    this.query = new SalesQueryService(this.prisma);
    this.writer = new SaleWriterService(this.prisma, this.interCompanyService);
    this.creation = new SaleCreationService(this.prisma, this.writer, this.interCompanyService);
  }

  async findAll(filters: {
    saleType?: string;
    branchId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    paymentMethod?: string;
    salespersonId?: string;
    contractStatus?: string;
    page?: number;
    limit?: number;
    userRole?: string;
  }) {
    return this.query.findAll(filters);
  }

  async getSalespersons(user: { role: string; branchId?: string }) {
    return this.query.getSalespersons(user);
  }

  async findOne(id: string) {
    return this.query.findOne(id);
  }

  async create(dto: CreateSaleDto, salespersonId: string, userRole = 'SALES') {
    return this.creation.create(dto, salespersonId, userRole);
  }

  async getPosConfig() {
    return this.query.getPosConfig();
  }

  async getTopSellingProducts(limit = 6) {
    return this.query.getTopSellingProducts(limit);
  }

  async getDailySummary(date: string, branchId?: string) {
    return this.query.getDailySummary(date, branchId);
  }
}
