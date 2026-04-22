import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopSavingPlanService } from './shop-saving-plan.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';

interface ShopAuthRequest {
  user: { sub: string };
}

@Controller('shop/saving-plans')
@UseGuards(JwtAuthGuard)
export class ShopSavingPlanController {
  constructor(private service: ShopSavingPlanService) {}

  @Post()
  create(@Body() dto: CreatePlanDto, @Req() req: ShopAuthRequest) {
    return this.service.create(dto, req.user.sub);
  }

  @Get()
  listMine(@Req() req: ShopAuthRequest) {
    return this.service.listMine(req.user.sub);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: ShopAuthRequest) {
    return this.service.get(id, req.user.sub);
  }

  @Post(':id/pay')
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayInstallmentDto,
    @Req() req: ShopAuthRequest,
  ) {
    return this.service.createPaymentIntent(id, dto.amount, req.user.sub);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: ShopAuthRequest) {
    return this.service.cancel(id, req.user.sub);
  }
}
