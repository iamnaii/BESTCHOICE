import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, expect, it } from 'vitest';
import { SALES_COLUMNS } from '../../../modules/imported-sales/tooltify-report-layout';
import { cliDependencies, runCutover } from '../../tooltify-cutover.cli';
import { hashSourceDecisions } from '../canonicalize';
import { applyRollback, planRollback } from '../rollback';
import { applyBatch } from '../batch';
import { readImportDatabaseIdentity, buildImportPlan } from '../plan';
import { stockInput } from './preflight-fixtures';
import { frozen, harnessClient, writer } from './rollback-fixtures';
import type { SourceDecisions } from '../types';

const db = harnessClient();
afterAll(() => db.$disconnect());
it('rehearses workbook inspection to reviewed rollback, keeping distinct resale events through crash, resume and retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tooltify-rehearsal-'));
  try {
    const seed = await stockInput(db),
      f = seed.manifest.files[0],
      day = '2026-11-19';
    const path = join(dir, 'report_export_stock_2026-11-19_to_2026-11-19.xlsx');
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('private fixture');
    sheet.addRow([
      'รูปแบบการขาย',
      'คำสั่งซื้อ',
      'รายการขาย',
      'ต้นทุนรวม',
      'ราคาตั้งขาย',
      'ราคาขาย',
      'กำไร',
    ]);
    sheet.addRow(['ขายสินค้าทั้งหมด', 2, 2, 10, 20, 20, 10]);
    sheet.addRow(['รายการขาย (2)']);
    sheet.addRow(SALES_COLUMNS);
    for (let i = 0; i < 2; i++)
      sheet.addRow([
        seed.rows[0].barcode,
        'fixture',
        'iPhone มือ 1',
        'private fixture buyer',
        '-',
        randomUUID(),
        'เงินสด',
        'ราคาปลีก',
        5,
        10,
        10,
        5,
        'fixture',
        day + ' 01:00:0' + i,
      ]);
    await book.xlsx.writeFile(path);
    const sha256 = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const decisions: SourceDecisions = {
      entries: [
        {
          fileSha256: sha256,
          action: 'SELECT_SALES',
          branchId: f.branchId!,
          storeKey: f.storeKey,
          reportFrom: day,
          reportTo: day,
          sourceRows: [5, 6],
          reason: 'fixture',
          evidenceRef: 'fixture-evidence',
        },
      ],
    };
    const manifest = {
      ...seed.manifest,
      files: [{ ...f, path, sha256, kind: 'SALES' }],
      history: [{ branchId: f.branchId, reportFrom: day, reportTo: day, evidenceRef: 'fixture' }],
      decisionsSha256: hashSourceDecisions(decisions),
    };
    const manifestPath = join(dir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(dir, 'source-decisions.json'), JSON.stringify(decisions));
    const identity = await readImportDatabaseIdentity(db);
    const deps = cliDependencies(
      () => db,
      {
        DATABASE_URL: process.env.DATABASE_URL,
        EXPECTED_DB_NAME: identity.database,
        EXPECTED_DB_FINGERPRINT: identity.fingerprint,
        CONFIRM_TOOLTIFY_IMPORT: 'YES_I_AM_SURE',
      },
      () => '1'.repeat(40),
    );
    const messages: unknown[] = [];
    deps.report = (v) => messages.push(v);
    const timings: { stage: string; ms: number; code: number }[] = [];
    const invoke = async (...args: string[]) => {
      const start = performance.now();
      const code = await runCutover([...args, '--manifest', manifestPath, '--out-dir', dir], deps);
      timings.push({ stage: args[0], ms: Math.round(performance.now() - start), code });
      return code;
    };
    expect(await invoke('inspect')).toBe(0);
    expect(await invoke('dry-run'), JSON.stringify(messages)).toBe(0);
    const p = await deps.prepare(manifestPath, undefined, 'SALES', identity.fingerprint, true);
    expect(await db.tooltifyImportBatch.count({ where: { id: p.batchId } })).toBe(0);
    // Kill our own importer with its second item transaction still open. No catch/finally
    // runs: PostgreSQL must discard that target + receipt, leaving the batch APPLYING.
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        `
      const {harnessClient,writer}=require('./src/cli/tooltify-cutover/__tests__/rollback-fixtures.ts');
      const {cliDependencies}=require('./src/cli/tooltify-cutover.cli.ts');
      const {applyBatch}=require('./src/cli/tooltify-cutover/batch.ts');
      (async()=>{
        const db=harnessClient(), deps=cliDependencies(()=>db,process.env,()=> '1'.repeat(40));
        const p=await deps.prepare(process.argv[1],undefined,'SALES',(await deps.identity()).fingerprint,false);
        let n=0;
        await applyBatch(db,p,async(tx,item)=>{
          const result=await writer(tx,item);
          if (++n===2) {process.send(p.batchId);await new Promise(()=>{});}
          return result;
        });
      })().catch(()=>process.exit(1));
    `,
        manifestPath,
      ],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    const exit = once(child, 'exit');
    let batchId: string;
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
    try {
      batchId = await Promise.race([
        once(child, 'message').then(([id]) => String(id)),
        exit.then(() => {
          throw Error('IMPORTER_EXITED_BEFORE_SECOND_ITEM');
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      child.kill('SIGKILL');
      await exit;
    }
    expect(
      await db.tooltifyImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
    ).toMatchObject({ status: 'APPLYING' });
    expect(await db.importedSale.count({ where: { importBatch: batchId } })).toBe(1);
    const apply = ['apply', '--apply', '--plan-hash', p.planHash];
    expect(await invoke(...apply), JSON.stringify(messages)).toBe(0);
    expect(await invoke('reconcile', '--batch-id', batchId)).toBe(0);
    expect(messages.at(-1)).toMatchObject({
      canOpen: true,
      target: { totals: { lines: 2, bills: 2, salePrice: '20.00' } },
    });
    expect(await invoke(...apply)).toBe(0);
    expect(await db.importedSale.count({ where: { importBatch: batchId } })).toBe(2);
    const other = await db.importedSale.create({
      data: {
        ...(await db.importedSale.findFirstOrThrow({ where: { importBatch: batchId } })),
        id: randomUUID(),
        importBatch: 'unrelated',
        orderNumber: randomUUID(),
      },
    });
    const dependentManifest = join(dir, 'dependent.json');
    await writeFile(
      dependentManifest,
      JSON.stringify({ ...manifest, canonicalSetId: randomUUID() }),
    );
    const match = await deps.prepare(
      dependentManifest,
      undefined,
      'SALES',
      identity.fingerprint,
      false,
    );
    expect(match.totals.matched).toBe(2);
    await applyBatch(db, match, writer);
    expect((await planRollback(db, batchId)).references.otherBatchReceipts).toBe(2);
    const dependent = await planRollback(db, match.batchId);
    expect(await frozen(() => applyRollback(db, dependent))).toMatchObject({ importedSales: 0 });
    expect(await db.importedSale.count({ where: { importBatch: batchId } })).toBe(2);
    expect(await invoke('rollback-dry-run', '--batch-id', batchId)).toBe(0);
    const reviewed = JSON.parse(await readFile(join(dir, 'rollback-plan.json'), 'utf8'));
    expect(reviewed).toMatchObject({ operation: 'ROLLBACK', blockers: [] });
    expect(
      await invoke('rollback', '--apply', '--batch-id', batchId, '--plan-hash', p.planHash),
    ).toBe(1);
    const privatePlan = join(dir, 'rollback-plan.json');
    expect((await stat(privatePlan)).mode & 0o777).toBe(0o600);
    const original = await readFile(privatePlan, 'utf8');
    await writeFile(privatePlan, JSON.stringify({ ...reviewed, unexpected: 'unreviewed' }));
    const rollbackArgs = [
      'rollback',
      '--apply',
      '--batch-id',
      batchId,
      '--plan-hash',
      reviewed.planHash,
    ];
    expect(await invoke(...rollbackArgs)).toBe(1);
    await writeFile(privatePlan, original);
    await chmod(privatePlan, 0o644);
    expect(await invoke(...rollbackArgs)).toBe(1);
    await chmod(privatePlan, 0o600);
    expect(await db.importedSale.count({ where: { importBatch: batchId } })).toBe(2);
    await frozen(async () => {
      expect(
        await invoke(
          'rollback',
          '--apply',
          '--batch-id',
          batchId,
          '--plan-hash',
          reviewed.planHash,
        ),
        JSON.stringify(messages),
      ).toBe(0);
      await copyFile(
        join(dir, 'rollback-receipt.json'),
        join(dir, 'initial-rollback-receipt.json'),
      );
      await rm(join(dir, 'rollback-receipt.json'));
      expect(
        await invoke(
          'rollback',
          '--apply',
          '--batch-id',
          batchId,
          '--plan-hash',
          reviewed.planHash,
        ),
        JSON.stringify(messages),
      ).toBe(0);
      expect(JSON.parse(await readFile(join(dir, 'rollback-receipt.json'), 'utf8'))).toMatchObject({
        importedSales: 0,
        reversedItems: 0,
      });
    });
    expect(await db.importedSale.count({ where: { importBatch: batchId } })).toBe(0);
    expect(await db.importedSale.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other);
    expect(JSON.stringify(messages)).not.toContain('private fixture buyer');
    if (process.env.TOOLTIFY_REHEARSAL_REPORT_DIR) {
      const evidence = await mkdtemp(join(process.env.TOOLTIFY_REHEARSAL_REPORT_DIR, 'task9-'));
      for (const file of [
        'inspection.json',
        'dry-run.json',
        'verification.json',
        'reconciliation.json',
        'rollback-plan.json',
        'initial-rollback-receipt.json',
        'rollback-receipt.json',
      ])
        await copyFile(join(dir, file), join(evidence, file));
      await writeFile(join(evidence, 'timings.json'), JSON.stringify(timings, null, 2), {
        mode: 0o600,
      });
      console.info('Synthetic rehearsal reports:', evidence);
    }
    if (process.env.TOOLTIFY_REHEARSAL_TIMINGS === '1')
      console.info('tooltify-fixture-timings', JSON.stringify(timings));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('rejects a changed price template after dry-run without allocating a batch', async () => {
  const input = await stockInput(db),
    row = input.rows[0];
  row.model = randomUUID();
  const decision = input.decisions.entries.find((d) => d.action === 'RESOLVE_STOCK')!;
  decision.pricing = { mode: 'TEMPLATE' };
  input.manifest.decisionsSha256 = hashSourceDecisions(input.decisions);
  const template = await db.pricingTemplate.create({
    data: {
      brand: row.brand,
      model: row.model,
      category: row.category,
      storage: '',
      cashPrice: 213,
      installmentBestchoicePrice: 230,
      installmentFinancePrice: 240,
    },
  });
  const plan = await buildImportPlan(db, input);
  expect(plan.issues).toEqual([]);
  await db.pricingTemplate.update({ where: { id: template.id }, data: { cashPrice: 214 } });
  await expect(applyBatch(db, plan, writer)).rejects.toThrow('IMPORT_DEPENDENCY_CHANGED');
  expect(await db.tooltifyImportBatch.findUnique({ where: { id: plan.batchId } })).toBeNull();
});
