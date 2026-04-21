import { BadRequestException, Injectable } from '@nestjs/common';
import { ShippingMethod, ShippingQuote } from './shop-shipping.types';

const RATES: Record<ShippingMethod, { label: string; fee: number; etaDays: string }> = {
  [ShippingMethod.BRANCH_PICKUP]: { label: 'รับเองที่สาขาลพบุรี', fee: 0, etaDays: 'วันเดียวกัน' },
  [ShippingMethod.KERRY]: { label: 'Kerry Express', fee: 60, etaDays: '1-2 วัน' },
  [ShippingMethod.FLASH]: { label: 'Flash Express', fee: 50, etaDays: '1-2 วัน' },
  [ShippingMethod.JT_EXPRESS]: { label: 'J&T Express', fee: 55, etaDays: '2-3 วัน' },
  [ShippingMethod.THAILAND_POST]: { label: 'ไปรษณีย์ไทย EMS', fee: 40, etaDays: '2-3 วัน' },
};

@Injectable()
export class ShopShippingService {
  listMethods(): ShippingQuote[] {
    return (Object.keys(RATES) as ShippingMethod[]).map((m) => ({
      method: m,
      label: RATES[m].label,
      fee: RATES[m].fee,
      etaDays: RATES[m].etaDays,
      available: true,
    }));
  }

  quote(method: ShippingMethod, _province: string): ShippingQuote {
    const rate = RATES[method];
    if (!rate) throw new BadRequestException('วิธีจัดส่งไม่ถูกต้อง');
    return { method, label: rate.label, fee: rate.fee, etaDays: rate.etaDays, available: true };
  }
}
