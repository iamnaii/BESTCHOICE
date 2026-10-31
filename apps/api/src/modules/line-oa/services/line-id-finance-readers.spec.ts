import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Task 22 fix round 1 I-1 — `customers.line_id_finance` **ไม่ใช่**หลักฐานตัวตนและไม่ใช่ปลายทางข้อความการเงิน: คอลัมน์แยกจากแถว OTP ได้
 * (ค่าที่พนักงาน/นำเข้าเขียนก่อน Task 22 · ลูกค้าที่กู้จากถังขยะ) ⇒ LIFF/ลิงก์ชำระอนุญาตด้วย `findOtpVerifiedCustomerId` และผู้ส่งข้อความ
 * ใช้ `FINANCE_LINE_RECIPIENT_SELECT` + `financeLineRecipient` / `findFinanceLineRecipient` (otp-verified-customer.ts).
 *
 * เทสนี้กันผู้อ่านคอลัมน์รายใหม่: ไฟล์ใต้ `src/` ทั้งหมด (รวม `src/cli` — Task 24 RR-M1) ที่อ้าง `lineIdFinance` หรือชื่อคอลัมน์ดิบ
 * `line_id_finance` (raw SQL) ในโค้ด (ไม่นับคอมเมนต์ · ไม่นับสเปค) ต้องอยู่ในรายการนี้ พร้อมเหตุผลว่าไม่ใช่การตัดสินสิทธิ์และไม่ใช่ปลายทางการส่ง —
 * เพิ่มไฟล์ = อธิบายในรีวิวว่าทำไมไม่ใช้แถว OTP · คีย์ = พาธนับจาก `src/`
 */
const ALLOWED: Record<string, string> = {
  'modules/customers/dto/customer.dto.ts':
    'DTO ฟอร์มลูกค้า — ค่าที่ส่งมาตัดสินด้วย staffLineFinanceChange (ล้างได้ ตั้งไม่ได้)',
  'modules/customers/services/customer-write.service.ts':
    'ฟอร์มลูกค้า — ล้าง = unlinkFinanceLine · ค่าใหม่ = 400',
  'modules/customers/skip-tracing.service.ts':
    'skip-tracing — ค่าเดิมไว้ตัดสิน/บันทึก audit · ไม่เขียนค่าใหม่',
  'modules/customers/services/customer-query.service.ts': 'แสดงบนหน้าลูกค้าของพนักงาน',
  'modules/employee-access/access-party-query-plan.ts': 'รายชื่อฟิลด์ที่พนักงานอ่านได้',
  'modules/chatbot-finance/services/verification.service.ts':
    'ผู้เขียนค่าเดียวหลัง OTP (bind) + ล้างค่าเดียวกันบนลูกค้าคนอื่น',
  'modules/line-oa/liff-api.service.ts':
    'LIFF ยกเลิกผูก — ล้างค่าค้างตาม LINE ของผู้เรียก (ไม่ให้สิทธิ์)',
  'modules/line-oa/services/finance-line-link.ts': 'helper ยกเลิกผูก (ล้างค่า)',
  'modules/contracts/services/contract-create-policy.ts': 'snapshot ข้อมูลลูกค้าลงสัญญา (เอกสาร)',
  'modules/contracts/services/document-rendering.service.ts':
    'ช่อง {customer_line_id} ในเอกสารสัญญา (แสดงผล)',
  'modules/trash/trash-registry.ts': 'คำเตือนหลังกู้ลูกค้า (เคยผูก LINE ไหม)',
  'modules/sales-bot/tools/capture-lead.tool.ts':
    'ตรวจ "ตัวตนชนกัน" แบบระวัง — ค่าไม่ตรง = ไม่ผูกห้อง (ไม่ให้สิทธิ์)',
  'modules/overdue/queue.service.ts':
    'ส่งค่า LINE ID ให้แผง 360 แสดง (ป้าย/แท็บแชท) — ปุ่มส่ง LINE + ตัวกรอง "ไม่มี LINE" ใช้ hasVerifiedLine จากแถว OTP (Task 24 RR-M2)',
  'modules/overdue/services/overdue-queries.service.ts':
    'รายการสัญญาค้างชำระส่งค่า LINE ID ไปแสดง — hasLine/withLine ของแบนเนอร์นัดครบกำหนดอ่านแถว OTP (Task 24 RR-M2)',
  'modules/collections-session/collections-session.service.ts':
    'ส่งค่า LINE ID ให้แผง 360 แสดง — ปุ่มส่ง LINE + ตัวนับ LINE ของโหมดโฟกัสใช้แถว OTP (Task 24 RR-M2)',
  'modules/reports/services/receivables-report.service.ts': 'คอลัมน์รายงาน',
  'cli/test-pack/_drive-helpers.ts':
    'test-pack ข้ามสัญญาที่อาจยิง LINE ถึงลูกค้าจริง — คอลัมน์ OR แถว OTP (ข้ามมากขึ้นแบบระวังไว้ก่อน · ไม่ตัดสินสิทธิ์ ไม่เป็นปลายทาง)',
};

const SRC = join(__dirname, '..', '..', '..');

/** อ้างคอลัมน์ = ชื่อฟิลด์ Prisma หรือชื่อคอลัมน์ดิบใน SQL */
const READS_COLUMN = /\b(?:lineIdFinance|line_id_finance)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (
      name.endsWith('.ts') &&
      !name.endsWith('.spec.ts') &&
      !full.includes(`${sep}__tests__${sep}`)
    )
      out.push(full);
  }
  return out;
}

/** ตัดคอมเมนต์ออกก่อนค้น (คอมเมนต์อธิบายประวัติของคอลัมน์ได้) */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('ผู้อ่าน customers.line_id_finance (Task 22 fix round 1 I-1)', () => {
  it('อ้างคอลัมน์ได้เฉพาะไฟล์ในรายการที่อนุญาต (ไม่ตัดสินสิทธิ์ · ไม่เป็นปลายทางข้อความ)', () => {
    const readers = walk(SRC)
      .filter((file) => READS_COLUMN.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(readers.filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('ตัวค้นจับทั้งชื่อฟิลด์ Prisma และชื่อคอลัมน์ใน raw SQL · ไม่นับคอมเมนต์', () => {
    const rawSql =
      'const rows = await tx.$queryRaw`SELECT id FROM customers WHERE line_id_finance = ${u}`;';
    expect(READS_COLUMN.test(code(rawSql))).toBe(true);
    expect(READS_COLUMN.test(code('select: { lineIdFinance: true }'))).toBe(true);
    expect(
      READS_COLUMN.test(code('// ไม่ใช้คอลัมน์ line_id_finance (Task 22)\nconst x = 1;')),
    ).toBe(false);
    expect(READS_COLUMN.test(code('/** อ่าน `lineIdFinance` เดิม */\nconst y = 2;'))).toBe(false);
  });

  it('รายการที่อนุญาตไม่มีไฟล์ค้าง (ไฟล์ที่เลิกอ้างแล้วต้องถอดออก)', () => {
    const stale = Object.keys(ALLOWED).filter(
      (file) => !READS_COLUMN.test(code(readFileSync(join(SRC, file), 'utf8'))),
    );
    expect(stale).toEqual([]);
  });
});
