import type { BlockTypeInfo } from '@/types/template';

export const BLOCK_TYPES: BlockTypeInfo[] = [
  { value: 'heading', label: 'หัวเรื่อง', description: 'ชื่อสัญญา เช่น "สัญญาเช่าซื้อโทรศัพท์มือถือ"' },
  { value: 'contract-header', label: 'เลขที่สัญญา', description: 'แสดงเลขที่สัญญาและวันที่' },
  { value: 'party-info', label: 'คู่สัญญา', description: 'ข้อมูลผู้ให้เช่าซื้อและผู้เช่าซื้อ' },
  { value: 'product-info', label: 'ข้อมูลสินค้า', description: 'ยี่ห้อ, รุ่น, IMEI, Serial Number' },
  { value: 'clause', label: 'ข้อสัญญา', description: 'ข้อกำหนดในสัญญาแต่ละข้อ (มีข้อย่อยได้)' },
  { value: 'paragraph', label: 'ข้อความ', description: 'ย่อหน้าข้อความทั่วไป' },
  { value: 'emergency-contacts', label: 'บุคคลติดต่อ', description: 'รายชื่อบุคคลที่ติดต่อได้' },
  { value: 'payment-table', label: 'ตารางค่างวด', description: 'ตารางงวดผ่อนชำระรายเดือน' },
  { value: 'signature-block', label: 'ช่องลายเซ็น', description: 'พื้นที่ลงนาม (ผู้เช่า/ผู้ให้เช่า/พยาน)' },
  { value: 'photo-attachment', label: 'แนบรูปภาพ', description: 'รูปถ่ายสินค้าแนบท้ายสัญญา' },
  { value: 'attachment-list', label: 'เอกสารแนบ', description: 'รายการเอกสารแนบท้ายสัญญา' },
  { value: 'agreement', label: 'ข้อตกลง', description: 'ส่วนข้อตกลงร่วมกัน' },
  { value: 'subheading', label: 'หัวข้อย่อย', description: 'หัวข้อรองภายในสัญญา' },
  { value: 'numbered', label: 'รายการลำดับ', description: 'ข้อย่อยที่มีตัวเลขกำกับ' },
  { value: 'column', label: '2 คอลัมน์', description: 'แบ่งเนื้อหาเป็น 2 ช่อง (ใช้ || คั่น)' },
  { value: 'column-vertical', label: '2 คอลัมน์แนวตั้ง', description: 'แบ่ง 2 ช่องแนวตั้ง (ใช้ || คั่น)' },
];
