import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { StickersService } from './stickers.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Products')
@ApiBearerAuth('JWT')
@Controller('sticker-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StickersController {
  constructor(private stickersService: StickersService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stickersService.findAll(
      page ? parseInt(page) : undefined,
      limit ? parseInt(limit) : undefined,
    );
  }

  @Get('product/:productId/data')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getStickerData(@Param('productId') productId: string) {
    return this.stickersService.getStickerData(productId);
  }

  @Get('products/data')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getStickerDataBatch(@Query('ids') ids?: string) {
    if (!ids) return [];
    const productIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
    return this.stickersService.getStickerDataBatch(productIds);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  findOne(@Param('id') id: string) {
    return this.stickersService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateStickerTemplateDto) {
    return this.stickersService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateStickerTemplateDto) {
    return this.stickersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.stickersService.remove(id);
  }
}
