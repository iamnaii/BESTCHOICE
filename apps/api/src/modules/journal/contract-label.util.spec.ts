import { resolveContractLabel } from './contract-label.util';

describe('resolveContractLabel', () => {
  it('returns the contract number when the contract exists', async () => {
    const client = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractNumber: 'TEST-20260905-001' }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveContractLabel(client as any, 'c-uuid')).resolves.toBe('TEST-20260905-001');
    expect(client.contract.findUnique).toHaveBeenCalledWith({
      where: { id: 'c-uuid' },
      select: { contractNumber: true },
    });
  });

  it('falls back to the first 8 chars of the id when the contract is missing', async () => {
    const client = { contract: { findUnique: jest.fn().mockResolvedValue(null) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveContractLabel(client as any, '0123456789abcdef')).resolves.toBe('01234567');
  });
});
