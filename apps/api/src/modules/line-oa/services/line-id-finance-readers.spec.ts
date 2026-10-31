import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Task 22 fix round 1 I-1 — `customers.line_id_finance` **ไม่ใช่**หลักฐานตัวตนและไม่ใช่ปลายทางข้อความการเงิน: คอลัมน์แยกจากแถว OTP ได้
 * (ค่าที่พนักงาน/นำเข้าเขียนก่อน Task 22 · ลูกค้าที่กู้จากถังขยะ) ⇒ LIFF/ลิงก์ชำระอนุญาตด้วย `findOtpVerifiedCustomerId` และผู้ส่งข้อความ
 * ใช้ `FINANCE_LINE_RECIPIENT_SELECT` + `financeLineRecipient` / `findFinanceLineRecipient` (otp-verified-customer.ts).
 *
 * เทสนี้กันผู้อ่านคอลัมน์รายใหม่: ไฟล์ใต้ `src/modules` ที่อ้าง `lineIdFinance` ในโค้ด (ไม่นับคอมเมนต์ · ไม่นับสเปค) ต้องอยู่ในรายการนี้
 * พร้อมเหตุผลว่าไม่ใช่การตัดสินสิทธิ์และไม่ใช่ปลายทางการส่ง — เพิ่มไฟล์ = อธิบายในรีวิวว่าทำไมไม่ใช้แถว OTP
 */
const ALLOWED: Record<string, string> = {
  'customers/dto/customer.dto.ts':
    'DTO ฟอร์มลูกค้า — ค่าที่ส่งมาตัดสินด้วย staffLineFinanceChange (ล้างได้ ตั้งไม่ได้)',
  'customers/services/customer-write.service.ts':
    'ฟอร์มลูกค้า — ล้าง = unlinkFinanceLine · ค่าใหม่ = 400',
  'customers/skip-tracing.service.ts':
    'skip-tracing — ค่าเดิมไว้ตัดสิน/บันทึก audit · ไม่เขียนค่าใหม่',
  'customers/services/customer-query.service.ts': 'แสดงบนหน้าลูกค้าของพนักงาน',
  'employee-access/access-party-query-plan.ts': 'รายชื่อฟิลด์ที่พนักงานอ่านได้',
  'chatbot-finance/services/verification.service.ts':
    'ผู้เขียนค่าเดียวหลัง OTP (bind) + ล้างค่าเดียวกันบนลูกค้าคนอื่น',
  'line-oa/liff-api.service.ts': 'LIFF ยกเลิกผูก — ล้างค่าค้างตาม LINE ของผู้เรียก (ไม่ให้สิทธิ์)',
  'line-oa/services/finance-line-link.ts': 'helper ยกเลิกผูก (ล้างค่า)',
  'contracts/services/contract-create-policy.ts': 'snapshot ข้อมูลลูกค้าลงสัญญา (เอกสาร)',
  'contracts/services/document-rendering.service.ts':
    'ช่อง {customer_line_id} ในเอกสารสัญญา (แสดงผล)',
  'trash/trash-registry.ts': 'คำเตือนหลังกู้ลูกค้า (เคยผูก LINE ไหม)',
  'sales-bot/tools/capture-lead.tool.ts':
    'ตรวจ "ตัวตนชนกัน" แบบระวัง — ค่าไม่ตรง = ไม่ผูกห้อง (ไม่ให้สิทธิ์)',
  'overdue/queue.service.ts': 'แสดง/กรอง "มี LINE" บนคิวทวงถาม (การส่งจริงอ่านแถว OTP)',
  'overdue/services/overdue-queries.service.ts': 'แสดง hasLine/withLine (การส่งจริงอ่านแถว OTP)',
  'collections-session/collections-session.service.ts': 'กรองคิวงานพนักงาน (ไม่ส่งข้อความ)',
  'reports/services/receivables-report.service.ts': 'คอลัมน์รายงาน',
};

const MODULES = join(__dirname, '..', '..');

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
    const readers = walk(MODULES)
      .filter((file) => /\blineIdFinance\b/.test(code(readFileSync(file, 'utf8'))))
      .map((file) => relative(MODULES, file).split(sep).join('/'));
    expect(readers.filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('รายการที่อนุญาตไม่มีไฟล์ค้าง (ไฟล์ที่เลิกอ้างแล้วต้องถอดออก)', () => {
    const stale = Object.keys(ALLOWED).filter(
      (file) => !/\blineIdFinance\b/.test(code(readFileSync(join(MODULES, file), 'utf8'))),
    );
    expect(stale).toEqual([]);
  });
});
