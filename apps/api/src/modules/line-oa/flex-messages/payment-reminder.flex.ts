import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createProgressBar,
  createButton,
  type Role,
} from './style-d';

export interface PaymentReminderData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountDue: number;
  dueDate: string;
  daysUntilDue: number;
  paymentUrl?: string;
}

export function buildPaymentReminderFlex(data: PaymentReminderData): FlexMessagePayload {
  const isToday = data.daysUntilDue === 0;
  const isUrgent = data.daysUntilDue <= 1;

  const role: Role = isToday ? 'warn' : isUrgent ? 'warn' : 'info';
  const tag = isToday ? 'Urgent Today' : isUrgent ? 'Tomorrow' : 'Reminder';

  const dueLabel = isToday
    ? `ครบวันนี้ · ${data.dueDate}`
    : data.daysUntilDue === 1
    ? `ครบพรุ่งนี้ · ${data.dueDate}`
    : `ครบกำหนด อีก ${data.daysUntilDue} วัน · ${data.dueDate}`;

  const primaryAction = data.paymentUrl
    ? ({ type: 'uri' as const, label: 'ชำระเลย', uri: data.paymentUrl })
    : ({ type: 'postback' as const, label: 'ชำระเลย', data: `action=pay&contract=${data.contractNumber}` });

  const bubble = buildPremiumBubble({
    role,
    tag,
    section: {
      label: isToday ? 'วันนี้ครบกำหนดชำระ' : 'เตือนชำระงวดถัดไป',
      headline: `งวดที่ ${data.installmentNo} / ${data.totalInstallments}`,
    },
    body: [
      createHeroAmount(role, formatBaht(data.amountDue), {
        cap: 'ยอดที่ต้องชำระ',
        pill: { text: dueLabel, role },
      }),
      createProgressBar(data.installmentNo - 1, data.totalInstallments, 'brand'),
      createRowsBlock([
        createRow('สัญญา', data.contractNumber),
        createRow('ครบกำหนด', data.dueDate),
      ]),
    ],
    buttons: [
      createButton('ชำระเลย', primaryAction, isUrgent ? 'warn' : 'primary'),
      createButton(
        'ดูรายละเอียด',
        { type: 'postback', label: 'รายละเอียด', data: `action=check_installments&contract=${data.contractNumber}` },
        'outline',
      ),
    ],
  });

  return wrapFlexMessage(
    `แจ้งเตือน: ค่างวดที่ ${data.installmentNo} จำนวน ${formatBaht(data.amountDue)} ครบกำหนด ${data.dueDate}`,
    bubble,
  );
}
