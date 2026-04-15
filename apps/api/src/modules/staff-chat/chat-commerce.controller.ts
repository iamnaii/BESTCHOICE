import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatCommerceService } from './services/chat-commerce.service';

@Controller('staff-chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatCommerceController {
  constructor(private chatCommerce: ChatCommerceService) {}

  // ─── Payment Links ────────────────────────────────────

  @Post('rooms/:id/payment-link')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
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
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async sendProductCard(
    @Param('id') roomId: string,
    @Body() body: { productId: string },
    @Req() req: any,
  ) {
    await this.chatCommerce.sendProductCard({
      sessionId: roomId,
      staffId: req.user.id,
      productId: body.productId,
    });
    return { success: true };
  }

  // ─── Product Search ───────────────────────────────────

  @Get('products/search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async searchProducts(@Query('q') query: string) {
    return this.chatCommerce.searchProducts(query);
  }
}
