import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopCsService } from './shop-cs.service';
import { CancelOrderDto, RefundRequestDto } from './dto/request.dto';

@Controller('shop/cs')
@UseGuards(JwtAuthGuard)
export class ShopCsController {
  constructor(private service: ShopCsService) {}

  @Post('orders/:orderNumber/cancel')
  cancel(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelOrderDto,
    @Req() req: { user: { sub: string } },
  ) {
    return this.service.cancel(orderNumber, req.user.sub, dto.reason);
  }

  @Post('orders/:orderNumber/refund')
  refund(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: RefundRequestDto,
    @Req() req: { user: { sub: string } },
  ) {
    return this.service.requestRefund(orderNumber, req.user.sub, dto.type, dto.reason);
  }
}
