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
      { label: 'แสดงค่า', syntax: '{{= VAR.MEMBER}}', color: 'text-primary', bgColor: 'bg-primary/10' },
    ],
  },
  {
    group: 'LOOP',
    items: [
      { label: 'วนลูป', syntax: '{{for ITEM in ARRAY}} ... {{/for}}', color: 'text-primary', bgColor: 'bg-primary/10' },
      { label: 'ลำดับ (0)', syntax: '@index0', color: 'text-primary', bgColor: 'bg-primary/10' },
      { label: 'ลำดับ (1)', syntax: '@index1', color: 'text-primary', bgColor: 'bg-primary/10' },
    ],
  },
  {
    group: 'IF',
    items: [
      { label: 'เงื่อนไข', syntax: '{{if COND}} ... {{/if}}', color: 'text-warning', bgColor: 'bg-warning/10' },
      { label: 'เงื่อนไขย่อย', syntax: '{{elseif COND}}', color: 'text-warning', bgColor: 'bg-warning/10' },
      { label: 'อื่นๆ', syntax: '{{else}}', color: 'text-warning', bgColor: 'bg-warning/10' },
    ],
  },
  {
    group: 'FORMAT',
    items: [
      { label: 'วันที่สั้น', syntax: '{{= VAR | date:s}}', color: 'text-info', bgColor: 'bg-info/10' },
      { label: 'วันที่กลาง', syntax: '{{= VAR | date:m}}', color: 'text-info', bgColor: 'bg-info/10' },
      { label: 'วันที่ยาว', syntax: '{{= VAR | date:l}}', color: 'text-info', bgColor: 'bg-info/10' },
      { label: 'ชื่อเดือน', syntax: '{{= VAR | date:month_name}}', color: 'text-info', bgColor: 'bg-info/10' },
      { label: 'ตัวเลข', syntax: '{{= VAR | num}}', color: 'text-info', bgColor: 'bg-info/10' },
      { label: 'ทศนิยม 2', syntax: '{{= VAR | num:2}}', color: 'text-info', bgColor: 'bg-info/10' },
    ],
  },
  {
    group: 'EXTRA',
    items: [
      { label: 'ลายเซ็นบริษัท', syntax: '@sign_company', color: 'text-success', bgColor: 'bg-success/10' },
      { label: 'ลายเซ็นลูกค้า', syntax: '@sign_customer', color: 'text-success', bgColor: 'bg-success/10' },
      { label: 'ลายเซ็นพยาน 1', syntax: '@sign_witness1', color: 'text-success', bgColor: 'bg-success/10' },
      { label: 'ลายเซ็นพยาน 2', syntax: '@sign_witness2', color: 'text-success', bgColor: 'bg-success/10' },
    ],
  },
];
