/**
 * CustomerBlacklistService — ก้อน 5 C3 (spec docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md)
 * Prisma ถูก mock ระดับ query · CustomerPiiService ของจริง (plaintext path — ไม่มี PII_ENCRYPTION_KEY, มี salt)
 */
import { CustomerBlacklistService } from './customer-blacklist.service';
import { CustomerPiiService } from './customer-pii.service';

const SALT = 'test-salt-0123456789abcdefghijklmnopqrstuv';
type Row = Record<string, unknown>;

function build({ customers = [], set = [], contracts = [], tags = [] }: { customers?: Row[]; set?: Row[]; contracts?: Row[]; tags?: Row[] }) {
  const prisma = {
    customer: {
      findMany: jest.fn(async (args: { where?: { id?: { in?: string[] } } }) =>
        args?.where?.id?.in ? customers.filter((c) => args.where!.id!.in!.includes(c.id as string)) : set),
    },
    contract: {
      findMany: jest.fn(async (args: { where: { customerId: { in: string[] } } }) =>
        contracts.filter((c) => args.where.customerId.in.includes(c.customerId as string))),
    },
    customerTag: {
      findMany: jest.fn(async (args: { where: { customerId: { in: string[] } } }) =>
        tags.filter((t) => args.where.customerId.in.includes(t.customerId as string))),
    },
  };
  const pii = new CustomerPiiService(prisma as never);
  return { prisma, pii, service: new CustomerBlacklistService(prisma as never, pii) };
}
const cust = (id: string, extra: Row = {}): Row => ({
  id, name: `ลูกค้า ${id}`, phone: null, phoneSecondary: null, phoneHash: null, phoneEncrypted: null,
  phoneSecondaryEncrypted: null, references: null, referencesEncrypted: null, mergedIntoId: null, ...extra,
});
const contract = (customerId: string, contractNumber: string, status: string, extra: Row = {}): Row => ({
  id: `ct-${contractNumber}`, customerId, contractNumber, status, repossession: null, deviceReturns: [], ...extra,
});
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe('CustomerBlacklistService', () => {
  beforeAll(() => { process.env.PII_HASH_SALT = SALT; delete process.env.PII_ENCRYPTION_KEY; });

  it('NONE for a clean customer', async () => {
    const { service } = build({ customers: [cust('x', { phone: '0812345678' })] });
    await expect(service.evaluate('x')).resolves.toMatchObject({ level: 'NONE', reasons: [] });
  });

  it('ACTIVE_CONTRACT per live contract, DEFAULT reads ผิดนัด', async () => {
    const { service } = build({ customers: [cust('x')], contracts: [
      contract('x', 'CT-A', 'ACTIVE'), contract('x', 'CT-D', 'DEFAULT'), contract('x', 'CT-DRAFT', 'DRAFT'),
    ] });
    const r = await service.evaluate('x');
    expect(r.level).toBe('HARD');
    expect(codes(r)).toEqual(['ACTIVE_CONTRACT', 'ACTIVE_CONTRACT']);
    expect(r.reasons[0]).toMatchObject({ level: 'HARD', contractNumber: 'CT-A', message: expect.stringContaining('1 คนผ่อนได้ 1 เครื่อง') });
    expect(r.reasons[1].message).toContain('ผิดนัด');
  });

  it('TERMINATED without device return reads ยังไม่ได้รับเครื่องคืน', async () => {
    const { service } = build({ customers: [cust('x')], contracts: [contract('x', 'CT-T', 'TERMINATED')] });
    const r = await service.evaluate('x');
    expect(r.reasons).toEqual([expect.objectContaining({ code: 'TERMINATED_UNRETURNED', level: 'HARD', contractNumber: 'CT-T',
      message: 'สัญญา CT-T ถูกบอกเลิกแล้วแต่ยังไม่ได้รับเครื่องคืน' })]);
  });

  it('TERMINATED with a pending device return names the DR number', async () => {
    const { service } = build({ customers: [cust('x')], contracts: [contract('x', 'CT-T', 'TERMINATED', { deviceReturns: [{ docNumber: 'DR-TEST' }] })] });
    const r = await service.evaluate('x');
    expect(r.reasons[0].message).toBe('สัญญา CT-T รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน (ใบ DR-TEST)');
    expect(r.level).toBe('HARD');
  });

  it('REPOSSESSED voluntary vs seized wording, no duplicate BAD_DEBT', async () => {
    const repo = (deviceReturn: Row | null) => ({ id: 'rp', createdAt: new Date('2026-09-20T03:00:00Z'), deletedAt: null, deviceReturn });
    const { service } = build({ customers: [cust('x')], contracts: [
      contract('x', 'CT-V', 'CLOSED_BAD_DEBT', { repossession: repo({ returnKind: 'VOLUNTARY', deviceReceivedAt: new Date('2026-09-19T03:00:00Z') }) }),
      contract('x', 'CT-S', 'CLOSED_BAD_DEBT', { repossession: repo(null) }),
    ] });
    const r = await service.evaluate('x');
    expect(codes(r)).toEqual(['REPOSSESSED', 'REPOSSESSED']);
    expect(r.reasons[0].message).toMatch(/^เคยเอาเครื่องมาคืนเอง \(สัญญา CT-V · /);
    expect(r.reasons[1].message).toMatch(/^เคยถูกยึดเครื่อง \(สัญญา CT-S · /);
  });

  it('BAD_DEBT when CLOSED_BAD_DEBT has no repossession', async () => {
    const { service } = build({ customers: [cust('x')], contracts: [contract('x', 'CT-B', 'CLOSED_BAD_DEBT')] });
    const r = await service.evaluate('x');
    expect(r.reasons).toEqual([expect.objectContaining({ code: 'BAD_DEBT', message: 'เคยถูกตัดเป็นหนี้สูญ (สัญญา CT-B)' })]);
  });

  it('ignores a soft-deleted repossession', async () => {
    const { service } = build({ customers: [cust('x')], contracts: [contract('x', 'CT-B', 'CLOSED_BAD_DEBT',
      { repossession: { id: 'rp', createdAt: new Date(), deletedAt: new Date(), deviceReturn: null } })] });
    expect(codes(await service.evaluate('x'))).toEqual(['BAD_DEBT']);
  });

  it('MANUAL_TAG names the user and reason', async () => {
    const { service } = build({ customers: [cust('x')], tags: [
      { customerId: 'x', reason: 'โกงเงินสาขา', createdAt: new Date('2026-10-01T00:00:00Z'), appliedBy: { name: 'เจ้าของร้าน' } },
    ] });
    const r = await service.evaluate('x');
    expect(r.level).toBe('HARD');
    expect(r.reasons[0]).toMatchObject({ code: 'MANUAL_TAG', message: expect.stringMatching(/^ติด tag blacklist โดย เจ้าของร้าน .+: โกงเงินสาขา$/) });
    const noReason = build({ customers: [cust('x')], tags: [{ customerId: 'x', reason: null, createdAt: new Date(), appliedBy: null }] });
    expect((await noReason.service.evaluate('x')).reasons[0].message).toMatch(/^ติด tag blacklist โดย ระบบ [^:]+$/);
  });

  it('PHONE_MATCH by hash and by normalized plaintext, never with self or merged twin', async () => {
    const { pii } = build({});
    const h = pii.hash('0812345678')!;
    const { service } = build({
      customers: [cust('x', { phone: '0812345678', phoneHash: h })],
      set: [
        cust('d', { name: 'ดำ', phoneHash: h }),                       // hash เท่ากัน
        cust('c', { name: 'ชมพู', phone: '081-234-5678' }),             // plaintext รูปแบบต่าง ไม่มี hash
        cust('x', { phone: '0812345678', phoneHash: h }),               // ตัวเอง
        cust('m', { name: 'แฝด', phone: '0812345678', mergedIntoId: 'x' }), // แฝดที่ถูกรวมเข้า x
        cust('o', { name: 'อื่น', phone: '0899999999' }),
      ],
    });
    const r = await service.evaluate('x');
    expect(r.level).toBe('HARD');
    expect(r.reasons).toEqual([
      expect.objectContaining({ code: 'PHONE_MATCH', message: 'เบอร์โทรตรงกับ ดำ ที่ติด blacklist', related: { customerId: 'd', name: 'ดำ' } }),
      expect.objectContaining({ code: 'PHONE_MATCH', related: { customerId: 'c', name: 'ชมพู' } }),
    ]);
  });

  it('a stale stored phoneHash does not match when the plaintext phone differs (findLivePhoneOwner rule)', async () => {
    const { pii } = build({});
    const staleHash = pii.hash('0812345678')!;
    const { service } = build({
      customers: [cust('x', { phone: '0812345678', phoneHash: staleHash })],
      set: [cust('a', { name: 'เอ', phone: '0899999999', phoneHash: staleHash })], // hash ค้างจากเบอร์เดิม — plaintext เป็นเบอร์อื่น
    });
    await expect(service.evaluate('x')).resolves.toMatchObject({ level: 'NONE', reasons: [] });
    const noPlain = build({ customers: [cust('x', { phone: '0812345678', phoneHash: staleHash })], set: [cust('b', { name: 'บี', phone: null, phoneHash: staleHash })] });
    expect((await noPlain.service.evaluate('x')).reasons.map((r) => r.code)).toEqual(['PHONE_MATCH']); // ไม่มี plaintext ให้เทียบ → ใช้ hash ที่เก็บไว้
  });

  it('SOFT reference links both directions', async () => {
    const { pii } = build({});
    const { service } = build({
      customers: [cust('x', { phone: '0812345678', phoneSecondary: '0877777777',
        references: [{ firstName: 'สมชาย', lastName: 'ดี', phone: '089-999-9999', relationship: 'เพื่อน' }] })],
      set: [
        cust('a', { name: 'สมชาย ดี', phone: '0899999999', phoneHash: pii.hash('0899999999') }),
        cust('b', { name: 'สมหญิง', phone: '0866666666', references: [{ firstName: 'x', lastName: 'y', phone: '0877777777' }] }),
      ],
    });
    const r = await service.evaluate('x');
    expect(r.level).toBe('SOFT');
    expect(r.reasons).toEqual([
      expect.objectContaining({ code: 'REFERENCES_BLACKLISTED', level: 'SOFT', message: 'ผู้อ้างอิง "สมชาย ดี" คือ สมชาย ดี ที่ติด blacklist', related: { customerId: 'a', name: 'สมชาย ดี' } }),
      expect.objectContaining({ code: 'REFERENCED_BY_BLACKLISTED', level: 'SOFT', message: 'สมหญิง ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง', related: { customerId: 'b', name: 'สมหญิง' } }),
    ]);
  });

  it('skips phone and reference matching when the customer has no phone', async () => {
    const { service } = build({ customers: [cust('x')], set: [cust('a', { phone: '0899999999', references: [{ phone: '0812345678' }] })] });
    await expect(service.evaluate('x')).resolves.toMatchObject({ level: 'NONE', reasons: [] });
  });

  it('ignores a set member whose references cannot be decrypted', async () => {
    const { service, pii } = build({
      customers: [cust('x', { phone: '0812345678' })],
      set: [cust('e', { phone: '0855555555', referencesEncrypted: [{ phone: 'enc:garbage' }] })],
    });
    jest.spyOn(pii, 'decryptCustomerFields').mockImplementation((row) => {
      if ((row as Row).id === 'e') throw new Error('bad ciphertext');
      return row;
    });
    await expect(service.evaluate('x')).resolves.toMatchObject({ level: 'NONE', reasons: [] });
  });

  it('evaluateMany loads the set once and returns a map keyed by id', async () => {
    const { service, prisma } = build({ customers: [cust('x'), cust('y')], contracts: [contract('y', 'CT-Y', 'OVERDUE')] });
    const r = await service.evaluateMany(['x', 'y']);
    expect(Object.keys(r).sort()).toEqual(['x', 'y']);
    expect(r.x.level).toBe('NONE'); expect(r.y.level).toBe('HARD');
    expect(prisma.customer.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.customerTag.findMany).toHaveBeenCalledTimes(1);
    expect(typeof r.x.checkedAt).toBe('string');
  });
});
