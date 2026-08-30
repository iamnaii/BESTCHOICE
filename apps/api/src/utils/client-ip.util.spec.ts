import { clientIp, forwardedChain, trustedProxyHops } from './client-ip.util';

function req(xff?: string | string[], ip?: string, socketIp?: string) {
  return {
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    ip,
    socket: socketIp ? { remoteAddress: socketIp } : undefined,
  };
}

describe('client-ip.util', () => {
  const saved = process.env.TRUSTED_PROXY_HOPS;

  afterEach(() => {
    if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = saved;
    delete process.env.IP_CHAIN_DEBUG;
  });

  describe('forwardedChain', () => {
    it('แยก + trim ทุก entry (ซ้าย = ต้นทาง)', () => {
      expect(forwardedChain(req('1.2.3.4, 5.6.7.8 ,9.9.9.9'))).toEqual([
        '1.2.3.4',
        '5.6.7.8',
        '9.9.9.9',
      ]);
    });

    it('รวม header ที่มาหลายบรรทัดเป็นสายเดียว', () => {
      expect(forwardedChain(req(['1.2.3.4', '5.6.7.8']))).toEqual(['1.2.3.4', '5.6.7.8']);
    });

    it('ทิ้ง entry ที่ไม่ใช่ IP — กันคนยัดขยะเข้ามาเป็นกุญแจ rate limit', () => {
      expect(forwardedChain(req('not-an-ip, 1.2.3.4, <script>, 5.6.7.8'))).toEqual([
        '1.2.3.4',
        '5.6.7.8',
      ]);
    });

    it('ไม่มี header → array ว่าง', () => {
      expect(forwardedChain(req())).toEqual([]);
    });
  });

  describe('trustedProxyHops', () => {
    it('ไม่ตั้งค่า → null (โหมดเดิม)', () => {
      delete process.env.TRUSTED_PROXY_HOPS;
      expect(trustedProxyHops()).toBeNull();
    });

    it('ค่าที่อ่านไม่ออก → null ไม่ใช่ 0 (0 มีความหมายจริง ห้ามเดา)', () => {
      process.env.TRUSTED_PROXY_HOPS = 'abc';
      expect(trustedProxyHops()).toBeNull();
    });

    it('ค่าติดลบ → null', () => {
      process.env.TRUSTED_PROXY_HOPS = '-2';
      expect(trustedProxyHops()).toBeNull();
    });

    it('อ่านเลขได้', () => {
      process.env.TRUSTED_PROXY_HOPS = '2';
      expect(trustedProxyHops()).toBe(2);
    });
  });

  describe('clientIp', () => {
    it('โหมดเดิม (ไม่ตั้ง hops) → entry ซ้ายสุด', () => {
      delete process.env.TRUSTED_PROXY_HOPS;
      expect(clientIp(req('1.1.1.1, 2.2.2.2, 3.3.3.3'))).toBe('1.1.1.1');
    });

    it('hops=0 → ขวาสุด (proxy ที่ต่อกับเราโดยตรง)', () => {
      process.env.TRUSTED_PROXY_HOPS = '0';
      expect(clientIp(req('1.1.1.1, 2.2.2.2, 3.3.3.3'))).toBe('3.3.3.3');
    });

    it('hops=1 → ถอยจากขวามา 1 ช่อง', () => {
      process.env.TRUSTED_PROXY_HOPS = '1';
      expect(clientIp(req('1.1.1.1, 2.2.2.2, 3.3.3.3'))).toBe('2.2.2.2');
    });

    it('hops มากกว่าความยาว chain → ไม่หลุด index ติดลบ', () => {
      process.env.TRUSTED_PROXY_HOPS = '9';
      expect(clientIp(req('1.1.1.1, 2.2.2.2'))).toBe('1.1.1.1');
    });

    it('ไม่มี XFF → ใช้ req.ip', () => {
      expect(clientIp(req(undefined, '8.8.8.8'))).toBe('8.8.8.8');
    });

    it('ไม่มีทั้ง XFF และ req.ip → ใช้ socket', () => {
      expect(clientIp(req(undefined, undefined, '7.7.7.7'))).toBe('7.7.7.7');
    });

    it('XFF มีแต่ขยะ → ตกไปใช้ req.ip ไม่ใช่คืนขยะ', () => {
      expect(clientIp(req('garbage, ???', '8.8.8.8'))).toBe('8.8.8.8');
    });

    it('ไม่มีอะไรเลย → string ว่าง (ไม่ throw)', () => {
      expect(clientIp(req())).toBe('');
    });
  });
});
