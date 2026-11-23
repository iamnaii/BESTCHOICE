import { parseSalesReport } from '../../../modules/imported-sales/tooltify-sales-parser';
import { SALES_COLUMNS } from '../../../modules/imported-sales/tooltify-report-layout';
import type { FileRef, SourceDecision } from '../types';
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hashSourceDecisions } from '../canonicalize';
import { loadSourceInputs } from '../source-input';
import { buildReconciliationSnapshot } from '../reconciliation-snapshot';

const file: FileRef = {
  path: 'fixture.xlsx',
  sha256: 'a'.repeat(64),
  kind: 'SALES',
  storeKey: 'STORE',
  branchId: 'branch',
  reportFrom: '2026-11-01',
  reportTo: '2026-11-22',
};
function fixture() {
  const rows = [
    ['รูปแบบการขาย', 'คำสั่งซื้อ', 'รายการขาย', 'ต้นทุนรวม', 'ราคาตั้งขาย', 'ราคาขาย', 'กำไร'],
    ['ขายสินค้าทั้งหมด', '3', '2', '300', '500', '500', '200'],
    ['ขายแบบเงินสด ( 3 )'],
    [
      'ขายให้กับ',
      'ร้านค้า',
      'คำสั่งซื้อ',
      'กลุ่มราคาขาย',
      'รายการขาย',
      'ต้นทุนรวม',
      'ราคาตั้งขาย',
      'ราคาขาย',
      'กำไร',
      'ผู้ขายสินค้า',
      'วันที่ขายสินค้า',
    ],
    ['buyer', 'shop', '9', 'ราคาปลีก', '0', '0', '0', '0', '0', 'staff', '2026-11-01 09:00:00'],
    [
      'buyer',
      'shop',
      '10',
      'ราคาปลีก',
      '1',
      '100',
      '200',
      '200',
      '100',
      'staff',
      '2026-11-01 10:00:00',
    ],
    [
      'buyer',
      'shop',
      '10',
      'ราคาปลีก',
      '1',
      '200',
      '300',
      '300',
      '100',
      'staff',
      '2026-11-01 11:00:00',
    ],
    ['รายการขาย ( 2 )'],
    SALES_COLUMNS,
    [
      'SKU1',
      'item',
      'Accessories',
      'buyer',
      'shop',
      '10',
      'ขายแบบเงินสด',
      'ราคาปลีก',
      '100',
      '200',
      '200',
      '100',
      'staff',
      '2026-11-01 10:00:00',
    ],
    [
      'SKU2',
      'item',
      'Accessories',
      'buyer',
      'shop',
      '10',
      'ขายแบบเงินสด',
      'ราคาปลีก',
      '200',
      '300',
      '300',
      '100',
      'staff',
      '2026-11-01 11:00:00',
    ],
  ];
  const decision = {
    action: 'RECONCILE_BILL_COUNT',
    fileSha256: file.sha256,
    sourceRows: [5, 6, 7],
    reason: 'Reviewed zero-line bill and reused bill number',
    evidenceRef: 'synthetic',
    reportedBills: 3,
    distinctDetailBills: 1,
    zeroLineHeaderRows: [5],
    repeatedEventHeaderRows: [6, 7],
  } as unknown as SourceDecision;
  return { rows, decision };
}
const parse = (rows: string[][], decisions: SourceDecision[] = []) =>
  parseSalesReport(rows, { file, sheet: 'Worksheet', decisions });
it('reconciles only proven zero-line and repeated-number bill headers, preserving every sale and the original count evidence', () => {
  const { rows, decision } = fixture();
  expect(parse(rows).issues.map((i) => i.code)).toContain('SALES_SUMMARY_MISMATCH');
  const result = parse(rows, [decision]);
  expect(result.issues).toEqual([]);
  expect(result.rows).toHaveLength(2);
  expect(result.gross.detail?.bills).toBe(1);
  expect(result.gross.reported?.bills).toBe(1);
  expect(result.gross.delta?.bills).toBe(0);
  expect((result.gross as unknown as { billCountBridge: unknown }).billCountBridge).toMatchObject({
    fileSha256: file.sha256,
    reportedBills: 3,
    distinctDetailBills: 1,
    zeroLineHeaderRows: [5],
    repeatedEventHeaderRows: [6, 7],
  });
});
it('carries verified original counts through workbook loading into immutable reconciliation provenance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bill-count-proof-'));
  try {
    const { rows, decision } = fixture();
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Worksheet');
    rows.forEach((r) => sheet.addRow(r));
    const path = join(dir, 'report_export_stock_2026-11-01_to_2026-11-01_fixture.xlsx');
    await wb.xlsx.writeFile(path);
    const sha256 = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const reference = { ...file, path, sha256, reportTo: '2026-11-01' };
    const entries: SourceDecision[] = [
      { ...decision, fileSha256: sha256 },
      {
        action: 'SELECT_SALES',
        fileSha256: sha256,
        sourceRows: [10, 11],
        storeKey: file.storeKey,
        branchId: file.branchId!,
        reportFrom: '2026-11-01',
        reportTo: '2026-11-01',
        reason: 'fixture',
        evidenceRef: 'fixture',
      },
    ];
    const decisions = { entries };
    await writeFile(join(dir, 'decisions.json'), JSON.stringify(decisions));
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        cutoverAt: '2026-11-01T12:00:00+07:00',
        companyCode: 'SHOP',
        canonicalSetId: 'synthetic',
        files: [reference],
        decisionsSha256: hashSourceDecisions(decisions),
        history: [
          {
            branchId: file.branchId,
            reportFrom: '2026-11-01',
            reportTo: '2026-11-01',
            evidenceRef: 'fixture',
          },
        ],
      }),
    );
    const [input] = await loadSourceInputs(
      join(dir, 'manifest.json'),
      join(dir, 'decisions.json'),
      'fixture',
      'fixture',
    );
    expect(input.issues).toEqual([]);
    const snapshot = buildReconciliationSnapshot(input, []);
    expect(snapshot.source).toMatchObject({
      kind: 'SALES',
      billCountBridges: [{ fileSha256: sha256, reportedBills: 3, distinctDetailBills: 1 }],
    });
    expect(snapshot.cannotVerifySource).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each([
  'nonzero-empty',
  'wrong-quantity',
  'wrong-event-time',
  'missing-event',
  'foreign-sha',
  'wrong-reported',
  'money-mismatch',
])('does not bypass source checks with %s evidence', (kind) => {
  const { rows, decision } = fixture();
  const d = decision as unknown as Record<string, unknown>;
  if (kind === 'nonzero-empty') rows[4][5] = '1';
  if (kind === 'wrong-quantity') rows[5][4] = '2';
  if (kind === 'wrong-event-time') rows[5][10] = '2026-11-01 12:00:00';
  if (kind === 'missing-event') {
    d.sourceRows = [5, 6];
    d.repeatedEventHeaderRows = [6];
  }
  if (kind === 'foreign-sha') d.fileSha256 = 'b'.repeat(64);
  if (kind === 'wrong-reported') d.reportedBills = 4;
  if (kind === 'money-mismatch') rows[1][5] = '500.01';
  const result = parse(rows, [decision]);
  expect(result.issues.map((i) => i.code)).toContain('SALES_SUMMARY_MISMATCH');
  expect(result.gross.reported?.bills).toBe(3);
});
