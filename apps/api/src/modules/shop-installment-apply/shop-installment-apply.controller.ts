import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ShopInstallmentApplyService } from './shop-installment-apply.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/**
 * Customer-facing installment application endpoints.
 *
 * The POST endpoint is intentionally public (no JwtAuthGuard) — anonymous shoppers
 * must be able to submit an application without a customer account. The optional
 * `lineUserId` field lets users opt in to LINE notifications; staff will follow up
 * by phone either way. Once a customer logs in, `GET /mine` and ownership checks
 * on `GET /:applicationNumber` use their session to scope results.
 */
@Controller('shop/applications')
export class ShopInstallmentApplyController {
  constructor(private service: ShopInstallmentApplyService) {}

  @Post()
  submit(@Body() dto: CreateApplicationDto, @Req() req: { user?: { sub?: string } }) {
    const customerId = req.user?.sub;
    return this.service.submit(dto, customerId);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  listMine(@Req() req: { user: { sub: string } }) {
    return this.service.listMine(req.user.sub);
  }

  @Get(':applicationNumber')
  get(@Param('applicationNumber') applicationNumber: string, @Req() req: { user?: { sub?: string } }) {
    return this.service.getByNumber(applicationNumber, req.user?.sub);
  }
}
