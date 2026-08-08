import { computeProductQuote, resolveProductPrices } from './product-quote.service';

const CONFIG_WITH_RATES = {
  minDownPaymentPct: '0.2000',
  storeCommissionPct: '0.0500',
  vatPct: '0.0700',
  interestRate: '0.0250',
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
  rates: [
    { months: 6, ratePct: '0.1500' },
    { months: 12, ratePct: '0.3000' },
  ],
};

describe('resolveProductPrices — columns-first แล้วค่อย fallback prices[]', () => {
  it('อ่านคอลัมน์ก่อนเสมอ', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_NEW',
        cashPrice: '32900',
        installmentPrice: '34900',
        prices: [{ label: 'ราคาเงินสด', amount: '1' }],
      }),
    ).toEqual({ cash: 32900, installment: 34900 });
  });

  it('คอลัมน์ว่าง → ใช้ label ตรงตัวก่อน แล้วค่อย prefix', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [
          { label: 'ราคาเงินสด', amount: '20000' },
          { label: 'ราคาผ่อน GFIN', amount: '23000' },
          { label: 'ราคาผ่อน BESTCHOICE', amount: '22000' },
        ],
      }),
    ).toEqual({ cash: 20000, installment: 22000 });
  });

  it('ไม่มีทั้งคอลัมน์และ row → null (ห้าม fallback prices[0])', () => {
    expect(
      resolveProductPrices({
        category: 'PHONE_USED',
        cashPrice: null,
        installmentPrice: null,
        prices: [{ label: 'ราคาขายต่อ (Refurbished)', amount: '9999' }],
      }),
    ).toEqual({ cash: null, installment: null });
  });
});

describe('computeProductQuote — golden (ต้องตรงกับ calcBcInstallment ทุกบาท)', () => {
  it('เลือกงวดยาวสุดในตารางอัตรา + ดาวน์ขั้นต่ำ', () => {
    // 20,000 / 12 งวด / rate 30% / down 20% / com 5% / vat 7%
    // down 4,000 → financed 16,000 → ดอกเบี้ย 4,800 → คอม 800
    // subtotal 21,600 → vat 1,512 → total 23,112 → งวดละ 1,926.00
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '19500', installmentPrice: '20000' },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 19500,
      installmentPrice: 20000,
      months: 12,
      monthlyPayment: 1926,
      downAmount: 4000,
    });
  });

  it('ไม่มี InterestConfigRate → สังเคราะห์ rate ต่อเดือน × จำนวนงวด (เหมือน installment-preview)', () => {
    // rate 2.5%/เดือน × 10 งวด = 25% → financed 16,000 → ดอก 4,000 + คอม 800
    // subtotal 20,800 → vat 1,456 → total 22,256 → งวดละ 2,225.60
    expect(
      computeProductQuote(
        { category: 'PHONE_USED', cashPrice: null, installmentPrice: '20000' },
        { ...CONFIG_WITH_RATES, minInstallmentMonths: 6, maxInstallmentMonths: 10, rates: [] },
      ),
    ).toEqual({
      cashPrice: null,
      installmentPrice: 20000,
      months: 10,
      monthlyPayment: 2225.6,
      downAmount: 4000,
    });
  });

  it('ไม่มีราคาผ่อน → ไม่มีบรรทัดผ่อน (ไม่ throw)', () => {
    expect(
      computeProductQuote(
        { category: 'PHONE_NEW', cashPrice: '32900', installmentPrice: null },
        CONFIG_WITH_RATES,
      ),
    ).toEqual({
      cashPrice: 32900,
      installmentPrice: null,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });

  it('ไม่มี InterestConfig ของหมวดนี้ → ไม่มีบรรทัดผ่อน', () => {
    expect(
      computeProductQuote(
        { category: 'ACCESSORY', cashPrice: '590', installmentPrice: '590' },
        null,
      ),
    ).toEqual({
      cashPrice: 590,
      installmentPrice: 590,
      months: null,
      monthlyPayment: null,
      downAmount: null,
    });
  });
});
