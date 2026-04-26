import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShippingAddressDto } from '../shop-checkout/dto/place-order.dto';

const MAX_SHIPPING_ADDRESSES = 20;

@Controller('shop/me')
@UseGuards(JwtAuthGuard)
export class ShopMeController {
  constructor(private prisma: PrismaService) {}

  @Get('addresses')
  async listAddresses(@Req() req: { user: { sub: string } }) {
    const c = await this.prisma.customer.findUnique({ where: { id: req.user.sub } });
    return (c?.shippingAddresses ?? []) as unknown[];
  }

  @Post('addresses')
  async addAddress(@Req() req: { user: { sub: string } }, @Body() addr: ShippingAddressDto) {
    const c = await this.prisma.customer.findUnique({ where: { id: req.user.sub } });
    const existing = ((c?.shippingAddresses as unknown[]) ?? []);
    if (existing.length >= MAX_SHIPPING_ADDRESSES) {
      throw new BadRequestException(
        `บันทึกที่อยู่จัดส่งได้สูงสุด ${MAX_SHIPPING_ADDRESSES} รายการ`,
      );
    }
    const next = [...existing, addr];
    await this.prisma.customer.update({
      where: { id: req.user.sub },
      data: { shippingAddresses: next as any },
    });
    return next;
  }
}
