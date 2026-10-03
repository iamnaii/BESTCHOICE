# After-Sales Hub PR 4 — ใบรับฝากเครื่อง + ใบส่งมอบ (PDF) · ปุ่มพิมพ์ · ถอดหน้าใบซ่อมเดิม — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานพิมพ์ "ใบรับฝากเครื่อง" (ตอนเปิดเคส ให้ลูกค้าเซ็น ร้านเก็บ) และ "ใบส่งมอบ" (ตอนลูกค้ามารับ — หลังซ่อม / เปลี่ยนเครื่อง) เป็น PDF A4 หน้าเดียวจากหน้าเคสและหน้าแจ้งปัญหาเครื่อง ทุกครั้งที่พิมพ์ลงไทม์ไลน์เคส และถอดหน้าใบซ่อมเดิม `/insurance/:id` ที่ครบกำหนด 2 รุ่น deploy แล้ว

**Architecture:** ไม่มี migration · API: route ใหม่ 2 ตัว `GET /after-sales/:id/receipt.pdf` + `/handover.pdf` (ทั้ง 5 role) ใน controller เดิม → `AfterSalesDocumentService.render(caseId, kind, user)` เรียก `AfterSalesQueryService.getCase` ก่อนเสมอ (ขอบเขตสาขา + stage ที่ reconcile แล้ว) → รวบข้อมูลเป็น `DocSource` → `composeReceiptDoc` / `composeHandoverDoc` (pure — กติกาถ้อยคำทั้งหมดอยู่ที่นี่) → `buildAfterSalesDocHtml` (pure — HTML ตามสไตล์เอกสารของระบบ `transactionDocumentCss`) → `AfterSalesPdfRenderer` (Puppeteer, ย่อรูปในเบราว์เซอร์ก่อนพิมพ์) → บันทึก `AfterSalesEvent` kind `PRINTED` (กันซ้ำ 5 นาที) · Web: ปุ่มพิมพ์ในหัวหน้าเคสเปิด `PdfPreview` ตัวเดิมของระบบ · หน้าแจ้งปัญหาเครื่องมีปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก" ที่พาไปหน้าเคสพร้อม `?print=receipt`

**Tech Stack:** NestJS + Prisma, Puppeteer (มีอยู่แล้วใน apps/api), `@installment/shared` document CSS, jest (unit + supertest), React + react-query + vitest

**Spec:** `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` — ข้อ 4.3 (ปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก"), 4.3 ข้อ 4 (ปุ่มพิมพ์ใบรับฝากบนหน้าเคส), 4.4 (ปุ่มรอง "พิมพ์ใบรับฝากเครื่อง / ใบส่งมอบ"), 5 (`AfterSalesEvent` kind `PRINTED`), 6 (route `receipt.pdf` / `handover.pdf` ทั้ง 5 role), 11 (redirect ≥2 รุ่น deploy แล้วค่อยลบ), 14 แถว 4 · หน้าตาเอกสาร = mockup กระดาน 8–10 (artifact `SoThf1rbZEaxas5KJgudxp` → `project/ReceiptDoc.dc.html`, `HandoverRepair.dc.html`, `HandoverExchange.dc.html`) · แถว "ตัวเลขเจ้าของ" ของ PR 4 ทำเสร็จไปแล้วใน PR 1 (`SummaryStrip.tsx` + `AfterSalesQueryService.summary()`) — ไม่อยู่ในแผนนี้

## ค่าที่แผนนี้ใช้ แทนคำตอบเจ้าของ 4 ข้อ (โน้ตส้มบนกระดาน 8–10)

แผนเขียนตามค่าที่แนะนำไว้ ถ้าเจ้าของตอบต่าง ให้แก้แผนตรงที่ระบุก่อนเริ่ม Task นั้น

1. เงื่อนไขการรับฝาก = 5 ข้อใน `RECEIPT_CONDITIONS` (Task 2) — **ยังไม่ใส่ข้อ "ไม่มาติดต่อเกินกี่วัน"** จนกว่าเจ้าของกำหนดจำนวนวันและสิ่งที่ร้านทำ (เพิ่มเป็นข้อที่ 6 ของอาร์เรย์เดียวกัน)
2. พิมพ์แผ่นเดียว "ต้นฉบับ — ร้านเก็บ" ไม่มีสำเนาลูกค้า (ลูกค้าติดตามทาง LINE)
3. ใส่รูปสภาพเครื่องตอนรับฝากในใบรับฝาก (Task 1 บล็อก `photos` + Task 3 `loadPhotos`)
4. ใบส่งมอบ ร้านจ่าย = แสดง "ลูกค้าจ่าย: ไม่มี" ไม่แสดงค่าซ่อม

## Global Constraints

- ไม่มี migration · ไม่แตะเครื่องยนต์ repair-tickets / contract-exchange / บัญชี · ไม่เพิ่ม dependency ใหม่ (Puppeteer มีแล้ว, ไม่มี `sharp`)
- ขอบเขตสาขา: route มีแต่ `:id` ⇒ ตรวจใน service ผ่าน `AfterSalesQueryService.getCase(id, user)` **ก่อน** อ่าน storage / เปิด Chromium (`.claude/rules/security.md` "Branch scope บน route ที่มีแต่ :id")
- Roles ของ 2 route = `ALL` (`OWNER`, `BRANCH_MANAGER`, `FINANCE_MANAGER`, `ACCOUNTANT`, `SALES`) ตามสเปก 6 · ไม่ใส่ `ExportEnabledGuard` (โมดูลนี้ไม่มี export gate — แบบเดียวกับ `expense-documents` `voucher.pdf`)
- คำ (สเปก 4.0): เอกสาร/หน้าจอ **ห้ามมีคำว่า "รับเครื่อง"** ทุกรูปแบบ — ใช้ "รับฝาก" / "ส่งมอบ" / "ผู้รับมอบ" · เอกสารทุกใบมีบรรทัด "เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน / ใบกำกับภาษี"
- ข้อความลูกค้า (symptom / อุปกรณ์อื่น ๆ) ต้อง escape HTML เสมอ · รูปฝังได้เฉพาะ `data:image/(jpeg|png|webp);base64,…`
- PDF ต้องเป็น A4 **หน้าเดียว** ทั้ง 3 แบบในกรณีเนื้อหายาวสุด (smoke test Task 3)
- `PRINTED` = `AfterSalesEvent { kind: 'PRINTED', note: 'ใบรับฝากเครื่อง' | 'ใบส่งมอบ', actorId }` · กันซ้ำ: ผู้ใช้คนเดิม เอกสารเดิม ภายใน 5 นาที = ไม่เขียนแถวใหม่ · เขียน event ไม่สำเร็จต้องไม่ทำให้การพิมพ์ล้ม
- ไม่เขียน `AuditLog` (การพิมพ์ไม่เปลี่ยนสถานะ — ไทม์ไลน์เคสคือหลักฐาน)
- เว็บ: tokens เท่านั้น · `leading-snug` · ไอคอน `aria-hidden` · ใช้ `PdfPreview` ตัวเดิม (`@/components/PdfPreview`) ห้ามเขียนตัวเปิด PDF ใหม่
- ห้าม `npm run lint` ใน `apps/api` (มี `--fix`) · format ด้วย `npx prettier --write <ไฟล์>` · ห้าม `git add -A` · bump `apps/web/package.json` `version` เป็น `26.9.57` (Task 7)
- commit ลงท้าย `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- สาขา `feat/after-sales-hub-pr4` ต่อจาก `feat/after-sales-hub-pr3` (`8184b157e`) — **ไม่ push** จนเจ้าของสั่ง; ตอนเปิด PR ต้อง retarget base → `main` หลัง PR 3 merge

## Review Focus

1. **อาการยาวมาก / "อื่น ๆ" ยาว** (DTO ไม่มี MaxLength): ใบรับฝากต้องยังหน้าเดียว ลายเซ็นไม่หล่นไปหน้า 2 → ตัดอาการที่ 300 ตัวอักษร และ "อื่น ๆ" ที่ 60 พร้อมท้าย "… (ข้อความเต็มในระบบ)" — Task 2 เทสต์ (e) + Task 3 smoke
2. **ขอใบส่งมอบของเคสที่ยังไม่พร้อม** (RECEIVED / IN_REPAIR / AWAITING_APPROVAL / CANCELLED / ไม่มีทางออก / ซ่อมแต่ไม่มีใบซ่อม): API ตอบ 400 ไทย ไม่เปิด Chromium และหน้าเว็บไม่โชว์ปุ่ม — Task 2 เทสต์ (j) + Task 3 เทสต์ (c) + Task 4 เทสต์ (a)(b)
3. **ผจก.สาขาอื่นเปิดลิงก์ PDF ตรง ๆ**: 403 ก่อนแตะ storage / renderer / event — Task 3 เทสต์ (b)
4. **รูปใน storage หาย / ไฟล์นามสกุลแปลก**: PDF ยังออก ช่องนั้นขึ้น "เปิดรูปไม่ได้" (ไม่ใช่ "ไม่ได้ถ่าย") ไม่ 500 — Task 2 เทสต์ (f) + Task 3 เทสต์ (d)
5. **เปิดตัวอย่างซ้ำ ๆ / refetch**: ไทม์ไลน์ไม่ท่วมด้วย "พิมพ์เอกสาร" — กันซ้ำ 5 นาทีต่อผู้ใช้ต่อเอกสาร — Task 3 เทสต์ (e)

---

## File Structure

**API — สร้าง** (โฟลเดอร์ใหม่ `apps/api/src/modules/after-sales/documents/`)
- `documents/after-sales-logo.ts` — `AFTER_SALES_LOGO_SVG` (สร้างด้วยสคริปต์จากโลโก้ใน `asset-receipt-pdf.service.ts`)
- `documents/after-sales-doc-html.ts` — ชนิดข้อมูลเอกสาร (`AfterSalesDoc`, `DocBlock`, …) + `buildAfterSalesDocHtml(doc)` + `escapeHtml` (pure)
- `documents/after-sales-doc-compose.ts` — `DocSource` + `composeReceiptDoc` / `composeHandoverDoc` / `handoverBlockReason` / `RECEIPT_CONDITIONS` (pure — กติกาถ้อยคำทั้งหมด)
- `documents/after-sales-pdf.renderer.ts` — `AfterSalesPdfRenderer.htmlToPdf(html)` (Puppeteer, shared browser)
- `services/after-sales-document.service.ts` — `AfterSalesDocumentService.render(caseId, kind, user)`
- เทสต์: `__tests__/doc-html.spec.ts`, `__tests__/doc-compose.spec.ts`, `__tests__/document-service.spec.ts`, `__tests__/document-routes.http.spec.ts`, `__tests__/doc-render.smoke.spec.ts` (ข้ามใน CI — รันด้วย env)

**API — แก้**
- `after-sales.controller.ts` (2 route + inject `AfterSalesDocumentService`) · `after-sales.module.ts` (providers) · `__tests__/intake-photos-upload.http.spec.ts` (provider mock ของ controller dependency ใหม่)

**Web — แก้**
- `apps/web/src/pages/after-sales/after-sales.ts` (`CaseDocKind`, `CASE_DOC_LABEL`, `canPrintHandover`) · `apps/web/src/pages/AfterSalesCasePage.tsx` (ปุ่มพิมพ์ + `PdfPreview` + `?print=`) · `apps/web/src/pages/after-sales/CaseTimeline.tsx` (label `PRINTED`) · `apps/web/src/pages/AfterSalesNewPage.tsx` (ปุ่มรอง)
- ถอดหน้าเดิม: `apps/web/src/App.tsx` · `apps/web/src/pages/after-sales/TicketRedirect.tsx` · ลบ `apps/web/src/pages/insurance/` ทั้งโฟลเดอร์ (ย้าย `RepairCenterCombobox.tsx` ไป `apps/web/src/pages/after-sales/`) · แก้ปุ่มตายในอินบ็อกซ์ `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.tsx`
- เทสต์: `after-sales.test.ts`, `AfterSalesCasePage.test.tsx`, `CaseTimeline.test.tsx`, `AfterSalesNewPage.test.tsx`, `TicketRedirect.test.tsx`, ใหม่ `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.test.tsx`

**เอกสาร** — `apps/web/package.json` (26.9.57) · สเปกบรรทัดสถานะ · `.claude/CLAUDE.md` Key Routes

---

### Task 1: HTML ของเอกสาร (pure builder) + โลโก้

**Files:**
- Create: `apps/api/src/modules/after-sales/documents/after-sales-logo.ts` (สร้างด้วยสคริปต์)
- Create: `apps/api/src/modules/after-sales/documents/after-sales-doc-html.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/doc-html.spec.ts`

**Interfaces:**
- Produces: `AfterSalesDoc`, `DocBlock`, `DocSection`, `DocKv`, `DocCheck`, `DocPhoto`, `DocCompany`, `DocSignature` (types) · `buildAfterSalesDocHtml(doc: AfterSalesDoc): string` · `escapeHtml(text: string): string` · `AFTER_SALES_LOGO_SVG: string` · `DOC_NOT_RECEIPT = 'เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน / ใบกำกับภาษี'`

- [ ] **Step 1: สร้างไฟล์โลโก้ด้วยสคริปต์** (คัดลอกโลโก้ตัวเดียวกับใบรับเงินทรัพย์สิน เปลี่ยน id ของ gradient กันชนกัน)

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/api && mkdir -p src/modules/after-sales/documents && node <<'EOF'
const fs = require('fs');
const src = fs.readFileSync('src/modules/asset/services/asset-receipt-pdf.service.ts', 'utf8');
const m = src.match(/const BESTCHOICE_LOGO_SVG = `([^`]+)`;/);
if (!m) throw new Error('logo literal not found');
const svg = m[1].replace(/bc-as/g, 'bc-as-doc');
fs.writeFileSync(
  'src/modules/after-sales/documents/after-sales-logo.ts',
  '// BESTCHOICE wordmark — copied from asset-receipt-pdf.service.ts; gradient id renamed\n' +
    '// (bc-as → bc-as-doc) so it can never collide with another inline copy on one page.\n' +
    'export const AFTER_SALES_LOGO_SVG = `' + svg + '`;\n',
);
console.log('written', svg.length);
EOF
```

Expected: `written <ตัวเลขประมาณ 9000>`

- [ ] **Step 2: เขียนเทสต์ที่ล้มก่อน** — `apps/api/src/modules/after-sales/__tests__/doc-html.spec.ts`

```ts
import {
  buildAfterSalesDocHtml,
  DOC_NOT_RECEIPT,
  escapeHtml,
  type AfterSalesDoc,
} from '../documents/after-sales-doc-html';
import { AFTER_SALES_LOGO_SVG } from '../documents/after-sales-logo';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function doc(over: Partial<AfterSalesDoc> = {}): AfterSalesDoc {
  return {
    title: 'ใบรับฝากเครื่อง',
    kicker: 'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
    company: {
      nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      address: 'ลพบุรี 15000',
      taxId: '0165568000050',
      phone: '063-134-6356',
    },
    meta: [
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'สาขา', value: 'ลพบุรี' },
    ],
    blocks: [],
    ack: 'ข้าพเจ้าฝากเครื่องตามรายการข้างต้นไว้กับร้าน',
    signatures: [
      { role: 'ลูกค้า (ผู้ฝาก)', name: 'สมชาย ใจดี', sub: 'วันที่ ........ / ........ / ........' },
      { role: 'พนักงาน', name: 'สุดา', sub: 'ลพบุรี · 7 ก.ย. 2569' },
    ],
    footer: 'หลังการขาย · เคส AS-20260907-0004',
    ...over,
  };
}

describe('buildAfterSalesDocHtml', () => {
  it('หัวเอกสาร: โลโก้ + บริษัท + ชื่อเอกสาร + kicker + meta + ลายเซ็น 2 ช่อง + บรรทัดไม่ใช่ใบเสร็จ', () => {
    const html = buildAfterSalesDocHtml(doc());
    for (const text of [
      'บริษัท เบสท์ช้อยส์โฟน จำกัด',
      'เลขประจำตัวผู้เสียภาษี 0165568000050',
      'โทร 063-134-6356',
      '<h1>ใบรับฝากเครื่อง</h1>',
      'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
      'AS-20260907-0004',
      'ลูกค้า (ผู้ฝาก) — ( สมชาย ใจดี )',
      'พนักงาน — ( สุดา )',
      DOC_NOT_RECEIPT,
      'bc-as-doc',
    ])
      expect(html).toContain(text);
    expect(html.match(/class="bc-doc-signature"/g)).toHaveLength(2);
  });

  it('บริษัทไม่มีที่อยู่/เลขภาษี → ไม่พิมพ์บรรทัดว่าง', () => {
    const html = buildAfterSalesDocHtml(
      doc({ company: { nameTh: 'BESTCHOICE', address: '', taxId: '', phone: null } }),
    );
    expect(html).not.toContain('เลขประจำตัวผู้เสียภาษี');
    expect(html).not.toContain('<p></p>');
  });

  it('escape ข้อความลูกค้าทุกบล็อก', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          { type: 'box', title: 'อาการที่ลูกค้าแจ้ง', text: '<script>alert(1)</script> & "x"' },
          { type: 'checks', label: 'อุปกรณ์', items: [{ text: '<b>เคส</b>', checked: true }] },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
    expect(html).toContain('&lt;b&gt;เคส&lt;/b&gt;');
  });

  it('pair / section / table / list เรนเดอร์ครบ + แถวตัวหนา', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'pair',
            left: { title: 'ลูกค้า (ผู้ฝาก)', rows: [{ label: 'ชื่อ', value: 'สมชาย', strong: true }] },
            right: { title: 'ที่มาของเครื่อง', rows: [{ label: 'ซื้อแบบ', value: 'สัญญาผ่อน CT-1' }] },
          },
          { type: 'section', section: { title: 'ผลการซ่อม', rows: [{ label: 'ซ่อมที่', value: 'ซ่อมที่ร้าน' }] } },
          {
            type: 'table',
            title: 'เปลี่ยนเครื่อง',
            head: ['', 'เครื่อง', 'IMEI'],
            rows: [
              ['เครื่องเดิม', 'A55', '111'],
              ['เครื่องที่ส่งมอบ', 'A55', '222'],
            ],
            strongRows: [1],
          },
          { type: 'list', title: 'เงื่อนไขการรับฝาก', items: ['ข้อหนึ่ง', 'ข้อสอง'] },
        ],
      }),
    );
    expect(html).toContain('<strong>สมชาย</strong>');
    expect(html).toContain('สัญญาผ่อน CT-1');
    expect(html).toContain('ซ่อมที่ร้าน');
    expect(html).toContain('<td><strong>222</strong></td>');
    expect(html).toContain('<td>111</td>');
    expect(html).toContain('<ol class="as-list"><li>ข้อหนึ่ง</li><li>ข้อสอง</li></ol>');
  });

  it('checks: ✓ เท่าจำนวนที่ติ๊ก + ช่อง trailing', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'checks',
            label: 'อุปกรณ์ที่ฝากมาด้วย',
            items: [
              { text: 'กล่อง', checked: true },
              { text: 'เคส', checked: false },
            ],
            trailing: { text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: true },
          },
        ],
      }),
    );
    expect(html.match(/<span class="as-box">✓<\/span>/g)).toHaveLength(2);
    expect(html).toContain('as-check as-trailing');
  });

  it('photos: รูปที่ถูกต้องได้ <img data-thumb> + สคริปต์ย่อรูป · ช่องว่างใช้ emptyText · src อื่นถือว่าไม่มีรูป', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'photos',
            title: 'สภาพเครื่องตอนรับฝาก',
            photos: [
              { angle: 'หน้า', dataUrl: PNG_1PX, emptyText: 'ไม่ได้ถ่าย' },
              { angle: 'หลัง', dataUrl: 'javascript:alert(1)', emptyText: 'เปิดรูปไม่ได้' },
              { angle: 'ซ้าย', dataUrl: 'data:text/html;base64,PHA+', emptyText: 'เปิดรูปไม่ได้' },
              { angle: 'ขวา', dataUrl: null, emptyText: 'ไม่ได้ถ่าย' },
            ],
          },
        ],
      }),
    );
    expect(html.match(/<img data-thumb/g)).toHaveLength(1);
    expect(html).toContain(`src="${PNG_1PX}"`);
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('data:text/html');
    // นับเฉพาะช่องรูป (สคริปต์ย่อรูปก็มีคำนี้เป็น alt สำรอง)
    expect(html.match(/<span>เปิดรูปไม่ได้<\/span>/g)).toHaveLength(2);
    expect(html).toContain('window.__afterSalesThumbs');
  });

  it('ไม่มีรูปที่ใช้ได้ → ไม่ใส่สคริปต์ย่อรูป', () => {
    const html = buildAfterSalesDocHtml(
      doc({
        blocks: [
          {
            type: 'photos',
            title: 'สภาพเครื่องตอนรับฝาก',
            photos: [{ angle: 'หน้า', dataUrl: null, emptyText: 'ไม่ได้ถ่าย' }],
          },
        ],
      }),
    );
    expect(html).not.toContain('window.__afterSalesThumbs');
  });

  it('escapeHtml + โลโก้ gradient id ไม่ชนของเดิม', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;',
    );
    expect(AFTER_SALES_LOGO_SVG.startsWith('<svg')).toBe(true);
    expect(AFTER_SALES_LOGO_SVG).toContain('id="bc-as-doc"');
    expect(AFTER_SALES_LOGO_SVG).not.toContain('id="bc-as"');
  });
});
```

- [ ] **Step 3: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-html.spec.ts --runInBand`
Expected: FAIL — `Cannot find module '../documents/after-sales-doc-html'`

- [ ] **Step 4: เขียน builder** — `apps/api/src/modules/after-sales/documents/after-sales-doc-html.ts`

```ts
import {
  DOCUMENT_WEB_FONT_FACES,
  TRANSACTION_PAGE_CSS,
  transactionDocumentCss,
} from '@installment/shared';
import { AFTER_SALES_LOGO_SVG } from './after-sales-logo';

/**
 * ใบรับฝากเครื่อง / ใบส่งมอบ ของเคสหลังการขาย (PR 4) — ตัวแปลงเอกสาร → HTML แบบ pure
 * (ไม่มี DI ไม่แตะฐานข้อมูล). หน้าตาใช้ชุด CSS เอกสารกลางของระบบ (`transactionDocumentCss`
 * — TH Sarabun PSK 16pt, หัวเขียว) + ส่วนเสริมเฉพาะเอกสารนี้ (`AS_CSS`). ถ้อยคำทั้งหมดมาจาก
 * `after-sales-doc-compose.ts` — ไฟล์นี้ไม่ตัดสินเรื่องข้อความ
 */

export const DOC_NOT_RECEIPT = 'เอกสารนี้ไม่ใช่ใบเสร็จรับเงิน / ใบกำกับภาษี';

export interface DocKv {
  label: string;
  value: string;
  strong?: boolean;
}

export interface DocSection {
  title: string;
  rows: DocKv[];
}

export interface DocCheck {
  text: string;
  checked: boolean;
}

export interface DocPhoto {
  angle: string;
  dataUrl: string | null;
  /** ข้อความในช่องเมื่อไม่มีรูปที่ใช้ได้ — "ไม่ได้ถ่าย" หรือ "เปิดรูปไม่ได้" (ตัดสินที่ compose) */
  emptyText: string;
}

export type DocBlock =
  | { type: 'pair'; left: DocSection; right: DocSection }
  | { type: 'section'; section: DocSection }
  | { type: 'table'; title: string; head: string[]; rows: string[][]; strongRows?: number[] }
  | { type: 'checks'; label: string; items: DocCheck[]; trailing?: DocCheck }
  | { type: 'box'; title: string; text: string }
  | { type: 'photos'; title: string; photos: DocPhoto[] }
  | { type: 'list'; title: string; items: string[] };

export interface DocCompany {
  nameTh: string;
  address: string;
  taxId: string;
  phone: string | null;
}

export interface DocSignature {
  role: string;
  name: string;
  sub: string;
}

export interface AfterSalesDoc {
  title: string;
  kicker: string;
  company: DocCompany;
  meta: DocKv[];
  blocks: DocBlock[];
  ack: string;
  signatures: [DocSignature, DocSignature];
  footer: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** รับเฉพาะรูปที่ service อ่านจาก storage แล้วแปลงเอง — อย่างอื่นถือว่าไม่มีรูป */
const SAFE_IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const AS_CSS = `
.as-block { margin-top: 2.5mm; break-inside: avoid; }
.as-pair { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 6mm; }
.as-muted { color: #52645d; }
.as-checks { display: flex; flex-wrap: wrap; align-items: center; gap: 1mm 5mm; margin-top: 1.5mm; }
.as-check { display: inline-flex; align-items: center; gap: 1.5mm; }
.as-box { display: inline-block; width: 3.6mm; height: 3.6mm; border: 0.3mm solid #172b25; border-radius: 0.5mm; text-align: center; font-size: 11pt !important; line-height: 3.4mm !important; font-weight: 700; }
.as-trailing { margin-left: auto; }
.as-textbox { border: 1px solid #d4dfd9; border-radius: 1.5mm; padding: 1mm 3mm; white-space: pre-wrap; overflow-wrap: anywhere; }
.as-photos { display: grid; grid-template-columns: repeat(6, minmax(0,1fr)); gap: 2mm; }
.as-photo { height: 18mm; border: 1px solid #c9d6cf; border-radius: 1mm; background: #eef3f0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.as-photo img { width: 100%; height: 100%; object-fit: cover; }
.as-photo.as-empty { background: #ffffff; border-style: dashed; }
.as-photo.as-empty, .as-photo.as-empty *, .as-photo-label, .as-photo-label * { font-size: 12pt !important; color: #52645d; }
.as-photo-label { text-align: center; }
.as-list { margin: 0; padding-left: 5mm; }
.as-list li, .as-list li * { font-size: 14pt !important; }
.as-ack { margin-top: 3mm; }
.as-sig-sub, .as-sig-sub * { font-size: 12pt !important; color: #52645d; }
`;

/** ย่อรูปในเบราว์เซอร์ก่อนพิมพ์ — Chromium ฝังไฟล์รูปต้นฉบับทั้งไฟล์ลง PDF ถ้าไม่ย่อ (รูปมือถือ
 * 2–5MB × 6) · renderer รอ `window.__afterSalesThumbs` ก่อนเรียก page.pdf() */
const THUMB_SCRIPT = `<script>
window.__afterSalesThumbs = Promise.all(Array.prototype.map.call(document.querySelectorAll('img[data-thumb]'), function (img) {
  return img.decode().then(function () {
    var w = 360;
    var h = Math.round((img.naturalHeight * w) / img.naturalWidth) || w;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    img.src = c.toDataURL('image/jpeg', 0.82);
    return img.decode();
  }).catch(function () {
    img.removeAttribute('src');
    img.alt = 'เปิดรูปไม่ได้';
  });
}));
</script>`;

function kvRows(rows: DocKv[]): string {
  return rows
    .map(
      (r) =>
        `<span>${escapeHtml(r.label)}</span><span>${
          r.strong ? `<strong>${escapeHtml(r.value)}</strong>` : escapeHtml(r.value)
        }</span>`,
    )
    .join('');
}

function section(s: DocSection): string {
  return `<div><p class="bc-doc-label">${escapeHtml(s.title)}</p><div class="bc-doc-kv">${kvRows(s.rows)}</div></div>`;
}

function check(c: DocCheck, extraClass = ''): string {
  return `<span class="as-check${extraClass}"><span class="as-box">${c.checked ? '✓' : ''}</span>${escapeHtml(c.text)}</span>`;
}

function photo(p: DocPhoto): string {
  const ok = !!p.dataUrl && SAFE_IMAGE_DATA_URL.test(p.dataUrl);
  const inner = ok
    ? `<img data-thumb alt="มุม${escapeHtml(p.angle)}" src="${p.dataUrl}">`
    : `<span>${escapeHtml(p.emptyText)}</span>`;
  return `<div><div class="as-photo${ok ? '' : ' as-empty'}">${inner}</div><p class="as-photo-label">${escapeHtml(p.angle)}</p></div>`;
}

function renderBlock(b: DocBlock): string {
  switch (b.type) {
    case 'pair':
      return `<section class="as-block as-pair">${section(b.left)}${section(b.right)}</section>`;
    case 'section':
      return `<section class="as-block">${section(b.section)}</section>`;
    case 'table': {
      const head = b.head.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
      const rows = b.rows
        .map((r, i) => {
          const strong = b.strongRows?.includes(i) ?? false;
          const cells = r
            .map((c) =>
              strong ? `<td><strong>${escapeHtml(c)}</strong></td>` : `<td>${escapeHtml(c)}</td>`,
            )
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
    }
    case 'checks':
      return `<div class="as-checks"><span class="as-muted">${escapeHtml(b.label)}</span>${b.items
        .map((i) => check(i))
        .join('')}${b.trailing ? check(b.trailing, ' as-trailing') : ''}</div>`;
    case 'box':
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><div class="as-textbox">${escapeHtml(b.text)}</div></section>`;
    case 'photos':
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><div class="as-photos">${b.photos
        .map(photo)
        .join('')}</div></section>`;
    case 'list':
      return `<section class="as-block"><p class="bc-doc-label">${escapeHtml(b.title)}</p><ol class="as-list">${b.items
        .map((i) => `<li>${escapeHtml(i)}</li>`)
        .join('')}</ol></section>`;
  }
}

function header(doc: AfterSalesDoc): string {
  const c = doc.company;
  const taxLine = c.taxId
    ? `<p>เลขประจำตัวผู้เสียภาษี ${escapeHtml(c.taxId)}${c.phone ? ` · โทร ${escapeHtml(c.phone)}` : ''}</p>`
    : c.phone
      ? `<p>โทร ${escapeHtml(c.phone)}</p>`
      : '';
  const brand = `<div class="bc-doc-brand"><div>${AFTER_SALES_LOGO_SVG}</div><p class="bc-doc-company">${escapeHtml(c.nameTh)}</p>${
    c.address ? `<p>${escapeHtml(c.address)}</p>` : ''
  }${taxLine}</div>`;
  const meta = doc.meta
    .map((m) => `<span>${escapeHtml(m.label)}</span><span>${escapeHtml(m.value)}</span>`)
    .join('');
  const identity = `<div class="bc-doc-identity"><h1>${escapeHtml(doc.title)}</h1><p class="bc-doc-kicker">${escapeHtml(doc.kicker)}</p><div class="bc-doc-meta">${meta}</div></div>`;
  return `<div class="bc-doc-header">${brand}${identity}</div>`;
}

function signatures(sigs: [DocSignature, DocSignature]): string {
  return `<div class="bc-doc-approval">${sigs
    .map(
      (s) =>
        `<div class="bc-doc-signature"><div class="sign-space"></div><p>${escapeHtml(s.role)} — ( ${escapeHtml(s.name)} )</p><p class="as-sig-sub">${escapeHtml(s.sub)}</p></div>`,
    )
    .join('')}</div>`;
}

export function buildAfterSalesDocHtml(doc: AfterSalesDoc): string {
  const hasPhotos = doc.blocks.some(
    (b) => b.type === 'photos' && b.photos.some((p) => !!p.dataUrl && SAFE_IMAGE_DATA_URL.test(p.dataUrl)),
  );
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(doc.title)}</title>
<style>
${DOCUMENT_WEB_FONT_FACES}
${TRANSACTION_PAGE_CSS}
${transactionDocumentCss('body')}
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
${AS_CSS}
</style>
</head>
<body>
${header(doc)}
${doc.blocks.map(renderBlock).join('\n')}
<p class="as-ack">${escapeHtml(doc.ack)}</p>
${signatures(doc.signatures)}
<div class="bc-doc-footer"><span>${escapeHtml(doc.footer)}</span><span>${DOC_NOT_RECEIPT}</span></div>
${hasPhotos ? THUMB_SCRIPT : ''}
</body>
</html>`;
}
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-html.spec.ts --runInBand`
Expected: PASS (8 tests)

- [ ] **Step 6: format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/api/src/modules/after-sales/documents/after-sales-doc-html.ts apps/api/src/modules/after-sales/__tests__/doc-html.spec.ts
git add apps/api/src/modules/after-sales/documents/after-sales-logo.ts apps/api/src/modules/after-sales/documents/after-sales-doc-html.ts apps/api/src/modules/after-sales/__tests__/doc-html.spec.ts
git commit -m "feat(after-sales): ตัวแปลงเอกสารหลังการขายเป็น HTML (ใบรับฝาก/ใบส่งมอบ)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: กติกาถ้อยคำของเอกสาร (compose — pure)

**Files:**
- Create: `apps/api/src/modules/after-sales/documents/after-sales-doc-compose.ts`
- Test: `apps/api/src/modules/after-sales/__tests__/doc-compose.spec.ts`

**Interfaces:**
- Consumes: Task 1 types (`AfterSalesDoc`, `DocBlock`, `DocCheck`, `DocCompany`, `DocKv`, `DocSection`) · `formatThaiDateText` จาก `apps/api/src/utils/thai-date.util.ts` ("7 ก.ย. 2569", เวลาไทย) · `PRICED_EXCHANGE_COST_LINE` จาก `apps/api/src/modules/after-sales/utils/after-sales-line-copy.util.ts`
- Produces: `DocSource` (interface) · `DocPayer` · `composeReceiptDoc(s: DocSource): AfterSalesDoc` · `composeHandoverDoc(s: DocSource): AfterSalesDoc` · `handoverBlockReason(c: { outcome: AfterSalesOutcome | null; stage: AfterSalesStage; hasRepairTicket: boolean }): string | null` · `RECEIPT_CONDITIONS: readonly string[]` · `PHOTO_ANGLES` · `SYMPTOM_MAX = 300` · `OTHER_MAX = 60` · `HANDOVER_NOT_READY_MSG`

- [ ] **Step 1: เขียนเทสต์ที่ล้มก่อน** — `apps/api/src/modules/after-sales/__tests__/doc-compose.spec.ts`

```ts
import {
  composeHandoverDoc,
  composeReceiptDoc,
  handoverBlockReason,
  HANDOVER_NOT_READY_MSG,
  OTHER_MAX,
  RECEIPT_CONDITIONS,
  SYMPTOM_MAX,
  type DocSource,
} from '../documents/after-sales-doc-compose';
import { buildAfterSalesDocHtml, type AfterSalesDoc, type DocBlock } from '../documents/after-sales-doc-html';
import { PRICED_EXCHANGE_COST_LINE } from '../utils/after-sales-line-copy.util';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function source(over: Partial<DocSource> = {}): DocSource {
  return {
    company: { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: 'ลพบุรี', taxId: '0165568000050', phone: null },
    caseNumber: 'AS-20260907-0004',
    branchName: 'ลพบุรี',
    receivedAt: new Date('2026-09-07T03:12:00.000Z'), // 10:12 น. เวลาไทย
    receivedByName: 'สุดา',
    printedAt: new Date('2026-09-26T08:41:00.000Z'), // 15:41 น.
    printedByName: 'นิภา',
    customerName: 'สมชาย ใจดี',
    customerPhone: '0812344412',
    lineLinked: true,
    source: 'INSTALLMENT_CONTRACT',
    contractNumber: 'CT-2026-0912',
    saleNumber: null,
    deviceLabel: 'Apple iPhone 13 128GB · ดำ · มือสอง',
    deviceImei: '356812345674412',
    deviceSerial: 'F2LXK3P09Q',
    accessories: { box: true, charger: true, case: false, other: null },
    unlockConfirmed: true,
    symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
    photoCount: 3,
    photos: [PNG, PNG, PNG],
    warranty: {
      purchasedAt: new Date('2026-08-19T05:00:00.000Z'),
      shopWarrantyEnd: new Date('2026-11-17T00:00:00.000Z'),
      manufacturerWarrantyEnd: new Date('2027-09-17T00:00:00.000Z'),
      within7Days: false,
    },
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    closedAt: null,
    repair: {
      payer: 'SHOP',
      estimatedCost: null,
      actualCost: null,
      supplierName: null,
      externalClaimNo: null,
      sentToRepairAt: null,
      repairedAt: null,
      returnedToCustomerAt: null,
    },
    exchange: null,
    ...over,
  };
}

function rows(doc: AfterSalesDoc) {
  return doc.blocks.flatMap((b) =>
    b.type === 'pair' ? [...b.left.rows, ...b.right.rows] : b.type === 'section' ? b.section.rows : [],
  );
}
const valueOf = (doc: AfterSalesDoc, label: string) => rows(doc).find((r) => r.label === label)?.value;
const block = <T extends DocBlock['type']>(doc: AfterSalesDoc, type: T) =>
  doc.blocks.find((b): b is Extract<DocBlock, { type: T }> => b.type === type);

describe('composeReceiptDoc — ใบรับฝากเครื่อง', () => {
  it('(a) สัญญาผ่อน ร้านจ่าย: หัว/ที่มา/สิทธิ์/ทางออก/เงื่อนไข/ลายเซ็น ครบตามกระดาน 8', () => {
    const doc = composeReceiptDoc(source());
    expect(doc.title).toBe('ใบรับฝากเครื่อง');
    expect(doc.kicker).toBe('ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)');
    expect(doc.meta).toEqual([
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'วันที่รับฝาก', value: '7 ก.ย. 2569 · 10:12 น.' },
      { label: 'สาขา', value: 'ลพบุรี' },
      { label: 'พนักงาน', value: 'สุดา' },
    ]);
    expect(valueOf(doc, 'ชื่อ')).toBe('สมชาย ใจดี');
    expect(valueOf(doc, 'แจ้งสถานะ')).toBe('ทาง LINE (ผูกไว้แล้ว)');
    expect(valueOf(doc, 'ซื้อแบบ')).toBe('สัญญาผ่อน CT-2026-0912');
    expect(valueOf(doc, 'วันที่ซื้อ')).toBe('19 ส.ค. 2569');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 17 พ.ย. 2569');
    expect(valueOf(doc, 'ประกันศูนย์')).toBe('ถึง 17 ก.ย. 2570');
    expect(valueOf(doc, 'กรอบ 7 วัน')).toBe('เลยแล้ว');
    expect(valueOf(doc, 'ทางออก')).toBe('ซ่อม');
    expect(valueOf(doc, 'ผู้จ่ายค่าซ่อม')).toBe('ร้าน');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(block(doc, 'table')?.rows).toEqual([
      ['Apple iPhone 13 128GB · ดำ · มือสอง', '356812345674412', 'F2LXK3P09Q'],
    ]);
    expect(block(doc, 'list')?.items).toEqual([...RECEIPT_CONDITIONS]);
    expect(doc.signatures[0]).toEqual({
      role: 'ลูกค้า (ผู้ฝาก)',
      name: 'สมชาย ใจดี',
      sub: 'วันที่ ........ / ........ / ........',
    });
    expect(doc.signatures[1]).toEqual({ role: 'พนักงาน', name: 'สุดา', sub: 'ลพบุรี · 7 ก.ย. 2569' });
    expect(doc.footer).toBe('หลังการขาย · เคส AS-20260907-0004 · พิมพ์ 26 ก.ย. 2569 15:41 น. โดย นิภา');
  });

  it('(b) ลูกค้าจ่าย มี/ไม่มีราคาประมาณ · ไม่ผูก LINE', () => {
    const repair = { ...source().repair!, payer: 'CUSTOMER' as const };
    expect(
      valueOf(composeReceiptDoc(source({ repair: { ...repair, estimatedCost: '1500.5' } })), 'ลูกค้าจ่าย'),
    ).toBe('ประมาณ 1,500.50 บาท — แจ้งให้ยืนยันก่อนซ่อม');
    const noEstimate = composeReceiptDoc(source({ repair, lineLinked: false }));
    expect(valueOf(noEstimate, 'ลูกค้าจ่าย')).toBe('ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อม');
    expect(valueOf(noEstimate, 'ผู้จ่ายค่าซ่อม')).toBe('ลูกค้า');
    expect(valueOf(noEstimate, 'แจ้งสถานะ')).toBe('โทรแจ้ง (ยังไม่ผูก LINE)');
  });

  it('(c) เปลี่ยนแบบมีราคา / เปลี่ยนรุ่นเดิม / ยังไม่เลือกทางออก', () => {
    const priced = composeReceiptDoc(source({ outcome: 'PRICED_EXCHANGE', repair: null }));
    expect(valueOf(priced, 'ทางออก')).toBe('เปลี่ยนแบบมีราคา');
    expect(valueOf(priced, 'ผู้จ่ายค่าซ่อม')).toBeUndefined();
    expect(valueOf(priced, 'ลูกค้าจ่าย')).toBe(PRICED_EXCHANGE_COST_LINE);
    const same = composeReceiptDoc(source({ outcome: 'SAME_MODEL_EXCHANGE', repair: null }));
    expect(valueOf(same, 'ทางออก')).toBe('เปลี่ยนรุ่นเดิม');
    expect(valueOf(same, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    const none = composeReceiptDoc(source({ outcome: null, repair: null }));
    expect(valueOf(none, 'ทางออก')).toBe('ยังไม่ได้เลือก');
    expect(valueOf(none, 'ลูกค้าจ่าย')).toBe('—');
  });

  it('(d) walk-in / ขายสด: ที่มาและสิทธิ์', () => {
    const walkIn = composeReceiptDoc(
      source({ source: 'WALK_IN', contractNumber: null, warranty: { purchasedAt: null, shopWarrantyEnd: null, manufacturerWarrantyEnd: null, within7Days: false } }),
    );
    expect(valueOf(walkIn, 'ซื้อแบบ')).toBe('ไม่ได้ซื้อจากร้าน');
    expect(valueOf(walkIn, 'วันที่ซื้อ')).toBe('—');
    expect(valueOf(walkIn, 'สถานะ')).toBe('ไม่ได้ซื้อจากร้าน — ไม่มีประกันร้าน');
    expect(valueOf(walkIn, 'ประกันร้าน')).toBeUndefined();
    const cash = composeReceiptDoc(source({ source: 'CASH_SALE', contractNumber: null, saleNumber: 'SL-20260819-0003' }));
    expect(valueOf(cash, 'ซื้อแบบ')).toBe('ขายสด / ไฟแนนซ์นอก SL-20260819-0003');
  });

  it('(e) อาการยาวเกิน 300 / "อื่น ๆ" ยาวเกิน 60 → ตัดพร้อมบอกว่าเต็มอยู่ในระบบ', () => {
    const doc = composeReceiptDoc(
      source({ symptom: 'ก'.repeat(400), accessories: { box: false, charger: false, case: false, other: 'ข'.repeat(100) } }),
    );
    expect(block(doc, 'box')?.text).toBe(`${'ก'.repeat(SYMPTOM_MAX)}… (ข้อความเต็มในระบบ)`);
    const checks = block(doc, 'checks')!;
    expect(checks.items[3]).toEqual({
      text: `อื่น ๆ — ${'ข'.repeat(OTHER_MAX)}… (ข้อความเต็มในระบบ)`,
      checked: true,
    });
    expect(checks.trailing).toEqual({ text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: true });
  });

  it('(f) รูป: 6 ช่องตามมุม · ช่องที่มีรูปแต่อ่านไม่ได้ = "เปิดรูปไม่ได้" · ช่องเกินจำนวน = "ไม่ได้ถ่าย"', () => {
    const doc = composeReceiptDoc(source({ photoCount: 3, photos: [PNG, null, PNG] }));
    const photos = block(doc, 'photos')!;
    expect(photos.title).toBe('สภาพเครื่องตอนรับฝาก (รูปถ่าย 3 มุม — รูปเต็มอยู่ในระบบ)');
    // emptyText ของช่องที่ "ควรมีรูป" (i < photoCount) = "เปิดรูปไม่ได้" เสมอ — builder ใช้เฉพาะเมื่อรูปใช้ไม่ได้
    expect(photos.photos.map((p) => [p.angle, !!p.dataUrl, p.emptyText])).toEqual([
      ['หน้า', true, 'เปิดรูปไม่ได้'],
      ['หลัง', false, 'เปิดรูปไม่ได้'],
      ['ซ้าย', true, 'เปิดรูปไม่ได้'],
      ['ขวา', false, 'ไม่ได้ถ่าย'],
      ['บน', false, 'ไม่ได้ถ่าย'],
      ['ล่าง', false, 'ไม่ได้ถ่าย'],
    ]);
    expect(block(composeReceiptDoc(source({ photoCount: 0, photos: [] })), 'photos')!.title).toBe(
      'สภาพเครื่องตอนรับฝาก (ไม่ได้ถ่ายรูป)',
    );
  });
});

describe('composeHandoverDoc — ใบส่งมอบ', () => {
  const readyRepair = (over: Partial<NonNullable<DocSource['repair']>> = {}) =>
    source({
      stage: 'READY_FOR_PICKUP',
      repair: {
        payer: 'SHOP',
        estimatedCost: null,
        actualCost: '1500.00',
        supplierName: 'iCare ลพบุรี',
        externalClaimNo: 'IC-77821',
        sentToRepairAt: new Date('2026-09-08T07:00:00.000Z'),
        repairedAt: new Date('2026-09-25T04:00:00.000Z'),
        returnedToCustomerAt: null,
        ...over,
      },
    });

  it('(g) หลังซ่อม ร้านจ่าย: kicker/meta/ผลการซ่อม/ค่าใช้จ่าย/ประกัน/ack/ลายเซ็น — ยังไม่ส่งมอบ = วันที่พิมพ์', () => {
    const doc = composeHandoverDoc(readyRepair());
    expect(doc.title).toBe('ใบส่งมอบ');
    expect(doc.kicker).toBe('ส่งมอบเครื่องหลังซ่อม · ต้นฉบับ — ร้านเก็บ');
    expect(doc.meta).toEqual([
      { label: 'เลขเคส', value: 'AS-20260907-0004' },
      { label: 'วันที่ส่งมอบ', value: '26 ก.ย. 2569 · 15:41 น.' },
      { label: 'อ้างอิงใบรับฝาก', value: '7 ก.ย. 2569' },
      { label: 'พนักงาน', value: 'นิภา' },
    ]);
    expect(valueOf(doc, 'ซ่อมที่')).toBe('iCare ลพบุรี · เลขเคลม IC-77821');
    expect(valueOf(doc, 'ส่งซ่อม — เสร็จ')).toBe('8 ก.ย. 2569 — 25 ก.ย. 2569');
    expect(valueOf(doc, 'ผู้จ่ายค่าซ่อม')).toBe('ร้าน');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 17 พ.ย. 2569 (ตามเดิม)');
    expect(block(doc, 'table')?.rows).toEqual([
      ['Apple iPhone 13 128GB · ดำ · มือสอง', '356812345674412', 'F2LXK3P09Q', 'เครื่องเดิมของลูกค้า ซ่อมแล้ว'],
    ]);
    expect(doc.ack).toBe('ลูกค้าตรวจเครื่องและอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ');
    expect(doc.signatures[0].role).toBe('ลูกค้า (ผู้รับมอบ)');
    expect(doc.signatures[1]).toEqual({ role: 'พนักงานผู้ส่งมอบ', name: 'นิภา', sub: 'ลพบุรี · 26 ก.ย. 2569' });
  });

  it('(h) ลูกค้าจ่าย / เคลมศูนย์ / ซ่อมที่ร้าน / ส่งมอบแล้ว = วันที่ส่งมอบจริง', () => {
    const customer = composeHandoverDoc(
      readyRepair({ payer: 'CUSTOMER', actualCost: '1200', returnedToCustomerAt: new Date('2026-09-25T09:30:00.000Z') }),
    );
    expect(valueOf(customer, 'ลูกค้าจ่าย')).toBe('1,200.00 บาท · ใบเสร็จรับเงินออกแยกจากใบนี้');
    expect(customer.meta[1]).toEqual({ label: 'วันที่ส่งมอบ', value: '25 ก.ย. 2569 · 16:30 น.' });
    const claim = composeHandoverDoc(readyRepair({ payer: 'SUPPLIER_CLAIM' }));
    expect(valueOf(claim, 'ผู้จ่ายค่าซ่อม')).toBe('เคลมศูนย์');
    expect(valueOf(claim, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    const inShop = composeHandoverDoc(readyRepair({ supplierName: null, externalClaimNo: null, sentToRepairAt: null }));
    expect(valueOf(inShop, 'ซ่อมที่')).toBe('ซ่อมที่ร้าน');
    expect(valueOf(inShop, 'ส่งซ่อม — เสร็จ')).toBe('— — 25 ก.ย. 2569');
  });

  const exchangeSource = (outcome: 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE') =>
    source({
      outcome,
      stage: 'CLOSED',
      closedAt: new Date('2026-09-16T06:20:00.000Z'),
      repair: null,
      exchange: {
        oldDeviceLabel: 'Samsung A55 128GB',
        oldImei: '354211098761188',
        newDeviceLabel: 'Samsung A55 128GB · ฟ้า',
        newImei: '354211098763301',
        replacementContractNumber: outcome === 'PRICED_EXCHANGE' ? 'CT-2026-0951' : null,
        newShopWarrantyEnd: new Date('2026-11-28T00:00:00.000Z'),
        newManufacturerWarrantyEnd: new Date('2027-09-03T00:00:00.000Z'),
      },
    });

  it('(i) เปลี่ยนรุ่นเดิม: ตารางเครื่องเดิม/เครื่องที่ส่งมอบ + สัญญาเดิม + ค่าใช้จ่ายไม่มี + ประกันเครื่องใหม่', () => {
    const doc = composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE'));
    expect(doc.kicker).toBe('เปลี่ยนเครื่อง · ต้นฉบับ — ร้านเก็บ');
    expect(doc.meta[1]).toEqual({ label: 'วันที่ส่งมอบ', value: '16 ก.ย. 2569 · 13:20 น.' });
    const table = block(doc, 'table')!;
    expect(table.title).toBe('เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม (ภายใน 7 วันนับจากวันซื้อ)');
    expect(table.rows).toEqual([
      ['เครื่องเดิม — ลูกค้าส่งคืนร้าน', 'Samsung A55 128GB', '354211098761188'],
      ['เครื่องที่ส่งมอบ', 'Samsung A55 128GB · ฟ้า', '354211098763301'],
    ]);
    expect(table.strongRows).toEqual([1]);
    expect(valueOf(doc, 'สัญญาผ่อน')).toBe('CT-2026-0912');
    expect(valueOf(doc, 'ผลต่อสัญญา')).toBe('ใบเดิม ค่างวดและวันครบกำหนดเท่าเดิม');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe('ไม่มี');
    expect(valueOf(doc, 'ประกันร้าน')).toBe('ถึง 28 พ.ย. 2569 (ตามสัญญา)');
    expect(valueOf(doc, 'ประกันศูนย์')).toBe('ถึง 3 ก.ย. 2570');
    expect(doc.ack).toBe(
      'ลูกค้าส่งคืนเครื่องเดิมให้ร้าน และตรวจเครื่องที่ส่งมอบพร้อมอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ',
    );
  });

  it('(i2) เปลี่ยนแบบมีราคา: สัญญาใหม่แทนสัญญาเดิม + ค่าใช้จ่ายตามสัญญาใหม่', () => {
    const doc = composeHandoverDoc(exchangeSource('PRICED_EXCHANGE'));
    expect(block(doc, 'table')!.title).toBe('เปลี่ยนเครื่องแบบมีราคา (ทำสัญญาใหม่)');
    expect(valueOf(doc, 'สัญญาใหม่')).toBe('CT-2026-0951');
    expect(valueOf(doc, 'แทนสัญญาเดิม')).toBe('CT-2026-0912');
    expect(valueOf(doc, 'ลูกค้าจ่าย')).toBe(PRICED_EXCHANGE_COST_LINE);
  });

  it('ทุกแบบ: HTML ไม่มีคำว่า "รับเครื่อง"', () => {
    const docs = [
      composeReceiptDoc(source()),
      composeReceiptDoc(source({ outcome: 'PRICED_EXCHANGE', repair: null })),
      composeHandoverDoc(readyRepair()),
      composeHandoverDoc(readyRepair({ payer: 'CUSTOMER' })),
      composeHandoverDoc(exchangeSource('SAME_MODEL_EXCHANGE')),
      composeHandoverDoc(exchangeSource('PRICED_EXCHANGE')),
    ];
    for (const d of docs) expect(buildAfterSalesDocHtml(d)).not.toContain('รับเครื่อง');
  });
});

describe('handoverBlockReason', () => {
  it('(j) พิมพ์ได้เฉพาะ READY_FOR_PICKUP / CLOSED ที่มีทางออก · ซ่อมต้องมีใบซ่อม', () => {
    expect(handoverBlockReason({ outcome: 'REPAIR', stage: 'READY_FOR_PICKUP', hasRepairTicket: true })).toBeNull();
    expect(handoverBlockReason({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'CLOSED', hasRepairTicket: false })).toBeNull();
    for (const stage of ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'CANCELLED'] as const)
      expect(handoverBlockReason({ outcome: 'REPAIR', stage, hasRepairTicket: true })).toBe(HANDOVER_NOT_READY_MSG);
    expect(handoverBlockReason({ outcome: null, stage: 'CLOSED', hasRepairTicket: false })).toBe(HANDOVER_NOT_READY_MSG);
    expect(handoverBlockReason({ outcome: 'REPAIR', stage: 'CLOSED', hasRepairTicket: false })).toBe(
      'ไม่พบใบซ่อมของเคสนี้',
    );
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-compose.spec.ts --runInBand`
Expected: FAIL — `Cannot find module '../documents/after-sales-doc-compose'`

- [ ] **Step 3: เขียน compose** — `apps/api/src/modules/after-sales/documents/after-sales-doc-compose.ts`

```ts
import type { AfterSalesOutcome, AfterSalesStage } from '@prisma/client';
import { formatThaiDateText } from '../../../utils/thai-date.util';
import { PRICED_EXCHANGE_COST_LINE } from '../utils/after-sales-line-copy.util';
import type { AfterSalesDoc, DocBlock, DocCheck, DocCompany, DocKv } from './after-sales-doc-html';

/**
 * กติกาถ้อยคำของใบรับฝากเครื่อง / ใบส่งมอบ (PR 4, mockup กระดาน 8–10) — pure ไม่แตะฐานข้อมูล.
 * service (`after-sales-document.service.ts`) รวบข้อมูลเป็น `DocSource` แล้วส่งมาที่นี่ที่เดียว.
 * กฎคำ (สเปก 4.0): ห้ามมีคำว่า "รับเครื่อง" ในเอกสาร — ใช้ "รับฝาก" / "ส่งมอบ" / "ผู้รับมอบ"
 */

export type DocPayer = 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';

export interface DocSource {
  company: DocCompany;
  caseNumber: string;
  branchName: string;
  receivedAt: Date;
  receivedByName: string;
  printedAt: Date;
  printedByName: string;
  customerName: string;
  customerPhone: string | null;
  lineLinked: boolean;
  source: 'INSTALLMENT_CONTRACT' | 'CASH_SALE' | 'WALK_IN';
  contractNumber: string | null;
  saleNumber: string | null;
  deviceLabel: string;
  deviceImei: string | null;
  deviceSerial: string | null;
  accessories: { box: boolean; charger: boolean; case: boolean; other: string | null };
  unlockConfirmed: boolean;
  symptom: string;
  /** จำนวนรูปตอนรับฝากที่เคสเก็บไว้ (อาจมากกว่ารูปที่อ่านได้จริง) */
  photoCount: number;
  /** data URL ตามลำดับ (index = มุม ตาม PHOTO_ANGLES — ลำดับเดียวกับหน้าเคส `PhotoCompare`) · null = อ่านไม่ได้ */
  photos: (string | null)[];
  warranty: {
    purchasedAt: Date | null;
    shopWarrantyEnd: Date | null;
    manufacturerWarrantyEnd: Date | null;
    within7Days: boolean;
  };
  outcome: AfterSalesOutcome | null;
  stage: AfterSalesStage;
  closedAt: Date | null;
  repair: {
    payer: DocPayer;
    estimatedCost: string | null;
    actualCost: string | null;
    supplierName: string | null;
    externalClaimNo: string | null;
    sentToRepairAt: Date | null;
    repairedAt: Date | null;
    returnedToCustomerAt: Date | null;
  } | null;
  exchange: {
    oldDeviceLabel: string;
    oldImei: string | null;
    newDeviceLabel: string | null;
    newImei: string | null;
    replacementContractNumber: string | null;
    newShopWarrantyEnd: Date | null;
    newManufacturerWarrantyEnd: Date | null;
  } | null;
}

export const PHOTO_ANGLES = ['หน้า', 'หลัง', 'ซ้าย', 'ขวา', 'บน', 'ล่าง'] as const;
export const SYMPTOM_MAX = 300;
export const OTHER_MAX = 60;
export const HANDOVER_NOT_READY_MSG = 'ใบส่งมอบพิมพ์ได้เมื่อเคสพร้อมให้ลูกค้ารับหรือปิดแล้ว';

/** เงื่อนไขการรับฝาก — ร่างกระดาน 8 · ข้อ "ไม่มาติดต่อเกินกี่วัน" รอเจ้าของกำหนด (เพิ่มท้ายอาร์เรย์นี้) */
export const RECEIPT_CONDITIONS = [
  'ร้านรับฝากเครื่องตามสภาพ อุปกรณ์ และรูปถ่ายในใบนี้ ลูกค้าตรวจแล้วว่าถูกต้อง',
  'กรุณาสำรองข้อมูลในเครื่องไว้เอง การซ่อมที่ศูนย์อาจล้างข้อมูลทั้งหมด',
  'ถ้าพบว่ามีค่าใช้จ่ายที่ลูกค้าต้องจ่าย ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อมทุกครั้ง',
  'เมื่อเครื่องพร้อม ร้านแจ้งทาง LINE หรือโทร',
  'ตอนมาติดต่อ ให้แสดงบัตรประชาชน หรือแจ้งเลขเคสด้านบน',
] as const;

const OUTCOME_TEXT: Record<AfterSalesOutcome, string> = {
  REPAIR: 'ซ่อม',
  SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม',
  PRICED_EXCHANGE: 'เปลี่ยนแบบมีราคา',
  CASH_SAME_MODEL_EXCHANGE: 'เปลี่ยนรุ่นเดิม',
};

const PAYER_TEXT: Record<DocPayer, string> = {
  SHOP: 'ร้าน',
  CUSTOMER: 'ลูกค้า',
  SUPPLIER_CLAIM: 'เคลมศูนย์',
};

const CLIP_SUFFIX = '… (ข้อความเต็มในระบบ)';
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}${CLIP_SUFFIX}` : text);
const date = (v: Date | null) => (v ? formatThaiDateText(v) : '—');

export function bkkTime(v: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(v);
}

const dateTime = (v: Date) => `${formatThaiDateText(v)} · ${bkkTime(v)} น.`;
const baht = (v: string) =>
  Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isSameModel = (o: AfterSalesOutcome | null) =>
  o === 'SAME_MODEL_EXCHANGE' || o === 'CASH_SAME_MODEL_EXCHANGE';

export function handoverBlockReason(c: {
  outcome: AfterSalesOutcome | null;
  stage: AfterSalesStage;
  hasRepairTicket: boolean;
}): string | null {
  if (!c.outcome || (c.stage !== 'READY_FOR_PICKUP' && c.stage !== 'CLOSED')) return HANDOVER_NOT_READY_MSG;
  if (c.outcome === 'REPAIR' && !c.hasRepairTicket) return 'ไม่พบใบซ่อมของเคสนี้';
  return null;
}

function sourceRow(s: DocSource): DocKv {
  if (s.source === 'INSTALLMENT_CONTRACT')
    return { label: 'ซื้อแบบ', value: s.contractNumber ? `สัญญาผ่อน ${s.contractNumber}` : 'สัญญาผ่อน' };
  if (s.source === 'CASH_SALE')
    return {
      label: 'ซื้อแบบ',
      value: s.saleNumber ? `ขายสด / ไฟแนนซ์นอก ${s.saleNumber}` : 'ขายสด / ไฟแนนซ์นอก',
    };
  return { label: 'ซื้อแบบ', value: 'ไม่ได้ซื้อจากร้าน' };
}

function accessoryChecks(a: DocSource['accessories']): DocCheck[] {
  return [
    { text: 'กล่อง', checked: a.box },
    { text: 'สายชาร์จ', checked: a.charger },
    { text: 'เคส', checked: a.case },
    { text: a.other ? `อื่น ๆ — ${clip(a.other, OTHER_MAX)}` : 'อื่น ๆ', checked: !!a.other },
  ];
}

function customerRows(s: DocSource): DocKv[] {
  return [
    { label: 'ชื่อ', value: s.customerName, strong: true },
    { label: 'โทร', value: s.customerPhone ?? '—' },
  ];
}

function receiptCustomerCost(s: DocSource): string {
  if (!s.outcome) return '—';
  if (s.outcome === 'PRICED_EXCHANGE') return PRICED_EXCHANGE_COST_LINE;
  if (isSameModel(s.outcome)) return 'ไม่มี';
  const payer = s.repair?.payer ?? 'CUSTOMER';
  if (payer !== 'CUSTOMER') return 'ไม่มี';
  return s.repair?.estimatedCost
    ? `ประมาณ ${baht(s.repair.estimatedCost)} บาท — แจ้งให้ยืนยันก่อนซ่อม`
    : 'ร้านจะแจ้งราคาให้ยืนยันก่อนซ่อม';
}

function handoverCustomerCost(s: DocSource): string {
  if (s.outcome === 'PRICED_EXCHANGE') return PRICED_EXCHANGE_COST_LINE;
  if (s.outcome !== 'REPAIR' || !s.repair || s.repair.payer !== 'CUSTOMER') return 'ไม่มี';
  const amount = s.repair.actualCost ?? s.repair.estimatedCost;
  return amount
    ? `${baht(amount)} บาท · ใบเสร็จรับเงินออกแยกจากใบนี้`
    : 'ตามที่แจ้งไว้ · ใบเสร็จรับเงินออกแยกจากใบนี้';
}

function rightsRows(s: DocSource): DocKv[] {
  if (s.source === 'WALK_IN') return [{ label: 'สถานะ', value: 'ไม่ได้ซื้อจากร้าน — ไม่มีประกันร้าน' }];
  return [
    { label: 'ประกันร้าน', value: s.warranty.shopWarrantyEnd ? `ถึง ${date(s.warranty.shopWarrantyEnd)}` : 'ไม่มี' },
    {
      label: 'ประกันศูนย์',
      value: s.warranty.manufacturerWarrantyEnd ? `ถึง ${date(s.warranty.manufacturerWarrantyEnd)}` : 'ไม่มี',
    },
    { label: 'กรอบ 7 วัน', value: s.warranty.within7Days ? 'ยังอยู่ในกรอบ' : 'เลยแล้ว' },
  ];
}

function footer(s: DocSource): string {
  return `หลังการขาย · เคส ${s.caseNumber} · พิมพ์ ${formatThaiDateText(s.printedAt)} ${bkkTime(s.printedAt)} น. โดย ${s.printedByName}`;
}

const BLANK_DATE = 'วันที่ ........ / ........ / ........';

export function composeReceiptDoc(s: DocSource): AfterSalesDoc {
  const photoTotal = Math.min(s.photoCount, PHOTO_ANGLES.length);
  const outcomeRows: DocKv[] = [
    { label: 'ทางออก', value: s.outcome ? OUTCOME_TEXT[s.outcome] : 'ยังไม่ได้เลือก', strong: true },
    ...(s.outcome === 'REPAIR'
      ? [{ label: 'ผู้จ่ายค่าซ่อม', value: PAYER_TEXT[s.repair?.payer ?? 'CUSTOMER'] }]
      : []),
    { label: 'ลูกค้าจ่าย', value: receiptCustomerCost(s) },
  ];
  const blocks: DocBlock[] = [
    {
      type: 'pair',
      left: {
        title: 'ลูกค้า (ผู้ฝาก)',
        rows: [
          ...customerRows(s),
          { label: 'แจ้งสถานะ', value: s.lineLinked ? 'ทาง LINE (ผูกไว้แล้ว)' : 'โทรแจ้ง (ยังไม่ผูก LINE)' },
        ],
      },
      right: {
        title: 'ที่มาของเครื่อง',
        rows: [sourceRow(s), { label: 'วันที่ซื้อ', value: date(s.warranty.purchasedAt) }],
      },
    },
    {
      type: 'table',
      title: 'เครื่องที่ฝาก',
      head: ['เครื่อง', 'IMEI', 'Serial'],
      rows: [[s.deviceLabel, s.deviceImei ?? '—', s.deviceSerial ?? '—']],
    },
    {
      type: 'checks',
      label: 'อุปกรณ์ที่ฝากมาด้วย',
      items: accessoryChecks(s.accessories),
      trailing: { text: 'ลูกค้าปิด Find My / ออกจากบัญชีแล้ว', checked: s.unlockConfirmed },
    },
    { type: 'box', title: 'อาการที่ลูกค้าแจ้ง', text: clip(s.symptom, SYMPTOM_MAX) },
    {
      type: 'photos',
      title:
        photoTotal > 0
          ? `สภาพเครื่องตอนรับฝาก (รูปถ่าย ${photoTotal} มุม — รูปเต็มอยู่ในระบบ)`
          : 'สภาพเครื่องตอนรับฝาก (ไม่ได้ถ่ายรูป)',
      photos: PHOTO_ANGLES.map((angle, i) => ({
        angle,
        dataUrl: s.photos[i] ?? null,
        emptyText: i < photoTotal ? 'เปิดรูปไม่ได้' : 'ไม่ได้ถ่าย',
      })),
    },
    {
      type: 'pair',
      left: { title: 'สิทธิ์ ณ วันแจ้ง', rows: rightsRows(s) },
      right: { title: 'ทางออกที่ตกลงกัน', rows: outcomeRows },
    },
    { type: 'list', title: 'เงื่อนไขการรับฝาก', items: [...RECEIPT_CONDITIONS] },
  ];
  return {
    title: 'ใบรับฝากเครื่อง',
    kicker: 'ต้นฉบับ — ร้านเก็บ (ลูกค้าเซ็น)',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่รับฝาก', value: dateTime(s.receivedAt) },
      { label: 'สาขา', value: s.branchName },
      { label: 'พนักงาน', value: s.receivedByName },
    ],
    blocks,
    ack: 'ข้าพเจ้าฝากเครื่องตามรายการข้างต้นไว้กับร้าน และรับทราบเงื่อนไขทั้งหมดแล้ว',
    signatures: [
      { role: 'ลูกค้า (ผู้ฝาก)', name: s.customerName, sub: BLANK_DATE },
      { role: 'พนักงาน', name: s.receivedByName, sub: `${s.branchName} · ${formatThaiDateText(s.receivedAt)}` },
    ],
    footer: footer(s),
  };
}

export function composeHandoverDoc(s: DocSource): AfterSalesDoc {
  const isRepair = s.outcome === 'REPAIR';
  const handedOverAt = isRepair ? (s.repair?.returnedToCustomerAt ?? s.printedAt) : (s.closedAt ?? s.printedAt);
  const blocks: DocBlock[] = [];

  if (isRepair) {
    const r = s.repair;
    blocks.push(
      {
        type: 'pair',
        left: { title: 'ลูกค้า (ผู้รับมอบ)', rows: customerRows(s) },
        right: { title: 'ที่มาของเครื่อง', rows: [sourceRow(s), { label: 'สาขา', value: s.branchName }] },
      },
      {
        type: 'table',
        title: 'เครื่องที่ส่งมอบ',
        head: ['เครื่อง', 'IMEI', 'Serial', 'หมายเหตุ'],
        rows: [[s.deviceLabel, s.deviceImei ?? '—', s.deviceSerial ?? '—', 'เครื่องเดิมของลูกค้า ซ่อมแล้ว']],
      },
      { type: 'checks', label: 'อุปกรณ์ที่คืน (ตามใบรับฝาก)', items: accessoryChecks(s.accessories) },
      {
        type: 'section',
        section: {
          title: 'ผลการซ่อม',
          rows: [
            {
              label: 'ซ่อมที่',
              value: r?.supplierName
                ? `${r.supplierName}${r.externalClaimNo ? ` · เลขเคลม ${r.externalClaimNo}` : ''}`
                : 'ซ่อมที่ร้าน',
            },
            {
              label: 'ส่งซ่อม — เสร็จ',
              value: `${date(r?.sentToRepairAt ?? null)} — ${date(r?.repairedAt ?? null)}`,
            },
          ],
        },
      },
      {
        type: 'pair',
        left: {
          title: 'ค่าใช้จ่าย',
          rows: [
            { label: 'ผู้จ่ายค่าซ่อม', value: PAYER_TEXT[r?.payer ?? 'CUSTOMER'] },
            { label: 'ลูกค้าจ่าย', value: handoverCustomerCost(s), strong: true },
          ],
        },
        right: {
          title: 'ประกันหลังส่งมอบ',
          rows: [
            {
              label: 'ประกันร้าน',
              value: s.warranty.shopWarrantyEnd ? `ถึง ${date(s.warranty.shopWarrantyEnd)} (ตามเดิม)` : 'ไม่มี',
            },
            {
              label: 'ประกันศูนย์',
              value: s.warranty.manufacturerWarrantyEnd ? `ถึง ${date(s.warranty.manufacturerWarrantyEnd)}` : 'ไม่มี',
            },
          ],
        },
      },
    );
  } else {
    const ex = s.exchange;
    const priced = s.outcome === 'PRICED_EXCHANGE';
    const contractRows: DocKv[] = priced
      ? [
          { label: 'สัญญาใหม่', value: ex?.replacementContractNumber ?? '—', strong: true },
          { label: 'แทนสัญญาเดิม', value: s.contractNumber ?? '—' },
          { label: 'ค่างวด', value: 'ตามสัญญาใหม่ที่ลูกค้าเซ็นแยก' },
        ]
      : [
          { label: 'สัญญาผ่อน', value: s.contractNumber ?? '—', strong: true },
          { label: 'ผลต่อสัญญา', value: 'ใบเดิม ค่างวดและวันครบกำหนดเท่าเดิม' },
        ];
    blocks.push(
      {
        type: 'pair',
        left: { title: 'ลูกค้า (ผู้รับมอบ)', rows: customerRows(s) },
        right: { title: 'สัญญา', rows: contractRows },
      },
      {
        type: 'table',
        title: priced
          ? 'เปลี่ยนเครื่องแบบมีราคา (ทำสัญญาใหม่)'
          : 'เปลี่ยนรุ่นเดิม ความจุเดิม ราคาเท่าเดิม (ภายใน 7 วันนับจากวันซื้อ)',
        head: ['', 'เครื่อง', 'IMEI'],
        rows: [
          ['เครื่องเดิม — ลูกค้าส่งคืนร้าน', ex?.oldDeviceLabel ?? s.deviceLabel, ex?.oldImei ?? s.deviceImei ?? '—'],
          ['เครื่องที่ส่งมอบ', ex?.newDeviceLabel ?? '—', ex?.newImei ?? '—'],
        ],
        strongRows: [1],
      },
      { type: 'checks', label: 'อุปกรณ์ที่ส่งมอบ', items: accessoryChecks(s.accessories) },
      {
        type: 'pair',
        left: {
          title: 'ค่าใช้จ่าย',
          rows: [
            { label: 'ลูกค้าจ่าย', value: handoverCustomerCost(s), strong: true },
            ...(priced ? [] : [{ label: 'เหตุผล', value: 'มีปัญหาภายใน 7 วันหลังซื้อ' }]),
          ],
        },
        right: {
          title: 'ประกันของเครื่องที่ส่งมอบ',
          rows: [
            {
              label: 'ประกันร้าน',
              value: ex?.newShopWarrantyEnd ? `ถึง ${date(ex.newShopWarrantyEnd)} (ตามสัญญา)` : 'ไม่มี',
            },
            {
              label: 'ประกันศูนย์',
              value: ex?.newManufacturerWarrantyEnd ? `ถึง ${date(ex.newManufacturerWarrantyEnd)}` : 'ไม่มี',
            },
          ],
        },
      },
    );
  }

  return {
    title: 'ใบส่งมอบ',
    kicker: isRepair ? 'ส่งมอบเครื่องหลังซ่อม · ต้นฉบับ — ร้านเก็บ' : 'เปลี่ยนเครื่อง · ต้นฉบับ — ร้านเก็บ',
    company: s.company,
    meta: [
      { label: 'เลขเคส', value: s.caseNumber },
      { label: 'วันที่ส่งมอบ', value: dateTime(handedOverAt) },
      { label: 'อ้างอิงใบรับฝาก', value: formatThaiDateText(s.receivedAt) },
      { label: 'พนักงาน', value: s.printedByName },
    ],
    blocks,
    ack: isRepair
      ? 'ลูกค้าตรวจเครื่องและอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ'
      : 'ลูกค้าส่งคืนเครื่องเดิมให้ร้าน และตรวจเครื่องที่ส่งมอบพร้อมอุปกรณ์ตามรายการข้างต้นแล้ว เปิดใช้งานได้ปกติ',
    signatures: [
      { role: 'ลูกค้า (ผู้รับมอบ)', name: s.customerName, sub: BLANK_DATE },
      {
        role: 'พนักงานผู้ส่งมอบ',
        name: s.printedByName,
        sub: `${s.branchName} · ${formatThaiDateText(handedOverAt)}`,
      },
    ],
    footer: footer(s),
  };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-compose.spec.ts --runInBand`
Expected: PASS (12 tests) · ถ้า `(a)` ล้มเพราะรูปวันที่ ให้ตรวจ `formatThaiDateText` คืน "7 ก.ย. 2569" (ไม่เติม 0) — ห้ามแก้เทสต์ให้ตรงกับรูปอื่น

- [ ] **Step 5: format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/api/src/modules/after-sales/documents/after-sales-doc-compose.ts apps/api/src/modules/after-sales/__tests__/doc-compose.spec.ts
git add apps/api/src/modules/after-sales/documents/after-sales-doc-compose.ts apps/api/src/modules/after-sales/__tests__/doc-compose.spec.ts
git commit -m "feat(after-sales): กติกาถ้อยคำใบรับฝากเครื่อง/ใบส่งมอบ (ซ่อม · เปลี่ยนรุ่นเดิม · เปลี่ยนแบบมีราคา)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: สร้าง PDF จริง — renderer + service + route + บันทึกการพิมพ์

**Files:**
- Create: `apps/api/src/modules/after-sales/documents/after-sales-pdf.renderer.ts`
- Create: `apps/api/src/modules/after-sales/services/after-sales-document.service.ts`
- Modify: `apps/api/src/modules/after-sales/after-sales.controller.ts` (constructor + 2 route + `sendPdf`)
- Modify: `apps/api/src/modules/after-sales/after-sales.module.ts` (providers)
- Modify: `apps/api/src/modules/after-sales/__tests__/intake-photos-upload.http.spec.ts` (provider mock)
- Test: `apps/api/src/modules/after-sales/__tests__/document-service.spec.ts`, `apps/api/src/modules/after-sales/__tests__/document-routes.http.spec.ts`, `apps/api/src/modules/after-sales/__tests__/doc-render.smoke.spec.ts`

**Interfaces:**
- Consumes: Task 1 `buildAfterSalesDocHtml`, `DocCompany` · Task 2 `composeReceiptDoc`, `composeHandoverDoc`, `handoverBlockReason`, `DocSource` · `AfterSalesQueryService.getCase(id, user)` (throws `NotFoundException` / `ForbiddenException`; คืนแถวเคสทุกคอลัมน์ + `customer{id,name,phone}` + `branch{id,name}` + `receivedBy{id,name}` + `repairTicket` (รวม `repairSupplier{id,name}`) + `exchange: CaseExchangeInfo | null` + `lineLinked` + `stage` ที่ reconcile แล้ว) · `StorageService.getStream(key): Promise<Readable>`
- Produces: `AfterSalesPdfRenderer.htmlToPdf(html: string): Promise<Buffer>` + `static closeShared(): Promise<void>` · `AfterSalesDocumentService.render(caseId: string, kind: AfterSalesDocKind, user: ReqUser): Promise<{ pdf: Buffer; caseNumber: string }>` · `type AfterSalesDocKind = 'RECEIPT' | 'HANDOVER'` · route `GET /after-sales/:id/receipt.pdf`, `GET /after-sales/:id/handover.pdf`

- [ ] **Step 1: เขียนเทสต์ service ที่ล้มก่อน** — `apps/api/src/modules/after-sales/__tests__/document-service.spec.ts`

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Readable } from 'stream';
import { AfterSalesDocumentService } from '../services/after-sales-document.service';
import { HANDOVER_NOT_READY_MSG } from '../documents/after-sales-doc-compose';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const user = { id: 'u-1', role: 'SALES', branchId: 'br-1' };

function caseDetail(over: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    caseNumber: 'AS-20260907-0004',
    branchId: 'br-1',
    source: 'INSTALLMENT_CONTRACT',
    contractId: 'ct-1',
    saleId: null,
    productId: 'p-1',
    outcome: 'REPAIR',
    stage: 'RECEIVED',
    receivedAt: new Date('2026-09-07T03:12:00.000Z'),
    closedAt: null,
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13 128GB',
    deviceImei: '356812345674412',
    deviceSerial: 'F2LXK3P09Q',
    symptom: 'เปิดไม่ติด ชาร์จไม่เข้า',
    accessories: { box: true, charger: true, case: false },
    unlockConfirmed: true,
    warrantySnapshot: {
      status: 'IN_SHOP_WARRANTY',
      daysRemainingIn7Day: 0,
      purchasedAt: '2026-08-19T05:00:00.000Z',
      shopWarrantyEndDate: '2026-11-17T00:00:00.000Z',
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-07T03:12:00.000Z',
    },
    customer: { id: 'cu-1', name: 'สมชาย ใจดี', phone: '0812344412' },
    branch: { id: 'br-1', name: 'ลพบุรี' },
    receivedBy: { id: 'u-2', name: 'สุดา' },
    repairTicket: {
      payer: 'SHOP',
      estimatedCost: null,
      actualCost: null,
      repairSupplier: null,
      externalClaimNo: null,
      sentToRepairAt: null,
      repairedAt: null,
      returnedToCustomerAt: null,
      deletedAt: null,
    },
    exchange: null,
    lineLinked: true,
    ...over,
  };
}

function setup(detail = caseDetail(), photoKeys: string[] = []) {
  const prisma = {
    afterSalesCase: { findUniqueOrThrow: jest.fn().mockResolvedValue({ photoKeys }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'นิภา' }) },
    branch: {
      findUnique: jest.fn().mockResolvedValue({
        company: { nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: 'ลพบุรี', taxId: '0165568000050', phone: null },
      }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue(null) },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        contractNumber: 'CT-2026-0912',
        shopWarrantyEndDate: new Date('2026-11-17T00:00:00.000Z'),
      }),
    },
    sale: { findUnique: jest.fn().mockResolvedValue(null) },
    product: {
      findUnique: jest.fn().mockResolvedValue({ color: 'ดำ', category: 'PHONE_USED', warrantyExpireDate: null }),
    },
    afterSalesEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = { getStream: jest.fn() };
  const query = { getCase: jest.fn().mockResolvedValue(detail) };
  const renderer = { htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
  const svc = new AfterSalesDocumentService(prisma as any, storage as any, query as any, renderer as any);
  const html = () => renderer.htmlToPdf.mock.calls[0][0] as string;
  return { prisma, storage, query, renderer, svc, html };
}

describe('AfterSalesDocumentService.render', () => {
  it('(a) ใบรับฝาก: ขอบเขตผ่าน getCase → HTML มีข้อมูลเคส → PDF + event PRINTED', async () => {
    const t = setup();
    const out = await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.query.getCase).toHaveBeenCalledWith(CASE_ID, user);
    expect(out).toEqual({ pdf: Buffer.from('%PDF-1.4'), caseNumber: 'AS-20260907-0004' });
    for (const text of [
      'ใบรับฝากเครื่อง',
      'AS-20260907-0004',
      'สัญญาผ่อน CT-2026-0912',
      'Apple iPhone 13 128GB · ดำ · มือสอง',
      'สมชาย ใจดี',
      'โดย นิภา',
    ])
      expect(t.html()).toContain(text);
    expect(t.prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: { caseId: CASE_ID, kind: 'PRINTED', note: 'ใบรับฝากเครื่อง', actorId: 'u-1' },
    });
  });

  it('(b) สาขาอื่น: getCase ปฏิเสธ → ไม่แตะ storage/renderer/event', async () => {
    const t = setup(caseDetail(), ['after-sales/x/intake-1.jpg']);
    t.query.getCase.mockRejectedValue(new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้'));
    await expect(t.svc.render(CASE_ID, 'RECEIPT', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.storage.getStream).not.toHaveBeenCalled();
    expect(t.renderer.htmlToPdf).not.toHaveBeenCalled();
    expect(t.prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  it('(c) ใบส่งมอบของเคสที่ยังไม่พร้อม → 400 ไทย ไม่เปิด Chromium', async () => {
    const t = setup(caseDetail({ stage: 'IN_REPAIR' }));
    await expect(t.svc.render(CASE_ID, 'HANDOVER', user)).rejects.toThrow(
      new BadRequestException(HANDOVER_NOT_READY_MSG),
    );
    expect(t.renderer.htmlToPdf).not.toHaveBeenCalled();
  });

  it('(d) รูป: อ่านได้ = ฝัง data URL · storage ล้ม/นามสกุลแปลก = "เปิดรูปไม่ได้" (ไม่ 500)', async () => {
    const t = setup(caseDetail(), [
      'after-sales/x/intake-1.jpg',
      'after-sales/x/intake-2.png',
      'after-sales/x/intake-3.gif',
    ]);
    t.storage.getStream
      .mockResolvedValueOnce(Readable.from([Buffer.from('abc')]))
      .mockRejectedValueOnce(new Error('NoSuchKey'));
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.storage.getStream).toHaveBeenCalledTimes(2);
    expect(t.html()).toContain('src="data:image/jpeg;base64,YWJj"');
    expect(t.html().match(/<span>เปิดรูปไม่ได้<\/span>/g)).toHaveLength(2);
    expect(t.html().match(/<span>ไม่ได้ถ่าย<\/span>/g)).toHaveLength(3);
  });

  it('(e) กันซ้ำ: เคยพิมพ์เอกสารเดิมโดยคนเดิมใน 5 นาที → ไม่เขียน event ใหม่', async () => {
    const t = setup();
    t.prisma.afterSalesEvent.findFirst.mockResolvedValue({ id: 'e-1' });
    const before = Date.now();
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    const where = t.prisma.afterSalesEvent.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ caseId: CASE_ID, kind: 'PRINTED', note: 'ใบรับฝากเครื่อง', actorId: 'u-1' });
    expect(before - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
    expect(before - where.createdAt.gte.getTime()).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(t.prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  it('(f) ใบส่งมอบหลังซ่อม ลูกค้าจ่าย: ยอดจริง + ไม่อ่านรูป + event "ใบส่งมอบ"', async () => {
    const t = setup(
      caseDetail({
        stage: 'READY_FOR_PICKUP',
        repairTicket: {
          ...caseDetail().repairTicket,
          payer: 'CUSTOMER',
          actualCost: { toString: () => '1200.00' },
          repairedAt: new Date('2026-09-25T04:00:00.000Z'),
        },
      }),
      ['after-sales/x/intake-1.jpg'],
    );
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    expect(t.storage.getStream).not.toHaveBeenCalled();
    expect(t.html()).toContain('1,200.00 บาท');
    expect(t.html()).toContain('ซ่อมที่ร้าน');
    expect(t.prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: { caseId: CASE_ID, kind: 'PRINTED', note: 'ใบส่งมอบ', actorId: 'u-1' },
    });
  });

  it('(g) สาขาไม่ผูกบริษัท → ใช้บริษัท SHOP', async () => {
    const t = setup();
    t.prisma.branch.findUnique.mockResolvedValue({ company: null });
    t.prisma.companyInfo.findFirst.mockResolvedValue({
      nameTh: 'SHOP COMPANY',
      address: '',
      taxId: '',
      phone: null,
    });
    await t.svc.render(CASE_ID, 'RECEIPT', user);
    expect(t.prisma.companyInfo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyCode: 'SHOP', deletedAt: null } }),
    );
    expect(t.html()).toContain('SHOP COMPANY');
  });

  it('(h) เขียน event ล้ม → การพิมพ์ยังสำเร็จ', async () => {
    const t = setup();
    t.prisma.afterSalesEvent.create.mockRejectedValue(new Error('db down'));
    await expect(t.svc.render(CASE_ID, 'RECEIPT', user)).resolves.toMatchObject({
      caseNumber: 'AS-20260907-0004',
    });
  });

  it('(i) ใบส่งมอบเปลี่ยนเครื่องมีราคา: เลขสัญญาใหม่ + ประกันสัญญาใหม่ + เครื่องใหม่', async () => {
    const t = setup(
      caseDetail({
        outcome: 'PRICED_EXCHANGE',
        stage: 'CLOSED',
        closedAt: new Date('2026-09-16T06:20:00.000Z'),
        repairTicket: null,
        exchange: {
          kind: 'PRICED',
          oldProduct: { brand: 'Samsung', model: 'A55', storage: '128GB', imeiSerial: '354211098761188' },
          newProduct: { id: 'p-new', brand: 'Samsung', model: 'A56', storage: '256GB', imeiSerial: '354211098769999' },
          replacementContract: { id: 'ct-new', contractNumber: 'CT-2026-0951', status: 'ACTIVE' },
        },
      }),
    );
    t.prisma.contract.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'ct-new'
        ? { contractNumber: 'CT-2026-0951', shopWarrantyEndDate: new Date('2026-12-16T00:00:00.000Z') }
        : { contractNumber: 'CT-2026-0912', shopWarrantyEndDate: new Date('2026-11-17T00:00:00.000Z') },
    );
    t.prisma.product.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'p-new'
        ? { color: 'ดำ', category: 'PHONE_NEW', warrantyExpireDate: new Date('2027-09-16T00:00:00.000Z') }
        : { color: 'ฟ้า', category: 'PHONE_NEW', warrantyExpireDate: null },
    );
    await t.svc.render(CASE_ID, 'HANDOVER', user);
    for (const text of [
      'CT-2026-0951',
      'แทนสัญญาเดิม',
      'Samsung A56 256GB · ดำ',
      '354211098769999',
      'ถึง 16 ธ.ค. 2569 (ตามสัญญา)',
      'ถึง 16 ก.ย. 2570',
    ])
      expect(t.html()).toContain(text);
  });
});
```

- [ ] **Step 2: เขียนเทสต์ route ที่ล้มก่อน** — `apps/api/src/modules/after-sales/__tests__/document-routes.http.spec.ts`

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AfterSalesController } from '../after-sales.controller';
import { AfterSalesService } from '../after-sales.service';
import { AfterSalesDocumentService } from '../services/after-sales-document.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BranchGuard } from '../../auth/guards/branch.guard';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /after-sales/:id/(receipt|handover).pdf (HTTP)', () => {
  let app: INestApplication;
  const render = jest.fn();
  const actor = { id: 'u-1', role: 'ACCOUNTANT', branchId: null };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AfterSalesController],
      providers: [
        { provide: PrismaService, useValue: {} },
        RolesGuard,
        BranchGuard,
        { provide: AfterSalesService, useValue: {} },
        { provide: AfterSalesDocumentService, useValue: { render } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => render.mockReset());

  it('ใบรับฝาก → 200 application/pdf + ชื่อไฟล์ตามเลขเคส (ACCOUNTANT เปิดได้)', async () => {
    render.mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 test'), caseNumber: 'AS-20260907-0004' });
    const res = await request(app.getHttpServer()).get(`/after-sales/${CASE_ID}/receipt.pdf`).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="after-sales-receipt-AS-20260907-0004.pdf"',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(render).toHaveBeenCalledWith(CASE_ID, 'RECEIPT', actor);
  });

  it('ใบส่งมอบ → kind HANDOVER', async () => {
    render.mockResolvedValue({ pdf: Buffer.from('%PDF-1.4 test'), caseNumber: 'AS-20260907-0004' });
    const res = await request(app.getHttpServer()).get(`/after-sales/${CASE_ID}/handover.pdf`).expect(200);
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="after-sales-handover-AS-20260907-0004.pdf"',
    );
    expect(render).toHaveBeenCalledWith(CASE_ID, 'HANDOVER', actor);
  });

  it('id ไม่ใช่ UUID → 400 ไม่ถึง service', async () => {
    await request(app.getHttpServer()).get('/after-sales/not-a-uuid/receipt.pdf').expect(400);
    expect(render).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: รันให้ล้ม**

Run: `cd apps/api && npx jest src/modules/after-sales/__tests__/document-service.spec.ts src/modules/after-sales/__tests__/document-routes.http.spec.ts --runInBand`
Expected: FAIL — `Cannot find module '../services/after-sales-document.service'`

- [ ] **Step 4: เขียน renderer** — `apps/api/src/modules/after-sales/documents/after-sales-pdf.renderer.ts`

```ts
import { Injectable } from '@nestjs/common';
import type { Browser } from 'puppeteer';
import { embeddedDocumentFonts } from '../../../assets/fonts/document-fonts';

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/**
 * HTML → PDF ของใบรับฝากเครื่อง/ใบส่งมอบ — Chromium ตัวเดียวใช้ร่วมทุกคำขอ (แบบ VoucherPdfRenderer)
 * ต่างจาก renderer อื่นตรงที่ **รอสคริปต์ย่อรูป** (`window.__afterSalesThumbs` จาก
 * after-sales-doc-html.ts) ก่อน page.pdf() — ไม่งั้น PDF ฝังรูปมือถือเต็มไฟล์
 */
@Injectable()
export class AfterSalesPdfRenderer {
  private static shared: Promise<Browser> | null = null;

  private async browser(): Promise<Browser> {
    const current = AfterSalesPdfRenderer.shared
      ? await AfterSalesPdfRenderer.shared.catch(() => null)
      : null;
    if (current?.connected) return current;
    const puppeteer = await import('puppeteer');
    AfterSalesPdfRenderer.shared = puppeteer.default.launch({ headless: true, args: LAUNCH_ARGS });
    return AfterSalesPdfRenderer.shared;
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const fontCss = embeddedDocumentFonts();
    const withFonts = fontCss ? html.replace('</head>', `<style>${fontCss}</style></head>`) : html;
    const page = await (await this.browser()).newPage();
    try {
      await page.setContent(withFonts, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.evaluateHandle('document.fonts.ready');
      await page.evaluate('window.__afterSalesThumbs || null');
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /** ปิด Chromium ที่ใช้ร่วม — สำหรับ smoke test ให้ jest จบได้ */
  static async closeShared(): Promise<void> {
    const current = AfterSalesPdfRenderer.shared
      ? await AfterSalesPdfRenderer.shared.catch(() => null)
      : null;
    AfterSalesPdfRenderer.shared = null;
    await current?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 5: เขียน service** — `apps/api/src/modules/after-sales/services/after-sales-document.service.ts`

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'stream';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AfterSalesQueryService } from './after-sales-query.service';
import { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';
import { buildAfterSalesDocHtml, type DocCompany } from '../documents/after-sales-doc-html';
import {
  composeHandoverDoc,
  composeReceiptDoc,
  handoverBlockReason,
  PHOTO_ANGLES,
  type DocPayer,
  type DocSource,
} from '../documents/after-sales-doc-compose';

type ReqUser = { id: string; role: string; branchId?: string | null };
type CaseDetail = Awaited<ReturnType<AfterSalesQueryService['getCase']>>;
export type AfterSalesDocKind = 'RECEIPT' | 'HANDOVER';

const DOC_NOTE: Record<AfterSalesDocKind, string> = {
  RECEIPT: 'ใบรับฝากเครื่อง',
  HANDOVER: 'ใบส่งมอบ',
};
const PRINT_DEDUPE_MS = 5 * 60 * 1000;
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const CONDITION_TEXT: Record<string, string> = { PHONE_USED: 'มือสอง', PHONE_NEW: 'เครื่องใหม่' };

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const toDate = (v: unknown): Date | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : v instanceof Date ? v : null;

const label = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ');

/**
 * ใบรับฝากเครื่อง / ใบส่งมอบ (PR 4, สเปก 6) — `GET /after-sales/:id/receipt.pdf` | `/handover.pdf`.
 * ขอบเขตสาขา + stage จริงมาจาก `getCase` เสมอ (route มีแต่ :id — security.md) และต้องผ่านก่อนแตะ
 * storage หรือ Chromium · การพิมพ์ลงไทม์ไลน์เป็น `AfterSalesEvent` kind PRINTED (กันซ้ำ 5 นาที)
 */
@Injectable()
export class AfterSalesDocumentService {
  private readonly logger = new Logger(AfterSalesDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly query: AfterSalesQueryService,
    private readonly renderer: AfterSalesPdfRenderer,
  ) {}

  async render(
    caseId: string,
    kind: AfterSalesDocKind,
    user: ReqUser,
  ): Promise<{ pdf: Buffer; caseNumber: string }> {
    const c = await this.query.getCase(caseId, user);
    if (kind === 'HANDOVER') {
      const reason = handoverBlockReason({
        outcome: c.outcome,
        stage: c.stage,
        hasRepairTicket: !!c.repairTicket && !c.repairTicket.deletedAt,
      });
      if (reason) throw new BadRequestException(reason);
    }
    const source = await this.loadSource(c, kind, user);
    const doc = kind === 'RECEIPT' ? composeReceiptDoc(source) : composeHandoverDoc(source);
    const pdf = await this.renderer.htmlToPdf(buildAfterSalesDocHtml(doc));
    await this.recordPrinted(caseId, kind, user.id);
    return { pdf, caseNumber: c.caseNumber };
  }

  private async loadSource(c: CaseDetail, kind: AfterSalesDocKind, user: ReqUser): Promise<DocSource> {
    const ex = c.exchange;
    const [row, printer, company, contract, sale, product, newContract, newProduct] = await Promise.all([
      this.prisma.afterSalesCase.findUniqueOrThrow({ where: { id: c.id }, select: { photoKeys: true } }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
      this.loadCompany(c.branchId),
      c.contractId
        ? this.prisma.contract.findUnique({
            where: { id: c.contractId },
            select: { contractNumber: true, shopWarrantyEndDate: true },
          })
        : null,
      c.saleId
        ? this.prisma.sale.findUnique({ where: { id: c.saleId }, select: { saleNumber: true } })
        : null,
      c.productId
        ? this.prisma.product.findUnique({
            where: { id: c.productId },
            select: { color: true, category: true, warrantyExpireDate: true },
          })
        : null,
      kind === 'HANDOVER' && ex?.replacementContract
        ? this.prisma.contract.findUnique({
            where: { id: ex.replacementContract.id },
            select: { contractNumber: true, shopWarrantyEndDate: true },
          })
        : null,
      kind === 'HANDOVER' && ex?.newProduct
        ? this.prisma.product.findUnique({
            where: { id: ex.newProduct.id },
            select: { color: true, category: true, warrantyExpireDate: true },
          })
        : null,
    ]);
    const photos = kind === 'RECEIPT' ? await this.loadPhotos(row.photoKeys) : [];
    const w = (c.warrantySnapshot ?? {}) as Record<string, unknown>;
    const a = (c.accessories ?? {}) as Record<string, unknown>;
    const t = c.repairTicket && !c.repairTicket.deletedAt ? c.repairTicket : null;
    const shopWarrantyEnd = toDate(w.shopWarrantyEndDate);

    return {
      company,
      caseNumber: c.caseNumber,
      branchName: c.branch.name,
      receivedAt: c.receivedAt,
      receivedByName: c.receivedBy.name,
      printedAt: new Date(),
      printedByName: printer?.name ?? '—',
      customerName: c.customer.name,
      customerPhone: c.customer.phone ?? null,
      lineLinked: c.lineLinked,
      source: c.source,
      contractNumber: contract?.contractNumber ?? null,
      saleNumber: sale?.saleNumber ?? null,
      deviceLabel: label(
        [c.deviceBrand, c.deviceModel].filter(Boolean).join(' ') || 'ไม่ระบุรุ่น',
        product?.color,
        product ? CONDITION_TEXT[product.category] : null,
      ),
      deviceImei: c.deviceImei,
      deviceSerial: c.deviceSerial,
      accessories: {
        box: a.box === true,
        charger: a.charger === true,
        case: a.case === true,
        other: typeof a.other === 'string' && a.other.trim() ? a.other.trim() : null,
      },
      unlockConfirmed: c.unlockConfirmed,
      symptom: c.symptom,
      photoCount: row.photoKeys.length,
      photos,
      warranty: {
        purchasedAt: toDate(w.purchasedAt),
        shopWarrantyEnd,
        manufacturerWarrantyEnd: toDate(w.manufacturerWarrantyEndDate),
        within7Days:
          w.within7Days === true ||
          (typeof w.daysRemainingIn7Day === 'number' && w.daysRemainingIn7Day > 0),
      },
      outcome: c.outcome,
      stage: c.stage,
      closedAt: c.closedAt,
      repair: t
        ? {
            payer: t.payer as DocPayer,
            estimatedCost: t.estimatedCost ? t.estimatedCost.toString() : null,
            actualCost: t.actualCost ? t.actualCost.toString() : null,
            supplierName: t.repairSupplier?.name ?? null,
            externalClaimNo: t.externalClaimNo,
            sentToRepairAt: t.sentToRepairAt,
            repairedAt: t.repairedAt,
            returnedToCustomerAt: t.returnedToCustomerAt,
          }
        : null,
      exchange: ex
        ? {
            oldDeviceLabel: ex.oldProduct
              ? [ex.oldProduct.brand, ex.oldProduct.model, ex.oldProduct.storage].filter(Boolean).join(' ')
              : [c.deviceBrand, c.deviceModel].filter(Boolean).join(' ') || 'ไม่ระบุรุ่น',
            oldImei: ex.oldProduct?.imeiSerial ?? c.deviceImei,
            newDeviceLabel: ex.newProduct
              ? label(
                  [ex.newProduct.brand, ex.newProduct.model, ex.newProduct.storage].filter(Boolean).join(' '),
                  newProduct?.color,
                )
              : null,
            newImei: ex.newProduct?.imeiSerial ?? null,
            replacementContractNumber:
              newContract?.contractNumber ?? ex.replacementContract?.contractNumber ?? null,
            newShopWarrantyEnd:
              newContract?.shopWarrantyEndDate ?? contract?.shopWarrantyEndDate ?? shopWarrantyEnd,
            newManufacturerWarrantyEnd: newProduct?.warrantyExpireDate ?? null,
          }
        : null,
    };
  }

  private async loadCompany(branchId: string): Promise<DocCompany> {
    const select = { nameTh: true, address: true, taxId: true, phone: true } as const;
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { company: { select } },
    });
    const company =
      branch?.company ??
      (await this.prisma.companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null }, select }));
    return company ?? { nameTh: 'BESTCHOICE', address: '', taxId: '', phone: null };
  }

  /** อ่านทีละรูป (หน่วยความจำไม่พุ่ง) · อ่านไม่ได้ = null → ช่อง "เปิดรูปไม่ได้" ไม่ทำให้ PDF ล้ม */
  private async loadPhotos(keys: string[]): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (const key of keys.slice(0, PHOTO_ANGLES.length)) {
      const mime = MIME_BY_EXT[key.split('.').pop()?.toLowerCase() ?? ''];
      if (!mime) {
        out.push(null);
        continue;
      }
      try {
        const buf = await readAll(await this.storage.getStream(key));
        out.push(`data:${mime};base64,${buf.toString('base64')}`);
      } catch (err) {
        this.logger.warn(`after-sales photo unreadable for PDF: ${key} (${(err as Error).message})`);
        out.push(null);
      }
    }
    return out;
  }

  private async recordPrinted(caseId: string, kind: AfterSalesDocKind, actorId: string) {
    const note = DOC_NOTE[kind];
    try {
      const recent = await this.prisma.afterSalesEvent.findFirst({
        where: {
          caseId,
          kind: 'PRINTED',
          note,
          actorId,
          createdAt: { gte: new Date(Date.now() - PRINT_DEDUPE_MS) },
        },
        select: { id: true },
      });
      if (recent) return;
      await this.prisma.afterSalesEvent.create({ data: { caseId, kind: 'PRINTED', note, actorId } });
    } catch (err) {
      this.logger.warn(`after-sales PRINTED event not recorded for ${caseId}: ${(err as Error).message}`);
    }
  }
}
```

ถ้า `tsc` บ่นว่า `c.source` / `c.outcome` / `c.stage` / `c.lineLinked` ไม่ตรงชนิด `DocSource` ให้ตรวจชนิดที่ `getCase` คืน (Prisma enum เป็น string union เดียวกัน) — ห้าม cast เป็น `any`; ถ้าต้อง narrow ให้ใช้ `as DocSource['source']` ตรงจุดนั้นจุดเดียว

- [ ] **Step 6: ต่อ controller** — `apps/api/src/modules/after-sales/after-sales.controller.ts`

เพิ่ม import ใต้ `import { AfterSalesService } from './after-sales.service';`

```ts
import { AfterSalesDocumentService } from './services/after-sales-document.service';
```

เพิ่มใต้ `const sendImage = …;` (ก่อน `@Controller`)

```ts
const sendPdf = (res: Response, pdf: Buffer, filename: string) => {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Content-Length': pdf.length.toString(),
    'Cache-Control': 'private, no-store',
  });
  res.send(pdf);
};
```

เปลี่ยน constructor เป็น

```ts
  constructor(
    private readonly svc: AfterSalesService,
    private readonly docs: AfterSalesDocumentService,
  ) {}
```

เพิ่ม 2 route ต่อจาก `purchasePhoto(...)` (ก่อน `@Post(':id/photos')`)

```ts
  // PR 4 — ใบรับฝากเครื่อง / ใบส่งมอบ (สเปก 6: ทั้ง 5 role) · ขอบเขตสาขาอยู่ใน service
  @Get(':id/receipt.pdf')
  @Roles(...ALL)
  async receiptPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.render(id, 'RECEIPT', user);
    sendPdf(res, pdf, `after-sales-receipt-${caseNumber}.pdf`);
  }

  @Get(':id/handover.pdf')
  @Roles(...ALL)
  async handoverPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { pdf, caseNumber } = await this.docs.render(id, 'HANDOVER', user);
    sendPdf(res, pdf, `after-sales-handover-${caseNumber}.pdf`);
  }
```

- [ ] **Step 7: ลงทะเบียนใน module** — `apps/api/src/modules/after-sales/after-sales.module.ts`

เพิ่ม import

```ts
import { AfterSalesDocumentService } from './services/after-sales-document.service';
import { AfterSalesPdfRenderer } from './documents/after-sales-pdf.renderer';
```

และเพิ่ม `AfterSalesDocumentService, AfterSalesPdfRenderer,` ท้าย `providers` (ต่อจาก `AfterSalesLineCron,`)

- [ ] **Step 8: ให้ HTTP spec เดิมรู้จัก dependency ใหม่** — `apps/api/src/modules/after-sales/__tests__/intake-photos-upload.http.spec.ts`

เพิ่ม import `import { AfterSalesDocumentService } from '../services/after-sales-document.service';` และเพิ่มใน `providers` ต่อจาก `{ provide: AfterSalesService, useValue: { createCase } },`

```ts
        { provide: AfterSalesDocumentService, useValue: {} },
```

- [ ] **Step 9: รันเทสต์ Task 3 + ชุด after-sales ทั้งหมด**

Run: `cd apps/api && npx jest src/modules/after-sales --runInBand`
Expected: PASS ทั้งหมด (ของเดิม + document-service 9 + document-routes 3)

- [ ] **Step 10: smoke test หน้าเดียวบน Chromium จริง** — `apps/api/src/modules/after-sales/__tests__/doc-render.smoke.spec.ts` (CI ข้ามเอง — รันเมื่อตั้ง `AFTER_SALES_PDF_SMOKE=1`)

```ts
import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildAfterSalesDocHtml } from '../documents/after-sales-doc-html';
import { composeHandoverDoc, composeReceiptDoc, type DocSource } from '../documents/after-sales-doc-compose';
import { AfterSalesPdfRenderer } from '../documents/after-sales-pdf.renderer';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** กรณีเนื้อหายาวสุดที่ระบบยอมให้เกิด: อาการ/อื่น ๆ ถูกตัดแล้ว, รูปครบ 6, ชื่อยาว */
const worst: DocSource = {
  company: {
    nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
    address: 'เลขที่ 456/21 ชั้น 2 ถนนนารายณ์มหาราช ตำบลทะเลชุบศร อำเภอเมืองลพบุรี จังหวัดลพบุรี 15000',
    taxId: '0165568000050',
    phone: '063-134-6356',
  },
  caseNumber: 'AS-20260907-0004',
  branchName: 'สาขาลพบุรี (ถนนนารายณ์มหาราช)',
  receivedAt: new Date('2026-09-07T03:12:00.000Z'),
  receivedByName: 'สุดารัตน์ ทดสอบระบบ',
  printedAt: new Date('2026-09-07T03:14:00.000Z'),
  printedByName: 'สุดารัตน์ ทดสอบระบบ',
  customerName: 'นางสาวสมหญิงประเสริฐศักดิ์ ใจดีมีทรัพย์สมบูรณ์',
  customerPhone: '0812344412',
  lineLinked: true,
  source: 'INSTALLMENT_CONTRACT',
  contractNumber: 'CT-2026-0912',
  saleNumber: null,
  deviceLabel: 'Apple iPhone 16 Pro Max 1TB · Desert Titanium · มือสอง',
  deviceImei: '356812345674412',
  deviceSerial: 'F2LXK3P09Q',
  accessories: { box: true, charger: true, case: true, other: 'ข'.repeat(200) },
  unlockConfirmed: true,
  symptom: 'เปิดไม่ติด ชาร์จไม่เข้า '.repeat(40),
  photoCount: 6,
  photos: [PNG, PNG, PNG, PNG, PNG, PNG],
  warranty: {
    purchasedAt: new Date('2026-08-19T05:00:00.000Z'),
    shopWarrantyEnd: new Date('2026-11-17T00:00:00.000Z'),
    manufacturerWarrantyEnd: new Date('2027-09-17T00:00:00.000Z'),
    within7Days: false,
  },
  outcome: 'REPAIR',
  stage: 'READY_FOR_PICKUP',
  closedAt: null,
  repair: {
    payer: 'CUSTOMER',
    estimatedCost: '12500.00',
    actualCost: '12500.00',
    supplierName: 'ศูนย์บริการ iCare ลพบุรี (ผู้ให้บริการที่ได้รับอนุญาต)',
    externalClaimNo: 'IC-77821-2026-09',
    sentToRepairAt: new Date('2026-09-08T07:00:00.000Z'),
    repairedAt: new Date('2026-09-25T04:00:00.000Z'),
    returnedToCustomerAt: null,
  },
  exchange: {
    oldDeviceLabel: 'Apple iPhone 16 Pro Max 1TB',
    oldImei: '356812345674412',
    newDeviceLabel: 'Apple iPhone 16 Pro Max 1TB · Desert Titanium',
    newImei: '356812345679999',
    replacementContractNumber: 'CT-2026-0951',
    newShopWarrantyEnd: new Date('2026-12-16T00:00:00.000Z'),
    newManufacturerWarrantyEnd: new Date('2027-09-16T00:00:00.000Z'),
  },
};

const run = process.env.AFTER_SALES_PDF_SMOKE === '1' ? it : it.skip;

describe('after-sales PDF — A4 หน้าเดียวบน Chromium จริง (AFTER_SALES_PDF_SMOKE=1)', () => {
  jest.setTimeout(120_000);
  afterAll(() => AfterSalesPdfRenderer.closeShared());

  const cases: [string, () => ReturnType<typeof composeReceiptDoc>][] = [
    ['receipt', () => composeReceiptDoc(worst)],
    ['handover-repair', () => composeHandoverDoc(worst)],
    ['handover-priced', () => composeHandoverDoc({ ...worst, outcome: 'PRICED_EXCHANGE', repair: null, stage: 'CLOSED' })],
  ];

  for (const [name, make] of cases) {
    run(`${name} = 1 หน้า`, async () => {
      const pdf = await new AfterSalesPdfRenderer().htmlToPdf(buildAfterSalesDocHtml(make()));
      if (process.env.AFTER_SALES_PDF_OUT) writeFileSync(join(process.env.AFTER_SALES_PDF_OUT, `${name}.pdf`), pdf);
      const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? [];
      expect(pages).toHaveLength(1);
      expect(pdf.length).toBeLessThan(1_500_000);
    });
  }
});
```

Run (เครื่อง dev — ครั้งแรกอาจต้อง `cd apps/api && npx puppeteer browsers install chrome`):
`cd apps/api && mkdir -p /tmp/as-pdf && AFTER_SALES_PDF_SMOKE=1 AFTER_SALES_PDF_OUT=/tmp/as-pdf npx jest src/modules/after-sales/__tests__/doc-render.smoke.spec.ts --runInBand`
Expected: PASS 3 เคส · เปิด 3 ไฟล์ใน `/tmp/as-pdf` ดูด้วยตาว่าหน้าตาตรงกระดาน 8–10 (หัวเขียว, ลายเซ็นอยู่หน้าเดียวกับเนื้อหา, รูป 6 ช่อง)

ถ้าเคสใดได้ 2 หน้า ให้ปรับ `AS_CSS` ใน Task 1 **ตามลำดับนี้ทีละข้อ** แล้วรันใหม่จนผ่าน: (1) `.as-photo { height: 18mm }` → `15mm` (2) `.as-block { margin-top: 2.5mm }` → `1.5mm` (3) `.as-list li` `14pt` → `13pt` — ห้ามลดขนาดตัวอักษรเนื้อหาหลัก 16pt และห้ามลดจำนวนเงื่อนไข · และแก้ `doc-html.spec.ts` ถ้ามีการ assert ค่าเหล่านั้น (ปัจจุบันไม่มี)

Run (ยืนยันว่า CI ข้าม): `cd apps/api && npx jest src/modules/after-sales/__tests__/doc-render.smoke.spec.ts --runInBand`
Expected: `3 skipped`

- [ ] **Step 11: tsc + format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/api && npx tsc --noEmit -p tsconfig.json; echo "api-tsc-exit=$?"
```
Expected: `api-tsc-exit=0` (ถ้าแดงที่ `JourneyEntryKind` / `packages/shared/dist` ค้าง ให้ `npm run build --workspace=packages/shared` ที่ root ก่อนแล้วรันใหม่)

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/api/src/modules/after-sales/documents/after-sales-pdf.renderer.ts apps/api/src/modules/after-sales/services/after-sales-document.service.ts apps/api/src/modules/after-sales/after-sales.controller.ts apps/api/src/modules/after-sales/after-sales.module.ts apps/api/src/modules/after-sales/__tests__/document-service.spec.ts apps/api/src/modules/after-sales/__tests__/document-routes.http.spec.ts apps/api/src/modules/after-sales/__tests__/doc-render.smoke.spec.ts apps/api/src/modules/after-sales/__tests__/intake-photos-upload.http.spec.ts
git add apps/api/src/modules/after-sales/documents/after-sales-pdf.renderer.ts apps/api/src/modules/after-sales/services/after-sales-document.service.ts apps/api/src/modules/after-sales/after-sales.controller.ts apps/api/src/modules/after-sales/after-sales.module.ts apps/api/src/modules/after-sales/__tests__/document-service.spec.ts apps/api/src/modules/after-sales/__tests__/document-routes.http.spec.ts apps/api/src/modules/after-sales/__tests__/doc-render.smoke.spec.ts apps/api/src/modules/after-sales/__tests__/intake-photos-upload.http.spec.ts
git commit -m "feat(after-sales): GET /after-sales/:id/receipt.pdf + handover.pdf · ลงไทม์ไลน์ PRINTED

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ปุ่มพิมพ์บนหน้าเคส + ตัวอย่าง PDF + ป้ายไทม์ไลน์

**Files:**
- Modify: `apps/web/src/pages/after-sales/after-sales.ts` (ท้ายไฟล์)
- Modify: `apps/web/src/pages/AfterSalesCasePage.tsx`
- Modify: `apps/web/src/pages/after-sales/CaseTimeline.tsx:18-36` (`KIND_LABEL`)
- Test: `apps/web/src/pages/after-sales/after-sales.test.ts`, `apps/web/src/pages/AfterSalesCasePage.test.tsx`, `apps/web/src/pages/after-sales/CaseTimeline.test.tsx`

**Interfaces:**
- Consumes: route Task 3 (`/after-sales/:id/receipt.pdf`, `/after-sales/:id/handover.pdf`) · `PdfPreview` (`@/components/PdfPreview`, props `{ title, filename, onClose, path }`) · `afterSalesKeys.case(id)`
- Produces: `type CaseDocKind = 'receipt' | 'handover'` · `CASE_DOC_LABEL: Record<CaseDocKind, string>` · `canPrintHandover(data: Pick<CaseDetail, 'outcome' | 'stage' | 'repairTicket'>): boolean` · หน้าเคสรับ `?print=receipt` (Task 5 ใช้)

- [ ] **Step 1: เทสต์ predicate ที่ล้มก่อน** — เพิ่มท้าย `apps/web/src/pages/after-sales/after-sales.test.ts` (เพิ่ม `canPrintHandover` ใน import จาก `./after-sales` ที่มีอยู่แล้วด้านบนของไฟล์)

```ts
describe('canPrintHandover — mirror ของ handoverBlockReason ฝั่ง API', () => {
  const rt = { id: 'rt-1' } as unknown as NonNullable<CaseDetail['repairTicket']>;
  it('(a) พิมพ์ได้เฉพาะ READY_FOR_PICKUP / CLOSED ที่มีทางออก', () => {
    expect(canPrintHandover({ outcome: 'REPAIR', stage: 'READY_FOR_PICKUP', repairTicket: rt })).toBe(true);
    expect(canPrintHandover({ outcome: 'SAME_MODEL_EXCHANGE', stage: 'CLOSED', repairTicket: null })).toBe(true);
    for (const stage of ['RECEIVED', 'IN_REPAIR', 'AWAITING_APPROVAL', 'CANCELLED'] as const)
      expect(canPrintHandover({ outcome: 'REPAIR', stage, repairTicket: rt })).toBe(false);
    expect(canPrintHandover({ outcome: null, stage: 'CLOSED', repairTicket: null })).toBe(false);
  });
  it('(b) ซ่อมที่ไม่มีใบซ่อม → ไม่ได้', () => {
    expect(canPrintHandover({ outcome: 'REPAIR', stage: 'CLOSED', repairTicket: null })).toBe(false);
  });
});
```

(ถ้าไฟล์ยังไม่ import `CaseDetail` ให้เพิ่ม `type CaseDetail` ใน import เดียวกัน)

- [ ] **Step 2: เทสต์หน้าเคสที่ล้มก่อน** — `apps/web/src/pages/AfterSalesCasePage.test.tsx`

เพิ่ม mock ใต้ `vi.mock('@/pages/insurance/components/RepairCenterCombobox', …)`:

```tsx
vi.mock('@/components/PdfPreview', () => ({
  default: ({
    title,
    path,
    filename,
    onClose,
  }: {
    title: string;
    path: string;
    filename: string;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={title}>
      <span data-testid="pdf-path">{path}</span>
      <span data-testid="pdf-filename">{filename}</span>
      <button type="button" onClick={onClose}>
        ปิดตัวอย่าง
      </button>
    </div>
  ),
}));
```

เพิ่ม describe ท้ายไฟล์:

```tsx
describe('AfterSalesCasePage — พิมพ์ใบรับฝากเครื่อง / ใบส่งมอบ (PR 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 'u1', role: 'SALES', branchId: 'branch-1' };
  });

  it('เคสกำลังซ่อม: มีปุ่มพิมพ์ใบรับฝาก ไม่มีปุ่มใบส่งมอบ · กดแล้วเปิดตัวอย่าง path ถูก', async () => {
    mockGet(caseDetail());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'พิมพ์ใบรับฝากเครื่อง' }));
    expect(screen.queryByRole('button', { name: 'พิมพ์ใบส่งมอบ' })).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'ใบรับฝากเครื่อง' });
    expect(within(dialog).getByTestId('pdf-path')).toHaveTextContent('/after-sales/case-1/receipt.pdf');
    expect(within(dialog).getByTestId('pdf-filename')).toHaveTextContent(
      'AS-20260908-0001-ใบรับฝากเครื่อง.pdf',
    );
  });

  it('เคสรอลูกค้ารับ: ปุ่มพิมพ์ใบส่งมอบเปิด handover.pdf', async () => {
    mockGet(caseDetail({ stage: 'READY_FOR_PICKUP' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'พิมพ์ใบส่งมอบ' }));
    expect(screen.getByTestId('pdf-path')).toHaveTextContent('/after-sales/case-1/handover.pdf');
  });

  it('?print=receipt เปิดตัวอย่างใบรับฝากเองตอนโหลด', async () => {
    mockGet(caseDetail());
    renderPage('case-1', '?print=receipt');
    expect(await screen.findByRole('dialog', { name: 'ใบรับฝากเครื่อง' })).toBeInTheDocument();
  });

  it('ปิดตัวอย่าง → โหลดเคสใหม่ (ไทม์ไลน์เห็น "พิมพ์เอกสาร")', async () => {
    mockGet(caseDetail());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'พิมพ์ใบรับฝากเครื่อง' }));
    const detailCalls = () => mocks.get.mock.calls.filter(([url]) => url === '/after-sales/case-1').length;
    const before = detailCalls();
    await userEvent.click(screen.getByRole('button', { name: 'ปิดตัวอย่าง' }));
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog', { name: 'ใบรับฝากเครื่อง' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: เทสต์ป้ายไทม์ไลน์ที่ล้มก่อน** — เพิ่ม `it` ใน describe เดิมของ `apps/web/src/pages/after-sales/CaseTimeline.test.tsx`

```tsx
  it('PRINTED → ป้าย "พิมพ์เอกสาร" + ชื่อเอกสาร', () => {
    const timeline: TimelineItem[] = [
      { at: '2026-09-07T03:14:00.000Z', kind: 'PRINTED', note: 'ใบรับฝากเครื่อง', actorName: 'สุดา' },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.getByText('พิมพ์เอกสาร')).toBeInTheDocument();
    expect(screen.getByText('ใบรับฝากเครื่อง')).toBeInTheDocument();
  });
```

- [ ] **Step 4: รันให้ล้ม**

Run: `cd apps/web && npx vitest run src/pages/after-sales/after-sales.test.ts src/pages/AfterSalesCasePage.test.tsx src/pages/after-sales/CaseTimeline.test.tsx`
Expected: FAIL — `canPrintHandover is not a function` / ไม่พบปุ่ม "พิมพ์ใบรับฝากเครื่อง" / ไม่พบ "พิมพ์เอกสาร"

- [ ] **Step 5: predicate + label** — ต่อท้าย `apps/web/src/pages/after-sales/after-sales.ts`

```ts
/** PR 4 — เอกสารพิมพ์ของเคส (ตรงกับ API `GET /after-sales/:id/receipt.pdf` | `/handover.pdf`) */
export type CaseDocKind = 'receipt' | 'handover';

export const CASE_DOC_LABEL: Record<CaseDocKind, string> = {
  receipt: 'ใบรับฝากเครื่อง',
  handover: 'ใบส่งมอบ',
};

/** mirror ของ `handoverBlockReason` ฝั่ง API (after-sales-doc-compose.ts) — ปุ่มโชว์เฉพาะตอนพิมพ์ได้จริง */
export function canPrintHandover(
  data: Pick<CaseDetail, 'outcome' | 'stage' | 'repairTicket'>,
): boolean {
  if (!data.outcome) return false;
  if (data.stage !== 'READY_FOR_PICKUP' && data.stage !== 'CLOSED') return false;
  return data.outcome !== 'REPAIR' || !!data.repairTicket;
}
```

`apps/web/src/pages/after-sales/CaseTimeline.tsx` — เพิ่มใน `KIND_LABEL` ต่อจาก `LINE_SKIPPED_NO_LINK: 'ไม่ได้ส่ง LINE (ไม่ผูก)',`

```ts
  PRINTED: 'พิมพ์เอกสาร',
```

- [ ] **Step 6: หน้าเคส** — `apps/web/src/pages/AfterSalesCasePage.tsx`

(6.1) import: เปลี่ยน `import { Clock } from 'lucide-react';` เป็น `import { Clock, Printer } from 'lucide-react';` · เพิ่ม `import PdfPreview from '@/components/PdfPreview';` ใต้ `import QueryBoundary from '@/components/QueryBoundary';` · ใน import ก้อน `from './after-sales/after-sales'` เพิ่ม `CASE_DOC_LABEL,` `canPrintHandover,` และ `type CaseDocKind,`

(6.2) state — ใต้บรรทัด `const [searchParams, setSearchParams] = useSearchParams();`

```tsx
  const [docPreview, setDocPreview] = useState<CaseDocKind | null>(null);
```

(6.3) effect ใหม่ — ต่อจาก effect `?action=` (ที่ปิดด้วย `}, [data, user, searchParams, setSearchParams]);`)

```tsx
  // PR 4 — มาจากหน้าแจ้งปัญหาเครื่องปุ่ม "บันทึก + พิมพ์ใบรับฝาก" → เปิดตัวอย่างใบรับฝากทันที
  // แล้วลบพารามิเตอร์ทิ้ง (กันเปิดซ้ำตอน refetch) — แบบเดียวกับ ?action=
  useEffect(() => {
    if (!data) return;
    const wanted = searchParams.get('print');
    if (!wanted) return;
    if (wanted === 'receipt') setDocPreview('receipt');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('print');
        return next;
      },
      { replace: true },
    );
  }, [data, searchParams, setSearchParams]);
```

(6.4) ปุ่ม — แทนที่บล็อกนี้ทั้งก้อน

```tsx
                        <Button variant="outline" size="md" disabled title="เร็ว ๆ นี้">
                          ใบรับฝากเครื่อง
                        </Button>
```

ด้วย

```tsx
                        <Button variant="outline" size="md" onClick={() => setDocPreview('receipt')}>
                          <Printer aria-hidden className="h-4 w-4" />
                          พิมพ์ใบรับฝากเครื่อง
                        </Button>
                        {canPrintHandover(data) && (
                          <Button
                            variant="outline"
                            size="md"
                            onClick={() => setDocPreview('handover')}
                          >
                            <Printer aria-hidden className="h-4 w-4" />
                            พิมพ์ใบส่งมอบ
                          </Button>
                        )}
```

(6.5) ตัวอย่าง PDF — วางต่อจาก `<CancelSwapDialog … />` (ก่อน `</>` ที่ปิดก้อน dialog)

```tsx
            {docPreview && (
              <PdfPreview
                key={docPreview}
                title={CASE_DOC_LABEL[docPreview]}
                path={`/after-sales/${data.id}/${docPreview}.pdf`}
                filename={`${data.caseNumber}-${CASE_DOC_LABEL[docPreview]}.pdf`}
                onClose={() => {
                  setDocPreview(null);
                  void queryClient.invalidateQueries({ queryKey: afterSalesKeys.case(data.id) });
                }}
              />
            )}
```

- [ ] **Step 7: รันให้ผ่าน + ชุดหน้าหลังการขาย**

Run: `cd apps/web && npx vitest run src/pages/after-sales src/pages/AfterSalesCasePage.test.tsx src/pages/AfterSalesPage.test.tsx src/pages/AfterSalesNewPage.test.tsx`
Expected: PASS ทั้งหมด

- [ ] **Step 8: tsc + format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && npx tsc --noEmit; echo "web-tsc-exit=$?"
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/web/src/pages/after-sales/after-sales.ts apps/web/src/pages/after-sales/after-sales.test.ts apps/web/src/pages/AfterSalesCasePage.tsx apps/web/src/pages/AfterSalesCasePage.test.tsx apps/web/src/pages/after-sales/CaseTimeline.tsx apps/web/src/pages/after-sales/CaseTimeline.test.tsx
git add apps/web/src/pages/after-sales/after-sales.ts apps/web/src/pages/after-sales/after-sales.test.ts apps/web/src/pages/AfterSalesCasePage.tsx apps/web/src/pages/AfterSalesCasePage.test.tsx apps/web/src/pages/after-sales/CaseTimeline.tsx apps/web/src/pages/after-sales/CaseTimeline.test.tsx
git commit -m "feat(web): ปุ่มพิมพ์ใบรับฝากเครื่อง/ใบส่งมอบบนหน้าเคส + ตัวอย่าง PDF + ป้ายไทม์ไลน์

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Expected tsc: `web-tsc-exit=0`

---

### Task 5: ปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก" บนหน้าแจ้งปัญหาเครื่อง

**Files:**
- Modify: `apps/web/src/pages/AfterSalesNewPage.tsx` (mutation `create` บรรทัด ~136, `handleSubmit` บรรทัด ~228 และ `create.mutate(form)` บรรทัด ~302, แถบปุ่มล่างบรรทัด ~692)
- Test: `apps/web/src/pages/AfterSalesNewPage.test.tsx`

**Interfaces:**
- Consumes: หน้าเคสรับ `?print=receipt` (Task 4)
- Produces: —

- [ ] **Step 1: เทสต์ที่ล้มก่อน** — `apps/web/src/pages/AfterSalesNewPage.test.tsx`

(1.1) ใน `renderPage` เปลี่ยน route หน้าเคสให้เห็น query string โดยข้อความเดิมยังอยู่: แทน `<Route path="/after-sales/:id" element={<div>CASE PAGE</div>} />` ด้วย `<Route path="/after-sales/:id" element={<CaseProbe />} />` และเพิ่มก่อน `function renderPage`

```tsx
function CaseProbe() {
  const location = useLocation();
  return (
    <>
      <div>CASE PAGE</div>
      <div data-testid="case-search">{location.search}</div>
    </>
  );
}
```

(เพิ่ม `useLocation` ใน import จาก `'react-router'` ของไฟล์)

(1.2) เพิ่ม `it` ใน describe หลัก (ต่อจากเทสต์ "ใส่อาการ ≥5 ตัว + แนบรูป 1 …")

```tsx
  it('ปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก" → POST เดียวกัน แล้วไปหน้าเคสพร้อม ?print=receipt · ปุ่มหลักไปแบบไม่มีพารามิเตอร์', async () => {
    mockGet(foundResult);
    mocks.post.mockResolvedValue({
      data: { id: 'case-9', caseNumber: 'AS-20260924-0001', repairTicketId: 'rt-1' },
    });
    renderPage(`/after-sales/new?imei=${IMEI}`);
    await screen.findByText('คุณสมชาย ทดสอบ');
    await userEvent.type(screen.getByLabelText(/อาการที่ลูกค้าแจ้ง/), 'จอแตกมุมขวาบน');
    await userEvent.upload(
      screen.getByLabelText(/ถ่ายเพิ่ม/),
      new File(['x'], 'a.jpg', { type: 'image/jpeg' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /ปิด Find My/ }));

    await userEvent.click(screen.getByRole('button', { name: 'บันทึก + พิมพ์ใบรับฝาก' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(mocks.post.mock.calls[0][0]).toBe('/after-sales');
    expect(await screen.findByTestId('case-search')).toHaveTextContent('?print=receipt');
  });
```

(1.3) ในเทสต์เดิม "ใส่อาการ ≥5 ตัว + แนบรูป 1 …" เพิ่มท้ายสุด:

```tsx
    expect(screen.getByTestId('case-search')).toBeEmptyDOMElement();
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd apps/web && npx vitest run src/pages/AfterSalesNewPage.test.tsx`
Expected: FAIL — ไม่พบปุ่ม "บันทึก + พิมพ์ใบรับฝาก"

- [ ] **Step 3: แก้หน้า** — `apps/web/src/pages/AfterSalesNewPage.tsx`

(3.1) mutation — แทนที่ทั้งก้อน `const create = useMutation({ … });` ด้วย

```tsx
  const create = useMutation({
    mutationFn: async ({ form }: { form: FormData; printAfter: boolean }) =>
      (await api.post('/after-sales', form, { headers: { 'Content-Type': 'multipart/form-data' } }))
        .data as { id: string; caseNumber: string; repairTicketId: string },
    onSuccess: (data, vars) => {
      toast.success(`เปิดเคส ${data.caseNumber}`);
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      navigate(vars.printAfter ? `/after-sales/${data.id}?print=receipt` : `/after-sales/${data.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
```

(3.2) `const handleSubmit = () => {` → `const handleSubmit = (printAfter: boolean) => {` และ `create.mutate(form);` → `create.mutate({ form, printAfter });`

(3.3) แถบปุ่มล่าง — แทนที่

```tsx
                <div className="flex gap-2.5">
                  <Button variant="outline" size="lg" onClick={() => navigate('/after-sales')}>
                    ยกเลิก
                  </Button>
                  <Button variant="primary" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
                    {create.isPending ? 'กำลังบันทึก…' : 'บันทึกและเปิดเคส'}
                  </Button>
                </div>
```

ด้วย

```tsx
                <div className="flex flex-wrap justify-end gap-2.5">
                  <Button variant="outline" size="lg" onClick={() => navigate('/after-sales')}>
                    ยกเลิก
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={!canSubmit}
                    onClick={() => handleSubmit(true)}
                  >
                    บันทึก + พิมพ์ใบรับฝาก
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!canSubmit}
                    onClick={() => handleSubmit(false)}
                  >
                    {create.isPending ? 'กำลังบันทึก…' : 'บันทึกและเปิดเคส'}
                  </Button>
                </div>
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/AfterSalesNewPage.test.tsx`
Expected: PASS ทั้งหมด (รวมเทสต์เดิมที่คลิก "บันทึกและเปิดเคส" และตรวจว่าปุ่มถูกปิดเมื่อมีเคสเปิดอยู่)

- [ ] **Step 5: tsc + format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && npx tsc --noEmit; echo "web-tsc-exit=$?"
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/web/src/pages/AfterSalesNewPage.tsx apps/web/src/pages/AfterSalesNewPage.test.tsx
git add apps/web/src/pages/AfterSalesNewPage.tsx apps/web/src/pages/AfterSalesNewPage.test.tsx
git commit -m "feat(web): ปุ่มรอง 'บันทึก + พิมพ์ใบรับฝาก' บนหน้าแจ้งปัญหาเครื่อง

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ถอดหน้าใบซ่อมเดิม `/insurance/:id` + แก้ปุ่มตายในอินบ็อกซ์

ข้อเท็จจริงที่ตรวจแล้ว (prod อ่านอย่างเดียว 2026-09-26): ใบซ่อมที่ยังไม่ถูกลบ 3 ใบ **มีเคสหลังการขายครบทุกใบ** (ใบล่าสุดสร้าง 2026-08-26 ก่อนมีหน้าหลังการขาย) และรุ่น deploy หลัง PR 2 ผ่านไปแล้ว 26.9.54 + 26.9.55 (สเปกข้อ 11 "≥2 รุ่น") ⇒ fallback ไปหน้าใบซ่อมเดิมไม่มีใครใช้แล้ว · ปุ่ม "เปิดใบซ่อม / เคลม" ในการ์ดประกันของอินบ็อกซ์ชี้ `/repair-tickets?new=1&imei=` ซึ่ง **ไม่มี route** (ตกหน้า 404 อยู่ตอนนี้)

**Files:**
- Move: `apps/web/src/pages/insurance/components/RepairCenterCombobox.tsx` → `apps/web/src/pages/after-sales/RepairCenterCombobox.tsx`
- Modify (import path): `apps/web/src/pages/AfterSalesNewPage.tsx:13`, `apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx:15`, `apps/web/src/pages/after-sales/RepairActionDialogs.tsx:14`, `apps/web/src/pages/AfterSalesCasePage.test.tsx:25`
- Delete: ทั้งโฟลเดอร์ `apps/web/src/pages/insurance/` (หลังย้ายไฟล์ข้างบนออกแล้ว)
- Modify: `apps/web/src/App.tsx` (import บรรทัด 82 + route `/insurance/:id` + คอมเมนต์ที่อ้าง fallback)
- Modify: `apps/web/src/pages/after-sales/TicketRedirect.tsx` + `TicketRedirect.test.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.tsx:279`
- Create: `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.test.tsx`

**Interfaces:**
- Produces: `TicketRedirect` ไม่มี prop แล้ว (`export default function TicketRedirect()`)

- [ ] **Step 1: เทสต์ที่ล้มก่อน**

(1.1) `apps/web/src/pages/after-sales/TicketRedirect.test.tsx` — ใน `renderAt` เปลี่ยน `element={<TicketRedirect fallback={<div>หน้าใบซ่อมเดิม</div>} />}` เป็น `element={<TicketRedirect />}` และเพิ่ม route `<Route path="/after-sales" element={<div>หน้าหลังการขาย</div>} />` · แทนเทสต์ "404 (ใบซ่อมเก่าที่ยังไม่มีเคสหลังการขาย) → แสดงหน้าใบซ่อมเดิม (fallback)" ด้วย

```tsx
  it('404 (ไม่มีเคสผูกใบซ่อมนี้) → ข้อความ "ไม่พบเคส" + ลิงก์ไปหน้าหลังการขาย (หน้าใบซ่อมเดิมถูกถอดแล้ว)', async () => {
    mocks.get.mockRejectedValue({ response: { status: 404 } });
    renderAt('rt-2');

    expect(await screen.findByText('ไม่พบเคสหลังการขายของใบซ่อมนี้')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'ไปหน้าหลังการขาย' }));
    expect(await screen.findByText('หน้าหลังการขาย')).toBeInTheDocument();
  });
```

(เพิ่ม `import userEvent from '@testing-library/user-event';` · ในเทสต์ 500 / เครือข่ายล่ม เปลี่ยน `screen.queryByText('หน้าใบซ่อมเดิม')` เป็น `screen.queryByText('ไม่พบเคสหลังการขายของใบซ่อมนี้')`)

(1.2) สร้าง `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.test.tsx`

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { DeviceWarrantyCard, type SummaryContract } from './DossierCards';

function Probe() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

const contract: SummaryContract = {
  id: 'ct-1',
  contractNumber: 'CT-2026-0912',
  status: 'ACTIVE',
  product: { brand: 'Apple', model: 'iPhone 13', serialNumber: null, warrantyExpireDate: null },
  serialNumber: '356812345674412',
  paidInstallments: 1,
  totalInstallments: 12,
  monthlyPayment: 1500,
  shopWarrantyEndDate: null,
};

describe('DeviceWarrantyCard — ปุ่มแจ้งปัญหาเครื่อง', () => {
  it('ไปหน้าแจ้งปัญหาเครื่องพร้อม IMEI (เดิมชี้ /repair-tickets ที่ไม่มีหน้า)', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route path="/inbox" element={<DeviceWarrantyCard contract={contract} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /แจ้งปัญหาเครื่อง/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/after-sales/new?imei=356812345674412');
  });

  it('ไม่มี IMEI → ไปหน้าแจ้งปัญหาเครื่องแบบค้นหาเอง', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route path="/inbox" element={<DeviceWarrantyCard contract={{ ...contract, serialNumber: null }} />} />
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /แจ้งปัญหาเครื่อง/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/after-sales/new');
    expect(screen.getByTestId('where')).not.toHaveTextContent('imei=');
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd apps/web && npx vitest run src/pages/after-sales/TicketRedirect.test.tsx src/pages/UnifiedInboxPage/components/DossierCards.test.tsx`
Expected: FAIL — ไม่พบ "ไม่พบเคสหลังการขายของใบซ่อมนี้" / ไม่พบปุ่ม "แจ้งปัญหาเครื่อง"

- [ ] **Step 3: TicketRedirect** — แทนทั้งไฟล์ `apps/web/src/pages/after-sales/TicketRedirect.tsx`

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { afterSalesKeys } from './after-sales';

/** ตรวจ 404 จาก axios error shape โดยไม่ผูกกับ error class ใดๆ (`api` คืน raw axios error) */
function is404(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { response?: { status?: number } }).response?.status;
  return status === 404;
}

// เส้นทางเก่า /insurance/:id (ใบซ่อม) → หาเคสหลังการขายที่ผูกใบซ่อมนี้แล้วเด้งไป /after-sales/:id
// PR 4 (2026-09-26) — หน้าใบซ่อมเดิม (fallback) ถูกถอดแล้ว: ใบซ่อมทุกใบบน prod มีเคสผูกครบ และพ้น
// กำหนด "≥2 รุ่น deploy" ของสเปกข้อ 11 ⇒ 404 แสดงข้อความ + ลิงก์ไปหน้าหลังการขายแทน
// error อื่น (5xx/เครือข่าย) ยังแสดง error UI + ปุ่มลองใหม่ (A3 final-fix เดิม)
export default function TicketRedirect() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: afterSalesKeys.lookup(id ?? ''),
    queryFn: async () => {
      const res = await api.get<{ id: string }>(`/after-sales/by-ticket/${id}`);
      return res.data;
    },
    enabled: !!id,
    retry: false,
  });

  if (isLoading) return null;
  if (isError && !is404(error)) {
    return (
      <QueryBoundary isLoading={false} isError error={error} onRetry={refetch}>
        <></>
      </QueryBoundary>
    );
  }
  if (data?.id) return <Navigate to={`/after-sales/${data.id}`} replace />;
  return (
    <div className="mx-auto mt-10 max-w-md space-y-3 rounded-xl border border-border bg-card p-6 text-center">
      <p className="text-base font-semibold leading-snug text-foreground">
        ไม่พบเคสหลังการขายของใบซ่อมนี้
      </p>
      <p className="text-sm leading-snug text-muted-foreground">
        งานซ่อมทั้งหมดย้ายมาอยู่ที่หน้า "หลังการขาย" แล้ว — ค้นจาก IMEI หรือชื่อ/เบอร์ลูกค้าได้ที่นั่น
      </p>
      <Link
        to="/after-sales"
        className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-semibold leading-snug text-primary hover:underline"
      >
        ไปหน้าหลังการขาย
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: App.tsx** — `apps/web/src/App.tsx`

(4.1) ลบบรรทัด `const RepairTicketDetailPage = lazy(() => import('@/pages/insurance/RepairTicketDetailPage'));`

(4.2) แทนบล็อก route `/insurance/:id` (คอมเมนต์ 3 บรรทัด "`/insurance/:id (ใบซ่อมเดิม) ยังเป็นหน้าจริง …`" + `<Route path="/insurance/:id" …>` ทั้งก้อน) ด้วย

```tsx
          {/* /insurance/:id (ลิงก์ใบซ่อมเก่า) → เคสหลังการขายที่ผูกใบซ่อมนั้น — หน้าใบซ่อมเดิมถูกถอดใน
              PR 4 (ใบซ่อมทุกใบมีเคสผูกแล้ว + พ้นกำหนด ≥2 รุ่น deploy ของสเปกข้อ 11) */}
          <Route
            path="/insurance/:id"
            element={
              <ProtectedRoute
                roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT']}
              >
                <TicketRedirect />
              </ProtectedRoute>
            }
          />
```

(4.3) คอมเมนต์ท้ายไฟล์ที่เขียนว่า `/insurance/:id is still a real page (TicketRedirect fallback) —` เปลี่ยนเป็น `/insurance/:id redirects to the linked after-sales case (old repair-ticket page removed in PR 4) —`

- [ ] **Step 5: ย้าย combobox + ลบโฟลเดอร์เดิม**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && git mv src/pages/insurance/components/RepairCenterCombobox.tsx src/pages/after-sales/RepairCenterCombobox.tsx
grep -rln "pages/insurance/components/RepairCenterCombobox" src | xargs sed -i '' "s#@/pages/insurance/components/RepairCenterCombobox#@/pages/after-sales/RepairCenterCombobox#g"
grep -rn "pages/insurance" src; echo "remaining-refs-exit=$?"
```
Expected: บรรทัดสุดท้าย `remaining-refs-exit=1` (ไม่เหลือใครอ้าง `pages/insurance`)

`RepairCenterCombobox.tsx` import ด้วย `@/…` ทั้งหมด (ตรวจแล้ว 2026-09-26) ย้ายแล้วไม่ต้องแก้ภายในไฟล์ · ลบโฟลเดอร์ที่เหลือ:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && git rm -r -q src/pages/insurance && ls src/pages/insurance 2>&1 | head -1
```
Expected: `ls: src/pages/insurance: No such file or directory`

- [ ] **Step 6: ปุ่มในอินบ็อกซ์** — `apps/web/src/pages/UnifiedInboxPage/components/DossierCards.tsx` แทนบรรทัด

```tsx
        <Button size="sm" className="flex-1" onClick={() => navigate(`/repair-tickets?new=1&imei=${encodeURIComponent(imei ?? '')}`)}><Wrench className="mr-1 size-3.5" /> เปิดใบซ่อม / เคลม</Button>
```

ด้วย

```tsx
        <Button size="sm" className="flex-1" onClick={() => navigate(imei ? `/after-sales/new?imei=${encodeURIComponent(imei)}` : '/after-sales/new')}><Wrench className="mr-1 size-3.5" aria-hidden /> แจ้งปัญหาเครื่อง</Button>
```

- [ ] **Step 7: รันให้ผ่าน + ทั้งชุดเว็บ**

Run: `cd apps/web && npx vitest run src/pages/after-sales src/pages/AfterSales src/pages/UnifiedInboxPage`
Expected: PASS ทั้งหมด
Run: `cd apps/web && npx tsc --noEmit; echo "web-tsc-exit=$?"`
Expected: `web-tsc-exit=0`

- [ ] **Step 8: format + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && npx prettier --write apps/web/src/pages/after-sales/TicketRedirect.tsx apps/web/src/pages/after-sales/TicketRedirect.test.tsx apps/web/src/pages/UnifiedInboxPage/components/DossierCards.test.tsx apps/web/src/pages/after-sales/RepairCenterCombobox.tsx apps/web/src/App.tsx
git add apps/web/src/App.tsx apps/web/src/pages/after-sales/TicketRedirect.tsx apps/web/src/pages/after-sales/TicketRedirect.test.tsx apps/web/src/pages/after-sales/RepairCenterCombobox.tsx apps/web/src/pages/AfterSalesNewPage.tsx apps/web/src/pages/after-sales/ExchangeActionDialogs.tsx apps/web/src/pages/after-sales/RepairActionDialogs.tsx apps/web/src/pages/AfterSalesCasePage.test.tsx apps/web/src/pages/UnifiedInboxPage/components/DossierCards.tsx apps/web/src/pages/UnifiedInboxPage/components/DossierCards.test.tsx
git status --short
git commit -m "refactor(web): ถอดหน้าใบซ่อมเดิม /insurance/:id (ครบ 2 รุ่น deploy) + ปุ่มแจ้งปัญหาเครื่องในอินบ็อกซ์ชี้หน้าจริง

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(`git status --short` ก่อน commit ต้องไม่เหลือไฟล์ใต้ `pages/insurance/` ที่ยังไม่ stage — `git rm` stage ให้แล้ว; ห้าม `git add -A`)

---

### Task 7: bump version + เอกสาร + ตรวจรวม

**Files:**
- Modify: `apps/web/package.json` (`"version": "26.9.56"` → `"26.9.57"`)
- Modify: `docs/superpowers/specs/2026-09-23-after-sales-hub-design.md` (บรรทัดสถานะ)
- Modify: `.claude/CLAUDE.md` (Key Routes)

- [ ] **Step 1: version**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && sed -i '' 's/"version": "26.9.56"/"version": "26.9.57"/' apps/web/package.json && grep -n '"version"' apps/web/package.json
```
Expected: `3:  "version": "26.9.57",`

- [ ] **Step 2: สเปก** — เพิ่มบรรทัดสถานะใหม่ต่อจากบรรทัด `- สถานะ: **PR 3 implemented** …` (บรรทัดที่ 6)

```markdown
- สถานะ: **PR 4 implemented** บน branch `feat/after-sales-hub-pr4` (ต่อจาก PR 3 · รอเปิด PR) — ใบรับฝากเครื่อง + ใบส่งมอบเป็น PDF A4 หน้าเดียว (`GET /after-sales/:id/receipt.pdf` | `/handover.pdf` ทั้ง 5 role; ขอบเขตสาขาผ่าน `getCase`; ใบส่งมอบพิมพ์ได้เมื่อ READY_FOR_PICKUP/CLOSED) · ลงไทม์ไลน์ `PRINTED` (กันซ้ำ 5 นาทีต่อคนต่อเอกสาร) · ปุ่มพิมพ์บนหัวหน้าเคส + ปุ่มรอง "บันทึก + พิมพ์ใบรับฝาก" (หน้าแจ้งปัญหาเครื่อง → `?print=receipt`) · ถอดหน้าใบซ่อมเดิม `/insurance/:id` (ลิงก์เก่ายังเด้งไปเคส) · แก้ปุ่มตาย `/repair-tickets?new=1` ในอินบ็อกซ์ · ไม่มี migration · ค้างเจ้าของเคาะ: ข้อ "ไม่มาติดต่อเกินกี่วัน" ในเงื่อนไขการรับฝาก
```

- [ ] **Step 3: CLAUDE.md** — ใน `.claude/CLAUDE.md` หัวข้อ `### Collections & Risk` แทน `` `/insurance(/:id|/new)` (SP5 Phase 2) `` ด้วย `` `/after-sales(/:id|/new)` (หลังการขาย — ใบรับฝาก/ใบส่งมอบ PDF; `/insurance*` เหลือ redirect) ``

- [ ] **Step 4: ตรวจรวมทั้ง branch**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/api && npx jest src/modules/after-sales src/modules/warranty src/modules/line-oa --runInBand 2>&1 | tail -5
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/api && npx tsc --noEmit -p tsconfig.json; echo "api-tsc-exit=$?"
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/api && npx nest build >/dev/null && echo "nest-build-ok"
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && npx tsc --noEmit; echo "web-tsc-exit=$?"
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales/apps/web && npx vitest run 2>&1 | tail -5
```
Expected: jest `Tests: N passed` (0 failed; smoke 3 skipped) · `api-tsc-exit=0` · `nest-build-ok` · `web-tsc-exit=0` · vitest ผ่านทั้งหมด
ตรวจ E2E: `grep -rn "ใบรับฝาก\|insurance/" apps/web/e2e/*.ts` — ถ้า `after-sales-hub.spec.ts` อ้างถึงปุ่ม/หน้าที่เปลี่ยนให้แก้ตาม (ณ วันเขียนแผนไม่มี)

- [ ] **Step 5: commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE-after-sales && git add apps/web/package.json docs/superpowers/specs/2026-09-23-after-sales-hub-design.md .claude/CLAUDE.md
git commit -m "chore: bump web 26.9.57 + บันทึกสถานะ PR 4 หลังการขาย

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
