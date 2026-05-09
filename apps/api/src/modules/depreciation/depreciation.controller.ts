import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DepreciationService } from './depreciation.service';
import { RunDepreciationDto } from './dto/run-depreciation.dto';
import { ReverseDepreciationRunDto } from './dto/reverse-depreciation-run.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Depreciation')
@ApiBearerAuth('JWT')
@Controller('depreciation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepreciationController {
  constructor(private readonly service: DepreciationService) {}

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list() {
    return this.service.listRuns();
  }

  @Get('preview/:period')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  preview(@Param('period') period: string) {
    return this.service.previewRun(period);
  }

  @Post('run')
  @Roles('OWNER', 'FINANCE_MANAGER')
  run(@Body() dto: RunDepreciationDto, @CurrentUser('id') userId: string) {
    return this.service.runManual(dto.period, userId);
  }

  @Post(':period/reverse')
  @Roles('OWNER')
  reverse(
    @Param('period') period: string,
    @Body() dto: ReverseDepreciationRunDto,
    @CurrentUser('id') userId: string,
  ) {
    // dto.period must match URL :period — keep URL canonical
    return this.service.reverseRun(period, dto.reason, userId);
  }
}
