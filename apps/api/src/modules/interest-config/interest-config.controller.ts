import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { InterestConfigService } from './interest-config.service';
import { CreateInterestConfigDto, UpdateInterestConfigDto } from './dto/interest-config.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('interest-configs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InterestConfigController {
  constructor(private service: InterestConfigService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('by-category/:category')
  findByCategory(@Param('category') category: string) {
    return this.service.findByCategory(category);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateInterestConfigDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('OWNER')
  update(@Param('id') id: string, @Body() dto: UpdateInterestConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
