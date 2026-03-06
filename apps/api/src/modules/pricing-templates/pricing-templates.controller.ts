import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { PricingTemplatesService } from './pricing-templates.service';
import { CreatePricingTemplateDto, UpdatePricingTemplateDto } from './dto/pricing-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('pricing-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PricingTemplatesController {
  constructor(private service: PricingTemplatesService) {}

  @Get()
  findAll(@Query('brand') brand?: string, @Query('category') category?: string) {
    return this.service.findAll({ brand, category });
  }

  @Get('lookup')
  lookup(
    @Query('brand') brand: string,
    @Query('model') model: string,
    @Query('storage') storage?: string,
    @Query('category') category?: string,
    @Query('hasWarranty') hasWarranty?: string,
  ) {
    const hw = hasWarranty === 'true' ? true : hasWarranty === 'false' ? false : null;
    return this.service.lookup(brand, model, storage || null, category || 'PHONE_NEW', hw);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreatePricingTemplateDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdatePricingTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
