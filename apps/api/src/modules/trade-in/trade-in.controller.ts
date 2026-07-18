import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Param,
  Body,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TradeInService } from './trade-in.service';
import {
  CreateTradeInDto,
  AppraiseTradeInDto,
  AcceptTradeInDto,
  UpdateTradeInDto,
  QuickBuyTradeInDto,
  ValuationQueryDto,
  UpsertValuationDto,
} from './dto/trade-in.dto';
import {
  CreateBuybackChoiceDto,
  CreateBuybackQuestionDto,
  UpdateBuybackChoiceDto,
  UpdateBuybackQuestionDto,
  UpdateSellConfigDto,
} from './dto/buyback-question.dto';
import { AppraiseOnlineDto } from './dto/appraise-online.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExportEnabledGuard } from '../settings/guards/export-enabled.guard';
import { PiiAuditService } from '../pii/pii-audit.service';
import { BuybackQuestionAdminService } from './services/buyback-question-admin.service';
import { OnlineAppraisalService } from './services/online-appraisal.service';
import { maskBankAccount } from '../../utils/pii.util';

type AuthRequest = Request & { user?: { id: string; role: string } };

@ApiTags('Trade-In')
@ApiBearerAuth('JWT')
@Controller('trade-ins')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class TradeInController {
  constructor(
    private tradeInService: TradeInService,
    private piiAudit: PiiAuditService,
    private buybackAdmin: BuybackQuestionAdminService,
    private onlineAppraisal: OnlineAppraisalService,
  ) {}

  // ---------------------------------------------------------------------------
  // Role-based PII masking helpers (Phase 5)
  // BRANCH_MANAGER + SALES see transferAccountNumber masked; others see full
  // ---------------------------------------------------------------------------

  private applyRoleMask<T extends { transferAccountNumber?: string | null }>(
    t: T | null,
    userRole: string,
  ): T | null {
    if (!t) return t;
    if (userRole === 'BRANCH_MANAGER' || userRole === 'SALES') {
      return {
        ...t,
        transferAccountNumber: t.transferAccountNumber
          ? maskBankAccount(t.transferAccountNumber)
          : t.transferAccountNumber,
      };
    }
    return t;
  }

  private applyRoleMaskList<T extends { transferAccountNumber?: string | null }>(
    list: T[],
    userRole: string,
  ): T[] {
    return list.map((t) => this.applyRoleMask(t, userRole) as T);
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateTradeInDto) {
    return this.tradeInService.create(dto);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async findAll(
    @Query() pagination: PaginationDto,
    @Query('customerId') customerId?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('submissionSource') submissionSource?: string,
    @Query('flow') flow?: string,
    @Req() req?: AuthRequest,
  ) {
    const result = await this.tradeInService.findAll({
      customerId,
      branchId,
      status,
      search,
      submissionSource,
      flow,
      page: pagination.page,
      limit: pagination.limit,
    });

    const role = req?.user?.role || 'UNKNOWN';

    void this.piiAudit.logDecryption({
      userId: req?.user?.id || 'system',
      customerId: `BATCH:${result.data?.length ?? 0}`,
      fields: ['transferAccountNumber'],
      role,
      masked: role === 'BRANCH_MANAGER' || role === 'SALES',
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent'] as string | undefined,
    });

    return {
      ...result,
      data: this.applyRoleMaskList(
        result.data as Array<{ transferAccountNumber?: string | null }>,
        role,
      ),
    };
  }

  // Quick Buy — 1-shot create + appraise + accept + voucher allocate
  @Post('quick-buy')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  quickBuy(
    @Body() dto: QuickBuyTradeInDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('branchId') userBranchId: string | null,
  ) {
    return this.tradeInService.quickBuy(dto, userId, userBranchId);
  }

  // Seller history (auto-fill + repeat warning)
  @Get('seller-history/:idCard')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  sellerHistory(@Param('idCard') idCard: string) {
    return this.tradeInService.sellerHistory(idCard);
  }

  @Get('check-imei/:imei')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  checkImei(@Param('imei') imei: string) {
    return this.tradeInService.checkImei(imei);
  }

  // Public verify endpoint (for QR scan) — bypass auth via SkipAuth-style: keep guarded ใน scope ปัจจุบัน
  // (สามารถแยกเป็น public controller ภายหลัง)
  @Get('verify/:voucherNumber')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT', 'FINANCE_MANAGER')
  verifyVoucher(@Param('voucherNumber') voucherNumber: string) {
    return this.tradeInService.verifyByVoucherNumber(voucherNumber);
  }

  // ─── Valuation table ────────────────────────────────

  /** GET /trade-ins/valuation?brand=&model=&storage=&condition= — ราคาอ้างอิง */
  @Get('valuation')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  lookupValuation(@Query() query: ValuationQueryDto) {
    return this.tradeInService.lookupValuation(
      query.brand,
      query.model,
      query.storage,
      query.condition,
    );
  }

  /** GET /trade-ins/valuations — รายการตารางราคาทั้งหมด */
  @Get('valuations')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  listValuations(
    @Query('brand') brand?: string,
    @Query('model') model?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tradeInService.listValuations({
      brand,
      model,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  /** GET /trade-ins/valuation-brands — ยี่ห้อทั้งหมดในตาราง */
  @Get('valuation-brands')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getValuationBrands() {
    return this.tradeInService.getValuationBrands();
  }

  /** GET /trade-ins/valuation-models?brand= — รุ่นทั้งหมดของยี่ห้อ */
  @Get('valuation-models')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getValuationModels(@Query('brand') brand: string) {
    return this.tradeInService.getValuationModels(brand);
  }

  /** POST /trade-ins/valuations — เพิ่ม/อัปเดตราคาอ้างอิง (admin) */
  @Post('valuations')
  @Roles('OWNER', 'BRANCH_MANAGER')
  upsertValuation(@Body() dto: UpsertValuationDto) {
    return this.tradeInService.upsertValuation(dto);
  }

  /** DELETE /trade-ins/valuations/:id — ลบราคารุ่น (soft delete, admin) — spec §8.1 */
  @Delete('valuations/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteValuation(@Param('id') id: string) {
    return this.tradeInService.deleteValuation(id);
  }

  // ─── Buyback questionnaire (แอดมินแบบประเมินรับซื้อออนไลน์) ───────────
  // ⚠️ ต้องอยู่เหนือ @Get(':id') เสมอ (route-shadowing)

  @Get('buyback-questions')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  listBuybackQuestions() {
    return this.buybackAdmin.list();
  }

  @Post('buyback-questions')
  @Roles('OWNER', 'BRANCH_MANAGER')
  createBuybackQuestion(@Body() dto: CreateBuybackQuestionDto) {
    return this.buybackAdmin.createQuestion(dto);
  }

  @Patch('buyback-questions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateBuybackQuestion(@Param('id') id: string, @Body() dto: UpdateBuybackQuestionDto) {
    return this.buybackAdmin.updateQuestion(id, dto);
  }

  @Delete('buyback-questions/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteBuybackQuestion(@Param('id') id: string) {
    return this.buybackAdmin.deleteQuestion(id);
  }

  @Post('buyback-questions/:id/choices')
  @Roles('OWNER', 'BRANCH_MANAGER')
  createBuybackChoice(@Param('id') id: string, @Body() dto: CreateBuybackChoiceDto) {
    return this.buybackAdmin.createChoice(id, dto);
  }

  @Patch('buyback-choices/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateBuybackChoice(@Param('id') id: string, @Body() dto: UpdateBuybackChoiceDto) {
    return this.buybackAdmin.updateChoice(id, dto);
  }

  @Delete('buyback-choices/:id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  deleteBuybackChoice(@Param('id') id: string) {
    return this.buybackAdmin.deleteChoice(id);
  }

  @Get('sell-config')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  getSellConfig() {
    return this.buybackAdmin.getSellConfig();
  }

  @Put('sell-config')
  @Roles('OWNER', 'BRANCH_MANAGER')
  updateSellConfig(@Body() dto: UpdateSellConfigDto) {
    return this.buybackAdmin.updateSellConfig(dto);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  async findOne(@Param('id') id: string, @Req() req: AuthRequest) {
    const t = await this.tradeInService.findOne(id);
    if (!t) return t;

    const role = req.user?.role || 'UNKNOWN';

    // Fire-and-forget: never let audit log block the response
    void this.piiAudit.logDecryption({
      userId: req.user?.id || 'system',
      customerId: id,
      fields: ['transferAccountNumber'],
      role,
      masked: role === 'BRANCH_MANAGER' || role === 'SALES',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    return this.applyRoleMask(t as unknown as { transferAccountNumber?: string | null }, role);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateTradeInDto) {
    return this.tradeInService.update(id, dto);
  }

  @Patch(':id/appraise')
  @Roles('OWNER', 'BRANCH_MANAGER')
  appraise(
    @Param('id') id: string,
    @Body() dto: AppraiseTradeInDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.tradeInService.appraise(id, dto, userId, userRole);
  }

  /** §7.4 handshake — ยืนยันราคา record ที่มาจาก instant quote (มี quoteBreakdown) */
  @Patch(':id/appraise-online')
  @Roles('OWNER', 'BRANCH_MANAGER')
  appraiseOnline(
    @Param('id') id: string,
    @Body() dto: AppraiseOnlineDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: string,
  ) {
    return this.onlineAppraisal.appraiseOnline(id, dto, userId, userRole);
  }

  @Post(':id/accept')
  @Roles('OWNER', 'BRANCH_MANAGER')
  accept(
    @Param('id') id: string,
    @Body() dto: AcceptTradeInDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.tradeInService.accept(id, dto, userId);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'BRANCH_MANAGER')
  reject(@Param('id') id: string) {
    return this.tradeInService.reject(id);
  }

  @Post(':id/complete')
  @Roles('OWNER', 'BRANCH_MANAGER')
  complete(@Param('id') id: string) {
    return this.tradeInService.complete(id);
  }

  // ─── ID card photo ──────────────────────────────────
  @Post(':id/id-card-photo')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  uploadIdCardPhoto(
    @Param('id') id: string,
    @Body() body: { photoBase64: string; source: 'card_reader' | 'upload' },
  ) {
    return this.tradeInService.uploadIdCardPhoto(id, body.photoBase64, body.source);
  }

  // ─── Voucher ────────────────────────────────────────
  @Post(':id/voucher')
  @Roles('OWNER', 'BRANCH_MANAGER')
  generateVoucher(@Param('id') id: string) {
    return this.tradeInService.generateVoucher(id);
  }

  @Get(':id/voucher.pdf')
  // D1.3.3.1 — gated by ExportEnabledGuard (403 when export_enabled=false).
  @UseGuards(ExportEnabledGuard)
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
  async downloadVoucher(@Param('id') id: string, @Res() res: Response) {
    const { buffer, voucherNumber } = await this.tradeInService.getVoucherPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="voucher-${voucherNumber}.pdf"`);
    res.send(buffer);
  }
}
