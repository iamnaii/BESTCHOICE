import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
 */
@Injectable()
export class TestModeService {
  /** SystemConfig key that controls the test-mode bypass. */
  static readonly KEY = 'TEST_MODE_BYPASS';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the toggle. Returns true ONLY when the stored value is the literal
   * string "true". Missing row or DB error → false (fail-safe to OFF).
   *
   * No in-process cache (same rationale as CustomerPiiService.isStrictMode):
   * the SELECT is sub-millisecond on the indexed `key` column, and caching
   * would produce cross-pod inconsistency.
   */
  async isEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: TestModeService.KEY, deletedAt: null },
        select: { value: true },
      });
      return row?.value?.trim().toLowerCase() === 'true';
    } catch {
      return false;
    }
  }

  /** Set the toggle. Upserts SystemConfig. Returns the new effective value. */
  async setEnabled(enabled: boolean): Promise<boolean> {
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
}
