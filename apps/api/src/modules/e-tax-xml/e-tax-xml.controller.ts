import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ETaxXmlService } from './e-tax-xml.service';
import { ListEtaxQueryDto } from './dto/list-etax.dto';

type AuthRequest = Request & {
  user?: { id: string; role: string; branchId?: string | null };
};

/**
 * P2-SP5 — e-Tax XML controller.
 *
 * Endpoints:
 *   POST  /e-tax-xml/generate/:paymentId  — OWNER, FINANCE_MANAGER
 *   POST  /e-tax-xml/:id/sign             — OWNER (gated by ETAX_SUBMIT_MODE)
 *   POST  /e-tax-xml/:id/submit           — OWNER
 *   POST  /e-tax-xml/:id/retry            — OWNER
 *   GET   /e-tax-xml/:id                  — OWNER, FINANCE_MANAGER, ACCOUNTANT
 *   GET   /e-tax-xml                      — OWNER, FINANCE_MANAGER, ACCOUNTANT
 *   POST  /e-tax-xml/check-config         — OWNER
 *   POST  /e-tax-xml/:id/poll             — OWNER (manual status pull)
 */
@ApiTags('e-Tax XML (สรรพากร)')
@ApiBearerAuth('JWT')
@Controller('e-tax-xml')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ETaxXmlController {
  constructor(private readonly service: ETaxXmlService) {}

  // List ordering must come BEFORE :id catch-alls to avoid Nest matching
  // `check-config` as :id. Place static routes before parameterized routes.

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(@Query() query: ListEtaxQueryDto) {
    return this.service.findAll({
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Post('check-config')
  @Roles('OWNER')
  checkConfig() {
    return this.service.checkConfig();
  }

  /**
   * C3 — Public-ish read of submit mode so the e-Tax invoice list page can
   * enable/disable the "ส่งให้สรรพากร" button without exposing cert path or
   * passwords. Available to OWNER, FINANCE_MANAGER, ACCOUNTANT.
   *
   * Returns only `{ mode: 'disabled' | 'sandbox' | 'prod' }`. No secrets.
   */
  @Get('submit-mode')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async getSubmitMode(): Promise<{ mode: 'disabled' | 'sandbox' | 'prod' }> {
    return this.service.getSubmitModeStatus();
  }

  @Post('generate/:paymentId')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async generate(
    @Param('paymentId') paymentId: string,
    @Req() req: AuthRequest,
  ) {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.generateForPayment(paymentId, req.user.id);
  }

  @Get(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/sign')
  @Roles('OWNER')
  async sign(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.signSubmission(id, req.user.id);
  }

  @Post(':id/submit')
  @Roles('OWNER')
  async submit(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.submitToRd(id, req.user.id);
  }

  @Post(':id/poll')
  @Roles('OWNER', 'FINANCE_MANAGER')
  async poll(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.pollStatus(id, req.user.id);
  }

  @Post(':id/retry')
  @Roles('OWNER')
  async retry(@Param('id') id: string, @Req() req: AuthRequest) {
    if (!req.user) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.retrySubmission(id, req.user.id);
  }
}
