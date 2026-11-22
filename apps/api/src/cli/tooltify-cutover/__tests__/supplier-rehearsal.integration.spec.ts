import { afterAll, expect, it } from 'vitest';
import { harnessClient, frozen } from './rollback-fixtures';
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { supplierFixture } from './supplier-fixtures';
import { readSupplierWorkbook, validateSupplierInputs } from '../supplier-input';
import { planSuppliers } from '../supplier-plan';
import { applySuppliers, verifySuppliers, rollbackSuppliers } from '../supplier-writer';

// Operational rehearsal uses the isolated test harness and a private workbook supplied locally.
// No supplier identities or account details belong in this repository or console output.
const db = harnessClient();
afterAll(() => db.$disconnect());
it.skipIf(!process.env.TOOLTIFY_SUPPLIER_WORKBOOK)(
  'rehearses the actual supplier workbook, retains incomplete rows, and verifies replay and reversal',
  async () => {
    const path = process.env.TOOLTIFY_SUPPLIER_WORKBOOK!;
    const bytes = await readFile(path);
    const rows = await readSupplierWorkbook(path);
    const { context } = await supplierFixture(db);
    context.workbookSha256 = createHash('sha256').update(bytes).digest('hex');
    const all = await planSuppliers(db, rows, context);
    const blocked = new Set(validateSupplierInputs(rows).issues.map((i) => i.supplierRef));
    const ready = rows.filter((r) => !blocked.has(r.supplierRef));
    expect(ready.length).toBeGreaterThan(0);
    expect(all.items).toHaveLength(rows.length);
    if (blocked.size) {
      await expect(applySuppliers(db, all)).rejects.toThrow();
      expect(await db.tooltifyImportBatch.count({ where: { id: all.batchId } })).toBe(0);
    }
    const plan = await planSuppliers(db, ready, context);
    expect(plan.issues).toEqual([]);
    const applied = await applySuppliers(db, plan);
    await applySuppliers(db, plan);
    const verified = await verifySuppliers(db, plan);
    expect(await db.tooltifyImportItem.count({ where: { batchId: plan.batchId } })).toBe(
      ready.length,
    );
    const reversed = await frozen(() => rollbackSuppliers(db, plan));
    await frozen(() => rollbackSuppliers(db, plan));
    if (process.env.TOOLTIFY_REHEARSAL_OUT) {
      const out = resolve(process.env.TOOLTIFY_REHEARSAL_OUT);
      await mkdir(out, { recursive: true, mode: 0o700 });
      await chmod(out, 0o700);
      const result = {
        workbookSha256: context.workbookSha256,
        totalSuppliers: rows.length,
        rehearsed: ready.map((r) => r.supplierRef),
        pending: [...blocked],
        fieldIssues: all.issues,
        applied,
        verified,
        reversed,
        productionWrites: 0,
        isolatedDatabase: true,
        replayDidNotDuplicate: true,
      };
      await writeFile(resolve(out, 'supplier-rehearsal.json'), JSON.stringify(result, null, 2), {
        mode: 0o600,
      });
    }
  },
);
