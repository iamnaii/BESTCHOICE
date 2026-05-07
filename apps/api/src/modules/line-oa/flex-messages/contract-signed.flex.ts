import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
  createButton,
  createProgressBar,
} from './style-d';

export interface ContractSignedData {
  customerName: string;
  contractNumber: string;
  productName: string;
  totalMonths: number;
  monthlyPayment: number;
  signedAt: string;
  downloadUrl?: string;
}

export function buildContractSignedFlex(data: ContractSignedData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Contract Signed',
    section: {
      label: 'เซ็นสัญญาเรียบร้อย',
      headline: data.contractNumber,
      subtle: data.productName,
      pill: { text: '✓ ลงนามแล้ว · พร้อมรับเครื่อง', role: 'success' },
    },
    body: [
      createRowsBlock([
        createRow('ลูกค้า', data.customerName),
        createRow('ค่างวด', `${formatBaht(data.monthlyPayment)} / เดือน`),
        createRow('จำนวนงวด', `${data.totalMonths} งวด`),
        createRow('วันที่เซ็น', data.signedAt),
      ]),
      createProgressBar(0, data.totalMonths, 'success', { rightLabel: '0 / ' + data.totalMonths + ' งวด' }),
    ],
    buttons: data.downloadUrl
      ? [createButton('ดาวน์โหลดสัญญา PDF', { type: 'uri', label: 'ดาวน์โหลดสัญญา PDF', uri: data.downloadUrl }, 'success')]
      : undefined,
  });

  return wrapFlexMessage(`เซ็นสัญญา ${data.contractNumber} เรียบร้อย`, bubble);
}
