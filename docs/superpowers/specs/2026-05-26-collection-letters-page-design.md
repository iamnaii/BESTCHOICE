# Collection Letters Management Page (`/letters`) — Design

**Date:** 2026-05-26
**Status:** Approved (revised after scrutinize — pending implementation plan)
**Owner:** BESTCHOICE Collections module
**Revision:** v2 — blockers จาก scrutinize ปิดในส่วน 3.1, 4.4, 5.3, 5.4, 6.x

---

## 1. Background

Backend ระบบจดหมายแจ้งเตือนลูกค้าค้างชำระ (`ContractLetter`) ทำงานเต็มแล้ว:

- Cron `letter-auto-generate.cron.ts` รันทุก 15:00 BKK สร้างจดหมาย 2 ประเภท:
  - `RETURN_DEVICE_45D` — เรียกคืนอุปกรณ์ (ค้าง 45 วัน)
  - `CONTRACT_TERMINATION_60D` — บอกเลิกสัญญา (ค้าง 60 วัน)
- Endpoints `/overdue/letters/*` มีครบ: list, mark-pdf-generated, dispatch, delivered, undeliverable, revert-undeliverable, cancel
- Components `LetterDispatchDialog`, `LetterPdfPreviewDialog`, hooks `useLetterQueue`, `useLetterActions` มีอยู่ใน codebase แต่**ไม่ถูก import ที่ใดเลย** (orphaned)
- มีกราฟ `letterDispatchByType` ใน `AnalyticsTab` แต่ไม่มี UI ให้บริหารจัดการ queue

**ผลปัจจุบัน:** ทีมไม่รู้ว่าจดหมายฉบับไหนยังไม่ถูกพิมพ์ ฉบับไหนพิมพ์แล้วยังไม่ส่ง ฉบับไหนตีกลับ → ความเสี่ยงการดำเนินคดีล่าช้า

## 2. Goals

1. หน้าเดียวที่เห็น lifecycle ทั้ง 5 status ของจดหมาย (PENDING_DISPATCH → PDF_GENERATED → DISPATCHED → DELIVERED/UNDELIVERABLE/CANCELLED)
2. ลด friction การพิมพ์ (bulk PDF generation)
3. บันทึก **tracking number ไปรษณีย์** ทุกฉบับที่ส่ง
4. Export Excel สำหรับ audit / รายงานผู้บริหาร
5. รองรับ filter หลายมิติ (สาขา/ประเภท/ช่วงวันที่/ค้นหา)

## 3. Non-Goals

- ไม่ทำ upload ภาพหลักฐานในรอบนี้ (schema มี `evidencePhotoUrl` รองรับอยู่แล้ว — เพิ่มภายหลัง)
- ไม่ override cron logic การสร้างจดหมายอัตโนมัติ
- ไม่ทำ courier API integration (Thailand Post tracking webhook) — ใส่ tracking number แบบ manual ก่อน
- ไม่ทำ S3 upload ของ PDF ที่ render ฝั่ง client (ดู 3.1)

## 3.1 Key Decisions from Scrutinize (Revision v2)

| # | Issue | Decision |
|---|---|---|
| Blocker #1 | `markPdfGenerated` ต้อง pdfUrl แต่ client render PDF เอง ไม่ upload S3 | Backend ทำ `pdfUrl` **optional** + accept body ว่างเปล่า `{}` → store `null`. ลด complexity, ไม่กระทบ audit (มี `pdfGeneratedAt` + AuditLog เก็บผู้ทำ) |
| Blocker #2 | `renderLetterPdf` return Blob → merge ไม่ได้ | Refactor exposing `renderLetterPdfDoc(data): Promise<jsPDF>` (return doc). Existing `renderLetterPdf(data): Promise<Blob>` กลายเป็น wrapper `(await renderLetterPdfDoc(data)).output('blob')`. Bulk merge ใช้ doc แรกแล้ว `doc.addPage()` + copy pages จาก subsequent docs |
| Blocker #3 | List response shape เปลี่ยน | **Breaking change accepted** — consumer เดียวคือ orphan `useLetterQueue` (ลบทิ้งแน่นอนเพราะถูก supersede). Document ใน CHANGELOG ของ commit |
| Blocker #4 | Search filter `q` ไม่มี backend | เพิ่มจริง: `where.OR = [{ letterNumber: {contains: q, mode: 'insensitive'} }, { contract: {contractNumber: {contains: q, mode: 'insensitive'}} }, { contract: {customer: {name: {contains: q, mode: 'insensitive'}}} }]`. Verify index `Customer.name` (สร้างถ้าไม่มี) |
| Major #5 | Auto-mark on Print = unreliable | Auto-mark **เฉพาะ Download** (file ออกแน่นอน). กรณี Print → toast 10 วินาที พร้อมปุ่ม "✓ ทำเครื่องหมายพิมพ์แล้ว" — ถ้าไม่กดอะไรไม่ flip |
| Major #6 | YAGNI: ย้าย components เป็น shared | **ไม่ย้าย**. เปลี่ยน import path เป็น `@/pages/CollectionsPage/components/LetterDispatchDialog` etc. ตามตำแหน่งจริง. (ถ้า CollectionsPage cleanup ในอนาคต ค่อยย้ายตอนนั้น) |
| Major #7 | Bulk dispatch loop ไม่ atomic + tracking# loss | **เพิ่ม bulk endpoint** `POST /overdue/letters/bulk/dispatch` body=`{ items: [{id, trackingNumber, evidencePhotoUrl?}] }`. Service ใช้ `$transaction` validate ทุก item ก่อน update + create audit log แบบ batch |
| Minor #8 | Cancel role policy ไม่ชัด | ระบุชัดในตาราง 5.2 + UI ซ่อน Bulk Cancel button จาก ACCOUNTANT/SALES |
| Minor #9 | SALES branch scope | ใช้ `branch-access.util.ts:CROSS_BRANCH_ROLES` แทน hard-code `=== 'BRANCH_MANAGER'` — ครอบคลุม SALES อัตโนมัติ |
| Minor #10 | Tracking# auto-increment | เป็น UI convenience สำหรับ booklet — ไม่ใช่ business rule. validation regex ยังเป็น warning only |

## 4. Architecture

### 4.1 Routing & Menu

```
Route:       /letters
Layout:      MainLayout (sidebar + topbar)
Lazy load:   React.lazy(() => import('@/pages/LettersPage'))
Permission:  ProtectedRoute roles={['OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES']}
BranchGuard: BM และ SALES เห็นเฉพาะสาขาตัวเอง
             (สอดคล้องกับ apps/api/src/modules/auth/branch-access.util.ts → CROSS_BRANCH_ROLES)
```

**Menu entry** (apps/web/src/config/menu.ts):
- เพิ่มใต้รายการ "ค้างชำระ/ติดตามหนี้" ใน 5 role configs ที่มีอยู่
- Label: `จัดการจดหมาย` · Icon: `Mail` (lucide-react)

### 4.2 Page Structure

```
LettersPage/
  index.tsx                  ← entry point + tab state
  components/
    LetterTabs.tsx           ← 5-status tab bar with count badges
    LetterFiltersBar.tsx     ← branch, type, date range, search
    LetterTable.tsx          ← rows + checkbox column + per-row actions
    LetterBulkActionsBar.tsx ← sticky bottom bar when ≥1 selected
    BulkPrintDialog.tsx      ← preview merged PDF + print/download
    ExportExcelButton.tsx    ← exports current filtered view
  hooks/
    useLettersList.ts        ← TanStack Query — params: status, branchId, letterType, from, to, q
    useBulkLetterActions.ts  ← orchestrates bulk dispatch / cancel / undeliverable
  utils/
    mergeLetterPdfs.ts       ← jsPDF.addPage() loop → single PDF
    lettersToExcel.ts        ← exceljs workbook → Blob download
```

### 4.3 Reuse Existing (No Moves — YAGNI)

| Asset | Path | Action |
|---|---|---|
| `useLetterActions` | `pages/CollectionsPage/hooks/useLetterActions.ts` | **Import as-is** จาก `/letters` |
| `useLetterQueue` | `pages/CollectionsPage/hooks/useLetterQueue.ts` | **Delete** (orphan + superseded by `useLettersList`) |
| `LetterDispatchDialog` | `pages/CollectionsPage/components/LetterDispatchDialog.tsx` | **Import as-is** |
| `LetterPdfPreviewDialog` | `pages/CollectionsPage/components/LetterPdfPreviewDialog.tsx` | **Import as-is** |
| `letterPdfRenderer.ts` | `pages/CollectionsPage/utils/letterPdfRenderer.ts` | **Refactor in place** — เพิ่ม `renderLetterPdfDoc(data): Promise<jsPDF>` export; เดิม `renderLetterPdf(data): Promise<Blob>` กลายเป็น wrapper |

Justification: components/hooks เหล่านี้ orphan ใน CollectionsPage อยู่แล้ว — `/letters` เป็น **first consumer**. ไม่มี 2nd consumer ใน CollectionsPage เพื่อให้ "shared" location มีความหมาย → ไม่ย้าย (ลด churn diff + ไม่กระทบ CollectionsPage test)

## 5. UI Specification

### 5.1 Page Layout

```
┌──────────────────────────────────────────────────────────┐
│ 📨 จัดการจดหมาย                          [📊 Export Excel]│
├──────────────────────────────────────────────────────────┤
│ [รอพิมพ์ 12] [พิมพ์แล้ว 5] [ส่งแล้ว 89] [ตีกลับ 2] [ยกเลิก 3]│
├──────────────────────────────────────────────────────────┤
│ 🔍 ค้นหา (เลขจดหมาย/เลขสัญญา/ชื่อลูกค้า)                  │
│ Filter: สาขา ▼ | ประเภท ▼ | สร้างเมื่อ 📅 [จาก-ถึง]       │
├──────────────────────────────────────────────────────────┤
│ ☑ │เลขจดหมาย    │ลูกค้า  │สัญญา      │ประเภท         │วันที่ │Action     │
│ ─┼─────────────┼────────┼───────────┼───────────────┼──────┼───────────┤
│ ☑│ST-2026-00012│สมชาย   │C-2025-101 │เก็บอุปกรณ์ 45ว│20/5  │[👁] [📦ส่ง]│
│ ☑│ST-2026-00013│วันดี   │C-2025-102 │บอกเลิก 60ว   │20/5  │[👁] [📦ส่ง]│
│ ☐│ST-2026-00014│มานี    │C-2025-103 │บอกเลิก 60ว   │19/5  │[👁] [📦ส่ง]│
├──────────────────────────────────────────────────────────┤
│ ◀ STICKY: เลือก 2 ฉบับ │ [🖨 พิมพ์รวม] [📦 ส่งแล้ว] [✕ ยกเลิก] │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Tab → Action Matrix

Cancel/Bulk Cancel จำกัด role = **OWNER + FINANCE_MANAGER + BRANCH_MANAGER** เท่านั้น (UI ซ่อนปุ่มจาก ACCOUNTANT, SALES)

| Tab (Status) | Row Action | Bulk Action | Detail |
|---|---|---|---|
| **รอพิมพ์** (PENDING_DISPATCH) | 👁 Preview · ✕ Cancel (OWNER/FM/BM) | 🖨 Bulk Print · ✕ Bulk Cancel (OWNER/FM/BM) | Bulk print auto-mark `PDF_GENERATED` เฉพาะ Download (ดู 5.3) |
| **พิมพ์แล้ว** (PDF_GENERATED) | 👁 Preview · 📦 Mark Dispatched · ✕ Cancel (OWNER/FM/BM) | 📦 Bulk Mark Dispatched · ✕ Bulk Cancel (OWNER/FM/BM) | Bulk dispatch ผ่าน bulk endpoint atomic (ดู 5.4) |
| **ส่งแล้ว** (DISPATCHED) | ✅ Mark Delivered · ⚠ Mark Undeliverable | ⚠ Bulk Mark Undeliverable | Single ✅ delivered ไม่ทำ bulk เพราะปกติรู้ทีละราย |
| **ตีกลับ** (UNDELIVERABLE) | ↶ Revert to Dispatched | — | Revert ภายใน undo window (30s) ถ้าตีกลับโดยพลาด |
| **ยกเลิก** (CANCELLED) | view-only | — | แสดง `cancelReason` |

### 5.3 Bulk Print Flow (Auto-Mark เฉพาะ Download)

```
1. ผู้ใช้เลือก row หลายอันใน tab "รอพิมพ์"
2. กด [🖨 พิมพ์รวม]
3. BulkPrintDialog เปิด:
   - Frontend loop: for each letter
       → renderLetterPdfDoc(data) → jsPDF instance
       → if first: keep as base doc
         else: copy pages เข้า base doc ผ่าน addPage() + setPage()
   - แสดง preview multi-page PDF (ผ่าน <iframe src={blobUrl}>)
4. ผู้ใช้เลือก 1 ใน 3:
   (a) [📥 ดาวน์โหลด PDF] → save Blob เป็น letters-batch-YYYYMMDD-HHmm.pdf
       → **AUTO-MARK** ทุก id เป็น PDF_GENERATED (file ออก deterministic แล้ว)
   (b) [🖨 พิมพ์] → window.print() บน iframe → ไม่ auto-mark
       → แสดง toast ค้าง 10 วินาที พร้อมปุ่ม [✓ ทำเครื่องหมายพิมพ์แล้ว]
       → ถ้า user กดปุ่ม = mark / ถ้าไม่กด = ไม่ flip
   (c) [ปิด] → ไม่ทำอะไร

Auto-mark execution (a + b confirmed):
   - Loop call POST /overdue/letters/:id/pdf-generated body={} (pdfUrl optional ตาม 3.1 #1)
   - Toast: "ทำเครื่องหมายพิมพ์แล้ว N ฉบับ — ย้ายไปแท็บ พิมพ์แล้ว"
   - Invalidate query
   - ถ้า fail บางฉบับ → toast แสดงรายการที่ค้าง + DB state ตามจริง
```

**Edge cases:**
- PDF render fail (font load fail) → dialog แสดง error, ไม่ proceed, ไม่ flip
- Page copy fail (jsPDF internal) → log Sentry, fallback แยกไฟล์ทีละจดหมาย
- เลือก > 50 ฉบับ → warning "พิมพ์รวมเกิน 50 ฉบับอาจช้า — แนะนำแบ่ง batch"

### 5.4 Bulk Dispatch (Mark Sent — Atomic)

```
1. ผู้ใช้เลือก row หลายอันใน tab "พิมพ์แล้ว"
2. กด [📦 ส่งแล้ว]
3. BulkDispatchDialog เปิด:
   - แสดง list ลูกค้า + ช่อง tracking number ทีละแถว
   - [ใช้ tracking ต่อเนื่อง]: input prefix + base number → auto-fill EM 123 456 789 TH, EM 123 456 790 TH, ...
     (convenience สำหรับ booklet number ต่อกัน — ไม่ใช่ business rule)
   - Validate per row: tracking number ≥ 5 ตัวอักษร (ห้ามว่าง),
     format ไปรษณีย์ไทย /^[A-Z]{2}\d{9}TH$/i = soft warning (ไม่ block)
4. ยืนยัน → POST /overdue/letters/bulk/dispatch
              body: { items: [{ id, trackingNumber, evidencePhotoUrl? }, ...] }
5. Backend ใช้ $transaction:
   - Validate ทุก item ก่อน (status === PDF_GENERATED + trackingNumber ≥ 5)
   - ถ้า validation fail แม้แต่ 1 item → reject ทั้ง batch (atomic)
   - Update + audit log ทุก item ใน transaction เดียว
6. Toast สรุป "ส่งแล้ว N ฉบับ" + invalidate
```

**Why bulk endpoint (not loop):**
- Atomicity: ถ้า fail กลางทาง tracking# ที่ user พิมพ์ไว้ไม่หาย (ทั้ง batch retry)
- Throughput: 1 transaction << 50 individual transactions
- Audit clarity: batch_id ใน metadata แต่ละ AuditLog entry → trace ได้

### 5.5 Export Excel

ไฟล์: `letters-YYYYMMDD-HHmm.xlsx`

| Column | Source |
|---|---|
| เลขจดหมาย | `letterNumber` |
| เลขสัญญา | `contract.contractNumber` |
| ชื่อลูกค้า | `contract.customer.name` |
| สาขา | `contract.branch.name` |
| ประเภทจดหมาย | `letterType` → Thai label |
| สถานะ | `status` → Thai label |
| สร้างเมื่อ | `triggeredAt` (BKK) |
| พิมพ์เมื่อ | `pdfGeneratedAt` |
| ส่งเมื่อ | `dispatchedAt` |
| Tracking No. | `trackingNumber` |
| ลูกค้ารับเมื่อ | `deliveredAt` |
| ตีกลับ/ยกเลิก เหตุผล | `cancelReason` |
| ผู้ส่ง | `dispatchedBy.name` |

ใช้ library `exceljs` (มีอยู่แล้วในโปรเจกต์ — bundle split chunk จาก v3 hardening)
Export = current filtered view (เคารพ filter ที่ผู้ใช้เลือก)

## 6. Backend Changes

### 6.1 Role Expansion (Breaking-compatible)

`apps/api/src/modules/overdue/overdue.controller.ts` ปัจจุบัน:

| Endpoint | Current `@Roles` | New `@Roles` |
|---|---|---|
| GET `letters` | OWNER, FM, BM | + ACCOUNTANT, SALES |
| POST `letters/:id/pdf-generated` | OWNER, FM | + BM, ACCOUNTANT, SALES |
| POST `letters/:id/dispatch` | OWNER, FM | + BM, ACCOUNTANT, SALES |
| POST `letters/:id/delivered` | OWNER, FM | + BM, ACCOUNTANT, SALES |
| PATCH `letters/:id/evidence` | OWNER, FM | + BM, ACCOUNTANT, SALES |
| POST `letters/:id/undeliverable` | OWNER, FM | + BM, ACCOUNTANT, SALES |
| POST `letters/:id/revert-undeliverable` | OWNER, FM, BM | + ACCOUNTANT, SALES |
| POST `letters/:id/cancel` | OWNER, FM | + BM **เท่านั้น** (ACCOUNTANT, SALES ไม่ขยาย) |

**Decided:** การ `cancel` จดหมายเป็น irreversible action → คง role เป็น **OWNER + FINANCE_MANAGER + BRANCH_MANAGER** เท่านั้น (ACCOUNTANT, SALES ไม่มีสิทธิ์ยกเลิก) → UI ซ่อนปุ่ม Cancel + Bulk Cancel จาก role ที่ไม่มีสิทธิ์

### 6.2 List Endpoint — Filter + Pagination + Search (Breaking Change)

ขยาย `GET /overdue/letters`:

```ts
@Get('letters')
listLetters(
  @Query('status') status?: string,
  @Query('letterType') letterType?: string,
  @Query('branchId') branchId?: string,        // NEW
  @Query('from') from?: string,                // NEW — ISO date (triggeredAt >= from)
  @Query('to') to?: string,                    // NEW — ISO date (triggeredAt <= to)
  @Query('q') q?: string,                      // NEW — search letterNumber/contractNumber/customer.name
  @Query('page') page = '1',                   // NEW
  @Query('limit') limit = '50',                // NEW (max 200)
  @CurrentUser() user?: { role: string; branchId: string | null },
)
```

`ContractLetterService.list()` ต้องเปลี่ยน:
- Override `branchId` filter ด้วย `user.branchId` ถ้า `!CROSS_BRANCH_ROLES.has(user.role)` (ครอบคลุม BM + SALES ผ่าน util เดียว — ไม่ hard-code)
- Search where: `OR: [{ letterNumber: {contains: q, mode: 'insensitive'} }, { contract: {contractNumber: {contains: q, mode: 'insensitive'}} }, { contract: {customer: {name: {contains: q, mode: 'insensitive'}}} }]`
- Date filter: `triggeredAt: { gte: from, lte: to }` (parse ISO ระวัง timezone — BKK)
- Pagination: `skip: (page-1)*limit, take: limit` + `prisma.contractLetter.count({ where })`
- **Return shape เปลี่ยน:** `{ data: ContractLetter[], total: number, page: number, limit: number }` (เดิม return array ตรงๆ)
- Order: `triggeredAt DESC`

**Breaking change disclosure:** consumer เดียวคือ orphan `useLetterQueue` ซึ่งจะถูกลบ (ดู 4.3). ไม่มี consumer อื่น → ไม่ต้อง version endpoint

**Index verification:** ตรวจ `Customer.name` ว่ามี index หรือยัง (`@@index([name])` ใน schema.prisma:Customer). ถ้าไม่มี → เพิ่ม migration

### 6.3 NEW Bulk Dispatch Endpoint

```ts
@Post('letters/bulk/dispatch')
@Roles('OWNER', 'FINANCE_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SALES')
bulkDispatchLetters(
  @Body() dto: BulkDispatchLettersDto,
  @CurrentUser() user: { id: string },
) {
  return this.contractLetterService.bulkDispatch(dto.items, user.id);
}

// DTO
class BulkDispatchItemDto {
  @IsUUID() id!: string;
  @IsString() @MinLength(5) trackingNumber!: string;
  @IsOptional() @IsUrl() evidencePhotoUrl?: string;
}
class BulkDispatchLettersDto {
  @ValidateNested({ each: true })
  @Type(() => BulkDispatchItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: BulkDispatchItemDto[];
}
```

Service `bulkDispatch(items, userId)`:
1. Fetch ทุก letter ที่ id ∈ items + deletedAt=null
2. Validate: ทุกฉบับ status === 'PDF_GENERATED' + ทุก id มีจริง
3. ถ้า fail → throw BadRequestException พร้อม list ของ id ที่ผิด (ไม่ partial commit)
4. `$transaction`: update ทุก letter + create audit log ทุกตัว (มี `metadata.batchId = uuid()` ร่วมกัน)
5. Return `{ updated: ContractLetter[], batchId }`

### 6.4 `pdfUrl` Optional

`POST /overdue/letters/:id/pdf-generated` body เดิม `{ pdfUrl: string }` → เปลี่ยน `{ pdfUrl?: string }`

```ts
async markPdfGenerated(letterId: string, pdfUrl: string | null, userId: string) {
  // ... existing checks ...
  return this.prisma.$transaction([
    this.prisma.contractLetter.update({
      where: { id: letterId },
      data: { status: 'PDF_GENERATED', pdfUrl: pdfUrl ?? null, pdfGeneratedAt: new Date() },
    }),
    // ... audit log
  ]);
}
```

Justification: ตอนนี้ frontend render PDF ฝั่ง client (jsPDF) ไม่ upload S3 → `pdfUrl` จะ `null` เป็นปกติ. Audit trail ยังอยู่ผ่าน `pdfGeneratedAt` + AuditLog. ถ้า future จะเก็บ PDF จริงค่อยเพิ่ม

### 6.5 Database

**ไม่มี Prisma model migration** — `ContractLetter` มี field ครบแล้ว (`trackingNumber`, `evidencePhotoUrl`, `pdfUrl?` ทั้งหมด nullable)

**อาจมี index migration** ถ้า `Customer.name` ยังไม่มี index (ตรวจระหว่าง implementation)

### 6.6 Audit Log

- `LETTER_PDF_GENERATED`, `LETTER_DISPATCHED`, `LETTER_DELIVERED`, `LETTER_UNDELIVERABLE`, `LETTER_CANCELLED`, `LETTER_REVERT_UNDELIVERABLE` — มีอยู่แล้ว
- Bulk dispatch: ใส่ `metadata.batchId` ร่วมกันทุก entry ใน batch (ตาม pattern `PairedJournalService` ใน accounting module)

## 7. Data Flow

```
[User]
  ↓ select tab + filters
  ↓
[LettersPage] → useLettersList({status, branchId, type, from, to, q})
  ↓ TanStack Query
  ↓
[GET /overdue/letters] → ContractLetterService.list()
  ↓ Prisma where + include contract.customer + contract.branch
  ↓
[response { data, total, page, limit }]
  ↓
[LetterTable renders rows]
  ↓
[User] checks N rows → presses Bulk Print
  ↓
[BulkPrintDialog]
  ├ mergeLetterPdfs(rows) → jsPDF doc
  ├ window.print() or download
  └ on success: loop POST /overdue/letters/:id/pdf-generated
       → contractLetterService.markPdfGenerated()
       → status PENDING_DISPATCH → PDF_GENERATED
       → audit log
  ↓
[invalidateQueries(['letters'])]
  ↓
[Tab counts + table refresh]
```

## 8. Error Handling

| Scenario | Handling |
|---|---|
| Backend 4xx/5xx | toast.error(getErrorMessage(err)) (pattern เดิม) |
| Bulk dispatch validation fail (≥1 item ผิด) | Backend reject ทั้ง batch + return list `{ id, reason }` → dialog แสดง error inline ที่แต่ละ row ที่ผิด, tracking# ที่ user พิมพ์ไว้ยังอยู่ |
| Bulk print PDF render fail | BulkPrintDialog แสดง error banner, ไม่ proceed ต่อ status update, ปุ่มยังกดได้เผื่อ retry |
| Tracking# invalid format | warning chip ใต้ช่อง (ไม่ block — บางจังหวัด courier เอกชนใช้ format อื่น) |
| Excel export > 10k rows | block + bottom note "เกินจำนวนที่ export ได้ — กรุณาแคบ filter" |
| Role ไม่มีสิทธิ์เห็นหน้า | ProtectedRoute redirect → / |
| Role เห็นแต่ไม่มีสิทธิ์ action (cancel) | ปุ่ม Cancel + Bulk Cancel ซ่อนจาก ACCOUNTANT/SALES (ไม่ใช่ disable — รก) |

## 9. Testing Strategy

### 9.1 API Tests (Jest)

- `overdue.controller.spec.ts` — extend existing
  - `GET /letters` ยอมรับ filter params ใหม่ครบ (status, letterType, branchId, from, to, q, page, limit)
  - Branch scoping: BM/SALES role → query มี `branchId = user.branchId` ผ่าน util ไม่ใช่ hard-code
  - Role expansion: ACCOUNTANT/SALES สามารถเรียก GET /letters ได้
  - Cancel role: ACCOUNTANT/SALES → 403
  - Search `q`: hit letterNumber, contractNumber, customer name (case-insensitive)
- `contract-letter.service.spec.ts` — new
  - `list()` return shape `{ data, total, page, limit }`
  - `markPdfGenerated(letterId, null)` accept null pdfUrl, store null
  - `bulkDispatch(items)` validate ทุก item ก่อน update — fail-any-fail-all (1 item invalid → all reject)
  - `bulkDispatch()` audit logs share metadata.batchId
  - `bulkDispatch()` reject ถ้ามี letter status ≠ PDF_GENERATED แม้แต่ 1 ฉบับ

### 9.2 Web Tests (Vitest)

- `useLettersList.test.ts` — params serialization, cache key
- `mergeLetterPdfs.test.ts` — input 3 jsPDF docs → output มี 3+ pages
- `lettersToExcel.test.ts` — workbook structure + Thai date format + tracking# column
- `BulkPrintDialog.test.tsx`:
  - Download click → auto-mark all ids
  - Print click → NOT auto-mark; toast แสดง confirm button; กด confirm → mark
  - Print click + ไม่กด confirm → status คงเดิม

### 9.3 E2E (Playwright)

- `letters-page.spec.ts`:
  - Login as OWNER → navigate `/letters` → 5 tabs visible with counts
  - Select 2 rows in PENDING_DISPATCH → bulk print → PDF preview opens → click "พิมพ์" → both rows move to PDF_GENERATED tab
  - Bulk dispatch with tracking# → rows move to DISPATCHED with tracking# visible
  - Export Excel → file downloads
  - Login as SALES → `/letters` shown but cancel button hidden + only own-branch rows visible

## 10. Migration & Cleanup

หลัง implement สำเร็จ:

1. ลบ orphan imports จาก `CollectionsPage/components/` หลัง move
2. (ทางเลือก) เพิ่ม notification badge bell ใน Sidebar นับ PENDING_DISPATCH count (defer)
3. Update `.claude/CLAUDE.md` — เพิ่ม `/letters` ใน "Collections & Risk" section

## 11. Out of Scope (Future Work)

- Thailand Post tracking API integration (webhook update `deliveredAt` อัตโนมัติ)
- Upload หลักฐานการส่งจดหมาย (เซ็นรับ/รูปถ่ายจ่าหน้าซอง) — schema field พร้อม แต่ UI defer
- LINE OA notification ส่งสำเนาจดหมายให้ลูกค้าก่อนที่ ฉบับจริงจะถึงไปรษณีย์
- Letter template editor (เปลี่ยนเนื้อหาจดหมายใน UI โดย OWNER)
- Backend bulk endpoints (ถ้า volume เกิน 50/batch)
- Sidebar badge แสดงจำนวน PENDING_DISPATCH

---

## Approvals

- [x] User confirmed approach A (separate page) — 2026-05-26
- [x] User confirmed permissions = all 5 Collections roles — 2026-05-26
- [x] User confirmed auto-mark PDF_GENERATED on bulk print — 2026-05-26
  - **Revised in v2:** auto-mark เฉพาะ Download; Print ต้อง user confirm
- [x] User confirmed Excel export + tracking number capture — 2026-05-26
- [x] Scrutinize blockers ปิดใน v2 — 2026-05-26
- [ ] User reviews v2 spec before implementation plan
