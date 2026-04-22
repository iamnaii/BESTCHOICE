import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { PaySolutionsModule } from '../paysolutions/paysolutions.module';
import { ShopSavingPlanController } from './shop-saving-plan.controller';
import { ShopSavingPlanAdminController } from './shop-saving-plan.admin.controller';
import { ShopSavingPlanService } from './shop-saving-plan.service';
import { SavingPlanReminderCron } from './saving-plan-reminder.cron';

@Module({
  imports: [PrismaModule, AuthModule, LineOaModule, PaySolutionsModule],
  controllers: [ShopSavingPlanController, ShopSavingPlanAdminController],
  providers: [ShopSavingPlanService, SavingPlanReminderCron],
  exports: [ShopSavingPlanService],
})
export class ShopSavingPlanModule {}
