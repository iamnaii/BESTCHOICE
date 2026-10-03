import type { AfterSalesOutcome, AfterSalesSource, WarrantyStatus } from '@prisma/client';

export interface OutcomeInput {
  source: AfterSalesSource;
  warrantyStatus: WarrantyStatus;
  daysRemainingIn7Day: number;
  contractStatus?: string;
  defectEligible: boolean; // จาก DefectExchangeService.checkEligibility(...).eligible
  defectReasons: string[]; // ...reasons
  viewerRole: string;
}

export interface OutcomeOption {
  outcome: AfterSalesOutcome;
  enabled: boolean;
  implemented: boolean; // PR 1: เฉพาะ REPAIR
  reason?: string; // ทำไมปิด (แสดงใต้ปุ่ม)
  note?: string; // เงื่อนไขเพิ่มเมื่อเปิด
  payerDefault?: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
}

const MANAGER_UP = new Set(['BRANCH_MANAGER', 'OWNER']);

/**
 * I1 (final fix wave) — เหตุผล "พ้นกรอบ 7 วัน" ของ `DefectExchangeService.checkEligibility`
 * (ข้อความจริง: `พ้นกำหนด 7 วันแล้ว (รับเครื่องเมื่อ …)`). เป็นเหตุผลเดียวที่ ผจก.สาขา/เจ้าของ
 * "ข้าม" ได้ — เหตุผลอื่นทุกข้อ (PHONE_USED, สถานะสัญญา ACTIVE, เครดิตเทิร์น, เครื่องใหม่ไม่พร้อมขาย,
 * รุ่น/ความจุไม่ตรง) ต้องบล็อกเสมอ แม้ engine จะข้าม checkEligibility ทั้งก้อนตอน bypassWindowCheck.
 * ใช้ร่วมกันทั้ง computeOutcomes, AfterSalesCaseService.createCase และ AfterSalesExchangeService.confirmSameModel
 */
export const WINDOW_REASON_RE = /พ้นกำหนด 7 วัน/;

/** M15 — ข้อความ engine มี "(รับเครื่องเมื่อ …)" ซึ่งห้ามขึ้นจอ (กติกาถ้อยคำ) → แปลงเป็นข้อความ UI */
export const WINDOW_REASON_UI = 'พ้นกรอบ 7 วัน — ผจก. ยืนยันได้';
const toUiReason = (r: string) => (WINDOW_REASON_RE.test(r) ? WINDOW_REASON_UI : r);
const PAYER: Record<WarrantyStatus, OutcomeOption['payerDefault']> = {
  IN_7DAY_DEFECT: 'SHOP',
  IN_SHOP_WARRANTY: 'SHOP',
  IN_MANUFACTURER: 'SUPPLIER_CLAIM',
  OUT_OF_WARRANTY: 'CUSTOMER',
  WALK_IN: 'CUSTOMER',
};

/** ค่าเริ่มต้นผู้จ่ายจากสถานะประกัน — ตัวเดียวกับที่ REPAIR branch ของ computeOutcomes() ใช้
 * (`payerDefault` ด้านบน). Export ไว้ให้ `AfterSalesExchangeService.switchToRepair` ใช้ตอน
 * `dto.payer` ไม่ได้ระบุมา แทนที่จะก็อป map นี้ซ้ำ */
export function payerDefaultFor(status: WarrantyStatus): 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM' {
  return PAYER[status] as 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
}

export function computeOutcomes(i: OutcomeInput): OutcomeOption[] {
  const within7 = i.warrantyStatus === 'IN_7DAY_DEFECT' && i.daysRemainingIn7Day > 0;
  const managerUp = MANAGER_UP.has(i.viewerRole);
  const repair: OutcomeOption = {
    outcome: 'REPAIR',
    enabled: true,
    implemented: true,
    payerDefault: PAYER[i.warrantyStatus],
  };
  if (i.source === 'WALK_IN') return [repair];

  if (i.source === 'CASH_SALE') {
    const cash: OutcomeOption = {
      outcome: 'CASH_SAME_MODEL_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: within7 ? 'รอกติกาบัญชี (สเปกข้อ 10)' : 'เกินกรอบ 7 วันแล้ว',
    };
    return [repair, cash];
  }

  // INSTALLMENT_CONTRACT
  // R9: SAME_MODEL_EXCHANGE must respect the same warranty/contract gates as
  // PRICED_EXCHANGE before falling through to defectEligible/managerUp — a
  // BM/OWNER must not be able to enable it on a manufacturer-warranty device
  // or a non-active/overdue contract (spec row "ผ่อน ในประกันศูนย์ → ซ่อม
  // เคลมศูนย์ เท่านั้น").
  let sameModel: OutcomeOption;
  if (i.warrantyStatus === 'IN_MANUFACTURER') {
    sameModel = {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน',
    };
  } else if (i.contractStatus !== 'ACTIVE' && i.contractStatus !== 'OVERDUE') {
    sameModel = {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'สัญญาไม่ได้อยู่ในสถานะเปิดใช้',
    };
  } else if (i.defectEligible) {
    sameModel = {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'ผจก.สาขา ต้องยืนยัน',
    };
  } else if (
    managerUp &&
    i.defectReasons.length === 1 &&
    WINDOW_REASON_RE.test(i.defectReasons[0])
  ) {
    // I1 — ผจก./เจ้าของ ข้ามได้ "เฉพาะกรอบ 7 วัน" เมื่อมันเป็นเหตุผลเดียวที่ไม่ผ่าน
    sameModel = {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
    };
  } else {
    sameModel = {
      outcome: 'SAME_MODEL_EXCHANGE',
      enabled: false,
      implemented: false,
      // I1/M15 — เหตุผลแรกที่ไม่ใช่กรอบ 7 วันสำคัญกว่า (ผจก. ก็ข้ามไม่ได้) · กรอบ 7 วันแปลงเป็นข้อความ UI
      reason: toUiReason(
        i.defectReasons.find((r) => !WINDOW_REASON_RE.test(r)) ??
          i.defectReasons[0] ??
          'ไม่เข้าเงื่อนไขเปลี่ยนรุ่นเดิม',
      ),
    };
  }

  let priced: OutcomeOption;
  if (i.contractStatus !== 'ACTIVE') {
    priced = {
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'สัญญาไม่ได้อยู่ในสถานะเปิดใช้',
    };
  } else if (i.warrantyStatus === 'IN_MANUFACTURER') {
    priced = {
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'อยู่ในประกันศูนย์ — ส่งเคลมก่อน',
    };
  } else if (within7 || managerUp) {
    priced = {
      outcome: 'PRICED_EXCHANGE',
      enabled: true,
      implemented: true,
      note: 'มีขั้นอนุมัติตามราคารับซื้อ',
    };
  } else if (i.warrantyStatus === 'OUT_OF_WARRANTY') {
    // R11: OUT_OF_WARRANTY gets its own disabled reason — distinct from the
    // "still within a warranty window but past 7 days" (IN_SHOP_WARRANTY) case.
    priced = {
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'หมดประกันแล้ว — ผจก.สาขาหรือเจ้าของยื่นได้',
    };
  } else {
    priced = {
      outcome: 'PRICED_EXCHANGE',
      enabled: false,
      implemented: false,
      reason: 'เกินกรอบ 7 วัน — ผจก.สาขาหรือเจ้าของยื่นได้',
    };
  }
  return [repair, sameModel, priced];
}

/** ข้อความขึ้นต้นของ event OUTCOME_SET ตอน "เปลี่ยนใจเป็นซ่อม" (`AfterSalesExchangeService.switchToRepair`)
 * — ผู้เขียนและผู้อ่าน (`dropOffOutcome`) ต้องใช้ค่าคงที่ตัวนี้ตัวเดียว */
export const SWITCHED_TO_REPAIR_NOTE = 'เปลี่ยนเป็น "ซ่อม" แทน';

/**
 * ทางออกที่ตกลงกันตอนรับฝาก — ใบรับฝากที่พิมพ์ซ้ำต้องตรงกับใบที่ลูกค้าเซ็นไว้ ไม่ใช่ทางออกปัจจุบัน.
 * หลังรับฝาก ทางออกเปลี่ยนได้สองทางเท่านั้น:
 *  - `switchToRepair`: เปลี่ยนรุ่นเดิม (รออนุมัติ) → ซ่อม — ทำได้เฉพาะเคสที่ตั้งเปลี่ยนรุ่นเดิมตอนรับฝาก
 *    ⇒ มี event ขึ้นต้น `SWITCHED_TO_REPAIR_NOTE` = รับฝากเป็นเปลี่ยนรุ่นเดิม (ชนะข้อถัดไป)
 *  - `confirmSameModel` จากใบซ่อมที่ซ่อมไม่ได้: ซ่อม → เปลี่ยนรุ่นเดิม — ใบซ่อมของเคสเป็น REPLACED
 */
export function dropOffOutcome(c: {
  outcome: AfterSalesOutcome | null;
  repairTicketStatus: string | null;
  outcomeNotes: (string | null)[];
}): AfterSalesOutcome | null {
  if (c.outcomeNotes.some((n) => n?.startsWith(SWITCHED_TO_REPAIR_NOTE))) {
    return 'SAME_MODEL_EXCHANGE';
  }
  if (c.outcome === 'SAME_MODEL_EXCHANGE' && c.repairTicketStatus === 'REPLACED') return 'REPAIR';
  return c.outcome;
}
