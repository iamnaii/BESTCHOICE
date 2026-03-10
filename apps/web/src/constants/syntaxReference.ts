export interface SyntaxItem {
  label: string;
  syntax: string;
  color: string;
  bgColor: string;
}

export const SYNTAX_REFERENCE: { group: string; items: SyntaxItem[] }[] = [
  {
    group: 'PRINT',
    items: [
      { label: 'แสดงค่า', syntax: '{{= VAR.MEMBER}}', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    ],
  },
  {
    group: 'LOOP',
    items: [
      { label: 'วนลูป', syntax: '{{for ITEM in ARRAY}} ... {{/for}}', color: 'text-blue-700', bgColor: 'bg-blue-100' },
      { label: 'ลำดับ (0)', syntax: '@index0', color: 'text-blue-700', bgColor: 'bg-blue-100' },
      { label: 'ลำดับ (1)', syntax: '@index1', color: 'text-blue-700', bgColor: 'bg-blue-100' },
    ],
  },
  {
    group: 'IF',
    items: [
      { label: 'เงื่อนไข', syntax: '{{if COND}} ... {{/if}}', color: 'text-amber-700', bgColor: 'bg-amber-100' },
      { label: 'เงื่อนไขย่อย', syntax: '{{elseif COND}}', color: 'text-amber-700', bgColor: 'bg-amber-100' },
      { label: 'อื่นๆ', syntax: '{{else}}', color: 'text-amber-700', bgColor: 'bg-amber-100' },
    ],
  },
  {
    group: 'FORMAT',
    items: [
      { label: 'วันที่สั้น', syntax: '{{= VAR | date:s}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
      { label: 'วันที่กลาง', syntax: '{{= VAR | date:m}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
      { label: 'วันที่ยาว', syntax: '{{= VAR | date:l}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
      { label: 'ชื่อเดือน', syntax: '{{= VAR | date:month_name}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
      { label: 'ตัวเลข', syntax: '{{= VAR | num}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
      { label: 'ทศนิยม 2', syntax: '{{= VAR | num:2}}', color: 'text-teal-700', bgColor: 'bg-teal-100' },
    ],
  },
  {
    group: 'EXTRA',
    items: [
      { label: 'ลายเซ็นบริษัท', syntax: '@sign_company', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
      { label: 'ลายเซ็นลูกค้า', syntax: '@sign_customer', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
      { label: 'ลายเซ็นพยาน 1', syntax: '@sign_witness1', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
      { label: 'ลายเซ็นพยาน 2', syntax: '@sign_witness2', color: 'text-emerald-700', bgColor: 'bg-emerald-100' },
    ],
  },
];
