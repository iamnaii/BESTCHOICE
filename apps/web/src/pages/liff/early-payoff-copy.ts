/**
 * ข้อความส่วนลดบนหน้าไลน์ปิดยอดก่อนกำหนด — ต้องตามส่วนลดที่ลูกค้าได้จริง
 * (ฝ่ายบัญชี 16/10/2569 ข้อ 18.1 แบบ ค: ลดเฉพาะดอกเบี้ยของงวดที่ยังไม่ถึงกำหนด ⇒ ส่วนลดอาจเป็น 0)
 * · % มาจาก API (`discountPct`) — API เก่าไม่ส่ง = ไม่เดา 50
 */
export interface EarlyPayoffDiscountCopy {
  /** ป้ายเล็กเหนือหัวข้อ */
  badge: string;
  /** หัวการ์ดยอดปิด */
  sectionLabel: string;
  /** ป้ายแถวส่วนลดในรายละเอียด */
  rowLabel: string;
  /** ข้อความใต้แถวส่วนลด — null = ไม่แสดง */
  note: string | null;
  /** กล่องข้อมูลท้ายหน้า */
  infoNote: string;
}

export function earlyPayoffDiscountCopy(q: {
  discount: number;
  discountPct?: number | null;
  dueMonths?: number | null;
}): EarlyPayoffDiscountCopy {
  const due = Math.max(0, Math.floor(q.dueMonths ?? 0));
  const pct = q.discountPct != null && q.discountPct > 0 ? `${q.discountPct}%` : null;
  const closing = 'ยอดจะปิดสัญญาและย้ายกรรมสิทธิ์เครื่องทันทีหลังชำระสำเร็จ';

  if (!(q.discount > 0)) {
    return {
      badge: 'ปิดยอดก่อนกำหนด',
      sectionLabel: 'ยอดปิดสัญญา',
      rowLabel: 'ส่วนลดดอกเบี้ย',
      note:
        due > 0
          ? `งวดที่ถึงกำหนดแล้ว ${due} งวด ชำระเต็มจำนวน — ไม่มีงวดที่ยังไม่ถึงกำหนดให้ลดดอกเบี้ย`
          : null,
      infoNote: closing,
    };
  }

  const special = pct ? `ส่วนลดพิเศษ ${pct}` : 'ส่วนลดพิเศษ';
  return {
    badge: special,
    sectionLabel: pct ? `ยอดปิดสัญญา · ส่วนลด ${pct}` : 'ยอดปิดสัญญา · มีส่วนลด',
    rowLabel: due > 0 ? `${special} ของงวดที่ยังไม่ถึงกำหนด` : special,
    note:
      due > 0
        ? `ส่วนลดคิดเฉพาะงวดที่ยังไม่ถึงกำหนด — งวดที่ถึงกำหนดแล้ว ${due} งวด ชำระเต็มจำนวน`
        : null,
    infoNote: `${special} ของดอกเบี้ยงวดที่ยังไม่ถึงกำหนด เป็นสิทธิ์สำหรับลูกค้าที่ปิดสัญญาก่อนกำหนด ${closing}`,
  };
}
