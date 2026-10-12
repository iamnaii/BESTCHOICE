import { parseReverseArgs, REVERSE_REASON_MIN } from './advance-excess-income-reverse.args';

describe('advance-excess:reverse — parseReverseArgs (PR4 final review I2)', () => {
  it('อ่าน --contract (เลขสัญญาหรือ id) + --reason ≥ 10 ตัวอักษร', () => {
    expect(
      parseReverseArgs([
        '--contract',
        'CT-20261011-0001',
        '--reason',
        'ฝ่ายบัญชีสั่งคืนเงินลูกค้า ตรวจแล้ว',
      ]),
    ).toEqual({ contract: 'CT-20261011-0001', reason: 'ฝ่ายบัญชีสั่งคืนเงินลูกค้า ตรวจแล้ว' });
    expect(parseReverseArgs(['--contract=abc-uuid', '--reason=เหตุผลยาวพอสิบตัวอักษร'])).toEqual({
      contract: 'abc-uuid',
      reason: 'เหตุผลยาวพอสิบตัวอักษร',
    });
  });

  it('ไม่มี --contract / ไม่มี --reason / เหตุผลสั้นกว่าเกณฑ์ → throw ข้อความไทยบอกวิธีใช้', () => {
    expect(() => parseReverseArgs(['--reason', 'เหตุผลยาวพอสิบตัวอักษร'])).toThrow(/--contract/);
    expect(() => parseReverseArgs(['--contract', 'CT-1'])).toThrow(/--reason/);
    expect(() => parseReverseArgs(['--contract', 'CT-1', '--reason', 'สั้น'])).toThrow(
      new RegExp(String(REVERSE_REASON_MIN)),
    );
    expect(REVERSE_REASON_MIN).toBe(10);
  });
});
