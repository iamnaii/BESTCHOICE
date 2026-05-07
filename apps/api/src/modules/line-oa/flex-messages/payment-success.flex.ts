import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createProgressBar,
  createButton,
} from './style-d';

export interface PaymentSuccessData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountPaid: number;
  paymentMethod: string;
  paidDate: string;
  remainingInstallments: number;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
  PROMPTPAY: 'พร้อมเพย์',
};

export function buildPaymentSuccessFlex(data: PaymentSuccessData): FlexMessagePayload {
  const methodLabel = PAYMENT_METHOD_LABELS[data.paymentMethod] || data.paymentMethod;
  const isComplete = data.remainingInstallments === 0;

  const rows = [
    createRow('ช่องทาง', methodLabel),
    createRow('วันที่', data.paidDate),
  ];
  if (!isComplete) {
    rows.push(createRow('งวดคงเหลือ', `${data.remainingInstallments} งวด`));
  }

  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Paid',
    section: {
      label: 'ชำระเงินสำเร็จ · ขอบคุณค่ะ',
      headline: `งวดที่ ${data.installmentNo} / ${data.totalInstallments}`,
      subtle: data.contractNumber,
    },
    body: [
      createHeroAmount('success', formatBaht(data.amountPaid), {
        cap: 'ชำระแล้ว',
        pill: { text: `✓ ${methodLabel}`, role: 'success' },
      }),
      createProgressBar(data.installmentNo, data.totalInstallments, 'success'),
      createRowsBlock(rows),
    ],
    buttons: [
      createButton(
        'ดูใบเสร็จ',
        { type: 'postback', label: 'ดูใบเสร็จ', data: `action=view_receipt&contract=${data.contractNumber}&installment=${data.installmentNo}` },
        'success',
      ),
      createButton(
        'ดูสัญญา',
        { type: 'postback', label: 'ดูสัญญา', data: `action=check_installments&contract=${data.contractNumber}` },
        'outline',
      ),
    ],
  });

  return wrapFlexMessage(
    `ชำระเงินสำเร็จ: งวดที่ ${data.installmentNo} จำนวน ${formatBaht(data.amountPaid)}`,
    bubble,
  );
}
