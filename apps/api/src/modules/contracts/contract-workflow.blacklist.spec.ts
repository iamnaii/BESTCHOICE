/**
 * ก้อน 5 C3 — ด่าน blacklist ใน activate() (จุดที่สัญญาเริ่มมีผลจริง)
 * ประกอบ service ด้วย stub แล้ว spy findOne — ด่านต้องอยู่ก่อน verifyContractHash และนอก $transaction
 * เคสเต็ม (ร่าง 2 ใบ · tag ทีหลัง · override ที่บันทึกไว้) อยู่ที่ e2e/credit-payment-flow.e2e-spec.ts
 */
import { ContractWorkflowService } from './contract-workflow.service';

const stub = {} as never;
function build(opts: { exchanged: boolean; level: 'NONE' | 'SOFT' | 'HARD'; persisted?: boolean; parentStatus?: string }) {
  const prisma = { $transaction: jest.fn(), contract: { findUnique: jest.fn().mockResolvedValue(opts.parentStatus ? { status: opts.parentStatus } : null) } };
  const reasons = opts.level === 'NONE' ? [] : [{ code: opts.level === 'HARD' ? 'MANUAL_TAG' : 'REFERENCES_BLACKLISTED', level: opts.level, message: 'x' }];
  const blacklist = { evaluate: jest.fn().mockResolvedValue({ level: opts.level, reasons, checkedAt: 't' }) };
  const service = new ContractWorkflowService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, blacklist as never);
  jest.spyOn(service as unknown as { findOne: () => Promise<unknown> }, 'findOne').mockResolvedValue({
    id: 'c1', customerId: 'cust-1', workflowStatus: 'APPROVED', status: 'DRAFT', pdpaConsentId: 'pdpa-1',
    exchangedFromContractId: opts.exchanged ? 'old-contract' : null,
    parentContractId: opts.parentStatus ? 'parent-contract' : null,
    blacklistOverriddenAt: opts.persisted ? new Date('2026-10-24T00:00:00Z') : null,
    documents: [], signatures: [], payments: [],
  });
  return { service, blacklist, prisma };
}

describe('ContractWorkflowService.activate — blacklist gate', () => {
  it('skips the blacklist gate for an exchange contract (the old contract is legitimately ACTIVE)', async () => {
    const { service, blacklist } = build({ exchanged: true, level: 'HARD' });
    await service.activate('c1').catch(() => undefined); // ล้มทีหลังที่ด่าน hash/ลายเซ็น — ไม่ใช่ประเด็น
    expect(blacklist.evaluate).not.toHaveBeenCalled();
  });

  it('HARD blocks activation before the transaction opens', async () => {
    const { service, blacklist, prisma } = build({ exchanged: false, level: 'HARD' });
    await expect(service.activate('c1')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLISTED', level: 'HARD' } });
    expect(blacklist.evaluate).toHaveBeenCalledWith('cust-1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('SOFT without a persisted override blocks with the activate-stage message', async () => {
    const { service, prisma } = build({ exchanged: false, level: 'SOFT' });
    await expect(service.activate('c1')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false,
      message: expect.stringContaining('ให้ OWNER/ผู้จัดการสาขาเป็นผู้เปิดใช้สัญญาพร้อมเหตุผล') } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('SOFT with a persisted override passes the gate and continues to the later checks', async () => {
    const { service, blacklist } = build({ exchanged: false, level: 'SOFT', persisted: true });
    const err = await service.activate('c1').catch((e: unknown) => e);
    expect(blacklist.evaluate).toHaveBeenCalledWith('cust-1');
    // ล้มทีหลังที่ด่าน hash/ลายเซ็น (stub) — แต่ต้องไม่ใช่ 409 ของด่าน blacklist
    expect(String((err as { response?: { code?: string } })?.response?.code ?? '')).not.toMatch(/CUSTOMER_BLACKLIST/);
  });

  it('skips the gate for a defect-exchange replacement (parent contract DEFECT_EXCHANGED) — continuation of the same customer', async () => {
    const { service, blacklist } = build({ exchanged: false, level: 'HARD', parentStatus: 'DEFECT_EXCHANGED' });
    await service.activate('c1').catch(() => undefined);
    expect(blacklist.evaluate).not.toHaveBeenCalled();
  });

  it('a parentContractId whose parent is not DEFECT_EXCHANGED does not skip the gate', async () => {
    const { service, blacklist } = build({ exchanged: false, level: 'HARD', parentStatus: 'ACTIVE' });
    await expect(service.activate('c1')).rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLISTED' } });
    expect(blacklist.evaluate).toHaveBeenCalledWith('cust-1');
  });

  it('SOFT without persisted override: OWNER can override at activation with a reason; FINANCE_MANAGER cannot', async () => {
    const owner = build({ exchanged: false, level: 'SOFT' });
    const err = await owner.service.activate('c1', 'owner-1', { actorRole: 'OWNER', blacklistOverrideReason: 'ผู้จัดการตรวจแล้ว ไม่ใช่คนเดียวกัน' }).catch((e: unknown) => e);
    expect(String((err as { response?: { code?: string } })?.response?.code ?? '')).not.toMatch(/CUSTOMER_BLACKLIST/);
    const fm = build({ exchanged: false, level: 'SOFT' });
    await expect(fm.service.activate('c1', 'fm-1', { actorRole: 'FINANCE_MANAGER', blacklistOverrideReason: 'ผู้จัดการตรวจแล้ว ไม่ใช่คนเดียวกัน' }))
      .rejects.toMatchObject({ response: { code: 'CUSTOMER_BLACKLIST_REVIEW', canOverride: false } });
    expect(fm.prisma.$transaction).not.toHaveBeenCalled();
  });
});
