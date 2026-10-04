import { readFileSync } from 'fs';
import { join } from 'path';
import { DocumentsHarness, Session, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { StorageService } from '../../src/modules/storage/storage.service';
import { KycService } from '../../src/modules/kyc/kyc.service';
import { TEST_CUSTOMER_ADDRESS } from '../../src/utils/test-data-markers';

const SYNTHETIC_ID_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC';

// Real login/guards/services + disposable dual PostgreSQL + private local storage.
// Only outbound SMS is recorded; no customer number or production data is used.
describe('KYC evidence acceptance through the real AppModule', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let owner: Session;
  let sales: Session;
  const route = (step: string) => `/contracts/${world.contracts.a.id}/kyc/${step}`;
  const sentOtp = () => {
    const message = h.external.calls.filter((call) => call.channel === 'sms').at(-1)?.summary;
    const otp = message?.match(/OTP: (\d{6})/)?.[1];
    if (!otp) throw new Error('Synthetic SMS transport did not receive an OTP');
    return otp;
  };

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    owner = await h.login(world.users.owner.email, world.users.owner.password);
    sales = await h.login(world.users.salesA.email, world.users.salesA.password);
  }, 180000);
  afterAll(async () => { await h?.close(); });

  it('keeps test bypass OFF, restricts changes to OWNER and rejects unauthenticated uploads', async () => {
    await h.client({ session: owner }).put('/settings/test-mode', { enabled: false }).expect(200);
    await h.client({ session: sales }).put('/settings/test-mode', { enabled: true }).expect(403);
    const mode = await h.client({ session: sales }).get('/settings/test-mode').expect(200);
    expect(mode.body.data.enabled).toBe(false);
    await h.client().post(route('upload-id-card'), { imageBase64: SYNTHETIC_ID_IMAGE }).expect(401);
    await h.client({ session: sales }).post(route('upload-id-card'), { imageBase64: SYNTHETIC_ID_IMAGE }).expect(400);
  });

  it('rejects wrong OTP, accepts the sent code and persists exact image bytes before VERIFIED', async () => {
    const client = h.client({ session: sales });
    await client.post(route('send-otp')).expect(201);
    await client.post(route('verify-otp'), { otp: '000000' }).expect(400);
    const pending = await h.prisma.kycVerification.findFirstOrThrow({ where: { contractId: world.contracts.a.id, status: 'PENDING' } });
    expect(pending.otpAttempts).toBe(1);
    await client.post(route('verify-otp'), { otp: sentOtp() }).expect(201);
    await client.post(route('upload-id-card'), { imageBase64: SYNTHETIC_ID_IMAGE }).expect(201);
    const verified = await h.prisma.kycVerification.findUniqueOrThrow({ where: { id: pending.id } });
    expect(verified.status).toBe('VERIFIED');
    expect(verified.idCardVerified).toBe(true);
    expect(verified.idCardImageUrl).toMatch(/\.png$/);
    expect(readFileSync(join(h.storage.location, verified.idCardImageUrl!))).toEqual(Buffer.from(SYNTHETIC_ID_IMAGE.split(',')[1], 'base64'));
    const status = await client.get(route('status')).expect(200);
    expect(status.body.data).toMatchObject({ status: 'VERIFIED', otpVerified: true, idCardUploaded: true });
  });

  it('rejects expired OTP without enabling the upload step', async () => {
    const client = h.client({ session: sales });
    const base = `/contracts/${world.contracts.b.id}/kyc`;
    // OWNER has access to the second synthetic branch.
    const ownerClient = h.client({ session: owner });
    await ownerClient.post(`${base}/send-otp`).expect(201);
    await h.prisma.kycVerification.updateMany({ where: { contractId: world.contracts.b.id, status: 'PENDING' }, data: { expiresAt: new Date(Date.now() - 60000) } });
    await ownerClient.post(`${base}/verify-otp`, { otp: sentOtp() }).expect(400);
    await ownerClient.post(`${base}/upload-id-card`, { imageBase64: SYNTHETIC_ID_IMAGE }).expect(400);
    expect((await client.get(route('status')).expect(200)).body.data.status).toBe('VERIFIED');
  });

  it('leaves OTP_VERIFIED when storage fails and rejects a resend race after upload', async () => {
    const client = h.client({ session: sales });
    await client.post(route('send-otp')).expect(201);
    await client.post(route('verify-otp'), { otp: sentOtp() }).expect(201);
    const row = await h.prisma.kycVerification.findFirstOrThrow({ where: { contractId: world.contracts.a.id, status: 'OTP_VERIFIED' } });
    const storage = h.app.get(StorageService);
    const upload = jest.spyOn(storage, 'upload').mockRejectedValueOnce(new Error('Synthetic storage failure'));
    try {
      await client.post(route('upload-id-card'), { imageBase64: SYNTHETIC_ID_IMAGE }).expect(500);
      expect((await h.prisma.kycVerification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('OTP_VERIFIED');
      upload.mockImplementationOnce(async (key) => {
        await h.prisma.kycVerification.update({ where: { id: row.id }, data: { status: 'EXPIRED' } });
        return key;
      });
      // The HTTP upload quota was exercised above; test the database race directly
      // through the same AppModule service so throttling cannot mask this assertion.
      await expect(h.app.get(KycService).uploadIdCard(world.contracts.a.id, SYNTHETIC_ID_IMAGE, {})).rejects.toThrow();
      expect((await h.prisma.kycVerification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
    } finally { upload.mockRestore(); }
  });

  it('requires approved credit before contract creation with real guards and bypass OFF', async () => {
    const client = h.client({ session: owner });
    await h.prisma.branch.update({ where: { id: world.branches.a.id }, data: { shopCashAccountCode: 'S11-1101' } });
    const customer = await h.prisma.customer.create({ data: { name: `ทดสอบระบบ CREDIT ${world.prefix}`, phone: '0800000002', salary: 15000, salaryPayDay: 25, addressCurrent: TEST_CUSTOMER_ADDRESS } });
    const check = await h.prisma.creditCheck.create({ data: { customerId: customer.id, status: 'MANUAL_REVIEW', checkType: 'FULL', statementFiles: ['synthetic-statement.pdf'], aiAnalysis: { monthlyIncome: 15000, monthlyExpense: 9000 } } });
    const product = await h.prisma.product.create({ data: { name: `ทดสอบระบบ PHONE ${world.prefix}`, brand: 'SYNTHETIC', model: 'TEST', category: 'PHONE_NEW', costPrice: 5000, branchId: world.branches.a.id, imeiSerial: `TEST-${world.prefix}-CREDIT`, status: 'IN_STOCK' } });
    const dto = { customerId: customer.id, productId: product.id, branchId: world.branches.a.id, sellingPrice: 10000, downPayment: 2000, totalMonths: 12, interestRate: 0, paymentDueDay: 25 };
    const rejected = await client.post('/contracts', dto);
    expect({ status: rejected.status, body: rejected.body }).toMatchObject({ status: 400 });
    expect(JSON.stringify(rejected.body)).toContain('เครดิต');
    expect(await h.prisma.contract.count({ where: { customerId: customer.id } })).toBe(0);
    const basis = { verifiedMonthlyIncome: 15000, livingExpenses: 9000, externalMonthlyDebt: 0, salaryPayDay: 25, evidenceNotes: 'ข้อมูลสังเคราะห์ ยืนยันรายได้ รายจ่าย หนี้ภายนอก และวันรับเงิน' };
    const preview = await client.post(`/credit-checks/${check.id}/affordability`, basis).expect(201);
    await client.post(`/customers/${customer.id}/credit-check/${check.id}/override`, { status: 'APPROVED', overrideReason: 'ทดสอบระบบ อนุมัติวงเงินตามฐานรายได้สังเคราะห์', affordability: { ...basis, approvedMonthlyPayment: 2500, confirmed: true, contextToken: preview.body.data.contextToken } }).expect(201);
    const created = await client.post('/contracts', dto);
    if (created.status !== 201) throw new Error(`Synthetic contract creation failed: ${JSON.stringify(created.body)}`);
    expect({ status: created.status, body: created.body }).toMatchObject({ status: 201 });
    const approval = await h.prisma.creditApproval.findFirstOrThrow({ where: { creditCheckId: check.id } });
    expect(approval.usedByContractId).toBe(created.body.data.id);
    expect(await h.prisma.payment.count({ where: { contractId: created.body.data.id } })).toBe(12);
    expect((await client.get('/settings/test-mode').expect(200)).body.data.enabled).toBe(false);
  });
});
