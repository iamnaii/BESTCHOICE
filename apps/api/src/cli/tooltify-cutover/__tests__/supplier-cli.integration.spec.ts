import ExcelJS from 'exceljs';
import { readSupplierWorkbook } from '../supplier-input';
import { harnessClient, frozen } from './rollback-fixtures';
import { afterAll, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCutover, cliDependencies } from '../../tooltify-cutover.cli';
import { readImportDatabaseIdentity } from '../plan';
import { supplierFixture } from './supplier-fixtures';
const db = harnessClient();
afterAll(() => db.$disconnect());
it('plans, applies and verifies through guarded CLI with private artifacts; missing confirmation never writes', async () => {
  const { row, context } = await supplierFixture(db);
  const id = await readImportDatabaseIdentity(db);
  const dir = await mkdtemp(join(tmpdir(), 'supplier-cli-'));
  const input = join(dir, 'input.json'),
    ctx = join(dir, 'context.json'),
    out = join(dir, 'out');
  try {
    const workbookPath = join(dir, 'suppliers.xlsx');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('ผู้จัดจำหน่าย');
    sheet.getRow(4).values = [
      'รหัส',
      'ชื่ออ้างอิง',
      'ลำดับที่ควรกรอก',
      'ชื่อเดิมที่รวมในแถวนี้',
      'การจัดการ',
      'รวมเข้ารหัส',
      'ประเภทผู้ขาย',
      'ชื่อเต็มตามเอกสาร',
      'เบอร์โทร',
      'LINE ID',
      'ผู้ติดต่อ / ชื่อเล่น',
      'หมายเหตุ / ชื่อที่ควรรวม',
    ];
    sheet.getRow(5).values = [
      row.supplierRef,
      row.displayName,
      '',
      row.aliases.join(' / '),
      'แยกรายนี้',
      '',
      'นิติบุคคล',
      row.legalName,
      row.phone,
      '',
      '',
      '',
    ];
    const docs = wb.addWorksheet('เอกสารและชำระเงิน');
    docs.getRow(4).values = [
      'รหัส',
      'ชื่ออ้างอิง',
      'เลขประจำตัว / ผู้เสียภาษี 13 หลัก',
      'รหัสสาขา 5 หลัก (นิติบุคคล)',
      'จด VAT',
      'ที่อยู่ตามเอกสารฉบับเต็ม',
      'รหัสไปรษณีย์',
      'ธนาคาร (ถ้ามี)',
      'ชื่อบัญชี (ถ้ามี)',
      'เลขบัญชี (ถ้ามี)',
      'เครดิตกี่วัน (ถ้ามี)',
      'หมายเหตุเอกสาร / การชำระเงิน',
      'เงื่อนไข VAT ในการซื้อของร้าน',
    ];
    docs.getRow(5).values = [
      row.supplierRef,
      row.displayName,
      '',
      '',
      'ไม่จด VAT',
      row.address,
      row.postalCode,
      '',
      '',
      '',
      1,
      '',
      '',
    ];
    await wb.xlsx.writeFile(workbookPath);
    Object.assign(row, (await readSupplierWorkbook(workbookPath))[0]);
    Object.assign(context, { workbookPath, workbookSha256: row.evidenceRefs[0].workbookSha256 });
    await writeFile(
      input,
      JSON.stringify({ version: 1, workbookSha256: context.workbookSha256, rows: [row] }),
      { mode: 0o600 },
    );
    await writeFile(ctx, JSON.stringify(context), { mode: 0o600 });
    const env = {
      ...process.env,
      EXPECTED_DB_NAME: id.database,
      EXPECTED_DB_FINGERPRINT: id.fingerprint,
      CONFIRM_TOOLTIFY_IMPORT: 'YES_I_AM_SURE',
    };
    const deps = cliDependencies(
      () => db,
      env,
      () => context.codeRevision,
    );
    expect(
      await runCutover(
        ['supplier-plan', '--input', input, '--context', ctx, '--out-dir', out],
        deps,
      ),
    ).toBe(0);
    const path = join(out, 'supplier-plan.json');
    const p = JSON.parse(await readFile(path, 'utf8'));
    const args = [
      'supplier-apply',
      '--plan',
      path,
      '--plan-hash',
      p.planHash,
      '--apply',
      '--out-dir',
      out,
    ];
    const before = await db.supplier.count();
    expect(
      await runCutover(
        args,
        cliDependencies(
          () => db,
          { ...env, CONFIRM_TOOLTIFY_IMPORT: undefined },
          () => context.codeRevision,
        ),
      ),
    ).toBe(1);
    expect(await db.supplier.count()).toBe(before);
    const originalBytes = await readFile(workbookPath);
    sheet.getCell('I5').value = '029999999';
    await wb.xlsx.writeFile(workbookPath);
    expect(await runCutover(args, deps)).toBe(1);
    expect(await db.supplier.count()).toBe(before);
    await writeFile(workbookPath, originalBytes);
    expect(await runCutover(args, deps)).toBe(0);
    expect(await runCutover(args, deps)).toBe(0);
    expect(await db.supplier.count()).toBe(before + 1);
    expect(await runCutover(['supplier-verify', '--plan', path, '--out-dir', out], deps)).toBe(0);
    expect(
      await frozen(() =>
        runCutover(
          [
            'supplier-rollback',
            '--plan',
            path,
            '--plan-hash',
            p.planHash,
            '--apply',
            '--out-dir',
            out,
          ],
          deps,
        ),
      ),
    ).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
