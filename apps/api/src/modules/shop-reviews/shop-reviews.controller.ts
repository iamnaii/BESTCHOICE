import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopReviewsService } from './shop-reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('shop/reviews')
export class ShopReviewsController {
  constructor(private service: ShopReviewsService) {}

  // Static route must be declared before ':productId' so 'recent' never hits the UUID pipe
  @Get('recent')
  recent(@Query('limit') limit?: string) {
    const parsed = parseInt(limit ?? '', 10);
    const take = Math.min(Math.max(Number.isNaN(parsed) ? 6 : parsed, 1), 20);
    return this.service.listRecent(take);
  }

  @Get(':productId')
  list(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.service.listPublic(productId);
  }

  @Get(':productId/summary')
  summary(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.service.summary(productId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() dto: CreateReviewDto, @Req() req: { user: { sub: string } }) {
    return this.service.create(dto, req.user.sub);
  }
}
