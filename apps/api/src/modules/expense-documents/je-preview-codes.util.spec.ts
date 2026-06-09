import { collectJePreviewCodes } from './je-preview-codes.util';
import { CreateExpenseDocumentDto } from './dto/create.dto';

// The 4 hardcoded codes collectJePreviewCodes always preloads (mirror post()).
const HARDCODED = ['11-4101', '21-1104', '21-3102', '21-3103'];

const dto = (partial: Partial<CreateExpenseDocumentDto>): CreateExpenseDocumentDto =>
  ({ lines: [], ...partial }) as unknown as CreateExpenseDocumentDto;

describe('collectJePreviewCodes', () => {
  it('always includes the 4 hardcoded VAT/WHT-route codes', () => {
    const codes = collectJePreviewCodes(dto({}));
    for (const c of HARDCODED) expect(codes.has(c)).toBe(true);
  });

  it('includes every line category', () => {
    const codes = collectJePreviewCodes(
      dto({ lines: [{ category: '53-1101' }, { category: '53-1102' }] as never }),
    );
    expect(codes.has('53-1101')).toBe(true);
    expect(codes.has('53-1102')).toBe(true);
  });

  it('includes depositAccountCode when present', () => {
    const codes = collectJePreviewCodes(dto({ depositAccountCode: '11-1201' }));
    expect(codes.has('11-1201')).toBe(true);
  });

  it('does NOT include depositAccountCode when absent/undefined', () => {
    const codes = collectJePreviewCodes(dto({}));
    // Only the 4 hardcoded codes when lines empty + no deposit + no adjustments.
    expect([...codes].sort()).toEqual([...HARDCODED].sort());
  });

  it('includes every non-empty adjustments[].accountCode', () => {
    const codes = collectJePreviewCodes(
      dto({ adjustments: [{ accountCode: '52-1104' }, { accountCode: '53-1503' }] as never }),
    );
    expect(codes.has('52-1104')).toBe(true);
    expect(codes.has('53-1503')).toBe(true);
  });

  it('skips empty/undefined adjustment accountCodes', () => {
    const codes = collectJePreviewCodes(
      dto({ adjustments: [{ accountCode: '' }, { accountCode: undefined }, {}] as never }),
    );
    expect(codes.has('')).toBe(false);
    // Only the 4 hardcoded remain.
    expect([...codes].sort()).toEqual([...HARDCODED].sort());
  });

  it('handles omitted adjustments (the ?? [] guard)', () => {
    const codes = collectJePreviewCodes(dto({ lines: [{ category: '53-1101' }] as never }));
    expect(codes.has('53-1101')).toBe(true);
    expect([...codes].sort()).toEqual(['53-1101', ...HARDCODED].sort());
  });

  it('dedups a line category equal to a hardcoded code (appears once)', () => {
    const codes = collectJePreviewCodes(
      dto({ lines: [{ category: '11-4101' }, { category: '11-4101' }] as never }),
    );
    expect([...codes].filter((c) => c === '11-4101')).toHaveLength(1);
    // Set still has exactly the 4 hardcoded (11-4101 is one of them).
    expect([...codes].sort()).toEqual([...HARDCODED].sort());
  });
});
