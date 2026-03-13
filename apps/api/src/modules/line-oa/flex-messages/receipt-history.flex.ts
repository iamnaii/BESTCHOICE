import {
  FlexMessagePayload,
  FlexBubble,
  FlexComponent,
  COLORS,
  createHeader,
  createDetailRow,
} from './base-template';

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
        { type: 'text' as const, text: `งวด ${p.installmentNo}`, size: 'sm', color: COLORS.DARK, flex: 0 },
        { type: 'text' as const, text: p.paidDate, size: 'xs', color: COLORS.MUTED, align: 'center' as const, flex: 0 },
        { type: 'text' as const, text: `${p.amountPaid.toLocaleString()} ฿`, size: 'sm', color: COLORS.PRIMARY, weight: 'bold', align: 'end' as const, flex: 0 },
      ],
      justifyContent: 'space-between',
      margin: 'md',
    }));

    const bodyContents: FlexComponent[] = [
      ...paymentRows,
      { type: 'separator' as const, margin: 'lg' },
      createDetailRow('งวดที่เหลือ', `${contract.remainingCount} งวด`),
    ];

    return {
      type: 'bubble',
      header: createHeader('ประวัติการชำระ', `สัญญา ${contract.contractNumber}`, COLORS.INFO),
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
    return { type: 'flex', altText: `ประวัติการชำระ - ${data.customerName}`, contents: bubbles[0] };
  }

  return { type: 'flex', altText: `ประวัติการชำระ - ${data.customerName}`, contents: { type: 'carousel', contents: bubbles } };
}
