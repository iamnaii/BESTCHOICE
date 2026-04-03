import { ItemForm } from './types';

export const statusLabels: Record<string, string> = {
  PENDING: 'รอดำเนินการ',
  DRAFT: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  FULLY_RECEIVED: 'รับครบแล้ว',
  CANCELLED: 'ยกเลิก',
};

export const statusColors: Record<string, string> = {
  PENDING: 'bg-muted text-foreground',
  DRAFT: 'bg-warning/10 text-warning dark:bg-warning/15',
  APPROVED: 'bg-primary-100 text-primary-700',
  PARTIALLY_RECEIVED: 'bg-warning/10 text-warning dark:bg-warning/15',
  FULLY_RECEIVED: 'bg-success/10 text-success dark:bg-success/15',
  CANCELLED: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
};

export const paymentStatusLabels: Record<string, string> = {
  UNPAID: 'ยังไม่จ่าย',
  DEPOSIT_PAID: 'จ่ายมัดจำ',
  PARTIALLY_PAID: 'จ่ายบางส่วน',
  FULLY_PAID: 'จ่ายครบแล้ว',
};

export const paymentStatusColors: Record<string, string> = {
  UNPAID: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  DEPOSIT_PAID: 'bg-warning/10 text-warning dark:bg-warning/15',
  PARTIALLY_PAID: 'bg-primary-100 text-primary-700',
  FULLY_PAID: 'bg-success/10 text-success dark:bg-success/15',
};

export const accessoryTypes = [
  { value: 'ฟิล์ม', label: 'ฟิล์ม' },
  { value: 'ชุดชาร์จ', label: 'ชุดชาร์จ' },
  { value: 'หูฟัง', label: 'หูฟัง' },
  { value: 'เคส', label: 'เคส' },
  { value: 'อื่นๆ', label: 'อื่นๆ' },
];

export const chargerConnectorTypes = [
  { value: 'Lightning', label: 'Lightning' },
  { value: 'Type-C', label: 'Type-C' },
];

export const defaultChecklist = [
  { item: 'สภาพตัวเครื่อง', category: 'ภายนอก' },
  { item: 'สภาพหน้าจอ', category: 'ภายนอก' },
  { item: 'ปุ่มกด (Power/Volume)', category: 'ภายนอก' },
  { item: 'ช่องชาร์จ', category: 'ภายนอก' },
  { item: 'หน้าจอสัมผัส', category: 'การทำงาน' },
  { item: 'ลำโพง/ไมค์', category: 'การทำงาน' },
  { item: 'กล้องหน้า/หลัง', category: 'การทำงาน' },
  { item: 'Wi-Fi / Bluetooth', category: 'การทำงาน' },
  { item: 'Face ID / สแกนนิ้ว', category: 'การทำงาน' },
  { item: 'ชาร์จเข้า', category: 'แบตเตอรี่' },
  { item: 'รีเซ็ตเครื่องแล้ว', category: 'ซอฟต์แวร์' },
  { item: 'ปลดล็อค iCloud/Google', category: 'ซอฟต์แวร์' },
  { item: 'IMEI ไม่ถูก block', category: 'ซอฟต์แวร์' },
];

export const checklistCategories = [...new Set(defaultChecklist.map((c) => c.category))];

export const emptyItem: ItemForm = { brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '', accessoryType: '', accessoryBrand: '' };
