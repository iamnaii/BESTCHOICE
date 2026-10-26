import { Prisma } from '@prisma/client';
import { TRASH_GROUPS, TRASH_REGISTRY, trashEntry } from '../trash-registry';

/** ก้อน 8 A10 — allow-list เดียวของถังขยะ (สเปก §4) */
describe('trash registry', () => {
  it('R1 types are unique and every entry has a label and a known group', () => {
    const types = TRASH_REGISTRY.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
    for (const e of TRASH_REGISTRY) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(TRASH_GROUPS as readonly string[]).toContain(e.group);
    }
    expect(types.length).toBeGreaterThanOrEqual(30);
  });

  it('R2 every model is a Prisma delegate whose model has a deletedAt field', () => {
    const models = Prisma.dmmf.datamodel.models;
    const problems: string[] = [];
    for (const e of TRASH_REGISTRY) {
      const modelName = e.model.charAt(0).toUpperCase() + e.model.slice(1);
      const model = models.find((m) => m.name === modelName);
      if (!model) { problems.push(`${e.type}: model ${modelName} missing`); continue; }
      if (!model.fields.some((f) => f.name === 'deletedAt')) problems.push(`${e.type}: no deletedAt`);
      for (const key of Object.keys(e.select)) if (!model.fields.some((f) => f.name === key)) problems.push(`${e.type}: select.${key} not a field of ${modelName}`);
    }
    expect(problems).toEqual([]);
  });

  it('R3 extraWhere mirrors what the delete buttons allow (merged customers, non-draft docs, paid bookings never enter)', () => {
    expect(trashEntry('customer')!.extraWhere).toEqual({ mergedIntoId: null });
    expect(trashEntry('contract')!.extraWhere).toMatchObject({ status: 'DRAFT' });
    expect(trashEntry('booking')!.extraWhere).toEqual({ status: 'PENDING_DEPOSIT' });
    expect(trashEntry('repair_ticket')!.extraWhere).toEqual({ status: 'CANCELLED' });
    for (const t of ['expense_document', 'other_income', 'fixed_asset']) expect(trashEntry(t)!.extraWhere).toEqual({ status: 'DRAFT' });
  });

  it('R4 product and contract are not directly restorable; product points at the FOUND request', () => {
    const product = trashEntry('product')!;
    const contract = trashEntry('contract')!;
    expect(product.restorable).not.toBe(true);
    expect(contract.restorable).not.toBe(true);
    const r = product.restorable as { actionLabel?: string; linkFor?: (row: unknown) => string | undefined };
    expect(r.actionLabel).toBe('ขอพบของคืน');
    expect(r.linkFor!({ imeiSerial: '35x' })).toBe('/stock/adjustments?request=found&q=35x');
    expect((contract.restorable as { reason: string }).reason).toMatch(/ทำสัญญาใหม่/);
  });

  it('R5 types whose delete flipped a flag and whose page has a switch come back disabled and say where (§13.1)', () => {
    for (const t of ['sms_template', 'reverse_reason', 'payment_method_config', 'chat_knowledge', 'supplier', 'branch']) {
      const e = trashEntry(t)!;
      expect(e.restoreData).toBeUndefined();
      expect(e.warnings!({}).some((w) => w.includes('ยังปิดใช้งาน'))).toBe(true);
    }
    expect(trashEntry('promotion')!.warnings).toBeUndefined();
    // ไม่มีสวิตช์บนหน้าจอ → กู้แล้วเปิดใช้งานเลย พร้อมเตือน (รีวิว Important 1)
    expect(trashEntry('notification_template')!.restoreData!({})).toEqual({ isActive: true });
    expect(trashEntry('notification_template')!.warnings!({}).some((w) => w.includes('ส่งตาม event ทันที'))).toBe(true);
    expect(trashEntry('interest_config')!.restoreData!({})).toEqual({ isActive: true });
    expect(trashEntry('interest_config')!.check).toBeDefined();
    // การลบไฟแนนซ์นอกไม่ได้ปิด flag → ไม่เตือนเรื่องปิดใช้งาน
    expect(trashEntry('external_finance_company')!.warnings).toBeUndefined();
    expect(trashEntry('sms_template')!.warnings!({})[0]).toContain('สื่อสารลูกค้า');
  });

  it('R9 expense documents retired by the recurring-bill system (audit newValue.reason) are blocked', () => {
    const e = trashEntry('expense_document')!;
    expect(e.auditBlocks!({ newValue: { reason: 'RULE_CHANGED' } })).toMatch(/บิลประจำ/);
    expect(e.auditBlocks!({ newValue: { deletedAt: 'x' } })).toBeNull();
    expect(e.auditBlocks!({ newValue: null })).toBeNull();
    expect(trashEntry('customer')!.auditBlocks).toBeUndefined();
  });

  it('R6 customer row masks the phone', () => {
    const row = trashEntry('customer')!.toRow({ id: 'c1', name: 'สมหญิง', phone: '0812345678', email: null });
    expect(row.title).toBe('สมหญิง');
    expect(row.subtitle).not.toContain('0812345678');
    expect(row.link).toBe('/customers/c1');
  });

  it('R8 every entry names the audit entities the deletion was logged under; legal case uses contractId', () => {
    for (const e of TRASH_REGISTRY) expect(e.auditEntities.length).toBeGreaterThan(0);
    expect(trashEntry('legal_case')!.auditEntityId!({ contractId: 'ct-1' })).toBe('ct-1');
    expect(trashEntry('expense_document')!.auditEntities).toEqual(['expense-documents', 'expense_document']);
  });

  it('R7 unknown type → undefined', () => {
    expect(trashEntry('nope')).toBeUndefined();
  });
});
