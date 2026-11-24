# ตรวจเตรียม deploy หน้าตำแหน่งและสิทธิ์ — 24 พฤศจิกายน 2569

ผู้ใช้อนุญาต deploy และอนุญาตใช้สิทธิ์ผู้ดูแลข้ามเงื่อนไขผู้รีวิวเมื่อ CI ผ่านครบ โดยไม่ข้ามด่านทดสอบ

- PR: https://github.com/iamnaii/BESTCHOICE/pull/1826
- รวม `main` ล่าสุด `33108c884` เข้า branch โดยไม่มี conflict เป็น `a05e600e9`
- ไม่เพิ่ม schema/migration, dependency หรือ environment variable และไม่ย้ายบัญชีพนักงานจริงอัตโนมัติ
- โค้ดหลังรวมผ่าน `local:check` 49 ขั้นตอน, PostgreSQL สิทธิ์ 24 ข้อ และ feature browser 1440/390 px

## ปัญหาที่พบใน CI และการแก้

Documents integration run `45359179126` พบหน้ารายละเอียดสินค้า (inventory row 51) ล้นบนมือถือ 320/390 px ทั้งธีมสว่างและมืด: scrollWidth 520 px แถบภาพ 6 มุมใช้ flex แถวเดียว ขยายความกว้างขั้นต่ำของคอลัมน์ในหน้า

เพิ่ม `flex-wrap` ที่แถบรูปใน `ProductIdentityCard.tsx` เพื่อให้รูปขึ้นแถวใหม่บนจอแคบ ไม่มีการแก้ข้อมูลสินค้า ราคา สิทธิ์ หรือการทดสอบให้ผ่อนเงื่อนไข

ทดสอบด้วย full API + disposable PostgreSQL: `UXUI_ROWS=51 UXUI_WIDTHS=320,390 npm run docs:check -- uxui-pages.browser.docs-spec` ล้มเหลวซ้ำก่อนแก้ หลังแก้ผ่านทั้ง 320/390/1440 px ทั้งสองธีม โดย scrollWidth เท่ากับ viewport ทุกขนาด และ component tests 4 ข้อผ่าน

หลักฐาน: `.tmp/docs-integration/owner-access-product-overflow-red`, `.tmp/docs-integration/owner-access-product-overflow-green`, `.tmp/local-preview/product-overflow-unit.log` สถานะ deploy จริงให้ยึดผล pipeline และการตรวจหลัง merge ไม่ถือว่ารายงานเตรียมงานนี้เป็นหลักฐานว่าขึ้น production แล้ว
