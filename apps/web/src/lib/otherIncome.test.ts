import { beforeEach, describe, expect, it, vi } from 'vitest';
import { otherIncomeApi } from './otherIncome';
import { otherIncomeFormSchema } from './otherIncome.schema';

const { post, patch } = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock('./api', () => ({ default: { post, patch } }));

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { id: 'doc' } });
  patch.mockResolvedValue({ data: { id: 'doc' } });
});

describe('income form optional API fields', () => {
  const values = () => otherIncomeFormSchema.parse({
    issueDate: '2026-09-08', dueDate: '', paymentDate: '', customerId: '',
    priceType: 'EXCLUSIVE', paymentAccountCode: '11-1101', amountReceived: 100,
    items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 100 }],
  });
  it('creates a draft from blank optional inputs without sending invalid date/UUID strings', async () => {
    await otherIncomeApi.create(values());
    const sent = JSON.parse(JSON.stringify(post.mock.calls[0][1]));
    expect(sent.issueDate).toBe('2026-09-08');
    for (const key of ['dueDate', 'paymentDate', 'customerId']) expect(sent).not.toHaveProperty(key);
  });
  it('can update a draft before POST when optional dates are blank', async () => {
    await otherIncomeApi.update('doc', values());
    const sent = JSON.parse(JSON.stringify(patch.mock.calls[0][1]));
    expect(patch.mock.calls[0][0]).toBe('/other-income/doc');
    expect(sent.paymentDate).toBeNull();
    expect(sent.dueDate).toBeNull();
    expect(sent.customerId).toBeNull();
  });
  it('preserves provided dates and customer identity', async () => {
    const form = { ...values(), dueDate: '2026-10-08', paymentDate: '2026-09-08', customerId: '19e6d921-137f-48bf-a89c-69e6e3cc34d1' };
    await otherIncomeApi.create(form);
    expect(post.mock.calls[0][1]).toEqual(form);
  });
});
