import { BadRequestException } from '@nestjs/common';
import { assertCustomerHasPhone } from './contract-create-policy';

/**
 * ด่านเบอร์ของเอกสารที่ต้องติดต่อลูกค้าได้ (สัญญา · ใบขาย · ใบจอง · รับซื้อ)
 * A12 — ข้อความต้องชี้ทางที่ทำได้จริง (coding-standards "ข้อความ error ต้องชี้ทางที่ทำได้จริงวันนี้"):
 *  - ผู้สนใจอัตโนมัติจากแชท (isChatPlaceholder) → ปุ่ม "เติมเบอร์" หน้าลูกค้า (DetailHeader) หรือ
 *    "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ — POST /customers/:id/fill-contact
 *    @Roles OWNER/BM/FM/SALES ครอบ role ของทั้ง 5 endpoint ที่เจอด่านนี้ (OWNER/BM/SALES)
 *  - คนอื่น (มีเลขบัตรแล้ว / ไม่ได้มาจากแชท) → fill-contact ปฏิเสธ (409) ⇒ ทางเดียวคือ "แก้ไขข้อมูล"
 *    (PATCH /customers/:id = OWNER/BM เท่านั้น) — SALES ต้องให้เจ้าของ/ผู้จัดการสาขาทำ
 */
describe('assertCustomerHasPhone — ลูกค้าที่ยังไม่มีเบอร์ทำเอกสารไม่ได้', () => {
  const prospect = { acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null };
  const PROSPECT_MSG = (action: string) =>
    `ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อน${action}`;
  const CUSTOMER_MSG = (action: string) =>
    `ลูกค้ายังไม่มีเบอร์โทร — ให้เจ้าของหรือผู้จัดการสาขากด "แก้ไขข้อมูล" ในหน้าลูกค้าเพื่อเติมเบอร์ก่อน${action}`;

  function messageOf(run: () => unknown): string {
    try {
      run();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return (e as BadRequestException).message;
    }
    throw new Error('ควรโยน BadRequestException');
  }

  it('ผู้สนใจอัตโนมัติจากแชท (ที่มา CHAT_* ไม่มีเบอร์และเลขบัตร) → ชี้ปุ่ม "เติมเบอร์" / "เพิ่มเบอร์/ข้อมูล"', () => {
    expect(messageOf(() => assertCustomerHasPhone(prospect, 'ทำสัญญา'))).toBe(PROSPECT_MSG('ทำสัญญา'));
    expect(messageOf(() => assertCustomerHasPhone({ ...prospect, acquisitionSource: 'CHAT_LINE_SHOP' }, 'รับซื้อเครื่อง'))).toBe(
      PROSPECT_MSG('รับซื้อเครื่อง'),
    );
  });

  it('มีเลขบัตรแต่ไม่มีเบอร์ (ที่มาแชทก็ตาม) → ไม่ใช่ผู้สนใจอัตโนมัติ ⇒ ชี้ "แก้ไขข้อมูล" ของเจ้าของ/ผู้จัดการสาขา', () => {
    expect(messageOf(() => assertCustomerHasPhone({ ...prospect, nationalId: '1103700012345' }, 'เปิดใบขาย'))).toBe(
      CUSTOMER_MSG('เปิดใบขาย'),
    );
  });

  it('ไม่ได้มาจากแชท ไม่มีเบอร์ → ข้อความลูกค้าทั่วไป', () => {
    expect(messageOf(() => assertCustomerHasPhone({ acquisitionSource: null, phone: null, nationalId: null }, 'จองสินค้า'))).toBe(
      CUSTOMER_MSG('จองสินค้า'),
    );
  });

  it('เบอร์ว่าง ("") → ยังปฏิเสธ · ไม่นับเป็นผู้สนใจอัตโนมัติ (นิยาม isChatPlaceholder = เบอร์เป็น null — ปุ่มเติมเบอร์ก็ไม่ขึ้น)', () => {
    expect(messageOf(() => assertCustomerHasPhone({ ...prospect, phone: '' }, 'เปิดใบขาย'))).toBe(CUSTOMER_MSG('เปิดใบขาย'));
  });

  it('มีเบอร์ → ผ่านและคืนเบอร์ (narrow เป็น string)', () => {
    expect(assertCustomerHasPhone({ ...prospect, phone: '0812345678' }, 'ทำสัญญา')).toBe('0812345678');
  });
});
