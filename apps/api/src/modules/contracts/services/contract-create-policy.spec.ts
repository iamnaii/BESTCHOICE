import { Prisma } from '@prisma/client';
import { assertCustomerContractPolicy, contractDownTender } from './contract-create-policy';

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
    expect(contractDownTender(0, 'BANK_TRANSFER', 'unused')).toEqual({ downPaymentMethod: null, downPaymentReceivedAt: null, downPaymentReference: null });
    expect(contractDownTender(2000, 'BANK_TRANSFER', ' transfer-1 ')).toMatchObject({ downPaymentMethod: 'BANK_TRANSFER', downPaymentReceivedAt: expect.any(Date), downPaymentReference: 'transfer-1' });
  });
});
