# BESTCHOICE Sales Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้หมวดขายทั้ง 6 เมนูให้สิทธิ์ ตัวเลข สถานะ และงานที่ทำต่อสอดคล้องกัน พร้อม UX/UI ที่ใช้ได้จริงบน desktop และ mobile

**Architecture:** คง SalesService facade, BookingsService และ ContractLifecycleService ตามหน้าที่เดิม ใช้กติกาสิทธิ์และเงินร่วมกันตรงจุดที่ซ้ำ โดยไม่สร้างระบบ SalesDraft ใหม่หรือรวมทุกธุรกรรมเข้าฟังก์ชันเดียว คง wizard สัญญาเป็นทางขายผ่อน และแยกการแก้ข้อมูลผิดออกจากการเปลี่ยนนโยบายธุรกิจ

**Tech Stack:** React/TypeScript, React Query, react-hook-form, Tailwind/shadcn, NestJS, Prisma/PostgreSQL, Decimal, Vitest/Jest/Playwright ตามเวอร์ชันที่ล็อกใน repository

**Spec:** [audit.md](../../review/2026-09-11-sales/audit.md), [scrutinize.md](../../review/2026-09-11-sales/scrutinize.md) — ใช้ข้อจำกัดและคำแก้ความเข้าใจใน scrutinize เป็นหลักเมื่อข้อเสนอรอบแรกนำหน้าความสามารถ API

## Global Constraints

- “งานหน้าร้าน = SHOP; งานการเงิน = FINANCE” — ใช้ตัวเลือกงาน/บริษัทชุดเดียวใน sidebar; รักษา company grants และตัวกรองรายงานที่ตั้งใจเปรียบเทียบ
- “Money: use `Decimal` (`@db.Decimal(12, 2)`), never `Float`” — รักษาวิธีปัดเศษและผลรวมตารางผ่อนเดิมจนมีการเปลี่ยนนโยบายที่ระบุชัด
- “Design tokens: CSS variables in `index.css` — ห้ามใช้ hardcoded hex/gray colors, ใช้ tokens เท่านั้น” — คง Zinc/Emerald, IBM Plex Sans Thai และ component เดิม
- ใช้ `ui-ux-pro-max` ที่ใช้ทำ audit เป็นแนวทาง UX/UI; ไม่เอา landing-page pattern หรือสีใหม่มาแทน design system ของระบบงาน
- อ่าน `AGENTS.md`, `.claude/CLAUDE.md` และ workflow ที่ตรงงานก่อนแก้โค้ด; API ใหม่อ่าน `workflows/add-api-endpoint.md`; migration อ่าน `workflows/prisma-changes.md`
- ทุกชุดมี regression test ของพฤติกรรมที่ผิดจริง; API/เงินต้องผ่าน `tools/test-chat-credit.sh` บน PostgreSQL ชั่วคราว ไม่ใช้ DATABASE_URL ของแอปที่สืบทอดมา
- ก่อนส่งมอบโค้ดรัน `npm run local:check`; API/shared/schema ต้องใช้ backend ที่เริ่มใหม่จาก checkout เดียวกัน และทดสอบ flow ที่ limited preview ไม่รองรับด้วย API จริงในฐานทดสอบ
- ไม่แก้ข้อมูลบัญชีย้อนหลังจากการคาดเดา ไม่ merge/deploy อัตโนมัติ และรักษางาน/process ของ session อื่น

---

## สถานะและลำดับทำงาน

แผนนี้เขียนจาก revision `dce7ae7054624a7b791fa39cb48995c901232bab` บน branch `fix/lifecycle-spec-self-approval` วันที่ 11 กันยายน 2569 เจ้าของยืนยันให้เริ่มดำเนินการแล้วด้วย `ok` ชุด A และ B ผ่าน review/tests/local check แล้ว; ชุด C–D ยังเปิดอยู่ ดูหลักฐานและสถานะล่าสุดใน [remediation-verification.md](../../review/2026-09-11-sales/remediation-verification.md) ก่อนเริ่มแต่ละชุดตรวจ diff ใหม่เพื่อไม่ทับการแก้ของผู้อื่น

| ลำดับ | แผนย่อย | งาน | ผลส่งมอบที่ตรวจรับแยกได้ |
|---|---|---|---|
| 1 | [Core correctness](2026-09-11-sales-core.md) | A1–A5 | สิทธิ์ใบขายครบทุก endpoint, ราคาสดถูกประเภท, ยอดรับไฟแนนซ์ไม่ถูกนับล่วงหน้า, preview ผิดพลาดไปเซ็นต่อไม่ได้ |
| 2 | [Bookings](2026-09-11-sales-bookings.md) | B1–B4 | มัดจำรับแล้วแก้เงินเงียบ ๆ ไม่ได้; ผูกเครื่อง รับเงินส่วนต่าง หมดอายุ และ convert ถูกต้องใน transaction |
| 3 | [Contracts](2026-09-11-sales-contracts.md) | C1–C3 | quote กับ create ใช้ค่าชุดเดียว; เงินดาวน์มีช่องทางรับจริง; ทางสร้างสัญญามีกติกาเดียว |
| 4 | [Reports and UX/UI](2026-09-11-sales-ux-reports.md) | D1–D5 | ยอดรวม/export/วันไทยถูกต้อง; pagination, สิทธิ์ปุ่ม, การส่งต่อ, ลายเซ็น และหน้าตาครบ 6 เมนู |

**เริ่มที่ A1 → A2 → A3 → A4 → A5 → B1** ก่อนการปรับ layout ขนาดใหญ่ หลังจากนั้นทำ B2–B4, C1–C3, D1–D5 ตามลำดับ การแก้เล็กที่เป็นอิสระ เช่น D3 หน้าลูกค้าล้นมือถือ สามารถแทรกได้ แต่ต้องไม่แทนการแก้เงิน/สิทธิ์ที่ยังค้าง

ใช้การทำงาน inline ทีละ task เพื่อไม่ชนไฟล์กลางเดียวกัน Review โค้ดตาม `.claude/CLAUDE.md` ก่อนปิดชุด; การ review เอกสารแผนนี้เป็น self-review ไม่ต้อง dispatch agent

## สิ่งที่จะรวมและสิ่งที่ยังมีหน้าที่แยกกัน

| ส่วน | การตัดสินใจ | เหตุผล |
|---|---|---|
| ขอบเขตสาขา/ข้อมูลต้นทุน/PII ของใบขาย | ใช้ policy ร่วมทุก read endpoint | ปิดช่อง detail/summary ข้ามกติกา list |
| การตรวจเครื่องก่อนขายและ convert | ใช้ validator ที่รับ transaction และ actor ชุดเดียว | ต้องเช็กสาขา สภาพสินค้า สต็อก และฝั่งข้อมูลก่อนตัดเครื่อง |
| คำนวณผ่อน | quote และ create ใช้ resolver เดียว | สูตรเดียวแต่ config คนละชุดยังทำให้ยอดผิด |
| สร้างสัญญาผ่อน | `/contracts` และ lifecycle เดิมเป็นมาตรฐาน | ไม่เปิด INSTALLMENT writer เก่าใน POS เพื่อให้ตรงต้นแบบ |
| ลูกค้า/เครดิต | คงหน้าค้นหาและคิวตรวจ; deep link ไปขั้นตอนถัดไป | เป็นคนละงานและสิทธิ์ ไม่ควรรวมเป็นฟอร์มใหญ่หน้าเดียว |
| ใบจอง/ใบขาย/สัญญา | คงเอกสารและสถานะแยก; เชื่อมด้วย ID ที่ตรวจสอบได้ | จองและรับเงินไม่เท่ากับขายสำเร็จหรือเปิด ACTIVE |
| pagination/export/cache | reuse hooks/components; helper ร่วมเฉพาะส่วนที่ใช้ซ้ำจริง | ลดความต่างโดยไม่สร้าง framework ครอบทั้งแอป |
| หน้ารายการ/รายละเอียด | ใช้ PageHeader, filters, status badges, error/retry และ action pattern ร่วม | รายละเอียดและจำนวนคอลัมน์ยังปรับตามงานของแต่ละหน้า |

## UX/UI รายหน้าและงานตรวจรับ

| เมนู | รูปแบบที่จะทำ | สถานะ/หน้ารองที่ต้องตรวจ |
|---|---|---|
| ลูกค้า | ค้นหา+ตัวกรอง+รายการ; รายละเอียดมีข้อมูลสรุปและปุ่มงานถัดไปตามสิทธิ์; แท็บเลื่อนได้ในกรอบมือถือ | list, create/edit, detail ทุกแท็บ, documents, credit return, loading/empty/error, export |
| ตรวจเครดิต | คิวตามสถานะพร้อมจำนวนจริง; เหตุผลรอเอกสาร/รอพิจารณาชัด; คลิกลูกค้าตรงรายและกลับสัญญาเดิมได้ | list หลายหน้า, filters, detail/หลักฐาน, approved/rejected/expired/no AI score, permitted actions |
| ขายสินค้า | ขั้นเลือกลูกค้า/สินค้า → เงื่อนไข → ทบทวน; desktop summary ด้านข้าง, mobile summary/ปุ่มหลักไม่บังฟอร์ม | CASH, EXTERNAL_FINANCE, ส่งต่อผ่อน, เปลี่ยนสินค้า/ราคา, discount/ของแถม/เทิร์นตามที่รองรับ, success/error |
| การจอง/มัดจำ | แสดงสถานะ เวลา และยอด “มัดจำที่รับแล้ว / ต้องรับเพิ่ม”; timeline เงิน; เลือกสินค้าเป็นเครื่องจริงได้ | create/edit, pending, paid, expired, cancelled/refund, convert, concurrent/conflict และ legacy หลายรายการ |
| สัญญาผ่อนชำระ | list/kanban ที่ระบุ scope จริง; wizard เดิมใช้ quote กลาง; detail เน้นงานถัดไป เอกสารและตารางผ่อน | 3 ขั้นสร้าง, กลับจากเครดิต, review, sign ทุก signer, 503/retry, draft/active/rejected/cancelled, guardian, table/kanban/export |
| ยอดขาย | ชื่อ menu/title ใช้ “รายการขาย” ให้ตรงงาน; ตัวกรองวัน/สาขาชัด; summary ไม่เปลี่ยนตาม page; detail แยกเงิน/เอกสาร | list หลายหน้า, filters, sale detail, voided/includeVoided, export ทั้งชุด/หน้าปัจจุบัน, กำไร OWNER, ข้ามสาขา |

ทุกหน้าทดสอบ 1440px และ 390px รวม keyboard focus, labels, dialog focus กลับปุ่มเดิม, ปุ่ม pending ป้องกันกดซ้ำ, ข้อความผิดพลาดที่ทำต่อได้ และ page-level overflow ห้ามใช้การซ่อน overflow ทั้ง body กลบเนื้อหาที่เข้าถึงไม่ได้

ต้นแบบ [prototype.html](../../review/2026-09-11-sales/prototype.html) ใช้ดู hierarchy และการจัดวางเท่านั้น ปุ่ม/ข้อมูลจำลองในต้นแบบไม่ใช่ acceptance ของ API ส่วนมัดจำ→ผ่อน/ไฟแนนซ์อยู่ในขอบเขตการออกแบบระยะขยายด้านล่าง

## ขอบเขตเงินและความเข้ากันได้ที่ตัดสินใจไว้

1. **PAID booking:** ในชุดแก้แรกแก้ได้เฉพาะหมายเหตุ/วันหมดอายุที่ยังอนุญาตตามสถานะ; เปลี่ยนลูกค้า สาขา รายการ หรือยอดมัดจำให้ปฏิเสธพร้อมเหตุผล การเปลี่ยนเงินต้องผ่านยกเลิก/คืนเงินหรือคำสั่งปรับเงินที่บันทึกบัญชี ไม่ใช้ PATCH เงียบ ๆ
2. **Convert:** รองรับ CASH ตาม API ปัจจุบัน; ชุดแรกแปลงได้เมื่อมีสินค้าจริงหนึ่งเครื่อง quantity=1 และไม่มีรายการเงินอื่นที่ writer จะทิ้ง ไม่เปลี่ยนใบจองเก่าหลายรายการให้เป็นใบขายไม่ครบ; แจ้งให้จัดการรายการก่อนแปลง โดยไม่ลบหรือหารเงินมัดจำเอง
3. **การถือสต็อก:** ใบจองปัจจุบันไม่ได้เท่ากับ ProductReservation จึงไม่แสดง “ล็อกเครื่องแล้ว”; ตรวจ stock ใหม่ใน transaction ตอน convert คงการ preempt stock reservation ที่มีอยู่
4. **หมดอายุ:** จุดรับเงิน/แปลงต้องปฏิเสธทันทีเมื่อถึงกำหนด แม้ cron ยังไม่รัน; คงนโยบายริบเงินของ PAID เดิม; PENDING ที่หมดอายุไม่ลงรายการริบเงินเพราะยังไม่รับเงิน
5. **ดาวน์สัญญา:** คงเวลารับเงินพร้อม create ที่ระบบใช้อยู่ พร้อมบอกบนปุ่มทบทวนให้ชัด เพิ่มวิธีรับจริงและข้อมูลอ้างอิง; ไม่เปลี่ยนเป็นระบบร่างที่ยังไม่รับเงินโดยเงียบ ๆ
6. **VAT:** C1 ทำให้ preview และ create ใช้ effective config เดียวกัน; ไม่เปลี่ยน VAT policy จากตัวอย่าง fixture เอกสารธุรกิจแยก SHOP/FINANCE แต่ resolver ปัจจุบันอิงสาขา ต้องแสดงแหล่งที่มาของ VAT ในผล quote และบันทึกความต่างไว้ก่อนงานเปลี่ยนนโยบายแยก
7. **ข้อมูลเดิม:** แก้โค้ดให้รายการใหม่ถูกก่อน สร้างรายงาน read-only หา finance zero-down / มัดจำบัญชี metadata ไม่ตรง / สัญญาขาดวิธีรับเงิน; ไม่ตั้งค่า BANK_TRANSFER หรือสร้าง receipt ย้อนหลังเมื่อไม่มีหลักฐาน

## ระยะขยายที่แยกออกจากชุดแก้ข้อผิดพลาด

การใช้มัดจำร่วมกับผ่อนหรือ external finance จะเปิดได้เมื่อมีสเปกและ tests ครบ: เงินหนึ่งก้อนใช้ได้ครั้งเดียว; customer/product/branch ตรง; เงินมัดจำ/ดาวน์/เครดิตเทิร์นแยกแหล่ง; rollback เมื่อสร้างสัญญาไม่ผ่าน; void/refund/rejection/expiry คืนสิทธิ์เงินอย่างถูกต้อง; SHOP/FINANCE posting ไม่ซ้ำ; สถานะของใบจองและเอกสารปลายทางเชื่อมกัน งานนี้ไม่ใช่การนำ bookingId ไปเติม DTO แล้วหักเลขบนหน้าเว็บอย่างเดียว

การย้ายลำดับเมนู การรวมคิวทั้งหมดในหน้าเดียว และการทำ cash-received dashboard ใหม่ ให้ทดสอบงานจริงกับพนักงานหลังชุด A–D ผ่าน ใช้ task completion, การเลือกซ้ำ, ข้อผิดพลาด และความเข้าใจยอดเป็นเกณฑ์ ไม่ใช้ความสวยของ mockup เป็นหลักฐานว่างานเร็วขึ้น

## Coverage: ข้อค้นพบ → งานแก้

| Finding | Task | Finding | Task |
|---|---|---|---|
| F01 scope | A2 | S01 quote | C1 |
| F02 paid mutation | B1 | S02 detail projection | A2 |
| F03 missing product | B2 | S03 duplicate lifecycle | C3 |
| F04 partial multi-item conversion | B2 | S04 tender | C2 |
| F05 cash price | A3 | S05 finance received | A4 |
| F06 profit aggregate | D1 | S06 product policy | B2 |
| F07 export | D2 | S07 expired conversion | B4 |
| F08 deposit account/method | B3 | S08 prototype boundary | C3, D3, ระยะขยาย |
| F09 pagination | D2 | | |
| F10 CTA roles | D3 | | |
| F11 handoff | D3 | | |
| F12 signers | C3 | | |
| F13 preview failure | A5 | | |
| F14 stale cache | D3 | | |
| F15 pending expiry | B4 | | |
| F16 mobile overflow | D4 | | |
| F17 semantics | D1, D4 | | |
| F18 Thai dates | D1, B4 | | |

## Task M1: ตรวจรับครบวงจรและส่งมอบ

**Files:** รายงานผลใหม่ `docs/review/2026-09-11-sales/remediation-verification.md`; evidence ใหม่แยกจาก diagnostic เดิม; tests อยู่ตามแผนย่อย

**Interfaces:** รับผล A1–D5 และ HTTP/browser/DB evidence; ส่งมอบ status ต่อ finding เป็น fixed / remaining / policy extension พร้อม commit และ test ที่รองรับ

- [ ] ตรวจ flow ขายสด→void, จอง→รับมัดจำ→รับส่วนต่าง→ขาย, จอง→ยกเลิก/หมดอายุ, เครดิต→สร้าง→ลงนาม→activate, external→รอรับ→settle โดยใช้เงิน/สต็อก/ledger ในฐานชั่วคราว
- [ ] ทวน SALES, BRANCH_MANAGER, OWNER, FINANCE_MANAGER, ACCOUNTANT ที่มี/ไม่มีสิทธิ์บริษัทและไม่มีสาขา; detail/deep link ต้องให้ผลตรง list
- [ ] รันชุด PostgreSQL ที่เพิ่ม test discovery แล้ว และ `LOCAL_PREVIEW_PORT=5207 npm run local:check` หากพอร์ตยังเป็น managed preview ของ checkout นี้ มิฉะนั้นเลือกพอร์ตว่างใหม่
- [ ] เก็บภาพจริงครบตาราง UX/UI พร้อม success/loading/empty/error; รายงานแยกสิ่งที่จำลอง เช่น AI, OTP, storage และการรับเงินจริง
- [ ] อัปเดต coverage matrix จากผลทดสอบ ไม่ใช้ diagnostic เดิมที่ “ผ่านเมื่อทำซ้ำ bug ได้” เป็นหลักฐานว่าแก้แล้ว
- [ ] ตรวจ diff เฉพาะไฟล์งานนี้ แล้ว commit เป็นชุดเล็กที่ผ่าน review/test; ไม่ stage ทั้ง repository และไม่ merge/deploy

**เกณฑ์ปิดแผน:** A–D และ M1 ผ่านทั้งหมด ข้อผิดพลาด 18+8 มี evidence ปิดหรือระบุข้อจำกัดนโยบายอย่างตรงไปตรงมา; feature ระยะขยายไม่แอบเปิดใน UI; local server จาก checkout ที่แก้ยังทำงานและมี URL ส่งมอบ

## ผลตรวจแผนก่อนเริ่ม

- เอกสาร 5 ไฟล์: แผนหลัก1 + แผนย่อย4; task headings รวม18 (A5+B4+C3+D5+M1)
- มี mapping ครบ F01–F18 และ S01–S08; ตรวจ local Markdown links และ code-fence/whitespace แล้ว
- แก้ dependency ที่อาจติดขัดแล้ว: B4 ทำ cutoff วันไทยได้เองก่อน D1; C3 ใส่ draft-report guard ในชุดเดียวกับ legacy parity แล้ว D1 ใช้ต่อ
- ชื่อไฟล์ที่ยังไม่มีระบุเป็นไฟล์สร้างใหม่; migration อยู่หลังลำดับที่มีใน revision นี้ ต้องทวนลำดับอีกครั้งเมื่อเริ่ม execution
- ขณะจัดทำแผนแก้เฉพาะเอกสาร; หลังยืนยันเริ่ม execution ได้คืน dependency ตาม lockfile แล้ว (A1) ผลตรวจ implementation แยกอยู่ในรายงาน verification
