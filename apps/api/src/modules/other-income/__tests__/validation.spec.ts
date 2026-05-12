import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ValidationService, type ValidationContext } from '../services/validation.service';
import { goldenCases } from './fixtures/golden-cases';

const D = (n: number | string) => new Prisma.Decimal(n);

const baseCtx: ValidationContext = {
  isPeriodOpen: () => true,
  attachmentThreshold: 50000,
  hasAttachment: false,
};

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ValidationService],
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

  it('V4: blocks 42-1103 (already auto-posted by PaymentReceipt2BTemplate)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], accountCode: '42-1103' }],
    };
    const result = service.validate(doc, baseCtx);
    const v4 = result.errors.find((e) => e.rule === 'V4');
    expect(v4?.msg).toMatch(/42-1103/);
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
      providers: [ValidationService],
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
