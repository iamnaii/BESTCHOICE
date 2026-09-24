import { Injectable, Logger } from '@nestjs/common';

/** แจ้งพนักงานเมื่อ GFIN ตอบผ่านลิงก์ — เนื้อหาจริง (Todo + IN_APP) เติมใน Task 7; ตอนนี้แค่บันทึก log */
@Injectable()
export class FinanceApplicationNotifyService {
  private readonly logger = new Logger(FinanceApplicationNotifyService.name);
  async partnerReplied(applicationId: string): Promise<void> {
    this.logger.log(`partner replied on application ${applicationId} (notify not wired yet)`);
  }
}
