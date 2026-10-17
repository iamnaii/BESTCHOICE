# Prepare Offer — แก้ระยะช่องกรอก 17 ตุลาคม 2026

ผู้ใช้พบว่าหน้าต่าง “เตรียมข้อเสนอ” ยังเบียดกันหลังการตรวจ toolbar รอบแรก การตรวจ overflow อย่างเดียวไม่พบปัญหานี้ จึงวัดระยะระหว่าง label กับ input จริงและตรวจภาพขณะ focus เพิ่ม

## สาเหตุและการแก้

`Label` แสดงเป็น inline จึงไม่เว้นระยะแนวตั้งจาก `space-y-1.5` ตามที่คาดไว้ วัดก่อนแก้ได้ **−1 px** ทั้งสามช่อง (ชื่อช่องทับขอบ input ก่อนนับกรอบ focus)

แก้เฉพาะ `PrepareOfferDialog.tsx` เป็น grid ที่เว้นระยะจริง:

- ชื่อช่อง–input และ input–ข้อความช่วย: **12 px**
- ระหว่างกลุ่มและก่อนปุ่มหลัก: **24 px**
- ระหว่างหัวหน้าต่างกับแบบฟอร์ม: **24 px**; padding บนมือถือ **20 px**
- เมื่อขยาย root font เป็น 20 px ระยะเติบโตเป็น **15/30 px** ตามสัดส่วน

คง Noto Sans Thai Looped, ช่องกรอกอย่างน้อย 44 px, focus indicator, มือถือหนึ่งคอลัมน์ และการเลื่อนในหน้าต่างเมื่อจอเตี้ย ไม่เปลี่ยน validation, API หรือการส่งข้อความ

ใช้ UI UX Pro Max ประกอบเรื่อง text reflow และ grid gap; ตรวจ reviewer แบบ read-only แล้ว ไม่มี Critical/Warning ค้าง

## การตรวจเฉพาะจุด

Browser 9 รูปแบบ / 45 ภาพ: 1512×900 light, 1440×960 dark, 1024×960 light, 390×844 light/dark, 320×800 light, 812×375 landscape และ root font 20 px ที่ 390×844 / 640×800

แต่ละรูปแบบตรวจ focus ทั้งสามช่อง, unfocused และผลข้อเสนอ:

- ช่องว่างจริง 12 px (15 px เมื่อ root 20 px) และเหลือพื้นที่จาก focus indicator อย่างน้อย 6 px
- ระหว่างกลุ่มและปุ่ม 24 px (30 px เมื่อ root 20 px)
- input สองคอลัมน์ตรงแนวกัน; ไม่มี horizontal overflow หรือ dialog หลุด viewport
- ไม่มี JavaScript page error; ปุ่มสรุปและค้นข้อเสนอแสดงผลจาก isolated preview ได้
- Unit tests เดิมของ PrepareOfferDialog **8/8 ผ่าน**

ทดสอบด้วย browser emulation บนข้อมูลสังเคราะห์ของ checkout นี้; AI จำลอง และไม่มีการส่งถึงลูกค้าจริง ไม่ใช่การทดสอบคีย์บอร์ดบนเครื่องมือถือจริง

หลักฐาน: `.tmp/offer-spacing/verify.mjs`, `.tmp/offer-spacing/results.json`, `.tmp/offer-spacing/before.json`

- [ก่อนแก้ desktop](../../.tmp/offer-spacing/before-desktop-focused.png)
- [หลังแก้ desktop](../../.tmp/offer-spacing/after-desktop-focused.png)
- [หลังแก้ mobile](../../.tmp/offer-spacing/390-844-16-light-offer-query-focused.png)
- [ขยายตัวอักษร](../../.tmp/offer-spacing/390-844-20-light-offer-query-focused.png)

## การแก้สคริปต์ตรวจที่พบระหว่างรัน

Local check รอบแรกผ่าน 35 checks แล้วหยุดที่ลูกค้าตัวอย่าง ACTIVE บนหน้ารายชื่อลูกค้า 390 px: ข้อมูลสังเคราะห์สะสมเป็น 51 ราย แต่หน้าแรกแสดง 50 ราย fixture จึงไปอยู่หน้า 2 การตรวจเดิมสมมติว่าชื่อต้องอยู่หน้าแรก ไม่ใช่ regression จากระยะช่องข้อเสนอ

แก้ `tools/check-local-pages.mjs` ให้กรอกชื่อในช่องค้นหาจริง รอผลค้นหาและยืนยัน HTTP 200, fixture ใน response และชื่อบนหน้าจอ โดยคง assertion เดิมไว้ ไม่เพิ่ม timeout หรือข้ามการตรวจ ทดสอบซ้ำกรณีมีข้อมูลเกิน 50 รายแล้วผ่าน; reviewer ไม่พบ Critical/Warning/Info

หลักฐานรอบที่ล้มเหลว: `.tmp/offer-spacing/local-check-first.json`, `/tmp/offer-spacing-local-check.log`; ผลตรวจซ้ำเฉพาะจุด: `/tmp/offer-spacing-customers-recheck.log`

Local check รอบสุดท้าย **PASS 39/39** รวม types, lint, build, unit tests 3,559 กรณี และ browser regression: `/tmp/offer-spacing-local-check-final.log`, `.tmp/local-preview/check.json` ตรวจแล้ว fingerprint ของ source, check และ preview ตรงกัน และ preview ยังทำงานอยู่

ตรวจ handoff ซ้ำในห้อง FINANCE เดียวกับภาพผู้ใช้ที่ 1512×900 และ 390×844: label–input 12 px ทั้งสองขนาด ไม่มีการส่งข้อความ; หลักฐาน `.tmp/offer-spacing/handoff.json`

[เปิดห้องแชทตัวอย่าง FINANCE](http://localhost:5206/inbox/af315ec5-59d7-4604-b141-804d70756636?zone=fin) · [ภาพ desktop รอบสุดท้าย](../../.tmp/offer-spacing/final-desktop.png) · [ภาพ mobile รอบสุดท้าย](../../.tmp/offer-spacing/final-mobile.png)

Source fingerprint: `fa78c2f23b1c8b8861e0f988805385dfbc3e419a499ea7421545c5f48baa7f09`

ยังไม่ commit/push/merge/deploy รอบนี้
