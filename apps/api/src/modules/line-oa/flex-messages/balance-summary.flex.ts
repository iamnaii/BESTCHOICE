import { FlexBubble, FlexCarousel, FlexMessagePayload, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createProgressBar,
  createButton,
  type Role,
} from './style-d';

export interface BalanceSummaryData {
  customerName: string;
  contracts: Array<{
    contractNumber: string;
    totalInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
    nextAmountDue: number;
    totalOutstanding: number;
    status: string;
  }>;
}

export function buildBalanceSummaryFlex(data: BalanceSummaryData): FlexMessagePayload {
  if (data.contracts.length === 1) {
    const c = data.contracts[0];
    return {
      type: 'flex',
      altText: `สรุปยอด: สัญญา ${c.contractNumber} ยอดค้าง ${formatBaht(c.totalOutstanding)}`,
      contents: buildContractBubble(c),
    };
  }

  const bubbles = data.contracts.slice(0, 10).map((c) => buildContractBubble(c));
  return {
    type: 'flex',
    altText: `สรุปยอด: คุณ${data.customerName} ${data.contracts.length} สัญญา`,
    contents: { type: 'carousel', contents: bubbles } as FlexCarousel,
  };
}

function buildContractBubble(c: BalanceSummaryData['contracts'][number]): FlexBubble {
  const isOverdue = c.status === 'OVERDUE' || c.status === 'DEFAULT';
  const role: Role = isOverdue ? 'danger' : 'info';
  const tag = isOverdue ? 'Overdue' : 'Balance';

  return buildPremiumBubble({
    role,
    tag,
    section: {
      label: 'ยอดคงเหลือทั้งหมด',
      headline: c.contractNumber,
    },
    body: [
      createHeroAmount(role, formatBaht(c.totalOutstanding), {
        cap: 'ยอดคงเหลือ',
      }),
      createProgressBar(c.paidInstallments, c.totalInstallments, isOverdue ? 'danger' : 'info'),
      createRowsBlock([
        createRow('ชำระแล้ว', `${c.paidInstallments} / ${c.totalInstallments} งวด`),
        createRow('งวดถัดไป', c.nextDueDate ? `${formatBaht(c.nextAmountDue)} · ${c.nextDueDate}` : '-'),
      ]),
    ],
    buttons: [
      createButton(
        'ดูรายละเอียดสัญญา',
        { type: 'postback', label: 'ดูรายละเอียดสัญญา', data: `action=check_installments&contract=${c.contractNumber}` },
        'primary',
      ),
    ],
  });
}
