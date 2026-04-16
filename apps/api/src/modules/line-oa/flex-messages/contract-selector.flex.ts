import { FlexMessagePayload, FlexComponent, COLORS } from './base-template';
import { STYLE_C, createStyleCHeader } from './style-c';
import { ICONS } from './icons';

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
    color: c.status === 'OVERDUE' ? COLORS.DANGER : STYLE_C.BUTTON.GREEN,
    height: 'sm' as const,
    margin: 'sm',
  }));

  return {
    type: 'flex',
    altText: `เลือกสัญญา - ${customerName}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: createStyleCHeader(
        ICONS.FILE_TEXT,
        'เลือกสัญญา',
        `คุณ${customerName}`,
        STYLE_C.GRADIENT.GREEN,
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text' as const,
            text: 'กรุณาเลือกสัญญาที่ต้องการ',
            size: 'sm',
            color: STYLE_C.TEXT.SECONDARY,
            margin: 'md',
          },
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
