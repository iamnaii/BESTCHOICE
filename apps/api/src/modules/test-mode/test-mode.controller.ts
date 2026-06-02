import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TestModeService } from './test-mode.service';

class SetTestModeDto {
  @IsBoolean({ message: 'กรุณาระบุสถานะโหมดทดสอบ (true/false)' })
  enabled!: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings/test-mode')
export class TestModeController {
  constructor(private readonly testMode: TestModeService) {}

  @Get()
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'SALES')
  async get() {
    return { enabled: await this.testMode.isEnabled() };
  }

  @Put()
  @Roles('OWNER')
  async set(@Body() dto: SetTestModeDto) {
    return { enabled: await this.testMode.setEnabled(dto.enabled) };
  }
}
