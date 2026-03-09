import type { VariableDefinition } from '@/types/template';

export const AVAILABLE_VARIABLES: VariableDefinition[] = [
  // === Contract ===
  { key: 'CONTRACT.NUMBER', label: 'เลขที่สัญญา', type: 'text', sampleValue: 'BCP2603-00421' },
  { key: 'CONTRACT.DATE', label: 'วันที่ทำสัญญา', type: 'date', sampleValue: '2026-03-03' },
  { key: 'CONTRACT.START_DATE', label: 'วันเริ่มผ่อน', type: 'date', sampleValue: '2026-03-29' },
  { key: 'CONTRACT.END_DATE', label: 'วันสิ้นสุดผ่อน', type: 'date', sampleValue: '2027-02-28' },
  { key: 'CONTRACT.TOTAL_MONTHS', label: 'จำนวนเดือนผ่อน', type: 'number', sampleValue: 12 },
  { key: 'CONTRACT.TOTAL_AMOUNT', label: 'ยอดเช่าซื้อรวม', type: 'number', sampleValue: 21468.48 },
  { key: 'CONTRACT.TOTAL_AMOUNT_TEXT', label: 'ยอดเช่าซื้อ (ตัวอักษร)', type: 'text', sampleValue: 'สองหมื่นหนึ่งพันสี่ร้อยหกสิบแปดบาทสี่สิบแปดสตางค์' },
  { key: 'CONTRACT.DOWN_PAYMENT', label: 'เงินดาวน์', type: 'number', sampleValue: 0 },
  { key: 'CONTRACT.MONTHLY_PAYMENT', label: 'ค่างวดต่อเดือน', type: 'number', sampleValue: 1789.04 },
  { key: 'CONTRACT.MONTHLY_PAYMENT_TEXT', label: 'ค่างวด (ตัวอักษร)', type: 'text', sampleValue: 'หนึ่งพันเจ็ดร้อยแปดสิบเก้าบาทสี่สตางค์' },
  { key: 'CONTRACT.PENALTY_RATE', label: 'ค่าปรับต่อเดือน', type: 'number', sampleValue: 100 },
  { key: 'CONTRACT.WARRANTY_DAYS', label: 'ระยะรับประกัน (วัน)', type: 'number', sampleValue: 30 },
  { key: 'CONTRACT.EARLY_DISCOUNT', label: 'ส่วนลดปิดก่อน (%)', type: 'number', sampleValue: 50 },
  { key: 'CONTRACT.MIN_MONTHS_EARLY', label: 'ขั้นต่ำเดือนปิดก่อน', type: 'number', sampleValue: 6 },

  // === Company ===
  { key: 'COMPANY.NAME_TH', label: 'ชื่อบริษัท (ไทย)', type: 'text', sampleValue: 'บริษัท เบสท์ช้อยส์โฟน จำกัด' },
  { key: 'COMPANY.NAME_EN', label: 'ชื่อบริษัท (EN)', type: 'text', sampleValue: 'BESTCHOICEPHONE Co., Ltd.' },
  { key: 'COMPANY.TAX_ID', label: 'เลขผู้เสียภาษี', type: 'text', sampleValue: '0165568000050' },
  { key: 'COMPANY.ADDRESS', label: 'ที่อยู่บริษัท', type: 'text', sampleValue: '456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000' },
  { key: 'COMPANY.DIRECTOR', label: 'ผู้มีอำนาจลงนาม', type: 'text', sampleValue: 'เอกนรินทร์ คงเดช' },
  { key: 'COMPANY.DIRECTOR_ID', label: 'เลขบัตร ผู้มีอำนาจ', type: 'text', sampleValue: '1-1601-00452-40-7' },
  { key: 'COMPANY.DIRECTOR_ADDRESS', label: 'ที่อยู่ ผู้มีอำนาจ', type: 'text', sampleValue: '517 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000' },

  // === Customer ===
  { key: 'CUSTOMER.NAME', label: 'ชื่อลูกค้า', type: 'text', sampleValue: 'วันนี แววศรี' },
  { key: 'CUSTOMER.IDCARD', label: 'เลขบัตรประชาชน', type: 'text', sampleValue: '3430600120504' },
  { key: 'CUSTOMER.TEL', label: 'เบอร์โทร', type: 'text', sampleValue: '0826877714' },
  { key: 'CUSTOMER.ADDRESS_ID', label: 'ที่อยู่ตามบัตร', type: 'text', sampleValue: '11/2 หมู่ 9 ตำบลดงมะรุม อำเภอโคกสำโรง จังหวัดลพบุรี 15120' },
  { key: 'CUSTOMER.ADDRESS_CONTACT', label: 'ที่อยู่ติดต่อ', type: 'text', sampleValue: '60/1 หมู่ 3 ตำบลนิคมสร้างตนเอง อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000' },
  { key: 'CUSTOMER.LINE_ID', label: 'Line ID', type: 'text', sampleValue: '0826877714' },
  { key: 'CUSTOMER.FACEBOOK', label: 'Facebook Link', type: 'text', sampleValue: 'https://www.facebook.com/...' },
  { key: 'CUSTOMER.OCCUPATION', label: 'อาชีพ', type: 'text', sampleValue: 'พนักงานบริษัท' },
  { key: 'CUSTOMER.SALARY', label: 'รายได้', type: 'number', sampleValue: 15000 },
  { key: 'CUSTOMER.WORKPLACE', label: 'สถานที่ทำงาน', type: 'text', sampleValue: 'บริษัท ABC จำกัด' },

  // === Emergency Contacts (Array) ===
  { key: 'EMERGENCY_CONTACTS', label: 'บุคคลติดต่อ', type: 'array', sampleValue: [
    { NAME: 'ไพวรรณ เล็กอ่อน', TEL: '0955785425', RELATION: 'แฟน' },
    { NAME: 'ธนภัทร เล็กอ่อน', TEL: '0636094758', RELATION: 'ลูก' },
    { NAME: 'สันทนี แช่มชื่น', TEL: '0898301215', RELATION: 'เพื่อน' },
    { NAME: 'ศักดิ์ดิธัช แววศรี', TEL: '0640049309', RELATION: 'หลาน' },
  ]},

  // === Phone ===
  { key: 'PHONE.BRAND', label: 'ยี่ห้อ', type: 'text', sampleValue: 'Apple' },
  { key: 'PHONE.MODEL', label: 'รุ่น', type: 'text', sampleValue: 'iPhone 13 128 Gb' },
  { key: 'PHONE.STORAGE', label: 'หน่วยความจำ', type: 'text', sampleValue: '128 Gb' },
  { key: 'PHONE.COLOR', label: 'สี', type: 'text', sampleValue: 'สีมิดไนท์' },
  { key: 'PHONE.CONDITION', label: 'สภาพ', type: 'text', sampleValue: 'มือ2' },
  { key: 'PHONE.IMEI', label: 'IMEI', type: 'text', sampleValue: '359222218331707' },
  { key: 'PHONE.SERIAL', label: 'Serial Number', type: 'text', sampleValue: 'H4X1K9WNMF' },

  // === Branch / Staff ===
  { key: 'BRANCH.NAME', label: 'ชื่อสาขา', type: 'text', sampleValue: 'สาขาเมืองลพบุรี' },
  { key: 'BRANCH.ADDRESS', label: 'ที่อยู่สาขา', type: 'text', sampleValue: '456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมือง จังหวัดลพบุรี 15000' },
  { key: 'BRANCH.PHONE', label: 'เบอร์สาขา', type: 'text', sampleValue: '036-411-234' },
  { key: 'SALESPERSON.NAME', label: 'ชื่อพนักงานขาย', type: 'text', sampleValue: 'สมชาย ใจดี' },

  // === Installments (Array) ===
  { key: 'INSTALLMENTS', label: 'ตารางค่างวด', type: 'array', sampleValue: [
    { NO: 1, DUE_DATE: '2026-03-29', AMOUNT: 1789.04 },
    { NO: 2, DUE_DATE: '2026-04-29', AMOUNT: 1789.04 },
    { NO: 3, DUE_DATE: '2026-05-29', AMOUNT: 1789.04 },
    { NO: 4, DUE_DATE: '2026-06-29', AMOUNT: 1789.04 },
    { NO: 5, DUE_DATE: '2026-07-29', AMOUNT: 1789.04 },
    { NO: 6, DUE_DATE: '2026-08-29', AMOUNT: 1789.04 },
    { NO: 7, DUE_DATE: '2026-09-29', AMOUNT: 1789.04 },
    { NO: 8, DUE_DATE: '2026-10-29', AMOUNT: 1789.04 },
    { NO: 9, DUE_DATE: '2026-11-29', AMOUNT: 1789.04 },
    { NO: 10, DUE_DATE: '2026-12-29', AMOUNT: 1789.04 },
    { NO: 11, DUE_DATE: '2027-01-29', AMOUNT: 1789.04 },
    { NO: 12, DUE_DATE: '2027-02-28', AMOUNT: 1789.04 },
  ]},
];

export const VARIABLE_GROUPS = [
  { label: 'สัญญา', prefix: 'CONTRACT.' },
  { label: 'บริษัท', prefix: 'COMPANY.' },
  { label: 'ลูกค้า', prefix: 'CUSTOMER.' },
  { label: 'บุคคลติดต่อ', prefix: 'EMERGENCY_CONTACTS' },
  { label: 'สินค้า', prefix: 'PHONE.' },
  { label: 'สาขา/พนักงาน', prefix: 'BRANCH.', altPrefix: 'SALESPERSON.' },
  { label: 'ค่างวด', prefix: 'INSTALLMENTS' },
];
