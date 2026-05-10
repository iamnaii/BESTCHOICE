import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseTemplatesService } from './expense-templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Controller('expense-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseTemplatesController {
  constructor(private readonly service: ExpenseTemplatesService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateTemplateDto, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.create(dto, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('branchId') branchId: string | undefined,
    @Query('type') type: string | undefined,
    @CurrentUser() user: { id: string; branchId?: string; role: string },
  ) {
    return this.service.list({ branchId, type }, user);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  delete(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.softDelete(id, user);
  }

  @Post(':id/instantiate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  instantiate(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.instantiate(id, user);
  }
}
