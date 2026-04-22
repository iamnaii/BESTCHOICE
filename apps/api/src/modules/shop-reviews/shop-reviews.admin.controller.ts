import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShopReviewsService } from './shop-reviews.service';

@Controller('admin/reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'BRANCH_MANAGER')
export class ShopReviewsAdminController {
  constructor(private service: ShopReviewsService) {}

  @Get()
  list(@Query('productId') productId?: string, @Query('status') status?: string) {
    return this.service.adminList(productId, status);
  }

  @Patch(':id/hide')
  hide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { reason?: string },
    @Req() req: { user: { id: string } },
  ) {
    return this.service.moderate(id, 'HIDDEN', body?.reason, req.user.id);
  }

  @Patch(':id/restore')
  restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: { user: { id: string } },
  ) {
    return this.service.moderate(id, 'PUBLISHED', undefined, req.user.id);
  }
}
