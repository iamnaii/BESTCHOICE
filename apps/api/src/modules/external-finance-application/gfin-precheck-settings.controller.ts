import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FinanceActor, GFIN_SETTINGS_ROLES } from './constants';
import { GfinLineGroupService } from './services/gfin-line-group.service';
import { UpdateGfinPrecheckSettingsDto } from './dto/gfin-precheck-settings.dto';

/** ตั้งค่า › การเงิน › GFIN › กลุ่มไลน์ & ข้อความ (spec §6.5, §11: OWNER/FINANCE_MANAGER) — path แยกจาก finance-applications/:id กันชน route */
@Controller('gfin-precheck-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...GFIN_SETTINGS_ROLES)
export class GfinPrecheckSettingsController {
  constructor(private lineGroup: GfinLineGroupService) {}

  @Get()
  @Roles(...GFIN_SETTINGS_ROLES)
  get() {
    return this.lineGroup.getSettings();
  }

  @Put()
  @Roles(...GFIN_SETTINGS_ROLES)
  update(@Body() dto: UpdateGfinPrecheckSettingsDto) {
    return this.lineGroup.updateSettings(dto);
  }

  @Post('test-message')
  @HttpCode(200)
  @Roles(...GFIN_SETTINGS_ROLES)
  testMessage(@Req() req: { user: FinanceActor }) {
    return this.lineGroup.sendTestMessage(req.user);
  }
}
