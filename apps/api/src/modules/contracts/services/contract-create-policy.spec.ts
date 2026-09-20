import { Prisma } from '@prisma/client';
import { assertCustomerContractPolicy, contractDownTender } from './contract-create-policy';
import { normalizeTenders } from '../../shop-tenders/shop-tender.util';

describe('shared contract creation policy', () => {
  const tx = { contract: { findMany: jest.fn().mockResolvedValue([{ id: 'active', contractNumber: 'ACTIVE-1', status: 'ACTIVE' }]) } };
  it.each(['OWNER', 'BRANCH_MANAGER'])('allows a deliberate %s active-contract override', async role => {
    await expect(assertCustomerContractPolicy(tx as unknown as Prisma.TransactionClient, 'customer', role, true)).resolves.toBeUndefined();
    await expect(assertCustomerContractPolicy(tx as unknown as Prisma.TransactionClient, 'customer', role, false)).rejects.toMatchObject({ response: { code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', canOverride: true } });
  });
  it('does not let SALES bypass the policy with a forged flag', async () => {
    await expect(assertCustomerContractPolicy(tx as unknown as Prisma.TransactionClient, 'customer', 'SALES', true)).rejects.toMatchObject({ response: { canOverride: false } });
  });
  it('records no tender, date or reference when no additional money is received', () => {
    expect(contractDownTender(normalizeTenders(undefined, 0, { method: 'BANK_TRANSFER', reference: 'unused' }))).toEqual({ downPaymentMethod: null, downPaymentReceivedAt: null, downPaymentReference: null });
    expect(contractDownTender(normalizeTenders(undefined, 2000, { method: 'BANK_TRANSFER', reference: ' transfer-1 ' }))).toMatchObject({ downPaymentMethod: 'BANK_TRANSFER', downPaymentReceivedAt: expect.any(Date), downPaymentReference: 'transfer-1' });
  });
  it('keeps the primary method and the first transfer reference of a split down payment', () => {
    const tenders = normalizeTenders([{ method: 'CASH', amount: 2000 }, { method: 'QR_EWALLET', amount: 3000, reference: 'QR5569012044' }], 5000);
    expect(contractDownTender(tenders)).toMatchObject({ downPaymentMethod: 'CASH', downPaymentReference: 'QR5569012044' });
  });
});
