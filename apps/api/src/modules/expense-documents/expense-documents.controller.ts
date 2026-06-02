import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PostPermissionGuard } from './post-permission.guard';
import { ReversePermissionGuard } from './reverse-permission.guard';
import { ExpenseDocumentsService } from './expense-documents.service';
import { ExpenseVoucherPdfService } from './services/expense-voucher-pdf.service';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { CreatePettyCashDto } from './dto/create-petty-cash.dto';
import { VoidExpenseDocumentDto } from './dto/void-expense.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

@Controller('expense-documents')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class ExpenseDocumentsController {
  constructor(
    private readonly service: ExpenseDocumentsService,
    private readonly voucherPdf: ExpenseVoucherPdfService,
  ) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(
    @Body() dto: CreateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(dto, user.id);
  }

  @Post('credit-note')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createCreditNote(
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.createCreditNote(dto, user.id);
  }

  @Post('payroll')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createPayroll(
    @Body() dto: CreatePayrollDto,
    @CurrentUser() user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.service.createPayroll(dto, user);
  }

  @Post('settlement')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createSettlement(
    @Body() dto: CreateSettlementDto,
    @CurrentUser() user: { id: string; branchId?: string; role: string },
  ) {
    return this.service.createSettlement(dto, user);
  }

  @Post('petty-cash')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  createPettyCash(
    @Body() dto: CreatePettyCashDto,
    @CurrentUser() user: { id: string; branchId?: string; role: string },
  ) {
    return this.service.createPettyCash(dto, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query() query: ListExpenseDocumentsQueryDto,
    @Req() req: { user: { id: string; branchId?: string; role: string } },
  ) {
    return this.service.list(query, { branchId: req.user.branchId, role: req.user.role });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(
    @Req() req: { user: { id: string; branchId?: string; role: string } },
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // Mirror list() scoping: cross-branch roles see all (or filter by ?branchId);
    // others are pinned to their own branch — query param ignored.
    // @Req() is non-optional: JwtAuthGuard guarantees req.user is present.
    const effective = hasCrossBranchAccess(req.user)
      ? branchId
      : req.user.branchId;
    return this.service.getSummary({ branchId: effective, startDate, endDate });
  }

  /**
   * Phase A.5 — Tax-disallowed summary for ภ.ง.ด.50/51 prep.
   * Returns total amount of POSTED expense docs flagged as non-deductible
   * (ม.65 ตรี) over a date range. Doc-level + line-level overrides counted
   * separately (no double-count). Cross-branch roles see all; others scoped.
   */
  @Get('tax-disallowed')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  taxDisallowed(
    @Req() req: { user: { id: string; branchId?: string; role: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effective = hasCrossBranchAccess(req.user) ? branchId : req.user.branchId;
    return this.service.getTaxDisallowedSummary({ branchId: effective, from, to });
  }

  /**
   * AP Aging — Fix Report P1-1.
   * Buckets unpaid ACCRUAL expenses by days-since-documentDate into
   * 0-30 / 31-60 / 61-90 / >90 + Total. Optional filter by vendorName or
   * single bucket. Cross-branch roles see all; others see their branch only.
   */
  @Get('ap-aging')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  apAging(
    @Req() req: { user: { id: string; branchId?: string; role: string } },
    @Query('branchId') branchId?: string,
    @Query('vendor') vendor?: string,
    @Query('bucket') bucket?: '0-30' | '31-60' | '61-90' | '90+',
  ) {
    const effective = hasCrossBranchAccess(req.user) ? branchId : req.user.branchId;
    return this.service.getApAging({ branchId: effective, vendor, bucket });
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  dailySummary(
    @Query('date') date: string,
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: { id: string; branchId?: string | null; role?: string | null },
  ) {
    return this.service.getDailySummary({ date, branchId }, user);
  }

  @Post('preview-je')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  previewJe(@Body() dto: CreateExpenseDocumentDto) {
    return this.service.previewJe(dto);
  }

  @Get(':id/cn-cap')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  cnCap(@Param('id') id: string) {
    return this.service.getCreditNoteCap(id);
  }

  // Per-document audit timeline — feeds the shared InternalControlActionBar
  // timeline on the ExpenseDetailPage (mirrors GET /other-income/:id/audit).
  @Get(':id/audit')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getAuditTrail(@Param('id') id: string) {
    return this.service.getAuditTrail(id);
  }

  // ใบสำคัญจ่าย (Payment Voucher) PDF — mirrors GET /other-income/:id/receipt.pdf.
  // Two-segment route declared BEFORE the generic :id route (module convention:
  // :id/sub routes precede :id). No ExportEnabledGuard — this module does not
  // wire the export-gate pattern (unlike other-income).
  @Get(':id/voucher.pdf')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getVoucherPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.voucherPdf.generate(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="expense-voucher-${id}.pdf"`,
      'Content-Length': pdf.length.toString(),
    });
    res.send(pdf);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.update(id, dto, user.id);
  }

  /**
   * D1.3.2.3 — Post DRAFT → ACCRUAL.
   *
   * Class-level guards (JwtAuthGuard, RolesGuard, BranchGuard) run first.
   * The method-level `@Roles(...)` decorator is widened to the SUPERSET of
   * any value the dynamic SystemConfig key `post_permission` may select
   * (OWNER + FINANCE_MANAGER + BRANCH_MANAGER + ACCOUNTANT). The
   * `PostPermissionGuard` then narrows per-request based on the live
   * SystemConfig value. Default `post_permission =
   * 'OWNER+FINANCE_MANAGER+ACCOUNTANT'` preserves current behavior.
   *
   * SALES is intentionally excluded from the superset — they don't post
   * accounting documents.
   */
  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  @UseGuards(PostPermissionGuard)
  post(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.service.post(id, user.id, user.role);
  }

  /**
   * D1.2.1.1 — Submit a DRAFT expense doc for approval.
   * Only callable when SystemConfig `approval_enabled` is true. Flips
   * status DRAFT → PENDING_APPROVAL. Approve action lives on the sibling
   * /approve endpoint (D1.2.1.6).
   */
  @Post(':id/submit-for-approval')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  submitForApproval(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.submitForApproval(id, user.id);
  }

  /**
   * D1.2.1.6 — Approve a PENDING_APPROVAL expense doc.
   *
   * When SystemConfig `auto_post_on_approve` is true (default) the doc is
   * immediately auto-posted in the same transaction (status: POSTED).
   * When false the doc stays APPROVED and an OWNER can call /post later.
   *
   * D1.2.1.3 — approver gating is the runtime membership check inside
   * service.approve() against SystemConfig `approvers_list`. The @Roles
   * decorator widens beyond OWNER so any listed user (including SALES /
   * ACCOUNTANT) is not blocked at the controller before that runtime check
   * runs. OWNER is always allowed regardless of list contents.
   */
  @Post(':id/approve')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role?: string },
  ) {
    return this.service.approve(id, user.id, user.role);
  }

  /**
   * D1.3.2.4 — Reverse / void a posted doc.
   *
   * Class-level guards (JwtAuthGuard, RolesGuard, BranchGuard) run first.
   * Method-level `@Roles(...)` is the COARSE SUPERSET of any role the dynamic
   * SystemConfig key `reverse_permission` may select — OWNER + FINANCE_MANAGER
   * + ACCOUNTANT — so RolesGuard never pre-blocks a role the dynamic guard
   * would allow (e.g. ACCOUNTANT under the 'OWNER+FINANCE_MANAGER+ACCOUNTANT'
   * or CUSTOM modes). `ReversePermissionGuard` then narrows per-request; the
   * default `reverse_permission = 'OWNER+FINANCE_MANAGER'` still rejects
   * ACCOUNTANT, preserving current behavior.
   */
  @Post(':id/void')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(ReversePermissionGuard)
  void(
    @Param('id') id: string,
    @Body() dto: VoidExpenseDocumentDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.voidDocument(id, user.id, dto, user.role);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  delete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.softDelete(id, user.id);
  }
}
