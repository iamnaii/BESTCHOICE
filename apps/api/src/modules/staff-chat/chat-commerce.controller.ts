import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatCommerceService, ProductCardPart } from './services/chat-commerce.service';

const STAFF_ROLES = [
  'OWNER',
  'BRANCH_MANAGER',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'SALES',
] as const;

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatCommerceController {
  constructor(private chatCommerce: ChatCommerceService) {}

  // ─── Payment Links ────────────────────────────────────

  @Post('rooms/:id/payment-link')
  @Roles(...STAFF_ROLES)
  async createPaymentLink(
    @Param('id') roomId: string,
    @Body() body: { contractId: string; installmentNo?: number },
    @Req() req: any,
  ) {
    return this.chatCommerce.createPaymentLinkInChat({
      sessionId: roomId,
      staffId: req.user.id,
      contractId: body.contractId,
      installmentNo: body.installmentNo,
    });
  }

  // ─── Product Cards ────────────────────────────────────

  @Post('rooms/:id/product-card')
  @Roles(...STAFF_ROLES)
  async sendProductCard(
    @Param('id') roomId: string,
    @Body() body: { productId: string; clientMessageId?: string; parts?: ProductCardPart[] },
    @Req() req: any,
  ) {
    if (!body?.productId) {
      throw new BadRequestException('กรุณาระบุสินค้าที่จะส่ง');
    }
    // ไม่มี token = ส่งซ้ำได้ → บังคับให้ client ส่งมาเสมอ (idempotency)
    if (!body?.clientMessageId) {
      throw new BadRequestException('กรุณาระบุ clientMessageId');
    }
    return this.chatCommerce.sendProductCard({
      sessionId: roomId,
      staffId: req.user.id,
      productId: body.productId,
      clientMessageId: body.clientMessageId,
      parts: body.parts,
    });
  }

  // ─── Product Search ───────────────────────────────────

  @Get('products/search')
  @Roles(...STAFF_ROLES)
  async searchProducts(@Query('q') query: string) {
    return this.chatCommerce.searchProducts(query);
  }

  @Get('products/:id/summary')
  @Roles(...STAFF_ROLES)
  async getProductSummary(@Param('id') productId: string) {
    return this.chatCommerce.getProductSummary(productId);
  }
}
