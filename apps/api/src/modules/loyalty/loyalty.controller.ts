import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { RedeemPointsDto, PointHistoryQueryDto } from './dto/loyalty.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LoyaltyController {
  constructor(private loyaltyService: LoyaltyService) {}

  /** GET /loyalty/:customerId/points — ยอดแต้มปัจจุบัน */
  @Get(':customerId/points')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  getPoints(@Param('customerId') customerId: string) {
    return this.loyaltyService.getCustomerPoints(customerId);
  }

  /** GET /loyalty/:customerId/history — ประวัติแต้ม */
  @Get(':customerId/history')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  getHistory(
    @Param('customerId') customerId: string,
    @Query() query: PointHistoryQueryDto,
  ) {
    const page = query.page ? Number(query.page) : 1;
    const limit = query.limit ? Number(query.limit) : 20;
    return this.loyaltyService.getPointHistory(customerId, page, limit);
  }

  /** POST /loyalty/:customerId/redeem — แลกแต้ม */
  @Post(':customerId/redeem')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  redeemPoints(@Param('customerId') customerId: string, @Body() dto: RedeemPointsDto) {
    return this.loyaltyService.redeemPoints(
      customerId,
      dto.amount,
      dto.description,
      dto.posTransactionId,
      dto.contractId,
      dto.approverId,
    );
  }

  /** GET /loyalty/referral-stats/:customerId — สถิติการแนะนำลูกค้า */
  @Get('referral-stats/:customerId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'FINANCE_MANAGER')
  getReferralStats(@Param('customerId') customerId: string) {
    return this.loyaltyService.getReferralStats(customerId);
  }
}
