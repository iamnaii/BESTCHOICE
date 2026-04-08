import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto, BulkRecordPaymentDto, WaiveLateFeeDto } from './dto/payment.dto';
import { ImportPaymentsCsvDto } from './dto/csv-import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { UserThrottlerGuard } from '../../guards/user-throttler.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Payments')
@ApiBearerAuth('JWT')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

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

    return this.paymentsService.recordPayment(
      dto.contractId,
      dto.installmentNo,
      dto.amount,
      dto.paymentMethod,
      user.id,
      dto.evidenceUrl,
      dto.notes,
      dto.transactionRef,
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
    );
  }

  @Patch(':paymentId/waive-late-fee')
  @Roles('OWNER', 'BRANCH_MANAGER')
  waiveLateFee(
    @Param('paymentId') paymentId: string,
    @Body() dto: WaiveLateFeeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.paymentsService.waiveLateFee(paymentId, dto.reason, user.id);
  }

  /** Force branch filtering for non-global roles */
  private getEffectiveBranchId(
    requestedBranchId: string | undefined,
    user?: { role: string; branchId: string | null },
  ): string | undefined {
    if (!user) return requestedBranchId;
    if (user.role === 'OWNER' || user.role === 'FINANCE_MANAGER' || user.role === 'ACCOUNTANT') return requestedBranchId;
    // SALES and BRANCH_MANAGER must see only their branch
    return user.branchId || requestedBranchId;
  }
}
