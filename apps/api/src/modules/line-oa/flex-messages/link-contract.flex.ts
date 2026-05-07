import { FlexMessagePayload, wrapFlexMessage } from './base-template';
import {
  buildPremiumBubble,
  createRow,
  createRowsBlock,
  createButton,
} from './style-d';

export interface LinkContractFlexData {
  /** LIFF URL for "ผูกสัญญา" — jumps to contract linking flow */
  liffLinkUrl: string;
  /** LIFF URL for new-customer registration */
  liffRegisterUrl?: string;
}

/**
 * "ผูกสัญญา" — Link existing contract to LINE account. Style D Premium Thai.
 */
export function buildLinkContractFlex(data: LinkContractFlexData): FlexMessagePayload {
  const buttons = [
    createButton('ผูกสัญญาของฉัน', { type: 'uri', label: 'ผูกสัญญาของฉัน', uri: data.liffLinkUrl }, 'primary'),
  ];
  if (data.liffRegisterUrl) {
    buttons.push(
      createButton('สมัครเป็นลูกค้าใหม่', { type: 'uri', label: 'สมัครเป็นลูกค้าใหม่', uri: data.liffRegisterUrl }, 'outline'),
    );
  }

  const bubble = buildPremiumBubble({
    role: 'brand',
    tag: 'Link Contract',
    section: {
      label: 'ยินดีต้อนรับเข้าสู่ระบบ',
      headline: 'ผูกสัญญาผ่อนของคุณ',
      subtle: 'จัดการสัญญาผ่าน LINE ได้ทุกที่ทุกเวลา',
    },
    body: [
      createRowsBlock([
        createRow('ดูสัญญา', 'งวดถัดไป · ยอดคงเหลือ'),
        createRow('ปิดก่อนกำหนด', 'ลด 50% · ประหยัดดอกเบี้ย'),
        createRow('จ่ายค่างวด', 'PromptPay QR · 24/7'),
      ]),
    ],
    buttons,
  });

  return wrapFlexMessage(
    'ผูกสัญญาผ่อนของคุณเข้ากับ LINE เพื่อจัดการสัญญาได้ทุกที่',
    bubble,
  );
}
