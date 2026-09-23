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
const PAYER: Record<WarrantyStatus, OutcomeOption['payerDefault']> = {
  IN_7DAY_DEFECT: 'SHOP',
  IN_SHOP_WARRANTY: 'SHOP',
  IN_MANUFACTURER: 'SUPPLIER_CLAIM',
  OUT_OF_WARRANTY: 'CUSTOMER',
  WALK_IN: 'CUSTOMER',
};

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
  const sameModel: OutcomeOption = i.defectEligible
    ? {
        outcome: 'SAME_MODEL_EXCHANGE',
        enabled: true,
        implemented: false,
        note: 'ผจก.สาขา ต้องยืนยัน',
      }
    : managerUp
      ? {
          outcome: 'SAME_MODEL_EXCHANGE',
          enabled: true,
          implemented: false,
          note: 'ข้ามกรอบ 7 วัน — ผจก. ต้องยืนยัน',
        }
      : {
          outcome: 'SAME_MODEL_EXCHANGE',
          enabled: false,
          implemented: false,
          reason: i.defectReasons[0] ?? 'ไม่เข้าเงื่อนไขเปลี่ยนรุ่นเดิม',
        };

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
      implemented: false,
      note: 'มีขั้นอนุมัติตามราคารับซื้อ',
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
