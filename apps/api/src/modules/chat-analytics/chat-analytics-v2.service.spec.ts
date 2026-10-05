import { minutesUntil, percentileNearestRank } from './chat-metrics';
describe('Chat analytics metric definitions', () => {
  it('distinguishes absent samples from genuine zero wait', () => {
    const start = new Date('2026-10-05T03:00:00Z');
    expect(minutesUntil(start, null)).toBeNull();
    expect(minutesUntil(start, start)).toBe(0);
    expect(minutesUntil(start, new Date('2026-10-05T03:06:00Z'))).toBe(6);
    expect(percentileNearestRank([], 0.9)).toBeNull();
    expect(percentileNearestRank([1, 2, 3, 4, 20], 0.9)).toBe(20);
    expect(percentileNearestRank([20, 1, 4, 3, 2], 0.5)).toBe(3);
  });
  it('rejects reversed dates and invalid percentile instead of fabricating zero', () => {
    expect(() => minutesUntil(new Date(10), new Date(0))).toThrow();
    expect(() => percentileNearestRank([1, 2], 1.1)).toThrow();
  });
});
