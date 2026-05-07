import { FlexMessagePayload } from './base-template';
import {
  buildPremiumBubble,
  createButton,
} from './style-d';

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
  const buttons = contracts.map((c) =>
    createButton(
      `${c.contractNumber} (${c.totalOutstanding.toLocaleString()} ฿)`,
      { type: 'postback', label: c.contractNumber, data: `action=${action}&contract=${c.contractNumber}` },
      c.status === 'OVERDUE' ? 'danger' : 'primary',
    ),
  );

  const bubble = buildPremiumBubble({
    role: 'brand',
    tag: 'Select Contract',
    section: {
      label: 'เลือกสัญญา',
      headline: `คุณ${customerName}`,
      subtle: 'กรุณาเลือกสัญญาที่ต้องการ',
    },
    body: [],
    buttons,
  });

  return {
    type: 'flex',
    altText: `เลือกสัญญา - ${customerName}`,
    contents: bubble,
  };
}
