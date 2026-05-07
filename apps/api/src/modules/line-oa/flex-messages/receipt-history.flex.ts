import { FlexBubble, FlexMessagePayload } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
} from './style-d';

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
    const paymentRows = contract.payments.map((p) =>
      createRow(`งวด ${p.installmentNo} · ${p.paidDate}`, `${p.amountPaid.toLocaleString()} ฿`, {
        valueColor: '#047857',
      }),
    );
    paymentRows.push(createRow('งวดที่เหลือ', `${contract.remainingCount} งวด`));

    return buildPremiumBubble({
      role: 'success',
      tag: 'Payment History',
      section: {
        label: 'ประวัติการชำระ',
        headline: contract.contractNumber,
        subtle: `รวม ${contract.payments.length} งวดที่ชำระแล้ว`,
      },
      body: [createRowsBlock(paymentRows)],
    });
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
