import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ETaxSubmissionStatus, Prisma } from '@prisma/client';
import { ETaxXmlService } from '../e-tax-xml.service';

/**
 * Unit tests for ETaxXmlService — fully mocked PrismaService + integration
 * config + signer + RD client. No DB hits. Covers the spec checklist:
 *
 *   1. generateForPayment success
 *   2. generateForPayment idempotency (returns existing row)
 *   3. signSubmission throws when ETAX_SUBMIT_MODE=disabled
 *   4. signSubmission throws when cert path missing
 *   5. submitToRd happy path (records SUBMITTED + rdSubmissionId)
 *   6. submitToRd handles transport error (status=ERROR + retryCount++)
 *   7. pollStatus moves SUBMITTED → ACCEPTED
 *   8. retrySubmission resets REJECTED → SIGNED
 */

const D = (n: number | string) => new Prisma.Decimal(n);

interface AnySub {
  id: string;
  paymentId: string;
  xmlContent: string;
  signedXml: string | null;
  status: ETaxSubmissionStatus;
  retryCount: number;
  submittedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
  rdSubmissionId: string | null;
  rdResponse: unknown;
  lastRetryAt: Date | null;
}

function makeSub(overrides: Partial<AnySub> = {}): AnySub {
  return {
    id: 'sub-1',
    paymentId: 'payment-1',
    xmlContent: '<Invoice/>',
    signedXml: null,
    status: ETaxSubmissionStatus.PENDING,
    retryCount: 0,
    submittedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    rdSubmissionId: null,
    rdResponse: null,
    lastRetryAt: null,
    ...overrides,
  };
}

interface PaymentFixture {
  id: string;
  paidDate: Date | null;
  installmentNo: number;
  amountPaid: Prisma.Decimal;
  vatAmount: Prisma.Decimal | null;
  contract: {
    id: string;
    contractNumber: string;
    customer: {
      id: string;
      name: string;
      nationalId: string | null;
      nationalIdEncrypted: string | null;
      addressIdCard: string | null;
      addressIdCardEncrypted: string | null;
    };
  };
}

function makePayment(overrides: Partial<PaymentFixture> = {}): PaymentFixture {
  return {
    id: 'payment-1',
    paidDate: new Date('2026-05-15T07:00:00Z'),
    installmentNo: 3,
    amountPaid: D('10700'),
    vatAmount: D('700'),
    contract: {
      id: 'contract-1',
      contractNumber: 'C-2026-0001',
      customer: {
        id: 'cust-1',
        name: 'นาย ทดสอบ ระบบ',
        // C1 — legacy plaintext only in tests; service must still read
        // nationalIdEncrypted preferentially when present.
        nationalId: '1100100000001',
        nationalIdEncrypted: null,
        addressIdCard: '99/9 ถ.ทดสอบ',
        addressIdCardEncrypted: null,
      },
    },
    ...overrides,
  };
}

const FINANCE = {
  id: 'finance-1',
  nameTh: 'BESTCHOICE FINANCE',
  nameEn: null,
  taxId: '0000000000001',
  taxBranchCode: '00000',
  address: '123 ถ.บัญชี',
};

interface MockTx {
  eTaxSubmission: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
  auditLog: { create: jest.Mock };
  $executeRawUnsafe: jest.Mock;
}

function buildPrismaMock(opts: {
  existingSub?: AnySub | null;
  payment?: PaymentFixture | null;
  finance?: typeof FINANCE | null;
  txCreatedSub?: AnySub;
  txUpdatedSub?: AnySub;
  // C7 — last invoice number on the day; if null, sequence starts at 0001
  lastInvoiceNumber?: string | null;
}) {
  const auditCreate = jest.fn().mockResolvedValue({});
  const subCreate = jest.fn().mockImplementation(async ({ data }: { data: AnySub }) => ({
    ...data,
    id: opts.txCreatedSub?.id ?? 'sub-new',
    retryCount: 0,
    submittedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectReason: null,
    rdSubmissionId: null,
    rdResponse: null,
    lastRetryAt: null,
    signedXml: null,
  }));
  const subUpdate = jest.fn().mockImplementation(async ({ data }: { data: Partial<AnySub> }) => ({
    ...(opts.txUpdatedSub ?? makeSub()),
    ...data,
  }));
  // C7 — tx-level findFirst is used by nextInvoiceNumber to discover the
  // current max sequence per BKK day.
  const txSubFindFirst = jest.fn().mockResolvedValue(
    opts.lastInvoiceNumber ? { invoiceNumber: opts.lastInvoiceNumber } : null,
  );
  const txExecuteRaw = jest.fn().mockResolvedValue(1);
  const tx: MockTx = {
    eTaxSubmission: {
      create: subCreate,
      update: subUpdate,
      findFirst: txSubFindFirst,
    },
    auditLog: { create: auditCreate },
    $executeRawUnsafe: txExecuteRaw,
  };
  const prisma = {
    eTaxSubmission: {
      findFirst: jest.fn().mockResolvedValue(opts.existingSub ?? null),
    },
    payment: {
      findFirst: jest.fn().mockResolvedValue(opts.payment ?? null),
    },
    companyInfo: {
      findFirst: jest.fn().mockResolvedValue(opts.finance ?? null),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (tx: MockTx) => unknown) => cb(tx)),
  };
  return { prisma, tx, auditCreate, subCreate, subUpdate, txSubFindFirst, txExecuteRaw };
}

function buildIntegrationConfigMock(values: Record<string, string>) {
  return {
    getValue: jest.fn().mockImplementation((_int: string, field: string) => {
      return Promise.resolve(values[field] ?? '');
    }),
  } as unknown as { getValue: jest.Mock };
}

describe('ETaxXmlService', () => {
  describe('generateForPayment', () => {
    it('happy path — builds XML, creates submission, writes audit log', async () => {
      const { prisma, subCreate, auditCreate } = buildPrismaMock({
        existingSub: null,
        payment: makePayment(),
        finance: FINANCE,
      });
      const cfg = buildIntegrationConfigMock({ submitMode: 'disabled' });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      const result = await svc.generateForPayment('payment-1', 'user-1');

      expect(prisma.eTaxSubmission.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.payment.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.companyInfo.findFirst).toHaveBeenCalledTimes(1);
      expect(subCreate).toHaveBeenCalledTimes(1);
      const createdData = subCreate.mock.calls[0][0].data;
      expect(createdData.paymentId).toBe('payment-1');
      expect(createdData.status).toBe(ETaxSubmissionStatus.PENDING);
      // XML must include both supplier + customer tax IDs
      expect(createdData.xmlContent).toContain('0000000000001');
      expect(createdData.xmlContent).toContain('1100100000001');
      expect(createdData.xmlContent).toContain('นาย ทดสอบ ระบบ');
      // Audit log written with the correct entity + action
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ETAX_XML_GENERATED',
          entity: 'etax_submission',
          userId: 'user-1',
        }),
      });
      expect(result.paymentId).toBe('payment-1');
    });

    it('idempotency — returns existing row without regenerating', async () => {
      const existing = makeSub({ status: ETaxSubmissionStatus.SIGNED });
      const { prisma, subCreate } = buildPrismaMock({ existingSub: existing });
      const cfg = buildIntegrationConfigMock({});
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      const result = await svc.generateForPayment('payment-1', 'user-1');

      expect(result).toBe(existing);
      expect(subCreate).not.toHaveBeenCalled();
      // No need to even consult payment + company when idempotency triggers
      expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    });

    it('C7 — generateForPayment called twice for same submission reuses invoiceNumber (no re-alloc)', async () => {
      // First call: nothing exists, full path runs + allocates ET-2026-05-15-0001
      const first = buildPrismaMock({
        existingSub: null,
        payment: makePayment(),
        finance: FINANCE,
        lastInvoiceNumber: null, // empty day → seq starts at 0001
      });
      const cfgFirst = buildIntegrationConfigMock({ submitMode: 'disabled' });
      const svcFirst = new ETaxXmlService(first.prisma as never, cfgFirst as never);
      await svcFirst.generateForPayment('payment-1', 'user-1');

      const firstCreatedNumber = first.subCreate.mock.calls[0][0].data
        .invoiceNumber as string;
      expect(firstCreatedNumber).toMatch(/^ET-\d{8}-0001$/);

      // Second call: pretend the row now exists w/ the same invoiceNumber.
      // Service must short-circuit on the idempotency findFirst and not
      // allocate another number (advisory lock never even taken).
      const existing = makeSub({
        status: ETaxSubmissionStatus.PENDING,
        // attach invoiceNumber via spread since AnySub doesn't track it
      });
      (existing as unknown as Record<string, unknown>).invoiceNumber = firstCreatedNumber;
      const second = buildPrismaMock({ existingSub: existing });
      const cfgSecond = buildIntegrationConfigMock({});
      const svcSecond = new ETaxXmlService(second.prisma as never, cfgSecond as never);

      const result = await svcSecond.generateForPayment('payment-1', 'user-1');

      expect(result).toBe(existing);
      // No tx ⇒ no new allocation, no executeRawUnsafe, no audit
      expect(second.txExecuteRaw).not.toHaveBeenCalled();
      expect(second.subCreate).not.toHaveBeenCalled();
      expect(second.auditCreate).not.toHaveBeenCalled();
      // The returned row carries the original invoiceNumber
      expect((result as { invoiceNumber: string }).invoiceNumber).toBe(
        firstCreatedNumber,
      );
    });

    it('rejects when payment has no VAT', async () => {
      const { prisma } = buildPrismaMock({
        existingSub: null,
        payment: makePayment({ vatAmount: D('0') }),
        finance: FINANCE,
      });
      const cfg = buildIntegrationConfigMock({});
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.generateForPayment('payment-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when FINANCE company is not configured', async () => {
      const { prisma } = buildPrismaMock({
        existingSub: null,
        payment: makePayment(),
        finance: null,
      });
      const cfg = buildIntegrationConfigMock({});
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.generateForPayment('payment-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('signSubmission', () => {
    it('throws when ETAX_SUBMIT_MODE=disabled (cert pluggable contract)', async () => {
      const sub = makeSub({ status: ETaxSubmissionStatus.PENDING });
      const { prisma } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({ submitMode: 'disabled' });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.signSubmission('sub-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws NotFound when submission missing', async () => {
      const { prisma } = buildPrismaMock({ existingSub: null });
      const cfg = buildIntegrationConfigMock({ submitMode: 'enabled' });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.signSubmission('missing', 'u')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws when cert path missing even with enabled mode', async () => {
      const sub = makeSub({ status: ETaxSubmissionStatus.PENDING });
      const { prisma } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({
        submitMode: 'enabled',
        certPath: '',
        certPassword: 'pass',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.signSubmission('sub-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws when re-signing an already SIGNED submission', async () => {
      const sub = makeSub({ status: ETaxSubmissionStatus.SIGNED });
      const { prisma } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({ submitMode: 'enabled' });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.signSubmission('sub-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('submitToRd', () => {
    it('happy path — calls RD, records SUBMITTED + submissionId + audit log', async () => {
      const sub = makeSub({
        status: ETaxSubmissionStatus.SIGNED,
        signedXml: 'base64sigtext',
      });
      const { prisma, subUpdate, auditCreate } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({
        submitMode: 'enabled',
        rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
        rdUsername: 'u',
        rdPassword: 'p',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      // Inject a mock RD client
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).rdClient = {
        submit: jest.fn().mockResolvedValue({
          accepted: true,
          submissionId: 'RD-TRACK-123',
          rawResponse: { result_code: 'ACCEPTED' },
        }),
      };

      await svc.submitToRd('sub-1', 'user-1');

      expect(subUpdate).toHaveBeenCalledTimes(1);
      const updateData = subUpdate.mock.calls[0][0].data;
      expect(updateData.status).toBe(ETaxSubmissionStatus.SUBMITTED);
      expect(updateData.rdSubmissionId).toBe('RD-TRACK-123');
      expect(updateData.submittedAt).toBeInstanceOf(Date);

      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ETAX_SUBMITTED',
          entity: 'etax_submission',
          userId: 'user-1',
        }),
      });
    });

    it('handles RD transport error → status=ERROR + retryCount increment', async () => {
      const sub = makeSub({
        status: ETaxSubmissionStatus.SIGNED,
        signedXml: 'base64sigtext',
      });
      const { prisma, subUpdate } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({
        submitMode: 'enabled',
        rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
        rdUsername: 'u',
        rdPassword: 'p',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).rdClient = {
        submit: jest.fn().mockRejectedValue(new Error('timeout')),
      };

      await svc.submitToRd('sub-1', 'user-1');

      expect(subUpdate).toHaveBeenCalledTimes(1);
      const data = subUpdate.mock.calls[0][0].data;
      expect(data.status).toBe(ETaxSubmissionStatus.ERROR);
      // Prisma `increment` operator is the signal — we don't read the
      // post-update value here since it's a mock.
      expect(data.retryCount).toEqual({ increment: 1 });
    });

    it('rejects when submission is in PENDING state (must SIGN first)', async () => {
      const sub = makeSub({ status: ETaxSubmissionStatus.PENDING });
      const { prisma } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({ submitMode: 'enabled' });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.submitToRd('sub-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('pollStatus', () => {
    it('moves SUBMITTED → ACCEPTED when RD reports ACCEPTED', async () => {
      const sub = makeSub({
        status: ETaxSubmissionStatus.SUBMITTED,
        rdSubmissionId: 'RD-1',
        signedXml: 'sig',
      });
      const { prisma, subUpdate, auditCreate } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({
        submitMode: 'enabled',
        rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
        rdUsername: 'u',
        rdPassword: 'p',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).rdClient = {
        checkStatus: jest
          .fn()
          .mockResolvedValue({ status: 'ACCEPTED', rawResponse: { ok: true } }),
      };

      await svc.pollStatus('sub-1', 'user-1');

      const data = subUpdate.mock.calls[0][0].data;
      expect(data.status).toBe(ETaxSubmissionStatus.ACCEPTED);
      expect(data.acceptedAt).toBeInstanceOf(Date);
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ETAX_ACCEPTED' }),
      });
    });

    it('no-op when RD still PENDING', async () => {
      const sub = makeSub({
        status: ETaxSubmissionStatus.SUBMITTED,
        rdSubmissionId: 'RD-1',
        signedXml: 'sig',
      });
      const { prisma, subUpdate } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({
        submitMode: 'enabled',
        rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
        rdUsername: 'u',
        rdPassword: 'p',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (svc as any).rdClient = {
        checkStatus: jest.fn().mockResolvedValue({ status: 'PENDING', rawResponse: {} }),
      };

      const result = await svc.pollStatus('sub-1', 'user-1');
      expect(subUpdate).not.toHaveBeenCalled();
      expect(result).toBe(sub);
    });
  });

  describe('retrySubmission', () => {
    it('resets REJECTED → SIGNED + bumps retryCount + audit', async () => {
      const sub = makeSub({
        status: ETaxSubmissionStatus.REJECTED,
        signedXml: 'sig',
        retryCount: 0,
      });
      const { prisma, subUpdate, auditCreate } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({});
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await svc.retrySubmission('sub-1', 'user-1');

      const data = subUpdate.mock.calls[0][0].data;
      expect(data.status).toBe(ETaxSubmissionStatus.SIGNED);
      expect(data.rejectedAt).toBeNull();
      expect(data.rejectReason).toBeNull();
      expect(data.retryCount).toEqual({ increment: 1 });
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ETAX_RETRY' }),
      });
    });

    it('rejects when status is not REJECTED or ERROR', async () => {
      const sub = makeSub({ status: ETaxSubmissionStatus.ACCEPTED });
      const { prisma } = buildPrismaMock({ existingSub: sub });
      const cfg = buildIntegrationConfigMock({});
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      await expect(svc.retrySubmission('sub-1', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('checkConfig', () => {
    it('reports disabled mode + missing cert when nothing is set', async () => {
      const { prisma } = buildPrismaMock({});
      const cfg = buildIntegrationConfigMock({
        submitMode: 'disabled',
        certPath: '',
        certPassword: '',
        rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
        rdUsername: '',
        rdPassword: '',
      });
      const svc = new ETaxXmlService(prisma as never, cfg as never);

      const result = await svc.checkConfig();
      expect(result.submitMode).toBe('disabled');
      expect(result.certConfigured).toBe(false);
      expect(result.certError).toContain('certPath');
      // RD unreachable: no creds, so ping returns ok=false
      expect(result.rdReachable).toBe(false);
    });
  });
});
