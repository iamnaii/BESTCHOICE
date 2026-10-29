import { isCronEnabled, parseCronEnabled, scheduleModuleOptions } from './cron-enabled';

describe('parseCronEnabled', () => {
  it.each([undefined, null, '', '   '])('defaults to true when unset (%p) — no behaviour change', (v) => {
    expect(parseCronEnabled(v as string | undefined)).toBe(true);
  });

  it.each(['true', 'TRUE', ' True ', '1', 'yes', 'on'])('treats %p as enabled', (v) => {
    expect(parseCronEnabled(v)).toBe(true);
  });

  it.each(['false', 'FALSE', ' false ', '0', 'no', 'off'])('treats %p as disabled', (v) => {
    expect(parseCronEnabled(v)).toBe(false);
  });

  it.each(['flase', 'disabled', '2', 'treu'])('throws on typo %p instead of guessing', (v) => {
    expect(() => parseCronEnabled(v)).toThrow(/Invalid CRON_ENABLED/);
  });
});

describe('scheduleModuleOptions', () => {
  it('enables cron, interval and timeout by default', () => {
    expect(scheduleModuleOptions({})).toEqual({ cronJobs: true, intervals: true, timeouts: true });
    expect(isCronEnabled({})).toBe(true);
  });

  it('disables all three when CRON_ENABLED=false', () => {
    expect(scheduleModuleOptions({ CRON_ENABLED: 'false' })).toEqual({
      cronJobs: false,
      intervals: false,
      timeouts: false,
    });
  });
});
