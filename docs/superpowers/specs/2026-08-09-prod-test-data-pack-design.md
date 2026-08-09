# Prod Test-Data Pack — ขยายชุด TEST- ให้เทสได้ครบทุกระบบ (2026-08-09)

## เป้าหมาย

เจ้าของต้องการเทสระบบทั้งหมดบน **production** ด้วยข้อมูลเทสที่ (1) แยกจากข้อมูลจริงชัดเจน
(2) ลบทิ้งได้หมดจดหลังจบ รวมถึง JE ที่ post ระหว่างเทส (3) ครอบคลุม flow หลักทุกตัว:
รับชำระ/ใบเสร็จ, ติดตามหนี้/หนังสือทวง, ยึดเครื่อง (JP5 + CN + เงินคืน 21-1107),
ปิดยอดก่อนกำหนด (JP4), POS ขายสด, เปิดสัญญาผ่อนใหม่ทั้ง workflow, trade-in,
ค่าใช้จ่าย/เงินเดือน (DRAFT ผ่าน UI — ไม่ต้อง seed)

ต่อยอด pattern เดิมที่พิสูจน์แล้ว: `seed-test-contracts.cli.ts` (data-only, ไม่ post JE ตอน seed;
JE เกิดจากการใช้งานจริงผ่านแอป) + `cleanup-test-contracts.cli.ts` (กวาด JE ผ่าน
`metadata.contractId` hard-delete คืน Trial Balance + soft-delete เอกสาร)

## การตัดสินใจ (approved โดยเจ้าของ 2026-08-09)

- Environment: **production** (นิสัยการเทสของเจ้าของ — เทสบน prod จริง)
- แนวทาง: **ขยายชุด TEST- เดิม** (ไม่ clone DB, ไม่สร้างระบบใหม่)
- Coverage: ครบทุกระบบ

## ส่วนที่ 1 — ขยาย `seed-test-contracts.cli.ts`

### 1.1 สินค้า TEST (ใหม่)

- **ทุกสัญญา TEST ได้เครื่อง TEST ของตัวเอง** — เดิม CLI ชี้ `product.findFirst()` =
  เครื่องจริงเครื่องแรกใน prod ซึ่งอันตรายกับ flow ยึดเครื่อง (Repossession ผูก product
  one-to-one + เปลี่ยน status เครื่องจริง) จึงเปลี่ยนเป็นสร้าง product ต่อสัญญาใน tx เดียวกัน
  - marker: `imeiSerial` ขึ้นต้น `TEST-` (ใช้เป็น cleanup key), ชื่อขึ้นต้น "ทดสอบระบบ"
  - `isOnlineVisible: false` (กันโผล่หน้าเว็บ shop สาธารณะ), `status: SOLD_INSTALLMENT`,
    `ownedByCompanyId: FINANCE` (เครื่องติดสัญญาผ่อน — กรรมสิทธิ์อยู่ FINANCE)
- **เครื่องว่าง IN_STOCK 3 เครื่อง** (PHONE_NEW / PHONE_USED / ACCESSORY) —
  `ownedByCompanyId: SHOP`, `isOnlineVisible: false` — ไว้เทส POS ขายสด + เปิดสัญญาใหม่ทั้ง flow
  ผ่าน UI จริง (เครื่องจะถูกตัด status ตามระบบจริง)

### 1.2 Scenario ใหม่ (จาก 5 → 7)

| # | Label | สถานะ | ไว้เทส |
|---|---|---|---|
| 1-5 | (เดิม) ครบกำหนดวันนี้ / ค้าง 1-3 งวด / งวดอนาคต | ACTIVE | รับชำระ, ติดตามหนี้, ปรับดิว, ค่าปรับ |
| 6 | ยึดเครื่อง (TERMINATED ค้าง 4 งวด) | **TERMINATED** | JP5 + ใบลดหนี้ CN + เงินคืน 21-1107 + ปุ่มไม่คืนเงิน (ผ่าน gate `jp5_require_terminated_status`) |
| 7 | ใกล้ปิดยอด (จ่ายแล้ว 4/6 งวด) | ACTIVE | ปิดยอดก่อนกำหนด JP4 + ส่วนลด 52-1106 |

- Scenario 7 pre-mark งวด 1-4 = PAID (`amountPaid`, `paidDate`, `paymentMethod: CASH`,
  `recordedById`) ตาม convention ของ dev seed — data-only ไม่มี JE/ใบเสร็จย้อนหลัง
  (เหมือน 2B-flow เดิมของ CLI นี้: JE เกิดตอนกดปิดยอดจริงในแอป)
- default count เปลี่ยนจาก 10 → `SCENARIOS.length` (7) เพื่อได้ครบทุก scenario อย่างละ 1

### 1.3 ลูกค้า TEST เปล่า 2 คน (ไม่มีสัญญา)

- ไว้เทส: สมัครลูกค้าใหม่, credit check, trade-in, เปิดสัญญาใหม่, จอง
- marker เดิมที่ CLI ใช้อยู่แล้ว: `addressCurrent = 'ข้อมูลทดสอบระบบ — ลบได้'` (exact string)
- กันสร้างซ้ำเมื่อรัน CLI ซ้ำ (เช็คชื่อ+ยังไม่ถูกลบก่อนสร้าง)

## ส่วนที่ 2 — ขยาย `cleanup-test-contracts.cli.ts`

### 2.1 นิยาม "สัญญาเทส" กว้างขึ้น (สำคัญ)

สัญญาที่เปิดใหม่ผ่าน UI ระหว่างเทสจะได้เลขจริง `BCP-...` ไม่ใช่ `TEST-` — cleanup
จึงขยายเงื่อนไขเป็น: `contractNumber LIKE 'TEST-%'` **OR** `customerId ∈ ลูกค้าเทส
(address marker)` **OR** `productId ∈ เครื่องเทส (imei TEST-)`

### 2.2 ตารางที่กวาดเพิ่ม (ทั้งหมด soft-delete ยกเว้น JE = hard-delete ตามเดิม)

| ตาราง | เงื่อนไข |
|---|---|
| `repossessions` | contractId ∈ สัญญาเทส |
| `contract_letters` | contractId ∈ สัญญาเทส (cron 09:15 สร้างหนังสือ 45D/60D ให้สัญญาค้างอัตโนมัติ) |
| `contract_cancellations` | contractId ∈ สัญญาเทส (+ null FK `reversalJournalEntryId` ก่อนลบ JE) |
| `installment_schedules` | contractId ∈ สัญญาเทส |
| `sales` | productId ∈ เครื่องเทส OR customerId ∈ ลูกค้าเทส OR contractId ∈ สัญญาเทส |
| `finance_receivables` | saleId ∈ ใบขายเทส |
| `sales_commissions` | saleId ∈ ใบขายเทส OR contractId ∈ สัญญาเทส (กันค่าคอมพนักงานเกินจริง) |
| `trade_ins` | customerId ∈ ลูกค้าเทส |
| `products` | imeiSerial LIKE 'TEST-%' (รวมเครื่องที่เกิดจาก trade-in ถ้ากรอก IMEI ขึ้นต้น TEST- ตามคู่มือ) |
| `customers` | address marker (ครอบลูกค้าเปล่าด้วย) ∪ เจ้าของสัญญาเทส |

**FK guard ก่อน hard-delete JE** (review 2026-08-09): ลบ `journal_post_audit_logs` (Restrict)
+ null `contract_cancellations.reversal_journal_entry_id` (NO ACTION) ก่อน `journal_lines` →
`journal_entries` เสมอ — ไม่งั้น transaction ทั้งก้อน abort กลางทางบน prod

**Dry-run/live พิมพ์ identity เสมอ** (review 2026-08-09): เลขสัญญา (flag ตัวที่เปิดผ่าน UI),
IMEI+ชื่อเครื่อง, ชื่อลูกค้า, เลขใบขาย — เป็นด่านสุดท้ายให้คนรันตรวจตาก่อนยืนยัน เพราะ marker
IMEI เป็น free text (เครื่องจริงที่พนักงานเคยกรอก IMEI ขึ้นต้น TEST- จะโดนกวาดไปด้วย)

- JE sweep เดิม (`metadata.contractId`) ครอบ JE ทุกชนิดที่เทสได้: 2B, JP4, JP5, CN-related,
  refund 21-1107, **รวม JE จาก cron กลางคืน** (2A accrual, ECL provision) ซึ่งยืนยันแล้วว่า
  stamp `metadata.contractId` ทุกตัว

### 2.3 สิ่งที่ cleanup **ไม่** ครอบ (documented residue)

- audit_logs (immutable by design), ช่องว่างเลขรันใบเสร็จ/ใบขาย (ไม่ reclaim)
- JE รอบจ่าย interco (`metadata.items[]` ไม่มี contractId) — **คู่มือห้าม** approve
  รอบจ่ายที่มีสัญญาเทส; ถ้าพลาดให้ reverse batch ผ่าน UI ก่อนรัน cleanup
- เอกสารบัญชีที่สร้างเองระหว่างเทส (ค่าใช้จ่าย/เงินเดือน/รายได้อื่น) — void/reverse ผ่าน UI
  ก่อนรัน cleanup (เป็น flow เทสของมันเองอยู่แล้ว)

## ส่วนที่ 3 — คู่มือเทส

`docs/guides/TEST-ON-PROD-PLAYBOOK.md` (ภาษาไทย) — ลำดับเทสทีละระบบ: ใช้สัญญา/เครื่อง/ลูกค้า
ตัวไหน หน้าจอไหน คาดหวังอะไร + ข้อห้าม:

1. ห้ามกด MDM lock/ผูก MDM กับสัญญาเทส (ไม่มีเครื่องจริง)
2. ห้ามรวมสัญญาเทสในรอบจ่าย interco ที่ approve จริง
3. เอกสารบัญชีที่ post ระหว่างเทสต้อง void/reverse ก่อน cleanup
4. เทส trade-in ให้กรอก IMEI ขึ้นต้น `TEST-` เสมอ
5. ระหว่างมีข้อมูลเทสค้าง รายงาน (TB/P&L/ECL/ภ.พ.30 preview) จะมีตัวเลขสัญญาเทสปน —
   หายหมดหลังรัน cleanup

## วิธีรัน (prod)

```bash
npm --prefix apps/api run build
# ผ่าน cloud-sql-proxy + gcloud owner (ตาม runbook เดิม)
# ชื่อ DB จริงคือ "bestchoice" (ไม่ใช่ bestchoice_prod)
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run seed:test-contracts        # dry-run
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run seed:test-contracts
# หลังเทสเสร็จ
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run cleanup:test-contracts     # dry-run
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run cleanup:test-contracts
```

## ความเสี่ยงที่รับทราบ

- JE จากการเทส + cron กลางคืนปนใน GL ชั่วคราวระหว่างช่วงเทส — ออกแบบมาแบบนี้ตั้งแต่ CLI เดิม,
  cleanup hard-delete คืนสภาพ
- JP5 บนสัญญา data-only (ไม่มี 1A JE) จะออก JE ฝั่ง gain เต็มมูลค่ายึด (GL clearing legs = 0) —
  ตัวเลขไม่สมจริงแต่ flow ครบ และถูกกวาดทิ้งตอน cleanup
