# ชุดตรวจเอกสารแบบ integration (DOC-FINAL-20260911)

ชุดนี้พิสูจน์เอกสาร PDF ของระบบ **ตลอดเส้นทางจริง**: ล็อกอินด้วยผู้ใช้จำลองผ่าน `POST /api/auth/login` → เรียก route ที่มี guard จริง (JWT, Roles, ContractFileAccess, BranchGuard, EntityScopeInterceptor, CSRF, Throttler) → renderer จริง (Chromium) → เก็บไฟล์ใน storage จริงแบบ local → ดาวน์โหลดแล้วเทียบ bytes/hash → parse PDF ตรวจหน้า/ฟอนต์/ขนาด/ตำแหน่งข้อความ

สิ่งที่ **ไม่** ถูก stub: route, controller, validation pipe, guard ทุกตัว, service, Prisma, renderer, storage adapter
สิ่งที่ **ถูกจำลอง** (ต้องรายงานทุกครั้ง): ช่องทางส่งข้อความออก (LINE / SMS / e-mail ถูกบันทึกแทนการส่ง), storage เป็นโฟลเดอร์ส่วนตัว (signed URL ตอบ 501), ข้อมูลบริษัท/สาขา/ผู้ใช้/ลูกค้า/สัญญาเป็นแถวสังเคราะห์ที่มี marker ทดสอบ

## รันจาก checkout สะอาด

ต้องมี Node ตาม `package.json`, PostgreSQL 16 พร้อม pgvector (ตั้ง `DOCS_PG_BIN` ถ้าไม่อยู่ในตำแหน่งมาตรฐาน) และ Chromium (ของ Playwright หรือ Puppeteer ก็ได้ ตั้ง `PUPPETEER_EXECUTABLE_PATH` ได้ถ้าตรวจไม่เจอเอง)

```bash
npm ci
npm run docs:check                          # ทุก domain
bash tools/docs-integration.sh contract-pdpa   # เฉพาะไฟล์ที่ชื่อตรง (ส่งต่อให้ jest)
```

ทุกครั้งที่รัน script จะ

1. สร้าง PostgreSQL ชั่วคราวใน `/tmp/bc-docs.XXXXXX` (unix socket ส่วนตัว ไม่เปิดพอร์ต TCP) พร้อมฐาน `bc_docs_shop` และ `bc_docs_finance` แล้ว `prisma migrate deploy` ทั้งสองฐาน
2. สุ่ม `JWT_SECRET` / `PII_ENCRYPTION_KEY` / `PII_HASH_SALT` ใหม่ และ **ปักค่าว่าง** ให้ตัวแปร provider ภายนอกทุกตัว (LINE, SMS, SMTP, Anthropic, Sentry, GCS/S3, …) จึงไม่มี `.env` ไฟล์ไหนเปิดช่องทางส่งจริงในโปรเซสได้
3. ตั้ง `STORAGE_LOCAL_DIR` ไปที่ `<output>/storage` และ `DOCS_QA_OUTPUT` ไปที่ `.tmp/docs-integration/<run-id>/`
4. รัน jest ด้วย `apps/api/e2e/jest-documents.json` (regex `e2e/documents/*.docs-spec.ts`) แล้วรวมผล
5. ปิดและลบฐานชั่วคราว (เก็บไว้ดูได้ด้วย `DOCS_QA_KEEP_DB=1`)

harness ปฏิเสธที่จะเริ่มถ้า `DATABASE_URL` ไม่ใช่ฐาน `bc_docs_*` บน socket `bc-docs.`, ถ้า `NODE_ENV=production`, ถ้ามี credential ภายนอกค้างอยู่ หรือถ้าไม่มี Chromium (`apps/api/e2e/documents/support/runtime.ts`)

อย่ารัน `npm run local:check` กับ `npm run docs:check` **ใน checkout เดียวกันพร้อมกัน** — ทั้งคู่ `prisma generate` ลง `node_modules/.prisma/client` ก้อนเดียวกัน jest ที่กำลังโหลดจะเจอ `Cannot find module '.prisma/client/default'` (ข้าม checkout/worktree ไม่มีปัญหาถ้า node_modules แยกกัน)

### รันพร้อมกันหลายคน

แต่ละ run มีฐานข้อมูล/socket, โฟลเดอร์ storage, โฟลเดอร์ output และพอร์ต API (สุ่มโดย `app.listen(0)`) ของตัวเอง จึงเปิดสอง worktree แล้วรันพร้อมกันได้ทันที ไม่ต้องจองพอร์ต ถ้าต้องการเก็บผลนอก repo ให้ตั้ง `DOCS_QA_OUTPUT=/path/ที่ว่าง` ก่อนรัน

## ผลลัพธ์ (`.tmp/docs-integration/<run-id>/`, ไม่เข้า Git)

| ไฟล์ | เนื้อหา |
| --- | --- |
| `run.json` | ref/branch/`sourceFingerprint`, baseline `fb0659f3c`, Chromium ที่ใช้, ชื่อฐาน (ไม่มีรหัส), ขอบเขต, รายการ simulation, route ที่ไม่รองรับ, สรุป jest และสถานะ PASS/FAIL |
| `manifest.json` | รวม `manifest/<domain>.jsonl` ทุก domain: scenario, เอกสารที่ครอบคลุม, route/guard ที่ผ่านจริง, renderer, artifact, สิ่งที่จำลอง/ยังไม่ได้ตรวจ พร้อมสรุปชั้นหลักฐาน (API integration / browser / printer / staging) |
| `jest-results.json` | ผล jest ดิบ (ชื่อเทสต์ที่ล้มและข้อความ) |
| `<domain>/…` | PDF/HTML/JSON ที่ scenario บันทึกด้วย `saveArtifact` |
| `storage/` | ไฟล์ที่ API เก็บผ่าน `StorageService` (key เดียวกับ `EDocument.fileUrl`) |
| `migrate-*.log`, `prepare.log` | บันทึกขั้นเตรียม |

## เพิ่ม scenario ของ domain ใหม่ (DOC-01 ถึง DOC-10)

สร้างไฟล์ `apps/api/e2e/documents/<domain>.docs-spec.ts` หนึ่งไฟล์ต่อ domain — ไม่ต้องแก้ registry, jest config หรือ bootstrap ใด ๆ jest จับไฟล์ตามชื่อ และ manifest แยกไฟล์ต่อ domain จึงไม่ชนกัน

```ts
import { startDocumentsApp, DocumentsHarness } from './support/harness';
import { seedDocumentsWorld, createSignedContract } from './support/fixtures';
import { saveArtifact, recordScenario, sha256 } from './support/artifacts';
import { parsePdf, isA4, pageContaining, sizesOfText, textSizes } from './support/pdf';

const DOMAIN = 'receipts';
describe('DOC-01 receipts', () => {
  let h: DocumentsHarness;
  beforeAll(async () => { h = await startDocumentsApp(); }, 180000);
  afterAll(() => h.close());
  it('…', async () => {
    const world = await seedDocumentsWorld(h.prisma);          // หรือ fixture ของ domain เอง
    const owner = await h.login(world.users.owner.email, world.password);
    const res = await h.client({ session: owner }).get(`/receipts/${id}/pdf`).expect(200);
    const pdf = await parsePdf(res.body);
    expect(pdf.pages.every(isA4)).toBe(true);
    const artifact = saveArtifact(DOMAIN, 'receipt.pdf', res.body);
    recordScenario(DOMAIN, { id: `${DOMAIN}/…`, title: '…', documents: ['RECEIPT'], routes: ['GET /api/receipts/:id/pdf'], guards: ['JwtAuthGuard', 'RolesGuard'], renderer: 'chromium', source: 'api', status: 'PASS', artifacts: [artifact.relativePath], simulated: ['…'] });
  });
});
```

ตัวช่วยเพิ่มเติมใน `support/`

- `receipts-fixtures.ts`: `createFinancedContract()` (สัญญา FINANCE 17K/12M แบบเดียวกับ CPA golden case พร้อม `installment_schedule` + `Payment` 12 งวด) · `activateContract()` (โพสต์ JE 1A ผ่าน template จริง) · `grantApprovalPermissions()` (ให้สิทธิ์อนุมัติ EARLY_PAYOFF / VOID_RECEIPT ผ่าน SystemConfig เดียวกับหน้าแอดมิน)
- `letters-fixtures.ts` (DOC-09): `createOverdueContract()` (สัญญา OVERDUE + งวดค้าง/งวดอนาคตตาม `oldestOverdueDays`, เบี้ยปรับต่องวด) · `expectedLetterFigures()` (ยอดค้าง/เบี้ยปรับ/รวม/รายชื่อเดือนที่ค้าง แบบอิสระ) · `letterMoney()` · `thaiLongDate()` · `setSystemConfig()` · `startStoredFileServer()` (HTTP file server + CORS แทน object storage สาธารณะที่ถือไฟล์ `ContractLetter.pdfUrl` ยุคเก่า สั่ง outage ได้) — จดหมายจริงสร้างด้วย `h.app.get(LetterAutoGenerateCron).run()` หลังตั้ง `letter_auto_generate_enabled=true`
- `collections-report-fixtures.ts` (DOC-10): `seedCollectionsReport()` (สัญญาค้างชำระครบทุก bucket + DEFAULT/TERMINATED/ACTIVE, filler 30 สัญญา, dunning action รอบขอบช่วงวันที่, นัดชำระ kept/broken/อนาคต, จดหมายที่ส่งแล้ว, งวดที่รับชำระเดือนนี้) · `expectedAging/Collectors/Recovery/Stuck/Letters/PromiseTrend/DunningTotals/CollectionRate()` (นับใหม่จากแถวผ่าน Prisma ทั้งฐาน — scope เดียวกับรายงาน ไม่เรียก service) · `reportPeriod()` / `bangkokMidnight()` / `bangkokEndOfDay()` / `bangkokDate()` · `databaseClock()` (NOW/CURRENT_DATE/date_trunc ของฐาน) — `collections-report-pdf.ts`: `parseReport()` ประกอบตาราง jsPDF จากตำแหน่งข้อความ (`items.x/width`) เป็น head/rows ต่อ section พร้อมหน้าที่ head ซ้ำ, `expectReportMatchesSource()` เทียบทุกตัวเลขบน PDF กับการนับอิสระ, `expectTopWithTies()` เทียบ top-N ที่ลำดับใน tie ไม่แน่นอน
- `web.ts`: `startWeb(h)` เปิด Vite dev server ของ `apps/web` (config `vite.docs-qa.config.ts` proxy `/api` → API ของ run นี้) + Playwright Chromium; `web.login(page, email, password)` ล็อกอินผ่านฟอร์มจริง; `downloadBytes(download)` อ่านไฟล์ที่ปุ่มดาวน์โหลดบันทึก — ตัวอย่างเต็มใน `receipts.browser.docs-spec.ts`
- `pdf.ts`: `contentSignature(pdf)` ใช้เทียบเอกสารที่ render ใหม่ทุกครั้ง (ใบเสร็จ) — bytes ของ Chromium ไม่นิ่งข้าม render แม้ตัด `/CreationDate`; ใช้ `sha256` ตรง ๆ เฉพาะไฟล์ที่เก็บครั้งเดียว (EDocument)
- harness seed ผังบัญชี CPA และผู้ใช้ระบบ `admin@bestchoice.com` (JournalAutoService ใช้เป็นผู้บันทึก JE อัตโนมัติ; ล็อกอินไม่ได้) ก่อน boot ทุกครั้ง

ข้อควรระวังจากงาน DOC-01: `POST /payments/record` ถูกจำกัด 5 ครั้ง/10 วิ แต่ในทางปฏิบัติ throttler ส่วนกลางกับ `UserThrottlerGuard` นับซ้ำกัน ⇒ บันทึกได้ ~2 ครั้งต่อ 10 วิ ต้องเว้นช่วง (ดู helper `pay()` ใน `receipts.docs-spec.ts`) และทุกการรับเงินต้องมี `transactionRef` หรือ slip

ข้อควรระวังจากงาน DOC-09: role ระดับสาขา (SALES/BRANCH_MANAGER) มีสิทธิ์เฉพาะบริษัท SHOP — เรียก route ใดด้วย `?company=finance` จะได้ 403 "ไม่มีสิทธิ์เข้าถึง company FINANCE" ก่อนถึง guard ของ domain ให้เลือก company ตาม `session.user.accessibleCompanies` · route ที่มี segment คงที่ (`letters/bulk/dispatch`) ต้องประกาศ **ก่อน** route `letters/:id/...` ใน controller ไม่งั้น Nest จับเป็น id="bulk" (พบ 404 จริงใน DOC-09) · จดหมายทวงถาม 45 วันมาตรฐานยาว 2 หน้า A4 ที่ 16 pt (หน้า 2 = ประโยคปิดท้าย + ลายเซ็น) — อย่า assert "1 หน้า" กับเอกสารที่ข้อความกฎหมายคงที่ · ลำดับหน้าของ PDF รวมตรวจจาก footer "เลขที่ ST-…" ทีละหน้า (แต่ละฉบับกินหลายหน้าได้) · `npm run docs:check` ทั้งชุดใช้ฐานเดียวกันทุก domain — กรอง world ของตัวเองเสมอ (ดู DOC-07)

ข้อควรระวังจากงาน DOC-10: **`npm run docs:check` ทั้งชุดเคยตายด้วย "JavaScript heap out of memory" (heap 4 GB) หลัง suite ที่ 6** — jest รันทุก suite ใน process เดียว (`--runInBand`) และแต่ละ suite boot AppModule + Prisma + Chromium ซ้ำจนหน่วยความจำสะสม (อาการ "jest ออกกลางคันโดยไม่มี error ใน log" ที่ DOC-09 เจอ = เรื่องเดียวกัน) ⇒ runner เลิกส่ง `--runInBand` และ `jest-documents.json` ตั้ง `workerIdleMemoryLimit: 1.5GB` (jest 29.7: เมื่อตั้งค่านี้จะรันใน worker แม้ `maxWorkers: 1` และรีสตาร์ต worker เมื่อ idle memory เกินเกณฑ์) — suite ยังรันทีละไฟล์บนฐานเดียวกันเหมือนเดิม · **ฐาน PostgreSQL ชั่วคราวของ runner ถูกปักเป็น `timezone=UTC` ตาม prod (Cloud SQL รัน UTC ตรวจ 2026-09-11) ขณะที่ process API ยังเป็น Asia/Bangkok** — คอลัมน์ `timestamp` (Prisma DateTime) เก็บค่า UTC และ Prisma bind `Date` เป็น `timestamptz` ⇒ ถ้า session เป็น Asia/Bangkok (ค่าเดิมที่ initdb สืบทอดจาก TZ) การเทียบ `executed_at >= $1`, `paid_date >= date_trunc('month', NOW())`, `CURRENT_DATE - due_date::date` จะเลื่อน 7 ชั่วโมงจาก prod — spec ที่นับใหม่เองให้อ่าน `databaseClock()` แทนการเดา · `POST /reporting/pdf` ตอบ **201** (Nest default ของ POST แม้ใช้ `@Res()`) ไม่ใช่ 200 · `ORDER BY` คอลัมน์ enum (เช่น `letter_type`) เรียงตามลำดับประกาศ enum ไม่ใช่ตัวอักษร · analytics/aging/leaderboard cache ในหน่วยความจำ 5 นาทีต่อ process — seed ให้ครบก่อนเรียกรายงานครั้งแรก · ตาราง jsPDF อ่านจาก `page.items` (x + width) ไม่ใช่ `lines` เพราะ cell ที่ตัดบรรทัดทำให้ regex ต่อบรรทัดพัง · หน้า `/collections` มี `<aside role="dialog" aria-label="ข้อมูลลูกค้า 360">` ค้างอยู่เสมอ (แผงเลื่อนออกนอกจอ) — `page.getByRole('dialog')` เจอ 2 ตัวและ `waitFor({ state: 'detached' })` ไม่มีวันจบ ให้ระบุชื่อ dialog (`getByRole('dialog', { name: 'ส่งออกรายงาน PDF' })`); dialog ที่เปิดค้างทำให้ปุ่มนอก dialog หายจาก accessibility tree (`aria-hidden`) จน `getByRole` หาไม่เจอ

กติกา

- `h.client({ session })` ใส่ `Authorization`, `X-Requested-With: XMLHttpRequest` (CsrfGuard) และ `?company=shop` ให้เหมือน `apps/web/src/lib/api.ts`; ใช้ `company: 'FINANCE'` สำหรับงานการเงิน และ `company: null` เมื่อต้องการทดสอบ request ที่ไม่ระบุบริษัท
- **ห้าม** `jest.spyOn` renderer, storage, guard หรือ service บนเส้นทางที่กำลังพิสูจน์ (ชุด e2e เดิมเช่น `sales-documents.e2e-spec.ts` ทำแบบนั้นเพื่อทดสอบ boundary ไม่ใช่ integration) stub ได้เฉพาะ adapter ภายนอกที่ไม่อยู่ใน acceptance ผ่าน `startDocumentsApp({ customize })` และต้องเขียนลง `simulated`
- ข้อมูลทุกแถวต้องมี marker จาก `src/utils/test-data-markers.ts` (ชื่อขึ้นต้น `ทดสอบระบบ`, เลขเอกสาร/IMEI ขึ้นต้น `TEST-`, ที่อยู่ลูกค้า `ข้อมูลทดสอบระบบ — ลบได้`) และห้ามมีข้อมูลลูกค้าจริงหรือ secret ใน artifact
- ตรวจยอดจาก source อิสระ (fixture ที่คำนวณเอง) ไม่แก้สูตรภาษี/นโยบายบัญชี/ถ้อยคำกฎหมายเพื่อให้ layout ผ่าน
- `recordScenario` ทุก `it` ที่ผ่าน; ถ้า scenario ต้องรอเงื่อนไขภายนอก ให้บันทึก `status: 'BLOCKED'` พร้อม `unverified`
- ถ้าพบ defect ให้เพิ่ม regression ที่พิสูจน์อาการก่อน แล้วแก้เฉพาะต้นเหตุใน module ของ domain; ไฟล์ใน `e2e/documents/support/`, `tools/docs-integration.*`, `StorageService`, `app.setup.ts` และ shared PDF/font components ให้ผู้ประสาน DOC-00/DOC-11 รวม patch ทีละชุด

## จุดเริ่มต้นต่อ domain

| งาน | เริ่มดูที่ | หมายเหตุ |
| --- | --- | --- |
| DOC-01 ใบเสร็จ/ใบลดหนี้ | `apps/api/src/modules/receipts/services/receipt-pdf.service.ts`, controller ใน `modules/receipts`, ใบลดหนี้ยึดคืนใน `modules/repossessions`; ฝั่งเว็บ `components/contract/ContractPaymentSchedule.tsx`, `components/payment/PaymentHistorySheet.tsx`, `pages/RepossessionsPage.tsx` เรียก `lib/document-download.ts` | `receipt-pdf.service.spec.ts` mock puppeteer — ชุดนี้ต้องใช้ Chromium จริง; สร้างการรับเงินผ่าน service จริง (`e2e/payment-receipt-primitive.e2e-spec.ts` มีตัวอย่าง fixture) |
| DOC-02 ใบรับของ/ใบรับเครื่องเทิร์น | `modules/purchase-orders`, `modules/trade-in/services/voucher/voucher-pdf.renderer.ts`, fixture `e2e/support/trade-in-fixture.ts` | `trade-in-buyback.e2e-spec.ts` spy renderer — ห้าม spy ที่นี่; พิมพ์ซ้ำต้องไม่เปลี่ยน stock |
| DOC-03 ใบสำคัญจ่าย/เงินสดย่อย/สรุปรายจ่าย | `modules/expense-documents/services/expense-voucher-pdf.service.ts`, controller + `__tests__/expense-documents.controller.spec.ts` (mock PDF) | หน้า voucher ใช้ร่วมกับ payroll — ประสาน DOC-04 ก่อนแก้ |
| DOC-04 สลิปเงินเดือน/50 ทวิรายปี | `modules/expense-documents` (payroll templates, `payroll-shop-flow.integration.spec.ts`) | ผู้ออกใช้ `CompanyInfo` FINANCE — fixture ใน `seedDocumentsWorld` สร้างไว้แล้ว |
| DOC-05 ใบสำคัญรับเงินรายได้อื่น/สรุปรายวัน | `modules/other-income/services/receipt-pdf.service.ts`, `other-income.controller.ts` | ใช้ `company: 'FINANCE'` |
| DOC-06 ใบรับสินทรัพย์/ทะเบียน | `modules/asset/services/asset-receipt-pdf.service.ts`, `__tests__/asset-receipt-pdf.controller.spec.ts` (mock ทั้ง service) | ทะเบียนเป็น landscape — ใช้ `page.widthPt > page.heightPt` |
| DOC-07 ใบกำกับภาษี e-Tax | `modules/e-tax`, `modules/e-tax-xml` (`ETAX_SUBMIT_MODE=disabled` ถูกปักไว้แล้ว), เว็บ `pages/finance/ETaxPage.tsx` | ห้ามติดต่อสรรพากร; คง ACCEPTED gate |
| DOC-08 50 ทวิเงินปันผล/ทะเบียนผู้รับ | `modules/equity` | ผู้ออก FINANCE |
| DOC-09 จดหมายติดตามหนี้ | `modules/overdue/letter-pdf.service.ts`, `contract-letter.service.ts`, `letter-document-access.guard.ts`; `e2e/letter-documents.e2e-spec.ts` (spy renderer — ห้ามที่นี่) | ไฟล์เดิมใน storage ต้องได้ bytes เดิม; download ต้องไม่ mark printed — ทำแล้วใน `letters.docs-spec.ts` + `letters.browser.docs-spec.ts` (พิมพ์รวม 52 ฉบับ, ไฟล์เดิม/outage ผ่าน `startStoredFileServer()`) |
| DOC-10 Collections Report | `modules/reporting/pdf-report.service.ts` (jsPDF ไม่ใช่ Chromium), `pages/CollectionsPage/hooks/usePdfExport.ts` | บันทึก `renderer: 'jspdf'`; ห้ามเรียก weekly e-mail dispatch — ทำแล้วใน `collections-report.docs-spec.ts` + `collections-report.browser.docs-spec.ts` (ช่วงวันที่เฉพาะส่วน Recovery; ส่วนอื่นเป็นหน้าต่าง 30/90 วันถึงวันนี้) |

## สิ่งที่ชุดนี้ยังไม่รับรอง

- หน้าจอเว็บ/ปุ่มดาวน์โหลดจริงในเบราว์เซอร์ (Playwright web e2e และงาน DOC-11)
- native PDF viewer, เครื่องพิมพ์จริง, ระยะขอบบนกระดาษ (DOC-12)
- GCS/S3, signed URL, CORS, retention บน staging (DOC-13)
- ข้อสังเกตจาก DOC-00: footer ของหน้า PDF ฝั่ง Chromium ถูกตรึงที่ 16px (= 12pt) ใน `DocumentRenderingService.htmlToPdf` ไม่ตาม `settings.fontSize.footer` ของ template (ต่างจาก jsPDF ฝั่งเว็บที่ใช้ค่านี้) — ยังไม่แก้ในชุดนี้ รอผู้ประสาน DOC-11 ตัดสินร่วมกับเจ้าของ
