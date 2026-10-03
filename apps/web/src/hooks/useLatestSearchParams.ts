import { useCallback, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

/**
 * `useSearchParams` ที่ "เขียนติดกันแล้วไม่ทับกัน" — ใช้กับหน้าที่เก็บตัวกรอง/การเรียง/หน้า ไว้ใน URL
 *
 * ปัญหาที่แก้: `setSearchParams` ของ react-router **ไม่ได้ต่อคิวแบบ setState** ทั้งแบบส่ง
 * `prev => …` และแบบ copy `searchParams` จาก closure ต่างก็ตั้งต้นจากค่าของ render ล่าสุด
 * ถ้าเขียนสองครั้งก่อนจอ render ใหม่ (เลือกตัวกรองแล้วกดเรียง/เปลี่ยนหน้าทันที) ครั้งที่สองจะ
 * ทับครั้งแรกทิ้ง ⇒ ตัวกรองหายเงียบ ๆ และไฟล์ส่งออกไม่ตรงกับที่กรอง
 * (E2E `sales-menu-regression` จับได้บน CI 2026-09-28)
 *
 * วิธีใช้: `const [searchParams, update] = useLatestSearchParams()`
 * - อ่านค่าจาก `searchParams` ตามปกติ
 * - เขียนด้วย `update(next => { next.set(…); next.delete(…) })` — `next` คือสำเนาของค่าล่าสุด
 *   ที่ "ตั้งใจให้เป็น" รวมที่เพิ่งเขียนไปแต่จอยังไม่ render · เขียนแบบ `replace` เสมอ
 *
 * ค่าล่าสุดซิงก์กลับเมื่อ URL จริงเปลี่ยน (รวมที่ตัวเขียนอื่นแก้ เช่น `?zone=` ของ layout)
 * `searchParams` เปลี่ยนตัวตนเฉพาะตอน `location.search` เปลี่ยน render อื่นจึงไม่ดึงค่าถอยหลัง
 */
export function useLatestSearchParams() {
  const [searchParams, setSearchParams] = useSearchParams();
  const latest = useRef(searchParams);
  useLayoutEffect(() => {
    latest.current = searchParams;
  }, [searchParams]);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(latest.current);
      mutate(next);
      latest.current = next;
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  return [searchParams, update] as const;
}
