/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npm test --workspace=apps/api -- src/modules/overdue/__tests__/dunning-lock-rule-text.db.spec.ts
 *
 * Task 42 (คำตัดสินเจ้าของ #44) — ข้อความแจ้งล็อก (`DEVICE_LOCKED`) เลิกสัญญา "ปลดล็อคทันที": ระบบไม่ปลดล็อคเครื่องเองเมื่อเงินเข้า
 * (ห้ามแตะการเชื่อม MDM) แต่สร้างงานให้เจ้าหน้าที่ตรวจยอดแล้วปลดล็อค ⇒ "… แล้วเจ้าหน้าที่จะปลดล็อคให้"
 *
 * migration `20261113000001_dunning_lock_rule_text_staff_unlock` แก้เฉพาะแถวที่ยังเป็นข้อความ seed เดิมทุกตัวอักษร (ข้อความที่เจ้าของแก้แล้ว
 * ไม่แตะ) · รันซ้ำไม่มีผล — รันคำสั่งของไฟล์ migration จริงในธุรกรรมที่ ROLLBACK (ไม่แตะแถวของสเปคอื่นบนฐานเดียวกัน)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DunningEventTrigger, PrismaClient } from '@prisma/client';
import { EVENT_DUNNING_RULES } from '../../../../prisma/seeds/collections-foundation.seed';
import { assertTestDatabase } from '../../notifications/__tests__/finance-line-fixtures';

const prisma = new PrismaClient();
const stamp = `t42m-${Date.now()}`;
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261113000001_dunning_lock_rule_text_staff_unlock/migration.sql',
);
/** ข้อความ seed เดิม (ก่อน Task 42) — ไม่อยู่ใน seed แล้ว จึงต้องเขียนไว้ที่นี่ */
const OLD_TEXT =
  'เครื่องของท่านถูกล็อคและตั้ง wallpaper แจ้งเตือน กรุณาชำระยอดค้าง {{amount}} ฿ เพื่อปลดล็อคทันที';
const NEW_TEXT =
  'เครื่องของท่านถูกล็อคและตั้ง wallpaper แจ้งเตือน กรุณาชำระยอดค้าง {{amount}} ฿ แล้วเจ้าหน้าที่จะปลดล็อคให้';

afterAll(() => prisma.$disconnect());

it('seed ใช้ข้อความใหม่ (แหล่งเดียวของข้อความกฎแจ้งล็อก)', () => {
  expect(EVENT_DUNNING_RULES.find((r) => r.eventTrigger === 'DEVICE_LOCKED')?.messageTemplate).toBe(
    NEW_TEXT,
  );
});

it('migration แก้เฉพาะแถวแจ้งล็อกที่ยังเป็นข้อความ seed เดิมทุกตัวอักษร · ข้อความที่เจ้าของแก้ไม่แตะ · รันซ้ำไม่มีผล', async () => {
  assertTestDatabase();
  const rows: [string, DunningEventTrigger, string, string][] = [
    ['ข้อความ seed เดิม', 'DEVICE_LOCKED', OLD_TEXT, NEW_TEXT],
    ['เจ้าของแก้ข้อความแล้ว', 'DEVICE_LOCKED', `${OLD_TEXT} (สอบถามสาขา)`, `${OLD_TEXT} (สอบถามสาขา)`],
    ['มีช่องว่างท้าย (ไม่ตรงทุกตัวอักษร)', 'DEVICE_LOCKED', `${OLD_TEXT} `, `${OLD_TEXT} `],
    ['กฎอื่นที่ข้อความเดียวกัน', 'DEVICE_UNLOCKED', OLD_TEXT, OLD_TEXT],
  ];
  const ids: Record<string, string> = {};
  for (const [label, eventTrigger, messageTemplate] of rows) {
    const rule = await prisma.dunningRule.create({
      data: {
        name: `${stamp} ${label}`,
        triggerDay: null,
        eventTrigger,
        channel: 'LINE',
        messageTemplate,
        includePaymentLink: true,
        autoExecute: true,
        isActive: false,
        sortOrder: 999,
      },
      select: { id: true },
    });
    ids[label] = rule.id;
  }

  // คำสั่งของ migration (ตั้งแต่ UPDATE ถึงท้ายไฟล์) — แบบเดียวกับ payment-link-purpose-backfill.db.spec.ts
  const file = readFileSync(MIGRATION, 'utf8');
  const sql = file.slice(file.indexOf('UPDATE "dunning_rules"')).trim().replace(/;$/, '');
  const ROLLBACK = new Error('rollback');
  let after: Record<string, string> = {};
  let secondRun = -1;
  try {
    await prisma
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        const found = await tx.dunningRule.findMany({
          where: { id: { in: Object.values(ids) } },
          select: { id: true, messageTemplate: true },
        });
        after = Object.fromEntries(
          Object.entries(ids).map(([label, id]) => [
            label,
            found.find((r) => r.id === id)!.messageTemplate,
          ]),
        );
        // รันซ้ำ: ไม่มีแถวไหนตรงเงื่อนไขแล้ว (ทั้งของสเปคนี้และแถวอื่นบนฐาน)
        secondRun = await tx.$executeRawUnsafe(sql);
        throw ROLLBACK;
      })
      .catch((err) => {
        if (err !== ROLLBACK) throw err;
      });

    expect(after).toEqual(Object.fromEntries(rows.map(([label, , , expected]) => [label, expected])));
    expect(secondRun).toBe(0);
  } finally {
    await prisma.dunningRule.deleteMany({ where: { id: { in: Object.values(ids) } } });
  }
}, 60_000);
