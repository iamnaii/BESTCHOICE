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
        savingsBadge: 'ส่วนลดพิเศษ 50%',
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
