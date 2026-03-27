import type { CustReferenceData } from './types';

export const STEPS = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน', 'แนบเอกสาร + ยืนยัน'];

export const DOCUMENT_TYPES = [
  { value: 'ID_CARD_COPY', label: 'สำเนาบัตรประชาชน (หน้า)', required: true },
  { value: 'ID_CARD_BACK', label: 'สำเนาบัตรประชาชน (หลัง)', required: false },
  { value: 'KYC_SELFIE', label: 'รูปถ่ายลูกค้าถือบัตรประชาชน', required: true },
  { value: 'DEVICE_PHOTO', label: 'รูปถ่ายสินค้า', required: true },
  { value: 'DEVICE_IMEI_PHOTO', label: 'รูปถ่าย IMEI สินค้า', required: true },
  { value: 'DOWN_PAYMENT_RECEIPT', label: 'หลักฐานการชำระเงินดาวน์', required: true },
  { value: 'PDPA_CONSENT', label: 'เอกสาร Consent PDPA', required: true },
  { value: 'GUARDIAN_DOC', label: 'เอกสารผู้ปกครอง (อายุ 17-19)', required: false },
  { value: 'KYC', label: 'เอกสาร KYC อื่นๆ', required: false },
  { value: 'FACEBOOK_PROFILE', label: 'Profile Facebook', required: false },
  { value: 'FACEBOOK_POST', label: 'Post Facebook ล่าสุด (ไม่เกิน 1 เดือน)', required: false },
  { value: 'LINE_PROFILE', label: 'Profile LINE', required: false },
  { value: 'DEVICE_RECEIPT_PHOTO', label: 'รูปรับเครื่อง', required: false },
];

export const emptyCustReference: CustReferenceData = { prefix: '', firstName: '', lastName: '', phone: '', relationship: '' };

export const emptyCustForm = {
  prefix: '',
  firstName: '',
  lastName: '',
  nickname: '',
  nationalId: '',
  isForeigner: false,
  birthDate: '',
  phone: '',
  phoneSecondary: '',
  email: '',
  lineId: '',
  facebookLink: '',
  facebookName: '',
  facebookFriends: '',
  googleMapLink: '',
  occupation: '',
  occupationDetail: '',
  salary: '',
  workplace: '',
};
