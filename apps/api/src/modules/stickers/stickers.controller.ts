import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { StickersService } from './stickers.service';
import { CreateStickerTemplateDto, UpdateStickerTemplateDto } from './dto/sticker.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('sticker-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StickersController {
  constructor(private stickersService: StickersService) {}

  @Get()
  findAll() {
    return this.stickersService.findAll();
  }

  @Get('product/:productId/data')
  getStickerData(@Param('productId') productId: string) {
    return this.stickersService.getStickerData(productId);
  }

  @Get(':id')
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
