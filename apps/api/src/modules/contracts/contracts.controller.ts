import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { CreateContractDto, UpdateContractDto, EarlyPayoffDto, ReviewContractDto, RejectContractDto, RequestCancellationDto, RejectCancellationDto } from './dto/contract.dto';
import { PdpaConsentDto } from './dto/pdpa-consent.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Contracts')
@ApiBearerAuth('JWT')
@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ContractsController {
  constructor(
    private contractsService: ContractsService,
    private workflowService: ContractWorkflowService,
    private paymentService: ContractPaymentService,
    private documentService: ContractDocumentService,
    private snapshotService: ContractSnapshotService,
  ) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('status') status?: string,
    @Query('workflowStatus') workflowStatus?: string,
    @Query('branchId') branchId?: string,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('salespersonId') salespersonId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CurrentUser() user?: { id: string; role: string; branchId: string | null },
  ) {
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;

    // BRANCH_MANAGER and below can only see contracts from their own branch
    const effectiveBranchId = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER'
      ? branchId
      : (user?.branchId || branchId);

    return this.contractsService.findAll({
      status, workflowStatus, branchId: effectiveBranchId, customerId, search, salespersonId, startDate, endDate,
      page: parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      limit: parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get('document-dashboard')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getDocumentDashboard(@Query('branchId') branchId?: string) {
    return this.documentService.getDocumentDashboard(branchId);
  }

  // P4-SP5: Dashboard milestones summary — new + completing this month
  @Get('milestones-summary')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER')
  getMilestonesSummary() {
    return this.contractsService.getMilestonesSummary();
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user?: { id: string; role: string; branchId: string | null },
  ) {
    return this.contractsService.findOne(id, user);
  }

  /**
   * Lightweight snapshot for the Customer 360 hover/long-press preview.
   * Designed for sub-100ms latency — does NOT include the full timeline,
   * full payment schedule, or contract documents.
   *
   * Returns: name+phone, contract#+status+product, totals/outstanding/
   * remaining-installments, last promise+result, last LINE timestamp+read,
   * last collector comment (truncated 100 chars).
   */
  @Get(':id/snapshot')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getSnapshot(
    @Param('id') id: string,
    @CurrentUser() user?: { id: string; role: string; branchId: string | null },
  ) {
    return this.snapshotService.getSnapshot(id, user);
  }

  @Get(':id/schedule')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getSchedule(@Param('id') id: string) {
    return this.paymentService.getSchedule(id);
  }

  @Get(':id/early-payoff-quote')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getEarlyPayoffQuote(
    @Param('id') id: string,
    @Query('discountPct') discountPct?: string,
    @Query('depositAccountCode') depositAccountCode?: string,
  ) {
    const pct = discountPct != null ? Number(discountPct) : undefined;
    return this.paymentService.getEarlyPayoffQuote(
      id,
      Number.isFinite(pct as number) ? pct : undefined,
      depositAccountCode,
    );
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateContractDto, @CurrentUser() user: { id: string; role: string }) {
    return this.contractsService.create(dto, user.id, user.role);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles('OWNER')
  softDelete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.contractsService.softDelete(id, user.id);
  }

  // === WORKFLOW ENDPOINTS ===

  @Post(':id/submit-review')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  submitForReview(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.workflowService.submitForReview(id, user.id);
  }

  // Contract approval is restricted to OWNER + FINANCE_MANAGER. Letting a
  // BRANCH_MANAGER approve contracts allowed BM-to-BM collusion within a
  // branch (peer approval without central finance review). BRANCH_MANAGER
  // can still submit-for-review; final approval must go through finance.
  @Post(':id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewContractDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.workflowService.approveContract(id, user.id, user.role, dto.reviewNotes);
  }

  // Reject mirrors approve — same authority required to close the loop.
  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectContractDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.workflowService.rejectContract(id, user.id, user.role, dto.reviewNotes);
  }

  @Post(':id/activate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async activate(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Enforce branch-level access before activation
    await this.contractsService.findOne(id, user);
    return this.workflowService.activate(id);
  }

  @Post(':id/early-payoff')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async earlyPayoff(
    @Param('id') id: string,
    @Body() dto: EarlyPayoffDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Enforce branch-level access before early payoff
    await this.contractsService.findOne(id, user);
    return this.paymentService.earlyPayoff(id, user.id, dto);
  }

  // === VALIDATION: ตรวจสอบความครบถ้วนของสัญญา ===
  @Get(':id/validate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  validateForSubmit(@Param('id') id: string) {
    return this.contractsService.validateForSubmit(id);
  }

  // === QR VERIFY: ตรวจสอบสัญญาผ่าน QR Code (public endpoint) ===
  @Public()
  @Get(':id/verify')
  verifyContract(@Param('id') id: string, @Query('hash') hash?: string) {
    return this.documentService.verifyContract(id, hash);
  }

  // === QR CODE DATA: ข้อมูลสำหรับสร้าง QR Code ===
  @Get(':id/qr-data')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getQrData(@Param('id') id: string) {
    return this.documentService.getQrData(id);
  }

  // === PDPA Consent: บันทึกความยินยอม PDPA และผูกกับสัญญา ===
  @Post(':id/pdpa-consent')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  recordPdpaConsent(
    @Param('id') id: string,
    @Body() dto: PdpaConsentDto,
    @Req() req: Request,
  ) {
    return this.documentService.recordPdpaConsent(id, dto.signatureImage, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Get(':id/pdpa-consent')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getPdpaConsent(@Param('id') id: string) {
    return this.documentService.getPdpaConsent(id);
  }

  // === P4-SP4: Contract Cancellation ===

  @Get('cancellations/pending')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  listPendingCancellations() {
    return this.contractsService.listPendingCancellations();
  }

  @Post(':id/request-cancellation')
  @Roles('OWNER', 'FINANCE_MANAGER', 'SALES')
  requestCancellation(
    @Param('id') id: string,
    @Body() dto: RequestCancellationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.requestCancellation(id, user.id, dto.reason, dto.refundAmount);
  }

  @Post('cancellations/:id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approveCancellation(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.approveCancellation(id, user.id);
  }

  @Post('cancellations/:id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  rejectCancellation(
    @Param('id') id: string,
    @Body() dto: RejectCancellationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.contractsService.rejectCancellation(id, user.id, dto.reason);
  }
}
