import { Prisma, EquityTxnType } from '@prisma/client';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

/** รหัสบัญชีที่ builder ใช้ — ทุกตัวมีอยู่ใน finance-coa.csv แล้ว (11-1310 เพิ่ม Task 1) */
export const EQ_ACCOUNTS = {
  UNPAID_CAPITAL: '11-1310',
  WHT_DIVIDEND: '21-3104',
  DIVIDEND_PAYABLE: '21-4104',
  DIRECTOR_DRAWING: '22-1102',
  COMMON_STOCK: '31-1101',
  SHARE_PREMIUM: '31-1102',
  RETAINED_EARNINGS: '32-1101',
} as const;

/** ประเภทที่ต้องมีมติที่ประชุม + แนบไฟล์ (V_RESOLUTION + V8) */
export const NEEDS_RESOLUTION: EquityTxnType[] = [
  'CAP_INIT',
  'CAP_INC',
  'CAP_DEC',
  'DIV_DEC',
  'PRIOR_ADJ',
];
/** ประเภทที่ต้องเลือกช่องทางเงินสด/ธนาคาร */
export const NEEDS_PAYMENT: EquityTxnType[] = ['CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_PAY'];
/** ประเภทที่ต้องมีบรรทัดผู้ถือหุ้น ≥1 */
export const NEEDS_SHAREHOLDERS: EquityTxnType[] = [
  'CAP_INIT',
  'CAP_INC',
  'CAP_DEC',
  'DRAW',
  'DIV_DEC',
  'DIV_PAY',
];

export type PaDirection = 'DR_OTHER_CR_RE' | 'DR_RE_CR_OTHER';

export interface EquityBuilderLine {
  amount: Dec;
  premium: Dec;
  paid: Dec;
  wht: Dec;
}

export interface EquityBuilderInput {
  txnType: EquityTxnType;
  paymentAccountCode?: string | null;
  paAccountCode?: string | null;
  paAmount?: Dec | null;
  paDirection?: PaDirection | null;
  lines: EquityBuilderLine[];
}

export interface EquityJeLine {
  accountCode: string;
  dr: Dec;
  cr: Dec;
  description: string;
}

function totals(lines: EquityBuilderLine[]) {
  return lines.reduce(
    (t, l) => ({
      amount: t.amount.plus(l.amount),
      premium: t.premium.plus(l.premium),
      paid: t.paid.plus(l.paid),
      wht: t.wht.plus(l.wht),
    }),
    { amount: ZERO, premium: ZERO, paid: ZERO, wht: ZERO },
  );
}

/**
 * สร้าง JE lines จากเอกสาร equity — pure function, balanced โดยโครงสร้างทุกประเภท
 * (JournalAutoService ยังเช็ค Dr=Cr ซ้ำอีกชั้นตอนโพสต์). ตัวเลข golden: Handover §8.
 * ผู้เรียกต้อง validate field ครบก่อน (equity-validation.util) — builder โยนเฉพาะ
 * กรณีข้อมูลขาดจนประกอบ JE ไม่ได้
 */
export function buildEquityJournal(input: EquityBuilderInput): EquityJeLine[] {
  const t = totals(input.lines);
  const pay = input.paymentAccountCode ?? null;
  const lines: EquityJeLine[] = [];

  switch (input.txnType) {
    case 'CAP_INIT': {
      if (!pay) throw new Error('CAP_INIT ต้องมี paymentAccountCode');
      const unpaid = t.amount.minus(t.paid);
      if (unpaid.lt(0)) {
        throw new Error(
          `ยอดชำระรวม (${t.paid.toFixed(2)}) เกินมูลค่าหุ้นที่จองรวม (${t.amount.toFixed(2)}) — CAP_INIT`,
        );
      }
      if (t.paid.gt(0))
        lines.push({
          accountCode: pay,
          dr: t.paid,
          cr: ZERO,
          description: 'รับเงินลงทุนตั้งบริษัท (ชำระจริง)',
        });
      if (unpaid.gt(0))
        lines.push({
          accountCode: EQ_ACCOUNTS.UNPAID_CAPITAL,
          dr: unpaid,
          cr: ZERO,
          description: 'ค่าหุ้นค้างชำระ',
        });
      lines.push({
        accountCode: EQ_ACCOUNTS.COMMON_STOCK,
        dr: ZERO,
        cr: t.amount,
        description: 'ทุนจดทะเบียน (par)',
      });
      break;
    }
    case 'CAP_INC': {
      if (!pay) throw new Error('CAP_INC ต้องมี paymentAccountCode');
      lines.push({
        accountCode: pay,
        dr: t.amount.plus(t.premium),
        cr: ZERO,
        description: 'รับเงินเพิ่มทุน',
      });
      lines.push({
        accountCode: EQ_ACCOUNTS.COMMON_STOCK,
        dr: ZERO,
        cr: t.amount,
        description: 'เพิ่มหุ้นสามัญ (par)',
      });
      if (t.premium.gt(0))
        lines.push({
          accountCode: EQ_ACCOUNTS.SHARE_PREMIUM,
          dr: ZERO,
          cr: t.premium,
          description: 'ส่วนเกินมูลค่าหุ้น',
        });
      break;
    }
    case 'CAP_DEC': {
      if (!pay) throw new Error('CAP_DEC ต้องมี paymentAccountCode');
      lines.push({
        accountCode: EQ_ACCOUNTS.COMMON_STOCK,
        dr: t.amount,
        cr: ZERO,
        description: 'ลดหุ้นสามัญ',
      });
      lines.push({ accountCode: pay, dr: ZERO, cr: t.amount, description: 'จ่ายคืนเงินทุน' });
      break;
    }
    case 'DRAW': {
      if (!pay) throw new Error('DRAW ต้องมี paymentAccountCode');
      lines.push({
        accountCode: EQ_ACCOUNTS.DIRECTOR_DRAWING,
        dr: t.amount,
        cr: ZERO,
        description: 'กรรมการถอนเงิน (เงินทดรองจ่ายกรรมการ)',
      });
      lines.push({ accountCode: pay, dr: ZERO, cr: t.amount, description: 'จ่ายให้กรรมการ' });
      break;
    }
    case 'DIV_DEC': {
      lines.push({
        accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS,
        dr: t.amount,
        cr: ZERO,
        description: 'ประกาศจ่ายปันผลจากกำไรสะสม (TAS 10)',
      });
      lines.push({
        accountCode: EQ_ACCOUNTS.DIVIDEND_PAYABLE,
        dr: ZERO,
        cr: t.amount,
        description: `เงินปันผลค้างจ่าย (${input.lines.length} ราย)`,
      });
      break;
    }
    case 'DIV_PAY': {
      if (!pay) throw new Error('DIV_PAY ต้องมี paymentAccountCode');
      const net = t.amount.minus(t.wht);
      lines.push({
        accountCode: EQ_ACCOUNTS.DIVIDEND_PAYABLE,
        dr: t.amount,
        cr: ZERO,
        description: `ตัดเงินปันผลค้างจ่าย (${input.lines.length} ราย)`,
      });
      lines.push({ accountCode: pay, dr: ZERO, cr: net, description: 'จ่ายเงินปันผลสุทธิ' });
      if (t.wht.gt(0))
        lines.push({
          accountCode: EQ_ACCOUNTS.WHT_DIVIDEND,
          dr: ZERO,
          cr: t.wht,
          description: 'ภ.ง.ด.2 ค้างจ่าย (WHT ปันผล 10%)',
        });
      break;
    }
    case 'PRIOR_ADJ': {
      const amt = input.paAmount ?? ZERO;
      const acc = input.paAccountCode;
      if (!acc || amt.lte(0) || !input.paDirection)
        throw new Error('PRIOR_ADJ ต้องมี paAccountCode + paAmount + paDirection');
      if (input.paDirection === 'DR_OTHER_CR_RE') {
        lines.push({
          accountCode: acc,
          dr: amt,
          cr: ZERO,
          description: 'ปรับปรุงงบย้อนหลัง (TAS 8)',
        });
        lines.push({
          accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS,
          dr: ZERO,
          cr: amt,
          description: 'ปรับปรุงกำไรสะสม',
        });
      } else {
        lines.push({
          accountCode: EQ_ACCOUNTS.RETAINED_EARNINGS,
          dr: amt,
          cr: ZERO,
          description: 'ปรับปรุงกำไรสะสม',
        });
        lines.push({
          accountCode: acc,
          dr: ZERO,
          cr: amt,
          description: 'ปรับปรุงงบย้อนหลัง (TAS 8)',
        });
      }
      break;
    }
  }
  return lines;
}
