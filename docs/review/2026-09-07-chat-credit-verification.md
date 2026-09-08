# ผลตรวจฟีเจอร์ตรวจเครดิตในแผงแชท — อัปเดต 8 กันยายน 2026

ผลล่าสุดอยู่ท้ายเอกสารหัวข้อ “ตรวจปุ่มอนุมัติและการรับชำระจริง — 8 กันยายน 2026” ส่วนผลรอบก่อนหน้าคงไว้เป็นประวัติ

ผู้ใช้ยืนยันใช้ mockup แล้วก่อนเริ่มแก้ฟีเจอร์ งานอยู่ที่ checkout `/Users/iamnaii/Desktop/App/BESTCHOICE`.

## พฤติกรรมที่ทำ

- แนบสเตทเม้นจากเครื่อง ลากจากข้อความ หรือกดปุ่มข้างไฟล์บนมือถือ เก็บไฟล์และผลตามห้องได้แม้ยังไม่ผูกลูกค้า
- แนบไฟล์และกดวิเคราะห์เป็นคนละขั้นตอน แผงขวาแสดงตัวเลขการเงินและค่างวดที่ผ่อนไหว โดยไม่แสดงคะแนน ผ่าน/ไม่ผ่าน หรือความมั่นใจ
- ใช้ `POST /ocr/bank-statement` เดิม รับรายการไฟล์จากห้องได้ และคงเส้นทางเดิมไว้ ตั้ง timeout เว็บ 120 วินาที
- ตรวจสิทธิ์ตามห้องเดิม ตรวจ message-room membership, host/redirect, ขนาดและชนิดไฟล์จาก bytes; ไฟล์เปิดผ่าน authenticated proxy
- PDF ล็อกรหัสแจ้งให้ขอไฟล์ใหม่ ไม่มีช่องส่งรหัสหรือการเดารหัส
- เมื่อผูกลูกค้า ผลที่วิเคราะห์แล้วเข้าประวัติและ `/credit-checks` เป็น `FULL / MANUAL_REVIEW` ไม่มี auto-score พร้อมลิงก์ห้องต้นทาง
- ประวัติแต่ละรอบเก็บวันเวลาวิเคราะห์เดิม ไม่ซ้ำเมื่อผูกลูกค้าชนกับการวิเคราะห์ และไม่ถูกเขียนทับผ่าน API คะแนนเดิม
- ประวัติและผลใน response สัญญายังคงสิทธิ์ห้องต้นทาง ไม่มี permission ประเภทใหม่
- ลิงก์จากแผงเปิดแท็บเครดิตของลูกค้าโดยตรง; ผู้มีสิทธิ์พิจารณาปรับสถานะผลจากแชทได้แม้ไม่มีคะแนน AI
- ประวัติใหม่ตั้งสถานะลูกค้าเป็นรอพิจารณา การอนุมัติใบเก่าไม่ทับผลล่าสุด และการนำประวัติเก่าเข้า/ผูกซ้ำไม่ล้างผลอนุมัติ
- การผูกหลายห้องและการอนุมัติทั้งจากลูกค้า/สัญญาใช้ล็อกลูกค้าร่วมกัน ตรวจสถานะซ้ำหลังล็อกและบันทึก audit ใน transaction เดียวกัน

## ผลรันรอบแผงแชทเดิม (7 กันยายน)

| การตรวจ | ผล |
| --- | --- |
| TypeScript: `./tools/check-types.sh all` | ผ่าน API และ web |
| Web: `npm run build` ใน `apps/web` | ผ่าน ทั้ง TypeScript และ Vite production build |
| Jest เครดิต/OCR และ regression สัญญา | 18 suites / 371 tests ผ่าน |
| Vitest inbox, CreditChecksPage, CreditCheckCard, credit-document | 28 files / 135 tests ผ่าน |
| `bash tools/test-chat-credit.sh` | 8 integration scenarios ผ่าน |
| `node --test tools/preview-chat-credit.test.mjs` | 2 tests ผ่าน: startup ล้มไม่หยุด PG เดิม และ browser check ปฏิเสธ storage จริงก่อนสร้างข้อมูล |
| `node tools/check-chat-credit-preview.mjs` | Chromium ผ่าน flow แนบ → วิเคราะห์ → ผูกลูกค้า → ประวัติเครดิต → อนุมัติ → ตรวจสถานะและ PDF เดิม |
| ESLint เฉพาะไฟล์ source/test ที่เปลี่ยน | 0 errors; API 22 warnings, web 33 warnings |
| `git diff --check` | ผ่าน |

Build มีคำเตือนขนาด chunks เกิน 500 kB. Lint มี warnings เรื่องชนิด `any`, unused variables/directives และสีที่ใช้ในไฟล์เดิม รวมทั้งตัวแปรที่จงใจตัด storage key/confidence ออกจากผลตอบกลับ.

คำสั่ง Jest ที่รัน:

```sh
cd apps/api
npx jest src/modules/credit-check src/modules/ocr src/modules/contracts/contract-workflow.service.spec.ts src/modules/contracts/contract-signing-workflow.spec.ts src/modules/contracts/contracts.service.spec.ts --runInBand
```

คำสั่ง Vitest ที่รัน:

```sh
cd apps/web
npx vitest run src/pages/UnifiedInboxPage src/pages/CreditChecksPage.test.tsx src/components/credit-check/CreditCheckCard.test.tsx src/lib/credit-document.test.ts
```

เทสต์ regression ใหม่ถูกเขียนและรันให้ล้มก่อนแก้ เช่น PDF ปลอม/ล็อก, OCR 400, เพดานค่างวด, สิทธิ์ห้อง/ประวัติ, multipart, callback ข้ามห้อง, legacy overwrite และการคืนข้อมูลจากสัญญา. รอบต่อมาจับลิงก์ผิดแท็บ, ปุ่มพิจารณาผลไม่มีคะแนน, cache รายชื่อลูกค้า, deadlock สองห้อง, ใบเก่าทับสถานะล่าสุด และการอนุมัติจากสถานะที่เปลี่ยนไประหว่างรอได้ก่อนแก้จริง.

## สิ่งที่ integration/browser ตรวจจริง

ใช้ PostgreSQL 16 ชั่วคราวผ่าน Unix socket เท่านั้น และ apply migrations ทั้งหมดสำเร็จ ชุด integration ล่าสุดใช้ `/tmp/bc-chat-credit.LZa26Z` และ Vite พอร์ต 5189; ปิด PostgreSQL/Vite และลบฐานข้อมูลที่ชุดนี้สร้างหลังรันเสร็จแล้ว ส่วน preview ที่เปิดให้ผู้ใช้ลองแยกไว้ที่พอร์ต 5187

- แนบ 2 ไฟล์โดยไม่ผูกลูกค้า ไม่ยิง OCR จนกดวิเคราะห์
- ผูกลูกค้าซ้ำพร้อมกันและผูกระหว่างรอ OCR ได้ผลเข้าประวัติครั้งเดียว
- HTTP ปฏิเสธข้ามสิทธิ์ห้องและ PDF ล็อกรหัส; ดาวน์โหลดได้ bytes PDF ตรงกับต้นฉบับ
- ตรวจประวัติด้วย SALES เจ้าของห้อง/คนอื่น, ACCOUNTANT และห้องที่ยังไม่มอบหมาย
- Chromium เปิดหน้า inbox จริง ลากไฟล์จาก bubble ลงแผง และเลือกไฟล์เพิ่ม วิเคราะห์ 2 ไฟล์แล้วแสดงผล
- ตรวจข้อความเตือนพื้นที่วางทั้งสองฝั่ง
- จอมือถือ 390 × 844: ปุ่ม bubble มองเห็นและกดได้ แนบระหว่างสลับห้องแล้วกด toast กลับห้องต้นทางได้ถูกต้อง
- ปิด Sheet ระหว่างวิเคราะห์ กลับมาเปิดแล้วเห็นผลเดิม
- ไม่เกิด request ส่งข้อความถึงลูกค้าใน flow ตรวจเครดิต
- ผูกลูกค้าแล้วเปิด `/credit-checks` เห็นรายการพร้อมลิงก์แชท
- HTTP ใช้ RolesGuard จริง: SALES อนุมัติไม่ได้ (403), OWNER อนุมัติได้ (201) และเกิด audit หนึ่งรายการ
- เปิดประวัติจากแผงแล้วแท็บเครดิต active, ผู้มีสิทธิ์เห็นปุ่มปรับสถานะ, อนุมัติจากคิวแล้วรายการออกจากคิวและสถานะลูกค้าเปลี่ยนจริง
- ผูกสองห้องกับลูกค้าเดียวกันพร้อมกันสำเร็จทั้งคู่; อนุมัติประวัติใบเก่าแล้วลูกค้ายังรอผลล่าสุด
- browser check บน preview ไม่ดักหรือแทน request ใน Chromium; เรียก API ของ preview ที่ใช้ controller/service จริง และ storage บนดิสก์

ภาพจากการรัน:

- [แผงเดสก์ท็อป](2026-09-07-chat-credit-desktop.png)
- [แผงมือถือ](2026-09-07-chat-credit-mobile.png)
- [คิวตรวจเครดิต](2026-09-07-credit-checks-queue.png)
- [ประวัติเครดิตของลูกค้า](2026-09-07-chat-credit-customer-history.png)

## เปิดตรวจ local

รอบล่าสุดเปิดค้างไว้ที่:

- [ห้องสำหรับแนบไฟล์](http://localhost:5187/inbox/a7a6d0ab-8c6b-44ec-bd39-a8c163779eb8)
- [ห้องที่มีผลตัวอย่าง](http://localhost:5187/inbox/1f7b32ca-01ac-4f52-9b81-ca74c28aacc1)
- [คิวตรวจเครดิต](http://localhost:5187/credit-checks)

เป็นบัญชี OWNER จำลอง ไม่ต้อง login ฐานข้อมูลและไฟล์สังเคราะห์เก็บที่ `/tmp/bc-chat-credit.8jw94a47` แยกจากระบบจริง. หลังหยุดรอบนี้แล้ว สามารถเปิดต่อโดยคงข้อมูลและไฟล์เดิมด้วย:

```sh
CREDIT_PREVIEW_DIR=/tmp/bc-chat-credit.8jw94a47 bash tools/preview-chat-credit.sh
```

ถ้าต้องการชุดใหม่ ใช้ `bash tools/preview-chat-credit.sh` โดยไม่กำหนด directory. หยุดด้วย Ctrl+C ใน terminal ของ runner; ห้ามฆ่า process ตามชื่อหรือพอร์ต. Backend preview ไม่ hot reload จึงต้องหยุด runner แล้วเปิดใหม่เมื่อแก้ API. หาก Vite หยุดแยกจาก runner หลังเปิดสำเร็จ API/PG จะยังอยู่ ให้หยุด runner ก่อนเปิดใหม่.

ชุดนี้จำลอง authentication และ endpoint ประกอบหน้าที่ไม่เกี่ยวกับเครดิต จำกัดให้ใช้ข้อมูลสังเคราะห์สำหรับตรวจ flow. ตัว API/Vite ฟังเฉพาะ loopback และ PostgreSQL ไม่เปิด TCP.

## ขอบเขตที่ยังไม่ได้ยืนยัน

Storage และผล OCR ใน integration เป็นตัวจำลอง; ยังไม่ได้เรียก AI provider, GCS หรือ Meta จริงจากงานนี้ และยังไม่ได้ deploy/migrate production. การยืนยันนี้จึงเป็นผลการทำงานบนชุดทดสอบแยก ไม่ใช่การรับรองระบบ production.

ตอนตรวจความพร้อมไม่พบ `ANTHROPIC_API_KEY` หรือ `GCS_BUCKET` ใน environment/config local ที่ตรวจ จึงยังยืนยันบริการจริงไม่ได้. เตรียมโหมด `CREDIT_REAL_OCR=1` และ `CREDIT_REAL_STORAGE=1` ไว้ใน runner ให้ใช้ OcrService/StorageService จริงโดยคงฐานข้อมูลแยก; โหมดนี้ยังไม่ถูกรัน. ต้องตั้งค่าใน `apps/api/.env` หรือ environment ก่อนใช้ และไม่ส่งค่า key ผ่านแชท. Browser smoke ข้างต้นปฏิเสธโหมด provider/storage จริงโดยตั้งใจ.

พอร์ต `localhost:5176` เดิมรันจาก worktree `.claude/worktrees/fix-po-expected-date/apps/web` จึงยังไม่แสดงโค้ดใน checkout นี้โดยอัตโนมัติ. Preview ของ checkout นี้เปิดที่ 5187 โดยคง process และข้อมูลไว้ให้ลองต่อ.

## เพิ่มเติม: วันครบกำหนดตรงวันเงินเดือนออก

ข้อกำหนดจากผู้ใช้: เงินเดือนวันที่ 25 ให้ครบกำหนดวันที่ 25; ค่า 31 คือสิ้นเดือนจริง และวันที่ 29/30 ให้ใช้วันสุดท้ายเฉพาะเดือนที่ไม่มีวันนั้น เดือนถัดไปกลับไปวันที่เดิม งวดแรกยังเป็นเดือนถัดไปตามกติกาเดิม ไม่เพิ่มจำนวนวันขั้นต่ำหรือปรับตามวันหยุดเอง

รันเทสต์ให้ล้มก่อนแก้: web schema/dropdown ไม่รองรับ 29/30/31, risk assessment บวก 5 วัน, API ปฏิเสธ 29/30, update เปลี่ยนวันได้แม้มี Payment, ตารางบัญชีและเอกสารสำรองล้นเดือนเมื่อสร้างสัญญาวันที่ 31 จากนั้นแก้เส้นทางเดิมและให้ agent รีวิวแล้วไม่พบ material issue

ผลรันล่าสุดของรอบนี้:

| การตรวจ | ผล |
| --- | --- |
| API: credit-check, OCR, contract services/workflow/documents และ installment utilities | 25 suites / 500 tests ผ่าน |
| Web: inbox, contract creation, credit queue/card/document | 31 files / 175 tests ผ่าน |
| `./tools/check-types.sh all` | API และ Web ผ่าน |
| Web `npm run build` | ผ่าน; มีคำเตือนขนาด chunk |
| ESLint ไฟล์ payday ที่เปลี่ยน | 0 errors; API มี 8 warnings ในไฟล์เดิม, web ไม่มี warnings |
| `bash tools/test-chat-credit.sh` | 8 กรณีผ่านบน PostgreSQL แยก `/tmp/bc-chat-credit.7FQBOZ` รวม HTTP และ Chromium |
| `node tools/check-contract-payday-preview.mjs` | Chromium เลือก 25/29/30/31 ได้ ค่า parent ตรงกับที่เลือก และ schema ปฏิเสธ 0/32/25.5 |

Browser payday checker โหลด `PlanDetailsStep` และ schema จริงผ่าน Vite ในหน้าที่ test runner สร้าง มีข้อมูลสังเคราะห์และไม่ส่งคำขอสร้างสัญญา ผลนี้ยืนยันการทำงานของฟอร์มในเบราว์เซอร์ ไม่ใช่การสร้างสัญญา end-to-end ส่วน integration 8 กรณียืนยัน flow ตรวจเครดิตเดิมด้วย OCR/storage จำลอง [ภาพฟอร์มที่ตรวจแล้ว](2026-09-07-contract-payday.png)

เทสต์วันครอบคลุมกุมภาพันธ์ 2026, ปีอธิกสุรทิน 2028, การกลับไปวันที่เดิมในมีนาคม, วันที่ตรงกันระหว่าง Payment generator กับตารางบัญชีเมื่อฐานเวลาเดียวกัน และการคงวันที่ Payment เดิมในเอกสาร มี guard ป้องกันแก้วันในรายละเอียดสัญญาให้ไม่ตรงตารางงวดที่มีอยู่แล้ว

ยอดอนุมัติเป็นบาทและ approval snapshot ยังไม่รวมในรอบแก้วันเงินเดือนเดิม; เชื่อมใช้งานเพิ่มเติมแล้วในรอบ 8 กันยายนตามหัวข้อด้านล่าง ดูนโยบายที่ตกลงและงานคงเหลือใน [ข้อเสนอการอนุมัติค่างวด](2026-09-07-installment-affordability-proposal.md) ยังไม่ได้ทดสอบ provider/storage จริงหรือ deploy production


## ยอดอนุมัติและวันเงินเดือน — 8 กันยายน 2026

ทำต่อหลังผู้ใช้สั่ง “จัดการให้ ใช้ได้เลย” โดยเขียนและรันเทสต์ล้มก่อนแก้ ทั้งสูตร, snapshot, การใช้ผลซ้ำ, stale data, สิทธิ์, การสร้างสัญญา/ขายผ่อน/activate และหน้าจอ

- ผู้พิจารณากรอกรายได้ประจำหลังภาษี/ประกันสังคมก่อนหักหนี้ ค่าครองชีพที่ไม่รวมหนี้ หนี้ภายนอก วันเงินเดือน และที่มาของตัวเลขให้ครบ ช่องว่างไม่ถูกแทนด้วยศูนย์
- Server อ่านภาระ BESTCHOICE จริง รวม DRAFT ที่จองภาระไว้ และนับงวดที่ยังค้าง จากนั้นคำนวณ `max(0,min((I-E-D)*0.5,I*0.4-D))` ปัดลงหลักร้อย เกณฑ์นี้เป็นนโยบายร้านที่ผู้ใช้เคาะ
- ผู้จัดการเลือกอนุมัติได้ไม่เกินเพดาน ต้องยืนยันตัวเลข/หลักฐาน เก็บ CreditApproval เป็น snapshot ใหม่พร้อมผู้อนุมัติ เวอร์ชันเกณฑ์ วันชำระ และตัวตรวจฐานข้อมูล แยกจาก OCR; การทบทวนแทนข้อเสนอเดิมที่ยังไม่ใช้ ไม่สร้างสิทธิ์เพิ่มซ้ำ
- FULL ต้องมีตัวเลขและเอกสารก่อนอนุมัติ สถานะ APPROVED เดิมที่ไม่มีจำนวนบาทหรือ PRE ใช้เปิดสัญญาไม่ได้
- คิว `/credit-checks`, ประวัติลูกค้า และแท็บเครดิตของสัญญาใช้ฟอร์มเดียวกัน ผู้จัดการการเงินพิจารณาได้ตามสิทธิ์เดิม ผล REJECTED ต้องให้ OWNER/FINANCE_MANAGER ทบทวน รวมการเปลี่ยนผ่าน MANUAL_REVIEW เพื่อป้องกันหลบสิทธิ์
- ก่อนสร้างสัญญา/ขายผ่อน และก่อน activate ตรวจค่างวดทุกงวดรวมงวดสุดท้าย วันชำระ และข้อมูลล่าสุด ใช้ approval หนึ่งครั้งต่อสัญญา การลบ DRAFT ไม่คืนสิทธิ์เดิม; วันที่งวดแรกที่บันทึกไว้เปลี่ยนต้องทบทวนใหม่
- หน้าเปิดสัญญาดึงยอดอนุมัติและวันเงินเดือน แสดงงวดแรก/ตารางงวด และปิดปุ่มเมื่อยอดหรือวันไม่ตรง ค่า 31 เป็นวันสุดท้ายจริงของเดือน; ไม่เขียนทับตารางสัญญา ACTIVE เดิม
- การเปลี่ยนเครื่องที่สร้างสัญญาใหม่ต้องมี FULL รอบใหม่ที่เข้าถึงได้ แล้วพิจารณายอดบนสัญญาใหม่ก่อน activate ผูกแถวต้นฉบับไว้เพื่อคงสิทธิ์เอกสาร ไม่มีการคัดลอกเอกสารส่วนตัวไปเป็น legacy record และไม่ล้างผล REJECTED ระหว่างผูก
- PRICED exchange สร้าง Payment ก่อนลงนาม พร้อมเงินต้น/ดอกเบี้ย/ค่าคอม/VAT และเศษงวดสุดท้ายตามสูตรบัญชีเดิม คำขอ legacy ที่ยอดผ่อนไม่ตรงส่วนประกอบบัญชีต้องส่งคำขอใหม่ให้ระบบคำนวณ snapshot ไม่แก้ยอดลูกค้าเอง; defect exchange คงวัน/ยอดงวดเดิม

ผลที่รันและเห็นแล้ว:

| การตรวจ | ผล |
| --- | --- |
| Jest เครดิต/OCR/สัญญา/ขายผ่อน/เปลี่ยนเครื่อง/ตารางงวด | 26 suites / 528 tests ผ่าน |
| นโยบาย override หลังปิดเส้นทาง REJECTED → MANUAL_REVIEW | 24 tests ผ่าน (อยู่ในชุดข้างต้น) |
| Vitest inbox/คิว/ฟอร์มอนุมัติ/หน้าเปิดสัญญา | 35 files / 185 tests ผ่าน |
| `bash tools/test-chat-credit.sh` | 2 suites / 17 tests ผ่าน บน PostgreSQL แยก `/tmp/bc-chat-credit.EefMBM` ลง migrations จริง |
| `node tools/check-chat-credit-preview.mjs` | Chromium ผ่าน ตั้งแต่ไฟล์ในแชทถึงกดสร้างสัญญาจริงผ่าน UI และตรวจ 12 Payment ที่บันทึกใน DB |
| `./tools/check-types.sh all` | API และ Web ผ่าน |
| API/Web `npm run build` | ผ่าน; web มี warning ขนาด chunk |
| ESLint source ของยอดอนุมัติและเส้นทางที่แก้ | 0 errors; API 41 warnings ในไฟล์ที่ตรวจ, web warning directive ที่ไม่จำเป็นถูกลบและตรวจผ่านแล้ว |
| `node --test tools/preview-chat-credit.test.mjs` | 2 tests ผ่าน |
| `git diff --check` | ผ่าน |

PostgreSQL/HTTP ตรวจอนุมัติชนกันและสร้างสัญญาชนกันแล้วหนึ่งคำขอสำเร็จ อีกคำขอถูกปฏิเสธ ตรวจ rollback เมื่อยอดเกิน/วันผิด ข้อมูลการเงินเปลี่ยน การใช้ซ้ำ การลบ DRAFT การเลื่อนงวดแรก และสิทธิ์ทบทวนผลที่ถูกปฏิเสธ การแก้ข้ามสัญญา/activate/เปลี่ยนเครื่องมี unit regression; ไม่ได้รันลงนามและเปิดสัญญา ACTIVE ครบกระบวนการกับบริการภายนอก

Browser กรอก I=15,000, E=9,000, หนี้ภายนอก=0, วันสิ้นเดือน → เพดาน 3,000 → ผู้จัดการอนุมัติ 1,500 บาท จากนั้นทดสอบแผนเกินเพดานและวันผิดว่าปุ่มสร้างถูกปิด ก่อนเพิ่มดาวน์เป็น 5,000 เลือก 12 เดือน และกดสร้างจริง ตรวจว่า 12 งวดไม่เกิน 1,500, ครบกำหนดสิ้นเดือน และ snapshot ผูกกับสัญญาพร้อมวันงวดแรก [ภาพหน้าจอแผนที่ตรวจแล้ว](2026-09-08-credit-approved-plan.png)

Local ยังคงเปิดที่ **http://localhost:5187/credit-checks** และห้องแชทตามลิงก์ด้านบน ไม่ใช่ worktree ที่พอร์ต 5176. Preview จำลอง auth, OCR และ storage; credit services, contract lifecycle, migrations และการบันทึก DB ใช้ของจริงบนฐานแยก ส่วน journal ใน preview/e2e เป็น stub จึงไม่ได้ยืนยันการลงบัญชีจริงจาก browser รอบนี้

ยังไม่ได้ทดสอบ AI provider/GCS จริง และยังไม่ได้ deploy หรือ migrate production. ต้องตั้งค่า provider/storage ที่ระบุในหัวข้อขอบเขตก่อนจึงจะทดสอบอ่านเอกสารจริงได้ อายุผลอนุมัติเป็นจำนวนวันยังไม่ได้ตั้งเอง ใช้การตรวจผลล่าสุด/ฐานการเงินเปลี่ยนแทนตามข้อตกลง


## ตรวจปุ่มอนุมัติและการรับชำระจริง — 8 กันยายน 2026

### ปุ่มอนุมัติที่ localhost:5187/credit-checks

- ซ่อนคำสั่งที่ API ไม่อนุญาต: ปฏิเสธซ้ำ, BRANCH_MANAGER กลับผล REJECTED และอนุมัติ PRE ซ้ำ
- แสดงยอดที่ผู้จัดการอนุมัติจริง วันชำระ และการใช้/แทนที่ผลอนุมัติในตาราง
- เปิดหลักฐานและประวัติในแท็บเครดิตได้จาก dialog; จำกัดเหตุผล 20–2,000 ตัวอักษรและ trim ก่อนส่ง
- ส่งข้อมูลการตัดสินเป็น snapshot ของคำขอ ปิดการแก้/ปิด dialog ระหว่างบันทึก ป้องกันผลคำขอเก่าปิดรายการใหม่
- กรณีเพดาน 0 บาท อธิบายว่าคำนวณครบแล้วแต่ยังอนุมัติค่างวดใหม่ไม่ได้
- มือถือ 390px: dialog อยู่ในจอและปุ่มยืนยันคงมองเห็นขณะเลื่อนฟอร์ม
- Red → green: เทสต์ UI ใหม่ล้ม 9 กรณีก่อนแก้ แล้ว 15/15 ผ่าน; browser กดอนุมัติ→สร้างสัญญา→ตรวจ 12 งวดใน DB ผ่าน

### AI และไฟล์จริง

พบ ANTHROPIC_API_KEY ใน Secret Manager และ GCS_BUCKET จาก config deploy เดิม อ่าน secret เฉพาะในหน่วยความจำของ process ไม่แสดง/บันทึกค่า key ใน repo หรือรายงาน

`tools/check-credit-providers.ts` รันกับ OcrService, StorageService จริงและฐานชั่วคราว:
- อัปโหลด PDF สังเคราะห์ไป GCS อ่านกลับ bytes ตรงกัน
- Anthropic อ่าน monthlyIncome=20,000, monthlyExpense=12,000, totalIncome=60,000, totalExpense=36,000 ตรงกับ fixture
- ลบเฉพาะ object ที่สร้างเพื่อทดสอบออกแล้ว ไม่มีการอ่านเอกสารลูกค้าจาก prod

นี่พิสูจน์การเชื่อมต่อและ PDF สังเคราะห์ ไม่ใช่ผลประเมินความแม่นยำกับสเตทเม้นจริงหลายธนาคาร Preview ปกติที่ 5187 ยังใช้ OCR จำลองและไฟล์ local เพื่อให้ลองซ้ำได้

### เงินต้น เอกสาร และบัญชีจริง

เพิ่ม E2E จากการอนุมัติและสร้างสัญญาจริง พบ red: เงินต้น 8,000 ถูกเก็บเป็นยอดรวม 11,984 จึงแก้เฉพาะการเขียนสัญญาใหม่/สัญญาที่ยังไม่มีตารางผ่อน ให้ Contract.financedAmount เป็นเงินต้นตาม CPA ส่วนตารางใช้ยอดรวมเงินต้น+ดอกเบี้ย+คอมมิชชัน+VAT เหมือนเดิม ไม่ backfill หรือเปลี่ยนยอดสัญญาเก่า

ปัดค่างวดให้ตรง CPA: floor(ยอดก่อน VAT / จำนวนงวด, 2) + round(VAT / จำนวนงวด, 2) ทั้งเครื่องคิดเลขเว็บ/API และแบ่ง Payment ตามตัวเลขบัญชี งวดสุดท้ายรับเศษจริงและยังต้องไม่เกินเพดานเครดิต

`credit-payment-flow.e2e-spec.ts` ใช้บริการจริง: credit approval → lifecycle create → ลายเซ็น 4 ฝ่าย → submit/review/activate → 1A/SHOP journals → 2A → รับชำระ 800+715.83 → รับครบ 12 งวด → COMPLETED

- เคสเงินต้น 10,000, ดอกเบี้ย 6,000, คอมมิชชัน 1,000, VAT 1,190 รวม 18,190
- 11 งวด × 1,515.83 + งวดท้าย 1,515.87 รวมตรง 18,190
- Red เมื่อรับครบแล้วลูกหนี้งวดเหลือ 0.04 บาท จึงให้ receipt และ preview ใช้เศษงวดสุดท้ายเดียวกับ 2A; green แล้วบัญชี 11-2101/11-2103/11-2105/11-2106/21-2102 เป็นศูนย์และสัญญา COMPLETED
- ตรวจ receipt สองใบ, เงินเข้าบัญชีตรงยอด, Dr=Cr, ป้องกันรับเงินซ้ำ
- เพิ่มเทสต์เปรียบเทียบ Journal preview กับยอดจริงทุกงวด: พบ NORMAL งวดท้ายแสดง 1,515.83 แทน 1,515.87 จึงแก้ preview ให้รวมเศษงวดท้ายด้วย (red ก่อนแก้)
- E2E นี้แทนเฉพาะ PDF/storage hook กับ notification; fixture PDPA/KYC เป็นข้อมูลสังเคราะห์ ไม่ส่งข้อความหาบุคคลจริง
- แยกเรียก DocumentRenderingService.htmlToPdf จริงจากสัญญาที่มีลายเซ็นและ Payment เหล่านี้สำเร็จ: [PDF สัญญาทดสอบ](2026-09-08-credit-contract-payment.pdf)
- เทสต์ template production จริงยืนยันทั้ง placeholder เก่าใน DB (`financed_amount`) และ `CONTRACT.TOTAL_AMOUNT` แสดงยอดผ่อนรวมจาก Payment ไม่ใช่เงินต้น

### ขอบเขตและการรันซ้ำ

`bash tools/test-chat-credit.sh` สร้าง PostgreSQL ผ่าน Unix socket และลง migrations ใหม่เอง พร้อมเปิด Vite สำหรับ browser tests; CI แยก credit suite จาก E2E ฐานร่วมและบังคับผ่านใน Lint & Test

`CREDIT_RUN_API_REGRESSION=1 bash tools/test-chat-credit.sh` รัน API ทั้งชุดบนฐาน SHOP/FINANCE ชั่วคราว พร้อม seed system user ก่อนทดสอบ เพื่อไม่ให้ legacy specs ใช้ DATABASE_URL ใน .env

หมายเหตุการรันครั้งแรก: full API command เดิมต่อฐาน local bestchoice จาก .env มี legacy depreciation tests เขียนและ cleanup ตารางร่วม จึงไม่นำผลนั้นมาอ้างเป็นการทดสอบแบบ isolated; รอบยืนยันย้ายฐานทั้งหมดไป disposable runner ไม่มีการทดสอบกับ production

ยังไม่ได้ deploy/migrate production และไม่แก้ประวัติเงินของสัญญาเดิม การ merge ต้องผ่าน review ตามกติกา repo; PR audit #1536 ยังค้างแยกต่างหาก


### ผลยืนยันรอบสุดท้าย

| ตรวจ | ผลที่รันจริง |
| --- | --- |
| API ทั้งชุดบนฐาน SHOP/FINANCE ชั่วคราว | 614 suites / 7,422 tests ผ่าน; เดิม skip 1 suite / 8 tests |
| Chat/approval/contract/payment E2E บน PostgreSQL จริง | 3 suites / 19 tests ผ่าน |
| Web ทั้งชุด | 237 files / 1,620 tests ผ่าน |
| Shared calculators | 2 files / 35 tests ผ่าน |
| TypeScript API+Web | ผ่าน |
| API+Web build | ผ่าน |
| Lint | 0 errors; มี warnings เดิมของ repo |
| CI collection + runner ownership guards | 3 tests ผ่าน |
| Browser local หลัง restart API ล่าสุด | ผ่าน approval→สร้างสัญญา→12 งวดจริง; mobile dialog 390px ผ่าน |
| Real Anthropic/GCS และ real PDF rendering | ผ่านด้วยข้อมูลสังเคราะห์ตามรายละเอียดด้านบน |
