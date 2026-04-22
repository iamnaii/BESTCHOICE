import { FlexBubble, FlexMessagePayload, wrapFlexMessage, FlexComponent } from './base-template';
import { STYLE_C, createStyleCHeader, FlexBox } from './style-c';
import { ICONS } from './icons';

export interface LinkContractFlexData {
  /** LIFF URL for "ผูกสัญญา" — jumps to contract linking flow */
  liffLinkUrl: string;
  /** LIFF URL for new-customer registration */
  liffRegisterUrl?: string;
}

/**
 * "ผูกสัญญา" — Link existing contract to LINE account.
 *
 * Sent when a LINE user has no CustomerLineLink yet (e.g., just added
 * the FINANCE OA as a friend but hasn't registered their phone + contract).
 * Lists the three key benefits of linking, with a primary CTA that opens
 * the LIFF contract-linking flow, plus an optional secondary for brand-new
 * customers who haven't bought anything yet.
 */
export function buildLinkContractFlex(data: LinkContractFlexData): FlexMessagePayload {
  const benefitRow = (iconUrl: string, iconBg: string, title: string, sub: string): FlexBox => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'image',
            url: iconUrl,
            size: '18px',
            aspectRatio: '1:1',
            aspectMode: 'fit',
          },
        ],
        width: '36px',
        height: '36px',
        cornerRadius: '10px',
        backgroundColor: iconBg,
        justifyContent: 'center',
        alignItems: 'center',
      } as FlexBox,
      {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: title,
            size: 'sm',
            color: STYLE_C.TEXT.PRIMARY,
            weight: 'bold',
          } as FlexComponent,
          {
            type: 'text',
            text: sub,
            size: 'xxs',
            color: STYLE_C.TEXT.SECONDARY,
            margin: 'xs',
            wrap: true,
          } as FlexComponent,
        ],
        margin: 'md',
        flex: 1,
      } as FlexBox,
    ],
    alignItems: 'center',
    margin: 'md',
  });

  const footerButtons: FlexComponent[] = [
    {
      type: 'button',
      action: {
        type: 'uri',
        label: 'ผูกสัญญาของฉัน',
        uri: data.liffLinkUrl,
      },
      style: 'primary',
      color: STYLE_C.BUTTON.GREEN,
      height: 'sm',
    } as FlexComponent,
  ];
  if (data.liffRegisterUrl) {
    footerButtons.push({
      type: 'button',
      action: {
        type: 'uri',
        label: 'สมัครเป็นลูกค้าใหม่',
        uri: data.liffRegisterUrl,
      },
      style: 'secondary',
      height: 'sm',
      margin: 'sm',
    } as FlexComponent);
  }

  const bubble: FlexBubble = {
    type: 'bubble',
    size: 'mega',
    header: createStyleCHeader(
      ICONS.FILE_TEXT,
      'ยินดีต้อนรับเข้าสู่ระบบ',
      'จัดการสัญญาผ่อนผ่าน LINE ได้ทุกที่',
      STYLE_C.GRADIENT.GREEN,
      { text: 'BESTCHOICE FINANCE', bg: 'rgba(255,255,255,0.2)', textColor: '#FFFFFF' },
    ),
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        benefitRow(ICONS.FILE_TEXT, '#ecfdf5', 'ดูสัญญาของคุณ', 'งวดถัดไป · ยอดคงเหลือ · ประวัติ'),
        benefitRow(ICONS.DOLLAR_SIGN, '#fffbeb', 'ปิดก่อนกำหนด ลด 50%', 'ปิดยอดเร็ว ประหยัดดอกเบี้ย'),
        benefitRow(ICONS.QR_CODE, '#eef2ff', 'จ่ายค่างวดใน LINE', 'QR พร้อมเพย์ · สะดวก 24/7'),
      ],
      paddingAll: '20px',
      spacing: 'none',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: footerButtons,
      paddingAll: '15px',
      spacing: 'sm',
    },
  };

  return wrapFlexMessage(
    'ผูกสัญญาผ่อนของคุณเข้ากับ LINE เพื่อจัดการสัญญาได้ทุกที่',
    bubble,
  );
}
