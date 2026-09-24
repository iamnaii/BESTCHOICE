/** สร้างคีย์ตัวเลขจากสตริงสำหรับ `pg_advisory_xact_lock` — ใช้ร่วมกันทุกจุดที่ล็อกต่อ BKK-day/คีย์ */
export function hashLockKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h;
}
