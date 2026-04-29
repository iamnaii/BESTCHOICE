import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { ShopSavingPlanService } from './shop-saving-plan.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { wrapFlexMessage, type FlexBubble } from '../line-oa/flex-messages/base-template';

@Injectable()
export class SavingPlanReminderCron {
  private readonly log = new Logger(SavingPlanReminderCron.name);

  constructor(
    private service: ShopSavingPlanService,
    private line: LineOaService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Bangkok' })
  async handle() {
    try {
      const due = await this.service.listDueReminders();
      for (const plan of due) {
        if (!plan.customer.lineIdShop) continue;
        try {
          await this.line.sendFlexMessage(
            plan.customer.lineIdShop,
            this.buildReminderFlex(plan.planNumber, Number(plan.monthlyAmount)),
            'line-shop',
          );
        } catch (e) {
          this.log.warn(`Saving-plan reminder failed for ${plan.id}: ${String(e)}`);
        }
      }
      this.log.log(`Saving-plan reminders sent: ${due.length}`);
    } catch (err) {
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'saving-plan-reminder' } });
    }
  }

  private buildReminderFlex(planNumber: string, monthlyAmount: number) {
    const bubble: FlexBubble = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: 'เตือนชำระออมดาวน์', weight: 'bold', size: 'lg' },
          { type: 'text', text: planNumber, margin: 'md' },
          {
            type: 'text',
            text: `งวดนี้ ฿${monthlyAmount.toLocaleString()}`,
            weight: 'bold',
            margin: 'md',
            color: '#1DB446',
          },
        ],
      },
    };
    return wrapFlexMessage(`เตือนชำระออมดาวน์ ${planNumber}`, bubble);
  }
}
