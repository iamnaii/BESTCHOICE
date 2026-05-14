import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ValidationService, type ValidationContext } from '../services/validation.service';
import { goldenCases } from './fixtures/golden-cases';

const D = (n: number | string) => new Prisma.Decimal(n);

const baseCtx: ValidationContext = {
  isPeriodOpen: () => true,
  attachmentThreshold: 50000,
  hasAttachment: false,
};

// Mock factory — pure ValidationService.validate() never touches the DB,
// but checkLateFeeCollision() does. Default mock returns "no collision".
function buildPrismaMock(paymentFindFirst: jest.Mock = jest.fn().mockResolvedValue(null)) {
  return { payment: { findFirst: paymentFindFirst } } as unknown as PrismaService;
}

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ValidationService,
        { provide: PrismaService, useValue: buildPrismaMock() },
      ],
    }).compile();
    service = module.get(ValidationService);
  });

  it('V1+V2+V5: passes a balanced minimal doc', () => {
    const result = service.validate(goldenCases.bankInterest, baseCtx);
    expect(result.errors).toEqual([]);
  });

  // Rule V10 fires when amountReceived ≠ netReceived and no adjustments provided
  it('V10: detects unbalanced receipt — amountReceived ≠ netReceived (no adjustments)', () => {
    const doc = { ...goldenCases.bankInterest, amountReceived: D(800) };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V10')).toBeDefined();
  });

  it('V3: requires issueDate + ≥1 item', () => {
    const doc = { ...goldenCases.bankInterest, items: [] };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V3')).toBeDefined();
  });

  it('V4: every item must use 42-XXXX account', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], accountCode: '52-1104' }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V4')).toBeDefined();
  });

  it('V4: allows 42-1103 (late-fee-only payment scenario)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], accountCode: '42-1103' }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V4')).toBeUndefined();
  });

  it('V6: VAT% > 0 must coexist with VAT account on JE', () => {
    const ok = service.validate(goldenCases.gainOnDisposal, baseCtx);
    expect(ok.errors.find((e) => e.rule === 'V6')).toBeUndefined();
  });

  it('V7: warns on non-standard WHT% (does not block)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], whtPct: D(8) }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.warnings.find((w) => w.rule === 'V7')).toBeDefined();
    expect(result.errors.find((e) => e.rule === 'V7')).toBeUndefined();
  });

  it('V8: blocks when issueDate is in a closed period', () => {
    const result = service.validate(goldenCases.bankInterest, {
      ...baseCtx,
      isPeriodOpen: () => false,
    });
    expect(result.errors.find((e) => e.rule === 'V8')).toBeDefined();
  });

  it('V10+V12: blocks when adjustments do not cover diff', () => {
    const doc = {
      ...goldenCases.bankInterestWithFee,
      adjustments: [
        { ...goldenCases.bankInterestWithFee.adjustments[0], amount: D(5) },
      ],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V12')).toBeDefined();
  });

  it('V11: blocks when amount ≥ threshold and no attachment', () => {
    const result = service.validate(goldenCases.gainOnDisposal, {
      ...baseCtx,
      attachmentThreshold: 5000,
      hasAttachment: false,
    });
    expect(result.errors.find((e) => e.rule === 'V11')).toBeDefined();
  });

  it('V13: blocks when adjustment row has no accountCode', () => {
    const doc = {
      ...goldenCases.bankInterestWithFee,
      adjustments: [{ ...goldenCases.bankInterestWithFee.adjustments[0], accountCode: '' }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V13')).toBeDefined();
  });
});

describe('V15 — bank interest policy (B2)', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ValidationService,
        { provide: PrismaService, useValue: buildPrismaMock() },
      ],
    }).compile();
    service = module.get(ValidationService);
  });

  it('does NOT warn when 42-1102 uses WHT 1% (นิติบุคคล ออมทรัพย์)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [
        {
          ...goldenCases.bankInterest.items[0],
          whtPct: D(1),
          whtAmount: D(10),
        },
      ],
      whtAmount: D(10),
      netReceived: D(990),
      amountReceived: D(990),
    };
    const result = service.validate(doc, baseCtx);
    const v15Warning = result.warnings.find((w) => w.rule === 'V15');
    expect(v15Warning).toBeUndefined();
  });

  it('still errors when 42-1102 has VAT% > 0 (ม.81(1)(ฏ) violation)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [
        {
          ...goldenCases.bankInterest.items[0],
          vatPct: D(7),
        },
      ],
    };
    const result = service.validate(doc, baseCtx);
    const v15Error = result.errors.find((e) => e.rule === 'V15');
    expect(v15Error).toBeDefined();
    expect(v15Error?.msg).toMatch(/ยกเว้น VAT/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C14 — 42-1103 double-credit collision soft warning
// ─────────────────────────────────────────────────────────────────────────────

describe('C14 — checkLateFeeCollision (42-1103 double-credit detection)', () => {
  const customerId = '11111111-1111-1111-1111-111111111111';
  const issueDate = new Date('2026-05-14T03:00:00.000Z'); // 10:00 BKK
  const itemWithLateFee = [{ lineNo: 1, accountCode: '42-1103' }];
  const itemWithoutLateFee = [{ lineNo: 1, accountCode: '42-1102' }];

  function buildService(findFirstImpl: jest.Mock) {
    const prismaMock = buildPrismaMock(findFirstImpl);
    return Test.createTestingModule({
      providers: [ValidationService, { provide: PrismaService, useValue: prismaMock }],
    })
      .compile()
      .then((m) => ({
        service: m.get(ValidationService),
        prismaMock,
        findFirst: findFirstImpl,
      }));
  }

  it('returns warning when 42-1103 is used and a colliding Payment.lateFee exists', async () => {
    const { service, findFirst } = await buildService(
      jest.fn().mockResolvedValue({
        id: 'p1',
        installmentNo: 4,
        lateFee: new Prisma.Decimal(50),
        dueDate: new Date('2026-05-05T03:00:00.000Z'),
      }),
    );

    const warnings = await service.checkLateFeeCollision(
      customerId,
      issueDate,
      itemWithLateFee,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe('C14');
    expect(warnings[0].lineNo).toBe(1);
    expect(warnings[0].msg).toMatch(/42-1103/);
    expect(warnings[0].msg).toMatch(/งวดที่ 4/);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const call = findFirst.mock.calls[0][0];
    expect(call.where.contract.customerId).toBe(customerId);
    expect(call.where.lateFee).toEqual({ gt: 0 });
    expect(call.where.deletedAt).toBeNull();
  });

  it('returns no warning when no colliding Payment is found', async () => {
    const { service } = await buildService(jest.fn().mockResolvedValue(null));

    const warnings = await service.checkLateFeeCollision(
      customerId,
      issueDate,
      itemWithLateFee,
    );

    expect(warnings).toEqual([]);
  });

  it('skips the DB query entirely when no item uses 42-1103', async () => {
    const findFirst = jest.fn();
    const { service } = await buildService(findFirst);

    const warnings = await service.checkLateFeeCollision(
      customerId,
      issueDate,
      itemWithoutLateFee,
    );

    expect(warnings).toEqual([]);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns no warning when customerId is missing (no customer = no collision check)', async () => {
    const findFirst = jest.fn();
    const { service } = await buildService(findFirst);

    const warnings = await service.checkLateFeeCollision(
      null,
      issueDate,
      itemWithLateFee,
    );

    expect(warnings).toEqual([]);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns no warning when items array is empty', async () => {
    const findFirst = jest.fn();
    const { service } = await buildService(findFirst);

    const warnings = await service.checkLateFeeCollision(customerId, issueDate, []);

    expect(warnings).toEqual([]);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns no warning when issueDate is missing', async () => {
    const findFirst = jest.fn();
    const { service } = await buildService(findFirst);

    const warnings = await service.checkLateFeeCollision(customerId, null, itemWithLateFee);

    expect(warnings).toEqual([]);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
