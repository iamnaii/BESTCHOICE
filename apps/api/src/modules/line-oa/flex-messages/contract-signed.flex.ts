import {
  FlexBubble,
  FlexMessagePayload,
  COLORS,
  GRADIENTS,
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
    header: createHeader('📝 เซ็นสัญญาเรียบร้อย', `สัญญา ${data.contractNumber}`, GRADIENTS.GREEN),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Success icon
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '✓',
              size: '3xl',
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
          backgroundColor: COLORS.SUCCESS_LIGHT,
          cornerRadius: '12px',
          paddingAll: '16px',
        },
        { type: 'separator', margin: 'lg', color: COLORS.BORDER },
        createDetailRow('ลูกค้า', data.customerName),
        createDetailRow('สินค้า', data.productName),
        createDetailRow('ผ่อนชำระ', `${data.totalMonths} งวด x ฿${data.monthlyPayment.toLocaleString()}`),
        createDetailRow('วันที่เซ็น', data.signedAt),
        {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '💡 ชำระค่างวดตรงเวลาทุกเดือน สะสมแต้มแลกส่วนลดดาวน์เครื่องใหม่',
              size: 'xs',
              color: COLORS.PRIMARY,
              wrap: true,
            },
          ],
          backgroundColor: COLORS.SUCCESS_LIGHT,
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'xl',
        },
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: data.downloadUrl
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: { type: 'uri', label: '📄 ดาวน์โหลดสัญญา PDF', uri: data.downloadUrl },
              style: 'primary',
              color: COLORS.PRIMARY,
            },
          ],
          paddingAll: '12px',
        }
      : undefined,
  };

  return wrapFlexMessage(`เซ็นสัญญา ${data.contractNumber} เรียบร้อย`, bubble);
}
