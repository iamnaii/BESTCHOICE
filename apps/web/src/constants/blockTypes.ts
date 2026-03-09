import type { BlockTypeInfo } from '@/types/template';

export const BLOCK_TYPES: BlockTypeInfo[] = [
  { value: 'paragraph', label: 'Paragraph', description: 'ข้อความปกติ' },
  { value: 'heading', label: 'หัวข้อสัญญา', description: 'หัวเรื่องหลัก' },
  { value: 'contract-header', label: 'ข้อมูลหัวสัญญา', description: 'เลขที่สัญญา + วันที่' },
  { value: 'party-info', label: 'ข้อมูลคู่สัญญา', description: 'ผู้ให้เช่าซื้อ/ผู้เช่าซื้อ' },
  { value: 'emergency-contacts', label: 'บุคคลติดต่อฉุกเฉิน', description: 'Loop contacts' },
  { value: 'product-info', label: 'ข้อมูลสินค้า', description: 'ยี่ห้อ/รุ่น/IMEI/Serial' },
  { value: 'clause', label: 'ข้อสัญญา', description: 'ข้อสัญญาแต่ละข้อ' },
  { value: 'payment-table', label: 'ตารางค่างวด', description: 'ตารางงวดผ่อนชำระ' },
  { value: 'column', label: 'คอลัมน์ แบบที่ 1', description: 'Layout 2 columns' },
  { value: 'column-vertical', label: 'คอลัมน์ แนวตั้ง', description: 'Layout 2 columns vertical' },
  { value: 'agreement', label: 'ข้อตกลง', description: 'Agreement section' },
  { value: 'subheading', label: 'หัวข้อย่อย', description: 'Subheading' },
  { value: 'numbered', label: 'หัวข้อตัวเลข', description: 'ข้อย่อย 1), 2)' },
  { value: 'signature-block', label: 'ลายเซ็น', description: 'ช่องลายเซ็น 4 ตำแหน่ง' },
  { value: 'photo-attachment', label: 'แนบรูปภาพ', description: 'รูปถ่ายสินค้า 6 รูป' },
  { value: 'attachment-list', label: 'รายการแนบท้าย', description: 'เอกสารแนบท้ายสัญญา' },
];
