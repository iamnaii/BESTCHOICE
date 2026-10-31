import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { SettingsWriteService } from '../services/settings-write.service';

/**
 * Review P-1: `GET /settings` (SettingsWriteService.findAll — roles OWNER/FM/BM/ACCOUNTANT,
 * widened by `settings_access_role`) returned every `system_config` row, including the
 * `integration.*` credentials — raw ciphertext, or plaintext for anything saved before
 * INTEGRATION_ENCRYPTION_KEY existed. Those rows belong to the Integration Hub endpoints
 * (`/integrations/*`, OWNER/ACCOUNTANT, masked) only. No web page reads `integration.*`
 * through `/settings` (grep 2026-10-31); document rendering reads named keys only.
 *
 * Real Postgres: the filter must hold in the query the API actually sends.
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 * Rows are test-only fixtures, removed at the end.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const SECRET_ROW = 'integration.t26-probe.secretToken';
const PLAIN_ROW = 't26_probe_setting';

describeDb(
  'SettingsWriteService.findAll — never returns integration.* credentials (real DB)',
  () => {
    const prisma = new PrismaClient();
    const service = new SettingsWriteService(
      prisma as unknown as PrismaService,
      {
        log: jest.fn(),
      } as never,
    );

    beforeAll(async () => {
      const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
      if (!/^test_db$|_test$/.test(dbName)) {
        throw new Error(
          `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
        );
      }
      for (const [key, value] of [
        [SECRET_ROW, 'test-only-probe-secret'],
        [PLAIN_ROW, 'test-only-probe-value'],
      ]) {
        await prisma.systemConfig.upsert({
          where: { key },
          create: { key, value },
          update: { value, deletedAt: null },
        });
      }
    });

    afterAll(async () => {
      await prisma.systemConfig.deleteMany({ where: { key: { in: [SECRET_ROW, PLAIN_ROW] } } });
      await prisma.$disconnect();
    });

    it('keeps ordinary settings, drops every integration.* row', async () => {
      const rows = await service.findAll();
      const keys = rows.map((r) => r.key);

      expect(keys).toContain(PLAIN_ROW);
      expect(keys.filter((k) => k.startsWith('integration.'))).toEqual([]);
      expect(JSON.stringify(rows)).not.toContain('test-only-probe-secret');
    });
  },
);
