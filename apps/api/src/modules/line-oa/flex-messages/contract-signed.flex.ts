import {
  FlexBubble,
  FlexMessagePayload,
  FlexComponent,
  wrapFlexMessage,
  formatBaht,
} from './base-template';
import {
  STYLE_C,
  createStyleCHeader,
  createStyleCProgress,
  createTipBox,
  createStyleCButtons,
} from './style-c';
import { ICONS } from './icons';

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
  const detailRows: FlexComponent[] = [
    // Info card — contract details
    {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'ลูกค้า',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: data.customerName,
              size: 'xs',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 2,
              wrap: true,
            },
          ],
          justifyContent: 'space-between',
          margin: 'sm',
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'สินค้า',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: data.productName,
              size: 'xs',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 2,
              wrap: true,
            },
          ],
          justifyContent: 'space-between',
          margin: 'sm',
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'ค่างวด',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: `${data.totalMonths} งวด x ${formatBaht(data.monthlyPayment)}`,
              size: 'xs',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 2,
              wrap: true,
            },
          ],
          justifyContent: 'space-between',
          margin: 'sm',
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'วันที่เซ็น',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: data.signedAt,
              size: 'xs',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 2,
            },
          ],
          justifyContent: 'space-between',
          margin: 'sm',
        },
      ],
      backgroundColor: STYLE_C.INFO_CARD_BG.SUCCESS,
      cornerRadius: '12px',
      paddingAll: '16px',
      margin: 'lg',
    } as FlexComponent,
  ];

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.FILE_TEXT,
      'เซ็นสัญญาเรียบร้อย',
      `สัญญา ${data.contractNumber}`,
      STYLE_C.GRADIENT.GREEN,
      { text: 'เปิดสัญญา', bg: STYLE_C.BADGE.SUCCESS.bg, textColor: STYLE_C.BADGE.SUCCESS.text },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        ...detailRows,
        // Progress bar starting at 0%
        createStyleCProgress(0, data.totalMonths, STYLE_C.PROGRESS.GREEN, '0 งวด', '0%'),
        // Tip box
        createTipBox(
          ICONS.INFO_CIRCLE,
          'ชำระค่างวดตรงเวลาทุกเดือน สะสมแต้มแลกส่วนลดดาวน์เครื่องใหม่',
          STYLE_C.INFO_CARD_BG.SUCCESS,
          STYLE_C.BUTTON.GREEN,
        ),
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: data.downloadUrl
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            createStyleCButtons(
              'ดาวน์โหลดสัญญา PDF',
              { type: 'uri', label: 'ดาวน์โหลดสัญญา PDF', uri: data.downloadUrl },
              STYLE_C.BUTTON.GREEN,
            ),
          ],
          paddingAll: '12px',
        }
      : undefined,
  };

  return wrapFlexMessage(`เซ็นสัญญา ${data.contractNumber} เรียบร้อย`, bubble);
}
