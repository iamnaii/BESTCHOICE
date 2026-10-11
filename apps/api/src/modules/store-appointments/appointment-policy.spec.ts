import {
  availableSlots,
  bangkokDay,
  dayBounds,
  decisionForAppointments,
  assertTransition,
  assertBookableStart,
} from './appointment-policy';

const at = (clock: string) => new Date(`2026-10-12T${clock}:00+07:00`);
describe('appointment policy', () => {
  it('counts staff, excludes overlaps and does not bridge breaks or short closing windows', () => {
    const windows = [
      { staffUserId: 'a', startsAt: at('10:00'), endsAt: at('12:00') },
      { staffUserId: 'b', startsAt: at('10:00'), endsAt: at('11:30') },
      { staffUserId: 'a', startsAt: at('13:00'), endsAt: at('13:30') },
    ];
    const busy = [{ staffUserId: 'a', startsAt: at('10:30'), endsAt: at('11:15') }];
    expect(availableSlots(windows, busy, '2026-10-12', at('09:00'))).toEqual([
      { startsAt: '2026-10-12T03:00:00.000Z', endsAt: '2026-10-12T03:45:00.000Z', available: 1 },
      { startsAt: '2026-10-12T03:45:00.000Z', endsAt: '2026-10-12T04:30:00.000Z', available: 1 },
    ]);
  });
  it('allows adjacent appointments and removes slots inside the lead period', () => {
    const w = [{ staffUserId: 'a', startsAt: at('10:00'), endsAt: at('11:30') }];
    expect(
      availableSlots(
        w,
        [{ staffUserId: 'a', startsAt: at('09:15'), endsAt: at('10:00') }],
        '2026-10-12',
        at('09:30'),
      ),
    ).toHaveLength(2);
    expect(availableSlots(w, [], '2026-10-12', at('09:31')).map((s) => s.startsAt)).toEqual([
      '2026-10-12T03:45:00.000Z',
    ]);
  });
  it('uses Bangkok dates across UTC midnight and rejects invalid dates/horizon', () => {
    expect(bangkokDay(new Date('2026-10-11T18:00:00Z'))).toBe('2026-10-12');
    expect(dayBounds('2026-10-12')[0].toISOString()).toBe('2026-10-11T17:00:00.000Z');
    expect(() => dayBounds('2026-02-30')).toThrow();
    expect(() => assertBookableStart(new Date('2026-10-26T03:00:00Z'), at('09:00'))).toThrow();
    expect(() => assertBookableStart(at('09:29'), at('09:00'))).toThrow();
  });
  it('retains an approval through a new undecided round but never skips rejection or unknown history', () => {
    expect(decisionForAppointments(['NONE', 'APPROVED'])).toBe('APPROVED');
    expect(decisionForAppointments(['NONE', 'REJECTED', 'APPROVED'])).toBe('REJECTED');
    expect(decisionForAppointments(['UNKNOWN', 'APPROVED'])).toBe('UNKNOWN');
    expect(decisionForAppointments([])).toBe('UNKNOWN');
  });
  it('rejects premature no-show and terminal reopening', () => {
    expect(() => assertTransition('BOOKED', 'NO_SHOW', at('10:00'), at('09:59'))).toThrow();
    expect(() => assertTransition('BOOKED', 'NO_SHOW', at('10:00'), at('10:00'))).not.toThrow();
    expect(() => assertTransition('COMPLETED', 'BOOKED', at('10:00'), at('12:00'))).toThrow();
    expect(() => assertTransition('CHECKED_IN', 'NO_SHOW', at('10:00'), at('12:00'))).toThrow();
  });
});
