import { NextBestActionInput, NextBestActionService } from './next-best-action.service';

function baseInput(over: Partial<NextBestActionInput> = {}): NextBestActionInput {
  return {
    brokenPromiseCount: 0,
    hasFirmLetter: false,
    daysOverdue: 5,
    mdmState: 'NONE',
    hasLineId: true,
    ...over,
  };
}

describe('NextBestActionService', () => {
  let service: NextBestActionService;

  beforeEach(() => {
    service = new NextBestActionService();
  });

  it('Rule 1: preferred contact time matches current Bangkok hour → CALL', () => {
    // 03:00 UTC = 10:00 Bangkok = "morning" bucket [8, 12).
    const now = new Date('2026-04-25T03:00:00.000Z');
    const r = service.recommend(
      baseInput({ preferredContactTime: 'morning', now }),
    );
    expect(r.type).toBe('CALL');
  });

  it('Rule 1 NOT firing when current hour falls outside the bucket', () => {
    // 23:00 UTC = 06:00 Bangkok next day → outside 'morning' (8–12).
    const now = new Date('2026-04-25T23:00:00.000Z');
    const r = service.recommend(
      baseInput({ preferredContactTime: 'morning', now }),
    );
    expect(r.type).not.toBe('CALL');
  });

  it('Rule 2: LINE preferred + lineLastSeen < 1h ago → SEND_LINE', () => {
    const now = new Date('2026-04-25T10:00:00.000Z');
    const lineLastSeen = new Date('2026-04-25T09:30:00.000Z');
    const r = service.recommend(
      baseInput({
        preferredChannel: 'LINE',
        lineLastSeen,
        now,
      }),
    );
    expect(r.type).toBe('SEND_LINE');
  });

  it('Rule 2 falls through when lineLastSeen is older than 1h', () => {
    const now = new Date('2026-04-25T10:00:00.000Z');
    const lineLastSeen = new Date('2026-04-25T08:00:00.000Z');
    const r = service.recommend(
      baseInput({
        preferredChannel: 'LINE',
        lineLastSeen,
        now,
        brokenPromiseCount: 0, // ensure rule 3 doesn't catch
      }),
    );
    expect(r.type).toBe('NOOP');
  });

  it('Rule 3: brokenPromiseCount ≥2 and no firm letter → SEND_LETTER', () => {
    const r = service.recommend(
      baseInput({ brokenPromiseCount: 2, hasFirmLetter: false }),
    );
    expect(r.type).toBe('SEND_LETTER');
    expect(r.reason).toMatch(/ผิดนัด 2/);
  });

  it('Rule 3 NOT firing when firm letter already sent', () => {
    const r = service.recommend(
      baseInput({ brokenPromiseCount: 5, hasFirmLetter: true }),
    );
    expect(r.type).not.toBe('SEND_LETTER');
  });

  it('Rule 4: daysOverdue >60 and mdmState=NONE → PROPOSE_LOCK', () => {
    const r = service.recommend(
      baseInput({ daysOverdue: 70, mdmState: 'NONE' }),
    );
    expect(r.type).toBe('PROPOSE_LOCK');
  });

  it('Rule 4 NOT firing when MDM already PENDING', () => {
    const r = service.recommend(
      baseInput({ daysOverdue: 90, mdmState: 'PENDING' }),
    );
    expect(r.type).toBe('NOOP');
  });

  it('Tie-breaker: rule 1 wins over later rules when both could match', () => {
    const now = new Date('2026-04-25T03:00:00.000Z'); // 10:00 Bangkok = morning
    const r = service.recommend(
      baseInput({
        preferredContactTime: 'morning',
        now,
        brokenPromiseCount: 5,
        daysOverdue: 100,
      }),
    );
    expect(r.type).toBe('CALL');
  });

  it('NOOP: nothing matches', () => {
    const r = service.recommend(
      baseInput({
        brokenPromiseCount: 0,
        daysOverdue: 5,
        mdmState: 'LOCKED',
      }),
    );
    expect(r.type).toBe('NOOP');
  });
});
