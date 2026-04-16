import {
  FlexBubble,
  FlexMessagePayload,
  wrapFlexMessage,
} from './base-template';
import { STYLE_C, createStyleCHeader, createInfoCard } from './style-c';
import { ICONS } from './icons';

export interface VerifySuccessData {
  customerName: string;
  contractNumber: string;
  totalInstallments: number;
  monthlyAmount: number;
}

export function buildVerifySuccessFlex(data: VerifySuccessData): FlexMessagePayload {
  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.CHECK_CIRCLE,
      'ลงทะเบียนสำเร็จ!',
      'BESTCHOICE FINANCE',
      STYLE_C.GRADIENT.GREEN,
      { text: '✅ สำเร็จ', bg: STYLE_C.BADGE.SUCCESS.bg, textColor: STYLE_C.BADGE.SUCCESS.text },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        // Customer name detail row
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'ชื่อลูกค้า',
              size: 'sm',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: data.customerName,
              size: 'sm',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 1,
            },
          ],
          justifyContent: 'space-between',
          margin: 'md',
        },
        // Contract number detail row
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: 'เลขสัญญา',
              size: 'sm',
              color: STYLE_C.TEXT.SECONDARY,
              flex: 1,
            },
            {
              type: 'text',
              text: data.contractNumber,
              size: 'sm',
              color: STYLE_C.TEXT.PRIMARY,
              weight: 'bold',
              align: 'end',
              flex: 1,
            },
          ],
          justifyContent: 'space-between',
          margin: 'md',
        },
        // Monthly amount info card
        createInfoCard(
          'ค่างวดต่อเดือน',
          `${data.totalInstallments} งวด`,
          `฿${data.monthlyAmount.toLocaleString()}`,
          STYLE_C.BUTTON.GREEN,
          `รวม ${data.totalInstallments} งวด`,
          STYLE_C.TEXT.MUTED,
          STYLE_C.INFO_CARD_BG.SUCCESS,
          STYLE_C.INFO_CARD_BORDER.SUCCESS,
        ),
        // Tip box
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'image',
              url: ICONS.INFO_CIRCLE,
              size: '16px',
              aspectRatio: '1:1',
              aspectMode: 'fit',
              flex: 0,
            },
            {
              type: 'text',
              text: 'ตอนนี้คุณสามารถเช็คยอด ชำระค่างวด และดูประวัติได้แล้วค่ะ',
              size: 'xs',
              color: STYLE_C.TEXT.SECONDARY,
              wrap: true,
              margin: 'sm',
              flex: 1,
            },
          ],
          backgroundColor: STYLE_C.HINT_CARD.GREEN,
          cornerRadius: '8px',
          paddingAll: '12px',
          margin: 'lg',
          alignItems: 'center',
        },
      ],
      paddingAll: '20px',
      spacing: 'sm',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: {
            type: 'message',
            label: '💰 เช็คยอด',
            text: 'เช็คยอด',
          },
          style: 'primary',
          color: STYLE_C.BUTTON.GREEN,
          height: 'sm',
        },
        {
          type: 'button',
          action: {
            type: 'message',
            label: '📋 ดูสัญญา',
            text: 'สัญญา',
          },
          style: 'secondary',
          height: 'sm',
          margin: 'sm',
        },
      ],
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    `ลงทะเบียนสำเร็จ! คุณ${data.customerName} สัญญา ${data.contractNumber}`,
    bubble,
  );
}
