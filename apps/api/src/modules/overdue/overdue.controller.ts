import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OverdueService } from './overdue.service';
import { DunningRuleService } from './dunning-rule.service';
import { DunningEngineService } from './dunning-engine.service';
import { OverdueQueueService } from './queue.service';
import { OverdueKpiService } from './kpi.service';
import { MyTodayKpiService } from './my-today-kpi.service';
import { MdmLockService } from './mdm-lock.service';
import { OverdueTimelineService } from './timeline.service';
import { OverdueBulkService } from './bulk.service';
import { ContractLetterService } from './contract-letter.service';
import { DunningRetryService } from './dunning-retry.service';
import { OverdueAnalyticsService } from './analytics.service';
import { AnalyticsAgingService } from './analytics-aging.service';
import { AnalyticsLeaderboardService } from './analytics-leaderboard.service';
import { AnalyticsRecoveryService } from './analytics-recovery.service';
import { StuckContractsService } from './stuck-contracts.service';
import { ContractSnoozeService } from './snooze.service';
import { AutoBalanceService } from './auto-balance.service';
import { PromiseService } from './promise.service';
import { CreateSnoozeDto } from './dto/snooze.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { CreateCallLogDto } from './dto/create-call-log.dto';
import { AssignCollectorDto } from './dto/assign-collector.dto';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { LogContactDto } from './dto/log-contact.dto';
import { PartialPaymentRescheduleDto } from './dto/partial-payment-reschedule.dto';
import { EscalateDto } from './dto/escalate.dto';
import { CreateDunningRuleDto, UpdateDunningRuleDto } from './dto/dunning-rule.dto';
import { QueueQueryDto } from './dto/queue-query.dto';
import { KpiQueryDto } from './dto/kpi-query.dto';
import { BulkAssignDto, BulkProposeLockDto, BulkSendLineDto } from './dto/bulk.dto';
import { SendLineAdHocDto } from './dto/send-line-adhoc.dto';
import { ApproveMdmDto } from './dto/approve-mdm.dto';
import { UpdateLetterEvidenceDto } from './dto/update-letter-evidence.dto';
import { RejectMdmDto } from './dto/reject-mdm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Overdue')
@ApiBearerAuth('JWT')
@Controller('overdue')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class OverdueController {
  constructor(
    private overdueService: OverdueService,
    private dunningRuleService: DunningRuleService,
    private dunningEngineService: DunningEngineService,
    private queueService: OverdueQueueService,
    private kpiService: OverdueKpiService,
    private myTodayKpiService: MyTodayKpiService,
    private mdmLockService: MdmLockService,
    private timelineService: OverdueTimelineService,
    private bulkService: OverdueBulkService,
    private contractLetterService: ContractLetterService,
    private dunningRetryService: DunningRetryService,
    private analyticsService: OverdueAnalyticsService,
    private analyticsAgingService: AnalyticsAgingService,
    private analyticsLeaderboardService: AnalyticsLeaderboardService,
    private analyticsRecoveryService: AnalyticsRecoveryService,
    private stuckContractsService: StuckContractsService,
    private snoozeService: ContractSnoozeService,
    private autoBalanceService: AutoBalanceService,
    private promiseService: PromiseService,
  ) {}

  // --- Collections Workflow Hub endpoints (Plan 2) ---

  @Get('queue')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getQueue(
    @Query() dto: QueueQueryDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.queueService.getQueue({
      tab: dto.tab,
      branchId: dto.branchId,
      page: dto.page,
      limit: dto.limit,
      userId: user.id,
      userRole: user.role,
      userBranchId: user.branchId,
      // Filter fields
      search: dto.search,
      assignedToId: dto.assignedToId,
      showSkipTracing: dto.showSkipTracing,
      overdueBuckets: dto.overdueBuckets,
      minOutstanding: dto.minOutstanding,
      maxOutstanding: dto.maxOutstanding,
      contractStatuses: dto.contractStatuses,
      productTypes: dto.productTypes,
      minLetterCount: dto.minLetterCount,
      lastContacted: dto.lastContacted,
      lineResponse: dto.lineResponse,
      minBrokenPromise: dto.minBrokenPromise,
      hasActivePromise: dto.hasActivePromise,
      mdmState: dto.mdmState,
      slipReviewPending: dto.slipReviewPending,
      sortBy: dto.sortBy,
    });
  }

  @Get('kpi')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getKpi(
    @Query() dto: KpiQueryDto,
    @CurrentUser() user: { role: string; branchId: string | null },
  ) {
    return this.kpiService.getKpi({
      range: dto.range ?? '7d',
      userRole: user.role,
      userBranchId: user.branchId,
    });
  }

  // P2 Task 1: per-user "what have I done today?" mini-KPI strip on the
  // Collections page header. Scoped to the current user so the chips match
  // the operator's own activity, not a branch/global aggregate.
  @Get('kpi/my-today')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getMyTodayKpi(@CurrentUser() user: { id: string }) {
    return this.myTodayKpiService.getMyToday(user.id);
  }

  @Get('mdm-pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  getMdmPending(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.mdmLockService.getPendingByRole(user.role, user.branchId ?? undefined);
  }

  @Get('collections-flag')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getCollectionsFlag() {
    return { enabled: await this.overdueService.getCollectionsFlag() };
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOverdue(
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.overdueService.findOverdueContracts({
      branchId,
      status,
      search,
      userRole: user.role,
      userBranchId: user.branchId || undefined,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getSummary(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.overdueService.getOverdueSummary(user.role, user.branchId || undefined);
  }

  @Get('pipeline')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getCollectionPipeline(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.overdueService.getCollectionPipelineStats(user.role, user.branchId || undefined);
  }

  @Get('contracts/:id/timeline')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getTimeline(@Param('id') id: string) {
    return this.overdueService.getContractTimeline(id);
  }

  @Get('contracts/:id/queue-row')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getQueueRow(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.queueService.getRowById(id, {
      userId: user.id,
      userRole: user.role,
      userBranchId: user.branchId,
    });
  }

  @Get('contracts/:id/full-timeline')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getFullTimeline(@Param('id') contractId: string) {
    return this.timelineService.getFullTimeline(contractId);
  }

  @Get('contracts/:id/call-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getCallLogs(
    @Param('id') contractId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.overdueService.getCallLogs(
      contractId,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Post('call-logs')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  createCallLog(
    @Body() dto: CreateCallLogDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.overdueService.createCallLog(dto, user.id);
  }

  @Post(':contractId/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  assignCollector(
    @Param('contractId') contractId: string,
    @Body() dto: AssignCollectorDto,
  ) {
    return this.overdueService.assignCollector(contractId, dto.assignedToId);
  }

  // T3-C11: Manual hold on auto-escalation cron. Path mirrors task spec
  // (`POST /contracts/:id/hold-escalation`) so frontend can call either
  // namespace. Scoped to BM+ because sales must not be able to silence
  // collections automation on their own deals (SoD).
  @Post('contracts/:id/hold-escalation')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  holdEscalation(
    @Param('id') id: string,
    @Body() body: { hoursFromNow?: number },
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.overdueService.holdAutoEscalation(
      id,
      user.id,
      user.role,
      body?.hoursFromNow,
    );
  }

  @Post(':contractId/settlement')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  recordSettlement(
    @Param('contractId') contractId: string,
    @Body() dto: RecordSettlementDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.overdueService.recordSettlement(contractId, user.id, dto);
  }

  @Get('board')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getBoard(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.overdueService.getBoardData(user.role, user.branchId || undefined);
  }

  @Patch(':contractId/contact-log')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  logContact(
    @Param('contractId') contractId: string,
    @Body() dto: LogContactDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.overdueService.logContact(contractId, user.id, dto);
  }

  // "รับเงินบางส่วน + นัดส่วนที่เหลือ" combo action
  // Roles: align with /contact-log + /settlement (recording a PROMISED CallLog
  // is a SALES/FM/BM/OWNER action — ACCOUNTANT goes through /payments).
  @Post(':contractId/partial-payment-reschedule')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  partialPaymentReschedule(
    @Param('contractId') contractId: string,
    @Body() dto: PartialPaymentRescheduleDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.overdueService.partialPaymentReschedule(contractId, user.id, dto);
  }

  // Escalation Guardrail: เมื่อลูกค้าผิดนัด ≥ threshold (จาก BUSINESS_RULES)
  // ปุ่มนัดใหม่ disable → collector ต้องเลือก escalate (LETTER/MDM/LEGAL)
  // LEGAL action is gated to OWNER/FINANCE_MANAGER inside the service (SoD).
  @Post(':contractId/escalate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  escalate(
    @Param('contractId') contractId: string,
    @Body() dto: EscalateDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.overdueService.escalate(contractId, user.id, user.role, dto.action, dto.reason);
  }

  @Post('cron/calculate-late-fees')
  @Roles('OWNER')
  calculateLateFees() {
    return this.overdueService.calculateLateFees();
  }

  @Post('cron/update-statuses')
  @Roles('OWNER')
  updateStatuses() {
    return this.overdueService.updateContractStatuses();
  }

  @Post('cron/escalate-dunning')
  @Roles('OWNER')
  escalateDunning() {
    return this.overdueService.escalateDunningStages();
  }

  @Post('cron/run-daily')
  @Roles('OWNER')
  async runDailyTasks() {
    const lateFees = await this.overdueService.calculateLateFees();
    const statuses = await this.overdueService.updateContractStatuses();
    return { lateFees, statuses, runAt: new Date() };
  }

  // --- Dunning Rules CRUD ---

  @Get('dunning-rules')
  @Roles('OWNER', 'FINANCE_MANAGER')
  findDunningRules() {
    return this.dunningRuleService.findAll();
  }

  @Post('dunning-rules')
  @Roles('OWNER')
  createDunningRule(@Body() dto: CreateDunningRuleDto) {
    return this.dunningRuleService.create(dto);
  }

  @Patch('dunning-rules/:id')
  @Roles('OWNER')
  updateDunningRule(@Param('id') id: string, @Body() dto: UpdateDunningRuleDto) {
    return this.dunningRuleService.update(id, dto);
  }

  @Delete('dunning-rules/:id')
  @Roles('OWNER')
  deleteDunningRule(@Param('id') id: string) {
    return this.dunningRuleService.softDelete(id);
  }

  // --- Dunning Actions ---

  @Get('contracts/:id/dunning-actions')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  getDunningActions(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.dunningEngineService.getActionsForContract(
      id,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  // --- Manual Trigger ---

  @Post('cron/execute-dunning-rules')
  @Roles('OWNER')
  executeDunningRules() {
    return this.dunningEngineService.executeRules();
  }

  // --- Dunning approval (T4-C2: FINAL_WARNING / LEGAL_ACTION) ---

  @Get('pending-escalations')
  @Roles('OWNER', 'FINANCE_MANAGER')
  pendingEscalations() {
    return this.overdueService.getPendingEscalations();
  }

  @Post('contracts/:id/approve-escalation')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approveEscalation(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.overdueService.approveDunningEscalation(id, user.id, user.role);
  }

  @Post('contracts/:id/reject-escalation')
  @Roles('OWNER', 'FINANCE_MANAGER')
  rejectEscalation(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.overdueService.rejectDunningEscalation(
      id,
      user.id,
      user.role,
      body.reason,
    );
  }

  // --- Z8: MDM lock request live-check + undo (used by useUndoMutation) ---

  @Get('mdm-requests/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  getMdmRequest(@Param('id') id: string) {
    return this.mdmLockService.getById(id);
  }

  /**
   * Z8: Soft-delete a PENDING MdmLockRequest. Used by the PROPOSE_LOCK undo
   * snackbar — only the original proposer (or OWNER) may undo, and only while
   * status === PENDING.
   */
  @Delete('mdm-requests/:id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  deleteMdmRequest(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.deleteIfPending(id, user.id, user.role);
  }

  // --- MDM lock/unlock approvals (OWNER/FM/BM — Z3) ---
  // BRANCH_MANAGER granted approval rights for parity with Approval tab
  // visibility and consistency with late-fee-waiver / legal-case approvals.

  @Post('mdm-requests/:id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  approveMdmLock(
    @Param('id') id: string,
    @Body() body: ApproveMdmDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.approve(id, user.id, user.role, {
      includeWallpaper: body.includeWallpaper,
    });
  }

  @Post('mdm-requests/:id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  rejectMdmLock(
    @Param('id') id: string,
    @Body() body: RejectMdmDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.reject(id, user.id, body.reason, user.role);
  }

  @Post('mdm-requests/:id/unlock')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  unlockMdm(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.mdmLockService.unlock(id, user.id, user.role);
  }

  // --- Promise-due reminders (P1 Task 14) ---

  @Get('promise-due-reminders')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  listPromiseDueReminders(
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Cross-branch roles see all branches; branch-scoped roles see their own.
    const CROSS_BRANCH_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];
    const branchId = CROSS_BRANCH_ROLES.includes(user.role) ? null : user.branchId;
    return this.overdueService.listPromiseDueRemindersToday(branchId);
  }

  // --- Bulk actions ---

  @Post('bulk/assign')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  bulkAssign(@Body() dto: BulkAssignDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkAssign(dto, user.id);
  }

  @Post('bulk/propose-lock')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  bulkProposeLock(@Body() dto: BulkProposeLockDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkProposeLock(dto, user.id);
  }

  @Post('bulk/send-line')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  bulkSendLine(@Body() dto: BulkSendLineDto, @CurrentUser() user: { id: string }) {
    return this.bulkService.bulkSendLine(dto, user.id);
  }

  // --- Ad-hoc single contract LINE send ---

  @Post(':contractId/send-line-adhoc')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async sendLineAdhoc(
    @Param('contractId') contractId: string,
    @Body() dto: SendLineAdHocDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.bulkService.bulkSendLine(
      {
        contractIds: [contractId],
        templateId: dto.templateId,
        customMessage: dto.customMessage,
      },
      user.id,
    );
  }

  // --- Contract letters ---

  @Get('letters')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  listLetters(
    @Query('status') status?: string,
    @Query('letterType') letterType?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    return this.contractLetterService.list({
      status: status as any,
      letterType: letterType as any,
      branchId: user?.role === 'BRANCH_MANAGER' ? user.branchId ?? undefined : undefined,
    });
  }

  @Post('letters/:id/pdf-generated')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markPdfGenerated(
    @Param('id') id: string,
    @Body() body: { pdfUrl: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markPdfGenerated(id, body.pdfUrl, user.id);
  }

  @Post('letters/:id/dispatch')
  @Roles('OWNER', 'FINANCE_MANAGER')
  dispatchLetter(
    @Param('id') id: string,
    @Body() body: { trackingNumber: string; evidencePhotoUrl?: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markDispatched(id, user.id, body);
  }

  @Post('letters/:id/delivered')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markLetterDelivered(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markDelivered(id, user.id);
  }

  @Patch('letters/:id/evidence')
  @Roles('OWNER', 'FINANCE_MANAGER')
  updateLetterEvidence(
    @Param('id') id: string,
    @Body() dto: UpdateLetterEvidenceDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.updateEvidence(id, dto.evidencePhotoUrl, user.id);
  }

  @Post('letters/:id/undeliverable')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markLetterUndeliverable(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.markUndeliverable(id, user.id, body.reason);
  }

  /**
   * Z9: Revert a letter from UNDELIVERABLE back to DISPATCHED. Used by the
   * MARK_UNDELIVERABLE undo snackbar — only the original dispatcher (or
   * OWNER) may revert, and only while status === UNDELIVERABLE.
   */
  @Post('letters/:id/revert-undeliverable')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  revertLetterUndeliverable(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.contractLetterService.revertUndeliverable(id, user.id, user.role);
  }

  @Post('letters/:id/cancel')
  @Roles('OWNER', 'FINANCE_MANAGER')
  cancelLetter(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: { id: string },
  ) {
    return this.contractLetterService.cancel(id, user.id, body.reason);
  }

  // --- P3 Task 2 — Auto-balance with exclusions (OWNER only) ---

  @Get('auto-balance/preview')
  @Roles('OWNER')
  previewAutoBalance() {
    return this.autoBalanceService.preview();
  }

  @Post('auto-balance/execute')
  @Roles('OWNER')
  executeAutoBalance(@CurrentUser() user: { id: string }) {
    return this.autoBalanceService.execute(user.id);
  }

  // --- Per-user snooze (B2 backend) ---

  @Post('contracts/:id/snooze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  snoozeContract(
    @Param('id') id: string,
    @Body() dto: CreateSnoozeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.snoozeService.snooze(id, user.id, dto);
  }

  @Delete('contracts/:id/snooze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  unsnoozeContract(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.snoozeService.unsnooze(id, user.id);
  }

  // --- Collections analytics ---

  @Get('analytics')
  @Roles('OWNER', 'FINANCE_MANAGER')
  getAnalytics(@Query() dto: AnalyticsQueryDto) {
    return this.analyticsService.getAnalytics({ range: dto.range ?? '30d' });
  }

  @Get('analytics/aging')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  getAnalyticsAging(@CurrentUser() user: { role: string; branchId: string | null }) {
    return this.analyticsAgingService.getAgingBuckets({
      userRole: user.role,
      userBranchId: user.branchId,
    });
  }

  @Get('analytics/leaderboard')
  @Roles('OWNER')
  getAnalyticsLeaderboard() {
    return this.analyticsLeaderboardService.getLeaderboard();
  }

  // P2 Task 8 / E3 — recovery rate by dunning channel.
  // `from` and `to` are ISO date strings; defaults to last 30 days when missing.
  @Get('analytics/recovery')
  @Roles('OWNER', 'FINANCE_MANAGER')
  getAnalyticsRecovery(
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = fromRaw ? new Date(fromRaw) : defaultFrom;
    const to = toRaw ? new Date(toRaw) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('รูปแบบวันที่ไม่ถูกต้อง (from/to ต้องเป็น ISO date)');
    }
    return this.analyticsRecoveryService.getRecoveryByChannel({ from, to });
  }

  @Get('analytics/stuck')
  @Roles('OWNER')
  getStuckContracts(@Query('days') daysRaw?: string) {
    const parsed = daysRaw ? parseInt(daysRaw, 10) : 14;
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
    return this.stuckContractsService.getStuckContracts({ days });
  }

  // --- LINE retry endpoints ---

  @Get('line-retries')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER')
  listFailed(@Query('limit') limit?: string) {
    const parsedLimit = Math.min(
      Math.max(parseInt(limit ?? '', 10) || 100, 1),
      500,
    );
    return this.dunningRetryService.listFailed(parsedLimit);
  }

  @Post('line-retries/:id/retry')
  @Roles('OWNER', 'FINANCE_MANAGER')
  retryLine(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.dunningRetryService.retry(id, user.id);
  }

  // --- P2P Lifecycle endpoints (Task 23) ---

  @Get('contracts/:id/cycle-deadline')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  getCycleDeadline(@Param('id') id: string) {
    return this.overdueService.getCycleDeadline(id);
  }

  @Get('contracts/:id/overdue-installments')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  getOverdueInstallments(@Param('id') id: string) {
    return this.overdueService.getOverdueInstallments(id);
  }

  // P4-SP5: Dashboard widget — ติดตามหนี้วันนี้
  @Get('promises/due-today')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  getPromisesDueToday() {
    return this.promiseService.getPromisesDueToday();
  }
}
