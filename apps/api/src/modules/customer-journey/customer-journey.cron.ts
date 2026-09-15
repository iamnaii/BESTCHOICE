import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { addBkkDays, bangkokDateString, bangkokStartOfDay } from '../../utils/date.util';
import { JourneyStateService } from './journey-state.service';

const ACTIVE_WINDOW_MS = 48 * 60 * 60 * 1000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class CustomerJourneyCron {
  private readonly logger = new Logger(CustomerJourneyCron.name);

  constructor(private readonly journeyState: JourneyStateService) {}

  /** 03:30 น. — คนที่ขยับใน 48 ชม. (วันอาทิตย์ = ทุกคน) แล้วเทียบจำนวน PURCHASED กับ BOUGHT_WHERE */
  @Cron('30 3 * * *', { name: 'journey:recompute', timeZone: 'Asia/Bangkok' })
  async recomputeDaily(
    now: Date = new Date(),
  ): Promise<{ mode: 'sweep' | 'active'; recomputed: number; purchasedStates: number; bought: number }> {
    try {
      const mode: 'sweep' | 'active' = new Date(now.getTime() + BANGKOK_OFFSET_MS).getUTCDay() === 0 ? 'sweep' : 'active';
      let recomputed: number;
      if (mode === 'sweep') {
        recomputed = await this.journeyState.recomputeAll();
      } else {
        const ids = await this.journeyState.activeCustomerIdsSince(new Date(now.getTime() - ACTIVE_WINDOW_MS));
        await this.journeyState.recompute(ids);
        recomputed = ids.length;
      }
      const parity = await this.journeyState.purchasedParity();
      const result = { mode, recomputed, ...parity };
      this.logger.log(`journey:recompute mode=${mode} recomputed=${recomputed} purchased=${parity.purchasedStates} bought=${parity.bought}`);
      if (parity.purchasedStates !== parity.bought) {
        Sentry.captureMessage('journey:recompute แคช PURCHASED ไม่เท่ากับ BOUGHT_WHERE', {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'journey:recompute' },
          extra: result,
        });
      }
      return result;
    } catch (err) {
      this.logger.error(`journey:recompute failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'journey:recompute' } });
      throw err;
    }
  }

  /**
   * 04:00 น. — สัญญาที่เปิดจริงเมื่อวาน (เวลาไทย) ต้องมี entry CONTRACT_ACTIVATED ครบ ถ้าขาด = hook หลุด
   * "เปิดจริง" = JE เปิดสัญญา (tag 1A / flow exchange-new-contract-1a) ที่ postedAt อยู่ในวันนั้น — ไม่ดูใบขาย
   * (ใบขายผ่อนจาก POS เกิดตอนสร้างสัญญา DRAFT ซึ่งอาจเปิดวันหลังหรือไม่เปิดเลย · สัญญาเปลี่ยนเครื่องไม่มีใบขาย)
   * คืนแรกหลัง deploy อาจเตือนสัญญาที่เปิดก่อน deploy ในวันนั้น · CLI test-pack ที่เรียก ContractWorkflowService.activate ตรง
   * (ไม่ผ่าน controller ที่เขียน entry) ก็ถูกนับว่าขาด — ตรวจ contractIds ใน extra ก่อนสรุปว่าพัง
   */
  @Cron('0 4 * * *', { name: 'journey:entry-guard', timeZone: 'Asia/Bangkok' })
  async entryGuard(now: Date = new Date()): Promise<{ missing: number }> {
    try {
      const lt = bangkokStartOfDay(now);
      const gte = addBkkDays(lt, -1);
      const missing = await this.journeyState.contractsMissingActivationEntry({ gte, lt });
      if (missing.length > 0) {
        this.logger.warn(`journey:entry-guard missing CONTRACT_ACTIVATED=${missing.length}`);
        Sentry.captureMessage('journey:entry-guard hook CONTRACT_ACTIVATED หลุด', {
          level: 'error',
          tags: { kind: 'cron-job', cron: 'journey:entry-guard' },
          extra: { day: bangkokDateString(gte), missing: missing.length, contractIds: missing.slice(0, 50) },
        });
      }
      return { missing: missing.length };
    } catch (err) {
      this.logger.error(`journey:entry-guard failed: ${err instanceof Error ? err.message : err}`);
      Sentry.captureException(err, { tags: { kind: 'cron-job', cron: 'journey:entry-guard' } });
      throw err;
    }
  }
}
