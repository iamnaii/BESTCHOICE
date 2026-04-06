import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { CreatePromotionDto, UpdatePromotionDto, ApplyPromotionDto } from './dto/promotions.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Promotions')
@ApiBearerAuth('JWT')
@Controller('promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(private promotionsService: PromotionsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('isActive') isActive?: string,
  ) {
    return this.promotionsService.findAll({
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Get('active')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  findActive() {
    return this.promotionsService.findActivePromotions();
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  findOne(@Param('id') id: string) {
    return this.promotionsService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreatePromotionDto) {
    return this.promotionsService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotionsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.promotionsService.remove(id);
  }

  @Post(':id/apply')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  applyToSale(@Param('id') id: string, @Body() dto: ApplyPromotionDto) {
    return this.promotionsService.applyToSale(
      id,
      dto.saleId,
      dto.customerId,
      dto.discountAmount,
    );
  }
}
