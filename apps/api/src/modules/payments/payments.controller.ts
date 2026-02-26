import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto, BulkRecordPaymentDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get('pending')
  getPendingPayments(
    @Query('branchId') branchId?: string,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    return this.paymentsService.getPendingPayments({ branchId, date, status });
  }

  @Get('daily-summary')
  getDailySummary(
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.paymentsService.getDailySummary(date || new Date().toISOString().split('T')[0], branchId);
  }

  @Get('contract/:contractId')
  getContractPayments(@Param('contractId') contractId: string) {
    return this.paymentsService.getContractPayments(contractId);
  }

  @Post('record')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  recordPayment(@Body() dto: RecordPaymentDto, @CurrentUser() user: { id: string }) {
    return this.paymentsService.recordPayment(
      dto.contractId,
      dto.installmentNo,
      dto.amount,
      dto.paymentMethod,
      user.id,
      dto.evidenceUrl,
      dto.notes,
    );
  }

  @Post('auto-allocate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT')
  autoAllocatePayment(@Body() dto: BulkRecordPaymentDto, @CurrentUser() user: { id: string }) {
    return this.paymentsService.autoAllocatePayment(
      dto.contractId,
      dto.amount,
      dto.paymentMethod,
      user.id,
      dto.notes,
    );
  }
}
