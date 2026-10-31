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
 * Re-review P-4: older OWNER screens still write plaintext secrets under other keys
 * (`POST /line-oa/settings` → `line_channel_*`, `POST /channel-settings` →
 * `line_finance_channel_*`, `fb_*`, `tiktok_bm_access_token`). Every key that
 * `isSensitiveKey` (settings.constants) flags is dropped too — except settings that only
 * look secret by name (`customer_access_token_hours`, read by the Settings page).
 *
 * Real Postgres: the filter must hold for the rows the API actually returns.
 * รัน: DATABASE_URL=<ฐานทดสอบ test_db หรือ *_test> npx jest <ไฟล์นี้> --runInBand · ไม่มี DATABASE_URL = ข้าม
 * Probe rows are test-only fixtures, removed at the end.
 */
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const PROBE_VALUE = 'test-only-probe-secret';
const SECRET_ROWS = [
  'integration.t26-probe.secretToken',
  't26_probe_channel_access_token',
  't26_probe_channel_secret',
  't26_probe_admin_password',
  't26_probe_bank_api_key',
  't26_probe_service_credential',
  't26_probe_private_key',
];
const PLAIN_ROW = 't26_probe_setting';
/** Matches /token/i but is an hours number the Settings page reads through GET /settings. */
const LOOKS_SECRET_ROW = 'customer_access_token_hours';

describeDb('SettingsWriteService.findAll — never returns credentials (real DB)', () => {
  const prisma = new PrismaClient();
  const service = new SettingsWriteService(
    prisma as unknown as PrismaService,
    {
      log: jest.fn(),
    } as never,
  );
  let createdLooksSecretRow = false;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
    if (!/^test_db$|_test$/.test(dbName)) {
      throw new Error(
        `สเปคนี้เขียนแถวจริง — ต้องรันกับฐานทดสอบ (test_db หรือ *_test) แต่ได้ "${dbName}"`,
      );
    }
    for (const key of SECRET_ROWS) {
      await prisma.systemConfig.upsert({
        where: { key },
        create: { key, value: PROBE_VALUE },
        update: { value: PROBE_VALUE, deletedAt: null },
      });
    }
    await prisma.systemConfig.upsert({
      where: { key: PLAIN_ROW },
      create: { key: PLAIN_ROW, value: 'test-only-probe-value' },
      update: { value: 'test-only-probe-value', deletedAt: null },
    });
    // Leave a real customer_access_token_hours row (seeded DBs) untouched; only add one if absent.
    const existing = await prisma.systemConfig.findUnique({ where: { key: LOOKS_SECRET_ROW } });
    if (!existing) {
      await prisma.systemConfig.create({ data: { key: LOOKS_SECRET_ROW, value: '24' } });
      createdLooksSecretRow = true;
    } else if (existing.deletedAt) {
      throw new Error(`${LOOKS_SECRET_ROW} is soft-deleted in this test DB — cannot probe it`);
    }
  });

  afterAll(async () => {
    const keys = [...SECRET_ROWS, PLAIN_ROW, ...(createdLooksSecretRow ? [LOOKS_SECRET_ROW] : [])];
    await prisma.systemConfig.deleteMany({ where: { key: { in: keys } } });
    await prisma.$disconnect();
  });

  it('keeps ordinary settings (incl. ones that only look secret by name)', async () => {
    const keys = (await service.findAll()).map((r) => r.key);

    expect(keys).toContain(PLAIN_ROW);
    expect(keys).toContain(LOOKS_SECRET_ROW);
  });

  it('drops every integration.* row and every key isSensitiveKey flags', async () => {
    const rows = await service.findAll();
    const keys = rows.map((r) => r.key);

    for (const key of SECRET_ROWS) expect(keys).not.toContain(key);
    expect(keys.filter((k) => k.startsWith('integration.'))).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(PROBE_VALUE);
  });
});
