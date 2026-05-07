import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createButton,
} from './style-d';

export interface OverdueNoticeData {
  customerName: string;
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amountDue: number;
  lateFee: number;
  totalOutstanding: number;
  dueDate: string;
  daysOverdue: number;
}

export function buildOverdueNoticeFlex(data: OverdueNoticeData): FlexMessagePayload {
  const rows = [
    createRow('สัญญา', data.contractNumber),
    createRow('งวดที่', `${data.installmentNo} / ${data.totalInstallments}`),
    createRow('ครบกำหนดชำระ', data.dueDate),
    createRow('ยอดต้น', formatBaht(data.amountDue)),
  ];
  if (data.lateFee > 0) {
    rows.push(createRow('ค่าปรับ', `+${formatBaht(data.lateFee)}`, { valueColor: '#dc2626' }));
  }

  const bubble = buildPremiumBubble({
    role: 'danger',
    tag: `Overdue ${data.daysOverdue}d`,
    section: {
      label: 'ค้างชำระเกินกำหนด',
      headline: `งวดที่ ${data.installmentNo} · เกินกำหนด ${data.daysOverdue} วัน`,
      subtle: `คุณ${data.customerName}`,
    },
    body: [
      createHeroAmount('danger', formatBaht(data.totalOutstanding), {
        cap: 'ยอดรวมที่ต้องชำระ',
        pill: { text: 'กรุณาชำระภายในวันนี้', role: 'danger' },
      }),
      createRowsBlock(rows),
    ],
    buttons: [
      createButton(
        'ชำระเงินทันที',
        { type: 'postback', label: 'ชำระเงินทันที', data: `action=pay&contract=${data.contractNumber}` },
        'danger',
      ),
      createButton(
        'ติดต่อเจ้าหน้าที่',
        { type: 'postback', label: 'ติดต่อเจ้าหน้าที่', data: `action=contact_staff&contract=${data.contractNumber}` },
        'outline',
      ),
    ],
  });

  return wrapFlexMessage(
    `แจ้งค้างชำระ: งวดที่ ${data.installmentNo} ยอด ${formatBaht(data.totalOutstanding)} เลยกำหนด ${data.daysOverdue} วัน`,
    bubble,
  );
}
