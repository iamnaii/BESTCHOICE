import type { DossierRoom } from '../RoomDossier';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';

/**
 * เนื้อหาแท็บที่ 4 "GFIN" ของ RoomDossier — โครงชั่วคราวสำหรับ Task 9 (ให้ RoomDossier
 * compile + เทสต์ผ่าน) เนื้อหาเต็ม (สรุปใบยื่น, ช่องเอกสาร 13 ช่อง, ปุ่มส่ง/แชร์ลิงก์,
 * ไทม์ไลน์เหตุการณ์, ฟังอีเวนต์ `gfin-drop-files`) ทำใน Task 10
 */
export interface GfinTabProps {
  room: DossierRoom;
  customerId: string | null;
  gfin?: FinanceApplicationModel;
  onPickSlotForMessage?: (messageId: string) => void;
}

export default function GfinTab({ gfin }: GfinTabProps) {
  return (
    <div className="p-2.5 text-xs text-muted-foreground">
      {gfin?.current ? `ใบยื่น ${gfin.current.number}` : 'ยังไม่มีใบยื่น'}
    </div>
  );
}
