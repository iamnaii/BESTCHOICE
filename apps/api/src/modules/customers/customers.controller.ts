import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { UploadDocumentDto, DeleteDocumentDto } from './dto/document.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Customers')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('contractStatus') contractStatus?: string,
    @Query('hasOverdue') hasOverdue?: string,
    @Query('creditStatus') creditStatus?: string,
    @Query('branchId') branchId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.customersService.findAll(
      search,
      pagination.page,
      pagination.limit,
      contractStatus,
      hasOverdue === 'true',
      creditStatus,
      branchId,
      sortBy,
      sortOrder,
    );
  }

  @Get('referral-stats')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'Top referrers: ลูกค้าที่แนะนำมากที่สุด' })
  getReferralStats(@Query('limit') limit?: string) {
    return this.customersService.getReferralStats(limit ? parseInt(limit) : 10);
  }

  @Get('watch-list')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'Watch list: ลูกค้าเสี่ยงค้างชำระ (early warning)' })
  getWatchList(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getWatchList(branchId, limit ? parseInt(limit) : 30);
  }

  @Get('upsell-candidates')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าพร้อมอัพเกรด (ผ่อน >70% หรือปิดสัญญาแล้ว)' })
  getUpsellCandidates(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getUpsellCandidates(branchId, limit ? parseInt(limit) : 20);
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

  @Get(':id/referrals')
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าที่ถูกแนะนำมาโดยลูกค้านี้' })
  getReferrals(@Param('id') id: string) {
    return this.customersService.getReferrals(id);
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
    @Body() dto: UploadDocumentDto,
  ) {
    return this.customersService.uploadDocument(id, dto);
  }

  @Delete(':id/documents')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteDocument(@Param('id') id: string, @Body() dto: DeleteDocumentDto) {
    return this.customersService.deleteDocument(id, dto.fileUrl);
  }
}
