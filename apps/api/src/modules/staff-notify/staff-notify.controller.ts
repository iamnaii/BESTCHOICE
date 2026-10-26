import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { getIntegrationDef } from '../integrations/integration-registry';
import { STAFF_EVENT_CATALOG, isStaffEventKey } from './staff-event-catalog';
import { StaffLineConfigService } from './staff-line-config.service';
import { StaffLineLinkService } from './staff-line-link.service';
import { StaffNotifyRulesService } from './staff-notify-rules.service';
import { StaffNotifyService } from './staff-notify.service';
import { SaveStaffNotifyCapDto, SaveStaffNotifyRulesDto, TestStaffEventDto } from './dto/staff-notify.dto';

interface ActingUser {
  id: string;
  name?: string;
  role?: string;
}

/** ตั้งค่า "แจ้งพนักงาน (LINE)" — OWNER เท่านั้น (สเปก §8 + §13) */
@Controller('staff-notify')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class StaffNotifyController {
  constructor(
    private readonly service: StaffNotifyService,
    private readonly rules: StaffNotifyRulesService,
    private readonly lineConfig: StaffLineConfigService,
    private readonly link: StaffLineLinkService,
  ) {}

  @Get('rules')
  async getRules() {
    const [configured, groupTargets, rules, usage, monthlyCap] = await Promise.all([
      this.lineConfig.isConfigured(),
      this.lineConfig.groupTargets(),
      this.rules.getEffectiveRules(),
      this.service.usage(),
      this.rules.getMonthlyCap(),
    ]);
    const unlinkedUsers = await this.service.listUnlinkedUsers(rules);
    return {
      configured,
      groupTargets: groupTargets.length,
      webhookUrl: getIntegrationDef('line-staff')?.webhookUrl ?? null,
      usage,
      monthlyCap,
      catalog: STAFF_EVENT_CATALOG.map((c) => ({ key: c.key, group: c.group, label: c.label, description: c.description, defaults: c.defaults })),
      rules,
      unlinkedUsers,
    };
  }

  @Put('rules')
  async saveRules(@Body() body: SaveStaffNotifyRulesDto, @CurrentUser() user: ActingUser) {
    return { rules: await this.rules.saveRules(body.rules, user.id) };
  }

  @Put('monthly-cap')
  async saveMonthlyCap(@Body() body: SaveStaffNotifyCapDto, @CurrentUser() user: ActingUser) {
    return { cap: await this.rules.saveMonthlyCap(body.cap, user.id) };
  }

  /** ส่งข้อความตัวอย่างของเหตุการณ์ถึงผู้เรียก */
  @Post('test')
  async test(@Body() body: TestStaffEventDto, @CurrentUser() user: ActingUser) {
    if (!isStaffEventKey(body.eventKey)) throw new BadRequestException(`ไม่รู้จักเหตุการณ์ "${body.eventKey}"`);
    return this.service.sendSample(body.eventKey, user.id);
  }

  @Post('users/:id/test')
  async testUser(@Param('id') id: string, @CurrentUser() user: ActingUser) {
    return this.service.testToUser(id, user.name ?? 'เจ้าของ');
  }

  @Post('users/:id/link-code')
  async issueLinkCode(@Param('id') id: string, @CurrentUser() user: ActingUser) {
    return this.link.issueCode(id, user.id);
  }

  @Delete('users/:id/link')
  async unlink(@Param('id') id: string, @CurrentUser() user: ActingUser) {
    return this.link.unlink(id, user.id);
  }
}
