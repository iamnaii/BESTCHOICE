import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopReviewsService } from './shop-reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Controller('shop/reviews')
export class ShopReviewsController {
  constructor(private service: ShopReviewsService) {}

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
