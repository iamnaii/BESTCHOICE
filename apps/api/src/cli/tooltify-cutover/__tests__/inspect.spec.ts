import ExcelJS from 'exceljs';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspectFiles } from '../inspect';
import { hashSourceDecisions, validateManifest } from '../canonicalize';
import type { InputManifest, InspectionReport, SourceDecisions } from '../types';

const SALES_COLUMNS = [
  'บาร์โค้ดสินค้า',
  'ชื่อสินค้า',
  'หมวดหมู่สินค้า',
  'ผู้ซื้อสินค้า',
  'ร้านค้า',
  'คำสั่งซื้อ',
  'รูปแบบการขาย',
  'กลุ่มราคาขาย',
  'ต้นทุนรวม',
  'ราคาตั้งขาย',
  'ราคาขาย',
  'กำไร',
  'ผู้ขายสินค้า',
  'วันที่ขายสินค้า',
];
const STOCK_COLUMNS = [
  'บาร์โค้ดสินค้า',
  'ชื่อสินค้า',
  'หมวดหมู่สินค้า',
  'แหล่งที่มา',
  'รายละเอียดสินค้า',
  'เช็คสต๊อก',
  'วันที่นำเข้า',
  'ผู้นำเข้า',
  'ต้นทุนสินค้า',
  'No.',
];
const SALE_NAME = 'report_export_stock_2026-11-18_to_2026-11-30_export.xlsx';
const PRIVATE_VALUES = [
  'fixture-buyer',
  'fixture-seller',
  'fixture-bill',
  'fixture-store',
  'fixture-barcode',
  'fixture-name',
];

function saleRow(day = '2026-11-18', bill = 'fixture-bill'): (string | number)[] {
  return [
    'fixture-barcode',
    'fixture-name',
    'Accessories',
    'fixture-buyer',
    'fixture-store',
    bill,
    'ขายแบบเงินสด',
    'ราคาปลีก',
    0,
    10,
    10,
    10,
    'fixture-seller',
    day + ' 16:36:21',
  ];
}

describe('Tooltify source inspection', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tooltify-cutover-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeWorkbook(name: string, rows: (string | number)[][]): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('fixture-worksheet');
    for (const row of rows) worksheet.addRow(row);
    const path = join(dir, name);
    await workbook.xlsx.writeFile(path);
    return path;
  }

  async function writeSales(name = SALE_NAME, rows = [saleRow()]): Promise<string> {
    return writeWorkbook(name, [['รายการขาย ( ' + rows.length + ' )'], SALES_COLUMNS, ...rows]);
  }

  it('counts byte-identical renamed copies once and retains both basenames', async () => {
    const original = await writeSales();
    const copy = join(dir, 'renamed-copy.xlsx');
    await copyFile(original, copy);

    const report = await inspectFiles([original, copy]);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({
      fileNames: [SALE_NAME, 'renamed-copy.xlsx'],
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceRowCount: 1,
    });
    expect(report.duplicateRows).toEqual([]);
  });

  it('reports the filename date range separately from the observed sales dates', async () => {
    const report = await inspectFiles([await writeSales()]);
    expect(report.files[0]).toMatchObject({
      declaredRange: { start: '2026-11-18', end: '2026-11-30' },
      actualRange: { start: '2026-11-18T16:36:21+07:00', end: '2026-11-18T16:36:21+07:00' },
      sections: [expect.objectContaining({ label: 'รายการขาย', headerRow: 2, sourceRowCount: 1 })],
    });
  });

  it('keeps stock snapshots separate and reports repeated IMEI rows as references', async () => {
    const stockRow = [
      '123456789012345',
      'fixture-name',
      'iPhone มือ 1',
      'fixture-store',
      '',
      0,
      '2026-11-17 10:00:00',
      'fixture-seller',
      8000,
      1,
    ];
    const first = await writeWorkbook('report_stock_2026-11-18_first.xlsx', [
      STOCK_COLUMNS,
      stockRow,
    ]);
    const second = await writeWorkbook('report_stock_2026-11-19_second.xlsx', [
      STOCK_COLUMNS,
      [...stockRow.slice(0, 8), 8100, 1],
    ]);
    const report = await inspectFiles([first, second]);

    expect(report.files.map((file) => [file.declaredRange?.start, file.sourceRowCount])).toEqual([
      ['2026-11-18', 1],
      ['2026-11-19', 1],
    ]);
    expect(report.duplicateRows).toEqual([
      expect.objectContaining({
        kind: 'STOCK_IMEI',
        rows: [
          expect.objectContaining({ fileSha256: report.files[0].sha256, row: 2 }),
          expect.objectContaining({ fileSha256: report.files[1].sha256, row: 2 }),
        ],
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain(stockRow[0]);
  });

  it('reports an identical sales line pair without exposing cell values', async () => {
    const report = await inspectFiles([await writeSales(SALE_NAME, [saleRow(), saleRow()])]);
    expect(report.duplicateRows).toEqual([
      expect.objectContaining({
        kind: 'SALE_LINE_KEY',
        identical: true,
        rows: [
          expect.objectContaining({ fileSha256: report.files[0].sha256, row: 3 }),
          expect.objectContaining({ fileSha256: report.files[0].sha256, row: 4 }),
        ],
      }),
    ]);
    for (const value of PRIVATE_VALUES) expect(JSON.stringify(report)).not.toContain(value);
  });

  function salesManifest(
    paths: string[],
    report: InspectionReport,
  ): {
    manifest: InputManifest;
    decisions: SourceDecisions;
  } {
    const decisions: SourceDecisions = {
      entries: report.files.map((file) => ({
        action: 'SELECT_SALES',
        fileSha256: file.sha256,
        sourceRows: [3],
        storeKey: 'fixture-shop',
        branchId: 'fixture-branch',
        reportFrom: '2026-11-18',
        reportTo: '2026-11-18',
        reason: 'Synthetic decision for the fixture sale',
        evidenceRef: 'fixture-record/verified-export',
      })),
    };
    return {
      decisions,
      manifest: {
        version: 1,
        companyCode: 'SHOP',
        cutoverAt: '2026-11-18T18:00:00+07:00',
        canonicalSetId: 'synthetic-set',
        decisionsSha256: hashSourceDecisions(decisions),
        files: report.files.map((file, index) => ({
          path: paths[index],
          sha256: file.sha256,
          kind: 'SALES',
          storeKey: 'fixture-shop',
          branchId: 'fixture-branch',
          reportFrom: file.declaredRange!.start,
          reportTo: file.declaredRange!.end,
        })),
        history: [
          {
            branchId: 'fixture-branch',
            reportFrom: '2026-11-18',
            reportTo: '2026-11-18',
            evidenceRef: 'fixture-record/history-scope',
          },
        ],
      },
    };
  }

  it('accepts an exact, evidenced selection of sales rows and history coverage', async () => {
    const source = await writeSales();
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('covers one originating store across blank and finance shop labels', async () => {
    const blankLabel = saleRow('2026-11-18', 'first-fixture-bill');
    blankLabel[4] = '-';
    const financeLabel = saleRow('2026-11-19', 'second-fixture-bill');
    financeLabel[4] = 'GFIN';
    const source = await writeSales(SALE_NAME, [blankLabel, financeLabel]);
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    manifest.cutoverAt = '2026-11-19T18:00:00+07:00';
    manifest.history![0].reportTo = '2026-11-19';
    const selection = decisions.entries[0];
    if (selection.action !== 'SELECT_SALES') throw new Error('Expected a sales selection');
    selection.sourceRows = [3, 4];
    selection.reportTo = '2026-11-19';
    manifest.decisionsSha256 = hashSourceDecisions(decisions);

    expect(report.files[0]).toMatchObject({
      shopLabelMeaning: 'UNRESOLVED',
      shopLabelGroups: [
        { key: 'row-3', rowCount: 1, missingLabel: true },
        { key: 'row-4', rowCount: 1, missingLabel: false },
      ],
    });
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('rejects selected overlapping sales windows for the same branch', async () => {
    const first = await writeSales();
    const second = await writeSales('report_export_stock_2026-11-17_to_2026-11-18_second.xlsx', [
      saleRow('2026-11-18', 'another-fixture-bill'),
    ]);
    const report = await inspectFiles([first, second]);
    const { manifest, decisions } = salesManifest([first, second], report);

    expect(report.salesOverlaps).toEqual([
      expect.objectContaining({ declaredRange: { start: '2026-11-18', end: '2026-11-18' } }),
    ]);
    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'SALES_OVERLAP' }),
    );
    decisions.entries[1] = {
      action: 'EXCLUDE_FILE',
      fileSha256: report.files[1].sha256,
      sourceRows: [3],
      reason: 'Synthetic canonical selection excludes the overlapping export',
      evidenceRef: 'fixture-record/verified-export',
    };
    manifest.decisionsSha256 = hashSourceDecisions(decisions);
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('rejects decisions for changed files', async () => {
    const source = await writeSales();
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    await writeSales(SALE_NAME, [saleRow('2026-11-18', 'changed-fixture-bill')]);

    const changedInspection = await inspectFiles([source]);
    expect(validateManifest(manifest, changedInspection, decisions)).toContainEqual(
      expect.objectContaining({ code: 'FILE_HASH_MISMATCH' }),
    );
  });

  it('rejects an unobserved history day without evidence of zero sales', async () => {
    const source = await writeSales();
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    manifest.cutoverAt = '2026-11-19T18:00:00+07:00';
    manifest.history![0].reportTo = '2026-11-19';

    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'UNPROVEN_SALES_COVERAGE' }),
    );
    decisions.entries.push({
      action: 'ZERO_SALES',
      fileSha256: report.files[0].sha256,
      sourceRows: [],
      branchId: 'fixture-branch',
      reportFrom: '2026-11-19',
      reportTo: '2026-11-19',
      reason: 'Synthetic zero day checked against the fixture day report',
      evidenceRef: 'fixture-record/verified-zero-day',
    });
    manifest.decisionsSha256 = hashSourceDecisions(decisions);
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('blocks reported return events until they can be reconciled to original bills', async () => {
    const source = await writeWorkbook(SALE_NAME, [
      ['รายการคืนสินค้า ( 1 )'],
      ['คำสั่งซื้อ', 'ชื่อสินค้า'],
      ['fixture-bill', 'fixture-name'],
      [],
      ['รายการขาย ( 1 )'],
      SALES_COLUMNS,
      saleRow(),
    ]);
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    const selection = decisions.entries[0];
    if (selection.action !== 'SELECT_SALES') throw new Error('Expected a sales selection');
    selection.sourceRows = [7];
    manifest.decisionsSha256 = hashSourceDecisions(decisions);

    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'UNRECONCILED_SALE_EVENTS' }),
    );
  });

  it('requires bill evidence before a selected pair of identical sales rows can be reduced', async () => {
    const source = await writeSales(SALE_NAME, [saleRow(), saleRow()]);
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);
    decisions.entries[0].sourceRows = [3, 4];
    const evidence = {
      fileSha256: report.files[0].sha256,
      reason: 'Fixture evidence concerning the duplicate lines',
      evidenceRef: 'fixture-record/bill-quantity',
    };
    decisions.entries.push({ action: 'EXCLUDE_ROW', sourceRows: [4], ...evidence });
    manifest.decisionsSha256 = hashSourceDecisions(decisions);

    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'UNRESOLVED_SALES_DUPLICATE' }),
    );
    decisions.entries[1] = {
      action: 'REPORT_DUPLICATE',
      keepRow: 3,
      sourceRows: [3, 4],
      ...evidence,
    };
    manifest.decisionsSha256 = hashSourceDecisions(decisions);
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('reads section headers from merged Tooltify title rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Worksheet');
    worksheet.mergeCells('A1:N1');
    worksheet.getCell('A1').value = 'รายการขาย ( 1 )';
    worksheet.addRow(SALES_COLUMNS);
    worksheet.addRow(saleRow());
    const source = join(dir, SALE_NAME);
    await workbook.xlsx.writeFile(source);

    const report = await inspectFiles([source]);
    expect(report.files[0]).toMatchObject({ kind: 'SALES', sourceRowCount: 1, issues: [] });
  });

  it('writes private JSON and CSV through the CLI without a database', async () => {
    const source = await writeSales();
    const output = join(dir, 'private-output');
    const cli = resolve(__dirname, '../../tooltify-cutover.cli.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', cli, 'inspect', '--out-dir', output, source],
      { env: { ...process.env, DATABASE_URL: 'postgresql://invalid/database' }, encoding: 'utf8' },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    for (const name of ['inspection.json', 'inspection.csv']) {
      const path = join(output, name);
      const data = await readFile(path, 'utf8');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(data).toContain(SALE_NAME);
      expect(data).toContain('2026-11-18T16:36:21+07:00');
      for (const value of PRIVATE_VALUES) expect(data + result.stdout).not.toContain(value);
    }
  });
});
