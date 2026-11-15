# Dropdown ค้นหาได้ + สเกลช่องกรอก — design (ฉบับแก้หลัง scrutinize)

**วันที่:** 2026-11-14 · **ขอบเขตแอป:** `apps/web` หลังบ้าน (ใต้ `.app-shell`) + หน้านอกหลังบ้านที่ใช้ตัวกลางเดียวกัน (LIFF, หน้าสาธารณะ — เฉพาะข้อ S3-23) · **ไม่รวม** `apps/web-shop`
**Mockup ที่เจ้าของดูแล้ว:** canvas "มาตรฐานช่องกรอก ก่อน/หลัง" https://claude.ai/artifact/P9HZMn9fL6V17TdWyG5QDn
**ข้อมูลผลตรวจ:** `docs/reports/field-scale-audit-2026-11-14/` — `audit.json` (ทุก dropdown 346 จุด + ทุกข้อพบสเกล + ผลตรวจซ้ำ), `combobox-comparison.md`, `audit-tooling.md`, ภาพ `before-*.png`
**ประวัติ:** ฉบับแรกถูก scrutinize (ผู้ตรวจอิสระ 6 มุม + ตรวจหักล้าง — blocker 2 major 19 ยืนยัน) ฉบับนี้แก้ทุกข้อที่ยืนยันแล้ว ข้อที่เปลี่ยนจากฉบับแรกสรุปไว้ใน §11

## 1. ที่มาและเป้าหมาย

เจ้าของขอ (2026-11-14): "ปรับปรุง dropdown field ให้สามารถค้นหาได้ และดูสเกลของช่องว่ามีเพี้ยน หรือมีทับ หรือมีไม่สวยบ้างไหม"

1. **รอบ 1 — สเกล:** ช่องกรอกในแถวเดียวกันหน้าตาเข้าชุด (สูง มุม ขอบ พื้น ป้ายชื่อ) ไม่มีเมนูถูกตัด ไม่มีข้อความขาดกลางคำ และมีตัววัดที่**รันได้บนเครื่องที่ใช้ทำงาน**
2. **รอบ 2 — ค้นหา:** dropdown รายการยาวพิมพ์ค้นหาได้ ด้วยตัวกลาง `Combobox` ตัวเดียว และ combobox ที่มีอยู่ 6 ตัวย้ายมาใช้แกนเดียวกัน

## 2. ข้อเท็จจริงจากการตรวจ

- **ความสูงเท่ากันอยู่แล้ว** — `styles/admin-typography.css:46-56` (import แบบไม่อยู่ใน `@layer` ที่ `main.tsx:20` จึงชนะ utility ของ Tailwind) บังคับ input/select/select-trigger/`button[role=combobox]` ใต้ `body:has(.app-shell)` เป็น 44px + 14px (16px เมื่อจอ < 1024) ตั้งแต่ #1711 — วัดหน้า `/customers` แล้วทุกช่อง 44px
- **ที่ไม่เข้าชุดจริง:** มุมโค้ง (`Input`/`SelectTrigger`/`Textarea` ตั้งต้น 6px · `NativeSelect`/`formControlClass` 8px) · ขอบสองสี (`--input` 55% กับ `--border` 86%) · พื้นสองแบบ · "ช่องปลอม" ที่เป็น `div` เตี้ยกว่าช่อง · ป้ายชื่อ 2 แบบหลัก (`formLabelClass` 14px/12px กับ `text-xs`/`mb-1.5` และ shadcn `FormLabel` 12px/6px — ขนาดใช้พอ ๆ กัน ระยะแบบกะทัดรัดมากกว่า)
- **เมนูถูกตัด** — เมนู `absolute` ที่ไม่ portal ในกล่อง `overflow`: `AccountSearchDropdown` (4 ผู้ใช้: `ItemsTable`, `EditableJournalTable`, `AdjustmentTable`, `PettyCashLinesSection`), `SearchableSelect` (ที่อยู่), `TemplatePickerCombobox`, `NameAutocomplete`
- **บั๊กความกว้างเมนู** — `w-[--radix-popover-trigger-width]` (ไวยากรณ์ v3) ไม่ทำงานใน Tailwind 4.3 ที่ `ContactCombobox.tsx:134`, `EmployeeCombobox.tsx:70`, `AccountRolesPage.tsx:288`
- **dropdown 346 จุด**: HIGH 31 · MEDIUM 92 (สาขา 45) · LOW 223 · combobox เดิม 6 ตัว (ผู้ติดต่อ+3 wrapper, พนักงาน, ลูกค้าในใบจอง, ผังบัญชีใน GL/AccountRoles, `AccountSearchDropdown`)
- **LIFF:** ไม่มี dropdown และไม่มีข้อพบใน LIFF เอง · มีข้อเดียวที่กระทบหน้านอกหลังบ้าน: S3-23 `<Input>` ตัวอักษร 13px ⇒ iPhone ซูมเมื่อแตะช่อง
- **ร้านมี 1 สาขา** (เจ้าของยืนยัน) ⇒ ตัวเลือกสาขาไม่ต้องค้นหา
- **ตัววัดเดิมรันบนเครื่องนี้ไม่ได้** — `tools/docs-integration.sh` (ฐานของชุด `e2e/ui-fields`) ใช้ `/tmp` + Unix socket และไม่อยู่ใน CI · ที่รันได้บน Windows ตอนนี้คือ `npm run local:preview` (ทำให้รองรับ Windows ในงานนี้) ซึ่งตอบ 501 กับ endpoint ที่ไม่รองรับ

## 3. คำตัดสินของเจ้าของ (2026-11-14)

| เรื่อง | ตัดสิน |
|---|---|
| dropdown ที่ค้นหาได้ | เฉพาะรายการยาว — รายการสั้นคง `NativeSelect` |
| แอป | หลังบ้าน (+ LIFF/หน้าสาธารณะเฉพาะ S3-23) · ไม่รวมหน้าร้านออนไลน์ |
| ลำดับ | รอบ 1 สเกล → รอบ 2 ค้นหา |
| ความสูงช่อง | คง 44px ทุกที่ |
| แนวทางค้นหา | `Combobox` กลางตัวใหม่ (cmdk + Radix Popover) |
| แนวทางสเกล | ตัวกลาง + แก้จุด + ตัววัด |
| **ขอบเขต (หลัง scrutinize)** | **แผนเต็ม แก้ตามรายงาน** — คงการรวม combobox เดิม 6 ตัวและชุดวัด |
| **ป้ายชื่อ (ถามใหม่ด้วยข้อมูลที่ถูกต้อง)** | **แบบ A ทั้งระบบ** — 14px `font-medium` สี `foreground` ระยะ 12px รวมเปลี่ยนค่าตั้งต้นของ shadcn `FormLabel` |
| **มุมโค้ง** | **8px ที่ตัวกลาง** (`Input`, `SelectTrigger`, `Textarea`) |
| **dropdown สาขา** | **ไม่ทำ `BranchSelect`** (1 สาขา — ช่องค้นหาไม่มีวันโผล่) · คง `NativeSelect` · หยิบกลับมาเมื่อเกิน ~8 สาขา |
| ตัววัด | รายงาน ไม่บล็อก CI |

## 4. รอบ 1 — มาตรฐานหน้าตาช่อง

### 4.1 มาตรฐาน

| คุณสมบัติ | ค่า | ทำที่ไหน |
|---|---|---|
| สูง / ตัวอักษรในหลังบ้าน | 44px / 14px (16px จอ < 1024) | CSS กลางเดิม — ไม่แตะ |
| ตัวอักษรนอกหลังบ้าน (LIFF, หน้าสาธารณะ) | 16px บนจอ < 1024, 14px จอใหญ่ | `input.tsx` variant `md`: `text-base lg:text-sm` (S3-23) |
| มุมโค้ง | 8px | `input.tsx`, `select.tsx` (trigger), `textarea.tsx`: `rounded-md` → `rounded-lg` ทุก variant · `NumberInput` ได้ตามเพราะใช้ `inputVariants` |
| เส้นขอบ / พื้น | `border-input` / `bg-background` + `shadow-xs` | มีอยู่แล้วใน `inputVariants` / `formControlClass` |
| ค่าอ่านอย่างเดียว | 44px · ขอบ `border-input` · พื้น `bg-muted/80` (ตัวเดียวกับ `[readonly]` ของ `inputVariants`) · ตัวเลขชิดขวา `tabular-nums` | `ReadOnlyField` (§4.2) |
| ป้ายชื่อ | `formLabelClass` — 14px · `font-medium` · `foreground` · `mb-3` | **คำตัดสินเจ้าของ** (ไม่ใช่แบบที่ใช้มากสุด) · §4.3 |

### 4.2 ตัวกลาง (`apps/web/src/components/ui/`)

1. **มุม + ตัวอักษรของตัวกลางเดิม** — แก้ 3 ไฟล์ตาม §4.1 · อัปเดต `DESIGN.md` §4.1 (radius ของ input = 8px) และ `docs/guides/form-field-qa.md`
2. **`ReadOnlyField`** (ไฟล์ใหม่) — ห่อ `<Input readOnly tabIndex={-1}>` (ได้ 44px จาก CSS กลาง, ผูก `<label htmlFor>` ได้, ตัววัด F1 มองเห็น) · `data-slot="readonly-field"` · props `align: 'start' | 'end'` (`end` = ตัวเลข `tabular-nums`), `tone: 'default' | 'success' | 'warning'` (เก็บสีบอกสถานะที่บางการ์ดใช้ — ไม่ต้อง override className) · ใช้แทน "ช่องปลอม" ทุกจุดในภาคผนวก ก
3. **`LabeledField`** (ไฟล์ใหม่ — ไม่ใช้ชื่อ `FormField` เพราะชนกับ shadcn) สำหรับฟอร์มที่ไม่ใช้ react-hook-form — props `label`, `htmlFor`, `required` (ดอกจัน `text-destructive`), `hint`, `error` (ผูก `aria-describedby`) · ป้าย = `formLabelClass` · คืน `labelId` ให้ `Combobox` ใช้
4. **shadcn `FormItem`/`FormLabel`** (`form.tsx:60`, `:72-73`) — ค่าตั้งต้นเปลี่ยนเป็นแบบ A: `FormLabel` ใช้ `formLabelClass` (ตัด `text-xs`), `FormItem` ตัด `space-y-1.5` (ระยะมาจาก `mb-3` ของป้าย) · ลบ override `text-xs font-medium` ที่ผู้เรียก (3 ไฟล์ 27 `FormItem`) — ทำใน PR R1-4
5. **`NativeSelect` — ไม่บังคับหน้าตาที่ตัวกลาง** (บังคับแล้วจะสร้างความไม่เข้าชุดใหม่ 26 จุดที่ dropdown ตั้งใจใช้หน้าตาเดียวกับช่องข้าง ๆ เช่น `DunningSettingsPage.tsx:643/667`, และลบ `pl-9` ของไอคอนนำหน้า `TodoFilters.tsx:86`, และขอบเตือน `PeakMappingSettings.tsx:465`) แทนที่ด้วย:
   - prop ใหม่ `leadingIcon` (ตัวกลางจัดช่องไฟซ้ายเอง) และ `tone: 'default' | 'warning'` (ขอบเตือน) — ย้าย `TodoFilters:82` และ `PeakMappingSettings:465` มาใช้
   - ทำให้ dropdown + ช่องข้าง ๆ ใช้ `formControlClass` ตัวเดียว **ทีละไฟล์** ใน PR R1-3 (62 จุดที่หน้าตาไม่มาตรฐาน — 26 จุดมีช่องข้าง ๆ ใช้หน้าตาเดียวกันต้องแก้พร้อมกัน)
   - เทสสแกนโค้ด (แบบ `native-select.inventory.test.ts`) ห้ามส่ง `rounded-*`, `border-border`, `bg-*`, `px-*`/`pl-*` ผ่าน `className` ของ `NativeSelect` — เปิดใช้ใน R1-3 หลังแก้ครบ
6. **เมนูบัญชีถูกตัด (P1 S2-01, S2-02) — แก้ถาวรใน R1-2:** `AccountSearchDropdown.tsx` ไฟล์เดียว เปลี่ยนแผงเมนู `absolute` เป็น `Popover`/`PopoverContent` (portal) กว้าง `w-(--radix-popover-trigger-width) min-w-64` + ลูกศร/Enter/Esc · props เดิมไม่เปลี่ยน ⇒ ทั้ง 4 ผู้ใช้หายพร้อมกัน ไม่ต้องแก้กล่องรอบนอก · R2-3 ค่อยย้ายไส้ในไป `Combobox`
7. **บั๊กความกว้างเมนู** — 3 จุดใน §2 → `w-(--radix-popover-trigger-width) min-w-64` · เทสสแกนห้าม `/-\[--[a-z]/` (utility ใด ๆ ตามด้วยตัวแปร CSS เปล่า) ใน `apps/web/src`
8. **`bg-input` เป็นพื้นช่อง** — `DunningSettingsPage.tsx` (7 ช่อง — แก้ select + input พร้อมกันเป็น `formControlClass`), `SmsTemplateForm` · เทสสแกนห้าม `/(?<![\w-])bg-input\b/` ยกเว้น `ui/switch.tsx`, `ui/input-otp.tsx`

### 4.3 ป้ายชื่อแบบ A — ขอบเขต

"ทั้งระบบ" ในงานนี้ = (ก) ค่าตั้งต้นของ shadcn `FormLabel` (ทุกฟอร์มที่ใช้ shadcn Form ได้อัตโนมัติ) + (ข) 9 ฟอร์มที่ฝัง `AddressForm` (~170 ป้าย: `CompanySettingsPage` 28, `CustomerCreateDialog` 10 + 17 `FormLabel`, `CustomerCreateModal` 25, `CustomerEditModal` 24, `EditCustomerDialog` 23, `SupplierForm` 18 (มีแบบ A แล้ว 11), `QuickBuyModal` 17, `BranchesPage` 5, `CreateContactModal` 5) + (ค) ฟอร์มที่แก้ข้อพบในภาคผนวก ก (R1-3 ส่วนแรก) และฟอร์มที่รอบ 2 แปลงช่อง — **ไม่นับ**ไฟล์ที่ R1-3 แตะแค่เพื่อทำ class ของ dropdown ให้เข้าชุด (~74 ไฟล์ — ถ้านับจะกลายเป็นหลายร้อยป้าย) · ป้ายในแถวตารางแน่นและแถบกรองที่ป้ายอยู่ซ้ายช่องไม่เปลี่ยน · ฟอร์มอื่น (~700 ป้ายที่เขียนเอง) **ย้ายเมื่อมีงานแตะ** (ตามหลัก DESIGN.md "ไม่ refactor ถ้าไม่ได้แตะ") — ผลข้างเคียงที่รู้: หน้าต่างสูงขึ้น ~10px ต่อแถวช่อง ตรวจว่าไม่เกิดเลื่อนซ้อนในหน้าต่างที่สูงชิดจอ

## 5. ตัววัด (รันได้บนเครื่องนี้)

**ที่รัน:** สคริปต์ Node ใหม่ `tools/field-scale/check.mjs` แบบเดียวกับ `tools/check-admin-typography.mjs` — Playwright Chromium กับ `npm run local:preview` · endpoint ที่ preview ไม่รองรับใช้ `page.route()` ตอบข้อมูลสังเคราะห์ (ผังบัญชีจาก `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`, กฎทวงหนี้, แม่แบบ SMS, ตั้งค่า ฯลฯ) · ไม่ต้องพอร์ตฐาน docs-integration · ผลลัพธ์ `.tmp/field-scale/<label>/{results.json,report.md,*.png}`
**ตัวเก็บข้อมูล:** export ที่สองใน `tools/typography-audit/collect.js` (`window.__collectFields({ exclude, root })`) + `evaluateFields` ใน `rules.mjs` + เทส `node:test` — ห้ามเปลี่ยนผล R1–R12 เดิม
**หน้าที่วัด:** ทุกหน้าในภาคผนวก ก + 9 ฟอร์มใน §4.3 + ทุกหน้าที่ R2-4 แตะ · 1440 / 1024 / 390 · สว่าง/มืด · เปิดหน้าต่าง/แท็บตามขั้นที่กำหนดในสคริปต์ (คลิกเปิดเท่านั้น ไม่กดบันทึก ไม่เลือกค่าใน dropdown ที่บันทึกทันที)

| กฎ | นิยาม | ระดับ |
|---|---|---|
| **F1** | *control* = ตัวนอกสุดของ `[data-slot=input-wrapper]`, `[data-field-frame]`, input, select, `[data-slot=select-trigger]`, `button[role=combobox]`, `[data-slot=readonly-field]` · *แถว* = control ใน dialog หรือ `#main` เดียวกัน ที่กล่องซ้อนกันแนวตั้ง ≥ 50% และบรรพบุรุษร่วมใกล้สุดเป็น flex-row หรือ grid · ตรวจ: สูงต่าง > 2px · มุมต่าง > 1px · ตัวอักษรต่าง > 0.5px · สีขอบต่าง · **สีพื้นต่าง** · ขอบล่างเหลื่อม > 2px · **ป้ายชื่อ** (label ที่ผูกกับ control) ขนาดต่าง > 0.5px หรือระยะป้าย→ช่องต่าง > 2px · ยกเว้น: control ที่มี `text-lg`+ (ช่องยอดเงินใหญ่), textarea, checkbox/radio | P2 |
| **F2** | ข้อความถูกตัด: placeholder กว้างกว่าพื้นที่เนื้อหา (วัดด้วย canvas) · native select: **ตัวเลือกที่ยาวที่สุด** กว้างกว่าพื้นที่เนื้อหา (บันทึกแค่ตัวเลขกับ boolean ไม่บันทึกข้อความ) · Radix `[data-slot=select-value]` `scrollWidth > clientWidth + 1` **หรือ** `scrollHeight > clientHeight + 1` | P2 |
| **F3** | กล่องที่กดได้สองตัวทับกัน > 1px | P1 ถ้าทับพื้นที่กด ไม่งั้น P2 |
| **F4** | ไอคอน/หน่วย/ปุ่มล้างแบบ `absolute` ทับหมึกตัวอักษร หรือ padding ฝั่งนั้นไม่พอกันที่ | P2 |
| **F5** | **เทสสแกนโค้ด** (ไม่เปิดเมนูทุกหน้า): ห้ามเมนู `absolute` ที่ไม่ portal ใต้ trigger นอก allow-list (`NameAutocomplete`, `TemplatePickerCombobox`, `CatalogPicker`, `NoteMentionInput`, `SearchableSelect` จนถึง R2-2) · บวก Playwright หนึ่งกรณีต่อ component ใน allow-list ว่ากล่องรายการอยู่ในกรอบบรรพบุรุษที่ตัด · ตอนเขียนแผนสแกนพบเมนูแบบนี้อีก 8 ไฟล์ที่ spec ไม่ได้ระบุ (`BundleSearch`, `VariableAutocomplete`, `InstallmentPickerPopover`, `ExpensesPage` เมนูสร้างเอกสาร, POS `CustomerSearch`, `SettingsLayout` ค้นหา, `Customer360Panel` mention, `SessionActions`) — เข้า allow-list พร้อมเหตุผล ยังไม่แก้ในรอบนี้ · **พบจริง:** เมนู "ใช้แม่แบบ" (`TemplatePickerCombobox`) ล้นขอบจอที่ 1024 และ 390px — บันทึกเป็น known ในสคริปต์ รอเจ้าของตัดสินว่าจะแก้ในรอบนี้หรือไม่ | P1 |

- **ต้องวัดก่อนแก้:** R1-1 ส่งตัววัด + ผลบน `main` เป็น **baseline** ก่อน PR ที่เปลี่ยนหน้าตาใด ๆ
- **เกณฑ์รับ:** หน้าที่ PR แตะ F1–F4 ไม่เพิ่มจาก baseline และจุดที่ PR ตั้งใจแก้ = 0 · จุดที่ตั้งใจคงไว้บันทึกเหตุผลใน `tools/field-scale/allow.json`
- **ตัวตนของข้อพบ F1:** รายงานทีละ control ที่ไม่เข้ากับส่วนใหญ่ของแถว (คีย์ `<property>@<controlKey>` · ไม่มีส่วนใหญ่ = รายงานทุกตัว) — แก้ เปลี่ยนป้าย หรือเปลี่ยนชนิดช่องหนึ่ง ไม่ทำให้ข้อพบที่ยังค้างของช่องอื่นในแถวกลายเป็น "ใหม่" ตอนเทียบ baseline · ชื่อช่องในคีย์ใช้เฉพาะคำของป้ายเอง ไม่มีค่าที่กรอก ตัวเลือก หรือค่าที่เลือก
- **ทางเลือกเสริม (ไม่บังคับ):** งาน `workflow_dispatch` บน Linux ใน `documents-integration.yml` รันชุด `e2e/ui-fields` แบบ `continue-on-error` + อัปโหลดผล — สำหรับตรวจหน้าที่ preview ไม่มีข้อมูลพอ

## 6. รอบ 2 — `Combobox`

### 6.1 พฤติกรรม

- **ปุ่มเรียก** = `<button type="button" role="combobox">` ดิบผ่าน `PopoverTrigger asChild` (ไม่ใช้ `<Button>` — มีสีตอน hover/เปิดที่ช่องอื่นในแถวไม่มี) · class = `cn(formControlClass, 'flex items-center justify-between gap-2 text-left', className)` · ได้ 44px จาก CSS กลาง · ลูกศรขวาแบบ `NativeSelect` · ค่าที่เลือก `truncate` + `title`
- **กล่องรายการ** = `PopoverContent` (portal, พลิกเองตามพื้นที่) กว้าง `w-(--radix-popover-trigger-width) min-w-64` · `onWheel`/`onTouchMove` = `stopPropagation` + list `overscroll-contain` (ไม่งั้นเลื่อนด้วยล้อ/นิ้วใน Dialog แบบ modal ไม่ได้ — แบบเดียวกับ `WizardStackedOverlay.tsx:44-45`) · ไม่มี prop `container`/`modal` · `CommandItem` มี `leading-snug`
- **แสดงช่องค้นหาเสมอ** (`searchable` ค่าเริ่มต้น `true`; รายการสั้นใช้ `NativeSelect` อยู่แล้ว จึงไม่ต้องมีโหมด "auto") · โหมดค้นจากเซิร์ฟเวอร์บังคับ `true`
- **ค่าใน cmdk:** `CommandItem value` = คีย์ภายใน `opt:${index}` เสมอ — ไม่ใช้ `option.value`/`label` (ค่า `''` จะเลือกด้วยคีย์บอร์ดไม่ได้และกักลูกศรไว้แถวแรก; ป้ายซ้ำกันจะชนกัน) · เลือกผ่าน closure `onSelect` · ปิด filter ของ cmdk (`shouldFilter={false}`) ใช้ §6.2
- **เปิดแล้ว:** ไฮไลต์และเลื่อนไปที่ตัวที่เลือกอยู่ (ตั้ง `value` ของ `Command` เป็นคีย์ของตัวที่เลือก) · พิมพ์ค้นหาแล้วไฮไลต์ผลแรก
- **คีย์บอร์ด:** บนปุ่ม ArrowDown/Enter/Space เปิด · พิมพ์ตัวอักษรบนปุ่ม (`key.length === 1`, ไม่ใช่ช่องว่าง, ไม่มี ctrl/meta/alt, ไม่ `isComposing`) = เปิด + ใส่ตัวนั้นในช่องค้นหา · `onOpenAutoFocus` → `preventDefault` แล้วโฟกัสช่องค้นหาและวางเคอร์เซอร์ท้ายข้อความ (ไม่ให้ Radix เลือกข้อความทั้งช่องจนตัวถัดไปทับ) · บนจอสัมผัสโฟกัส `CommandList` แทนช่องค้นหา (ไม่เด้งคีย์บอร์ด) · Esc ปิดเฉพาะเมนู (Radix จัดชั้น — Dialog, Sheet, AlertDialog)
- **ARIA:** ชื่อ = ป้ายเท่านั้น (`<label htmlFor={id}>` — ปุ่ม label ได้ — หรือ `aria-labelledby`/`aria-label` จากผู้เรียก) · ค่าที่เลือกเป็นข้อความในปุ่ม · ตัวกลางไม่ตั้ง `aria-label` เอง (เทสเดิม `getByRole('combobox', { name: 'สาขา' })` ยังใช้ได้หลังเลือกค่า) · ส่งต่อ `id`, `ref`, `onBlur`, `aria-invalid`, `aria-describedby`, `aria-required` ⇒ ใช้กับ shadcn `FormControl` ได้
- **ตัวเลือกที่ปิด:** แสดง `disabledReason` เป็นข้อความรองในแถว (ไม่ใช่ tooltip — คีย์บอร์ดไม่ลงแถวที่ปิด)

### 6.2 ตัวค้นหาไทย `apps/web/src/lib/thai-search.ts`

- `normalizeThai(s)`: NFC · ตัด zero-width (U+200B–U+200D, U+FEFF) · พับ `/ํ([่-๋]?)า/g → '$1ำ'` (นิคหิต + วรรณยุกต์ + า) · `เเ` → `แ` · lowercase · trim · เลขไทย → อารบิก
- `rankMatch(option, query)` ลำดับ: (1) ป้ายขึ้นต้นด้วยคำค้น (2) ป้ายขึ้นต้นด้วยคำค้นเมื่อข้ามสระนำหนึ่งตัว `[เแโใไ]` หรือคำ (แยกด้วยช่องว่าง/เครื่องหมาย) ใด ๆ ขึ้นต้นด้วยคำค้น (ข้ามสระนำได้เช่นกัน) (3) มีคำค้นอยู่ข้างใน (4) ตรงกับ `keywords` (รหัส/เบอร์/ชื่อเล่น) · ไม่ตรง = ไม่แสดง
- เทสต้องยืนยัน**ลำดับ** (ไม่ใช่แค่ "แสดง"): ค้น `ช` → ชลบุรี, ชัยนาท, ชัยภูมิ, ชุมพร อยู่ก่อน เชียงใหม่ ซึ่งอยู่ก่อนจังหวัดที่มี `ช` กลางคำ · `น ํ ้ า` เจอ `น้ำ` · รหัสบัญชี `52-11` เจอจาก keywords

### 6.3 API

```ts
type ComboOption<M = unknown> = {
  value: string;           // อนุญาต '' — ภายในใช้คีย์ opt:${index}
  label: string;
  keywords?: string[];
  description?: string;
  group?: string;
  disabled?: boolean; disabledReason?: string;
  meta?: M;
};
```
props: `value: string | null` · `onChange(value, option)` · `options` · `selectedOption` (ค่าปัจจุบันที่ไม่อยู่ในรายการ เช่นผู้รับเดิม) · `placeholder` · `searchable` · `searchPlaceholder` · `emptyText` · `filter?` · ค้นจากเซิร์ฟเวอร์: `onSearchChange(term)` + `loading` + `error` + `onRetry` (ผู้เรียกถือ `useQuery`/`useDebounce`) · `onCreate?(term)` + `createLabel` + `createOnEnter` · `footer` · `clearable` · `pending` · `renderOption` / `renderValue` · `id` `required` (= `aria-required` + ดอกจัน **ไม่บล็อกการส่งฟอร์ม**) `disabled` `invalid` · `className` (ปุ่ม) `wrapperClassName` `contentClassName` `align` `side` · `open` / `onOpenChange`
**ไม่มี:** `name`/hidden input (ไม่มีโค้ดใดอ่านฟอร์มด้วยชื่อ) · `container`/`modal` · multi-select · ช่องพิมพ์อิสระ
**ภาษาไทยตั้งต้น:** `placeholder` "เลือก…" · `searchPlaceholder` "พิมพ์เพื่อค้นหา…" · `emptyText` "ไม่พบรายการ" · `loading` "กำลังโหลด…" · `error` "โหลดรายการไม่สำเร็จ" + ปุ่ม "ลองใหม่"

### 6.4 สิ่งที่แปลง

| กลุ่ม | ทำอะไร |
|---|---|
| ที่อยู่ (`AddressForm`) | **เขียนเทสการไหล จังหวัด → อำเภอ (รีเซ็ต) → ตำบล (รีเซ็ต) → รหัสไปรษณีย์ + โหมดแก้ไขที่มีค่าเดิม ก่อน** ให้ผ่านกับของเดิม แล้วสลับเป็น `Combobox` (ต้องผ่านเทสเดิม) → ลบ `SearchableSelect.tsx` + เทส (ย้ายกรณีคีย์บอร์ด/Esc) · แก้คอมเมนต์ `native-select.inventory.test.ts:48` · แก้ selector ใน `apps/api/e2e/ui-fields/fields.audit-spec.ts:167-186` |
| ผังบัญชี | `AccountCombobox` ตัวเดียว (คง `filter`, `blockedCodes`, `blockedReason`) แทน `AccountSearchDropdown` + ตัวเลือกบัญชีใน `GeneralLedgerPage.tsx:230-289` และ `AccountRolesPage.tsx:275-317` |
| combobox เดิม | `ContactCombobox` (+ Vendor/RepairCenter/Counterparty), `EmployeeCombobox`, `BookingsPage/CustomerCombobox` → เปลือกบางบน `Combobox` **คง API ภายนอก** · ต้องคงพฤติกรรม (เขียนเทสแบบ characterization ก่อนสลับ): ค่า = ชื่อที่แสดง (ไม่ใช่ id) และเครื่องหมายถูกเทียบด้วยชื่อ · query ของผู้ติดต่อไม่รอเปิดเมนู · `ensureRole` ระหว่างรอแสดงในรายการและปิดเมนูเมื่อสำเร็จเท่านั้น · Enter เมื่อไม่ตรงชื่อใดเปิดสร้างผู้ติดต่อ · ปุ่มสร้างลูกค้าเป็น footer · ปุ่มล้าง X แยก · งวด (period) ของพนักงาน |
| รายการยาว 23 ช่อง (ภาคผนวก ค) | พนักงาน 11 · บัญชี 3 · รุ่นสินค้า 5 · ผู้จัดจำหน่าย 2 · แม่แบบข้อความ 1 · extension โทรศัพท์ 1 — แปลงที่ call site ด้วย `options` (ไม่ทำ `StaffSelect` — endpoint/สิทธิ์ต่างกันทุกจุด ตัวกลางที่รับแค่ options ก็คือ `Combobox`) |
| **ไม่แปลง** | สาขา 45 จุด (1 สาขา) · วันที่ 1–31 (3 จุด) · สถานะสินค้า 15 ตัว และประเภทบล็อกแม่แบบ (รายการคงที่ — เหตุผลเดียวกับวันที่) · ≤ 7 ตัวเลือก · MEDIUM อื่นที่ไม่ใช่สาขา (เช่น เดือน) · เมนูนำทางมือถือ (`ReportsPage:123`, `SettingsLayout:113`) · `NameAutocomplete`, `CatalogPicker`, `NoteMentionInput`, `CommandPalette`, `CashAccountSelect` · `TemplatePickerCombobox` (เป็นเมนูคำสั่ง ไม่ใช่ตัวเลือก — ติด allow-list F5) |

### 6.5 การแปลงแต่ละช่อง (เฉพาะ 23 ช่องในภาคผนวก ค)

- `onChange={e => set(e.target.value)}` → `onChange={v => set(v)}` · การแปลงชนิดตามไปทุกจุด
- `required` แบบ native ในชุดนี้ **4 จุด**: `ProductInfoCard.tsx:234`, `StockAlertsPage.tsx:617`, `ChatFollowUpDialog.tsx:190`, `ChatServiceRequestDialog.tsx:114` — ตอนนี้พึ่งการแจ้งเตือนของเบราว์เซอร์อย่างเดียว ⇒ แต่ละจุดเพิ่ม `if (!value) { setError('กรุณาเลือก…'); return; }` ก่อนส่ง + `invalid` + ข้อความใต้ช่อง
- `register()` ของ react-hook-form: **ไม่มีในชุดนี้** (5 จุดที่มีอยู่ไม่แปลง)
- `<optgroup>` (2 จุด: `QuickReplyEditor.tsx:82`, `ExpensesPage.tsx:646`) → `group`
- sentinel ของ Radix (`ALL`/`FREE`) → `''` ภายใน แต่แปลงกลับเป็นค่าเดิมก่อนส่ง API
- ตัวเลือก "ค่าปัจจุบันที่ไม่อยู่ในรายการ" (`ChatServiceRequestCard.tsx:220`, `FacebookCommentPanel.tsx:124`) → `selectedOption`
- `FacebookCommentPanel.tsx:109` บันทึกทันทีเมื่อเปลี่ยน — คงพฤติกรรม (เรียกใน `onChange`) ห้ามบันทึกตอนเปิด/ค้นหา
- ค่าผสม `model|storage` (`ReferenceQuestionnaire.tsx:39`) คงรูปแบบเดิม

## 7. ลำดับ PR

| PR | เนื้อหา | ขึ้นกับ | ตรวจรับ |
|---|---|---|---|
| **R1-1** | ตัววัด §5 (`tools/field-scale/`, `__collectFields`, `evaluateFields` + เทส) · route mocks · **baseline บน main** | — | สคริปต์รันบนเครื่องนี้ได้ · baseline เก็บใน `.tmp/field-scale/baseline` + สรุปใน PR |
| **R1-2** | §4.2 ข้อ 1, 2, 3, 5 (props), 6, 7, 8 · S3-23 | R1-1 | เทสหน่วย + เทสสแกน · F1–F4 เทียบ baseline · Playwright: เมนูบัญชีเปิดอยู่ในการ์ดรายการและตาราง Override JV ที่ 1440 · ภาพ LIFF/หน้าสาธารณะ 390 |
| **R1-3** | ภาคผนวก ก (แถว R1-3) + ทำ `NativeSelect` + ช่องข้าง ๆ ให้ใช้ `formControlClass` ทีละไฟล์ (นับจริงตอนเขียนแผน: 110 จุด + ช่องข้าง ๆ 72 จุด ใน 74 ไฟล์ — ประมาณ 62 ในฉบับแรกต่ำไป · อีก ~102 จุดส่ง class ผ่านตัวแปร เทสสแกนมองไม่เห็น) + เปิดเทสสแกน §4.2 ข้อ 5 · แบ่งตามพื้นที่ | R1-2 | F1–F4 ของหน้าที่แตะ: จุดที่ตั้งใจแก้ = 0, ไม่เพิ่มจาก baseline |
| **R1-4** | ป้ายแบบ A §4.3: `form.tsx` + ลบ override 3 ไฟล์ + 9 ฟอร์มที่ฝัง `AddressForm` | R1-2 | F1 (ป้าย) = 0 ในฟอร์มเหล่านั้น · ภาพหน้าต่างที่สูงชิดจอไม่มีเลื่อนซ้อน |
| **R2-0** | mockup `Combobox` บน canvas เดิม: ปิด / เปิด / ค้นหา / ไม่พบ / กำลังโหลด / ผิดพลาด / ตัวเลือกปิด / ในหน้าต่าง / 390 | R1 ครบ | เจ้าของเคาะ |
| **R2-1** | `Combobox` + `thai-search` + polyfill `scrollIntoView` ใน `src/test/setup.ts` + ตัวช่วยเทส `pickComboOption` + เทส (คีย์บอร์ดรวมค่า `''` แถวแรก, Esc ใน Dialog/Sheet/AlertDialog, เลื่อนในหน้าต่าง, async, ล้างค่า, `FormControl`, IME, ลำดับค้นหาไทย) | R2-0 | เทสหน่วย |
| **R2-2** | `AddressForm` (เทสการไหลก่อน) → ลบ `SearchableSelect` | R2-1 | เทสการไหลผ่านทั้งก่อนและหลัง · F1 ใน 9 ฟอร์ม |
| **R2-3a** | `AccountCombobox` (บัญชี 4 ผู้ใช้ + GL + AccountRoles) | R2-1 | characterization tests · ภาพจอรายจ่าย/รายได้อื่น/GL |
| **R2-3b** | `ContactCombobox` (+3), `EmployeeCombobox`, `CustomerCombobox` | R2-1 | characterization tests ก่อนสลับ · e2e ใบจองที่มีอยู่ |
| **R2-4a** | แชท/งาน/ติดตามหนี้: พนักงาน 9 ช่อง (`ChannelFilter`, `ChatFollowUpDialog`, `ChatServiceRequestCard`, `ChatServiceRequestDialog`, `FacebookCommentPanel`, `TodoFilters`, `TodoForm`, `StuckContractsSection`, `ProspectFilterBar`) | R2-1 | เทสเข้มต่อช่อง (เปิด → เลือก → ตรวจค่าที่ส่ง) |
| **R2-4b** | สินค้า/สต็อก/ใบสั่งซื้อ/รับซื้อ: รุ่น 5 + ผู้จัดจำหน่าย 2 | R2-1 | เหมือนกัน · `ui-fields` selector ที่เกี่ยวข้อง |
| **R2-4c** | บัญชี/รายจ่าย: บัญชี 3 (`ExpensesPage`, `ItemLinesSection`, `RecurringBillDialog` — ใช้ `AccountCombobox`) | R2-3a | เหมือนกัน · แก้ `RecurringBillDialog.test` (`selectOptions` 9 จุด) |
| **R2-4d** | อื่น ๆ: `ChatAnalyticsPage`, `SalesHistoryPage`, `QuickReplyEditor`, `UserProfilePage` | R2-1 | เหมือนกัน |

ทุก PR แยก branch · revert ได้เป็นก้อน · ไม่ merge/deploy เอง

## 8. การทดสอบและยืนยันทุก PR

- **บน Windows (เครื่องนี้):** `npm run local:check` ยังไม่รองรับ ⇒ รันแยก: `bash tools/check-types.sh web` · `npm run lint --workspace=apps/web` · `npm run test --workspace=apps/web` · `npm run build --workspace=apps/web` · `npm run local:preview` + `tools/field-scale/check.mjs` · ระบุใน PR ว่ารันอะไรบน Windows และ `local:check` เต็มต้องรันบน Linux/CI (ตาม AGENTS.md ต้องรายงานสิ่งที่ไม่ได้ตรวจ)
- เทสหน่วยของตัวกลางตาม §7 · `native-select.test.tsx` / `native-select.inventory.test.ts` ผ่านตลอด
- **เทสที่ต้องแก้ (เฉพาะไฟล์ที่ช่องถูกแปลง):** `RecurringBillDialog.test.tsx` · `CreateBookingDialog.test.tsx` · `StepItems.test.tsx` · `ContactCombobox.test.tsx` · `EmployeeCombobox.test.tsx` · `GeneralLedgerPage.test.tsx` · `SearchableSelect.test.tsx` (ย้าย) · e2e `account-roles-admin.spec.ts:91`, `bookings.spec.ts:55`, `flows/booking-deposit-convert.spec.ts:47` · `apps/api/e2e/ui-fields` (`shared-controls` :74-92, `fields` :167-196) — ตรวจรายการจริงอีกครั้งตอนเริ่มแต่ละ PR ด้วย grep
- **ทุกช่องที่แปลงมีเทสเข้มอย่างน้อยหนึ่งกรณี** (เปิด → เลือก → ตรวจ state/พารามิเตอร์ที่ส่ง) — เพราะ e2e หลายตัวใช้ locator หลวม `select, [role="combobox"]).first()` ซึ่งจะไม่ล้มแต่จะเลิกทดสอบช่องนั้นไปเงียบ ๆ (admin-settings, expense-workflow, finance, reports-notifications, stock-management, template-editor, trade-in-flow)
- ภาพก่อน/หลัง 1440/390 สว่าง/มืด ของหน้าที่แตะ + ผลตัววัด §5 แนบใน PR
- agent `code-reviewer` ตรวจก่อนส่ง

## 9. ความเสี่ยงและข้อจำกัด

- **ป้ายแบบ A ทำให้หน้าต่างสูงขึ้น** ~10px ต่อแถว — หน้าต่างที่สูงชิดจออาจต้องเลื่อน · ตรวจในภาพ R1-4
- **มุม 8px ที่ตัวกลาง** กระทบทุกช่องพิมพ์ (~400 จุด) พร้อมกัน — เป็นการเปลี่ยนที่ตั้งใจ วัดด้วย F1 ก่อน/หลัง
- **ฟอร์มนอก 9 ฟอร์มยังมีป้ายแบบกะทัดรัด** จนกว่าจะมีงานแตะ — ความไม่สม่ำเสมอระหว่างฟอร์ม (ไม่ใช่ภายในฟอร์ม) ยังมีอยู่ชั่วคราว
- **combobox บนมือถือ** แทนตัวเลือกของเครื่องใน 23 ช่อง — ออกแบบหน้าจอ 390 ใน R2-0 · โฟกัสรายการแทนช่องค้นหาบนจอสัมผัส
- **ค่าอ่านอย่างเดียวในโหมดมืด** — ตรวจความต่างสีใน mockup R2-0 และภาพ R1-3
- **จอเงิน** (รายจ่าย เงินเดือน รายได้อื่น GL) ใน R2-3 — characterization tests ก่อนสลับ + ภาพก่อน/หลัง + ตรวจบันทึกจริงบน preview เท่าที่ endpoint รองรับ
- **ตัววัดใช้ข้อมูลสังเคราะห์** — ปัญหาที่เกิดเฉพาะข้อมูลจริง (ชื่อยาวมาก) อาจหลุด · F2 วัดตัวเลือกที่ยาวที่สุดของข้อมูลสังเคราะห์เท่านั้น
- ข้อพบในภาคผนวก ก ยืนยันบนเบราว์เซอร์แล้ว 3 (S1-04, S2-07, S3-04) ที่เหลือยืนยันด้วย baseline ของ R1-1

## 10. นอกขอบเขต

`apps/web-shop` · เอกสาร/ใบพิมพ์/สติกเกอร์/Tiptap · CSS กลาง · `BranchSelect` · ลบ size variant ที่ไม่มีผล · multi-select · เปลี่ยนความสูงช่อง · ป้ายของฟอร์มที่ไม่ได้แตะ (§4.3)

## 11. เปลี่ยนจากฉบับแรก (ผล scrutinize)

| ข้อพบ | เปลี่ยนอะไร |
|---|---|
| บังคับหน้าตาที่ `NativeSelect` สร้างความไม่เข้าชุดใหม่ 26 จุด + ลบช่องไฟไอคอน/ขอบเตือน (blocker) | ไม่บังคับที่ตัวกลาง · แก้ทีละไฟล์พร้อมช่องข้าง ๆ · prop `leadingIcon`/`tone` · เทสสแกน |
| ตัววัดรันบนเครื่องนี้ไม่ได้ (blocker) | สคริปต์บน `local:preview` + route mocks · baseline ก่อนแก้ |
| มาตรฐาน 8px ไปไม่ถึง | แก้มุมที่ตัวกลาง 3 ไฟล์ (คำตัดสินเจ้าของ) |
| ป้ายชื่อขัดกันเอง/ไม่ได้ประมาณงาน | ถามเจ้าของใหม่ → แบบ A · เปลี่ยน `FormLabel` + 9 ฟอร์ม ระบุขอบเขต §4.3 |
| เมนูบัญชีแก้ชั่วคราวไม่ครบ | portal ใน `AccountSearchDropdown` ไฟล์เดียว ถาวร ครบ 4 ผู้ใช้ |
| `BranchSelect` ไม่มีผลตอบแทน | ตัดออก (1 สาขา) |
| ค่า `''` ใน cmdk · เลื่อนในหน้าต่าง · คีย์บอร์ดตายเมื่อซ่อนช่องค้นหา · โหมด auto ผิดกับ async | คีย์ภายใน · ดัก wheel/touch · แสดงช่องค้นหาเสมอ |
| ชื่อ ARIA เปลี่ยนตามค่า · `required`/`name` ไม่มีผล · ไม่ไฮไลต์ค่าที่เลือก · ตัวอักษรตัวแรกถูกทับ · ตัวค้นหาไทยจัดสระนำผิด | §6.1–6.3 แก้ทุกข้อ |
| ไม่มีเทสการไหลของที่อยู่ · ตัวเลขไม่ตรงกัน · เทส/e2e ที่ต้องแก้ไม่ระบุ | §6.4, §6.5, §8 |
| PR ใหญ่ revert ไม่ได้ · ไม่บอกการพึ่งพา | แบ่งตามพื้นที่ + คอลัมน์ "ขึ้นกับ" |
| LIFF ประกาศในขอบเขตแต่ไม่มีงาน | ระบุชัด: ไม่มี dropdown · มีแค่ S3-23 (ทำใน R1-2) |
| ภาคผนวกภาษาอังกฤษตัดกลางคำ · S3-01 ไม่ใช่ข้อบกพร่อง | ภาคผนวก ก ภาษาไทย + คอลัมน์ PR/พิสูจน์ด้วย · S3-01 = ไม่มีงาน |

---

## ภาคผนวก ก — ข้อพบสเกลที่ตรวจซ้ำแล้ว

ระดับ: ยืนยัน = ผู้ตรวจอีกชุดหักล้างไม่ได้ · ลดระดับ = จริงแต่เบากว่าที่รายงาน · "เบราว์เซอร์" = วัดบน preview แล้ว

| รหัส | ระดับ | ไฟล์:บรรทัด | อาการที่เห็น | แก้อย่างไร | PR | พิสูจน์ด้วย |
|---|---|---|---|---|---|---|
| S1-01 | P1 ยืนยัน | `pages/DunningSettingsPage.tsx:638` | กล่องเพิ่ม/แก้กฎทวงหนี้: ทุกช่องพื้นเทากลาง ดูเหมือนกดไม่ได้ ตัวอักษรตัวอย่างแทบมองไม่เห็น | ทั้ง 7 ช่อง (ช่องพิมพ์ + dropdown) ใช้ `formControlClass` | R1-2 | F1 (สีพื้น) + เทสสแกน `bg-input` |
| S2-01 | P1 ยืนยัน | `pages/other-income/components/ItemsTable.tsx:72` | รายได้อื่น: เมนูเลือกบัญชีถูกการ์ดตัด เลือกบัญชีท้าย ๆ ไม่ได้ | portal ใน `AccountSearchDropdown` | R1-2 | Playwright เปิดเมนูที่ 1440 |
| S2-02 | P1 ยืนยัน | `pages/other-income/components/EditableJournalTable.tsx:104` | แก้รายการบัญชีเอง: เมนูบัญชีจมอยู่ในกล่องตาราง | เหมือน S2-01 | R1-2 | Playwright |
| S1-02 | P2 ยืนยัน | `pages/CompanySettingsPage.tsx:504` (+ `:226`) | แถว "สถานะ VAT / อัตรา VAT": ป้ายสองฝั่งไม่ตรงแนว ฝั่งซ้ายต่ำกว่า ~11px | แถวเป็น `items-start` · กล่อง checkbox `min-h-11 flex items-center` | R1-3 | F1 (ขอบล่าง/ป้าย) |
| S1-04 | P2 ยืนยัน · เบราว์เซอร์ | `pages/AuditLogsPage.tsx:303` | ประวัติการใช้งาน: ช่อง "รายการ" ขอบอ่อน พื้นใส ต่างจากอีก 3 ช่อง | `formControlClass` | R1-3 | F1 |
| S1-05 | P2 ยืนยัน | `pages/ChatbotFinanceKnowledgePage.tsx:301` | คลังความรู้บอท: แถว 3 คอลัมน์หน้าตาช่อง 3 แบบ ป้ายขนาดไม่เท่ากัน | `formControlClass` + `formLabelClass` ทั้งฟอร์ม | R1-3 | F1 |
| S2-03 | P2 ยืนยัน | `pages/RepossessionsPage.tsx:758` | รับเครื่องคืน: dropdown สถานะยืดเต็มความกว้างหน้า | `wrapperClassName="sm:w-56"` | R1-3 | ภาพ + F2 |
| S2-04 | P2 ยืนยัน | `pages/StockTransfersPage.tsx:379` (+ `:538`, `:655`) | โอนสินค้า 3 แท็บ: dropdown ยืดเต็มจอ | เหมือน S2-03 | R1-3 | ภาพ |
| S2-07 | P2 ยืนยัน · เบราว์เซอร์ | `pages/other-income/components/ItemsTable.tsx:182` | รายได้อื่น: "ก่อนภาษี" สูง 31px ตัวอักษร 12px · ช่องตัวเลขขอบอ่อนแต่ dropdown ขอบเข้มในแถวเดียวกัน | `ReadOnlyField` + ทั้งแถว `formControlClass` | R1-3 | F1 |
| S3-02 | P2 ยืนยัน | `components/contacts/ContactCombobox.tsx:134` | เมนูผู้ติดต่อ/ผู้ขายไม่กว้างเท่าช่อง กว้างแคบไปตามผลค้นหา | `w-(--radix-popover-trigger-width) min-w-64` | R1-2 | เทสสแกน `-[--` |
| S3-04 | P2 ยืนยัน · เบราว์เซอร์ | `components/expense-form-v4/ItemLinesSection.tsx:115` | บันทึกรายจ่าย: "ก่อนภาษี" สูง 38px ขอบอ่อน ขอบล่างเหลื่อม 5px | `ReadOnlyField` | R1-3 | F1 |
| S3-05 | P2 ยืนยัน | `components/expense-form-v4/AdjustmentSection.tsx:135` | บัญชีปรับผลต่าง: ช่องจริง 1 + กล่องค่า 2 สูง/มุม/ขอบต่างกัน | `ReadOnlyField` (คงสีพื้นด้วย `tone`) | R1-3 | F1 |
| S3-07 | P2 ยืนยัน | `components/expense-form-v4/PayrollLinesSection.tsx:731` | ใบเงินเดือน: dropdown บัญชีในคอลัมน์ 160px ข้อความขาดกลางคำ | คอลัมน์ `min-w-56` | R1-3 | F2 |
| S3-09 | P2 ยืนยัน | `components/expense-templates/RecurringBillDialog.tsx:321` | ตั้งบิลประจำ: ตัวเลือก "วิธีจ่าย"/"เดือน" ยาวเป็นประโยค ถูกตัด | ป้ายตัวเลือกสั้น ("ไม่ตั้ง") คำอธิบายย้ายไปใต้ช่อง · "เดือนที่ 1 ของไตรมาส" | R1-3 | F2 |
| S3-10 | P2 ยืนยัน | `components/trade-in/QuickBuyModal.tsx:817` | รับซื้อมือสอง: ช่องเบอร์โทร/เลขบัตรเหลื่อม 4px · ระยะป้าย 0/4/8/12px ปนกัน | ป้ายแบบ A ทั้งขั้น (เป็นหนึ่งใน 9 ฟอร์ม) | R1-4 | F1 (ป้าย) |
| S3-12 | P2 ยืนยัน | `components/ui/AddressForm.tsx:184` | ป้ายในกล่องที่อยู่ต่างจากฟอร์มที่ฝังมัน (17 จุดใน 9 ไฟล์) | ฟอร์มที่ฝังย้ายเป็นแบบ A | R1-4 | F1 (ป้าย) |
| S1-03 | P2→P3 ลดระดับ | `pages/InterestConfigPage.tsx:559` | ตั้งค่าดอกเบี้ย: กล่อง VAT % เตี้ยกว่าช่องข้าง ~5px | `ReadOnlyField` | R1-3 | F1 |
| S1-06 | P2→P3 ลดระดับ | `pages/BranchesPage.tsx:333` | รายการจังหวัด/อำเภอเปิดขึ้นบนในหน้าต่างที่เลื่อน ส่วนบนอาจถูกตัด (ขึ้นกับตำแหน่งเลื่อน) | `Combobox` portal | R2-2 | F5 (เทสสแกน) |
| S2-05 | P2→P3 ลดระดับ | `pages/TodosPage/components/TodoForm.tsx:475` | เพิ่มงาน: ช่องแท็กสูง ~62px ช่องอื่น 44px | `data-field-frame`/`data-field-embedded` + `min-h-11 py-1` | R1-3 | F1 |
| S2-08 | P2→P3 ลดระดับ | `pages/PurchaseOrdersPage/components/wizard/PaymentSection.tsx:209` | ใบสั่งซื้อ: ปุ่มเลือกรูป 40px ข้างช่อง 44px | `min-h-11` | R1-3 | F1 |
| S3-03 | P2→P3 ลดระดับ | `components/employees/EmployeeCombobox.tsx:70` (+ `pages/AccountRolesPage.tsx:288`) | เมนูพนักงาน/บทบาทบัญชีไม่กว้างเท่าช่อง | เหมือน S3-02 | R1-2 | เทสสแกน |
| S3-01 | — | `styles/admin-typography.css:46` | ข้อเท็จจริง: CSS กลางบังคับ 44px อยู่แล้ว | **ไม่มีงานแก้** | — | — |

ข้อพบระดับ P3 อีก ~37 ข้อ (ยังไม่ได้ตรวจซ้ำ) อยู่ใน `audit.json` — แก้เมื่ออยู่ในไฟล์ที่ PR แตะ หรือเมื่อ baseline ของ R1-1 ยืนยัน · S3-23 (ตัวอักษร 13px นอกหลังบ้าน) ทำใน R1-2

## ภาคผนวก ค — 23 ช่องที่แปลงเป็น Combobox

| PR | ไฟล์:บรรทัด (ใต้ `apps/web/src/`) | ช่อง | ตัวเลือก | ปัจจุบัน | หมายเหตุ |
|---|---|---|---|---|---|
| R2-4a | `pages/UnifiedInboxPage/components/ChannelFilter.tsx:245` | ผู้ดูแล | พนักงานแชท ~40 | Radix | sentinel ALL/FREE + ผู้ดูแลไม่รู้จัก · ปิดในแท็บ "ของฉัน" |
| R2-4a | `pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx:190` | ผู้รับผิดชอบงาน | พนักงานที่มีสิทธิ์ในห้อง ~30 | Native | **required** |
| R2-4a | `pages/UnifiedInboxPage/components/ChatServiceRequestCard.tsx:215` | ผู้รับผิดชอบ | พนักงานที่มีสิทธิ์ในห้อง ~30 | Native | ผู้รับเดิมอาจไม่อยู่ในรายการ → `selectedOption` |
| R2-4a | `pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx:114` | ผู้รับผิดชอบ | พนักงานที่มีสิทธิ์ในห้อง ~30 | Native | **required** |
| R2-4a | `pages/UnifiedInboxPage/components/FacebookCommentPanel.tsx:109` | ผู้รับผิดชอบคอมเมนต์ | พนักงาน ~40 | Native | บันทึกทันทีเมื่อเปลี่ยน · ผู้รับเดิม |
| R2-4a | `pages/TodosPage/components/TodoFilters.tsx:82` | ผู้รับมอบหมาย | พนักงาน ~40 | Native | ไอคอนนำหน้า · ตัวเลือก "ฉัน" |
| R2-4a | `pages/TodosPage/components/TodoForm.tsx:454` | ผู้รับมอบหมาย | พนักงาน ~40 | Native | — |
| R2-4a | `pages/CollectionsPage/components/StuckContractsSection.tsx:216` | ผู้รับผิดชอบใหม่ | พนักงาน ~40 | Native | — |
| R2-4a | `pages/CustomersPage/components/ProspectFilterBar.tsx:130` | ผู้ดูแล | พนักงาน ~40 | FilterSelect | กลุ่ม "ยังไม่มีผู้ดูแล" · กว้างแค่ 130px |
| R2-4b | `pages/ProductCreatePage/components/ProductInfoCard.tsx:234` | รุ่น | รุ่นสินค้า ~40 | Native | **required** · ปิดจนกว่าเลือกยี่ห้อ |
| R2-4b | `pages/StockAlertsPage.tsx:617` | รุ่น | รุ่นสินค้า ~40 | Native | **required** · เปลี่ยนแล้วตั้งหมวดตาม |
| R2-4b | `pages/PurchaseOrdersPage/components/wizard/items/AccessoryItemRow.tsx:114` | สำหรับรุ่น | รุ่นสินค้า ~50 | Native | ซ้ำทุกแถวใบสั่งซื้อ |
| R2-4b | `pages/TradeInPage/components/ReferenceQuestionnaire.tsx:39` | รุ่นและความจุ | รุ่น × ความจุ ~150 | Native | ค่าผสม `model\|storage` |
| R2-4b | `components/trade-in/QuickBuyModal.tsx:892` | รุ่น iPhone | แคตตาล็อกรับซื้อ ~40 | PurchaseSelect | เปลี่ยนแล้วรีเซ็ตความจุ/สี/แบบตรวจ |
| R2-4b | `pages/ProductCreatePage/components/BranchSupplierCard.tsx:55` | ผู้จัดจำหน่าย | ผู้จัดจำหน่าย ~100 | Native | ตัวเลือกแรกใช้เป็นข้อความโหลด/ผิดพลาด → `loading`/`error` |
| R2-4b | `pages/PurchaseOrdersPage/components/POListTab.tsx:498` | ผู้จัดจำหน่าย | ผู้จัดจำหน่าย ~100 | Radix | ตัวกรอง |
| R2-4c | `pages/ExpensesPage.tsx:646` | ประเภทค่าใช้จ่าย | ผังบัญชีค่าใช้จ่าย ~60 | Native | optgroup → `group` |
| R2-4c | `components/expense-form-v4/ItemLinesSection.tsx:70` | บัญชีค่าใช้จ่าย | ผังบัญชีค่าใช้จ่าย ~60 | Native | ซ้ำทุกรายการ · แสดงรหัส + ชื่อ |
| R2-4c | `components/expense-templates/RecurringBillDialog.tsx:307` | บัญชีค่าใช้จ่าย | ผังบัญชีค่าใช้จ่าย ~60 | Native | สาขาไม่รู้จัก → `selectedOption` |
| R2-4d | `pages/ChatAnalyticsPage.tsx:274` | พนักงาน | พนักงาน ~40 | Native | ป้าย = ชื่อ + ท้าย id |
| R2-4d | `pages/SalesHistoryPage.tsx:741` | พนักงานขาย | `/sales/salespersons` ~40 | Native | เฉพาะเจ้าของ/ผู้จัดการ |
| R2-4d | `pages/canned-response-admin/QuickReplyEditor.tsx:82` | เมื่อกด (แม่แบบตอบกลับ) | แม่แบบ ~50 | Native | optgroup · ซ้ำทุกปุ่ม |
| R2-4d | `pages/UserProfilePage.tsx:135` | Extension Yeastar | `/yeastar/extensions` ~30 | Radix | ป้าย "เบอร์ — ชื่อ" |
