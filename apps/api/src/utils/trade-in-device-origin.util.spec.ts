import { BadRequestException } from '@nestjs/common';
import { resolveTradeInDeviceOrigin } from './trade-in-device-origin.util';

const answers = (label: string) => [{ questionKey: 'device-origin', choices: [{ label }] }];
describe('origin from validated inspection', () => {
  it('derives imported and Thai origin from stored answers', () => {
    expect(resolveTradeInDeviceOrigin(undefined, answers('เครื่องนอก (LL)'))).toBe('IMPORTED');
    expect(resolveTradeInDeviceOrigin(null, answers('เครื่องศูนย์ไทย (TH)'))).toBe('THAI');
  });
  it('rejects a conflicting intake selection', () => {
    expect(() => resolveTradeInDeviceOrigin('THAI', answers('เครื่องนอก'))).toThrow(BadRequestException);
  });
  it('preserves explicit selection or unknown when the assessment does not specify origin', () => {
    expect(resolveTradeInDeviceOrigin('IMPORTED', [])).toBe('IMPORTED');
    expect(resolveTradeInDeviceOrigin(undefined, answers('ไม่ทราบ'))).toBeNull();
  });
});
