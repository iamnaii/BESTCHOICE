import { FlexMessagePayload, wrapFlexMessage, formatBaht } from './base-template';
import {
  buildPremiumBubble,
  createHeroAmount,
  createRow,
  createRowsBlock,
  createButton,
} from './style-d';

export interface VerifySuccessData {
  customerName: string;
  contractNumber: string;
  totalInstallments: number;
  monthlyAmount: number;
}

export function buildVerifySuccessFlex(data: VerifySuccessData): FlexMessagePayload {
  const bubble = buildPremiumBubble({
    role: 'success',
    tag: 'Verified',
    section: {
      label: 'ลงทะเบียนสำเร็จ',
      headline: `คุณ${data.customerName}`,
      subtle: 'เช็คยอด · ชำระค่างวด · ดูประวัติได้แล้ว',
      pill: { text: '✓ พร้อมใช้บริการ', role: 'success' },
    },
    body: [
      createHeroAmount('success', formatBaht(data.monthlyAmount), {
        cap: 'ค่างวดต่อเดือน',
        pill: { text: `รวม ${data.totalInstallments} งวด`, role: 'success' },
      }),
      createRowsBlock([
        createRow('เลขสัญญา', data.contractNumber),
        createRow('จำนวนงวด', `${data.totalInstallments} งวด`),
      ]),
    ],
    buttons: [
      createButton('เช็คยอด', { type: 'message', label: 'เช็คยอด', text: 'เช็คยอด' } as never, 'success'),
      createButton('ดูสัญญา', { type: 'message', label: 'ดูสัญญา', text: 'สัญญา' } as never, 'outline'),
    ],
  });

  return wrapFlexMessage(
    `ลงทะเบียนสำเร็จ! คุณ${data.customerName} สัญญา ${data.contractNumber}`,
    bubble,
  );
}
