import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
} from './base-template';
import { STYLE_C, createStyleCHeader } from './style-c';
import { ICONS } from './icons';

export interface ReceiptHistoryData {
  customerName: string;
  contracts: {
    contractNumber: string;
    payments: { installmentNo: number; amountPaid: number; paidDate: string }[];
    remainingCount: number;
  }[];
}

export function buildReceiptHistory(data: ReceiptHistoryData): FlexMessagePayload {
  const bubbles: FlexBubble[] = data.contracts.map((contract) => {
    const paymentRows: FlexComponent[] = contract.payments.map((p) => ({
      type: 'box' as const,
      layout: 'horizontal' as const,
      contents: [
        {
          type: 'text' as const,
          text: `งวด ${p.installmentNo}`,
          size: 'sm',
          color: STYLE_C.TEXT.PRIMARY,
          flex: 0,
        },
        {
          type: 'text' as const,
          text: p.paidDate,
          size: 'xs',
          color: STYLE_C.TEXT.MUTED,
          align: 'center' as const,
          flex: 1,
        },
        {
          type: 'text' as const,
          text: `${p.amountPaid.toLocaleString()} ฿`,
          size: 'sm',
          color: STYLE_C.BUTTON.GREEN,
          weight: 'bold' as const,
          align: 'end' as const,
          flex: 0,
        },
      ],
      justifyContent: 'space-between',
      margin: 'md',
      paddingAll: '8px',
      backgroundColor: STYLE_C.INFO_CARD_BG.DEFAULT,
      cornerRadius: '8px',
    }));

    const bodyContents: FlexComponent[] = [
      ...paymentRows,
      { type: 'separator' as const, margin: 'lg', color: '#e2e8f0' },
      // Remaining count summary
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: 'งวดที่เหลือ',
            size: 'xs',
            color: STYLE_C.TEXT.SECONDARY,
            flex: 1,
          },
          {
            type: 'text',
            text: `${contract.remainingCount} งวด`,
            size: 'xs',
            color: STYLE_C.TEXT.PRIMARY,
            weight: 'bold',
            align: 'end',
            flex: 0,
          },
        ],
        justifyContent: 'space-between',
        margin: 'sm',
      },
    ];

    return {
      type: 'bubble',
      size: 'mega',
      header: createStyleCHeader(
        ICONS.LIST,
        'ประวัติการชำระ',
        `สัญญา ${contract.contractNumber}`,
        STYLE_C.GRADIENT.GREEN,
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '20px',
        spacing: 'sm',
      },
    };
  });

  if (bubbles.length === 1) {
    return {
      type: 'flex',
      altText: `ประวัติการชำระ - ${data.customerName}`,
      contents: bubbles[0],
    };
  }

  return {
    type: 'flex',
    altText: `ประวัติการชำระ - ${data.customerName}`,
    contents: { type: 'carousel', contents: bubbles },
  };
}
