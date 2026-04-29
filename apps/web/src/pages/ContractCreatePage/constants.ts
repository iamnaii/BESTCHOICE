import type { CustReferenceData } from './types';

export const STEPS = ['เลือกสินค้า', 'เลือกลูกค้า', 'เลือกแผนผ่อน + ยืนยัน'];

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
  lineIdFinance: '',
  lineIdShop: '',
  facebookLink: '',
  facebookName: '',
  facebookFriends: '',
  googleMapLink: '',
  occupation: '',
  occupationDetail: '',
  salary: '',
  workplace: '',
};
