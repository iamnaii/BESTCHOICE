import { Throttle } from '@nestjs/throttler';
import { ContractsListQueryDto } from './dto/contracts-list-query.dto';
import { ContractQuoteDto } from './dto/contract-quote.dto';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { EarlyPayoffSlipService } from './early-payoff-slip/early-payoff-slip.service';
import { EarlyPayoffSlipConfirmDto, EarlyPayoffSlipVerifyDto } from './dto/early-payoff-slip.dto';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { CreateContractDto, UpdateContractDto, UpdateContractBundlesDto, EarlyPayoffDto, ReviewContractDto, RejectContractDto, RequestCancellationDto, RejectCancellationDto, ShopCollectSettlementDto } from './dto/contract.dto';
import { PdpaConsentDto } from './dto/pdpa-consent.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';
import { d } from '../../utils/decimal.util';

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
    private contractJournalQuery: ContractJournalQueryService,
    private journeyEntries: JourneyEntryWriter,
    // ท้ายสุด — contracts.controller.journey.spec new ด้วยมือ 7 ตัว (ปิดสัญญาด้วยสลิป 2026-09-24)
    private earlyPayoffSlip: EarlyPayoffSlipService,
  ) {}

  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  exportRows(@Query() filters: ContractsListQueryDto, @CurrentUser() user: { id: string; role: string; branchId: string | null }) {
    return this.contractsService.exportRows(filters, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query() filters: ContractsListQueryDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.contractsService.findAll(filters, user);
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
    @Query('collectedByShop') collectedByShop?: string,
  ) {
    const pct = discountPct != null ? Number(discountPct) : undefined;
    const effectiveDepositCode = collectedByShop === 'true' ? '11-2107' : depositAccountCode;
    return this.paymentService.getEarlyPayoffQuote(
      id,
      Number.isFinite(pct as number) ? pct : undefined,
      effectiveDepositCode,
    );
  }

  @Post('quote')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  quote(@Body() dto: ContractQuoteDto, @CurrentUser() user: { id: string; role: string; branchId?: string | null }) {
    return this.contractsService.quote(dto, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateContractDto, @CurrentUser() user: { id: string; role: string; branchId?: string | null }) {
    return this.contractsService.create(dto, user.id, user.role, user.branchId);
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

  /**
   * แก้ไขของแถมของสัญญา — ได้จนกว่าจะเปิดใช้. ขอบเขตสาขา/เจ้าของสัญญาบังคับใน service
   * (route รูป /:id ไม่มี branchId ให้ BranchGuard ตรวจ)
   */
  @Patch(':id/bundles')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  updateBundles(
    @Param('id') id: string,
    @Body() dto: UpdateContractBundlesDto,
    @CurrentUser() user: { id: string; role: string; branchId?: string | null },
  ) {
    return this.contractsService.updateBundles(id, dto.bundleProductIds, user);
  }

  @Delete(':id')
  @Roles('OWNER')
  softDelete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.contractsService.softDelete(id, user.id);
  }

  // === WORKFLOW ENDPOINTS ===

  @Post(':id/submit-review')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  submitForReview(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.workflowService.submitForReview(id, user.id, user.role);
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
    const activated = await this.workflowService.activate(id);
    // การเดินทางของลูกค้า: contracts ไม่มี activatedAt และ activate(id) ไม่รับผู้ใช้ ⇒ บันทึกที่นี่หลัง tx ของ activate commit แล้ว
    // recordAfterCommit ไม่โยน error — สัญญาเปิดสำเร็จแล้วต้องคืนผลเสมอ · ไม่คัดลอกข้อมูลลูกค้า (PDPA)
    await this.journeyEntries.recordAfterCommit({
      customerId: activated.customerId,
      kind: 'CONTRACT_ACTIVATED',
      occurredAt: new Date(),
      actorType: 'STAFF',
      actorUserId: user.id,
      refType: 'contract',
      refId: activated.id,
      data: {
        contractNumber: activated.contractNumber,
        totalMonths: activated.totalMonths,
        monthlyPayment: d(activated.monthlyPayment).toDecimalPlaces(2).toNumber(),
      },
      dedupeKey: journeyDedupeKey('CONTRACT_ACTIVATED', activated.id),
    });
    return activated;
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

  /**
   * ปิดสัญญาด้วยสลิป ขั้นที่ 1 (2026-09-24): อัปโหลดสลิป → อ่าน (OCR) → ตรวจ 5 ข้อกับยอดปิดสด
   * ผ่านครบ = ได้ตั๋ว (15 นาที) ไปกดยืนยันขั้นที่ 2 โดยไม่ต้องเข้าคิวอนุมัติ · ไม่ผ่าน = ส่งขออนุมัติตามเดิม
   * (แนบ slipUrl ไปกับคำขอได้). role เท่าเส้นทาง early-payoff เดิม.
   */
  @Post(':id/early-payoff/slip')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  @UseInterceptors(FileInterceptor('slip'))
  async earlyPayoffSlipVerify(
    @Param('id') id: string,
    @Body() body: EarlyPayoffSlipVerifyDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'ไฟล์สลิปมีขนาดเกิน 5MB' }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
        fileIsRequired: true,
        errorHttpStatusCode: 400,
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    await this.contractsService.findOne(id, user);
    return this.earlyPayoffSlip.verify(id, file, body.discountPct, user.id);
  }

  /** ปิดสัญญาด้วยสลิป ขั้นที่ 2: ยืนยันด้วยตั๋วจากขั้นที่ 1 → JP4 + ใบเสร็จ + ปลดล็อกเครื่อง (ไม่ผ่านคิวอนุมัติ) */
  @Post(':id/early-payoff/slip-confirm')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  async earlyPayoffSlipConfirm(
    @Param('id') id: string,
    @Body() dto: EarlyPayoffSlipConfirmDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    await this.contractsService.findOne(id, user);
    return this.earlyPayoffSlip.confirm(id, user.id, dto);
  }

  /**
   * Task 3: Post Dr cash / Cr 11-2107 when the shop remits collected cash to FINANCE.
   * Clears the Dr 11-2107 receivable created by a `collectedByShop` early payoff.
   */
  @Post(':id/shop-collect-settlement')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  shopCollectSettlement(
    @Param('id') id: string,
    @Body() dto: ShopCollectSettlementDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.paymentService.shopCollectSettlement(id, user.id, dto);
  }

  /**
   * บันทึกบัญชีของสัญญา — JE ทุกใบ (ทั้งสมุด FINANCE/SHOP, ทุก flow) ที่ stamp
   * metadata.contractId + ใบกลับรายการที่ชี้กลับมา. Roles + branch scope เหมือน
   * GET :id (ข้ามสาขา = 404 ใน service). Spec 2026-09-05 contract-journal-view.
   */
  @Get(':id/journal-entries')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ดูบันทึกบัญชี (JE) ทุกใบของสัญญา ทั้งสมุด FINANCE และ SHOP' })
  listJournalEntries(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    return this.contractJournalQuery.listForContract(id, user);
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
