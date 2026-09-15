import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CreditCheckService } from './credit-check.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreditAffordabilityDto } from './dto/credit-affordability.dto';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../customer-journey/journey-data-schemas';

/**
 * การเดินทางของลูกค้า — ผู้เปิดตรวจเครดิต: CreditCheckService.create/createForCustomer ทิ้ง _userId
 * ⇒ บันทึกที่ controller หลัง service คืนผล (tx ของ service commit แล้ว) โดยไม่แก้ service
 * บันทึกเฉพาะใบที่เพิ่งเกิดในคำขอนี้: POST /contracts/:id/credit-check กับใบเดิมคือการอัปโหลดใหม่ ไม่ใช่การเปิดตรวจ
 * เผื่อเวลา DB (created_at DEFAULT now()) กับเครื่องแอปคลาดกัน 60 วินาที · กดซ้ำภายใน 30 วินาทีได้ใบเดิม → dedupeKey กันแถวซ้ำ
 */
const OPENED_IN_REQUEST_TOLERANCE_MS = 60_000;

async function recordCreditCheckOpened(
  writer: JourneyEntryWriter,
  check: { id: string; customerId: string; createdAt: Date },
  userId: string,
  via: 'CONTRACT' | 'CUSTOMER',
  requestStartedAt: Date,
): Promise<void> {
  if (check.createdAt.getTime() < requestStartedAt.getTime() - OPENED_IN_REQUEST_TOLERANCE_MS) return;
  await writer.recordAfterCommit({
    customerId: check.customerId,
    kind: 'CREDIT_CHECK_OPENED_BY',
    occurredAt: check.createdAt,
    actorType: 'STAFF',
    actorUserId: userId,
    refType: 'credit_check',
    refId: check.id,
    data: { via },
    dedupeKey: journeyDedupeKey('CREDIT_CHECK_OPENED_BY', check.id),
  });
}

// === Global credit check list ===
@ApiTags('Credit Check')
@ApiBearerAuth('JWT')
@Controller('credit-checks')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class GlobalCreditCheckController {
  constructor(private service: CreditCheckService) {}

  @Post(':id/affordability')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  previewAffordability(@Param('id') id: string, @Body() dto: CreditAffordabilityDto,
    @CurrentUser() user: { id: string; role: string }) {
    return this.service.override_.approval.preview(id, dto, user);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @CurrentUser() user: { id: string; role: string },
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('branchId') branchId?: string,
    @Query('checkedById') checkedById?: string,
  ) {
    return this.service.findAll({
      status,
      search,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      startDate,
      endDate,
      branchId,
      checkedById,
    }, user);
  }

  @Get('customer-history/:customerId')
  @ApiOperation({ summary: 'ดึงประวัติสัญญาและการชำระของลูกค้า' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  getCustomerHistory(@Param('customerId') customerId: string) {
    return this.service.getCustomerHistory(customerId);
  }

  @Get(':id/auto-score')
  @ApiOperation({ summary: 'คำนวณคะแนนความเสี่ยงอัตโนมัติ (0-100)' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  getAutoScore(@Param('id') id: string) {
    return this.service.getAutoScore(id);
  }

  @Post(':id/calculate-risk')
  @ApiOperation({ summary: 'คำนวณ Risk Score จากสัดส่วนหนี้ต่อรายได้ (DTI)' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  calculateDtiRiskScore(
    @Param('id') id: string,
    @Body() body: { salaryVerified?: number; monthlyPayment?: number; addressCurrentType?: string },
  ) {
    return this.service.calculateDtiRiskScore(id, body);
  }

  @Post(':id/ai-fields')
  @ApiOperation({ summary: 'อัปเดตข้อมูล AI fields (salary slip, bank statement)' })
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
  updateAiFields(
    @Param('id') id: string,
    @Body() body: {
      salaryVerified?: number;
      employerName?: string;
      salaryPayDay?: number;
      salarySlipFiles?: string[];
      statementBankName?: string;
      statementAvgIncome?: number;
      statementAvgExpense?: number;
      statementAvgBalance?: number;
    },
  ) {
    return this.service.updateWithAiFields(id, body);
  }
}

// === Contract-level credit check ===
@Controller('contracts/:contractId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditCheckController {
  constructor(private service: CreditCheckService, private journeyEntries: JourneyEntryWriter) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByContract(@Param('contractId') contractId: string, @CurrentUser() user: { id: string; role: string }) {
    return this.service.findByContract(contractId, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async create(
    @Param('contractId') contractId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    const startedAt = new Date();
    const creditCheck = await this.service.create(contractId, dto, user.id);
    await recordCreditCheckOpened(this.journeyEntries, creditCheck, user.id, 'CONTRACT', startedAt);
    return creditCheck;
  }

  @Post('analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('contractId') contractId: string, @CurrentUser() user: { id: string }) {
    return this.service.analyze(contractId, user.id);
  }

  @Post('override')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  override(
    @Param('contractId') contractId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.override(contractId, dto, user.id, user.role);
  }
}

// === Customer-level credit check (เช็คก่อนทำสัญญา) ===
@Controller('customers/:customerId/credit-check')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomerCreditCheckController {
  constructor(private service: CreditCheckService, private journeyEntries: JourneyEntryWriter) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByCustomer(@Param('customerId') customerId: string, @CurrentUser() user: { id: string; role: string }) {
    return this.service.findByCustomer(customerId, user);
  }

  @Get('latest')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findLatest(@Param('customerId') customerId: string, @CurrentUser() user: { id: string; role: string }) {
    return this.service.findLatestByCustomer(customerId, user);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCreditCheckDto,
    @CurrentUser() user: { id: string },
  ) {
    const startedAt = new Date();
    const creditCheck = await this.service.createForCustomer(customerId, dto, user.id);
    await recordCreditCheckOpened(this.journeyEntries, creditCheck, user.id, 'CUSTOMER', startedAt);
    return creditCheck;
  }

  @Post(':creditCheckId/analyze')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  analyze(@Param('creditCheckId') creditCheckId: string, @CurrentUser() user: { id: string }) {
    return this.service.analyzeForCustomer(creditCheckId, user.id);
  }

  @Post(':creditCheckId/override')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
  override(
    @Param('creditCheckId') creditCheckId: string,
    @Body() dto: OverrideCreditCheckDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.service.overrideById(creditCheckId, dto, user.id, user.role);
  }
}
