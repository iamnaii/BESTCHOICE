import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';
import { isCronEnabled } from './cron-enabled';

type CronCallback = (...args: unknown[]) => unknown;

const DEFAULT_SHUTDOWN_GRACE_MS = 8_000;

/**
 * ดูแลวงจรชีวิตของ cron ให้ปิด instance ได้อย่างปลอดภัย
 *
 * ปัญหาเดิม (log 26 ต.ค. 2026 20:15): ตอน Cloud Run ส่ง SIGTERM, Nest เรียก
 * onModuleDestroy ก่อน beforeApplicationShutdown → PrismaService ตัด DB ไปแล้ว
 * แต่ timer ของ cron ยังยิงต่อ → "Can't reach database server" หลายสิบบรรทัด
 *
 * ลำดับใหม่:
 *   1) beforeApplicationShutdown (ที่นี่): หยุด cron ทุกตัว + ไม่รับ tick ใหม่
 *      + รองานที่กำลังรันให้จบ (ไม่เกิน CRON_SHUTDOWN_GRACE_MS, ค่าเริ่มต้น 8 วิ
 *      — Cloud Run ให้เวลา 10 วิหลัง SIGTERM)
 *   2) onApplicationShutdown: PrismaService / PrismaFinanceService ค่อย $disconnect
 */
@Injectable()
export class CronLifecycleService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('CronLifecycle');
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly instrumented = new WeakSet<object>();
  private shuttingDown = false;

  constructor(private readonly registry: SchedulerRegistry) {}

  onApplicationBootstrap(): void {
    const enabled = isCronEnabled();
    const count = this.instrumentJobs();
    this.logger.log(
      enabled
        ? `Cron scheduling ENABLED on this instance (CRON_ENABLED=${process.env.CRON_ENABLED ?? '<unset>'}) — ${count} job(s) tracked`
        : 'Cron scheduling DISABLED on this instance (CRON_ENABLED=false) — no @Cron/@Interval/@Timeout will run',
    );
  }

  /**
   * ห่อ callback ของ cron ทุกตัวเพื่อนับงานที่กำลังรัน (เรียกซ้ำได้ ไม่ห่อซ้ำ)
   * เรียกจาก onApplicationBootstrap และจาก main.ts หลัง app.listen อีกรอบ
   * เพราะลำดับ bootstrap hook ระหว่างโมดูล global ไม่การันตี
   * คืนจำนวน job ที่ติดตามอยู่ทั้งหมด
   */
  instrumentJobs(): number {
    let tracked = 0;
    for (const [name, job] of this.registry.getCronJobs()) {
      if (this.instrumented.has(job)) {
        tracked++;
        continue;
      }
      // cron@4 เก็บ callback ไว้ใน _callbacks (private) — ถ้าเวอร์ชันอนาคตเปลี่ยน
      // ยังหยุด job ได้ตามปกติ แค่รองานค้างไม่ได้ (log เตือนไว้)
      const callbacks = (job as unknown as { _callbacks?: unknown })._callbacks;
      if (!Array.isArray(callbacks)) {
        this.logger.warn(`cron "${name}": cannot track in-flight runs (cron internals changed)`);
        continue;
      }
      for (let i = 0; i < callbacks.length; i++) {
        callbacks[i] = this.wrap(callbacks[i] as CronCallback);
      }
      this.instrumented.add(job);
      tracked++;
    }
    return tracked;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    const jobs = this.registry.getCronJobs();
    for (const job of jobs.values()) {
      void (job as CronJob).stop();
    }
    for (const name of this.registry.getIntervals()) {
      clearInterval(this.registry.getInterval(name));
    }
    for (const name of this.registry.getTimeouts()) {
      clearTimeout(this.registry.getTimeout(name));
    }

    if (this.inFlight.size === 0) {
      if (jobs.size > 0) this.logger.log(`Stopped ${jobs.size} cron job(s) (signal=${signal ?? 'none'})`);
      return;
    }

    const graceMs = this.graceMs();
    const pending = this.inFlight.size;
    this.logger.log(
      `Stopped ${jobs.size} cron job(s) (signal=${signal ?? 'none'}); waiting up to ${graceMs}ms for ${pending} in-flight run(s)`,
    );
    const finished = await Promise.race([
      Promise.allSettled([...this.inFlight]).then(() => true),
      new Promise<false>((resolve) => {
        const t = setTimeout(() => resolve(false), graceMs);
        t.unref?.();
      }),
    ]);
    if (!finished) {
      this.logger.warn(
        `${this.inFlight.size} cron run(s) still in flight after ${graceMs}ms — shutting down anyway`,
      );
    }
  }

  private wrap(callback: CronCallback): CronCallback {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return function trackedCronTick(this: unknown, ...args: unknown[]) {
      if (self.shuttingDown) return undefined; // tick หลังเริ่มปิดเครื่อง → ข้ามเงียบ ๆ
      const result = callback.apply(this, args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        const p = Promise.resolve(result as Promise<unknown>);
        self.inFlight.add(p);
        const done = () => self.inFlight.delete(p);
        p.then(done, done);
      }
      return result;
    };
  }

  private graceMs(): number {
    const raw = Number(process.env.CRON_SHUTDOWN_GRACE_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SHUTDOWN_GRACE_MS;
  }
}
