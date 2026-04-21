import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ShopOrdersService } from './shop-orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('shop/orders')
@UseGuards(JwtAuthGuard)
export class ShopOrdersController {
  constructor(private service: ShopOrdersService) {}

  @Get()
  listMine(@Req() req: { user: { sub: string } }) {
    return this.service.listMine(req.user.sub);
  }

  @Get(':orderNumber')
  get(@Param('orderNumber') orderNumber: string, @Req() req: { user: { sub: string } }) {
    return this.service.getByOrderNumber(orderNumber, req.user.sub);
  }

  @Post(':orderNumber/bank-slip')
  uploadSlip(
    @Param('orderNumber') orderNumber: string,
    @Body() body: { slipUrl: string },
    @Req() req: { user: { sub: string } },
  ) {
    return this.service.uploadBankSlip(orderNumber, req.user.sub, body.slipUrl);
  }
}
