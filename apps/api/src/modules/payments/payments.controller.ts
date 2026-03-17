import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto, BulkRecordPaymentDto, WaiveLateFeeDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private paymentsService: PaymentsService,
    private prisma: PrismaService,
  ) {}

  @Get('pending')
  getPendingPayments(
    @Query('branchId') branchId?: string,
    @Query('date') date?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    // Enforce branch filtering for non-OWNER/ACCOUNTANT roles
    const effectiveBranchId = this.getEffectiveBranchId(branchId, user);
    return this.paymentsService.getPendingPayments({ branchId: effectiveBranchId, date, status, search });
  }

  @Get('daily-summary')
  getDailySummary(
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
    @CurrentUser() user?: { role: string; branchId: string | null },
  ) {
    const effectiveBranchId = this.getEffectiveBranchId(branchId, user);
    return this.paymentsService.getDailySummary(date || new Date().toISOString().split('T')[0], effectiveBranchId);
  }

  @Get('contract/:contractId')
  getContractPayments(@Param('contractId') contractId: string) {
    return this.paymentsService.getContractPayments(contractId);
  }

  @Post('record')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  async recordPayment(
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    // Validate branch access: SALES and BRANCH_MANAGER can only record for their branch
    await this.validateBranchAccess(dto.contractId, user);

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
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  async autoAllocatePayment(
    @Body() dto: BulkRecordPaymentDto,
    @CurrentUser() user: { id: string; role: string; branchId: string | null },
  ) {
    await this.validateBranchAccess(dto.contractId, user);

    return this.paymentsService.autoAllocatePayment(
      dto.contractId,
      dto.amount,
      dto.paymentMethod,
      user.id,
      dto.notes,
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

  /** Enforce branch-level access: SALES/BRANCH_MANAGER can only operate on their own branch */
  private async validateBranchAccess(
    contractId: string,
    user: { role: string; branchId: string | null },
  ) {
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') return;

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { branchId: true },
    });
    if (contract && user.branchId && contract.branchId !== user.branchId) {
      throw new ForbiddenException('ไม่สามารถบันทึกชำระเงินข้ามสาขาได้');
    }
  }

  /** Force branch filtering for non-global roles */
  private getEffectiveBranchId(
    requestedBranchId: string | undefined,
    user?: { role: string; branchId: string | null },
  ): string | undefined {
    if (!user) return requestedBranchId;
    if (user.role === 'OWNER' || user.role === 'ACCOUNTANT') return requestedBranchId;
    // SALES and BRANCH_MANAGER must see only their branch
    return user.branchId || requestedBranchId;
  }
}
