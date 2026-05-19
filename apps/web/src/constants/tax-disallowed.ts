/**
 * Tax-disallowed expense categories — ป.รัษฎากร ม.65 ตรี (1)-(20)
 *
 * Inline reference list shown to users when they tick the
 * "ค่าใช้จ่ายต้องห้าม" flag on expense / petty cash documents.
 *
 * The system DOES NOT persist which category was picked — this is a
 * decision-support hint only. ภ.ง.ด.50/51 prep still uses the boolean
 * `taxDisallowed` flag on Expense + ExpenseLine; the category here helps
 * the user pick correctly.
 *
 * Source: ม.65 ตรี ป.รัษฎากร (https://www.rd.go.th/5937.html). Numbering
 * follows the statute's sub-clauses. Phrasing simplified for non-lawyer
 * Thai users — formal legal language stays in the statute itself.
 *
 * Owner Response v2.0 Bonus B2 (signed 2026-05-17):
 *   "ขอให้เพิ่ม inline hint บอก user ว่ารายการนี้เข้าข่ายมาตรา 65 ตรี
 *    ข้อใด (เช่น 'ของขวัญ > 2,000฿', 'ค่าปรับภาษี', 'ค่าใช้จ่ายส่วนตัว')
 *    เพื่อช่วยลดความผิดพลาดตอนกรอก ภ.ง.ด.50/51"
 */

export interface TaxDisallowedCategory {
  /** Sub-clause reference, e.g. "(3)" — pin to the statute */
  ref: string;
  /** Short label for the popover list */
  label: string;
  /** Example / threshold to disambiguate */
  example?: string;
}

export const TAX_DISALLOWED_CATEGORIES: TaxDisallowedCategory[] = [
  {
    ref: '(3)',
    label: 'ค่ารับรอง / ของขวัญลูกค้า เกิน 2,000฿ ต่อคนต่อครั้ง',
    example: 'ส่วนที่เกินจาก 2,000฿ เท่านั้น (ส่วนที่ไม่เกินยังหักได้)',
  },
  {
    ref: '(4)',
    label: 'รายจ่ายส่วนตัว / รายจ่ายของกรรมการ-ผู้ถือหุ้นที่ไม่เกี่ยวกับกิจการ',
    example: 'ของใช้ส่วนตัว, ค่าโรงแรมท่องเที่ยวกรรมการ',
  },
  {
    ref: '(5)',
    label: 'รายจ่ายที่ผู้จ่ายมีหน้าที่ต้องจ่ายเอง',
    example: 'เงินบริจาคส่วนตัวจ่ายแทนกรรมการ',
  },
  {
    ref: '(6)',
    label: 'รายจ่ายที่ไม่มีหลักฐาน หรือพิสูจน์ผู้รับเงินไม่ได้',
    example: 'จ่ายให้แม่ค้าตลาด/บุคคลทั่วไป โดยไม่มีใบเสร็จ',
  },
  {
    ref: '(7)',
    label: 'รายจ่ายที่ไม่ใช่เพื่อหากำไรหรือกิจการของบริษัทโดยตรง',
    example: 'ค่าใช้จ่ายโครงการ CSR ที่ไม่ใช่เพื่อหากำไร',
  },
  {
    ref: '(8)',
    label: 'รายจ่ายไม่สมเหตุสมผล (สูงกว่าราคาตลาด)',
    example: 'ซื้อของจากกรรมการในราคาเกินจริง',
  },
  {
    ref: '(9)',
    label: 'ค่าตอบแทนทรัพย์สินที่บริษัทเป็นเจ้าของเอง',
    example: 'บริษัทจ่ายค่าเช่าให้กรรมการสำหรับทรัพย์สินของบริษัท',
  },
  {
    ref: '(11)',
    label: 'ค่าปรับ / เงินเพิ่ม / เบี้ยปรับสรรพากร / ค่าปรับอาญา',
    example: 'ค่าปรับ ภ.พ.30, ภ.ง.ด.50, ค่าปรับจราจร',
  },
  {
    ref: '(12)',
    label: 'รายจ่ายสำหรับการชำระภาษีเงินได้นิติบุคคล',
    example: 'ภาษีเงินได้นิติบุคคลของบริษัท เอง',
  },
  {
    ref: '(13)',
    label: 'รายจ่ายที่จ่ายให้ผู้รับซึ่งไม่อยู่ในประเทศไทย โดยไม่มีหลักฐาน',
    example: 'ค่าบริการต่างประเทศที่ไม่มี invoice',
  },
  {
    ref: '(14)',
    label: 'รายจ่ายที่ผิดกฎหมาย',
    example: 'ค่านายหน้าผิดกฎหมาย, เงินใต้โต๊ะ',
  },
  {
    ref: '(15)',
    label: 'รายจ่ายของกรรมการ/ผู้ถือหุ้นซึ่งไม่ได้ทำงานในบริษัท',
    example: 'เงินเดือนของผู้ที่ไม่ได้ปฏิบัติงานจริง',
  },
];
