import { businessMinutesBetween, businessWindows, validateSlaPolicy } from './chat-sla-policy';
const d = (value: string) => new Date(value);
describe('business-time SLA', () => {
  it('counts six working minutes across a Bangkok closing time', () => {
    const start = d('2026-10-05T11:58:00Z');
    const end = d('2026-10-06T03:04:00Z');
    expect(businessMinutesBetween(start, end, businessWindows(start, end, 'SHOP'))).toBe(6);
  });
  it('uses Finance closing time without changing Shop hours', () => {
    const start = d('2026-10-05T11:58:00Z');
    const end = d('2026-10-05T12:10:00Z');
    expect(businessMinutesBetween(start, end, businessWindows(start, end, 'FINANCE'))).toBe(12);
    expect(businessMinutesBetween(start, end, businessWindows(start, end, 'SHOP'))).toBe(2);
  });
  it('does not count closed hours or clamp a negative duration to a fake zero', () => {
    const start = d('2026-10-05T13:00:00Z');
    const end = d('2026-10-06T02:00:00Z');
    expect(businessMinutesBetween(start, end, businessWindows(start, end, 'SHOP'))).toBe(0);
    expect(() => businessMinutesBetween(end, start, [])).toThrow();
  });
  it('rejects overlapping or unsorted windows instead of double-counting', () => {
    const start = d('2026-10-05T03:00:00Z');
    const end = d('2026-10-05T12:00:00Z');
    expect(() =>
      businessMinutesBetween(start, end, [
        { start, end },
        { start, end },
      ]),
    ).toThrow();
  });
  it.each([
    { ownerMinutes: 0, managerMinutes: 15 },
    { ownerMinutes: 15, managerMinutes: 5 },
    { ownerMinutes: NaN, managerMinutes: 15 },
  ])('rejects invalid threshold ordering: %p', (policy) => {
    expect(() => validateSlaPolicy(policy)).toThrow();
  });
});
