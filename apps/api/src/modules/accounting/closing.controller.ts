import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccountingClosingService } from './closing.service';
import {
  YearEndClosingPostDto,
  YearEndClosingPreviewDto,
  YearEndClosingReverseDto,
} from './dto/year-end-closing.dto';

/**
 * P3-SP1 — Year-End Closing endpoints.
 *
 * Mounted at `/accounting/year-end-closing*` — separate prefix from the legacy
 * `/expenses` group in AccountingController (year-end is conceptually a
 * "ปิดบัญชี" workflow, not a report).
 */
@ApiTags('Accounting — Year-End Closing')
@ApiBearerAuth('JWT')
@Controller('accounting/year-end-closing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountingClosingController {
  constructor(private readonly service: AccountingClosingService) {}

  @Post('preview')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  preview(@Body() dto: YearEndClosingPreviewDto) {
    return this.service.previewYearEndClosing(dto.year);
  }

  @Post()
  @Roles('OWNER', 'ACCOUNTANT')
  post(
    @Body() dto: YearEndClosingPostDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.service.postYearEndClosing(dto.year, req.user.id);
  }

  @Post('reverse')
  @Roles('OWNER')
  reverse(
    @Body() dto: YearEndClosingReverseDto,
    @Request() req: { user: { id: string; role?: string } },
  ) {
    return this.service.reverseYearEndClosing(dto.year, req.user.id, dto.reason, req.user.role);
  }
}
