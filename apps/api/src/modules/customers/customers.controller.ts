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
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import type { CustomerTierResponse } from './dto/tier.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { UploadDocumentDto, DeleteDocumentDto } from './dto/document.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PiiAuditService } from '../pii/pii-audit.service';
import { maskNationalId } from '../../utils/pii.util';

type AuthRequest = Request & { user?: { id: string; role: string } };

@ApiTags('Customers')
@ApiBearerAuth('JWT')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class CustomersController {
  constructor(
    private customersService: CustomersService,
    private piiAudit: PiiAuditService,
    private readonly tierService: CustomerTierService,
  ) {}

  // ---------------------------------------------------------------------------
  // Role-based PII masking helpers
  // ---------------------------------------------------------------------------

  private applyRoleMask<T extends { nationalId?: string | null }>(
    customer: T | null,
    userRole: string,
  ): T | null {
    if (!customer) return customer;
    if (userRole === 'SALES') {
      return {
        ...customer,
        nationalId: customer.nationalId ? maskNationalId(customer.nationalId) : customer.nationalId,
      };
    }
    return customer;
  }

  private applyRoleMaskList<T extends { nationalId?: string | null }>(
    customers: T[],
    userRole: string,
  ): T[] {
    return customers.map((c) => this.applyRoleMask(c, userRole) as T);
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async findAll(
    @Query() pagination: PaginationDto,
    @Query('search') search?: string,
    @Query('contractStatus') contractStatus?: string,
    @Query('hasOverdue') hasOverdue?: string,
    @Query('creditStatus') creditStatus?: string,
    @Query('branchId') branchId?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
    @Query('tier') tier?: string,
    @Req() req?: AuthRequest,
  ) {
    const result = await this.customersService.findAll(
      search,
      pagination.page,
      pagination.limit,
      contractStatus,
      hasOverdue === 'true',
      creditStatus,
      branchId,
      sortBy,
      sortOrder,
      tier,
    );

    const role = req?.user?.role || 'UNKNOWN';

    void this.piiAudit.logDecryption({
      userId: req?.user?.id || 'system',
      customerId: `BATCH:${result.data?.length ?? 0}`,
      fields: ['nationalId', 'phone'],
      role,
      masked: role === 'SALES',
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'] as string | undefined,
    });

    return {
      ...result,
      data: this.applyRoleMaskList(result.data as Array<{ nationalId?: string | null }>, role),
    };
  }

  @Get('referral-stats')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'Top referrers: ลูกค้าที่แนะนำมากที่สุด' })
  getReferralStats(@Query('limit') limit?: string) {
    return this.customersService.getReferralStats(limit ? parseInt(limit) : 10);
  }

  @Get('watch-list')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'Watch list: ลูกค้าเสี่ยงค้างชำระ (early warning)' })
  getWatchList(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getWatchList(branchId, limit ? parseInt(limit) : 30);
  }

  @Get('upsell-candidates')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าพร้อมอัพเกรด (ผ่อน >70% หรือปิดสัญญาแล้ว)' })
  getUpsellCandidates(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getUpsellCandidates(branchId, limit ? parseInt(limit) : 20);
  }

  @Get('search')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async search(@Query('q') q: string, @Req() req: AuthRequest) {
    const results = await this.customersService.search(q || '');
    const role = req.user?.role || 'UNKNOWN';

    if (Array.isArray(results) && results.length > 0) {
      void this.piiAudit.logDecryption({
        userId: req.user?.id || 'system',
        customerId: `SEARCH:${results.length}`,
        fields: ['nationalId', 'phone'],
        role,
        masked: role === 'SALES',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });
      return this.applyRoleMaskList(
        results as Array<{ nationalId?: string | null }>,
        role,
      );
    }
    return results;
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async findOne(@Param('id') id: string, @Req() req: AuthRequest) {
    const customer = await this.customersService.findOne(id);
    if (!customer) return customer;

    const role = req.user?.role || 'UNKNOWN';
    const isMasked = role === 'SALES';

    // Fire-and-forget: never let audit log block the response
    void this.piiAudit.logDecryption({
      userId: req.user?.id || 'system',
      customerId: id,
      fields: ['nationalId', 'phone', 'address'],
      role,
      masked: isMasked,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return this.applyRoleMask(customer as { nationalId?: string | null }, role);
  }

  @Get(':id/contracts')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getContracts(@Param('id') id: string) {
    return this.customersService.getContracts(id);
  }

  @Get(':id/chat-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  getChatSummary(@Param('id') id: string) {
    return this.customersService.getChatSummary(id);
  }

  @Get(':id/risk-flag')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getRiskFlag(@Param('id') id: string) {
    return this.customersService.getRiskFlag(id);
  }

  @Get(':id/referrals')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าที่ถูกแนะนำมาโดยลูกค้านี้' })
  getReferrals(@Param('id') id: string) {
    return this.customersService.getReferrals(id);
  }

  @Get(':id/tier')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async getTier(@Param('id') id: string): Promise<CustomerTierResponse> {
    return this.tierService.getCustomerTier(id);
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
