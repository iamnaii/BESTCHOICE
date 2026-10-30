import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

/** env ที่ต้องตั้งเป็นค่านี้ตรง ๆ ถึงจะเปิดโหมดทดสอบบน NODE_ENV=production ได้ (Task 20 I2) */
export const ALLOW_TEST_MODE_BYPASS_ENV = 'ALLOW_TEST_MODE_BYPASS';
export const ALLOW_TEST_MODE_BYPASS_VALUE = 'YES_I_AM_SURE';
const IGNORED_WARN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * OWNER-controlled "test mode" toggle.
 *
 * When enabled, downstream control points (credit check, OTP, 2FA, etc.)
 * bypass their real-world checks so the system can be exercised end-to-end
 * without external dependencies. Stored in SystemConfig under a single key.
 *
 * Mirrors CustomerPiiService.isStrictMode / setStrictMode — same SystemConfig
 * read/upsert shape, same fail-safe semantics: any DB error makes isEnabled()
 * return false (bypass OFF) so a transient outage can never silently disable
 * production safety checks.
 *
 * Task 20 I2 — env gate: the SystemConfig flag alone is not enough on production. It takes
 * effect only when `NODE_ENV !== 'production'` OR `ALLOW_TEST_MODE_BYPASS=YES_I_AM_SURE` is set
 * on the process. On production without the override the flag is ignored (logged + Sentry
 * warning, throttled) and turning it ON is refused — otherwise one OWNER click re-opens the
 * "know the phone = link the LINE" hole (OTP verify bypass) with no SMS to the phone owner.
 */
@Injectable()
export class TestModeService {
  /** SystemConfig key that controls the test-mode bypass. */
  static readonly KEY = 'TEST_MODE_BYPASS';

  private readonly logger = new Logger(TestModeService.name);
  private lastIgnoredWarnAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** โหมดทดสอบมีผลได้ในโปรเซสนี้หรือไม่ (ไม่ดู flag) */
  static envAllowsBypass(env: NodeJS.ProcessEnv = process.env): boolean {
    return (
      env.NODE_ENV !== 'production' ||
      env[ALLOW_TEST_MODE_BYPASS_ENV] === ALLOW_TEST_MODE_BYPASS_VALUE
    );
  }

  /**
   * Read the toggle. Returns true ONLY when the stored value is the literal
   * string "true" AND the env gate allows it. Missing row or DB error → false
   * (fail-safe to OFF).
   *
   * No in-process cache (same rationale as CustomerPiiService.isStrictMode):
   * the SELECT is sub-millisecond on the indexed `key` column, and caching
   * would produce cross-pod inconsistency.
   */
  async isEnabled(): Promise<boolean> {
    let flagOn: boolean;
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: TestModeService.KEY, deletedAt: null },
        select: { value: true },
      });
      flagOn = row?.value?.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
    if (!flagOn) return false;
    if (TestModeService.envAllowsBypass()) return true;
    this.warnIgnored();
    return false;
  }

  /** Set the toggle. Upserts SystemConfig. Returns the new effective value. */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled && !TestModeService.envAllowsBypass()) {
      throw new BadRequestException(
        'เปิดโหมดทดสอบบนระบบจริง (production) ไม่ได้ — โหมดนี้ข้าม OTP/เช็คเครดิต ใช้ได้เฉพาะระบบทดสอบ',
      );
    }
    await this.prisma.systemConfig.upsert({
      where: { key: TestModeService.KEY },
      update: {
        value: enabled ? 'true' : 'false',
        updatedAt: new Date(),
        deletedAt: null,
      },
      create: {
        key: TestModeService.KEY,
        value: enabled ? 'true' : 'false',
        label: 'โหมดทดสอบ — ปิดเช็คเครดิต/OTP/2FA (ห้ามเปิดบน prod ที่มีลูกค้าจริง)',
      },
    });
    return enabled;
  }

  /** flag เปิดอยู่แต่ถูก env gate ปิด — แจ้งไม่เกินครั้งละ 10 นาทีต่อโปรเซส (isEnabled ถูกเรียกทุก request) */
  private warnIgnored(): void {
    const now = Date.now();
    if (now - this.lastIgnoredWarnAt < IGNORED_WARN_INTERVAL_MS) return;
    this.lastIgnoredWarnAt = now;
    this.logger.warn(
      `[TEST MODE] SystemConfig ${TestModeService.KEY}=true is IGNORED on production ` +
        `(set ${ALLOW_TEST_MODE_BYPASS_ENV}=${ALLOW_TEST_MODE_BYPASS_VALUE} to honour it) — turn the flag OFF`,
    );
    Sentry.captureMessage(`[TEST MODE] ${TestModeService.KEY} is ON but ignored on production`, {
      level: 'warning',
      tags: { kind: 'test-mode-ignored' },
    });
  }
}
