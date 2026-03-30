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
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FinanceReceivablesService } from './finance-receivables.service';
import {
  CreateFinanceCompanyDto,
  UpdateFinanceCompanyDto,
} from './dto/create-finance-company.dto';
import {
  CreateFinanceReceivableDto,
  UpdateFinanceReceivableDto,
} from './dto/create-finance-receivable.dto';
import { RecordFinanceReceiptDto } from './dto/record-finance-receipt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Finance Receivables')
@ApiBearerAuth()
@Controller('finance-receivables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FinanceReceivablesController {
  constructor(private service: FinanceReceivablesService) {}

  // ========== Finance Companies ==========

  @Get('companies')
  @ApiOperation({ summary: 'ดึงรายการบริษัทไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAllCompanies(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAllCompanies(
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  @Get('companies/:id')
  @ApiOperation({ summary: 'ดึงรายละเอียดบริษัทไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOneCompany(@Param('id') id: string) {
    return this.service.findOneCompany(id);
  }

  @Post('companies')
  @ApiOperation({ summary: 'สร้างบริษัทไฟแนนซ์ใหม่' })
  @Roles('OWNER')
  createCompany(@Body() dto: CreateFinanceCompanyDto) {
    return this.service.createCompany(dto);
  }

  @Patch('companies/:id')
  @ApiOperation({ summary: 'แก้ไขบริษัทไฟแนนซ์' })
  @Roles('OWNER')
  updateCompany(@Param('id') id: string, @Body() dto: UpdateFinanceCompanyDto) {
    return this.service.updateCompany(id, dto);
  }

  @Delete('companies/:id')
  @ApiOperation({ summary: 'ลบบริษัทไฟแนนซ์ (soft delete)' })
  @Roles('OWNER')
  deleteCompany(@Param('id') id: string) {
    return this.service.deleteCompany(id);
  }

  // ========== Finance Receivables ==========

  @Get()
  @ApiOperation({ summary: 'ดึงรายการตัดจ่ายไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findAllReceivables(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('financeCompanyId') financeCompanyId?: string,
    @Query('branchId') branchId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAllReceivables(
      search,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      status,
      financeCompanyId,
      branchId,
      dateFrom,
      dateTo,
    );
  }

  @Get('summary')
  @ApiOperation({ summary: 'สรุปยอดตัดจ่ายไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  getSummary(@Query('branchId') branchId?: string) {
    return this.service.getSummary(branchId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดึงรายละเอียดตัดจ่ายไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  findOneReceivable(@Param('id') id: string) {
    return this.service.findOneReceivable(id);
  }

  @Post()
  @ApiOperation({ summary: 'สร้างรายการตัดจ่ายไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  createReceivable(@Body() dto: CreateFinanceReceivableDto, @Request() req: { user: { id: string } }) {
    return this.service.createReceivable(dto, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'แก้ไขรายการตัดจ่ายไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  updateReceivable(@Param('id') id: string, @Body() dto: UpdateFinanceReceivableDto) {
    return this.service.updateReceivable(id, dto);
  }

  @Post(':id/receipts')
  @ApiOperation({ summary: 'บันทึกการรับเงินจากบริษัทไฟแนนซ์' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')
  recordReceipt(
    @Param('id') id: string,
    @Body() dto: RecordFinanceReceiptDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.recordReceipt(id, dto, req.user.id);
  }
}
