import { formatDateShort } from '../../../utils/thai-date.util';
import { FlexMessagePayload, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createButton,
  type Role,
} from './style-d';

export interface ReceiptData {
  receiptNumber: string;
  receiptType: string;
  payerName: string;
  amount: number;
  installmentNo?: number;
  remainingBalance?: number;
  remainingMonths?: number;
  paymentMethod?: string;
  paidDate: string;
  productName?: string;
  contractNumber?: string;
  verifyUrl: string;
}

const typeLabels: Record<string, string> = {
  PAYMENT: 'ใบเสร็จรับเงิน',
  DOWN_PAYMENT: 'ใบเสร็จเงินดาวน์',
  EARLY_PAYOFF: 'ใบเสร็จปิดยอด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  PROMPTPAY: 'พร้อมเพย์',
};

export function buildReceiptMessage(data: ReceiptData): FlexMessagePayload {
  const isCreditNote = data.receiptType === 'CREDIT_NOTE';
  const isPayoff = data.receiptType === 'EARLY_PAYOFF';
  const role: Role = isCreditNote ? 'warn' : isPayoff ? 'payoff' : 'success';
  const tag = isCreditNote ? 'Credit Note' : isPayoff ? 'Payoff Receipt' : 'Receipt';
  const headlineLabel = typeLabels[data.receiptType] || 'ใบเสร็จ';

  const rows = [createRow('เลขใบเสร็จ', data.receiptNumber)];
  if (data.productName) rows.push(createRow('สินค้า', data.productName));
  if (data.contractNumber) rows.push(createRow('สัญญา', data.contractNumber));
  rows.push(createRow('ผู้ชำระ', data.payerName));
  rows.push(createRow('วันที่', formatDateShort(data.paidDate)));
  if (data.paymentMethod) rows.push(createRow('วิธีชำระ', methodLabels[data.paymentMethod] || data.paymentMethod));
  if (data.installmentNo) rows.push(createRow('งวดที่', data.installmentNo.toString()));

  const body = [
    createHeroAmount(role, formatBaht(data.amount), {
      cap: 'จำนวนที่ชำระ',
    }),
    createRowsBlock(rows),
  ];

  if (data.remainingBalance != null && data.remainingBalance > 0) {
    body.push(
      createRowsBlock([
        createRow('ยอดคงเหลือ', formatBaht(data.remainingBalance), { valueColor: '#b45309' }),
        ...(data.remainingMonths != null ? [createRow('งวดคงเหลือ', `${data.remainingMonths} งวด`)] : []),
      ]),
    );
  }

  const bubble = buildPremiumBubble({
    role,
    tag,
    section: {
      label: headlineLabel,
      headline: data.receiptNumber,
    },
    body,
    buttons: [
      createButton('ตรวจสอบใบเสร็จ', { type: 'uri', label: 'ตรวจสอบใบเสร็จ', uri: data.verifyUrl }, role),
    ],
  });

  return {
    type: 'flex',
    altText: `${headlineLabel} #${data.receiptNumber}`,
    contents: bubble,
  };
}
