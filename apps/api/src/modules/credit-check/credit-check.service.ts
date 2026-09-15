import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiProviderService } from '../ai-usage/ai-provider.service';
import { CreditCheckRiskService } from './services/credit-check-risk.service';
import { CreditCheckAiAnalysisService } from './services/credit-check-ai-analysis.service';
import { CreditCheckCrudService } from './services/credit-check-crud.service';
import { CreditCheckOverrideService } from './services/credit-check-override.service';
import { CreditHistoryActor } from './services/room-credit-access';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';

/**
 * Facade for credit-check. Keeps the 13-method public surface and delegates
 * each method to one of four internally-constructed sub-services. The
 * sub-services are plain classes (NOT @Injectable / DI-registered) wired up
 * in the constructor body, so the module providers stay unchanged.
 *
 * The global AiProviderService owns provider requests and usage tracking.
 *
 * Sub-services are exposed as public readonly fields so tests that need to spy
 * on a (previously-facade-private) helper can target the owning sub-service
 * instance — behaviour is byte-identical to the pre-decompose monolith.
 */
@Injectable()
export class CreditCheckService {
  readonly risk: CreditCheckRiskService;
  readonly ai: CreditCheckAiAnalysisService;
  readonly crud: CreditCheckCrudService;
  readonly override_: CreditCheckOverrideService;

  constructor(
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
    private provider: AiProviderService,
    // การเดินทางของลูกค้า (CREDIT_AI_SCORED) — @Optional: เทสเดิมประกอบ facade ด้วย 3 อาร์กิวเมนต์
    @Optional() private journeyEntries?: JourneyEntryWriter,
  ) {
    this.risk = new CreditCheckRiskService(this.prisma);
    this.ai = new CreditCheckAiAnalysisService(this.prisma, this.integrationConfig, this.provider, this.journeyEntries);
    this.crud = new CreditCheckCrudService(this.prisma, this.risk); // crud needs risk for background auto-score
    this.override_ = new CreditCheckOverrideService(this.prisma);
  }

  // === CRUD ===
  findAll(filters: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    checkedById?: string;
  }, actor?: CreditHistoryActor) {
    return this.crud.findAll(filters, actor);
  }

  findByContract(contractId: string, actor?: CreditHistoryActor) {
    return this.crud.findByContract(contractId, actor);
  }

  findByCustomer(customerId: string, actor?: CreditHistoryActor) {
    return this.crud.findByCustomer(customerId, actor);
  }

  findLatestByCustomer(customerId: string, actor?: CreditHistoryActor) {
    return this.crud.findLatestByCustomer(customerId, actor);
  }

  createForCustomer(customerId: string, dto: CreateCreditCheckDto, _userId: string) {
    return this.crud.createForCustomer(customerId, dto, _userId);
  }

  create(contractId: string, dto: CreateCreditCheckDto, _userId: string) {
    return this.crud.create(contractId, dto, _userId);
  }

  updateWithAiFields(creditCheckId: string, data: {
    salaryVerified?: number;
    employerName?: string;
    salaryPayDay?: number;
    salarySlipFiles?: string[];
    statementBankName?: string;
    statementAvgIncome?: number;
    statementAvgExpense?: number;
    statementAvgBalance?: number;
  }) {
    return this.crud.updateWithAiFields(creditCheckId, data);
  }

  // === AI Analysis ===
  analyzeForCustomer(creditCheckId: string, userId?: string) {
    return this.ai.analyzeForCustomer(creditCheckId, userId);
  }

  analyze(contractId: string, userId?: string) {
    return this.ai.analyze(contractId, userId);
  }

  // === Risk Scoring ===
  getCustomerHistory(customerId: string) {
    return this.risk.getCustomerHistory(customerId);
  }

  calculateDtiRiskScore(creditCheckId: string, data: {
    salaryVerified?: number;
    monthlyPayment?: number;
    addressCurrentType?: string;
  }) {
    return this.risk.calculateDtiRiskScore(creditCheckId, data);
  }

  calculateRiskScore(creditCheckId: string) {
    return this.risk.calculateRiskScore(creditCheckId);
  }

  getAutoScore(creditCheckId: string) {
    return this.risk.getAutoScore(creditCheckId);
  }

  // === Override (the 2 atomic update+audit txns live in the override sub-service) ===
  overrideById(
    creditCheckId: string,
    dto: OverrideCreditCheckDto,
    userId: string,
    userRole: string,
  ) {
    return this.override_.overrideById(creditCheckId, dto, userId, userRole);
  }

  override(
    contractId: string,
    dto: OverrideCreditCheckDto,
    userId: string,
    userRole: string,
  ) {
    return this.override_.override(contractId, dto, userId, userRole);
  }
}
