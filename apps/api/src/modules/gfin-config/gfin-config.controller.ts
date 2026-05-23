import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { GfinConfigService } from './gfin-config.service';
import {
  CreateMaxPriceDto,
  UpdateMaxPriceDto,
  CreateOverpriceRuleDto,
  UpdateOverpriceRuleDto,
  CreateRateFactorDto,
  UpdateRateFactorDto,
} from './dto';

@Controller('gfin-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true }))
export class GfinConfigController {
  constructor(private service: GfinConfigService) {}

  // ===== Max Prices =====

  @Get('max-prices')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  listMaxPrices() {
    return this.service.listMaxPrices();
  }

  @Post('max-prices')
  @Roles('OWNER')
  createMaxPrice(@Body() dto: CreateMaxPriceDto, @Req() req: any) {
    return this.service.createMaxPrice(dto, req.user.id);
  }

  @Patch('max-prices/:id')
  @Roles('OWNER')
  updateMaxPrice(@Param('id') id: string, @Body() dto: UpdateMaxPriceDto, @Req() req: any) {
    return this.service.updateMaxPrice(id, dto, req.user.id);
  }

  @Delete('max-prices/:id')
  @Roles('OWNER')
  deleteMaxPrice(@Param('id') id: string, @Req() req: any) {
    return this.service.softDeleteMaxPrice(id, req.user.id);
  }

  // ===== Overprice Rules =====

  @Get('overprice-rules')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  listOverpriceRules() {
    return this.service.listOverpriceRules();
  }

  @Post('overprice-rules')
  @Roles('OWNER')
  createOverpriceRule(@Body() dto: CreateOverpriceRuleDto, @Req() req: any) {
    return this.service.createOverpriceRule(dto, req.user.id);
  }

  @Patch('overprice-rules/:id')
  @Roles('OWNER')
  updateOverpriceRule(
    @Param('id') id: string,
    @Body() dto: UpdateOverpriceRuleDto,
    @Req() req: any,
  ) {
    return this.service.updateOverpriceRule(id, dto, req.user.id);
  }

  @Delete('overprice-rules/:id')
  @Roles('OWNER')
  deleteOverpriceRule(@Param('id') id: string, @Req() req: any) {
    return this.service.softDeleteOverpriceRule(id, req.user.id);
  }

  // ===== Rate Factors =====

  @Get('rate-factors')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  listRateFactors() {
    return this.service.listRateFactors();
  }

  @Post('rate-factors')
  @Roles('OWNER')
  createRateFactor(@Body() dto: CreateRateFactorDto, @Req() req: any) {
    return this.service.createRateFactor(dto, req.user.id);
  }

  @Patch('rate-factors/:id')
  @Roles('OWNER')
  updateRateFactor(@Param('id') id: string, @Body() dto: UpdateRateFactorDto, @Req() req: any) {
    return this.service.updateRateFactor(id, dto, req.user.id);
  }

  @Delete('rate-factors/:id')
  @Roles('OWNER')
  deleteRateFactor(@Param('id') id: string, @Req() req: any) {
    return this.service.softDeleteRateFactor(id, req.user.id);
  }

  // ===== Match Preview =====

  @Get('match-preview')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  matchPreview(@Query('productId') productId: string) {
    return this.service.matchPreview(productId);
  }
}
