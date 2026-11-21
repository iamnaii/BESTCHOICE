import ExcelJS from 'exceljs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
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

  it('counts byte-identical renamed copies once and retains both opaque aliases', async () => {
    const original = await writeSales();
    const copy = join(dir, 'renamed-copy.xlsx');
    await copyFile(original, copy);

    const report = await inspectFiles([original, copy]);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({
      inputs: [{ alias: 'input-1' }, { alias: 'input-2' }],
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

  it('recognizes a stock snapshot when the barcode column moves', async () => {
    const stockRow = [
      '012345678901234',
      'fixture-name',
      'iPhone มือ 2 (เครื่องนอก)',
      '',
      '',
      0,
      '2026-11-17 10:00:00',
      '',
      8000,
      1,
    ];
    const path = await writeWorkbook('report_stock_2026-11-19_fixture.xlsx', [
      [...STOCK_COLUMNS.slice(1), STOCK_COLUMNS[0]],
      [...stockRow.slice(1), stockRow[0]],
    ]);
    const report = await inspectFiles([path]);
    expect(report.files[0]).toMatchObject({
      kind: 'STOCK_SNAPSHOT',
      sourceRowCount: 1,
      issues: [],
    });
  });

  it('rejects the same IMEI in selected snapshots of different branches and stores', async () => {
    const stockRow = [
      '012345678901234',
      'fixture-name',
      'iPhone มือ 2 (เครื่องนอก)',
      '',
      '',
      0,
      '2026-11-17 10:00:00',
      '',
      8000,
      1,
    ];
    const sources = await Promise.all([
      writeWorkbook('report_stock_2026-11-19_first.xlsx', [STOCK_COLUMNS, stockRow]),
      writeWorkbook('report_stock_2026-11-19_second.xlsx', [
        STOCK_COLUMNS,
        [...stockRow.slice(0, 8), 8100, 1],
      ]),
    ]);
    const report = await inspectFiles(sources);
    const cutoverAt = '2026-11-19T18:00:00+07:00';
    const files: InputManifest['files'] = sources.map((path, index) => ({
      path,
      kind: 'STOCK_SNAPSHOT',
      sha256: report.files[index].sha256,
      storeKey: 'fixture-store-' + index,
      branchId: 'fixture-branch-' + index,
      reportFrom: '2026-11-19',
      reportTo: '2026-11-19',
    }));
    const decisions: SourceDecisions = {
      entries: files.map((file, index) => ({
        action: 'SELECT_SNAPSHOT',
        fileSha256: file.sha256,
        branchId: 'fixture-branch-' + index,
        storeKey: file.storeKey,
        sourceRows: [2],
        asOf: cutoverAt,
        reason: 'Fixture snapshot accepted for its branch',
        evidenceRef: 'fixture-stock-count-' + index,
      })),
    };
    const manifest: InputManifest = {
      version: 1,
      companyCode: 'SHOP',
      cutoverAt,
      canonicalSetId: 'fixture-cutover',
      decisionsSha256: hashSourceDecisions(decisions),
      files,
    };
    expect(validateManifest(manifest, report, decisions).map(({ code }) => code)).toEqual([
      'DUPLICATE_IMEI',
    ]);
  });

  it('counts snapshot detail rows on both sides of an empty Excel row', async () => {
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
    const path = await writeWorkbook('report_stock_2026-11-18_first.xlsx', [
      STOCK_COLUMNS,
      stockRow,
      [],
      stockRow,
    ]);
    const report = await inspectFiles([path]);

    expect(report.files[0].sourceRowCount).toBe(2);
    expect(report.files[0].rows.map(({ row }) => row)).toEqual([2, 4]);
    expect(report.duplicateRows[0].rows.map(({ row }) => row)).toEqual([2, 4]);
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

  it('rejects swapped manifest hashes for equal basenames in two directories', async () => {
    await mkdir(join(dir, 'left'));
    await mkdir(join(dir, 'right'));
    const left = await writeSales('left/' + SALE_NAME);
    const right = await writeSales('right/' + SALE_NAME, [saleRow('2026-11-18', 'other-bill')]);
    const report = await inspectFiles([left, right]);
    const { manifest, decisions } = salesManifest([left, right], report);
    manifest.files[0].path = right;
    manifest.files[1].path = left;

    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'FILE_HASH_MISMATCH' }),
    );
  });

  it('binds a path containing a symlink and parent traversal to the bytes it opens', async () => {
    await mkdir(join(dir, 'left'));
    const nested = join(dir, 'right', 'nested');
    await mkdir(nested, { recursive: true });
    const link = join(dir, 'left', 'link');
    await symlink(nested, link, 'dir');
    const left = await writeSales('left/' + SALE_NAME, [saleRow('2026-11-18', 'left-bill')]);
    const right = await writeSales('right/' + SALE_NAME, [saleRow('2026-11-18', 'right-bill')]);
    const source = [link, '..', SALE_NAME].join(sep);
    const report = await inspectFiles([source]);
    const { manifest, decisions } = salesManifest([source], report);

    expect(report.files[0].sha256).toBe(
      createHash('sha256')
        .update(await readFile(right))
        .digest('hex'),
    );
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
    manifest.files[0].path = left;
    expect(validateManifest(manifest, report, decisions)).toContainEqual(
      expect.objectContaining({ code: 'FILE_HASH_MISMATCH' }),
    );
  });

  it.each(['REPORT_DUPLICATE', 'DISTINCT_UNITS'] as const)(
    'rejects %s decisions targeting two different bills',
    async (action) => {
      const source = await writeSales(SALE_NAME, [saleRow(), saleRow('2026-11-18', 'other-bill')]);
      const report = await inspectFiles([source]);
      const { manifest, decisions } = salesManifest([source], report);
      decisions.entries[0].sourceRows = [3, 4];
      const evidence = {
        fileSha256: report.files[0].sha256,
        sourceRows: [3, 4],
        reason: 'Synthetic evidence for the decision',
        evidenceRef: 'fixture-record/bill-quantity',
      };
      decisions.entries.push(
        action === 'REPORT_DUPLICATE'
          ? { ...evidence, action, keepRow: 3 }
          : { ...evidence, action },
      );
      manifest.decisionsSha256 = hashSourceDecisions(decisions);

      expect(validateManifest(manifest, report, decisions)).toContainEqual(
        expect.objectContaining({ code: 'UNMATCHED_SALES_DUPLICATE_DECISION' }),
      );
    },
  );

  it('compares an identical selected pair independently of an excluded conflicting export', async () => {
    const first = await writeSales(SALE_NAME, [saleRow(), saleRow()]);
    const changedAmount = saleRow();
    changedAmount[10] = 20;
    const second = await writeSales('report_export_stock_2026-11-18_to_2026-11-30_other.xlsx', [
      changedAmount,
    ]);
    const report = await inspectFiles([first, second]);
    const { manifest, decisions } = salesManifest([first, second], report);
    decisions.entries[0].sourceRows = [3, 4];
    decisions.entries[1] = {
      action: 'EXCLUDE_FILE',
      fileSha256: report.files[1].sha256,
      sourceRows: [3],
      reason: 'Fixture canonical selection for the competing export',
      evidenceRef: 'fixture-record/verified-export',
    };
    decisions.entries.push({
      action: 'REPORT_DUPLICATE',
      keepRow: 3,
      fileSha256: report.files[0].sha256,
      sourceRows: [3, 4],
      reason: 'Fixture confirms a single item on the source bill',
      evidenceRef: 'fixture-record/bill-quantity',
    });
    manifest.decisionsSha256 = hashSourceDecisions(decisions);

    expect(report.duplicateRows[0].identical).toBe(false);
    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it('keeps identical line keys from separate verified export origins independent', async () => {
    const first = await writeSales();
    const second = await writeWorkbook('report_export_stock_2026-11-18_to_2026-11-30_other.xlsx', [
      ['รายการขาย ( 1 )'],
      SALES_COLUMNS,
      [...saleRow().slice(0, 12), 'another-fixture-seller', saleRow()[13]],
    ]);
    const report = await inspectFiles([first, second]);
    const { manifest, decisions } = salesManifest([first, second], report);
    const secondOrigin = { branchId: 'second-fixture-branch', storeKey: 'second-fixture-store' };
    Object.assign(manifest.files[1], secondOrigin);
    manifest.history!.push({ ...manifest.history![0], branchId: secondOrigin.branchId });
    Object.assign(decisions.entries[1], secondOrigin);
    manifest.decisionsSha256 = hashSourceDecisions(decisions);

    expect(validateManifest(manifest, report, decisions)).toEqual([]);
  });

  it.each(['referenced', 'separate same-origin', 'separate unresolved-origin'])(
    'does not let an excluded sale substantiate a zero day in a %s export',
    async (evidenceSource) => {
      const sold = await writeSales();
      const zeroExport =
        evidenceSource === 'referenced'
          ? sold
          : await writeSales('report_export_stock_2026-11-18_to_2026-11-30_zero.xlsx', []);
      const paths = [...new Set([sold, zeroExport])];
      const report = await inspectFiles(paths);
      const { manifest, decisions } = salesManifest(paths, report);
      if (evidenceSource === 'separate unresolved-origin') {
        manifest.files[0].storeKey = 'UNRESOLVED';
        manifest.files[0].branchId = null;
      }
      decisions.entries = [
        {
          action: 'EXCLUDE_FILE',
          fileSha256: report.files[0].sha256,
          sourceRows: [3],
          reason: 'Exclude the fixture sale',
          evidenceRef: 'fixture-record/exclusion',
        },
        {
          action: 'ZERO_SALES',
          fileSha256: report.files[report.files.length - 1].sha256,
          sourceRows: [],
          branchId: 'fixture-branch',
          reportFrom: '2026-11-18',
          reportTo: '2026-11-18',
          reason: 'Conflicting synthetic zero day claim',
          evidenceRef: 'fixture-record/zero-day',
        },
      ];
      manifest.decisionsSha256 = hashSourceDecisions(decisions);

      expect(validateManifest(manifest, report, decisions)).toContainEqual(
        expect.objectContaining({ code: 'INVALID_ZERO_SALES_PERIOD' }),
      );
    },
  );

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

  it('reports the Excel position of a padded numeric order number after reordering', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('fixture-worksheet');
    worksheet.addRow(['รายการขาย ( 1 )']);
    const headings = [...SALES_COLUMNS];
    [headings[5], headings[8]] = [headings[8], headings[5]];
    worksheet.addRow(headings);
    const sale = worksheet.addRow(saleRow());
    sale.getCell(6).value = 8000;
    sale.getCell(6).numFmt = '00000.00';
    sale.getCell(9).value = 1234;
    sale.getCell(9).numFmt = '000000';
    const path = join(dir, SALE_NAME);
    await workbook.xlsx.writeFile(path);

    const report = await inspectFiles([path]);
    const [file] = report.files;
    expect(file.issues).toEqual([
      expect.objectContaining({
        code: 'AMBIGUOUS_NUMERIC_VALUE',
        source: {
          fileSha256: file.sha256,
          sheet: 'worksheet-1',
          row: 3,
          storeKey: 'UNRESOLVED',
        },
        message: expect.stringContaining('คอลัมน์ 9'),
      }),
    ]);
  });

  it('reports an uncached formula at its Excel position without revealing cell or sheet contents', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('fixture-private-sheet');
    worksheet.addRow(STOCK_COLUMNS);
    worksheet.getCell('I4').value = { formula: 'fixturePrivateFunction()' };
    const path = join(dir, 'report_stock_2026-11-19_fixture.xlsx');
    await workbook.xlsx.writeFile(path);

    const report = await inspectFiles([path]);
    const [file] = report.files;
    expect(file.issues).toEqual([
      expect.objectContaining({
        code: 'FORMULA_WITHOUT_RESULT',
        source: {
          fileSha256: file.sha256,
          sheet: 'worksheet-1',
          row: 4,
          storeKey: 'UNRESOLVED',
        },
        message: expect.stringContaining('9'),
      }),
    ]);
    expect(JSON.stringify(report)).not.toContain('fixturePrivateFunction');
    expect(JSON.stringify(report)).not.toContain('fixture-private-sheet');
  });

  it('writes diagnostics and exits nonzero for recognized sales with missing columns', async () => {
    const source = await writeWorkbook(SALE_NAME, [
      ['รายการขาย ( 1 )'],
      ['ชื่อสินค้า'],
      ['fixture-name'],
    ]);
    const output = join(dir, 'private-output');
    const cli = resolve(__dirname, '../../tooltify-cutover.cli.ts');
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      cli,
      'inspect',
      '--out-dir',
      output,
      source,
    ]);

    expect(result.status).toBe(1);
    const report = JSON.parse(await readFile(join(output, 'inspection.json'), 'utf8'));
    expect(report.files[0].issues).toContainEqual(
      expect.objectContaining({ code: 'UNRECOGNIZED_COLUMNS' }),
    );
    expect(await readFile(join(output, 'inspection.csv'), 'utf8')).toContain(
      'section_observed_rows',
    );
  });

  it('writes private JSON and CSV through the CLI without a database', async () => {
    const source = await writeSales();
    const privateAliasText = 'fixture-secret-in-a-filename';
    const alias = join(dir, privateAliasText + '.xlsx');
    await copyFile(source, alias);
    const output = join(dir, 'private-output');
    const cli = resolve(__dirname, '../../tooltify-cutover.cli.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', cli, 'inspect', '--out-dir', output, source, alias],
      { env: { ...process.env, DATABASE_URL: 'postgresql://invalid/database' }, encoding: 'utf8' },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    for (const name of ['inspection.json', 'inspection.csv']) {
      const path = join(output, name);
      const data = await readFile(path, 'utf8');
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(data).toContain('input-1');
      expect(data).toContain('input-2');
      expect(data).not.toContain(SALE_NAME);
      expect(data).not.toContain(dir);
      expect(data).toContain('2026-11-18T16:36:21+07:00');
      for (const value of [...PRIVATE_VALUES, privateAliasText])
        expect(data + result.stdout).not.toContain(value);
    }
  });
});
