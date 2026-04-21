import { Test } from '@nestjs/testing';
import { ShopShippingService } from './shop-shipping.service';
import { ShippingMethod } from './shop-shipping.types';

describe('ShopShippingService', () => {
  let service: ShopShippingService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({ providers: [ShopShippingService] }).compile();
    service = mod.get(ShopShippingService);
  });

  it('lists all shipping methods with branch pickup free', () => {
    const methods = service.listMethods();
    expect(methods).toHaveLength(5);
    const pickup = methods.find((m) => m.method === ShippingMethod.BRANCH_PICKUP);
    expect(pickup?.fee).toBe(0);
  });

  it('quotes Kerry 60 THB for any province', () => {
    const quote = service.quote(ShippingMethod.KERRY, 'อยุธยา');
    expect(quote.fee).toBe(60);
    expect(quote.available).toBe(true);
  });

  it('throws on unknown method', () => {
    expect(() => service.quote('INVALID' as ShippingMethod, 'ลพบุรี')).toThrow();
  });
});
