/**
 * ก้อน 5 C3 — ด่าน blacklist ใน activate() (จุดที่สัญญาเริ่มมีผลจริง)
 * ประกอบ service ด้วย stub แล้ว spy findOne — ด่านต้องอยู่ก่อน verifyContractHash และนอก $transaction
 * เคสเต็ม (ร่าง 2 ใบ · tag ทีหลัง · override ที่บันทึกไว้) อยู่ที่ e2e/credit-payment-flow.e2e-spec.ts
 */
import { ContractWorkflowService } from './contract-workflow.service';

const stub = {} as never;
function build(opts: { exchanged: boolean; level: 'NONE' | 'SOFT' | 'HARD'; persisted?: boolean }) {
  const prisma = { $transaction: jest.fn() };
  const reasons = opts.level === 'NONE' ? [] : [{ code: opts.level === 'HARD' ? 'MANUAL_TAG' : 'REFERENCES_BLACKLISTED', level: opts.level, message: 'x' }];
  const blacklist = { evaluate: jest.fn().mockResolvedValue({ level: opts.level, reasons, checkedAt: 't' }) };
  const service = new ContractWorkflowService(prisma as never, stub, stub, stub, stub, stub, stub, stub, stub, stub, blacklist as never);
  jest.spyOn(service as unknown as { findOne: () => Promise<unknown> }, 'findOne').mockResolvedValue({
    id: 'c1', customerId: 'cust-1', workflowStatus: 'APPROVED', status: 'DRAFT', pdpaConsentId: 'pdpa-1',
    exchangedFromContractId: opts.exchanged ? 'old-contract' : null,
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
      message: expect.stringContaining('ลบร่างนี้แล้วสร้างสัญญาใหม่') } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('SOFT with a persisted override passes the gate and continues to the later checks', async () => {
    const { service, blacklist } = build({ exchanged: false, level: 'SOFT', persisted: true });
    const err = await service.activate('c1').catch((e: unknown) => e);
    expect(blacklist.evaluate).toHaveBeenCalledWith('cust-1');
    // ล้มทีหลังที่ด่าน hash/ลายเซ็น (stub) — แต่ต้องไม่ใช่ 409 ของด่าน blacklist
    expect(String((err as { response?: { code?: string } })?.response?.code ?? '')).not.toMatch(/CUSTOMER_BLACKLIST/);
  });
});
