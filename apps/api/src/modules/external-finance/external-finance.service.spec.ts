import { ExternalFinanceService } from './external-finance.service';

describe('ExternalFinanceService', () => {
  let prismaMock: any;
  let contactResolverMock: any;
  let svc: ExternalFinanceService;

  beforeEach(() => {
    prismaMock = {
      externalFinanceCompany: {
        create: jest.fn((args: any) => Promise.resolve({ id: 'co1', ...args.data })),
      },
      // $transaction passes a tx client; reuse the same mock so the create is observable.
      $transaction: jest.fn((cb: any) => cb(prismaMock)),
    };
    contactResolverMock = {
      findOrCreateByNaturalKey: jest.fn(() => Promise.resolve({ id: 'contact-123' })),
    };
    svc = new ExternalFinanceService(prismaMock, contactResolverMock);
  });

  it('create resolves a FINANCE_COMPANY Contact and links it via contactId', async () => {
    const result = await svc.create({
      name: 'GFIN จำกัด',
      taxId: '0105551234567',
      contactPhone: '021234567',
      email: 'ops@gfin.co.th',
    });

    expect(contactResolverMock.findOrCreateByNaturalKey).toHaveBeenCalledTimes(1);
    const [, input] = contactResolverMock.findOrCreateByNaturalKey.mock.calls[0];
    expect(input).toMatchObject({
      name: 'GFIN จำกัด',
      taxId: '0105551234567',
      nationalIdHash: null,
      phone: '021234567',
      email: 'ops@gfin.co.th',
      role: 'FINANCE_COMPANY',
    });

    // The created company carries the resolved contact id.
    const createArgs = prismaMock.externalFinanceCompany.create.mock.calls[0][0];
    expect(createArgs.data.contactId).toBe('contact-123');
    expect(result.name).toBe('GFIN จำกัด');
  });

  it('create passes null for missing optional natural-key fields', async () => {
    await svc.create({ name: 'ไฟแนนซ์ไร้ภาษี' });

    const [, input] = contactResolverMock.findOrCreateByNaturalKey.mock.calls[0];
    expect(input).toMatchObject({
      name: 'ไฟแนนซ์ไร้ภาษี',
      taxId: null,
      nationalIdHash: null,
      phone: null,
      email: null,
      role: 'FINANCE_COMPANY',
    });
  });
});
