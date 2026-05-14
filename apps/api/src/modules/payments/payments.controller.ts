import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  UseGuards,
  Req,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsNumber, Min } from 'class-validator';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto, BulkRecordPaymentDto, WaiveLateFeeDto, PreviewJournalDto } from './dto/payment.dto';
import { ImportPaymentsCsvDto } from './dto/csv-import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { hasCrossBranchAccess } from '../auth/branch-access.util';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { RescheduleService } from '../installments/reschedule.service';

class CreatePartialQrDto {
  @IsNumber()
  @Min(1, { message: 'ยอดต้องมากกว่า 0 บาท' })
  amount!: number;
}

@ApiTags('Payments')
@ApiBearerAuth('JWT')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    @Inject(forwardRef(() => PaySolutionsService))
    private paySolutionsService: PaySolutionsService,
    private rescheduleService: RescheduleService,
  ) {}

  @Get('pending')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getPendingPayments(
    @Query('branchId') branchId?: string,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dunningStage') dunningStage?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    // Enforce branch filtering for non-OWNER/ACCOUNTANT roles
    const effectiveBranchId = this.getEffectiveBranchId(branchId, user);
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.paymentsService.getPendingPayments({
      branchId: effectiveBranchId,
      date,
      status,
      search,
      dunningStage,
      page: parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      limit: parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Get('daily-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getDailySummary(
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    const effectiveBranchId = this.getEffectiveBranchId(branchId, user);
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.paymentsService.getDailySummary(
      date || new Date().toISOString().split('T')[0],
      effectiveBranchId,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  @Get('contract/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ดูงวดชำระทั้งหมดของสัญญา' })
  async getContractPayments(
    @Param('contractId') contractId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: { id: string; role: string; branchId: string | null },
  ) {
    // Enforce branch-level access
    if (user) await this.paymentsService.validateBranchAccess(contractId, user);
    const parsedPage = page ? parseInt(page, 10) : undefined;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 200) : undefined;
    return this.paymentsService.getContractPayments(
      contractId,
      parsedPage && !isNaN(parsedPage) ? parsedPage : undefined,
      parsedLimit && !isNaN(parsedLimit) ? parsedLimit : undefined,
    );
  }

  /**
   * Preview JE lines for a payment without persisting anything.
   * Used by the RecordPaymentWizard to show "Journal Auto" live preview.
   */
  @Post('preview-journal')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'คำนวณ JE preview สำหรับการชำระ (ไม่บันทึก)' })
  previewJournal(@Body() dto: PreviewJournalDto) {
    return this.paymentsService.previewJournal({
      contractId: dto.contractId,
      installmentNo: dto.installmentNo,
      amountReceived: dto.amountReceived,
      depositAccountCode: dto.depositAccountCode,
      lateFee: dto.lateFee,
      case: dto.case,
      daysToShift: dto.daysToShift,
      splitMode: dto.splitMode,
    });
  }

  @Post('record')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ short: { ttl: 10000, limit: 5 } }) // Max 5 payment records per 10s per user
  @ApiOperation({ summary: 'บันทึกการชำระเงิน (งวดเดียว)' })
  async recordPayment(
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Validate branch access: SALES and BRANCH_MANAGER can only record for their branch
    await this.paymentsService.validateBranchAccess(dto.contractId, user);

    // ── RESCHEDULE case (Wave 3 / T3) ─────────────────────────────────────────
    // Per CSV golden case-6a/6b: "Step 1 — UPDATE DB (ไม่มี Journal)".
    // RescheduleService.execute() shifts due_dates + reduces last installment
    // amountDue by fee + writes RESCHEDULE AuditLog atomically.
    // The JP6 JE post happens later when the customer actually pays — split-pay
    // (6a) sends a fee-advance receipt, bundled (6b) bundles fee + installment
    // in the next normal recordPayment call. Both flows are dispatched by
    // payments.service.previewJournal / recordPayment using `splitMode`.
    if (dto.case === 'RESCHEDULE') {
      if (!dto.daysToShift || dto.daysToShift < 1) {
        throw new BadRequestException('กรุณาระบุจำนวนวันที่เลื่อน (daysToShift) มากกว่า 0');
      }
      const variant = dto.splitMode === 'SPLIT' ? '6a' : '6b';
      const result = await this.rescheduleService.execute({
        contractId: dto.contractId,
        fromInstallmentNo: dto.installmentNo,
        daysToShift: dto.daysToShift,
        userId: user.id,
        variant,
      });
      return {
        success: true,
        case: 'RESCHEDULE',
        variant,
        rescheduleFee: result.rescheduleFee.toFixed(2),
        shiftedInstallmentCount: result.shiftedInstallmentIds.length,
        shiftedInstallmentIds: result.shiftedInstallmentIds,
      };
    }

    // Wizard step 3 fields: wizardMethod/referenceNumber/slipUrl/memo map to existing recordPayment params.
    // slipUrl → evidenceUrl, referenceNumber → transactionRef, memo → notes (merged)
    const effectiveEvidenceUrl = dto.slipUrl || dto.evidenceUrl;
    const effectiveTransactionRef = dto.referenceNumber || dto.transactionRef;
    const effectiveNotes = dto.memo
      ? dto.notes
        ? `${dto.notes}\n${dto.memo}`
        : dto.memo
      : dto.notes;

    // Map wizard method to legacy paymentMethod enum
    let effectivePaymentMethod = dto.paymentMethod;
    if (dto.wizardMethod) {
      const methodMap: Record<string, string> = {
        CASH: 'CASH',
        TRANSFER: 'BANK_TRANSFER',
        QR: 'QR_EWALLET',
        PAYSOLUTIONS: 'BANK_TRANSFER', // PaySolutions uses bank transfer settlement
      };
      effectivePaymentMethod = methodMap[dto.wizardMethod] ?? dto.paymentMethod;
    }

    return this.paymentsService.recordPayment(
      dto.contractId,
      dto.installmentNo,
      dto.amount,
      effectivePaymentMethod,
      user.id,
      effectiveEvidenceUrl,
      effectiveNotes,
      effectiveTransactionRef,
      dto.depositAccountCode,
      dto.toleranceApproverId,
      dto.case,
    );
  }

  @Post('auto-allocate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ short: { ttl: 10000, limit: 5 } }) // Max 5 auto-allocations per 10s per user
  async autoAllocatePayment(
    @Body() dto: BulkRecordPaymentDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    await this.paymentsService.validateBranchAccess(dto.contractId, user);

    return this.paymentsService.autoAllocatePayment(
      dto.contractId,
      dto.amount,
      dto.paymentMethod,
      user.id,
      dto.notes,
      dto.evidenceUrl,
    );
  }

  @Get('credit-balance/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getCreditBalance(@Param('contractId') contractId: string) {
    return this.paymentsService.getCreditBalance(contractId);
  }

  @Post('apply-credit/:contractId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async applyCreditBalance(
    @Param('contractId') contractId: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    await this.paymentsService.validateBranchAccess(contractId, user);
    return this.paymentsService.applyCreditBalance(contractId, user.id);
  }

  @Post('import-csv')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ short: { ttl: 60000, limit: 5 } }) // Max 5 CSV imports per minute
  async importPaymentsCsv(
    @Body() dto: ImportPaymentsCsvDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.paymentsService.importPaymentsFromCsv(
      dto.csv,
      dto.paymentMethod || 'BANK_TRANSFER',
      user.id,
      dto.depositAccountCode,
    );
  }

  @Patch(':paymentId/waive-late-fee')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async waiveLateFee(
    @Param('paymentId') paymentId: string,
    @Body() dto: WaiveLateFeeDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
    @Req() req: Request,
  ) {
    // W1 fix: BranchGuard at class level only fires when request carries
    // branchId. Waiver payload carries only paymentId, so cross-branch
    // bypass was possible. Resolve the contract from the payment and run
    // validateBranchAccess explicitly.
    await this.paymentsService.validateBranchAccessByPayment(paymentId, user);

    // T3-C4: capture IP + UA of the APPROVER for the immutable audit row.
    // Trust proxy forwarding is already configured at the app bootstrap
    // level (req.ip honours X-Forwarded-For); user-agent comes straight
    // from the browser. Both are optional — null is acceptable if unset.
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ||
      req.ip ||
      null;
    const userAgentHeader = req.headers['user-agent'];
    const userAgent =
      typeof userAgentHeader === 'string' ? userAgentHeader : null;

    return this.paymentsService.waiveLateFee(
      paymentId,
      dto.reason,
      user.id,
      dto.approverId,
      { ipAddress, userAgent },
    );
  }

  /** Force branch filtering for non-global roles */
  private getEffectiveBranchId(
    requestedBranchId: string | undefined,
    user?: { role: string; branchId: string | null },
  ): string | undefined {
    if (!user) return requestedBranchId;
    if (hasCrossBranchAccess(user)) return requestedBranchId;
    // SALES and BRANCH_MANAGER must see only their branch
    return user.branchId || requestedBranchId;
  }

  // ─── Partial-payment QR (cashier sends QR to customer's LINE) ───────
  // Customer pays via PaySolutions PromptPay → webhook auto-records as PARTIAL.
  // The active link is what powers the "QR ส่งแล้ว" badge in the payments table.

  @Post(':id/partial-qr')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async createPartialQr(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePartialQrDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // W1 fix: enforce branch access — class-level BranchGuard only fires
    // when the request carries branchId, partial-QR routes carry only id.
    await this.paymentsService.validateBranchAccessByPayment(id, user);
    return this.paySolutionsService.createPartialPaymentQR({
      paymentId: id,
      amount: dto.amount,
    });
  }

  @Get(':id/partial-qr/active')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async getActivePartialQr(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // W1 fix: same as above — explicit branch check on paymentId-keyed route.
    await this.paymentsService.validateBranchAccessByPayment(id, user);
    return this.paymentsService.getActivePartialQr(id);
  }

  @Delete(':id/partial-qr')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async cancelPartialQr(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // W1 fix: same as above — explicit branch check on paymentId-keyed route.
    await this.paymentsService.validateBranchAccessByPayment(id, user);
    return this.paymentsService.cancelActivePartialQr(id);
  }
}
