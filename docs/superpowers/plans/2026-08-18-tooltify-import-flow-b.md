# Tooltify Import — Flow B (ยอดขายสถิติ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** นำเข้าประวัติการขายรายชิ้นจากไฟล์ Excel ของ Tooltify เข้าตาราง read-only ใหม่ `ImportedSale` + หน้า dashboard สถิติ โดยไม่แตะระบบบัญชี/คอมมิชชั่น/`Sale` จริง.

**Architecture:** ตารางใหม่ `ImportedSale` (immutable snapshot) · parser บริสุทธิ์แยกจาก I/O (`tooltify-sales-parser.ts` รับ `string[][]` → คืน `ParsedSale[]`, unit-testable) + ตัวอ่าน xlsx บาง (`xlsx-reader.ts`, exceljs) · CLI `import-tooltify` bootstrap `PrismaClient` ตรง (เลี่ยง `SalesService` ที่จุด JE) มี env-guard + dry-run · โมดูล NestJS `imported-sales` (read-only list + summary) · หน้า `ImportedSalesPage` โมเดลตาม `SalesHistoryPage.tsx`.

**Tech Stack:** NestJS + Prisma + PostgreSQL (api) · exceljs (มีใน repo) · jest (api tests) · React 18 + Vite + Tailwind + shadcn/ui + @tanstack/react-query (web).

**Spec:** `docs/superpowers/specs/2026-08-18-tooltify-import-design.md` (Flow B = §7, §8; parser mapping = §5, §5.1)

## Global Constraints

- Money = `Decimal @db.Decimal(12, 2)` เท่านั้น (ห้าม Float/Int); ผลรวมในโค้ดใช้ `Prisma.Decimal`.
- ทุก model มี `id String @id @default(uuid())`; `ImportedSale` เป็น **immutable snapshot** → ยกเว้น `updatedAt`/`deletedAt` โดยตั้งใจ + ใส่ `///` comment ตาม `.claude/rules/database.md`.
- Controller ทุกตัว: `@UseGuards(JwtAuthGuard, RolesGuard)` class-level + `@Roles(...)` ทุก method. Roles: `OWNER`, `ACCOUNTANT`, `FINANCE_MANAGER`.
- Pagination response shape: `{ data, total, page, limit }`; default `page=1, limit=50`.
- DTO ใช้ class-validator; error message ภาษาไทย.
- Frontend: `useQuery`/`api.get` เท่านั้น (ห้าม raw fetch); page lazy-load + `ProtectedRoute`; ห้าม hardcoded hex/gray — ใช้ semantic tokens.
- API tests = **jest**; DB-backed specs รันด้วย `--runInBand` (parallel-DB flaky).
- Source string คงที่ `'TOOLTIFY'`; ชื่อ table/route/model เป็น source-neutral (`ImportedSale` / `imported-sales`).
- Bump `apps/web/package.json` version หลัง deploy หน้าใหม่ (รูปแบบ YY.M.ลำดับ).

---

## File Structure

**สร้างใหม่:**
- `apps/api/src/modules/imported-sales/tooltify-sales-parser.ts` — parser บริสุทธิ์ + map (channel/payment/date). ไม่มี I/O.
- `apps/api/src/modules/imported-sales/xlsx-reader.ts` — อ่าน .xlsx → `string[][]` (exceljs). I/O บางๆ.
- `apps/api/src/modules/imported-sales/imported-sales.service.ts` — list + summary (อ่านอย่างเดียว).
- `apps/api/src/modules/imported-sales/imported-sales.controller.ts` — 2 endpoint.
- `apps/api/src/modules/imported-sales/imported-sales.module.ts`
- `apps/api/src/modules/imported-sales/dto/query-imported-sales.dto.ts`
- `apps/api/src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts`
- `apps/api/src/modules/imported-sales/__tests__/xlsx-reader.spec.ts`
- `apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts`
- `apps/api/src/cli/import-tooltify.cli.ts` — CLI Flow B (Flow A เติมภายหลัง).
- `apps/web/src/pages/ImportedSalesPage.tsx`

**แก้ไข:**
- `apps/api/prisma/schema.prisma` — เพิ่ม model `ImportedSale`.
- `apps/api/src/app.module.ts` — register `ImportedSalesModule`.
- `apps/api/package.json` — script `import:tooltify` + `:help`.
- `apps/web/src/App.tsx` — route `/imported-sales`.
- `apps/web/src/config/menu.ts` (หรือไฟล์เมนูที่ใช้จริง) — เมนู OWNER/ACCOUNTANT.

---

### Task 1: Prisma model `ImportedSale` + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (เพิ่ม model ท้ายไฟล์ หรือใกล้กลุ่ม read-model)
- Create: migration (สร้างอัตโนมัติจาก `prisma migrate dev`)

**Interfaces:**
- Produces: Prisma model `ImportedSale` (table `imported_sales`) + generated Prisma Client type `ImportedSale`. Fields ตาม spec §7.1.

- [ ] **Step 1: เพิ่ม model ใน `schema.prisma`**

```prisma
/// ยอดขายย้อนหลังที่นำเข้าจากระบบภายนอก (import แรก = Tooltify) — สถิติดูอย่างเดียว
/// Immutable import snapshot — updatedAt/deletedAt intentionally omitted (reverse = DELETE by importBatch)
model ImportedSale {
  id              String   @id @default(uuid())
  source          String   @default("TOOLTIFY")
  barcode         String
  productName     String   @map("product_name")
  category        String
  buyerLabel      String   @map("buyer_label")
  shopLabel       String?  @map("shop_label")
  orderNumber     String   @map("order_number")
  paymentType     String   @map("payment_type")
  priceGroup      String   @map("price_group")
  saleChannel     String   @map("sale_channel")
  costTotal       Decimal  @map("cost_total") @db.Decimal(12, 2)
  listPrice       Decimal  @map("list_price") @db.Decimal(12, 2)
  salePrice       Decimal  @map("sale_price") @db.Decimal(12, 2)
  profit          Decimal  @db.Decimal(12, 2)
  salespersonName String   @map("salesperson_name")
  soldAt          DateTime @map("sold_at")
  importBatch     String   @map("import_batch")
  importedAt      DateTime @default(now()) @map("imported_at")

  @@unique([source, barcode, orderNumber, soldAt])
  @@index([soldAt])
  @@index([saleChannel])
  @@index([salespersonName])
  @@index([category])
  @@index([orderNumber])
  @@map("imported_sales")
}
```

- [ ] **Step 2: สร้าง migration (dev)**

Run: `cd apps/api && npx prisma migrate dev --name add_imported_sales`
Expected: migration ใหม่ถูกสร้าง + Prisma Client regenerate สำเร็จ (ไม่มี error). ตรวจว่าไฟล์ migration มี `CREATE TABLE "imported_sales"` + unique index `(source, barcode, order_number, sold_at)`.

- [ ] **Step 3: ยืนยัน type check ผ่าน**

Run: `./tools/check-types.sh api`
Expected: 0 errors (Prisma Client มี type `ImportedSale`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(imported-sales): add ImportedSale model + migration"
```

---

### Task 2: Parser maps (channel / payment / date) — pure functions

**Files:**
- Create: `apps/api/src/modules/imported-sales/tooltify-sales-parser.ts`
- Test: `apps/api/src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts`

**Interfaces:**
- Produces:
  - `deriveSaleChannel(priceGroup: string): string` — `'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE' | 'OTHER'`
  - `normalizePayment(raw: string): string`
  - `parseThaiDateTime(raw: string): Date`

- [ ] **Step 1: เขียน failing test**

```ts
// __tests__/tooltify-sales-parser.spec.ts
import {
  deriveSaleChannel,
  normalizePayment,
  parseThaiDateTime,
} from '../tooltify-sales-parser';

describe('deriveSaleChannel', () => {
  it('maps price groups to sale channels', () => {
    expect(deriveSaleChannel('ราคาปลีก')).toBe('CASH');
    expect(deriveSaleChannel('ราคา 2')).toBe('INSTALLMENT');
    expect(deriveSaleChannel('ราคา 3')).toBe('EXTERNAL_FINANCE');
    expect(deriveSaleChannel('ราคา 4')).toBe('OTHER');
    expect(deriveSaleChannel('  ราคา 2 ')).toBe('INSTALLMENT'); // trims
    expect(deriveSaleChannel('')).toBe('OTHER');
  });
});

describe('normalizePayment', () => {
  it('maps Thai payment labels', () => {
    expect(normalizePayment('ขายแบบเงินสด')).toBe('CASH');
    expect(normalizePayment('ขายแบบโอน')).toBe('BANK_TRANSFER');
    expect(normalizePayment('ขายแบบสแกน QR')).toBe('QR_EWALLET');
    expect(normalizePayment('ขายแบบเครดิต')).toBe('CREDIT_BALANCE');
    expect(normalizePayment('อื่นๆ')).toBe('อื่นๆ'); // passthrough unknown
    expect(normalizePayment('')).toBe('UNKNOWN');
  });
});

describe('parseThaiDateTime', () => {
  it('parses "YYYY-MM-DD HH:mm:ss" as Bangkok time', () => {
    const d = parseThaiDateTime('2026-08-18 13:46:40');
    // 13:46:40 +07:00 === 06:46:40 UTC
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
  it('accepts an ISO string too (exceljs Date cell path)', () => {
    const d = parseThaiDateTime('2026-08-18T06:46:40.000Z');
    expect(d.toISOString()).toBe('2026-08-18T06:46:40.000Z');
  });
});
```

- [ ] **Step 2: รัน test ให้ FAIL**

Run: `cd apps/api && npx jest imported-sales/__tests__/tooltify-sales-parser --runInBand`
Expected: FAIL — "Cannot find module '../tooltify-sales-parser'".

- [ ] **Step 3: เขียน implementation ขั้นต่ำ**

```ts
// tooltify-sales-parser.ts
const CHANNEL_BY_PRICE_GROUP: Record<string, string> = {
  'ราคาปลีก': 'CASH',
  'ราคา 2': 'INSTALLMENT',
  'ราคา 3': 'EXTERNAL_FINANCE',
};

export function deriveSaleChannel(priceGroup: string): string {
  return CHANNEL_BY_PRICE_GROUP[(priceGroup ?? '').trim()] ?? 'OTHER';
}

const PAYMENT_MAP: Record<string, string> = {
  'ขายแบบเงินสด': 'CASH',
  'ขายแบบโอน': 'BANK_TRANSFER',
  'ขายแบบสแกน QR': 'QR_EWALLET',
  'ขายแบบเครดิต': 'CREDIT_BALANCE',
};

export function normalizePayment(raw: string): string {
  const t = (raw ?? '').trim();
  if (!t) return 'UNKNOWN';
  return PAYMENT_MAP[t] ?? t;
}

export function parseThaiDateTime(raw: string): Date {
  const t = (raw ?? '').trim();
  // ISO already (exceljs may hand back a Date -> toISOString upstream)
  if (t.includes('T')) return new Date(t);
  // "YYYY-MM-DD HH:mm:ss" — treat as Asia/Bangkok (+07:00)
  return new Date(t.replace(' ', 'T') + '+07:00');
}
```

- [ ] **Step 4: รัน test ให้ PASS**

Run: `cd apps/api && npx jest imported-sales/__tests__/tooltify-sales-parser --runInBand`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/imported-sales/tooltify-sales-parser.ts apps/api/src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts
git commit -m "feat(imported-sales): add channel/payment/date parse maps"
```

---

### Task 3: `parseSalesLineItems(rows, opts)` — locate detail table + build rows

**Files:**
- Modify: `apps/api/src/modules/imported-sales/tooltify-sales-parser.ts`
- Test: `apps/api/src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts` (เพิ่ม describe)

**Interfaces:**
- Consumes: `deriveSaleChannel`, `normalizePayment`, `parseThaiDateTime` (Task 2)
- Produces:
  - `interface ParsedSale { source: string; barcode: string; productName: string; category: string; buyerLabel: string; shopLabel: string | null; orderNumber: string; paymentType: string; priceGroup: string; saleChannel: string; costTotal: string; listPrice: string; salePrice: string; profit: string; salespersonName: string; soldAt: Date; importBatch: string; }`
  - `parseSalesLineItems(rows: string[][], opts: { importBatch: string }): ParsedSale[]`

- [ ] **Step 1: เขียน failing test**

```ts
// append to tooltify-sales-parser.spec.ts
import { parseSalesLineItems, ParsedSale } from '../tooltify-sales-parser';

const HEADER = [
  'บาร์โค้ดสินค้า','ชื่อสินค้า','หมวดหมู่สินค้า','ผู้ซื้อสินค้า','ร้านค้า',
  'คำสั่งซื้อ','รูปแบบการขาย','กลุ่มราคาขาย','ต้นทุนรวม','ราคาตั้งขาย',
  'ราคาขาย','กำไร','ผู้ขายสินค้า','วันที่ขายสินค้า',
];

function mkRows(): string[][] {
  return [
    ['สรุปยอดการขายสินค้า 2026-07-01 ถึง 2026-08-31'],
    [],
    ['รูปแบบการขาย','คำสั่งซื้อ','รายการขาย'], // summary block (ignored)
    ['ขายแบบเงินสด','17','49'],
    [],
    ['เบิกอะไหล่ไปซ่อม ( 0 )'],               // other section title (ignored)
    ['บาร์โค้ดสินค้า','ชื่อสินค้า','งานซ่อม'], // other section header (ignored)
    [],
    ['รายการขาย ( 2 )'],                       // <-- the detail section title
    HEADER,
    ['350630609144613','iPhone 17 Pro 256GB Silver (สีเงิน)','iPhone มือ 2','GFIN',
      'บริษัท จีฟินน์ จำกัด','1246','ขายแบบโอน','ราคา 3','37900','40063','40063','2163',
      'ภานุมาส ศรีวิลัย ( หมวย )','2026-08-18 13:46:40'],
    ['F17P01','ฟิล์มกระจก iPhone 17 Pro - iStar','Accessories','ลูกค้าทั่วไป','-',
      '1244','ขายแบบเงินสด','ราคาปลีก','35','0','0','-35',
      'ภานุมาส ศรีวิลัย ( หมวย )','2026-08-17 18:13:44'],
    [],                                        // blank terminates the table
    ['ignored trailing row'],
  ];
}

describe('parseSalesLineItems', () => {
  it('reads only the "รายการขาย" detail table and maps fields', () => {
    const out = parseSalesLineItems(mkRows(), { importBatch: 'file-A.xlsx' });
    expect(out).toHaveLength(2);
    const a = out[0];
    expect(a).toMatchObject<Partial<ParsedSale>>({
      source: 'TOOLTIFY',
      barcode: '350630609144613',
      productName: 'iPhone 17 Pro 256GB Silver (สีเงิน)',
      category: 'iPhone มือ 2',
      buyerLabel: 'GFIN',
      shopLabel: 'บริษัท จีฟินน์ จำกัด',
      orderNumber: '1246',
      paymentType: 'BANK_TRANSFER',
      priceGroup: 'ราคา 3',
      saleChannel: 'EXTERNAL_FINANCE',
      costTotal: '37900',
      salePrice: '40063',
      profit: '2163',
      salespersonName: 'ภานุมาส ศรีวิลัย ( หมวย )',
      importBatch: 'file-A.xlsx',
    });
    expect(a.soldAt.toISOString()).toBe('2026-08-18T06:46:40.000Z');
    expect(out[1].shopLabel).toBeNull(); // '-' -> null
    expect(out[1].saleChannel).toBe('CASH');
  });

  it('returns [] when no detail section present', () => {
    expect(parseSalesLineItems([['x'], ['y']], { importBatch: 'f' })).toEqual([]);
  });

  it('skips rows with empty barcode', () => {
    const rows = [['รายการขาย ( 1 )'], HEADER, ['', 'x', 'y'], ['']];
    expect(parseSalesLineItems(rows, { importBatch: 'f' })).toEqual([]);
  });
});
```

- [ ] **Step 2: รัน test ให้ FAIL**

Run: `cd apps/api && npx jest imported-sales/__tests__/tooltify-sales-parser --runInBand`
Expected: FAIL — "parseSalesLineItems is not a function".

- [ ] **Step 3: เขียน implementation**

```ts
// append to tooltify-sales-parser.ts
export interface ParsedSale {
  source: string;
  barcode: string;
  productName: string;
  category: string;
  buyerLabel: string;
  shopLabel: string | null;
  orderNumber: string;
  paymentType: string;
  priceGroup: string;
  saleChannel: string;
  costTotal: string;
  listPrice: string;
  salePrice: string;
  profit: string;
  salespersonName: string;
  soldAt: Date;
  importBatch: string;
}

const DETAIL_SECTION_PREFIX = 'รายการขาย (';

export function parseSalesLineItems(
  rows: string[][],
  opts: { importBatch: string },
): ParsedSale[] {
  const cell = (r: string[], i: number) => (r[i] ?? '').trim();

  // 1) locate the "รายการขาย ( N )" section title row
  const sectionIdx = rows.findIndex((r) => cell(r, 0).startsWith(DETAIL_SECTION_PREFIX));
  if (sectionIdx === -1) return [];

  // 2) header is the next non-empty row; data starts after it
  let headerIdx = sectionIdx + 1;
  while (headerIdx < rows.length && cell(rows[headerIdx], 0) === '') headerIdx++;
  const out: ParsedSale[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const barcode = cell(r, 0);
    if (barcode === '') break; // blank row terminates the table
    const shop = cell(r, 4);
    out.push({
      source: 'TOOLTIFY',
      barcode,
      productName: cell(r, 1),
      category: cell(r, 2),
      buyerLabel: cell(r, 3),
      shopLabel: shop === '' || shop === '-' ? null : shop,
      orderNumber: cell(r, 5),
      paymentType: normalizePayment(cell(r, 6)),
      priceGroup: cell(r, 7),
      saleChannel: deriveSaleChannel(cell(r, 7)),
      costTotal: cell(r, 8) || '0',
      listPrice: cell(r, 9) || '0',
      salePrice: cell(r, 10) || '0',
      profit: cell(r, 11) || '0',
      salespersonName: cell(r, 12),
      soldAt: parseThaiDateTime(cell(r, 13)),
      importBatch: opts.importBatch,
    });
  }
  return out;
}
```

- [ ] **Step 4: รัน test ให้ PASS**

Run: `cd apps/api && npx jest imported-sales/__tests__/tooltify-sales-parser --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/imported-sales/tooltify-sales-parser.ts apps/api/src/modules/imported-sales/__tests__/tooltify-sales-parser.spec.ts
git commit -m "feat(imported-sales): parse Tooltify sales detail table"
```

---

### Task 4: `readXlsxRows(path)` — thin xlsx loader (exceljs)

**Files:**
- Create: `apps/api/src/modules/imported-sales/xlsx-reader.ts`
- Test: `apps/api/src/modules/imported-sales/__tests__/xlsx-reader.spec.ts`

**Interfaces:**
- Produces: `readXlsxRows(path: string): Promise<string[][]>` — แถวแรกสุด→ท้าย, cell ว่าง = `''`, Date cell → ISO string.

- [ ] **Step 1: เขียน failing test (เขียน xlsx ชั่วคราวแล้วอ่านกลับ — ไม่ใช้ข้อมูลจริง)**

```ts
// __tests__/xlsx-reader.spec.ts
import * as ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readXlsxRows } from '../xlsx-reader';

async function writeTmpXlsx(rows: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Worksheet');
  rows.forEach((r) => ws.addRow(r));
  const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'xlsx-')), 't.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

describe('readXlsxRows', () => {
  it('returns rows as string matrix with empty cells as ""', async () => {
    const p = await writeTmpXlsx([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
    const rows = await readXlsxRows(p);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1][1]).toBe('');
    expect(rows[1][2]).toBe('3');
  });
});
```

- [ ] **Step 2: รัน test ให้ FAIL**

Run: `cd apps/api && npx jest imported-sales/__tests__/xlsx-reader --runInBand`
Expected: FAIL — "Cannot find module '../xlsx-reader'".

- [ ] **Step 3: เขียน implementation**

```ts
// xlsx-reader.ts
import * as ExcelJS from 'exceljs';

/**
 * อ่านชีตแรกของไฟล์ .xlsx เป็น matrix ของ string.
 * cell ว่าง = ''; Date cell → ISO string (ให้ parseThaiDateTime รับต่อได้).
 */
export async function readXlsxRows(filePath: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (v == null) cells.push('');
      else if (v instanceof Date) cells.push(v.toISOString());
      else if (typeof v === 'object' && 'text' in (v as object))
        cells.push(String((v as { text: unknown }).text)); // rich text
      else cells.push(String(v));
    });
    out.push(cells);
  });
  return out;
}
```

- [ ] **Step 4: รัน test ให้ PASS**

Run: `cd apps/api && npx jest imported-sales/__tests__/xlsx-reader --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/imported-sales/xlsx-reader.ts apps/api/src/modules/imported-sales/__tests__/xlsx-reader.spec.ts
git commit -m "feat(imported-sales): add thin xlsx row reader"
```

---

### Task 5: `ImportedSalesService` — list + summary (read-only)

**Files:**
- Create: `apps/api/src/modules/imported-sales/imported-sales.service.ts`
- Create: `apps/api/src/modules/imported-sales/dto/query-imported-sales.dto.ts`
- Test: `apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (จาก `../../prisma/prisma.service`) — mocked ในเทสต์.
- Produces:
  - `class QueryImportedSalesDto { startDate?, endDate?, saleChannel?, salespersonName?, category?, page=1, limit=50 }`
  - `ImportedSalesService.list(q): Promise<{ data; total; page; limit }>`
  - `ImportedSalesService.summary(q): Promise<{ totals; byMonth; byChannel; bySalesperson; byCategory }>` — ตัวเลขทั้งหมดเป็น string (Decimal.toString()).

- [ ] **Step 1: เขียน DTO**

```ts
// dto/query-imported-sales.dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsDateString, Max, Min } from 'class-validator';

export class QueryImportedSalesDto {
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() saleChannel?: string;
  @IsOptional() @IsString() salespersonName?: string;
  @IsOptional() @IsString() category?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit = 50;
}
```

- [ ] **Step 2: เขียน failing test (mock prisma)**

```ts
// __tests__/imported-sales.service.spec.ts
import { Prisma } from '@prisma/client';
import { ImportedSalesService } from '../imported-sales.service';
import { QueryImportedSalesDto } from '../dto/query-imported-sales.dto';

function mkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    soldAt: new Date('2026-08-18T06:46:40.000Z'),
    saleChannel: 'EXTERNAL_FINANCE',
    salespersonName: 'หมวย',
    category: 'iPhone มือ 2',
    salePrice: new Prisma.Decimal('40063'),
    profit: new Prisma.Decimal('2163'),
    costTotal: new Prisma.Decimal('37900'),
    ...over,
  };
}

describe('ImportedSalesService', () => {
  it('list() returns paginated shape with soldAt range where-clause', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: '1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
      importedSale: { findMany, count },
    } as never;
    const svc = new ImportedSalesService(prisma);
    const q = Object.assign(new QueryImportedSalesDto(), {
      page: 2, limit: 10, startDate: '2026-07-01', endDate: '2026-08-31', saleChannel: 'CASH',
    });
    const res = await svc.list(q);
    expect(res).toEqual({ data: [{ id: '1' }], total: 1, page: 2, limit: 10 });
    const arg = findMany.mock.calls[0][0];
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
    expect(arg.where.saleChannel).toBe('CASH');
    expect(arg.where.soldAt.gte).toBeInstanceOf(Date);
    expect(arg.where.soldAt.lte).toBeInstanceOf(Date);
  });

  it('summary() aggregates totals + groups in JS as strings', async () => {
    const rows = [
      mkRow(),
      mkRow({ saleChannel: 'CASH', category: 'Accessories', salePrice: new Prisma.Decimal('0'), profit: new Prisma.Decimal('-35') }),
    ];
    const prisma = { importedSale: { findMany: jest.fn().mockResolvedValue(rows) } } as never;
    const svc = new ImportedSalesService(prisma);
    const res = await svc.summary(new QueryImportedSalesDto());
    expect(res.totals).toEqual({ count: 2, sales: '40063', profit: '2128', cost: '75800' });
    expect(res.byChannel).toEqual(
      expect.arrayContaining([
        { key: 'EXTERNAL_FINANCE', count: 1, sales: '40063', profit: '2163' },
        { key: 'CASH', count: 1, sales: '0', profit: '-35' },
      ]),
    );
    expect(res.byMonth).toEqual([{ key: '2026-08', count: 2, sales: '40063', profit: '2128' }]);
  });
});
```

- [ ] **Step 3: รัน test ให้ FAIL**

Run: `cd apps/api && npx jest imported-sales/__tests__/imported-sales.service --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 4: เขียน implementation**

```ts
// imported-sales.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

interface Bucket { key: string; count: number; sales: string; profit: string }

@Injectable()
export class ImportedSalesService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(q: QueryImportedSalesDto): Prisma.ImportedSaleWhereInput {
    const where: Prisma.ImportedSaleWhereInput = {};
    if (q.saleChannel) where.saleChannel = q.saleChannel;
    if (q.category) where.category = q.category;
    if (q.salespersonName) where.salespersonName = { contains: q.salespersonName };
    if (q.startDate || q.endDate) {
      where.soldAt = {};
      if (q.startDate) where.soldAt.gte = new Date(q.startDate);
      if (q.endDate) where.soldAt.lte = new Date(q.endDate);
    }
    return where;
  }

  async list(q: QueryImportedSalesDto) {
    const where = this.buildWhere(q);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.importedSale.findMany({
        where,
        orderBy: { soldAt: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.importedSale.count({ where }),
    ]);
    return { data, total, page: q.page, limit: q.limit };
  }

  async summary(q: QueryImportedSalesDto) {
    const where = this.buildWhere(q);
    const rows = await this.prisma.importedSale.findMany({
      where,
      select: { soldAt: true, saleChannel: true, salespersonName: true, category: true, salePrice: true, profit: true, costTotal: true },
    });

    const bucket = (keyOf: (r: (typeof rows)[number]) => string): Bucket[] => {
      const m = new Map<string, { count: number; sales: Prisma.Decimal; profit: Prisma.Decimal }>();
      for (const r of rows) {
        const k = keyOf(r);
        const acc = m.get(k) ?? { count: 0, sales: new Prisma.Decimal(0), profit: new Prisma.Decimal(0) };
        acc.count += 1;
        acc.sales = acc.sales.plus(r.salePrice);
        acc.profit = acc.profit.plus(r.profit);
        m.set(k, acc);
      }
      return [...m.entries()].map(([key, v]) => ({ key, count: v.count, sales: v.sales.toString(), profit: v.profit.toString() }));
    };

    const totalSales = rows.reduce((a, r) => a.plus(r.salePrice), new Prisma.Decimal(0));
    const totalProfit = rows.reduce((a, r) => a.plus(r.profit), new Prisma.Decimal(0));
    const totalCost = rows.reduce((a, r) => a.plus(r.costTotal), new Prisma.Decimal(0));

    const monthKey = (r: (typeof rows)[number]) => {
      const d = r.soldAt;
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    return {
      totals: { count: rows.length, sales: totalSales.toString(), profit: totalProfit.toString(), cost: totalCost.toString() },
      byMonth: bucket(monthKey).sort((a, b) => a.key.localeCompare(b.key)),
      byChannel: bucket((r) => r.saleChannel),
      bySalesperson: bucket((r) => r.salespersonName),
      byCategory: bucket((r) => r.category),
    };
  }
}
```

> หมายเหตุ month key ใช้ UTC — เทสต์ golden `2026-08` ตรงเพราะ 06:46 UTC ยังเดือน 08. ถ้าต้องการ month ตามเวลาไทยเป๊ะ (edge เที่ยงคืน) เป็น enhancement ภายหลัง ไม่ blocking สำหรับสถิติ.

- [ ] **Step 5: รัน test ให้ PASS**

Run: `cd apps/api && npx jest imported-sales/__tests__/imported-sales.service --runInBand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/imported-sales/imported-sales.service.ts apps/api/src/modules/imported-sales/dto apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts
git commit -m "feat(imported-sales): list + summary service"
```

---

### Task 6: Controller + module + register in app

**Files:**
- Create: `apps/api/src/modules/imported-sales/imported-sales.controller.ts`
- Create: `apps/api/src/modules/imported-sales/imported-sales.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/imported-sales/__tests__/imported-sales.service.spec.ts` (เพิ่ม controller wiring test)

**Interfaces:**
- Consumes: `ImportedSalesService` (Task 5), `JwtAuthGuard`/`RolesGuard`/`@Roles` (จาก `../auth/...` ตาม pattern โมดูลอื่น เช่น `sales`).
- Produces: `GET /imported-sales`, `GET /imported-sales/summary`.

- [ ] **Step 1: อ่าน pattern controller ที่มีอยู่**

Run: `sed -n '1,40p' apps/api/src/modules/sales/sales.controller.ts`
Expected: เห็น import path จริงของ `JwtAuthGuard`, `RolesGuard`, `Roles`, `PrismaModule` — ใช้ path เดียวกันใน task นี้ (อย่าเดา path).

- [ ] **Step 2: เขียน controller**

```ts
// imported-sales.controller.ts  (ปรับ import guard/roles ให้ตรงกับที่เห็นใน Step 1)
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../decorators/roles.decorator';
import { ImportedSalesService } from './imported-sales.service';
import { QueryImportedSalesDto } from './dto/query-imported-sales.dto';

@Controller('imported-sales')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportedSalesController {
  constructor(private readonly service: ImportedSalesService) {}

  @Get()
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  list(@Query() query: QueryImportedSalesDto) {
    return this.service.list(query);
  }

  @Get('summary')
  @Roles('OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER')
  summary(@Query() query: QueryImportedSalesDto) {
    return this.service.summary(query);
  }
}
```

- [ ] **Step 3: เขียน module**

```ts
// imported-sales.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ImportedSalesController } from './imported-sales.controller';
import { ImportedSalesService } from './imported-sales.service';

@Module({
  imports: [PrismaModule],
  controllers: [ImportedSalesController],
  providers: [ImportedSalesService],
})
export class ImportedSalesModule {}
```

- [ ] **Step 4: register ใน `app.module.ts`**

เพิ่ม `import { ImportedSalesModule } from './modules/imported-sales/imported-sales.module';` และใส่ `ImportedSalesModule` ในอาเรย์ `imports` ของ `@Module`.

- [ ] **Step 5: type check + รันเทสต์โมดูลทั้งหมด**

Run: `./tools/check-types.sh api && cd apps/api && npx jest imported-sales --runInBand`
Expected: 0 type errors; เทสต์ parser+xlsx+service ผ่านทั้งหมด.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/imported-sales/imported-sales.controller.ts apps/api/src/modules/imported-sales/imported-sales.module.ts apps/api/src/app.module.ts
git commit -m "feat(imported-sales): controller + module registration"
```

---

### Task 7: CLI `import:tooltify` (Flow B) — guards + dry-run + insert

**Files:**
- Create: `apps/api/src/cli/import-tooltify.cli.ts`
- Modify: `apps/api/package.json` (scripts `import:tooltify`, `import:tooltify:help`)

**Interfaces:**
- Consumes: `readXlsxRows` (Task 4), `parseSalesLineItems` (Task 3), `PrismaClient`.
- Produces: CLI ที่ (dry-run default) parse ไฟล์ `<DIR>/ขาย/*.xlsx` → พิมพ์สรุปนับ + reconcile; เมื่อ `CONFIRM_IMPORT` → `createMany({ skipDuplicates: true })` ลง `imported_sales`.

- [ ] **Step 1: อ่าน guard pattern จาก CLI เดิม**

Run: `sed -n '1,60p' apps/api/src/cli/backfill-payment-receipts.cli.ts`
Expected: เห็น pattern จริงของ `CONFIRM_*`, `EXPECTED_DB_NAME` (เทียบ `current_database()`), `ALLOW_PROD_*`, dry-run default — เลียนแบบให้ตรง (อย่าเดา).

- [ ] **Step 2: เขียน CLI**

```ts
// import-tooltify.cli.ts
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { readXlsxRows } from '../modules/imported-sales/xlsx-reader';
import { parseSalesLineItems, ParsedSale } from '../modules/imported-sales/tooltify-sales-parser';

async function assertDb(prisma: PrismaClient) {
  const expected = process.env.EXPECTED_DB_NAME;
  if (!expected) throw new Error('EXPECTED_DB_NAME is required');
  const [{ current_database: actual }] =
    await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actual !== expected) throw new Error(`DB mismatch: connected=${actual} expected=${expected}`);
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_IMPORT !== 'YES_I_AM_SURE') {
    throw new Error('Refusing prod import without ALLOW_PROD_IMPORT=YES_I_AM_SURE');
  }
}

async function main() {
  const dir = process.env.TOOLTIFY_IMPORT_DIR;
  if (!dir) throw new Error('TOOLTIFY_IMPORT_DIR is required (folder containing ขาย/*.xlsx)');
  const write = process.env.CONFIRM_IMPORT === 'YES_I_AM_SURE';
  const prisma = new PrismaClient();
  try {
    await assertDb(prisma);
    const salesDir = path.join(dir, 'ขาย');
    const files = (await fs.readdir(salesDir)).filter((f) => f.endsWith('.xlsx'));
    let all: ParsedSale[] = [];
    for (const f of files) {
      const rows = await readXlsxRows(path.join(salesDir, f));
      const parsed = parseSalesLineItems(rows, { importBatch: f });
      console.log(`  ${f}: ${parsed.length} line items`);
      all = all.concat(parsed);
    }
    // reconcile summary
    const byChannel = all.reduce<Record<string, number>>((m, r) => {
      m[r.saleChannel] = (m[r.saleChannel] ?? 0) + 1;
      return m;
    }, {});
    console.log(`TOTAL line items: ${all.length}`);
    console.log('by channel:', byChannel);

    if (!write) {
      console.log('\n[DRY_RUN] set CONFIRM_IMPORT=YES_I_AM_SURE to write.');
      return;
    }
    const res = await prisma.importedSale.createMany({
      data: all.map((r) => ({ ...r })),
      skipDuplicates: true,
    });
    console.log(`\nINSERTED ${res.count} rows (skipDuplicates on @@unique).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: เพิ่ม scripts ใน `apps/api/package.json`**

```json
"import:tooltify": "node dist/src/cli/import-tooltify.cli.js",
"import:tooltify:help": "echo 'Dry-run default: TOOLTIFY_IMPORT_DIR=<folder> EXPECTED_DB_NAME=<db> npm --prefix apps/api run import:tooltify. To write: CONFIRM_IMPORT=YES_I_AM_SURE [ALLOW_PROD_IMPORT=YES_I_AM_SURE NODE_ENV=production] ...'"
```

- [ ] **Step 4: build + dry-run ทดสอบกับไฟล์จริงบน dev DB**

Run:
```bash
cd apps/api && npm run build
TOOLTIFY_IMPORT_DIR="/Users/iamnaii/Desktop/นำเข้าประวัติสต๊อคและยอดขายของ BESTCHOICE" \
EXPECTED_DB_NAME=<dev-db> npm --prefix apps/api run import:tooltify
```
Expected: พิมพ์จำนวน line items ต่อไฟล์ (Q1≈1257, Q2≈1372, Q3≈783) + by channel (CASH/INSTALLMENT/EXTERNAL_FINANCE/OTHER) + `[DRY_RUN]`. ยังไม่เขียน DB.

- [ ] **Step 5: เขียนจริงลง dev DB แล้ว verify**

Run:
```bash
CONFIRM_IMPORT=YES_I_AM_SURE TOOLTIFY_IMPORT_DIR="...same..." EXPECTED_DB_NAME=<dev-db> npm --prefix apps/api run import:tooltify
```
Expected: `INSERTED N rows`. ตรวจ: `SELECT count(*), sale_channel FROM imported_sales GROUP BY 2;` + รันซ้ำได้ `INSERTED 0` (idempotent ผ่าน @@unique).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/cli/import-tooltify.cli.ts apps/api/package.json
git commit -m "feat(imported-sales): import:tooltify CLI (Flow B) with dry-run + db guards"
```

---

### Task 8: หน้า `ImportedSalesPage` + route + เมนู

**Files:**
- Create: `apps/web/src/pages/ImportedSalesPage.tsx`
- Modify: `apps/web/src/App.tsx` (route `/imported-sales`, lazy)
- Modify: ไฟล์เมนู (`apps/web/src/config/menu.ts` หรือที่ใช้จริง)
- Modify: `apps/web/package.json` (bump version)

**Interfaces:**
- Consumes: `GET /imported-sales`, `GET /imported-sales/summary` (Task 6); `api` จาก `@/lib/api`.

- [ ] **Step 1: อ่าน `SalesHistoryPage.tsx` เป็น reference (filter + table + useQuery)**

Run: `sed -n '1,60p' apps/web/src/pages/SalesHistoryPage.tsx`
Expected: เห็นโครง `useQuery`, `buildParams`, layout tokens — ทำตามแนวเดียวกัน.

- [ ] **Step 2: เขียนหน้า (skeleton ใช้งานได้จริง — summary cards + ตาราง + filter ช่วงวัน/ช่องทาง)**

```tsx
// ImportedSalesPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Bucket { key: string; count: number; sales: string; profit: string }
interface Summary {
  totals: { count: number; sales: string; profit: string; cost: string };
  byMonth: Bucket[]; byChannel: Bucket[]; bySalesperson: Bucket[]; byCategory: Bucket[];
}
interface Row {
  id: string; barcode: string; productName: string; category: string;
  saleChannel: string; salePrice: string; profit: string; salespersonName: string; soldAt: string;
}
interface ListResp { data: Row[]; total: number; page: number; limit: number }

const baht = (s: string) => Number(s).toLocaleString('th-TH', { maximumFractionDigits: 0 });

export default function ImportedSalesPage() {
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const params = () => {
    const p = new URLSearchParams({ page: String(page), limit: '50' });
    if (channel) p.set('saleChannel', channel);
    return p.toString();
  };

  const { data: summary } = useQuery<Summary>({
    queryKey: ['imported-sales-summary', channel],
    queryFn: async () => (await api.get(`/imported-sales/summary?${channel ? `saleChannel=${channel}` : ''}`)).data,
  });
  const { data: list } = useQuery<ListResp>({
    queryKey: ['imported-sales', channel, page],
    queryFn: async () => (await api.get(`/imported-sales?${params()}`)).data,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">ยอดขายย้อนหลัง (นำเข้าจาก Tooltify)</h1>
        <p className="text-muted-foreground text-sm">สถิติดูอย่างเดียว — ไม่กระทบบัญชี/คอมมิชชั่น</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: 'จำนวนบิล/รายการ', v: summary.totals.count.toLocaleString('th-TH') },
            { l: 'ยอดขายรวม', v: `฿${baht(summary.totals.sales)}` },
            { l: 'กำไรรวม', v: `฿${baht(summary.totals.profit)}` },
            { l: 'ต้นทุนรวม', v: `฿${baht(summary.totals.cost)}` },
          ].map((s) => (
            <div key={s.l} className="rounded-lg border border-border bg-card p-4">
              <div className="text-2xl font-semibold text-foreground">{s.v}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          className="border border-border bg-background rounded-md px-3 py-2 text-sm"
          value={channel}
          onChange={(e) => { setChannel(e.target.value); setPage(1); }}
        >
          <option value="">ทุกช่องทาง</option>
          <option value="CASH">เงินสด (ราคาปลีก)</option>
          <option value="INSTALLMENT">BESTCHOICE ไฟแนนซ์ (ราคา 2)</option>
          <option value="EXTERNAL_FINANCE">GFIN (ราคา 3)</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {['บาร์โค้ด/IMEI', 'สินค้า', 'หมวด', 'ช่องทาง', 'ราคาขาย', 'กำไร', 'คนขาย', 'วันที่'].map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.data.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{r.barcode}</td>
                <td className="px-3 py-2">{r.productName}</td>
                <td className="px-3 py-2">{r.category}</td>
                <td className="px-3 py-2">{r.saleChannel}</td>
                <td className="px-3 py-2 tabular-nums">฿{baht(r.salePrice)}</td>
                <td className="px-3 py-2 tabular-nums">฿{baht(r.profit)}</td>
                <td className="px-3 py-2">{r.salespersonName}</td>
                <td className="px-3 py-2">{new Date(r.soldAt).toLocaleDateString('th-TH')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list && (
        <div className="flex items-center gap-3 text-sm">
          <button className="px-3 py-1 rounded border border-border disabled:opacity-50"
            disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</button>
          <span className="text-muted-foreground">หน้า {list.page} · ทั้งหมด {list.total.toLocaleString('th-TH')} รายการ</span>
          <button className="px-3 py-1 rounded border border-border disabled:opacity-50"
            disabled={page * list.limit >= list.total} onClick={() => setPage((p) => p + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: เพิ่ม route ใน `App.tsx`**

เพิ่ม lazy import + route ภายใต้ `ProtectedRoute`/`MainLayout` เหมือนหน้าอื่น:
```tsx
const ImportedSalesPage = lazy(() => import('./pages/ImportedSalesPage'));
// ...
<Route path="/imported-sales" element={<ImportedSalesPage />} />
```

- [ ] **Step 4: เพิ่มเมนู (OWNER/ACCOUNTANT)**

หา config เมนูจริง (`grep -rn "SalesHistory\|/sales" apps/web/src/config`) แล้วเพิ่มรายการ `{ label: 'ยอดขายย้อนหลัง (Tooltify)', path: '/imported-sales', roles: ['OWNER','ACCOUNTANT','FINANCE_MANAGER'] }` ในโซนที่เหมาะสม (กลุ่มรายงาน/ยอดขาย).

- [ ] **Step 5: type check web + bump version**

Run: `./tools/check-types.sh web`
Expected: 0 errors. แก้ `apps/web/package.json` `"version"` เป็น `YY.M.ลำดับ` ถัดไป.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ImportedSalesPage.tsx apps/web/src/App.tsx apps/web/src/config apps/web/package.json
git commit -m "feat(imported-sales): dashboard page + route + menu"
```

---

## Self-Review

**1. Spec coverage (Flow B):**
- §7.1 model `ImportedSale` → Task 1 ✓ (ชื่อ neutral + `source` + `@@unique` idempotency + immutable comment)
- §7.2 endpoints `GET /imported-sales` + `/summary` + page + roles → Task 5/6/8 ✓
- §5 / §5.1 mapping (channel/payment/date; category text) → Task 2/3 ✓ (brand/model = Flow A เท่านั้น, ไม่อยู่ใน plan นี้)
- §8 CLI (bootstrap Prisma ตรง, guards, dry-run, idempotent) → Task 7 ✓
- §8 validate-in-parser → parser คืน string ตามไฟล์; validation เชิงลึก (ราคา≥0/IMEI) เป็นของ **Flow A (Product)**; Flow B เก็บ raw stats จึงไม่ block — สอดคล้อง non-goal.
- §11 runbook prod (dry-run→prod-copy→prod) → Task 7 Step 4-5 ครอบ dev; prod รันหลัง review ตาม runbook (ไม่อยู่ใน task อัตโนมัติ — ต้องมีคนกด, เจตนา)
- **นอกสโคป plan นี้ (Flow A):** Product IN_STOCK, brand/model parser (§5.1), reverse hard-delete (§6.3), accessory qty — อยู่ plan ถัดไป (รอไฟล์สต๊อกคงเหลือ).

**2. Placeholder scan:** ไม่มี TBD/TODO; ทุก step มีโค้ด/คำสั่งจริง. Path guard/roles ใน Task 6/7 สั่งให้ "อ่าน pattern จริงก่อน" (Step 1) แทนการเดา import path — เจตนา เพราะ path อาจต่างจากที่จำ.

**3. Type consistency:** `ParsedSale` (Task 3) ตรงกับ field ที่ CLI ใส่ `createMany` (Task 7) และ field ของ model (Task 1). `Bucket`/`Summary`/`ListResp` (Task 8) ตรงกับ service return (Task 5: `{key,count,sales,profit}` + `totals{count,sales,profit,cost}`). ✓

**เปิดค้าง (ตั้งใจ):** import path ของ guard/roles/PrismaModule ให้ executor ยืนยันจากโค้ดจริงใน Task 6 Step 1 (โมดูล `sales` เป็น reference) — กันเดา path ผิด.
