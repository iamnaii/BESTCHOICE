import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createButton,
} from './style-d';

export interface EarlyPayoffSuccessFlexData {
  customerName: string;
  contractNumber: string;
  amountPaid: number;
  originalAmount: number;
  savings: number;
  payoffDate: string;
  /** Actual early-payoff interest-discount percent (0..50). When omitted, the
   *  "ส่วนลดพิเศษ X%" badge is hidden — never claim a fixed 50%. */
  discountPercent?: number;
  receiptUrl?: string;
  branchPickupHint?: string;
}

/**
 * "ปิดยอดสำเร็จ" — Style D Premium Thai. Hero highlights *savings*
 * (success green) — reinforces "you got a deal" framing from LiffEarlyPayoff.
 */
export function buildEarlyPayoffSuccessFlex(data: EarlyPayoffSuccessFlexData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Payoff Success',
    section: {
      label: 'ปิดสัญญาก่อนกำหนดสำเร็จ',
      headline: `ขอบคุณคุณ${data.customerName}`,
      subtle: data.branchPickupHint,
    },
    body: [
      createHeroAmount('success', formatBaht(data.savings), {
        cap: 'ประหยัดไปทั้งหมด',
        // Only show the discount badge when the real percent is known — the
        // early-payoff discount is configurable (0..50), so a hardcoded "50%"
        // lied to customers who got a different rate.
        savingsBadge:
          data.discountPercent != null ? `ส่วนลดพิเศษ ${data.discountPercent}%` : undefined,
      }),
      createRowsBlock([
        createRow('ยอดที่ชำระ', formatBaht(data.amountPaid)),
        createRow('ยอดเต็มเดิม', formatBaht(data.originalAmount), {
          valueColor: '#94a3b8',
          valueDecoration: 'line-through',
        }),
        createRow('สัญญา', data.contractNumber),
        createRow('ปิดเมื่อ', data.payoffDate),
      ]),
    ],
    buttons: [
      createButton(
        'ดาวน์โหลดใบเสร็จ',
        data.receiptUrl
          ? { type: 'uri', label: 'ดาวน์โหลดใบเสร็จ', uri: data.receiptUrl }
          : { type: 'postback', label: 'ดาวน์โหลดใบเสร็จ', data: `action=download_receipt&contract=${data.contractNumber}` },
        'success',
      ),
      createButton(
        'ติดต่อรับเครื่อง',
        { type: 'postback', label: 'ติดต่อรับเครื่อง', data: `action=pickup&contract=${data.contractNumber}` },
        'outline',
      ),
    ],
  });

  return wrapFlexMessage(
    `ปิดยอดสัญญา ${data.contractNumber} สำเร็จ · ประหยัดไป ${formatBaht(data.savings)}`,
    bubble,
  );
}
