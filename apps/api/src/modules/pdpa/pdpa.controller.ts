import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PDPAService } from './pdpa.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsString, IsOptional } from 'class-validator';

class RecordConsentDto {
  @IsString()
  customerId: string;

  @IsString()
  @IsOptional()
  signatureImage?: string;
}

class SubmitDSARDto {
  @IsString()
  customerId: string;

  @IsString()
  requestType: string;

  @IsString()
  description: string;
}

class ProcessDSARDto {
  @IsString()
  status: string;

  @IsString()
  responseNotes: string;
}

@Controller('pdpa')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PDPAController {
  constructor(private pdpaService: PDPAService) {}

  @Get('privacy-notice')
  getPrivacyNotice() {
    return this.pdpaService.getPrivacyNotice();
  }

  @Post('consent')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  recordConsent(@Body() dto: RecordConsentDto, @Req() req: any) {
    return this.pdpaService.recordConsent(dto.customerId, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    }, dto.signatureImage);
  }

  @Post('consent/:id/revoke')
  @Roles('OWNER')
  revokeConsent(@Param('id') id: string, @Body('reason') reason: string) {
    return this.pdpaService.revokeConsent(id, reason);
  }

  @Get('consent/customer/:customerId')
  getCustomerConsents(@Param('customerId') customerId: string) {
    return this.pdpaService.getCustomerConsents(customerId);
  }

  // ─── DSAR ────────────────────────────────────────────
  @Post('dsar')
  @Roles('OWNER', 'BRANCH_MANAGER')
  submitDSAR(@Body() dto: SubmitDSARDto) {
    return this.pdpaService.submitDSAR(dto.customerId, dto.requestType, dto.description);
  }

  @Get('dsar')
  @Roles('OWNER', 'BRANCH_MANAGER')
  getDSARRequests(
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pdpaService.getDSARRequests({
      status,
      customerId,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Patch('dsar/:id')
  @Roles('OWNER')
  processDSAR(
    @Param('id') id: string,
    @Body() dto: ProcessDSARDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.pdpaService.processDSAR(id, user.id, dto.status, dto.responseNotes);
  }
}
