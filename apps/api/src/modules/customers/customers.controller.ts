import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('contractStatus') contractStatus?: string,
    @Query('hasOverdue') hasOverdue?: string,
    @Query('creditStatus') creditStatus?: string,
    @Query('branchId') branchId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.customersService.findAll(
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      contractStatus,
      hasOverdue === 'true',
      creditStatus,
      branchId,
      sortBy,
      sortOrder,
    );
  }

  @Get('search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  search(@Query('q') q: string) {
    return this.customersService.search(q || '');
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Get(':id/contracts')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getContracts(@Param('id') id: string) {
    return this.customersService.getContracts(id);
  }

  @Get(':id/risk-flag')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  getRiskFlag(@Param('id') id: string) {
    return this.customersService.getRiskFlag(id);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

  @Post(':id/documents')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  uploadDocument(
    @Param('id') id: string,
    @Body() dto: { fileName: string; fileUrl: string; mimeType: string; fileSize: number },
  ) {
    return this.customersService.uploadDocument(id, dto);
  }

  @Delete(':id/documents')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteDocument(@Param('id') id: string, @Body() dto: { fileUrl: string }) {
    return this.customersService.deleteDocument(id, dto.fileUrl);
  }
}
