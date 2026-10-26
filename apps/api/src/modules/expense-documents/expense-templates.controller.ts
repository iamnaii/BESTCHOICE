import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseTemplatesService } from './expense-templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { RULE_CHANGED_REASON, RecurringBillsService, type RecurringBillActor } from './recurring-bills/recurring-bills.service';

@Controller('expense-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseTemplatesController {
  private readonly logger = new Logger(ExpenseTemplatesController.name);

  constructor(
    private readonly service: ExpenseTemplatesService,
    private readonly bills: RecurringBillsService,
  ) {}

  /**
   * บิลประจำ (spec §8 + §15.5): บันทึกแม่แบบแล้วสร้างงวดที่ถึงหน้าต่างเตือนทันที (ไม่รอรอบ 08:05)
   * ด้วย**ผู้กด**เป็นผู้สร้างร่าง/งาน · กติกาเปลี่ยน → ปิดงวดค้างของกติกาเดิมก่อน · ล้ม = Sentry ไม่ทำให้การบันทึกล้ม
   */
  private async runRecurringStepA(templateId: string, user: { id: string; branchId?: string | null; role: string }, ruleChanged: boolean) {
    const actor: RecurringBillActor = { id: user.id, branchId: user.branchId ?? null, role: user.role };
    try {
      if (ruleChanged) await this.bills.retireOpenOccurrences(templateId, RULE_CHANGED_REASON, actor);
      await this.bills.generateForTemplate(templateId, new Date(), actor);
    } catch (err) {
      Sentry.captureException(err, { tags: { module: 'recurring-bills', stage: 'template-save' }, extra: { templateId } });
      this.logger.warn(`[recurring-bills] step A after template save failed for ${templateId}: ${(err as Error).message}`);
    }
  }

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async create(@Body() dto: CreateTemplateDto, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    const tpl = await this.service.create(dto, user);
    if (tpl.isRecurring) await this.runRecurringStepA(tpl.id, user, false);
    return tpl;
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query('branchId') branchId: string | undefined,
    @Query('type') type: string | undefined,
    @CurrentUser() user: { id: string; branchId?: string; role: string },
  ) {
    return this.service.list({ branchId, type }, user);
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    const tpl = await this.service.update(id, dto, user);
    if (tpl.isRecurring) await this.runRecurringStepA(tpl.id, user, tpl.ruleChanged);
    return tpl;
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  delete(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.softDelete(id, user);
  }

  @Post(':id/instantiate')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  instantiate(@Param('id') id: string, @CurrentUser() user: { id: string; branchId?: string; role: string }) {
    return this.service.instantiate(id, user);
  }
}
