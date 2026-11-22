import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSupplierWorkbook, validateSupplierInputs } from '../supplier-input';
import { cliDependencies, runCutover } from '../../tooltify-cutover.cli';

// Catches swapped payment/name fields, lost leading zeros, guessed entity types,
// VAT conflated with purchase terms, and cross-channel identity applied without owner evidence.
async function fixture(change?: (wb: ExcelJS.Workbook) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'supplier-input-'));
  const path = join(dir, 'input.xlsx');
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('ผู้จัดจำหน่าย');
  const d = wb.addWorksheet('เอกสารและชำระเงิน');
  s.getRow(4).values = [
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
  d.getRow(4).values = [
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
  for (let i = 1; i <= 12; i++) {
    const r = i + 4,
      ref = 'SUP' + String(i).padStart(3, '0');
    s.getRow(r).values = [
      ref,
      'ร้านทดสอบ ' + i,
      '',
      'Alias ' + i + ' / alias ' + i,
      'แยกรายนี้',
      '',
      'นิติบุคคล',
      'บริษัท ทดสอบ ' + i + ' จำกัด',
      '020000000',
      '',
      '',
      '',
    ];
    d.getRow(r).values = [
      ref,
      'ร้านทดสอบ ' + i,
      '',
      '',
      i === 6 || i === 7 ? 'จด VAT' : 'ไม่จด VAT',
      'ที่อยู่ทดสอบ',
      '10000',
      'ธนาคารทดสอบ',
      'ชื่อผู้รับโอน',
      '00123456789' + (i - 1),
      i === 6 ? 15 : 1,
      '',
      'ไม่มี VAT ในการซื้อ',
    ];
  }
  change?.(wb);
  await wb.xlsx.writeFile(path);
  return { path, dispose: () => rm(dir, { recursive: true, force: true }) };
}
describe('supplier workbook preparation', () => {
  it('reads openpyxl-style absolute comment relationships without modifying the original workbook', async () => {
    const f = await fixture((w) => {
      w.getWorksheet('ผู้จัดจำหน่าย')!.getCell('H5').note = 'Synthetic evidence';
    });
    try {
      const zip = await JSZip.loadAsync(await readFile(f.path));
      for (const [name, file] of Object.entries(zip.files)) {
        if (/xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) {
          zip.file(
            name,
            (await file.async('string')).replace(
              /Target="\.\.\/comments(\d+)\.xml"/g,
              'Target="/xl/comments/comment$1.xml"',
            ),
          );
        }
        if (/^xl\/comments\d+\.xml$/.test(name)) {
          zip.file(
            name.replace('xl/comments', 'xl/comments/comment'),
            await file.async('nodebuffer'),
          );
          zip.remove(name);
        }
      }
      const bytes = await zip.generateAsync({ type: 'nodebuffer' });
      await writeFile(f.path, bytes);
      expect((await readSupplierWorkbook(f.path))[0].legalName).toBe('บริษัท ทดสอบ 1 จำกัด');
      expect(await readFile(f.path)).toEqual(bytes);
    } finally {
      await f.dispose();
    }
  });
  it('inspects through the real CLI without opening a database and writes private reports', async () => {
    const f = await fixture();
    try {
      const out = join(f.path, '..', 'reports');
      const deps = cliDependencies(() => {
        throw Error('NO_DATABASE_ALLOWED');
      });
      expect(
        await runCutover(['supplier-inspect', '--workbook', f.path, '--out-dir', out], deps),
      ).toBe(0);
      const report = JSON.parse(await readFile(join(out, 'supplier-input.json'), 'utf8'));
      expect(report.rows).toHaveLength(12);
      expect(report.workbookSha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await stat(join(out, 'supplier-input.json'))).mode & 0o077).toBe(0);
      expect(await readFile(join(out, 'supplier-issues.csv'), 'utf8')).toContain('supplierRef');
    } finally {
      await f.dispose();
    }
  });
  it('keeps all suppliers, bank holders and text identifiers independently of VAT purchase terms', async () => {
    const f = await fixture();
    try {
      const rows = await readSupplierWorkbook(f.path);
      expect(rows).toHaveLength(12);
      expect(rows.filter((r) => r.hasVat).map((r) => r.supplierRef)).toEqual(['SUP006', 'SUP007']);
      expect(rows.map((r) => r.creditTermDays)).toEqual([1, 1, 1, 1, 1, 15, 1, 1, 1, 1, 1, 1]);
      expect(rows[0]).toMatchObject({
        legalName: 'บริษัท ทดสอบ 1 จำกัด',
        phone: '020000000',
        bankAccounts: [{ bankAccountNumber: '001234567890', bankAccountName: 'ชื่อผู้รับโอน' }],
      });
      expect(validateSupplierInputs(rows).issues).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
  it('reports missing identities without defaulting to JURISTIC or inventing phones', async () => {
    const f = await fixture((w) => {
      const s = w.getWorksheet('ผู้จัดจำหน่าย')!;
      s.getCell('G5').value = 'ยังไม่ทราบ';
      s.getCell('H5').value = null;
      s.getCell('I5').value = null;
    });
    try {
      const result = validateSupplierInputs(await readSupplierWorkbook(f.path));
      expect(result.rows[0]).toMatchObject({ type: null, legalName: null, phone: null });
      expect(result.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining([
          'SUPPLIER_TYPE_REQUIRED',
          'SUPPLIER_NAME_REQUIRED',
          'SUPPLIER_PHONE_REQUIRED',
        ]),
      );
    } finally {
      await f.dispose();
    }
  });
  it('blocks duplicate IDs and alias collisions across suppliers', async () => {
    const f = await fixture();
    try {
      const rows = await readSupplierWorkbook(f.path);
      rows[1].aliases = ['Alias 1'];
      rows[2].supplierRef = rows[0].supplierRef;
      expect(validateSupplierInputs(rows).issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['SUPPLIER_REF_DUPLICATE', 'SUPPLIER_ALIAS_CONFLICT']),
      );
    } finally {
      await f.dispose();
    }
  });
  it('blocks numeric account cells rather than silently losing a leading zero', async () => {
    const f = await fixture((w) => {
      w.getWorksheet('เอกสารและชำระเงิน')!.getCell('J5').value = 1234567890;
    });
    try {
      await expect(readSupplierWorkbook(f.path)).rejects.toThrow(
        'SUPPLIER_IDENTIFIER_MUST_BE_TEXT',
      );
    } finally {
      await f.dispose();
    }
  });
  it('does not accept unverified VAT or fractional credit days', async () => {
    const f = await fixture((w) => {
      const d = w.getWorksheet('เอกสารและชำระเงิน')!;
      d.getCell('E5').value = 'ยังไม่ทราบ';
      d.getCell('K5').value = 1.5;
    });
    try {
      const result = validateSupplierInputs(await readSupplierWorkbook(f.path));
      expect(result.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['SUPPLIER_VAT_REQUIRED', 'SUPPLIER_CREDIT_INVALID']),
      );
    } finally {
      await f.dispose();
    }
  });
  it.each([
    ['Shopee เท่านั้น', true],
    ['ทั้งกลุ่ม Apple Flagship ตามคำยืนยันเจ้าของ', false],
  ])('respects explicit legal profile scope %s', async (scope, blocked) => {
    const f = await fixture((w) => {
      const p = w.addWorksheet('เอกสารตามช่องทาง');
      p.addRow(['รหัสกลุ่ม', 'ชื่ออ้างอิง', 'ขอบเขตที่ตรวจพบ']);
      p.addRow(['SUP007', 'Apple Flagship', scope]);
    });
    try {
      const result = validateSupplierInputs(await readSupplierWorkbook(f.path));
      expect(result.issues.some((i) => i.code === 'SUPPLIER_LEGAL_SCOPE_UNRESOLVED')).toBe(blocked);
    } finally {
      await f.dispose();
    }
  });
  it('rejects unmatched worksheet rows and formula-derived identity', async () => {
    const f = await fixture((w) => {
      w.getWorksheet('เอกสารและชำระเงิน')!.getCell('A5').value = 'SUP999';
    });
    try {
      await expect(readSupplierWorkbook(f.path)).rejects.toThrow('SUPPLIER_SHEET_REF_MISMATCH');
    } finally {
      await f.dispose();
    }
    const g = await fixture((w) => {
      w.getWorksheet('ผู้จัดจำหน่าย')!.getCell('H5').value = {
        formula: '"guessed"',
        result: 'guessed',
      };
    });
    try {
      await expect(readSupplierWorkbook(g.path)).rejects.toThrow('SUPPLIER_FORMULA_NOT_ALLOWED');
    } finally {
      await g.dispose();
    }
  });
});

it('rejects unknown JSON enum values and omitted VAT instead of silently creating a non-VAT supplier', async () => {
  const f = await fixture();
  try {
    const rows = await readSupplierWorkbook(f.path);
    Object.assign(rows[0], { type: 'UNKNOWN', hasVat: undefined, legalProfileScope: 'UNVERIFIED' });
    expect(validateSupplierInputs(rows).issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'SUPPLIER_TYPE_REQUIRED',
        'SUPPLIER_VAT_REQUIRED',
        'SUPPLIER_LEGAL_SCOPE_UNRESOLVED',
      ]),
    );
  } finally {
    await f.dispose();
  }
});

it('rejects swapped bank headers rather than importing the account holder as a bank', async () => {
  const f = await fixture((w) => {
    const d = w.getWorksheet('เอกสารและชำระเงิน')!;
    const a = d.getCell('H4').value;
    d.getCell('H4').value = d.getCell('I4').value;
    d.getCell('I4').value = a;
  });
  try {
    await expect(readSupplierWorkbook(f.path)).rejects.toThrow('SUPPLIER_WORKBOOK_LAYOUT_MISMATCH');
  } finally {
    await f.dispose();
  }
});
it.each(['legalName', 'taxId', 'bankAccountNumber'] as const)(
  'blocks two source suppliers claiming one %s',
  async (field) => {
    const f = await fixture();
    try {
      const rows = (await readSupplierWorkbook(f.path)).slice(0, 2);
      if (field === 'bankAccountNumber')
        rows[1].bankAccounts = structuredClone(rows[0].bankAccounts);
      else if (field === 'taxId') rows[0].taxId = rows[1].taxId = '0100000000001';
      else rows[1].legalName = rows[0].legalName;
      expect(validateSupplierInputs(rows).issues.map((i) => i.code)).toContain(
        'SUPPLIER_IDENTITY_CONFLICT',
      );
    } finally {
      await f.dispose();
    }
  },
);
it.each(['drop-row', 'bank-edit'] as const)(
  'verifies the original workbook before trusting inspected JSON (%s)',
  async (tamper) => {
    const f = await fixture();
    try {
      const rows = await readSupplierWorkbook(f.path);
      const sha = rows[0].evidenceRefs[0].workbookSha256;
      if (tamper === 'drop-row') rows.pop();
      else rows[0].bankAccounts[0].bankAccountNumber = '999900001111';
      const input = f.path + '.json',
        context = f.path + '.context.json';
      await writeFile(input, JSON.stringify({ version: 1, workbookSha256: sha, rows }), {
        mode: 0o600,
      });
      await writeFile(context, JSON.stringify({ workbookSha256: sha, workbookPath: f.path }), {
        mode: 0o600,
      });
      const deps = cliDependencies(() => {
        throw Error('DATABASE_OPENED');
      });
      await expect(deps.prepareSuppliers!(input, context, 'fixture')).rejects.toThrow(
        'SUPPLIER_WORKBOOK_INPUT_MISMATCH',
      );
    } finally {
      await f.dispose();
    }
  },
);

it('accepts an explicitly owner-approved blank phone from the original workbook while other blanks stay pending', async () => {
  const f = await fixture((w) => {
    const s = w.getWorksheet('ผู้จัดจำหน่าย')!;
    s.getCell('I5').value = null;
    s.getCell('L5').value = 'เจ้าของยืนยันให้เว้นเบอร์โทรว่าง';
    s.getCell('I6').value = null;
  });
  try {
    const rows = await readSupplierWorkbook(f.path);
    expect(rows[0].phone).toBeNull();
    const issues = validateSupplierInputs(rows).issues.filter(
      (i) => i.code === 'SUPPLIER_PHONE_REQUIRED',
    );
    expect(issues.map((i) => i.supplierRef)).toEqual(['SUP002']);
  } finally {
    await f.dispose();
  }
});
