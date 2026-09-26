// PR 3 Task 1 — ตัวประกอบข้อมูลข้อความ LINE หลังการขาย (pure util) + ค่าคงที่ event type
// + helper สร้าง note ของ AfterSalesEvent ที่ทุก service ในเคสนี้ต้องใช้ร่วมกัน
//
// Task 2 (บริการส่ง LINE) consume exports ของไฟล์นี้ตรงตามชื่อ — ชื่อ/signature เป็น contract
// ห้ามเปลี่ยนโดยไม่แก้ที่นี่และแจ้งงานที่พึ่งพา

export type AfterSalesLineMoment = 'RECEIVED' | 'READY' | 'CLOSED' | 'PICKUP_REMINDER';

export const AFTER_SALES_LINE_EVENT_TYPE: Record<AfterSalesLineMoment, string> = {
  RECEIVED: 'AFTER_SALES_RECEIVED',
  READY: 'AFTER_SALES_READY',
  CLOSED: 'AFTER_SALES_CLOSED',
  PICKUP_REMINDER: 'AFTER_SALES_PICKUP_REMINDER',
};

export const WARRANTY_EXPIRING_EVENT_TYPE = 'WARRANTY_EXPIRING_7D';

const MOMENT_LABEL: Record<string, string> = {
  AFTER_SALES_RECEIVED: 'รับเรื่องแล้ว',
  AFTER_SALES_READY: 'มารับได้แล้ว',
  AFTER_SALES_CLOSED: 'ปิดเคส',
  AFTER_SALES_PICKUP_REMINDER: 'เตือนรับเครื่อง 7 วัน',
  WARRANTY_EXPIRING_7D: 'ประกันใกล้หมด',
};

/** note ของ AfterSalesEvent ทุกแถวที่ service นี้เขียน ขึ้นต้นด้วย tag เพื่อ dedup/ค้นย้อน */
export function lineEventTag(eventType: string): string {
  return `[${eventType}]`;
}

export function lineEventNote(
  eventType: string,
  status: 'SENT' | 'NO_LINK' | 'DISABLED' | 'FAILED' | 'BLOCKED',
  detail?: string,
): string {
  const s = {
    SENT: 'ส่งแล้ว',
    NO_LINK: 'ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE',
    DISABLED: 'ไม่ได้ส่ง — ปิดการส่ง LINE (after_sales_line_enabled)',
    FAILED: `ส่งไม่สำเร็จ${detail ? ` (${detail})` : ''}`,
    BLOCKED: `ไม่ได้ส่ง — ${detail ?? 'ถูกบล็อก'}`,
  }[status];
  return `${lineEventTag(eventType)} ${MOMENT_LABEL[eventType] ?? eventType} · ${s}`;
}

export function buildLiffLine(liffId: string | null, label: string): string {
  return liffId ? `${label}: https://liff.line.me/${liffId}/liff/warranty` : '';
}

export interface LineCaseRow {
  caseNumber: string;
  outcome: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE' | null;
  symptom: string;
  deviceBrand: string | null;
  deviceModel: string | null;
  deviceStorage?: string | null;
  deviceImei: string | null;
  branch: { name: string };
  warrantySnapshot: {
    status: string;
    shopWarrantyEndDate: string | null;
    manufacturerWarrantyEndDate: string | null;
  } | null;
  repairTicket: {
    payer: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
    estimatedCost: string | null;
    actualCost: string | null;
  } | null;
  replacement?: {
    brand: string;
    model: string;
    storage: string | null;
    imeiSerial: string | null;
    shopWarrantyEndDate: string | null;
  } | null;
  readyAt?: Date | null; // stageSince ของ READY_FOR_PICKUP — ใช้ในเตือน 7 วัน
  /** stage ของเคส ณ ตอนส่ง — PRICED ที่อนุมัติอัตโนมัติ (tier AUTO) ส่ง RECEIVED ตอนอนุมัติแล้ว (final fix I-3) */
  stage?: string | null;
}

/** ค่าใช้จ่ายของทางออกเปลี่ยนแบบมีราคา — ใช้ร่วมกันทั้งข้อความ LINE (costLine) และหน้า LIFF "เคสของฉัน"
 * (liff-after-sales.service.ts) ให้ลูกค้าเห็นถ้อยคำเรื่องเงินเดียวกันทุกช่องทาง (final fix I-4) */
export const PRICED_EXCHANGE_COST_LINE = 'ตามราคาที่ตกลง ชำระตอนทำสัญญาใหม่ที่สาขา';

const baht = (v: string | null | undefined): string | null =>
  v ? Number(v).toLocaleString('th-TH', { maximumFractionDigits: 0 }) : null;

/** ตัด symptom ที่ 120 ตัวอักษร กันข้อความ LINE ยาวเกินไป */
function trim120(s: string): string {
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/**
 * `formatThaiDateText` (thai-date.util.ts) คืนปี พ.ศ. เต็ม 4 หลัก (เช่น "3 เม.ย. 2569")
 * ซึ่งยาวเกินไปสำหรับข้อความ LINE ที่ต้องการรูปสั้น — สเปกจากกระดาน mockup ต้องการ
 * "17 พ.ย. 69" (ปี พ.ศ. 2 หลัก) จึงเขียน formatter เฉพาะของไฟล์นี้แทนการเรียกใช้ตัวนั้น
 * (BKK timezone เดียวกัน, เดือนย่อไทยเดียวกัน, ต่างแค่ปีตัดเหลือ 2 หลัก)
 *
 * Exported (PR 3 Task 5, additive-only — no behavior change) so `warranty-line-notifier.service.ts`
 * can reuse the same short-year formatter for `${expireDate}` instead of writing a third Thai-date
 * formatter (`formatThaiDateText` in `thai-date.util.ts` is the full-year one, unsuitable here).
 */
export function thaiShortYearDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const lookup: Record<string, string> = {};
  for (const p of formatter.formatToParts(d)) {
    if (p.type !== 'literal') lookup[p.type] = p.value;
  }
  const day = Number(lookup.day);
  const month = Number(lookup.month);
  const year = Number(lookup.year);
  const beYear2 = String((year + 543) % 100).padStart(2, '0');
  return `${day} ${THAI_MONTHS_SHORT[month - 1]} ${beYear2}`;
}

export function buildLineData(
  row: LineCaseRow,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  moment: AfterSalesLineMoment,
  liffLine: string,
): Record<string, string> {
  const deviceName =
    [row.deviceBrand, row.deviceModel, row.deviceStorage].filter(Boolean).join(' ') ||
    'เครื่องของคุณ';
  const isExchange =
    row.outcome === 'SAME_MODEL_EXCHANGE' ||
    row.outcome === 'PRICED_EXCHANGE' ||
    row.outcome === 'CASH_SAME_MODEL_EXCHANGE';
  const payer = row.repairTicket?.payer ?? 'SHOP';
  const est = baht(row.repairTicket?.estimatedCost ?? null);
  const actual = baht(row.repairTicket?.actualCost ?? null);
  const w = row.warrantySnapshot?.status;

  // RECEIVED — สิทธิ์ที่ลูกค้าจะได้ + สิ่งที่ต้องรอ
  // CASH_SAME_MODEL_EXCHANGE เข้ากิ่งเดียวกับ SAME_MODEL_EXCHANGE เสมอ — สอดคล้องกับ
  // isExchange และทุกฟิลด์อื่น (nextLine/readyLine/costLine/deviceLine/warrantyLines/
  // readyKind) ที่จัดสองตัวนี้เป็นกลุ่มเดียวกันอยู่แล้ว (fix round 1, finding 1)
  const entitlementLine =
    row.outcome === 'SAME_MODEL_EXCHANGE' || row.outcome === 'CASH_SAME_MODEL_EXCHANGE'
      ? 'เปลี่ยนรุ่นเดิม รอผู้จัดการยืนยัน'
      : row.outcome === 'PRICED_EXCHANGE'
        ? row.stage === 'READY_FOR_PICKUP' || row.stage === 'CLOSED'
          ? 'เปลี่ยนแบบมีราคา อนุมัติแล้ว'
          : 'เปลี่ยนแบบมีราคา รออนุมัติ'
        : payer === 'SUPPLIER_CLAIM'
          ? 'อยู่ในประกันศูนย์ ส่งเคลมศูนย์ ไม่มีค่าใช้จ่าย'
          : payer === 'CUSTOMER'
            ? `${w === 'OUT_OF_WARRANTY' || w === 'WALK_IN' ? 'หมดประกัน ' : ''}ค่าซ่อมประมาณ ${est ?? '—'} บาท ยืนยันราคาก่อนซ่อมทุกครั้ง`
            : 'อยู่ในประกันร้าน ไม่มีค่าใช้จ่าย';

  const nextLine = isExchange
    ? 'เมื่อพร้อมรับเครื่อง ทางร้านจะแจ้งทาง LINE นี้ทันที'
    : 'ซ่อมเสร็จเมื่อไร ทางร้านจะแจ้งทาง LINE นี้ทันที';

  // READY — เครื่องพร้อมส่งมอบแล้ว + ค่าใช้จ่ายที่ต้องจ่าย (ถ้ามี)
  const readyLine =
    row.outcome === 'SAME_MODEL_EXCHANGE' || row.outcome === 'CASH_SAME_MODEL_EXCHANGE'
      ? 'เปลี่ยนเครื่องใหม่ให้แล้ว มารับได้เลย'
      : row.outcome === 'PRICED_EXCHANGE'
        ? 'คำขอเปลี่ยนเครื่องอนุมัติแล้ว มาทำสัญญาใหม่ที่สาขาได้เลย'
        : 'ซ่อมเสร็จแล้ว มารับได้เลย';

  const costLine = isExchange
    ? row.outcome === 'PRICED_EXCHANGE'
      ? PRICED_EXCHANGE_COST_LINE
      : 'ไม่มี'
    : payer === 'SHOP'
      ? 'ไม่มี (ในประกันร้าน)'
      : payer === 'SUPPLIER_CLAIM'
        ? 'ไม่มี (เคลมศูนย์)'
        : `ค่าซ่อม ${actual ?? est ?? '—'} บาท ชำระที่สาขา`;

  // CLOSED — เครื่องที่ส่งมอบจริง (ซ่อมคืนเครื่องเดิม vs เปลี่ยนเครื่องใหม่) + ประกันคงเหลือ
  // เข้ากิ่ง "เครื่องใหม่" เฉพาะเมื่อมีข้อมูล replacement จริงเท่านั้น — isExchange อย่างเดียว
  // ไม่พอ: ถ้าไม่มีข้อมูล replacement (เคสที่ type อนุญาตแต่ไม่ควรเกิดจริง) ต้องบรรยายสิ่งที่
  // รู้จริง (deviceName เดิม + ประกันตาม snapshot) ไม่ใช่อ้างว่าเป็นเครื่องใหม่ที่ไม่รู้ยี่ห้อ/
  // รุ่นของมัน (fix round 1, finding 2)
  const hasReplacement = isExchange && !!row.replacement;

  const deviceLine = hasReplacement
    ? (() => {
        const r = row.replacement!;
        const newName = [r.brand, r.model, r.storage].filter(Boolean).join(' ') || deviceName;
        const imeiTail = r.imeiSerial ? r.imeiSerial.slice(0, 4) : null;
        return imeiTail ? `เครื่องใหม่ ${newName} · IMEI ${imeiTail}…` : `เครื่องใหม่ ${newName}`;
      })()
    : deviceName;

  // final fix I-5 — บอกเฉพาะข้อเท็จจริงที่ระบบมี: วันหมดประกันร้านของสัญญาที่คุ้มครองเครื่องทดแทนจริง
  // (service เลือกสัญญา — MEMO = สัญญาเดิม) ไม่มีข้ออ้าง "ประกันนับใหม่" (MEMO ไม่ได้เริ่มประกันใหม่) ·
  // ไม่มีวันที่ = ไม่มีบรรทัด → '—'
  const warrantyLines = hasReplacement
    ? (() => {
        const shopEnd = thaiShortYearDate(row.replacement?.shopWarrantyEndDate ?? null);
        return shopEnd ? `ประกันร้าน ถึง ${shopEnd}` : '—';
      })()
    : (() => {
        const lines: string[] = [];
        const shopEnd = thaiShortYearDate(row.warrantySnapshot?.shopWarrantyEndDate ?? null);
        const mfgEnd = thaiShortYearDate(row.warrantySnapshot?.manufacturerWarrantyEndDate ?? null);
        if (shopEnd) lines.push(`ประกันร้าน ถึง ${shopEnd}`);
        if (mfgEnd) lines.push(`ประกันศูนย์ ถึง ${mfgEnd}`);
        return lines.length ? lines.join('\n') : '—';
      })();

  // PICKUP_REMINDER — เตือนครบ 7 วันยังไม่มารับ
  const readyKind = isExchange ? 'พร้อมส่งมอบ' : 'ซ่อมเสร็จ';
  const readySince = thaiShortYearDate(row.readyAt ?? null) ?? '';

  return {
    caseNumber: row.caseNumber,
    branchName: row.branch.name,
    deviceName,
    symptom: trim120(row.symptom),
    entitlementLine,
    nextLine,
    readyLine,
    costLine,
    deviceLine,
    warrantyLines,
    readyKind,
    readySince,
    liffLine,
  };
}
