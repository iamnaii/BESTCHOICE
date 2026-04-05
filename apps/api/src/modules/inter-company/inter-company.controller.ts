import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InterCompanyService } from './inter-company.service';
import { CreateInterCompanyTransactionDto } from './dto/inter-company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Inter-Company')
@ApiBearerAuth('JWT')
@Controller('inter-company')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InterCompanyController {
  constructor(private interCompanyService: InterCompanyService) {}

  @Get()
  @Roles('OWNER', 'ACCOUNTANT')
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('entity') entity?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.interCompanyService.findAll({
      branchId,
      status,
      type,
      entity,
      startDate,
      endDate,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
    });
  }

  @Get('profit-summary')
  @Roles('OWNER', 'ACCOUNTANT')
  getProfitSummary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.interCompanyService.getProfitSummary({ branchId, startDate, endDate });
  }

  @Get(':id')
  @Roles('OWNER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.interCompanyService.findOne(id);
  }

  @Post()
  @Roles('OWNER')
  create(@Body() dto: CreateInterCompanyTransactionDto) {
    return this.interCompanyService.createFromSale(dto);
  }

  @Patch(':id/confirm')
  @Roles('OWNER', 'ACCOUNTANT')
  confirm(@Param('id') id: string) {
    return this.interCompanyService.confirmTransaction(id);
  }

  @Patch(':id/reconcile')
  @Roles('OWNER', 'ACCOUNTANT')
  reconcile(@Param('id') id: string) {
    return this.interCompanyService.reconcile(id);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.interCompanyService.remove(id);
  }
}
