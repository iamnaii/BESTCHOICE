import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get()
  findAll() {
    return this.suppliersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER')
  create(@Body() dto: { name: string; contactName: string; phone: string; phoneSecondary?: string; lineId?: string; address?: string; taxId?: string; notes?: string }) {
    return this.suppliersService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.suppliersService.update(id, dto as any);
  }
}
