import type { TrashRow } from '@/hooks/useTrash';

/** "เมื่อวาน" / "3 วันก่อน" — ตามวันปฏิทินไทย โดยประมาณ (ไม่ต้องตรงนาที) */
export function relativeThai(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (24 * 3600_000));
  if (days <= 0) return 'วันนี้';
  if (days === 1) return 'เมื่อวาน';
  if (days < 30) return `${days} วันก่อน`;
  if (days < 365) return `${Math.floor(days / 30)} เดือนก่อน`;
  return `${Math.floor(days / 365)} ปีก่อน`;
}

export function deletedByLabel(row: Pick<TrashRow, 'deletedBy'>): string {
  if (!row.deletedBy) return 'ไม่ทราบ (ระบบ/สคริปต์)';
  if (row.deletedBy.system) return 'ระบบ';
  return row.deletedBy.name;
}

/** ข้อความในกล่องยืนยัน — บอกสิ่งที่จะเกิด ไม่ใช่กล่องเตือนสีแดง */
export function restoreEffects(row: Pick<TrashRow, 'type' | 'typeLabel'>): string[] {
  const base = [`${row.typeLabel}จะกลับมาแสดงและใช้งานได้ทันที`, 'บันทึกในประวัติการดำเนินการว่าเจ้าของกู้คืนเมื่อไร'];
  switch (row.type) {
    case 'customer':
      return [base[0], 'ระบบตรวจเบอร์/อีเมลซ้ำกับลูกค้าที่ยังอยู่ก่อน — ถ้าซ้ำจะไม่กู้และบอกว่าซ้ำกับใคร', 'สัญญา ห้องแชท ประวัติเดิมไม่ถูกแตะ · แท็กอัตโนมัติคำนวณใหม่', base[1]];
    case 'expense_document':
    case 'other_income':
    case 'fixed_asset':
      return [base[0], 'กู้ได้เฉพาะฉบับร่าง · ถ้าเลขที่ถูกออกให้ใบใหม่แล้วระบบจะแจ้ง', base[1]];
    case 'notification_template':
    case 'interest_config':
      return [`${row.typeLabel}จะกลับมาเปิดใช้ทันที (หน้านั้นไม่มีสวิตช์เปิด/ปิด)`, base[1]];
    case 'sms_template':
    case 'reverse_reason':
    case 'payment_method_config':
    case 'chat_knowledge':
    case 'supplier':
    case 'branch':
      return [`${row.typeLabel}จะกลับมาแบบ "ปิดใช้งาน" — เปิดใช้เองที่หน้านั้นอีกครั้ง`, base[1]];
    default:
      return base;
  }
}
