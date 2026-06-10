import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { DunningEngineService } from './dunning-engine.service';
import { OverdueKpiService } from './kpi.service';
import { PromiseService } from './promise.service';
import { PaymentsService } from '../payments/payments.service';
import { ContractLetterService } from './contract-letter.service';
import { MdmLockService } from './mdm-lock.service';
import { OwnerAlertHelper } from './owner-alert.helper';
import { OverdueAnalyticsService } from './services/overdue-analytics.service';
import { OverdueQueriesService } from './services/overdue-queries.service';
import { OverdueLifecycleCronService } from './services/overdue-lifecycle-cron.service';
import { DunningGovernanceService } from './services/dunning-governance.service';
import { ContactLogService } from './services/contact-log.service';

/**
 * Facade over the overdue/collections sub-services.
 *
 * This class keeps the SAME 8-argument constructor + 25 public method
 * signatures it always had — the module + controller + scheduler consumer +
 * every spec mock the same 8 deps and call the same methods, all untouched.
 *
 * Internally it constructs five plain sub-services (Analytics built FIRST since
 * ContactLog + Governance hold a ref to it) and delegates each public method
 * one-line. Behaviour is byte-identical to the pre-decompose monolith:
 *   - Analytics            getBrokenPromiseCount + computeFifoTargets (read)
 *   - Queries              pure read paths (no $tx)
 *   - LifecycleCron        calculateLateFees/updateContractStatuses/
 *                          escalateDunningStages/resetDunningStage (raw-SQL + 2 $tx)
 *   - DunningGovernance    approve/reject/hold/assign/escalate (~4 $tx)
 *   - ContactLog           createCallLog/recordSettlement/logContact (2 $tx incl
 *                          the Serializable PROMISED branch)/partialPaymentReschedule
 */
@Injectable()
export class OverdueService {
  // Retained for source-stability; sub-services own their own loggers.
  private readonly logger = new Logger(OverdueService.name);

  private readonly analytics: OverdueAnalyticsService;
  private readonly queries: OverdueQueriesService;
  private readonly lifecycleCron: OverdueLifecycleCronService;
  private readonly governance: DunningGovernanceService;
  private readonly contactLog: ContactLogService;

  constructor(
    private prisma: PrismaService,
    private dunningEngine: DunningEngineService,
    private kpiService: OverdueKpiService,
    private promiseService: PromiseService,
    @Inject(forwardRef(() => PaymentsService)) private paymentsService: PaymentsService,
    private letterService: ContractLetterService,
    private mdmLockService: MdmLockService,
    private ownerAlertHelper: OwnerAlertHelper,
  ) {
    // Build Analytics first — ContactLog + Governance depend on it.
    this.analytics = new OverdueAnalyticsService(this.prisma);
    this.queries = new OverdueQueriesService(this.prisma, this.promiseService);
    this.lifecycleCron = new OverdueLifecycleCronService(this.prisma);
    this.governance = new DunningGovernanceService(
      this.prisma,
      this.letterService,
      this.mdmLockService,
      this.ownerAlertHelper,
      this.kpiService,
      this.analytics,
    );
    this.contactLog = new ContactLogService(
      this.prisma,
      this.promiseService,
      this.paymentsService,
      this.dunningEngine,
      this.kpiService,
      this.analytics,
    );
  }

  // ── Queries (pure reads) ──────────────────────────────────────────────────

  findOverdueContracts(filters: {
    branchId?: string;
    status?: string;
    search?: string;
    userRole: string;
    userBranchId?: string;
    page?: number;
    limit?: number;
  }) {
    return this.queries.findOverdueContracts(filters);
  }

  getOverdueSummary(userRole: string, userBranchId?: string) {
    return this.queries.getOverdueSummary(userRole, userBranchId);
  }

  getContractTimeline(contractId: string) {
    return this.queries.getContractTimeline(contractId);
  }

  getCallLogs(contractId: string, page = 1, limit = 50) {
    return this.queries.getCallLogs(contractId, page, limit);
  }

  getPendingEscalations() {
    return this.queries.getPendingEscalations();
  }

  getCollectionPipelineStats(userRole?: string, userBranchId?: string) {
    return this.queries.getCollectionPipelineStats(userRole, userBranchId);
  }

  getCollectionsFlag(): Promise<boolean> {
    return this.queries.getCollectionsFlag();
  }

  getBoardData(userRole?: string, userBranchId?: string) {
    return this.queries.getBoardData(userRole, userBranchId);
  }

  listPromiseDueRemindersToday(branchId: string | null) {
    return this.queries.listPromiseDueRemindersToday(branchId);
  }

  getCycleDeadline(contractId: string) {
    return this.queries.getCycleDeadline(contractId);
  }

  getOverdueInstallments(contractId: string) {
    return this.queries.getOverdueInstallments(contractId);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getBrokenPromiseCount(contractId: string): Promise<number> {
    return this.analytics.getBrokenPromiseCount(contractId);
  }

  // ── Lifecycle crons (raw-SQL + status $tx) ────────────────────────────────

  calculateLateFees() {
    return this.lifecycleCron.calculateLateFees();
  }

  updateContractStatuses() {
    return this.lifecycleCron.updateContractStatuses();
  }

  escalateDunningStages() {
    return this.lifecycleCron.escalateDunningStages();
  }

  resetDunningStage(contractId: string) {
    return this.lifecycleCron.resetDunningStage(contractId);
  }

  // ── Dunning governance (manual actions, ~4 $tx) ───────────────────────────

  approveDunningEscalation(contractId: string, userId: string, userRole: string) {
    return this.governance.approveDunningEscalation(contractId, userId, userRole);
  }

  rejectDunningEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    reason: string,
  ) {
    return this.governance.rejectDunningEscalation(contractId, userId, userRole, reason);
  }

  holdAutoEscalation(
    contractId: string,
    userId: string,
    userRole: string,
    hoursFromNow = 48,
  ) {
    return this.governance.holdAutoEscalation(contractId, userId, userRole, hoursFromNow);
  }

  assignCollector(contractId: string, assignedToId: string) {
    return this.governance.assignCollector(contractId, assignedToId);
  }

  escalate(
    contractId: string,
    callerId: string,
    callerRole: string,
    action: 'LETTER' | 'MDM' | 'LEGAL',
    reason: string,
  ) {
    return this.governance.escalate(contractId, callerId, callerRole, action, reason);
  }

  // ── Contact logging + settlement (2 $tx incl Serializable PROMISED) ───────

  createCallLog(dto: CreateCallLogDto, callerId: string) {
    return this.contactLog.createCallLog(dto, callerId);
  }

  recordSettlement(
    contractId: string,
    callerId: string,
    dto: { settlementDate: string; settlementNotes: string; notes?: string },
  ) {
    return this.contactLog.recordSettlement(contractId, callerId, dto);
  }

  logContact(
    contractId: string,
    callerId: string,
    dto: {
      result: string;
      notes?: string;
      collectionNotes?: string;
      settlementDate?: string;
      settlementNotes?: string;
      callResult?:
        | 'ANSWERED'
        | 'NO_ANSWER'
        | 'BUSY'
        | 'DEVICE_OFF'
        | 'UNREACHABLE';
      negotiationResult?:
        | 'REQUESTED_EXTENSION'
        | 'WILL_PAY'
        | 'REFUSED'
        | 'REQUESTED_RETURN'
        | 'NEGOTIATING'
        | 'NOT_APPLICABLE';
      voiceMemoUrl?: string;
      slots?: Array<{ settlementDate: string; settlementAmount: number; notes?: string }>;
      targetInstallmentIds?: string[];
      settlementAmount?: number | string;
    },
  ) {
    return this.contactLog.logContact(contractId, callerId, dto);
  }

  partialPaymentReschedule(
    contractId: string,
    callerId: string,
    dto: {
      amountPaid: number;
      paymentMethod: string;
      evidenceUrl?: string;
      transactionRef?: string;
      newSettlementDate?: string;
      notes?: string;
    },
  ) {
    // Pass the facade's logContact (resolved on the call-time receiver, so a
    // `jest.spyOn(service,'logContact')` override is honoured) — preserves the
    // original intra-service `this.logContact` re-entry + its separate $tx.
    return this.contactLog.partialPaymentReschedule(
      contractId,
      callerId,
      dto,
      (...args) => this.logContact(...args),
    );
  }
}
