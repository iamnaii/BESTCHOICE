import { calculatePaymentWatchRisk } from './payment-watch-risk.util';

describe('payment watch risk', () => {
  it.each([
    [0, 0, false, 0, 'LOW'],
    [3, 0, false, 3, 'MEDIUM'],
    [0, 1, true, 5, 'HIGH'],
    [9, 2, true, 12, 'HIGH'],
  ] as const)(
    'preserves score and threshold for %s/%s/%s',
    (late, partial, reset, score, level) => {
      expect(
        calculatePaymentWatchRisk({
          latePaymentCount: BigInt(late),
          partialPaymentCount: BigInt(partial),
          hadDunningReset: reset,
        }),
      ).toMatchObject({ late, partial, dunningReset: reset, score, riskLevel: level });
    },
  );
  it('retains uncapped counts and reason ordering while capping only the late score', () => {
    expect(
      calculatePaymentWatchRisk({
        latePaymentCount: 9n,
        partialPaymentCount: 2n,
        hadDunningReset: true,
      }).reasons,
    ).toEqual(['ชำระล่าช้า 9 ครั้ง', 'จ่ายไม่ครบ 2 ครั้ง', 'เคยถูกติดตามหนี้แล้ว reset']);
  });
});
