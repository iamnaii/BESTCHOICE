import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Req, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';
import { CoaGroupedQueryDto, CoaGroupedResponse } from './dto/coa-grouped.dto';
import { UpdatePeakMappingDto } from './dto/peak-mapping.dto';

interface AuthedRequest {
  user: { id: string; role: string };
}

/** Format YYYYMMDD in Asia/Bangkok local date (used for filename). */
function bkkDateStamp(d: Date = new Date()): string {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = bkk.getUTCFullYear();
  const m = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const day = String(bkk.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChartOfAccountsController {
  constructor(private readonly service: ChartOfAccountsService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findAll(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.service.findAll({ type, status, q });
  }

  /** T15: Fetch CoA rows by comma-separated code list — used by CashAccountSelect dropdown. */
  @Get('by-codes')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  findByCodes(@Query('codes') codes?: string): Promise<{ code: string; name: string }[]> {
    if (!codes) return Promise.resolve([]);
    const codeList = codes.split(',').map((c) => c.trim()).filter(Boolean);
    if (codeList.length > 20) throw new BadRequestException('codes ต้องไม่เกิน 20 รายการ');
    return this.service.findByCodes(codeList);
  }

  @Get('grouped')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')
  grouped(@Query() query: CoaGroupedQueryDto): Promise<CoaGroupedResponse> {
    return this.service.findGrouped(query);
  }

  // ============================================================
  // P3-SP3: PEAK code mapping endpoints
  // ============================================================

  @Get('peak-mapping')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  getPeakMapping() {
    return this.service.getPeakMapping();
  }

  @Put('peak-mapping')
  @Roles('OWNER', 'ACCOUNTANT')
  // Bulk write (up to 500 mappings/request) writes one audit-log row per change.
  // Cap per-user to 10 saves/min so a hot-loop client can't flood AuditLog.
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  updatePeakMapping(@Body() dto: UpdatePeakMappingDto, @Req() req: AuthedRequest) {
    if (!req.user?.id) throw new BadRequestException('กรุณาเข้าสู่ระบบ');
    return this.service.updatePeakMapping(dto, req.user.id);
  }

  @Get('peak-mapping/csv')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async exportPeakMappingCsv(@Res() res: Response): Promise<void> {
    const csv = await this.service.exportPeakMappingCsv();
    const filename = `peak-mapping-${bkkDateStamp()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Expose Content-Disposition so the browser fetch() can read it through CORS
    // (client uses it as the single source of truth for the filename — avoids UTC/BKK drift).
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(csv);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(@Body() dto: CreateChartOfAccountDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(@Param('id') id: string, @Body() dto: UpdateChartOfAccountDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'FINANCE_MANAGER')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
