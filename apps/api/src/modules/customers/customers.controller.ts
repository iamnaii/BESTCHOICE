import { Throttle } from '@nestjs/throttler';
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
import { SkipTracingService } from './skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import type { CustomerTierResponse } from './dto/tier.dto';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { UpdateCustomerContactDto } from './dto/skip-tracing.dto';
import { FillProspectContactDto } from './dto/fill-prospect-contact.dto';
import { UploadDocumentDto, DeleteDocumentDto } from './dto/document.dto';
import { CustomersListQueryDto } from './dto/customers-list-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PiiAuditService } from '../pii/pii-audit.service';
import { CustomerMergeService } from '../chat-prospects/customer-merge.service';
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
    private readonly skipTracingService: SkipTracingService,
    private readonly insightsService: CustomerInsightsService,
    private readonly merge: CustomerMergeService,
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

  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async exportRows(
    @Query() filters: CustomersListQueryDto,
    @Req() req?: AuthRequest,
  ) {
    return this.findAll(filters, req, true);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  async findAll(
    // 🔴 ตัวกรองทั้งชุดเป็น DTO ก้อนเดียว — เวอร์ชันเดิมเป็น @Query() รายตัว 10 ตัว
    // แล้วส่งต่อแบบเรียงตำแหน่ง ตัวใดที่เพิ่มใหม่แต่ลืมส่งจะถูกทิ้งเงียบ ๆ
    @Query() filters: CustomersListQueryDto,
    @Req() req?: AuthRequest,
    snapshot = false,
  ) {
    const read = snapshot ? this.customersService.exportRows.bind(this.customersService) : this.customersService.findAll.bind(this.customersService);
    const result = await read(filters);

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
    return this.customersService.getReferralStats(
      limit ? Math.min(parseInt(limit) || 10, 100) : 10,
    );
  }

  @Get('watch-list')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'Watch list: ลูกค้าเสี่ยงค้างชำระ (early warning)' })
  getWatchList(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getWatchList(
      branchId,
      limit ? Math.min(parseInt(limit) || 30, 100) : 30,
    );
  }

  @Get('upsell-candidates')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({ summary: 'ลูกค้าพร้อมอัพเกรด (ผ่อน >70% หรือปิดสัญญาแล้ว)' })
  getUpsellCandidates(
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getUpsellCandidates(
      branchId,
      limit ? Math.min(parseInt(limit) || 20, 100) : 20,
    );
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

  @Get(':id/insights')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({
    summary:
      'Smart Customer Data — preferred contact time/channel, response rates, last LINE seen',
  })
  getInsights(
    @Param('id') id: string,
    @CurrentUser() user: { role: string; branchId: string | null },
  ) {
    return this.insightsService.getInsights(id, { role: user.role, branchId: user.branchId });
  }

  @Get(':id/chat-summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  getChatSummary(@Param('id') id: string) {
    return this.customersService.getChatSummary(id);
  }

  @Get(':id/summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({
    summary: 'Compact summary for chat inbox sidebar (name, phone, active contracts, outstanding)',
  })
  getSummary(@Param('id') id: string) {
    return this.customersService.getSummary(id);
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

  /**
   * รวมผู้สนใจอัตโนมัติจากแชท (:id) เข้าลูกค้าเดิม (:targetId) — ใช้ตอนเติมเบอร์แล้วซ้ำ (สเปค 3.3 ข)
   *
   * ปลายทางเป็น "ผู้สนใจอัตโนมัติ" อีกคนได้ (Ruling R22): คำใบ้ "อาจเป็นคนเดียวกัน" ชี้ทิศทางรวม
   * ของผู้สนใจสองคนไว้แล้ว (สเปค §3.6 ใหม่กว่าเข้าเก่ากว่า) และ "รวมห้องแชท" ก็รับปลายทาง
   * placeholder อยู่ก่อน (R13) — ทางข้อมูลเดียวกันทุกประการ
   * ต้นทางยังต้องเป็น placeholder ที่ยังไม่ถูกลบเสมอ (absorbPlaceholder ตรวจเอง) ⇒ ยังรวมทางเดียว
   */
  @Post(':id/absorb-into/:targetId')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async absorbInto(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Req() req: { user: { id: string; role: string } },
  ) {
    const actor = { id: req.user.id, role: req.user.role };
    // Ruling R26 — SALES รวมได้เฉพาะผู้สนใจที่ห้องยังไม่มีคนดูแล หรือเป็นห้องของตัวเอง
    // (การรวมย้ายห้องทุกห้อง จึงต้องแน่นเท่าทางผูกห้อง/กดไม่ใช่ ไม่ใช่แค่มี role)
    await this.merge.assertActorMayAbsorb(id, actor);
    return this.merge.absorbPlaceholder(id, targetId, actor, { allowPlaceholderTarget: true });
  }

  /**
   * เติมเบอร์/ชื่อให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 ปุ่ม "เพิ่มเบอร์/ข้อมูล" · Ruling R27)
   * roles เท่าทางผูกห้อง — SALES ผ่านด่านห้องเดียวกับ absorb-into (R26): ห้องของ placeholder ต้องไม่มีคนดูแลหรือเป็นของตัวเอง
   * เบอร์ซ้ำ → 409 พร้อม existingCustomer (รูปเดียวกับ POST /customers) ให้เว็บเสนอ "รวมกับลูกค้าเดิมคนนี้"
   */
  @Post(':id/fill-contact')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  async fillContact(
    @Param('id') id: string,
    @Body() dto: FillProspectContactDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    const actor = { id: req.user.id, role: req.user.role };
    await this.merge.assertActorMayAbsorb(id, actor);
    return this.customersService.fillPlaceholderContact(id, dto, actor);
  }

  @Delete(':id')
  @Roles('OWNER')
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }

  @Post(':id/update-contact')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  @ApiOperation({
    summary: 'Skip-tracing — แก้เบอร์/LINE หรือทำเครื่องหมาย "สูญหาย" (P2 Collections D6)',
  })
  updateContact(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerContactDto,
    @Req() req: AuthRequest,
  ) {
    return this.skipTracingService.updateContact(id, dto, {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
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
