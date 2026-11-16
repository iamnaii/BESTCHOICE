// apps/web/src/components/expense-form-v4/useLeaveGuard.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * คำเตือนก่อนปิด/รีเฟรชแท็บ (beforeunload) เมื่อผู้ใช้แก้ฟอร์มแล้วยังไม่บันทึก
 *
 * "แก้" = state ของฟอร์มเปลี่ยน หลังผู้ใช้แตะฟอร์ม (กด · พิมพ์ · เปลี่ยนค่า ในกรอบที่ผูก `captureProps`)
 * ไม่นับ:
 * - การเปลี่ยนที่ระบบทำเอง — ห่อด้วย `asSystem` (ติ๊กใบเจ้าหนี้ตามค่าตั้ง · ปรับยอดเมื่อปิดจ่ายบางส่วน ·
 *   ปิดเงินสดย่อยตามค่าตั้ง) แม้ผู้ใช้เพิ่งกดแป้นก่อนข้อมูลโหลดเสร็จ
 * - หลัง `markPristine` — ฟอร์มตรงกับของที่บันทึกแล้ว หรือเพิ่งล้างเป็นฟอร์มเปล่า (การแตะก่อนหน้านั้นไม่นับอีก)
 *
 * ข้อจำกัดที่รู้: ถ้าการเปลี่ยนของระบบกับของผู้ใช้ลงใน commit เดียวกัน รอบนั้นไม่ถูกนับ — ผลไม่ผิด
 * เพราะการกด/พิมพ์ตั้ง "แตะแล้ว" ไว้ และการเปลี่ยนรอบถัดไป (รวมของระบบที่ตามมา) จะถูกนับ
 */
export function useLeaveGuard(state: unknown) {
  const [dirty, setDirty] = useState(false);
  const interacted = useRef(false);
  const systemChangePending = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (systemChangePending.current) {
      systemChangePending.current = false;
      return;
    }
    if (interacted.current) setDirty(true);
  }, [state]);

  const markPristine = useCallback(() => {
    interacted.current = false;
    setDirty(false);
  }, []);

  /** เรียกเฉพาะเมื่อ `change` เปลี่ยน state จริง — ไม่งั้นการเปลี่ยนครั้งถัดไปของผู้ใช้จะถูกข้าม */
  const asSystem = useCallback((change: () => void) => {
    systemChangePending.current = true;
    change();
  }, []);

  const captureProps = useMemo(() => {
    const markInteracted = () => {
      interacted.current = true;
    };
    return {
      onPointerDownCapture: markInteracted,
      onKeyDownCapture: markInteracted,
      onChangeCapture: markInteracted,
    };
  }, []);

  return { dirty, markPristine, asSystem, captureProps };
}
