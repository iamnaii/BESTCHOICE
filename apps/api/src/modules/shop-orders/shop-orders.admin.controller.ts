import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopOrdersService } from './shop-orders.service';

/**
 * Admin endpoints for online-order fulfillment.
 *
 * Path: /api/admin/online-orders (AdminPrefixMiddleware strips /admin at
 * Express level → /api/online-orders reaches this controller). That path
 * does NOT match the /api/shop/* SHOP_PATH rule, so JwtAudienceGuard
 * enforces aud='admin' automatically.
 */
@Controller('admin/online-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
export class ShopOrdersAdminController {
  constructor(private service: ShopOrdersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listAdminQueue(status);
  }

  @Patch(':id/confirm-bank')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  confirmBank(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.service.confirmBankTransfer(id, req.user.id);
  }

  @Patch(':id/ship')
  ship(@Param('id') id: string, @Body() body: { trackingNumber: string }) {
    return this.service.markShipped(id, body.trackingNumber);
  }

  @Patch(':id/deliver')
  deliver(@Param('id') id: string) {
    return this.service.markDelivered(id);
  }

  @Patch(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.service.cancelOrder(id, body.reason);
  }
}
