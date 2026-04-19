import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RefundsService } from './refunds.service';
import {
  RequestRefundDto,
  MarkRefundReversedDto,
  RejectRefundDto,
  MarkRefundFailedDto,
} from './dto/refund.dto';

@ApiTags('Refunds')
@ApiBearerAuth('JWT')
@Controller('refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findAll(
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.refunds.findAll({
      status,
      contractId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.refunds.findOne(id);
  }

  @Post('request')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  request(@Body() dto: RequestRefundDto, @CurrentUser() user: { id: string }) {
    return this.refunds.requestRefund(dto, user.id);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'FINANCE_MANAGER')
  approve(@Param('id') id: string, @CurrentUser() user: { id: string; role: string }) {
    return this.refunds.approveRefund(id, user.id, user.role);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRefundDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.refunds.rejectRefund(id, dto, user.id, user.role);
  }

  @Post(':id/mark-reversed')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markReversed(
    @Param('id') id: string,
    @Body() dto: MarkRefundReversedDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.refunds.markReversed(id, dto, user.id, user.role);
  }

  @Post(':id/mark-failed')
  @Roles('OWNER', 'FINANCE_MANAGER')
  markFailed(
    @Param('id') id: string,
    @Body() dto: MarkRefundFailedDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.refunds.markFailed(id, dto, user.id, user.role);
  }
}
