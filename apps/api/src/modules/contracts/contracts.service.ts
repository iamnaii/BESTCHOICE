import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractCancellationTemplate } from '../journal/cpa-templates/contract-cancellation.template';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { WarrantyService } from '../warranty/warranty.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';
import { ContractQueryService, BranchAccessUser } from './services/contract-query.service';
import { ContractLifecycleService } from './services/contract-lifecycle.service';
import { ContractCancellationService } from './services/contract-cancellation.service';
import { ShopDownPaymentTemplate } from '../journal/cpa-templates/shop-down-payment.template';
import { ShopAccountResolver } from '../journal/shop-account-resolver.service';

export { BranchAccessUser };

/**
 * ContractsService — thin facade preserving the original 12-method surface and
 * 5-arg constructor. It internally constructs three sub-services and delegates:
 *
 *   - ContractQueryService        : findAll / findOne / validateForSubmit /
 *                                   getMilestonesSummary (+ shared findOne /
 *                                   isTestModeEnabled)
 *   - ContractLifecycleService    : create / update / softDelete /
 *                                   updateSalesperson (the write-side $tx work)
 *   - ContractCancellationService : requestCancellation / approveCancellation /
 *                                   rejectCancellation / listPendingCancellations
 *
 * The constructor body keeps the 5 injected deps so the existing module wiring
 * and the unit-test injection (incl. the post-construction private-field hack
 * `(svc as any).cancellationTemplate = mock`) keep working unchanged. The
 * cancellation sub-service reads the template through a `() => this.cancellationTemplate`
 * accessor so a late-set mock still reaches approveCancellation.
 */
@Injectable()
export class ContractsService {
  private readonly query: ContractQueryService;
  private readonly lifecycle: ContractLifecycleService;
  private readonly cancellation: ContractCancellationService;

  constructor(
    private prisma: PrismaService,
    private shopDownPaymentTemplate: ShopDownPaymentTemplate,
    private shopAccountResolver: ShopAccountResolver,
    @Optional() private warrantyService?: WarrantyService,
    @Optional() private cancellationTemplate?: ContractCancellationTemplate,
    @Optional() private testMode?: TestModeService,
    @Optional() private audit?: AuditService,
  ) {
    this.query = new ContractQueryService(prisma, testMode);
    this.lifecycle = new ContractLifecycleService(prisma, this.query, shopDownPaymentTemplate, shopAccountResolver, warrantyService, audit);
    // Late-bind the cancellation template via accessor so a post-construction
    // mutation of `this.cancellationTemplate` (the unit-test hack) is honored.
    this.cancellation = new ContractCancellationService(prisma, () => this.cancellationTemplate);
  }

  // ─── Query ───────────────────────────────────────────────────────────────
  findAll(filters: {
    status?: string;
    workflowStatus?: string;
    branchId?: string;
    customerId?: string;
    search?: string;
    page?: number;
    limit?: number;
    salespersonId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    return this.query.findAll(filters);
  }

  findOne(id: string, user?: BranchAccessUser) {
    return this.query.findOne(id, user);
  }

  validateForSubmit(id: string) {
    return this.query.validateForSubmit(id);
  }

  getMilestonesSummary() {
    return this.query.getMilestonesSummary();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  create(dto: CreateContractDto, salespersonId: string, salespersonRole?: string) {
    return this.lifecycle.create(dto, salespersonId, salespersonRole);
  }

  update(id: string, dto: UpdateContractDto, userId: string) {
    return this.lifecycle.update(id, dto, userId);
  }

  softDelete(id: string, userId: string) {
    return this.lifecycle.softDelete(id, userId);
  }

  updateSalesperson(
    contractId: string,
    newSalespersonId: string,
    actor: { id: string; role: string },
  ) {
    return this.lifecycle.updateSalesperson(contractId, newSalespersonId, actor);
  }

  // ─── Cancellation ──────────────────────────────────────────────────────
  requestCancellation(
    contractId: string,
    userId: string,
    reason: string,
    refundAmount: number,
  ) {
    return this.cancellation.requestCancellation(contractId, userId, reason, refundAmount);
  }

  approveCancellation(cancellationId: string, approverId: string) {
    return this.cancellation.approveCancellation(cancellationId, approverId);
  }

  rejectCancellation(
    cancellationId: string,
    approverId: string,
    reason: string,
  ) {
    return this.cancellation.rejectCancellation(cancellationId, approverId, reason);
  }

  listPendingCancellations() {
    return this.cancellation.listPendingCancellations();
  }
}
