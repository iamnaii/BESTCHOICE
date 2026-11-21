import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import {
  SALES_COLUMNS,
  STOCK_COLUMNS,
} from '../../../modules/imported-sales/tooltify-report-layout';
import { cliDependencies, runCutover } from '../../tooltify-cutover.cli';
import { hashSourceDecisions } from '../canonicalize';
import type { SourceDecision } from '../types';
import { stockInput } from './preflight-fixtures';

const db = new PrismaClient();
afterAll(() => db.$disconnect());

it.each([
  'excluded stock',
  'excluded sales',
  'empty stock',
  'selected exclusions and zero sales',
  'template',
] as const)('reviews both sources of a mixed manifest with %s', async (scenario) => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-source-review-'));
  try {
    const seed = await stockInput(db);
    const base = seed.manifest.files[0];
    const day = base.reportFrom;
    const zero = scenario === 'selected exclusions and zero sales';
    const device = seed.rows[0].barcode;
    const model = 'Acme ' + seed.manifest.canonicalSetId;
    const template = await db.pricingTemplate.create({
      data: {
        brand: 'Acme',
        model,
        category: 'PHONE_NEW',
        storage: '',
        cashPrice: 161,
        installmentBestchoicePrice: 175,
        installmentFinancePrice: 180,
      },
    });
    async function workbook(name: string, rows: (string | number)[][]) {
      const path = join(dir, name);
      const book = new ExcelJS.Workbook();
      book.addWorksheet('private sheet').addRows(rows);
      await book.xlsx.writeFile(path);
      return {
        ...base,
        path,
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      };
    }
    const emptyStock = scenario === 'empty stock';
    const stock = await workbook('report_stock_2026-11-19.xlsx', [
      ['ชื่อสินค้า', 'หมวดหมู่สินค้า', 'แหล่งที่มา', 'รายละเอียดสินค้า', 'จำนวน', 'ต้นทุนสินค้า'],
      [model, 'iPhone มือ 1', '-', '-', emptyStock ? 0 : 1, 100],
      [...STOCK_COLUMNS],
      ...(emptyStock
        ? []
        : [
            [
              device,
              model,
              'iPhone มือ 1',
              '-',
              '-',
              '-',
              day + ' 00:00:00',
              'private seller',
              100,
              1,
            ],
          ]),
    ]);
    const sales = {
      ...(await workbook('report_export_stock_2026-11-19_to_2026-11-19.xlsx', [
        ['รูปแบบการขาย', 'คำสั่งซื้อ', 'รายการขาย', 'ต้นทุนรวม', 'ราคาตั้งขาย', 'ราคาขาย', 'กำไร'],
        ['ขายสินค้าทั้งหมด', ...(zero ? [0, 0, 0, 0, 0, 0] : [1, 1, 10, 20, 20, 10])],
        [zero ? 'รายการขาย (0)' : 'รายการขาย (1)'],
        [...SALES_COLUMNS],
        ...(zero
          ? []
          : [
              [
                device,
                model,
                'iPhone มือ 1',
                'private buyer',
                '-',
                'private bill',
                'เงินสด',
                'ราคาปลีก',
                10,
                20,
                20,
                10,
                'private seller',
                day + ' 01:00:00',
              ],
            ]),
      ])),
      kind: 'SALES' as const,
    };
    const stockRows = emptyStock ? [] : [4];
    const evidence = { reason: 'fixture', evidenceRef: 'fixture' };
    const stockEvidence = { ...evidence, fileSha256: stock.sha256, sourceRows: stockRows };
    const range = { branchId: base.branchId, reportFrom: day, reportTo: day };
    const entries: SourceDecision[] =
      scenario === 'excluded stock'
        ? [{ ...stockEvidence, action: 'EXCLUDE_FILE', summaryCostBasis: 'PER_UNIT' }]
        : [
            {
              ...stockEvidence,
              action: 'SELECT_SNAPSHOT',
              summaryCostBasis: 'PER_UNIT',
              asOf: seed.manifest.cutoverAt,
              branchId: base.branchId,
              storeKey: base.storeKey,
            },
            zero
              ? { ...stockEvidence, action: 'EXCLUDE_ROW', reportedUnitsPerRow: 1 }
              : {
                  ...stockEvidence,
                  action: 'RESOLVE_STOCK',
                  deviceOrigin: null,
                  desiredStatus: 'IN_STOCK',
                  pricing: { mode: 'TEMPLATE' },
                },
          ];
    const saleEvidence = { ...evidence, fileSha256: sales.sha256, sourceRows: zero ? [] : [5] };
    entries.push(
      scenario === 'excluded sales'
        ? { ...saleEvidence, action: 'EXCLUDE_FILE' }
        : zero
          ? { ...saleEvidence, ...range, action: 'ZERO_SALES' }
          : { ...saleEvidence, ...range, action: 'SELECT_SALES', storeKey: base.storeKey },
    );
    const manifest = {
      ...seed.manifest,
      files: [stock, sales],
      history: scenario === 'excluded sales' ? [] : [{ ...range, evidenceRef: 'fixture' }],
      decisionsSha256: hashSourceDecisions({ entries }),
    };
    const path = join(dir, 'manifest.json');
    await writeFile(path, JSON.stringify(manifest));
    await writeFile(join(dir, 'source-decisions.json'), JSON.stringify({ entries }));
    const reports: unknown[] = [];
    const deps = {
      ...cliDependencies(
        () => db,
        {
          DATABASE_URL: process.env.DATABASE_URL,
          EXPECTED_DB_NAME: 'bc_vitest_test',
          EXPECTED_DB_FINGERPRINT: seed.expectedDbIdentity,
          CONFIRM_TOOLTIFY_IMPORT: 'YES_I_AM_SURE',
        },
        () => 'fixture',
      ),
      report: (value: unknown) => reports.push(value),
    };
    for (const kind of ['sales', 'current-stock-snapshot']) {
      const args = ['--manifest', path, '--source-kind', kind, '--out-dir', dir];
      const dry = await runCutover(args, deps);
      const saved = await readFile(join(dir, 'dry-run.json'), 'utf8');
      const plan = JSON.parse(saved);
      const blocked = scenario.startsWith('excluded') || emptyStock;
      expect(dry, saved).toBe(blocked ? 1 : 0);
      if (scenario.startsWith('excluded')) {
        const missing = scenario === 'excluded stock' ? 'STOCK' : 'SALES';
        expect(plan.issues).toContainEqual(
          expect.objectContaining({ kind: missing, code: 'UNPROVEN_IMPORT_SCOPE' }),
        );
        const reviewingMissingKind = (kind === 'sales') === (missing === 'SALES');
        expect(plan.sourceVerified).toBe(!reviewingMissingKind);
        const companions = plan.issues.filter(
          (i: { code: string }) => i.code === 'COMPANION_SOURCE_BLOCKED',
        );
        expect(companions).toEqual(
          reviewingMissingKind ? [] : [expect.objectContaining({ kind: missing })],
        );
      }
      if (emptyStock)
        expect(
          plan.issues.filter((issue: { code: string }) => issue.code === 'EMPTY_SNAPSHOT'),
        ).toEqual([expect.objectContaining({ kind: 'STOCK' })]);
      if (zero)
        expect(plan).toMatchObject({
          sourceVerified: true,
          items: [],
          excluded: kind === 'sales' ? [] : [expect.objectContaining({ reason: 'EXCLUDE_ROW' })],
        });
      if (scenario === 'template' && kind !== 'sales') {
        expect(plan.items[0]).toMatchObject({
          branchId: base.branchId,
          kind: 'DEVICE',
          status: 'IN_STOCK',
          cost: '100.00',
          pricingMode: 'TEMPLATE',
          templateId: template.id,
          cashPrice: '161.00',
          installmentPrice: '175.00',
          financePrice: '180.00',
        });
        for (const secret of [
          dir,
          device,
          'private sheet',
          'private buyer',
          'private seller',
          'private bill',
        ])
          expect(saved + JSON.stringify(reports)).not.toContain(secret);
        expect(JSON.stringify(reports)).not.toContain(template.id);
      }
      if (scenario === 'template') continue;
      expect(
        await runCutover(['apply', '--apply', '--plan-hash', plan.planHash, ...args], deps),
      ).toBe(blocked ? 1 : 0);
      if (zero) expect(reports.at(-1)).toMatchObject({ canOpen: true, status: 'VERIFIED' });
    }
    expect(
      await db.tooltifyImportBatch.count({ where: { canonicalSetId: manifest.canonicalSetId } }),
    ).toBe(zero ? 2 : 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
