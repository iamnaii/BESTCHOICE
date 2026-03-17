import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  createHeader,
  createDetailRow,
  wrapFlexMessage,
} from './base-template';

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
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createHeader(
      'เซ็นสัญญาเรียบร้อย',
      `สัญญา ${data.contractNumber}`,
      COLORS.PRIMARY,
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Checkmark
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '✓',
              size: 'xxl',
              color: COLORS.PRIMARY,
              align: 'center',
              weight: 'bold',
            },
            {
              type: 'text',
              text: 'เซ็นสัญญาเรียบร้อยแล้ว',
              size: 'md',
              color: COLORS.DARK,
              align: 'center',
              weight: 'bold',
              margin: 'sm',
            },
          ],
          paddingBottom: 'lg',
        },
        // Separator
        { type: 'separator', color: COLORS.LIGHT_BG },
        // Details
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            createDetailRow('ลูกค้า', data.customerName),
            createDetailRow('สินค้า', data.productName),
            createDetailRow('ผ่อนชำระ', `${data.totalMonths} งวด x ${data.monthlyPayment.toLocaleString()} บาท`),
            createDetailRow('วันที่เซ็น', data.signedAt),
          ],
          paddingTop: 'lg',
          spacing: 'sm',
        },
      ],
      paddingAll: 'lg',
    },
    footer: data.downloadUrl
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'uri',
                label: 'ดาวน์โหลดสัญญา PDF',
                uri: data.downloadUrl,
              },
              style: 'primary',
              color: COLORS.PRIMARY,
            },
          ],
          paddingAll: 'md',
        }
      : undefined,
  };

  return wrapFlexMessage(`เซ็นสัญญา ${data.contractNumber} เรียบร้อย`, bubble);
}
