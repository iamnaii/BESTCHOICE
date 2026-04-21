import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ShopCheckoutService } from './shop-checkout.service';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { ApplyLoyaltyDto } from './dto/apply-loyalty.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('shop/checkout')
@UseGuards(JwtAuthGuard)
export class ShopCheckoutController {
  constructor(private service: ShopCheckoutService) {}

  @Post('validate-promo')
  validatePromo(@Body() dto: ValidatePromoDto) {
    return this.service.validatePromoCode(dto);
  }

  @Post('apply-loyalty')
  applyLoyalty(@Body() dto: ApplyLoyaltyDto, @Req() req: { user: { sub: string } }) {
    return this.service.validateLoyaltyRedemption(
      { reservationId: dto.reservationId, points: dto.points },
      req.user.sub,
    );
  }

  @Post('place')
  place(@Body() dto: PlaceOrderDto, @Req() req: { user: { sub: string } }) {
    return this.service.placeOrder(dto, req.user.sub);
  }
}
