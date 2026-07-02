import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { CreditCheckRiskService } from './services/credit-check-risk.service';
import { CreditCheckAiAnalysisService } from './services/credit-check-ai-analysis.service';
import { CreditCheckCrudService } from './services/credit-check-crud.service';
import { CreditCheckOverrideService } from './services/credit-check-override.service';

/**
 * Facade for credit-check. Keeps the 13-method public surface and delegates
 * each method to one of four internally-constructed sub-services. The
 * sub-services are plain classes (NOT @Injectable / DI-registered) wired up
 * in the constructor body, so the module providers stay unchanged.
 *
 * Constructor grew a 3rd arg (AiUsageService, #1317) so the AI-analysis
 * sub-service can record Claude usage; AiUsageService is @Global() so no
 * module import is needed. Every `new CreditCheckService(...)` call site
 * (specs) was updated to pass a 3rd arg alongside this change.
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
    private aiUsage: AiUsageService,
  ) {
    this.risk = new CreditCheckRiskService(this.prisma);
    this.ai = new CreditCheckAiAnalysisService(this.prisma, this.integrationConfig, this.aiUsage);
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
  }) {
    return this.crud.findAll(filters);
  }

  findByContract(contractId: string) {
    return this.crud.findByContract(contractId);
  }

  findByCustomer(customerId: string) {
    return this.crud.findByCustomer(customerId);
  }

  findLatestByCustomer(customerId: string) {
    return this.crud.findLatestByCustomer(customerId);
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
  analyzeForCustomer(creditCheckId: string) {
    return this.ai.analyzeForCustomer(creditCheckId);
  }

  analyze(contractId: string) {
    return this.ai.analyze(contractId);
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
