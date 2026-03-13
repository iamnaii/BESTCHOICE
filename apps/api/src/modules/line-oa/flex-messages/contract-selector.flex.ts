import {
  FlexMessagePayload,
  FlexComponent,
  COLORS,
  createHeader,
} from './base-template';

export interface ContractOption {
  contractNumber: string;
  status: string;
  totalOutstanding: number;
}

export function buildContractSelector(
  customerName: string,
  contracts: ContractOption[],
  action: string,
): FlexMessagePayload {
  const buttons: FlexComponent[] = contracts.map((c) => ({
    type: 'button' as const,
    action: {
      type: 'postback' as const,
      label: `${c.contractNumber} (${c.totalOutstanding.toLocaleString()} ฿)`,
      data: `action=${action}&contract=${c.contractNumber}`,
    },
    style: 'primary' as const,
    color: c.status === 'OVERDUE' ? COLORS.DANGER : COLORS.PRIMARY,
    height: 'sm' as const,
    margin: 'sm',
  }));

  return {
    type: 'flex',
    altText: `เลือกสัญญา - ${customerName}`,
    contents: {
      type: 'bubble',
      header: createHeader('เลือกสัญญา', `คุณ${customerName}`, COLORS.INFO),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text' as const, text: 'กรุณาเลือกสัญญาที่ต้องการ', size: 'sm', color: COLORS.MUTED, margin: 'md' },
        ],
        paddingAll: '20px',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: buttons,
        spacing: 'sm',
        paddingAll: '15px',
      },
    },
  };
}
