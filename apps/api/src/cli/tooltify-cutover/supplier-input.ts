import ExcelJS from 'exceljs';
import { hashImportValue as hash } from './canonicalize';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { SupplierInput, SupplierValidation } from './supplier-types';

export const normalizeSupplierAlias = (s: string) =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
function text(c: ExcelJS.Cell, identifier = false): string | null {
  const v = c.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') throw Error('SUPPLIER_FORMULA_NOT_ALLOWED');
  if (identifier && typeof v !== 'string') throw Error('SUPPLIER_IDENTIFIER_MUST_BE_TEXT');
  return String(v).trim() || null;
}
function sheet(w: ExcelJS.Workbook, name: string, expected: Record<number, string>) {
  const s = w.getWorksheet(name);
  if (
    !s ||
    Object.entries(expected).some(([col, label]) => text(s.getCell(4, Number(col))) !== label)
  )
    throw Error('SUPPLIER_WORKBOOK_LAYOUT_MISMATCH');
  return s;
}
export async function readSupplierWorkbook(path: string): Promise<SupplierInput[]> {
  const bytes = await readFile(path);
  const workbookSha256 = createHash('sha256').update(bytes).digest('hex');
  const w = new ExcelJS.Workbook();
  // ExcelJS cannot reconcile openpyxl's absolute comments/VML relationships.
  // Notes are provenance in the immutable original, not imported business values.
  // Remove only these optional relationships in memory; hash and keep the original bytes.
  const zip = await JSZip.loadAsync(bytes);
  for (const [name, file] of Object.entries(zip.files)) {
    if (!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) continue;
    const xml = await file.async('string');
    zip.file(
      name,
      xml.replace(
        /<Relationship\b[^>]*\bType=["']http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/(?:comments|vmlDrawing)["'][^>]*\/>/g,
        '',
      ),
    );
  }
  await w.xlsx.read(Readable.from([await zip.generateAsync({ type: 'nodebuffer' })]));
  const s = sheet(w, 'ผู้จัดจำหน่าย', {
    1: 'รหัส',
    2: 'ชื่ออ้างอิง',
    4: 'ชื่อเดิมที่รวมในแถวนี้',
    5: 'การจัดการ',
    6: 'รวมเข้ารหัส',
    7: 'ประเภทผู้ขาย',
    8: 'ชื่อเต็มตามเอกสาร',
    9: 'เบอร์โทร',
    10: 'LINE ID',
    11: 'ผู้ติดต่อ / ชื่อเล่น',
    12: 'หมายเหตุ / ชื่อที่ควรรวม',
  });
  const d = sheet(w, 'เอกสารและชำระเงิน', {
    1: 'รหัส',
    2: 'ชื่ออ้างอิง',
    3: 'เลขประจำตัว / ผู้เสียภาษี 13 หลัก',
    4: 'รหัสสาขา 5 หลัก (นิติบุคคล)',
    5: 'จด VAT',
    6: 'ที่อยู่ตามเอกสารฉบับเต็ม',
    7: 'รหัสไปรษณีย์',
    8: 'ธนาคาร (ถ้ามี)',
    9: 'ชื่อบัญชี (ถ้ามี)',
    10: 'เลขบัญชี (ถ้ามี)',
    11: 'เครดิตกี่วัน (ถ้ามี)',
    12: 'หมายเหตุเอกสาร / การชำระเงิน',
    13: 'เงื่อนไข VAT ในการซื้อของร้าน',
  });
  const docs = new Map<string, number>();
  d.eachRow((row, n) => {
    if (n < 5) return;
    const ref = text(row.getCell(1));
    if (!ref) return;
    if (docs.has(ref)) throw Error('SUPPLIER_SHEET_REF_DUPLICATE');
    docs.set(ref, n);
  });
  const profiles = new Map<string, string>();
  const channelSheet = w.getWorksheet('เอกสารตามช่องทาง');
  if (
    channelSheet &&
    ['รหัสกลุ่ม', 'ชื่ออ้างอิง', 'ขอบเขตที่ตรวจพบ'].some(
      (label, i) => text(channelSheet.getCell(1, i + 1)) !== label,
    )
  )
    throw Error('SUPPLIER_WORKBOOK_LAYOUT_MISMATCH');
  channelSheet?.eachRow((row, n) => {
    if (n > 1 && text(row.getCell(1))) {
      const ref = text(row.getCell(1))!;
      if (profiles.has(ref)) throw Error('SUPPLIER_LEGAL_PROFILE_DUPLICATE');
      profiles.set(ref, text(row.getCell(3)) ?? '');
    }
  });
  const used = new Set<string>();
  const result: SupplierInput[] = [];
  s.eachRow((row, n) => {
    if (n < 5) return;
    const supplierRef = text(row.getCell(1));
    if (!supplierRef) return;
    const dn = docs.get(supplierRef);
    if (!dn) throw Error('SUPPLIER_SHEET_REF_MISMATCH');
    used.add(supplierRef);
    const v = (col: number, id = false) => text(d.getCell(dn, col), id);
    const a = (col: number, id = false) => text(row.getCell(col), id);
    const profile = profiles.get(supplierRef);
    const bank = { bankName: v(8), bankAccountName: v(9), bankAccountNumber: v(10, true) };
    const credit = v(11);
    if (a(5) !== 'แยกรายนี้' || a(6)) throw Error('SUPPLIER_MERGE_REQUIRES_REVIEW');
    result.push({
      supplierRef,
      displayName: a(2) ?? '',
      aliases: [
        ...new Set([a(2) ?? '', ...(a(4) ?? '').split('/').map((x) => x.trim())].filter(Boolean)),
      ],
      legalName: a(8),
      type: a(7) === 'บุคคลธรรมดา' ? 'INDIVIDUAL' : a(7) === 'นิติบุคคล' ? 'JURISTIC' : null,
      phone: a(9, true),
      lineId: a(10),
      contactName: a(11),
      address: v(6),
      postalCode: v(7, true),
      taxId: v(3, true),
      branchCode: v(4, true),
      hasVat: v(5) === 'จด VAT' ? true : v(5) === 'ไม่จด VAT' ? false : null,
      creditTermDays: credit === null ? null : Number(credit),
      bankAccounts: Object.values(bank).some(Boolean) ? [bank] : [],
      legalProfileScope:
        profile === undefined
          ? 'GROUP'
          : profile.startsWith('ทั้งกลุ่ม') && profile.includes('คำยืนยันเจ้าของ')
            ? 'OWNER_ADOPTED_GROUP'
            : 'CHANNEL_ONLY',
      notes: [a(12), v(12)].filter(Boolean).join('\n') || null,
      purchaseVatTerms: v(13),
      evidenceRefs: [
        { workbookSha256, sheet: s.name, row: n },
        { workbookSha256, sheet: d.name, row: dn },
      ],
    });
  });
  if (!result.length || [...docs.keys()].some((ref) => !used.has(ref)))
    throw Error('SUPPLIER_SHEET_REF_MISMATCH');
  return result;
}
export function validateSupplierInputs(rows: SupplierInput[]): SupplierValidation {
  const issues: SupplierValidation['issues'] = [];
  const refs = new Set<string>(),
    aliases = new Map<string, string>();
  const identities = new Map<string, string>();
  const add = (r: SupplierInput, code: string, field: string) =>
    issues.push({
      supplierRef: r.supplierRef,
      code,
      field,
      evidenceRef: r.evidenceRefs[0] ?? null,
    });
  for (const r of rows) {
    if (!/^SUP\d+$/.test(r.supplierRef)) add(r, 'SUPPLIER_REF_INVALID', 'supplierRef');
    if (refs.has(r.supplierRef)) add(r, 'SUPPLIER_REF_DUPLICATE', 'supplierRef');
    refs.add(r.supplierRef);
    for (const alias of r.aliases) {
      const key = normalizeSupplierAlias(alias),
        owner = aliases.get(key);
      if (owner && owner !== r.supplierRef) add(r, 'SUPPLIER_ALIAS_CONFLICT', 'aliases');
      aliases.set(key, r.supplierRef);
    }
    for (const [field, value] of [
      ['legalName', r.legalName ? normalizeSupplierAlias(r.legalName) : null],
      ['taxId', r.taxId],
      ...r.bankAccounts.map((b) => [
        'bankAccountNumber',
        b.bankAccountNumber?.replace(/[\s-]/g, ''),
      ]),
    ]) {
      if (!value) continue;
      const key = field + ':' + value,
        owner = identities.get(key);
      if (owner && owner !== r.supplierRef) add(r, 'SUPPLIER_IDENTITY_CONFLICT', field!);
      identities.set(key, r.supplierRef);
    }
    if (!['INDIVIDUAL', 'JURISTIC'].includes(r.type ?? ''))
      add(r, 'SUPPLIER_TYPE_REQUIRED', 'type');
    if (!r.legalName?.trim()) add(r, 'SUPPLIER_NAME_REQUIRED', 'legalName');
    if (!r.phone?.trim()) add(r, 'SUPPLIER_PHONE_REQUIRED', 'phone');
    if (typeof r.hasVat !== 'boolean') add(r, 'SUPPLIER_VAT_REQUIRED', 'hasVat');
    if (
      r.creditTermDays === null ||
      !Number.isInteger(r.creditTermDays) ||
      r.creditTermDays < 0 ||
      r.creditTermDays > 365
    )
      add(r, 'SUPPLIER_CREDIT_INVALID', 'creditTermDays');
    if (r.taxId && !/^\d{13}$/.test(r.taxId)) add(r, 'SUPPLIER_TAX_ID_INVALID', 'taxId');
    if (r.branchCode && !/^\d{5}$/.test(r.branchCode))
      add(r, 'SUPPLIER_BRANCH_INVALID', 'branchCode');
    if (!['GROUP', 'OWNER_ADOPTED_GROUP'].includes(r.legalProfileScope))
      add(r, 'SUPPLIER_LEGAL_SCOPE_UNRESOLVED', 'legalProfileScope');
    if (r.bankAccounts.some((a) => !a.bankName || !a.bankAccountName || !a.bankAccountNumber))
      add(r, 'SUPPLIER_BANK_INCOMPLETE', 'bankAccounts');
  }
  return { rows, issues };
}

export async function assertSupplierWorkbookInput(
  path: string | undefined,
  sha: string,
  rows: SupplierInput[],
) {
  if (!path) throw Error('SUPPLIER_WORKBOOK_REQUIRED');
  const original = await readSupplierWorkbook(path);
  if (original[0]?.evidenceRefs[0]?.workbookSha256 !== sha || hash(original) !== hash(rows))
    throw Error('SUPPLIER_WORKBOOK_INPUT_MISMATCH');
}
