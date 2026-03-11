import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString } from 'class-validator';

class VoidReceiptDto {
  @IsString()
  reason: string;
}

@Controller('receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private receiptsService: ReceiptsService) {}

  @Get('contract/:contractId')
  getContractReceipts(@Param('contractId') contractId: string) {
    return this.receiptsService.getContractReceipts(contractId);
  }

  @Get(':id')
  getReceipt(@Param('id') id: string) {
    return this.receiptsService.getReceipt(id);
  }

  @Get('number/:receiptNumber')
  getReceiptByNumber(@Param('receiptNumber') receiptNumber: string) {
    return this.receiptsService.getReceiptByNumber(receiptNumber);
  }

  @Post(':id/void')
  @Roles('OWNER', 'BRANCH_MANAGER')
  voidReceipt(
    @Param('id') id: string,
    @Body() dto: VoidReceiptDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.receiptsService.voidReceipt(id, dto.reason, user.id);
  }
}
