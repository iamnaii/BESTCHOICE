import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * ตัวกันถอยหลังของบั๊ก "สตริงวันที่ YYYY-MM-DD ถูกแปลงเป็น 07:00 น. ไทย" (2026-11-18)
 *
 * new Date('2026-11-01') = เที่ยงคืน UTC = 07:00 น. ไทย ⇒ ใช้เป็นขอบเริ่มของคอลัมน์ timestamp แล้วรายการ
 * 00:00–06:59 น. ของวันเริ่มหาย (รวมรายการตั้งลูกหนี้งวดที่ลงเที่ยงคืนไทยพอดี) · ใช้เป็นขอบสิ้นสุด/ณ วันที่
 * แล้วทุกอย่างหลัง 07:00 น. ของวันนั้นหาย · setHours(23,59,59,999) ถูกเฉพาะเมื่อ TZ ของโปรเซสเป็น Asia/Bangkok
 *
 * ทางที่ถูก: ตัวช่วยใน utils/date.util.ts — reportDayStart / reportDayEnd / reportAsOf / bangkokDateRange
 * (วันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย ไม่ขึ้นกับ TZ ของโปรเซส)
 *
 * กฎ SQL_DAY_NO_BKK (แผน ง 2026-11-18): raw SQL ที่แบ่งวัน/สัปดาห์/เดือน/ชั่วโมงด้วย date_trunc / EXTRACT / ::date / CURRENT_DATE
 * บนคอลัมน์ timestamp (เก็บ UTC) ตรง ๆ = แบ่งตาม UTC ช้ากว่าไทย 7 ชั่วโมง — ใช้ sqlBkkLocal / sqlBkkDate จาก
 * utils/bangkok-sql.util.ts (หรือ AT TIME ZONE ในบรรทัดเดียวกัน) · "วันนี้" ให้คำนวณใน JS แล้วส่งเป็นพารามิเตอร์
 *
 * เทสต์นี้สแกน apps/api/src/**\/*.ts (ไม่นับ *.spec.ts · __tests__/ · src/cli/ · utils/date.util.ts · คอมเมนต์)
 * หาสี่รูปแบบ (RULES ข้างล่าง) ที่ต้องอยู่ใน ALLOWED พร้อมเหตุผลบรรทัดเดียว — เพิ่มรายการ = อธิบายในรีวิวว่าทำไม
 * ไม่ใช้ตัวช่วย · คีย์ = พาธนับจาก src/ หรือ `พาธ#ข้อความที่อยู่ในบรรทัดนั้น` (ไฟล์ที่มีทั้งการใช้ที่ถูกและต้องห้าม)
 * รายการที่ไม่ตรงกับอะไรแล้ว (stale) ทำให้เทสต์แดง — ลบออกเมื่อแก้โค้ดจุดนั้นแล้ว
 *
 * ดูรายการที่เหลือทั้งหมดโดยไม่ต้องแก้ไฟล์: DATE_GUARD_LIST=1 npx jest src/utils/date-string-day-bounds.guard.spec.ts
 */
const ALLOWED: Record<string, string> = {
  'modules/chat-engine/services/room-manager.service.ts#gte: new Date(from)':
    'from/to เป็นเวลา epoch มิลลิวินาที (ตัวเลข) ไม่ใช่สตริงวันที่',
  'modules/chat-analytics/chat-analytics-v2.service.ts#const from = new Date(input.from)':
    'DTO บังคับ ISO ที่มี Z/offset ก่อนใช้ (regex บรรทัด 58) — ไม่ใช่วันที่ล้วน',
  'modules/chat-analytics/chat-analytics-v2.service.ts#to = new Date(input.to)':
    'DTO บังคับ ISO ที่มี Z/offset ก่อนใช้ (regex บรรทัด 58) — ไม่ใช่วันที่ล้วน',
  'modules/employee-access/access-defect-boundaries.ts#new Date(q.from) > new Date(q.to)':
    'เทียบลำดับ from > to เพื่อตรวจ input เท่านั้น ไม่ได้ใช้เป็นขอบของ query',
  'modules/reporting/reporting.controller.ts#const to = dto.to ? new Date(dto.to)':
    'เว็บส่ง ISO instant เต็มจาก toISOString() โดยสัญญา (PdfExportButton) ไม่ใช่วันที่ล้วน',
  'modules/reporting/reporting.controller.ts#? new Date(dto.from)':
    'เว็บส่ง ISO instant เต็มจาก toISOString() โดยสัญญา (PdfExportButton) ไม่ใช่วันที่ล้วน',
  'modules/sso-config/sso-config.controller.ts#const when = date ? new Date(date)':
    'เทียบกับคอลัมน์ effectiveFrom/effectiveTo ที่เป็น @db.Date (วันที่ล้วน) — ไม่อยู่ในขอบเขต',
  'modules/users/users.service.ts#dto.startDate ? new Date(dto.startDate) : null':
    'เขียนวันเริ่มงานลงคอลัมน์ ไม่ใช่การกรอง',
  'modules/staff-chat/services/canned-response-variable.service.ts#date instanceof Date ? date : new Date(date)':
    'จัดรูปวันที่เพื่อแสดงผล (พ.ศ.) ไม่ใช่การกรอง',
  'modules/accounting/general-ledger-report.service.ts#const startMinusOne = new Date(periodStart)':
    'คัดลอก Date ที่ผู้เรียกแปลงด้วยตัวช่วยมาแล้ว แล้วลบ 1 มิลลิวินาที ไม่ได้แปลงสตริง',
  'modules/accounting/transactional-report.service.ts#const endDate = new Date(asOfDate)':
    'ขอบ ณ วันที่ + setHours ถูกเมื่อ TZ โปรเซส = Asia/Bangkok (installRuntimeGlobals) — แผน ก ตรวจแล้วไม่แก้',
  'modules/asset/services/asset-query.service.ts#const asOfDate = filters.asOfDate ? new Date(filters.asOfDate)':
    'วันซื้อ/ขายสินทรัพย์เก็บที่ 07:00 น. ไทย ตรงกับขอบ จึงนับครบ',
  'modules/asset/asset-reports.service.ts#const asOfDate = filters.asOfDate ? new Date(filters.asOfDate)':
    'เหตุผลเดียวกับ asset-query.service.ts — วันซื้อ/ขายสินทรัพย์เก็บที่ 07:00 น. ไทย',
  'modules/asset/asset-transfer.service.ts#range.gte = new Date(filters.fromDate)':
    'วันโอนสินทรัพย์เก็บที่ 07:00 น. ไทย ขอบเริ่มตรงพอดี',
  'modules/asset/asset-transfer.service.ts#const end = new Date(filters.toDate)':
    'วันโอนสินทรัพย์เก็บที่ 07:00 น. ไทย ขอบสิ้นสุดใช้ setHours',
  'modules/expense-documents/services/expense-document-query.service.ts#where.documentDate.gte = new Date(':
    'documentDate เก็บที่ 07:00 น. (หรือ 12:00 น. ของบิลประจำ) นับครบทั้งขอบเริ่ม/สิ้นสุด (ขอบเริ่ม บรรทัด 103/159/225)',
  'modules/expense-documents/services/expense-document-query.service.ts#const end = new Date(query.endDate)':
    'documentDate เก็บที่ 07:00 น. (หรือ 12:00 น. ของบิลประจำ) นับครบทั้งขอบเริ่ม/สิ้นสุด (ขอบสิ้นสุด setHours)',
  'modules/expense-documents/services/expense-document-query.service.ts#const end = new Date(filters.endDate)':
    'documentDate เก็บที่ 07:00 น. (หรือ 12:00 น. ของบิลประจำ) นับครบทั้งขอบเริ่ม/สิ้นสุด (ขอบสิ้นสุด setHours)',
  'modules/expense-documents/services/expense-document-query.service.ts#const end = new Date(filters.to)':
    'documentDate เก็บที่ 07:00 น. (หรือ 12:00 น. ของบิลประจำ) นับครบทั้งขอบเริ่ม/สิ้นสุด (ขอบสิ้นสุด setHours)',
  'modules/expense-documents/services/expense-document-query.service.ts#new Date(filters.date)':
    'มุมมองรายวัน: new Date(filters.date) + setHours(0)/setHours(23,59,59,999) ถูกเฉพาะเมื่อ TZ ของโปรเซส = Asia/Bangkok (installRuntimeGlobals) — ไม่ใช่เพราะ documentDate เก็บ 07:00 น.',
  'modules/other-income/services/other-income-report.service.ts#gte: new Date(query.startDate)':
    'issueDate เก็บที่ 07:00 น. ไทยทุกทางที่ใช้งานจริง',
  'modules/other-income/services/other-income-report.service.ts#lte: new Date(query.endDate)':
    'issueDate เก็บที่ 07:00 น. ไทยทุกทางที่ใช้งานจริง',
  'modules/reports/services/receivables-report.service.ts#${startDate}T00:00:00':
    'T00:00:00 ไม่มี offset ถูกเมื่อ TZ=Asia/Bangkok (เว็บส่ง YYYY-MM-DD เสมอ) — แผน ข ตั้งใจไม่แปลง',
  'modules/reports/services/receivables-report.service.ts#${endDate}T23:59:59.999':
    'T23:59:59.999 ไม่มี offset ถูกเมื่อ TZ=Asia/Bangkok (เว็บส่ง YYYY-MM-DD เสมอ) — แผน ข ตั้งใจไม่แปลง',
  'modules/payments/services/payment-query.service.ts#const f = new Date(dueFrom)':
    'ขอบเริ่มวันครบกำหนดแบบ local ถูกเมื่อ TZ=Asia/Bangkok เท่านั้น (getFullYear/getMonth/getDate ของโปรเซส) — แผน ข ตั้งใจไม่แปลง',
  'modules/payments/services/payment-query.service.ts#const t = new Date(dueTo)':
    'ขอบสิ้นสุดวันครบกำหนดแบบ local ถูกเมื่อ TZ=Asia/Bangkok เท่านั้น (getFullYear/getMonth/getDate ของโปรเซส) — แผน ข ตั้งใจไม่แปลง',
  'modules/payments/services/payment-query.service.ts#const d = new Date(filters.date)':
    'ตัวกรองวันครบกำหนดรายวันแบบ local ถูกเมื่อ TZ=Asia/Bangkok เท่านั้น (getFullYear/getMonth/getDate ของโปรเซส) — แผน ข ตั้งใจไม่แปลง',
  'modules/payments/services/payment-query.service.ts#const d = new Date(date)':
    'สมุดสรุปรายวัน (getDailySummary) แบบ local ถูกเมื่อ TZ=Asia/Bangkok เท่านั้น (getFullYear/getMonth/getDate ของโปรเซส) — แผน ข ตั้งใจไม่แปลง',
  'modules/promotions/promotions.service.ts#startDate: new Date(dto.startDate)':
    'สร้างโปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/promotions/promotions.service.ts#endDate: new Date(dto.endDate)':
    'สร้างโปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/promotions/promotions.service.ts#current.startDate : new Date(dto.startDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/promotions/promotions.service.ts#current.endDate : new Date(dto.endDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/promotions/promotions.service.ts#data.startDate = new Date(dto.startDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/promotions/promotions.service.ts#data.endDate = new Date(dto.endDate)':
    'แก้โปรโมชัน: เขียนวันเริ่ม/สิ้นสุดโปรโมชัน (เก็บค่า ไม่ใช่กรอง) — วันเริ่มคงเก็บเที่ยงคืน UTC ตามเดิม',
  'modules/analytics/analytics.service.ts#EXTRACT(MONTH FROM AGE(activity_month, cohort_month))':
    'SQL_DAY_NO_BKK: นับเดือนห่างจาก AGE() ของสองค่าที่ตัดเดือนตามเวลาไทยแล้ว (cohort_month / activity_month) ไม่ได้อ่านคอลัมน์ timestamp ตรง',
  'modules/analytics/analytics.service.ts#EXTRACT(YEAR FROM AGE(activity_month, cohort_month))':
    'SQL_DAY_NO_BKK: นับปีห่างจาก AGE() ของสองค่าที่ตัดเดือนตามเวลาไทยแล้ว (cohort_month / activity_month) ไม่ได้อ่านคอลัมน์ timestamp ตรง',
  "modules/chat-analytics/chat-analytics-sql.ts#+INTERVAL '7 hours')::date":
    "SQL_DAY_NO_BKK: แปลงเป็นวันไทยด้วย + INTERVAL '7 hours' อยู่แล้ว (ไทยไม่มี DST — เท่ากับ AT TIME ZONE) สำหรับนาทีทำการของ SLA แชท",
};

/** พาธ src/ — ไฟล์นี้อยู่ที่ src/utils/ */
const SRC = join(__dirname, '..');

const WATCHED_NAMES = [
  'start',
  'end',
  'from',
  'to',
  'since',
  'until',
  'asOf',
  'asOfDate',
  'periodStart',
  'periodEnd',
  'startDate',
  'endDate',
  'dateFrom',
  'dateTo',
  'fromDate',
  'toDate',
  'dueFrom',
  'dueTo',
  'date',
];
const WATCHED_PREFIXES = ['dto', 'query', 'q', 'filters', 'filter', 'params', 'opts', 'options', 'input'];

interface Rule {
  id: 'RAW_PARSE' | 'TEMPLATE_NO_OFFSET' | 'UTC_MIDNIGHT' | 'SQL_DAY_NO_BKK';
  re: RegExp;
  /** บรรทัดที่ตรง `re` แต่ตรง `ok` ด้วย = ถูกแล้ว (ไม่นับเป็น offender) */
  ok?: RegExp;
  hint: string;
}

const RULES: Rule[] = [
  {
    id: 'RAW_PARSE',
    re: new RegExp(
      `new Date\\(\\s*(?:(?:${WATCHED_PREFIXES.join('|')})\\.)?(?:${WATCHED_NAMES.join('|')})\\s*!?\\s*\\)`,
    ),
    hint: "ใช้ reportDayStart (ขอบเริ่ม) / reportAsOf (ขอบสิ้นสุดหรือ ณ วันที่) / reportDayEnd / bangkokDateRange จาก utils/date.util",
  },
  {
    id: 'TEMPLATE_NO_OFFSET',
    re: /new Date\(\s*`\$\{[^}]+\}T(?:00:00(?::00)?|23:59(?::59)?)(?:\.\d{1,3})?`\s*\)/,
    hint: 'ใส่ +07:00 หรือใช้ reportDayStart/reportDayEnd แทน — ไม่มี offset = ตามโซนของโปรเซส',
  },
  {
    id: 'UTC_MIDNIGHT',
    re: /\.setUTCHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/,
    hint: 'เที่ยงคืน UTC = 07:00 น. ไทย — ใช้ bangkokStartOfDay() / bangkokMidnight()',
  },
  {
    id: 'SQL_DAY_NO_BKK',
    re: /date_trunc\(\s*'(?:hour|day|week|month|quarter|year)'|EXTRACT\(\s*(?:DOW|ISODOW|HOUR|DAY|DOY|WEEK|MONTH|QUARTER|YEAR)\s+FROM|(?<!['}])::date\b|\bCURRENT_DATE\b/i,
    ok: /AT TIME ZONE|sqlBkk(?:Local|Date)\(/i,
    hint: "คอลัมน์ timestamp เก็บ UTC — ห่อด้วย sqlBkkLocal()/sqlBkkDate() จาก utils/bangkok-sql.util · 'วันนี้' ส่งเป็นพารามิเตอร์ (bangkokDateString / bangkokStartOfDay)",
  },
];

const ruleHits = (rule: Rule, text: string): boolean => rule.re.test(text) && !rule.ok?.test(text);

interface Offender {
  file: string;
  line: number;
  rule: Rule['id'];
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      if (relative(SRC, full) === 'cli') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** ตัดคอมเมนต์ออกก่อนค้น โดยคงจำนวนบรรทัดไว้ (เพื่อรายงานเลขบรรทัดถูก) */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function collectOffenders(): Offender[] {
  const out: Offender[] = [];
  for (const full of walk(SRC)) {
    const file = relative(SRC, full).split(sep).join('/');
    if (file === 'utils/date.util.ts') continue;
    code(readFileSync(full, 'utf8'))
      .split('\n')
      .forEach((text, index) => {
        for (const rule of RULES) {
          if (ruleHits(rule, text)) out.push({ file, line: index + 1, rule: rule.id, text: text.trim() });
        }
      });
  }
  return out;
}

/** คีย์ใน ALLOWED ที่ครอบ offender นี้ (ทั้งไฟล์ หรือเฉพาะบรรทัดที่มีข้อความตามคีย์ `พาธ#ข้อความ`) */
function allowKeyFor(offender: Offender): string | undefined {
  if (offender.file in ALLOWED) return offender.file;
  return Object.keys(ALLOWED).find((key) => {
    const hash = key.indexOf('#');
    return hash > 0 && key.slice(0, hash) === offender.file && offender.text.includes(key.slice(hash + 1));
  });
}

const flaggedRules = (line: string): string[] =>
  RULES.filter((rule) => ruleHits(rule, code(line))).map((rule) => rule.id);

describe('ตัวกันถอยหลัง: สตริงวันที่ YYYY-MM-DD ห้ามแปลงเป็น 07:00 น. ไทย', () => {
  const offenders = collectOffenders();

  it('ทุกจุดที่แปลงวันที่แบบดิบต้องอยู่ใน ALLOWED พร้อมเหตุผล — ไม่ก็ใช้ตัวช่วยใน utils/date.util', () => {
    if (process.env.DATE_GUARD_LIST) {
      const lines = offenders.map((o) => {
        const key = allowKeyFor(o);
        return `${key ? 'ALLOWED' : 'OFFENDER'}  ${o.file}:${o.line} [${o.rule}] ${o.text}`;
      });
      // eslint-disable-next-line no-console
      console.log(`\n${lines.join('\n')}\n(${offenders.length} บรรทัดใน ${new Set(offenders.map((o) => o.file)).size} ไฟล์)`);
    }
    const hintOf = (id: Rule['id']) => RULES.find((rule) => rule.id === id)!.hint;
    const report = offenders
      .filter((o) => !allowKeyFor(o))
      .map((o) => `${o.file}:${o.line} [${o.rule}] ${o.text}  ⇒ ${hintOf(o.rule)}`);
    expect(report).toEqual([]);
  });

  it('รายการ ALLOWED ไม่ค้าง (คีย์ที่ไม่ตรงกับบรรทัดใดแล้วต้องลบออก)', () => {
    const used = new Set(offenders.map(allowKeyFor).filter((key): key is string => !!key));
    const stale = Object.keys(ALLOWED).filter((key) => !used.has(key));
    expect(stale).toEqual([]);
  });

  it('ทุกรายการใน ALLOWED มีเหตุผลและพาธชี้ไปไฟล์ที่มีอยู่จริง', () => {
    for (const [key, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length).toBeGreaterThanOrEqual(10);
      const file = key.includes('#') ? key.slice(0, key.indexOf('#')) : key;
      expect(() => readFileSync(join(SRC, file), 'utf8')).not.toThrow();
    }
  });

  it('ตัวค้นจับรูปแบบที่ต้องห้ามได้จริง', () => {
    expect(flaggedRules('const s = new Date(startDate);')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('x = new Date(dto.endDate!)')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('x = new Date(query.asOf)')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('where.gte = new Date(filters.from);')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('const e = new Date( input.to )')).toEqual(['RAW_PARSE']);
    expect(flaggedRules('const d = new Date(`${startDate}T00:00:00`);')).toEqual(['TEMPLATE_NO_OFFSET']);
    expect(flaggedRules('const d = new Date(`${endDate}T23:59:59.999`);')).toEqual(['TEMPLATE_NO_OFFSET']);
    expect(flaggedRules('today.setUTCHours(0, 0, 0, 0);')).toEqual(['UTC_MIDNIGHT']);
    expect(flaggedRules("date_trunc('week', p.paid_date)::date AS week_start,")).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules("GROUP BY DATE_TRUNC('month', p.paid_date)")).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('EXTRACT(HOUR FROM s.created_at)::int AS hour,')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('extract(dow from s.created_at)')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date')).toEqual(['SQL_DAY_NO_BKK']);
    expect(flaggedRules('WHERE promised_date < CURRENT_DATE')).toEqual(['SQL_DAY_NO_BKK']);
  });

  it('ไม่จับรูปแบบที่ปลอดภัย · ไม่นับคอมเมนต์', () => {
    expect(flaggedRules('new Date(`${d}T00:00:00+07:00`)')).toEqual([]);
    expect(flaggedRules('new Date(`${d}T23:59:59.999Z`)')).toEqual([]);
    expect(flaggedRules('const s = reportDayStart(startDate);')).toEqual([]);
    expect(flaggedRules('new Date(row.date)')).toEqual([]);
    expect(flaggedRules('new Date(dto.entryDate)')).toEqual([]);
    expect(flaggedRules('x.setUTCHours(3, 0, 0, 0)')).toEqual([]);
    expect(flaggedRules('// new Date(startDate)')).toEqual([]);
    expect(flaggedRules('/* new Date(startDate) */')).toEqual([]);
    expect(flaggedRules("const url = 'http://x'; // new Date(from)")).toEqual([]);
    expect(flaggedRules("date_trunc('day', (cm.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok') AS date")).toEqual([]);
    expect(flaggedRules("date_trunc('week', ${sqlBkkLocal('p.paid_date')})::date AS week_start,")).toEqual([]);
    expect(flaggedRules("SELECT ${today}::date - ${sqlBkkDate('oldest_due')} AS days, outstanding")).toEqual([]);
    expect(flaggedRules('AND work_date = ${by.key.workDate}::date FOR UPDATE')).toEqual([]);
    expect(flaggedRules("MIN(CASE WHEN p.warranty_expired THEN '0001-01-01'::date ELSE p.warranty_expire_date END)")).toEqual([]);
    expect(flaggedRules('AVG(EXTRACT(EPOCH FROM (cl.called_at - c.created_at)) / 86400.0) AS avg_days')).toEqual([]);
    expect(flaggedRules("date_trunc('milliseconds', transaction_timestamp())")).toEqual([]);
    expect(flaggedRules('this.lineSrc.extract({ channel: x, since })')).toEqual([]);
  });
});
