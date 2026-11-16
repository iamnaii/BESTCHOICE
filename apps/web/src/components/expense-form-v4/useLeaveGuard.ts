// apps/web/src/components/expense-form-v4/useLeaveGuard.ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * คำเตือนก่อนปิด/รีเฟรชแท็บ (beforeunload) เมื่อผู้ใช้แก้ฟอร์มแล้วยังไม่บันทึก
 *
 * "แก้" = state ของฟอร์มเปลี่ยน หลังผู้ใช้แตะฟอร์ม (กด · พิมพ์ · เปลี่ยนค่า ในกรอบที่ผูก `captureProps`)
 * ไม่นับ:
 * - การเปลี่ยนที่ระบบทำเอง — ห่อด้วย `asSystem` (ติ๊กใบเจ้าหนี้ตามค่าตั้ง · ปรับยอดเมื่อปิดจ่ายบางส่วน ·
 *   ปิดเงินสดย่อยตามค่าตั้ง) แม้ผู้ใช้เพิ่งกดแป้นก่อนข้อมูลโหลดเสร็จ
 * - หลัง `markPristine` — ฟอร์มตรงกับของที่บันทึกแล้ว หรือเพิ่งล้างเป็นฟอร์มเปล่า (การแตะก่อนหน้านั้นไม่นับอีก)
 *
 * ทำไมเช็คใน useLayoutEffect: layout effect ของ commit หนึ่งรันก่อน passive effect ทุกตัวของ commit เดียวกัน
 * flag ที่ `asSystem` ตั้งจาก passive effect (ของลูกหรือของแม่) จึงถูกใช้โดย commit ถัดไปเท่านั้น —
 * ลำดับการประกาศ hook ไม่มีผล และการเปลี่ยนของระบบที่ไปกระตุ้น asSystem ของ effect ลูกต่อ (chain) ไม่ถูกนับ
 *
 * ข้อควรรู้:
 * - พิมพ์ระหว่างกำลังบันทึก (in-flight save) ไม่เตือน — เมื่อสำเร็จฟอร์มถูกแทนที่/ปิดอยู่แล้ว
 * - `asSystem` ต้องห่อเฉพาะการเปลี่ยนที่เปลี่ยน state จริง ไม่งั้น flag ค้างแล้วกลืนการแก้ครั้งถัดไปของผู้ใช้
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

  useLayoutEffect(() => {
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
