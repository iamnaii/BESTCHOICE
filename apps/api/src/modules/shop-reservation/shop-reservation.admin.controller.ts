import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopReservationService } from './shop-reservation.service';

/**
 * Admin endpoints สำหรับ hold ของเว็บ
 *
 * เส้นทางจริง: axios baseURL = '/api/admin' (apps/web/src/lib/env.ts:14) + path
 * '/admin/product-holds' → request = /api/admin/admin/product-holds →
 * AdminPrefixMiddleware ตัด '/api/admin/' ตัวแรกทิ้ง (admin-prefix.middleware.ts:26)
 * → /api/admin/product-holds → ตรงกับ @Controller('admin/product-holds') ใต้ global
 * prefix 'api'. รูปแบบเดียวกับ ShopOrdersAdminController เป๊ะ — ห้ามประกาศเป็น
 * @Controller('product-holds') เฉยๆ เพราะจะไม่มีอะไรเรียกถึง
 *
 * path หลัง rewrite ไม่ตรง /api/shop/* จึงถูกบังคับ aud='admin' โดย JwtAudienceGuard
 */
@Controller('admin/product-holds')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class ShopReservationAdminController {
  constructor(private service: ShopReservationService) {}

  @Get()
  list(@Query('status') status?: string, @Query('productId') productId?: string) {
    return this.service.listAdminHolds({ status, productId });
  }

  @Patch(':id/release')
  @Roles('OWNER', 'BRANCH_MANAGER')
  release(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.releaseHold(id, req.user.id);
  }
}
