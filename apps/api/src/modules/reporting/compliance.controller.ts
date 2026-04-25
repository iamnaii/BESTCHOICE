import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ComplianceService } from './compliance.service';
import { ComplianceAuditQueryDto } from './dto/compliance-query.dto';

/**
 * Compliance dashboard endpoints (P3 D2).
 * OWNER + FINANCE_MANAGER only — read-only, scoped to whole org.
 */
@ApiTags('Reporting')
@ApiBearerAuth('JWT')
@Controller('reporting/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('dunning-frequency')
  getDunningFrequency(@Query('threshold') thresholdRaw?: string) {
    const threshold = thresholdRaw ? Number(thresholdRaw) : undefined;
    if (thresholdRaw && (!Number.isFinite(threshold) || (threshold ?? 0) <= 0)) {
      throw new BadRequestException('threshold ต้องเป็นจำนวนเต็มบวก');
    }
    return this.compliance.getDunningFrequency(threshold);
  }

  @Get('legal-pipeline')
  getLegalPipeline() {
    return this.compliance.getLegalPipeline();
  }

  @Get('audit-summary')
  getAuditSummary(@Query() dto: ComplianceAuditQueryDto) {
    return this.compliance.getAuditSummary(dto.period ?? 'week');
  }

  @Get('voice-memo-retention')
  getVoiceMemoRetention() {
    return this.compliance.getVoiceMemoRetention();
  }
}
