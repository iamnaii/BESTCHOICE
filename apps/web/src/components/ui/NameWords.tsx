/**
 * ชื่อคน (ชื่อ + นามสกุล) ที่ตัดบรรทัดได้เฉพาะระหว่างคำ — ภาษาไทยไม่มีเว้นวรรคในคำ
 * เบราว์เซอร์จึงตัดกลางชื่อเมื่อช่องแคบ ("นางสา / วกาญ / จนาภรณ์"). ใช้ในตารางที่ช่องชื่อแคบ.
 * ชื่อเต็มอยู่ใน sr-only ก้อนเดียว (โปรแกรมอ่านจอ/การค้นข้อความเห็นชื่อทั้งชื่อ) ส่วนที่เห็นแยกคำ.
 * วางในกล่องเลื่อนแนวนอนต้องให้กล่องนั้น `relative` (sr-only เป็น position:absolute).
 */
export default function NameWords({ name }: { name: string }) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return <>{name}</>;
  return (
    <>
      <span className="sr-only">{name}</span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <span key={i} className="whitespace-nowrap">
            {w}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </>
  );
}
