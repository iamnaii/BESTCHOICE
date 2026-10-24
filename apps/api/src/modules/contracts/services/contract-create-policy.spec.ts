import { Prisma } from '@prisma/client';
import { assertCustomerContractPolicy, contractDownTender } from './contract-create-policy';
import { normalizeTenders } from '../../shop-tenders/shop-tender.util';

describe('shared contract creation policy', () => {
  const tx = { contract: { findMany: jest.fn().mockResolvedValue([{ id: 'active', contractNumber: 'ACTIVE-1', status: 'ACTIVE' }]) } };
  it('rejects any live contract — no role or flag can bypass', async () => {
    await expect(assertCustomerContractPolicy(tx as unknown as Prisma.TransactionClient, 'customer'))
      .rejects.toMatchObject({ response: { code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', activeContracts: [expect.objectContaining({ contractNumber: 'ACTIVE-1' })] } });
    expect(assertCustomerContractPolicy.length).toBe(2);
  });
  it('passes when the customer has no live contract', async () => {
    const empty = { contract: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(assertCustomerContractPolicy(empty as unknown as Prisma.TransactionClient, 'customer')).resolves.toBeUndefined();
    expect(empty.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } }) }));
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
