# BESTCHOICE — รวมงานเครดิตและทำ AI native ครบเฟสด้านโค้ด

วันที่: 8 กันยายน 2026 · รุ่นที่เตรียมปล่อย: **26.9.11**

งานอยู่ใน `BESTCHOICE-ai-native`, branch `codex/ai-native-staff-experience`, [PR #1539](https://github.com/iamnaii/BESTCHOICE/pull/1539) อิง main `289d0d4a2` และรวมเครดิตจาก `31a08bdf2` พร้อม audit sanitization `227fd4972` แล้ว ไม่แก้หรือเก็บ commit งานที่ยังค้างใน workspace เดิม/credit worktree

โค้ดตามแผนทั้ง 4 เฟสและงานต่อเนื่องที่รอ session เครดิตทำแล้ว ผลด้านพฤติกรรมตรวจด้วย unit/integration/browser และโมเดลจริงบนข้อมูลสังเคราะห์ การทดลองกับพนักงานจริงยังต้องดำเนินการตามแบบทดสอบ ส่วน production ยังไม่ถือว่าปล่อยจน PR ผ่าน review และ pipeline deploy สำเร็จ

## งานที่รวมแล้ว

| เฟส | ผลที่ได้ |
| --- | --- |
| 1 — หน้าเริ่มงานและการโหลด | SALES มี 4 งานหลัก งานของตนวันนี้ และคำแนะนำคนใหม่; ชื่อเมนูใช้ร่วมกัน; settings 36 components โหลดเมื่อใช้; แยก management dashboard |
| 2 — ส่วนเชื่อม AI กลาง | `AiTextService` ใช้ `AiProviderService` ร่วมกับ OCR ภาพ/PDF และเครดิต; usage หนึ่งครั้งต่อ model call พร้อมผู้เรียกจาก server; รอ telemetry ก่อนจบคำขอ |
| 3 — สูตรค่างวดกลาง | API compatibility exports ใช้ `@installment/shared` จริง; CommonJS/declarations และ Docker artifacts รองรับ Node 20; ตรวจ parity กับเครดิต/ตารางงวด/บัญชี |
| 4 — งานพนักงานใน Inbox | “เตรียมข้อเสนอ” อ่านความต้องการ ค้นสินค้าจริงตามสิทธิ์ คำนวณผ่านสูตรกลาง แสดงข้อความอ้างอิง และแทรกร่างให้พนักงานตรวจ |
| งานที่รอเครดิต | กลับจากตรวจเครดิตมาทำสัญญาพร้อมข้อมูลเดิม; รวม verified approval; แยก Payment Wizard/Customer360 ตามหน้าที่; ปิดปัญหา fixture และตรวจ flow รวม |

## การใช้งานใหม่

หน้าแรก SALES เรียง “ขายสินค้า / ทำสัญญาผ่อน / รับชำระค่างวด / ตอบแชทลูกค้า” ก่อนสรุปยอดเดิม งานวันนี้ใช้ `assigneeId=me` จากตัวตนที่ server ตรวจแล้ว summary ใช้ขอบเขตเดียวกับรายการ ไม่เรียกรายชื่อผู้ใช้เต็มเมื่อไม่มีสิทธิ์ OWNER เมื่อตัวเลขโหลดไม่ได้ยังเริ่มงานและลองโหลดใหม่ได้

ใน Inbox พนักงานกด “เตรียมข้อเสนอ” แล้วเลือกจำนวนงวดหรือแก้รุ่น/งบได้ ระบบอ่านเฉพาะข้อความลูกค้า ไม่ใช้โน้ตภายใน งบราคาเงินสดที่ระบุชัดในข้อความใช้เป็นตัวกรอง และงบที่พนักงานกรอกมีลำดับก่อน ไม่ตีความค่างวดต่อเดือนหรือเงินดาวน์เป็นราคาเงินสด AI สรุปความต้องการและรุ่นเท่านั้น ราคามาจากสต็อกและค่างวดมาจากเครื่องคิดกลาง

ค้นเฉพาะสินค้าที่ผ่านเงื่อนไขประกาศออนไลน์เดิมของเครื่องมือสต็อกและอยู่ในสาขาที่มีสิทธิ์ ตัดเครื่องติดจอง ตรวจสถานะและราคาใหม่ก่อนแสดงสูงสุด 3 ตัวเลือก ไม่แสดงของที่ราคาใหม่เกินงบ ข้อเสนอระบุว่าเป็นร่าง มีงบที่ใช้ เวลาตรวจ และข้อความลูกค้าอ้างอิงแบบย่อที่ปิดบังเลขโทรศัพท์/บัตร การแทรกร่างไม่ส่งแชท ไม่บันทึกขาย และไม่อนุมัติเครดิต

API ตรวจ role บริษัทของช่องทางแชท และสาขา/ผู้รับผิดชอบก่อนอ่านแชท เรียก AI หรือคืนสรุปที่ cache ไว้ ไม่รับสิทธิ์จาก request body เมื่อ provider ใช้ไม่ได้ยังค้นสต็อกตามรุ่นที่พนักงานกรอกได้

ปุ่มทำสัญญาส่งลูกค้า สินค้า เงินดาวน์ จำนวนงวด และห้องต้นทางไปด้วย ก่อนออกไปตรวจเครดิตจะบันทึกร่างทันที โดยแยกตามพนักงานและมีอายุ 24 ชั่วโมง หากบันทึกไม่ได้จะแจ้งให้แก้ก่อนออก เมื่อกลับมาจะตรวจสิทธิ์ลูกค้า สินค้าพร้อมขาย และผลอนุมัติใหม่ ไม่ใช้ผลอนุมัติจาก URL หรือ cache ที่ยังไม่ได้ตรวจสด การล้าง/เปลี่ยนลูกค้ามีลำดับก่อน response เก่าที่มาถึงช้า

## เครดิตและความถูกต้องของยอดเงิน

รวมงานแนบ/อ่าน Statement จากห้องแชทก่อนผูกลูกค้า ส่งประวัติเข้าคิวเดิม และให้ผู้จัดการยืนยันรายได้ ค่าใช้จ่าย หนี้ วันเงินเดือน และเพดานค่างวดเป็น snapshot ที่ตรวจย้อนกลับได้ ใช้ได้ครั้งเดียวต่อการทำสัญญา และตรวจทุกงวดรวมงวดสุดท้ายก่อนผ่านกติกาเดิม

รวมการแก้เงินต้นให้ไม่รวมดอกเบี้ย/VAT/ค่าคอมซ้ำ และการกระจายเศษสตางค์งวดสุดท้ายให้ยอดในสัญญา เอกสาร รับชำระ และบัญชีตรงกัน ไม่ backfill หรือเปลี่ยนยอดสัญญาเดิมโดยอัตโนมัติ

เพิ่ม migration แบบ additive 2 รายการ: `20260907110000_room_credit_statements`, `20260907180000_verified_credit_approvals` ทดสอบทั้งฐานว่างและฐานที่ลง migration เดิม 311 รายการแล้ว ข้อมูลและ columns เดิมอยู่ครบ ลงซ้ำไม่มี pending migration ไม่ได้รันกับ production

สัญญาร่าง/ผลเครดิตเดิมที่ไม่มี verified approval snapshot ต้องให้ผู้มีสิทธิ์ตรวจตามขั้นตอนใหม่ก่อนทำต่อ คะแนน AI หรือ legacy status `APPROVED` เพียงอย่างเดียวไม่ใช่ snapshot อนุมัติทางการเงิน

## ส่วนกลาง AI และการแยกไฟล์

- ข้อความใช้ timeout 30 วินาที/ไม่ retry อัตโนมัติ; เอกสารคง 120 วินาทีและ retry เดิม; เครดิตคงนโยบาย client เดิม รวมเวลาของ endpoint ยังมีงานอ่านข้อมูลและ telemetry ด้วย
- เก็บแหล่ง credential/model/prompt/fallback ของแต่ละงานแยกกัน ไม่ให้ SHOP bot config ควบคุม OCR หรือ FINANCE อัตโนมัติ ส่วนกลางรับได้ทั้งข้อความ ภาพ และ PDF
- พบจาก live provider ว่าโมเดลเครดิตเดิม `claude-sonnet-4-5-20250514` ตอบ 404 จึงเปลี่ยนเฉพาะงานนี้เป็น `claude-sonnet-4-6` ที่ทดสอบจริงแล้ว รักษา prompt การแปลงผล และกติกาเดิม
- `RecordPaymentWizard` จาก 1,991 เหลือ 1,576 บรรทัด แยกข้อมูลสัญญา/ตัวอย่างสมุดรายวัน โดยตรวจ AST ของ logic เดิมว่าคงอยู่
- `Customer360Panel` จาก 1,758 เหลือ 1,296 บรรทัด แยก actions/dialogs และประวัติรับเงิน ใช้ `LinkCustomerDialog` เดิมร่วมกัน แก้กรณีห้องที่ยังไม่ผูกลูกค้าไม่ mount dialog

## ผลตรวจในเครื่อง

| การตรวจ | ผล |
| --- | --- |
| API unit/regression เต็มชุด | 621 suites / 7,525 ผ่าน, 8 existing skips |
| Web unit/component เต็มชุด | 247 suites / 1,672 ผ่าน |
| Money integration บน PostgreSQL จริง | 65 files / 402 ผ่าน, 1 existing skip |
| Dual-Prisma integration | 12 suites / 50 ผ่าน |
| Shared package | 35 ผ่าน |
| เครดิต + ข้อเสนอผ่าน HTTP/browser จริง | 23 กรณี; ใช้ฐานข้อมูลและไฟล์สังเคราะห์แยก |
| Browser หน้าเริ่มงาน | desktop 1440px / mobile 390px ผ่าน; ปุ่ม/ค้น POS/ตัวกรองงาน/ไม่มี overflow |
| Browser ข้อเสนอ → ร่าง → เครดิต → กลับสัญญา | desktop 1500px / mobile 390px ผ่าน; ไม่ส่งข้อความ/สร้างสัญญาเอง; ข้อมูลกลับมาครบ; เครดิตยังเป็น gate |
| Browser เครดิต → ผู้จัดการอนุมัติ → สร้างสัญญา | ผ่าน พร้อมยอด/วันชำระ/12 งวดจริงในฐานทดสอบ |
| TypeScript + lint + production builds | ผ่าน; lint ไม่มี error แต่ repository ยังมี warnings เดิม |
| Compiled runtime | Node 20.20.2 ผ่านจาก artifacts เท่านั้น รวม layout แบบ Docker workspace symlink |
| Migration upgrade | ทั้งสอง migration ผ่านหลัง schema เดิม โดยไม่เปลี่ยนข้อมูลเดิม |

การตรวจ compiled runtime ไม่ใช่การ boot Docker container ในเครื่องนี้ Docker image จริงต้องผ่าน pipeline เช่นเดียวกับ health check หลัง deploy ดูสถานะ CI ล่าสุดใน PR #1539

## ขนาดและความเร็ว

วัด JavaScript ที่ browser ขอจริงก่อนเริ่มคลิกหน้า SALES ด้วยข้อมูลเดียวกัน บน Vite 8.0.12 / TypeScript 5.9.3 และ dependencies เดียวกัน เทียบ main `289d0d4a2` กับงานรวมรอบนี้

| ตัววัด | ก่อน | หลัง |
| --- | ---: | ---: |
| จำนวนไฟล์ JavaScript เริ่มต้น | 157 | 82 |
| ผลรวม gzip ของไฟล์ที่ขอ | 680,916 bytes | 549,517 bytes |

gzip ลด **19.30%** (131,399 bytes) เป็นขนาดคำนวณจากไฟล์ ไม่ใช่ bytes บนสายหรือเวลาโหลดจริง ไม่รวมไฟล์ที่โหลดหลังเลือกงาน หน้า SALES ไม่โหลด ManagementDashboard แต่ shared chart/PDF chunks ยังอยู่ใน entry

นับ source production ใต้ API/web/web-shop/shared ไม่รวม tests/generated/config/docs พบสุทธิเพิ่ม **2,705 บรรทัด** เทียบ main เพราะรอบนี้รวมฟีเจอร์เครดิตและ workflow ใหม่ จึงไม่ได้อ้างว่าโค้ดทั้งระบบลดลง ผลด้านการดูแลคือเลิกสำเนาสูตร 150 + 99 บรรทัด รวม transport ที่เคยทำซ้ำ ลดส่วนผูกลูกค้าซ้ำ และแบ่งไฟล์ใหญ่ตามงานจริง

หลักฐาน: [browser/ขนาด JS](assets/2026-09-08-staff-experience/browser-verification.json), [ขนาด source](assets/2026-09-08-ai-workflow/source-size-final.json), [ภาพหน้าแรกมือถือ](assets/2026-09-08-staff-experience/final-sales-mobile.png), [ข้อเสนอมือถือ](assets/2026-09-08-ai-workflow/mobile-offer.png), [ผล flow browser](assets/2026-09-08-ai-workflow/browser-report.json)

## ตรวจโมเดลจริง

ใช้ข้อความ/ภาพ/PDF สังเคราะห์ ไม่อ่านเอกสารลูกค้าจริง และไม่เขียน DB หรือ storage production เปรียบเทียบ direct SDK เดิมกับ transport ใหม่ด้วย input hash/model/settings เดียวกัน 1 ตัวอย่างต่องาน

| งานข้อความ | เดิม → ใหม่ (ms) | input tokens เดิม/ใหม่ | output tokens เดิม → ใหม่ |
| --- | ---: | ---: | ---: |
| สรุป | 2,330 → 1,964 | 151 / 151 | 131 → 119 |
| ปรับน้ำเสียง | 1,583 → 1,520 | 124 / 124 | 81 → 77 |
| เสนอคำตอบ | 3,360 → 3,834 | 424 / 424 | 302 → 322 |

ผ่านข้อกำหนดตัวอย่างเรื่องข้อมูลสำคัญ/ไม่แต่งตัวเลข การสกัดรุ่นผ่านข้อความทดสอบที่แทรกคำสั่งไม่เกี่ยวข้อง PDF อ่านรายได้/รายจ่ายรวมและรายเดือนได้ตรง fixture และ legacy credit path เรียก Sonnet 4.6 สำเร็จโดยไม่สร้าง manager approval snapshot

เป็น smoke sample ไม่ใช่ข้อพิสูจน์ว่าภาษาทุกคำดีขึ้น ทุกธนาคารแม่นยำ หรือ p95/ค่าใช้จ่ายลดลง ตัวอย่างข้อความปรับน้ำเสียงยังมีคำซ้ำในผลใหม่ พนักงานต้องตรวจร่างก่อนส่ง ค่าใช้จ่ายในรายงานคำนวณจาก token จริงและ rate card ใน repository ไม่ใช่ใบเรียกเก็บเงิน

หลักฐาน: [ผลเปรียบเทียบ provider](assets/2026-09-08-ai-workflow/provider-parity.json), [ผลโมเดลเครดิตที่แก้](assets/2026-09-08-ai-workflow/credit-provider-model.json)

## ปิดงานและเปิดใช้งาน

งานวิศวกรรมครบตามแผนแล้ว เหลือการอนุมัติ PR ตาม branch protection (`required_approving_review_count=1` และ CODEOWNERS), merge และติดตาม pipeline migration/API/Firebase จนผ่าน health check จึงจะถือว่า production อัปเดต ห้ามนำผลตรวจ local ไปนับเป็นผล deploy

การทดลองกับพนักงานใหม่ 3–5 คนยังไม่มีผู้ทดลองจริง ใช้ [แบบทดลองและบันทึกผล](2026-09-08-new-staff-trial.md) เพื่อเก็บเวลา การถามทาง การย้อนกลับ และความเข้าใจเรื่องร่าง AI/การอนุมัติ ไม่ใช้ browser automation แทนหลักฐานจากคน

## ตรวจซ้ำ

```bash
./tools/check-types.sh all
npm run test --workspace=apps/web
npm run test --workspace=@installment/shared
CREDIT_RUN_API_REGRESSION=1 bash tools/test-chat-credit.sh
npm run build --workspace=apps/api
npm run build --workspace=apps/web
npm exec --yes --package=node@20 -- node tools/verify-shared-runtime.cjs .
node --test tools/credit-ci.test.mjs tools/preview-chat-credit.test.mjs
```

Browser หน้าเริ่มงาน: `node tools/verify-staff-experience.mjs` หลัง build โดยมี baseline artifact ตามคำอธิบายสคริปต์

Preview รวมแบบแยกฐาน: `CREDIT_PREVIEW_PORT=5195 bash tools/preview-chat-credit.sh` แล้วใช้ `CREDIT_PREVIEW_ORIGIN=http://localhost:5195 node tools/check-staff-offer-preview.mjs` และ `tools/check-chat-credit-preview.mjs` ข้อมูลและ AI ของ preview เป็นตัวอย่าง ส่วน HTTP สต็อก เครื่องคิด และเครดิตใช้โค้ดจริง

ตรวจ provider จริงด้วย `tools/check-ai-provider-parity.ts` ต้องตั้ง explicit live opt-in และ credential ผ่าน environment ตามหัวไฟล์ ไม่ใส่ key ใน command argument หรือรายงาน
