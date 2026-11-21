import ExcelJS from 'exceljs';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cliDependencies, runCutover } from '../../tooltify-cutover.cli';
import {
  SALES_COLUMNS,
  STOCK_COLUMNS,
} from '../../../modules/imported-sales/tooltify-report-layout';
import { readImportDatabaseIdentity } from '../plan';
import type { SourceDecisions } from '../types';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { stockInput } from './preflight-fixtures';
import { hashSourceDecisions } from '../canonicalize';
import { buildImportPlan } from '../plan';
import { applyBatch } from '../batch';
import { reconcileBatch, verifyAppliedBatch } from '../reconcile';
import { writeSalesItem } from '../sales-writer';
import { saleSourceKey } from '../../../modules/imported-sales/tooltify-sales-parser';
import type { CanonicalInput, CanonicalSaleLine, PlannedItem } from '../types';
import type { Prisma } from '@prisma/client';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
async function input(): Promise<Extract<CanonicalInput, { kind: 'SALES' }>> {
  const seed = await stockInput(db, 2);
  const file = { ...seed.manifest.files[0], kind: 'SALES' as const };
  const rows = seed.rows.map((r, i) => {
    const row: CanonicalSaleLine = {
      source: r.source,
      sourceStoreKey: file.storeKey,
      sourceKey: '',
      occurrence: 1,
      orderNumber: randomUUID(),
      barcode: seed.rows[0].barcode,
      productName: 'Fixture',
      category: 'iPhone มือ 1',
      buyerLabel: 'private',
      shopLabel: null,
      paymentType: 'CASH',
      priceGroup: 'ราคาปลีก',
      saleChannel: 'CASH',
      salespersonName: 'private',
      costTotal: '1.11',
      listPrice: '2.22',
      salePrice: '2.22',
      profit: '1.11',
      soldAt: new Date('2026-11-19T0' + i + ':00:00+07:00'),
    };
    row.sourceKey = saleSourceKey(row, 1);
    return row;
  });
  const decisions = {
    entries: [
      {
        ...seed.decisions.entries[0],
        action: 'SELECT_SALES' as const,
        branchId: file.branchId,
        storeKey: file.storeKey,
        reportFrom: file.reportFrom,
        reportTo: file.reportTo,
      },
    ],
  };
  const totals = {
    lines: 2,
    bills: 2,
    costTotal: '2.22',
    listPrice: '4.44',
    salePrice: '4.44',
    profit: '2.22',
  };
  return {
    ...seed,
    kind: 'SALES',
    rows,
    decisions,
    manifest: { ...seed.manifest, files: [file], decisionsSha256: hashSourceDecisions(decisions) },
    sourceSummary: {
      kind: 'SALES',
      reported: totals,
      detail: totals,
      delta: {
        lines: 0,
        bills: 0,
        costTotal: '0.00',
        listPrice: '0.00',
        salePrice: '0.00',
        profit: '0.00',
      },
      groups: [{ month: '2026-11', channel: 'CASH', branchId: file.branchId, totals }],
      evidenceFileSha256s: [file.sha256],
    },
  };
}
function writer(tx: Prisma.TransactionClient, item: PlannedItem) {
  if (item.kind !== 'SALES') throw Error('expected sale');
  return writeSalesItem(tx, item);
}
it('resumes a failed sale import, reconciles both bills of the same IMEI, and detects target drift', async () => {
  const data = await input();
  const plan = await buildImportPlan(db, data);
  expect(plan.issues).toEqual([]);
  let writes = 0;
  await expect(
    applyBatch(db, plan, async (tx, item) => {
      const result = await writer(tx, item);
      if (++writes === 2) throw Error('interrupted');
      return result;
    }),
  ).rejects.toThrow('interrupted');
  expect(await db.importedSale.count({ where: { importBatch: plan.batchId } })).toBe(1);
  expect((await reconcileBatch(db, plan.batchId)).canOpen).toBe(false);
  const resumed = await buildImportPlan(db, data);
  expect(resumed.planHash).toBe(plan.planHash);
  await applyBatch(db, resumed, writer);
  await applyBatch(db, await buildImportPlan(db, data), writer);
  expect(
    await db.importedSale.count({ where: { source: 'TOOLTIFY', importBatch: plan.batchId } }),
  ).toBe(2);
  const report = await reconcileBatch(db, plan.batchId);
  expect(report.canOpen).toBe(true);
  expect(report.target.totals).toMatchObject({ bills: 2, lines: 2, salePrice: '4.44' });
  const match = await buildImportPlan(db, {
    ...data,
    manifest: { ...data.manifest, canonicalSetId: randomUUID() },
  });
  expect(match.totals.matched).toBe(2);
  await applyBatch(db, match, () => {
    throw Error('MATCH called writer');
  });
  expect((await reconcileBatch(db, match.batchId)).canOpen).toBe(true);
  await db.importedSale.updateMany({
    where: { importBatch: plan.batchId },
    data: { salePrice: '2.21' },
  });
  expect((await reconcileBatch(db, plan.batchId)).canOpen).toBe(false);
  expect((await reconcileBatch(db, match.batchId)).canOpen).toBe(false);
  expect((await verifyAppliedBatch(db, plan.batchId, plan.planHash)).canOpen).toBe(false);
  expect(
    (await db.tooltifyImportBatch.findUniqueOrThrow({ where: { id: plan.batchId } })).status,
  ).toBe('APPLIED');
});

it('guards and verifies the operational manifest/decisions/workbook pipeline across processes including an evidenced excluded line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tooltify-sales-fixture-'));
  try {
    const seed = await input(),
      f = seed.manifest.files[0],
      date = '2026-11-19';
    const bill = randomUUID(),
      privateLabel = 'never-output-buyer';
    const path = join(dir, 'report_export_stock_2026-11-19_to_2026-11-19.xlsx');
    const workbook = new ExcelJS.Workbook(),
      ws = workbook.addWorksheet('private worksheet');
    ws.addRow([
      'รูปแบบการขาย',
      'คำสั่งซื้อ',
      'รายการขาย',
      'ต้นทุนรวม',
      'ราคาตั้งขาย',
      'ราคาขาย',
      'กำไร',
    ]);
    ws.addRow(['ขายสินค้าทั้งหมด', 1, 2, 10, 20, 20, 10]);
    ws.addRow(['รายการขาย (2)']);
    ws.addRow(SALES_COLUMNS);
    for (let i = 0; i < 2; i++)
      ws.addRow([
        '123456789012345',
        'fixture',
        'iPhone มือ 1',
        privateLabel,
        '-',
        bill,
        'เงินสด',
        'ราคาปลีก',
        5,
        10,
        10,
        5,
        'private-seller',
        date + ' 01:00:0' + i,
      ]);
    await workbook.xlsx.writeFile(path);
    const file = {
      ...f,
      path,
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    };
    const common = {
      fileSha256: file.sha256,
      reason: 'synthetic fixture',
      evidenceRef: 'source-register',
    };
    const decisions: SourceDecisions = {
      entries: [
        {
          ...common,
          action: 'SELECT_SALES',
          branchId: file.branchId!,
          storeKey: file.storeKey,
          reportFrom: date,
          reportTo: date,
          sourceRows: [5, 6],
        },
        { ...common, action: 'EXCLUDE_ROW', sourceRows: [6] },
      ],
    };
    const copy = join(dir, 'renamed.xlsx');
    await copyFile(path, copy);
    const manifest = {
      ...seed.manifest,
      copies: [{ path: copy, sha256: file.sha256 }],
      history: [
        { branchId: file.branchId!, reportFrom: date, reportTo: date, evidenceRef: 'fixture' },
      ],
      files: [file],
      decisionsSha256: hashSourceDecisions(decisions),
    };
    const manifestPath = join(dir, 'manifest.json'),
      decisionsPath = join(dir, 'source-decisions.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(decisionsPath, JSON.stringify(decisions));
    const id = await readImportDatabaseIdentity(db);
    const env = {
      DATABASE_URL: process.env.DATABASE_URL,
      EXPECTED_DB_NAME: id.database,
      EXPECTED_DB_FINGERPRINT: id.fingerprint,
      CONFIRM_TOOLTIFY_IMPORT: 'YES_I_AM_SURE',
    };
    let rev = 'reviewed';
    const messages: unknown[] = [];
    const invoke = (args: string[]) =>
      runCutover([...args, '--manifest', manifestPath], {
        ...cliDependencies(
          () => db,
          env,
          () => rev,
        ),
        report: (v) => messages.push(v),
      });
    expect(await invoke([]), JSON.stringify(messages)).toBe(0);
    const planned = messages[0] as {
      planHash: string;
      adjustments: { totals: { bills: number; salePrice: string } };
    };
    expect(planned.adjustments.totals).toMatchObject({ bills: 0, lines: 1, salePrice: '10.00' });
    const apply = ['apply', '--apply', '--plan-hash', planned.planHash];
    rev = 'unreviewed';
    expect(await invoke(apply)).toBe(1);
    rev = 'reviewed';
    await writeFile(copy, 'unreviewed bytes');
    expect(await invoke(apply)).toBe(1);
    await copyFile(path, copy);
    for (const copies of [
      [{ path, sha256: file.sha256 }],
      [...manifest.copies, ...manifest.copies],
    ]) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, copies }));
      messages.length = 0;
      expect(await invoke([])).toBe(1);
      expect(messages[0]).toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ code: 'INVALID_SOURCE_COPY' })]),
      });
    }
    await writeFile(manifestPath, JSON.stringify({ ...manifest, canonicalSetId: randomUUID() }));
    expect(await invoke(apply)).toBe(1);
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect(await db.importedSale.count({ where: { orderNumber: bill } })).toBe(0);
    expect(await invoke(apply), JSON.stringify(messages.slice(-2))).toBe(0);
    const receipt = messages.at(-1) as {
      batchId: string;
      status: string;
      canOpen: boolean;
      target: { totals: { lines: number } };
    };
    expect(receipt).toMatchObject({
      status: 'VERIFIED',
      canOpen: true,
      counts: { created: 1, matched: 0, excluded: 3, identicalFileCopies: 2 },
      target: { totals: { lines: 1, bills: 1, salePrice: '10.00' } },
    });
    expect(await invoke(apply)).toBe(0);
    expect(await invoke(['reconcile', '--batch-id', receipt.batchId])).toBe(0);
    expect(JSON.stringify(messages)).not.toContain(privateLabel);
    expect(JSON.stringify(messages)).not.toContain('private worksheet');
    expect(JSON.stringify(messages)).not.toContain(bill);
    // A different source with unresolved financial evidence must not get a batch.
    ws.getRow(2).getCell(6).value = 10;
    ws.getRow(5).getCell(11).value = 152290;
    await workbook.xlsx.writeFile(path);
    expect(await invoke(apply)).toBe(1);
    file.sha256 = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    for (const d of decisions.entries) d.fileSha256 = file.sha256;
    const changed = {
      ...manifest,
      copies: [],
      canonicalSetId: randomUUID(),
      decisionsSha256: hashSourceDecisions(decisions),
    };
    await writeFile(manifestPath, JSON.stringify(changed));
    await writeFile(decisionsPath, JSON.stringify(decisions));
    messages.length = 0;
    expect(await invoke([])).toBe(1);
    expect(messages[0]).toMatchObject({
      source: { delta: { salePrice: '-152290.00' } },
      sourceVerified: false,
    });
    expect(
      await invoke([
        'apply',
        '--apply',
        '--plan-hash',
        (messages[0] as { planHash: string }).planHash,
      ]),
    ).toBe(1);
    expect(
      await db.tooltifyImportBatch.count({ where: { canonicalSetId: changed.canonicalSetId } }),
    ).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('requires independent cost basis and evidence for excluded accessory service rows and creates only the retained stock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tooltify-stock-source-'));
  try {
    const seed = await stockInput(db),
      file = { ...seed.manifest.files[0], path: join(dir, 'report_stock_2026-11-19.xlsx') };
    const book = new ExcelJS.Workbook(),
      ws = book.addWorksheet('private stock');
    ws.addRow([
      'ชื่อสินค้า',
      'หมวดหมู่สินค้า',
      'แหล่งที่มา',
      'รายละเอียดสินค้า',
      'จำนวน',
      'ต้นทุนสินค้า',
    ]);
    ws.addRow(['Acme Alpha', 'iPhone มือ 1', '-', '-', 1, 100]);
    ws.addRow(['Service', 'Accessories', '-', '-', 2, 7]);
    ws.addRow(STOCK_COLUMNS);
    ws.addRow([
      seed.rows[0].barcode,
      'Acme Alpha',
      'iPhone มือ 1',
      '-',
      '-',
      '-',
      '2026-11-18 00:00:00',
      'private',
      100,
      1,
    ]);
    for (const i of [1, 2])
      ws.addRow([
        'SERVICE',
        'Service',
        'Accessories',
        '-',
        '-',
        '-',
        '2026-11-18 00:00:00',
        'private',
        7,
        i,
      ]);
    await book.xlsx.writeFile(file.path);
    file.sha256 = createHash('sha256')
      .update(await readFile(file.path))
      .digest('hex');
    for (const d of seed.decisions.entries) {
      d.sourceRows = d.action === 'SELECT_SNAPSHOT' ? [5, 6, 7] : [5];
      d.fileSha256 = file.sha256;
    }
    const exclusion: Extract<SourceDecisions['entries'][number], { action: 'EXCLUDE_ROW' }> = {
      action: 'EXCLUDE_ROW',
      fileSha256: file.sha256,
      sourceRows: [6, 7],
      reason: 'Service rows in stock report',
      evidenceRef: 'fixture-service-count',
    };
    seed.decisions.entries.push(exclusion);
    const manifest = { ...seed.manifest, files: [file] };
    const manifestPath = join(dir, 'manifest.json');
    const save = async () => {
      manifest.decisionsSha256 = hashSourceDecisions(seed.decisions);
      await writeFile(manifestPath, JSON.stringify(manifest));
      await writeFile(join(dir, 'source-decisions.json'), JSON.stringify(seed.decisions));
    };
    await save();
    const id = await readImportDatabaseIdentity(db);
    const messages: unknown[] = [];
    const deps = {
      ...cliDependencies(
        () => db,
        {
          DATABASE_URL: process.env.DATABASE_URL,
          EXPECTED_DB_NAME: id.database,
          EXPECTED_DB_FINGERPRINT: id.fingerprint,
          CONFIRM_TOOLTIFY_IMPORT: 'YES_I_AM_SURE',
        },
        () => 'fixture',
      ),
      report: (v: unknown) => messages.push(v),
    };
    const run = (args: string[]) => runCutover([...args, '--manifest', manifestPath], deps);
    expect(await run([])).toBe(1);
    expect(messages[0]).toMatchObject({ source: { reported: { units: 3, cost: null } } });
    const decision = seed.decisions.entries.find((d) => d.action === 'SELECT_SNAPSHOT')!;
    decision.summaryCostBasis = 'PER_UNIT';
    await save();
    messages.length = 0;
    expect(await run([])).toBe(1);
    expect(messages[0]).toMatchObject({
      source: { reported: { units: 3, cost: '114.00' }, detail: { units: null } },
    });
    exclusion.reportedUnitsPerRow = 1;
    await save();
    messages.length = 0;
    expect(await run([]), JSON.stringify(messages)).toBe(0);
    expect(
      await run([
        'apply',
        '--apply',
        '--plan-hash',
        (messages[0] as { planHash: string }).planHash,
      ]),
      JSON.stringify(messages.slice(-2)),
    ).toBe(0);
    expect(messages.at(-1)).toMatchObject({
      status: 'VERIFIED',
      canOpen: true,
      counts: { created: 1, excluded: 2 },
      adjustments: { totals: { units: 2, cost: '14.00' } },
      target: { totals: { units: 1, cost: '100.00' } },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('compares independently sourced money and journal references before verification', async () => {
  const data = await input();
  const plan = await buildImportPlan(db, data);
  await applyBatch(db, plan, writer);
  const user = await db.user.create({
    data: { email: randomUUID() + '@fixture.invalid', name: 'fixture', password: 'fixture' },
  });
  const company = await db.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const journal = await db.journalEntry.create({
    data: {
      entryNumber: randomUUID(),
      companyId: company.id,
      createdById: user.id,
      entryDate: new Date(),
      description: 'fixture',
      referenceId: randomUUID(),
    },
  });
  expect((await reconcileBatch(db, plan.batchId)).canOpen).toBe(true);
  await db.journalEntry.update({ where: { id: journal.id }, data: { referenceId: plan.batchId } });
  expect(await verifyAppliedBatch(db, plan.batchId, plan.planHash)).toMatchObject({
    canOpen: false,
    status: 'APPLIED',
    sideEffects: { journalEntries: 1 },
  });
  const inconsistent = await input();
  const source = inconsistent.sourceSummary!;
  const newTotals = { ...source.detail!, salePrice: '4.45' };
  source.detail = newTotals;
  source.reported = newTotals;
  source.groups![0].totals = newTotals;
  const broken = await buildImportPlan(db, inconsistent);
  await applyBatch(db, broken, writer);
  const report = await reconcileBatch(db, broken.batchId);
  expect(report.adjustments?.totals).toMatchObject({ salePrice: '0.00' });
  expect(report.deltas.sourceToCanonical).toContainEqual(
    expect.objectContaining({
      dimensions: {},
      values: expect.objectContaining({ salePrice: '0.01' }),
    }),
  );
  expect(report.canOpen).toBe(false);
});
