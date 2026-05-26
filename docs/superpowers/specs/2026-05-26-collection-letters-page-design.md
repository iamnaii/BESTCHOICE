# Collection Letters Management Page (`/letters`) — Design

**Date:** 2026-05-26
**Status:** Approved (pending implementation plan)
**Owner:** BESTCHOICE Collections module

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

- ไม่สร้าง bulk endpoint ใหม่ (frontend loop call ก็พอสำหรับ MVP — N <= 50)
- ไม่ทำ upload ภาพหลักฐานในรอบนี้ (schema มี `evidencePhotoUrl` รองรับอยู่แล้ว — เพิ่มภายหลัง)
- ไม่ override cron logic การสร้างจดหมายอัตโนมัติ
- ไม่ทำ courier API integration (Thailand Post tracking webhook) — ใส่ tracking number แบบ manual ก่อน

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

### 4.3 Reuse Existing

| Asset | Path | Action |
|---|---|---|
| `useLetterActions` | `pages/CollectionsPage/hooks/useLetterActions.ts` | **Move** → `hooks/useLetterActions.ts` (shared) |
| `useLetterQueue` | `pages/CollectionsPage/hooks/useLetterQueue.ts` | **Supersede** by `useLettersList` (richer params); delete |
| `LetterDispatchDialog` | `pages/CollectionsPage/components/LetterDispatchDialog.tsx` | **Move** → shared `components/letters/` |
| `LetterPdfPreviewDialog` | `pages/CollectionsPage/components/LetterPdfPreviewDialog.tsx` | **Move** → shared `components/letters/` |
| `letterPdfRenderer.ts` | `pages/CollectionsPage/utils/letterPdfRenderer.ts` | **Move** → `utils/letters/` (used by both single + bulk flows) |

Justification: ทั้งหมดถูกเขียนสำหรับ Collections เดิม แต่ใช้กับ `/letters` ด้วย → ย้ายขึ้น shared location ตามหลัก isolation/clarity ใน brainstorming skill

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

| Tab (Status) | Row Action | Bulk Action | Detail |
|---|---|---|---|
| **รอพิมพ์** (PENDING_DISPATCH) | 👁 Preview · ✕ Cancel | 🖨 Bulk Print · ✕ Bulk Cancel | Bulk print auto-mark `PDF_GENERATED` |
| **พิมพ์แล้ว** (PDF_GENERATED) | 👁 Preview · 📦 Mark Dispatched · ✕ Cancel | 📦 Bulk Mark Dispatched · ✕ Bulk Cancel | Bulk dispatch → prompt batch tracking dialog (per-row tracking#) |
| **ส่งแล้ว** (DISPATCHED) | ✅ Mark Delivered · ⚠ Mark Undeliverable | ⚠ Bulk Mark Undeliverable | Single ✅ delivered ไม่ทำ bulk เพราะปกติรู้ทีละราย |
| **ตีกลับ** (UNDELIVERABLE) | ↶ Revert to Dispatched | — | Revert ภายใน undo window (30s) ถ้าตีกลับโดยพลาด |
| **ยกเลิก** (CANCELLED) | view-only | — | แสดง `cancelReason` |

### 5.3 Bulk Print Flow (Auto-Mark PDF_GENERATED)

```
1. ผู้ใช้เลือก row หลายอันใน tab "รอพิมพ์"
2. กด [🖨 พิมพ์รวม]
3. BulkPrintDialog เปิด:
   - Frontend loop: for each letter
       → fetch letter detail (ถ้าจำเป็น)
       → renderLetterPdf(data) → jsPDF doc
       → mergeLetterPdfs() ใช้ doc.addPage() ตามจำนวนหน้าของแต่ละจดหมาย
   - แสดง preview multi-page PDF
4. ผู้ใช้กดปุ่ม [🖨 พิมพ์] หรือ [📥 ดาวน์โหลด]:
   - [🖨 พิมพ์] → trigger `window.print()` บน iframe ที่โหลด PDF blob
   - [📥 ดาวน์โหลด] → save Blob เป็น `letters-batch-YYYYMMDD-HHmm.pdf`
   - **Auto-mark trigger = user click event** (ไม่รอ `afterprint` event เพราะ browser-specific และไม่ reliable cross-browser)
5. หลัง user click ปุ่มหนึ่งใน 2:
   - Loop call POST /overdue/letters/:id/pdf-generated สำหรับทุก id ที่อยู่ใน batch
   - Toast: "ทำเครื่องหมายพิมพ์แล้ว N ฉบับ — ย้ายไปแท็บ พิมพ์แล้ว"
   - Invalidate query → refresh tab counts
   - หาก loop call ล้มเหลวบางฉบับ → toast แสดงรายการที่ยังเป็น PENDING_DISPATCH + คงสถานะใน DB ตามจริง
```

**Edge cases:**
- ถ้า API call ล้มเหลวบางฉบับ → toast แสดงรายการที่ล้มเหลว + คงสถานะเดิม
- ถ้า PDF render ล้มเหลว → dialog แสดง error ไม่บันทึก status

### 5.4 Bulk Dispatch (Mark Sent)

```
1. ผู้ใช้เลือก row หลายอันใน tab "พิมพ์แล้ว"
2. กด [📦 ส่งแล้ว]
3. BulkDispatchDialog เปิด:
   - แสดง list ลูกค้า + ช่อง tracking number ทีละแถว
   - [ใช้ tracking ต่อเนื่อง]: input prefix + base number → auto-fill EM 123 456 789 TH, EM 123 456 790 TH, ...
   - Validate: tracking number ห้ามว่าง, format ไปรษณีย์ไทย /^[A-Z]{2}\d{9}TH$/i (warning ถ้าไม่ตรงแต่ไม่ block)
4. ยืนยัน → loop POST /overdue/letters/:id/dispatch { trackingNumber }
5. Toast สรุปผล + invalidate
```

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

### 6.2 List Endpoint Filter Expansion

ขยาย `GET /overdue/letters`:

```ts
@Get('letters')
listLetters(
  @Query('status') status?: string,
  @Query('letterType') letterType?: string,
  @Query('branchId') branchId?: string,        // NEW
  @Query('from') from?: string,                // NEW — ISO date
  @Query('to') to?: string,                    // NEW — ISO date
  @Query('q') q?: string,                      // NEW — search letterNumber/contractNumber/customer name
  @Query('page') page = '1',                   // NEW — pagination
  @Query('limit') limit = '50',                // NEW
  @CurrentUser() user?: { role: string; branchId: string | null },
)
```

`ContractLetterService.list()` ต้อง:
- Override `branchId` filter ด้วย user.branchId ถ้า role ∉ `CROSS_BRANCH_ROLES`
- Join `contract → customer + branch` สำหรับ search
- Return shape: `{ data, total, page, limit }`
- Order: `triggeredAt DESC` default

### 6.3 No Bulk Endpoints

MVP ไม่สร้าง bulk endpoints — frontend loop call ก็พอ
- Network overhead: 50 × ~80ms = ~4s worst-case (acceptable)
- ลด risk ของ partial-success handling ฝั่ง backend
- ถ้าต้องการ later → เพิ่มทีหลังเป็น `POST /overdue/letters/bulk/dispatch` body=`{ items: [{id, trackingNumber}] }`

### 6.4 Database

**ไม่มี migration** — schema มี `trackingNumber String?` + `evidencePhotoUrl String?` รองรับอยู่แล้ว (ตรวจ schema.prisma:ContractLetter)

### 6.5 Audit Log

ใช้ pattern เดิม (audit log สร้างใน `ContractLetterService` มีอยู่แล้ว) — ไม่ต้องเพิ่ม action string ใหม่

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
| Bulk action partial fail | dialog summary: "สำเร็จ 8 ฉบับ ล้มเหลว 2 ฉบับ: [letter#, reason]" + คงสถานะเดิม |
| PDF render fail | BulkPrintDialog แสดง error banner, ไม่ proceed ต่อ status update |
| Tracking# invalid format | warning chip ใต้ช่อง (ไม่ block — บางจังหวัด courier เอกชนใช้ format อื่น) |
| Excel export > 10k rows | block + bottom note "เกินจำนวนที่ export ได้ — กรุณาแคบ filter" |
| Role ไม่มีสิทธิ์เห็นหน้า | ProtectedRoute redirect → / |
| Role เห็นแต่ไม่มีสิทธิ์ action | ปุ่ม disabled + tooltip "ต้องเป็น OWNER/FM" |

## 9. Testing Strategy

### 9.1 API Tests (Jest)

- `overdue.controller.spec.ts` — extend existing
  - `GET /letters` ยอมรับ filter params ใหม่ครบ
  - Branch scoping: BM role → query มี `branchId = user.branchId`
  - Role expansion: ACCOUNTANT/SALES สามารถเรียก GET /letters ได้
  - `cancel` ยังคง require OWNER/FM/BM

### 9.2 Web Tests (Vitest)

- `useLettersList.test.ts` — params serialization, cache key
- `mergeLetterPdfs.test.ts` — input 3 docs → output มี 3+ pages
- `lettersToExcel.test.ts` — workbook structure + Thai date format
- `BulkPrintDialog.test.tsx` — auto-mark PDF_GENERATED triggered on print success

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
- [x] User confirmed Excel export + tracking number capture — 2026-05-26
- [ ] User reviews this spec before implementation plan
