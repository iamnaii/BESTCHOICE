import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';

export const calcTables: GfinTables = {
  mappings: [
    { id: 'm1', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '256GB', condition: 'HAND_2', maxPrice: '38900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: true },
    { id: 'm2', gfinSeries: 'iPhone 17 Pro Max', gfinVariant: null, storage: '512GB', condition: 'HAND_2', maxPrice: '41900', modelMatchPattern: 'iPhone 17 Pro Max', isActive: false },
    { id: 'm3', gfinSeries: 'iPhone 12', gfinVariant: null, storage: '64GB', condition: 'HAND_2', maxPrice: '9000', modelMatchPattern: 'iPhone 12', isActive: true },
  ],
  rules: [{ id: 'r1', label: 'x', seriesPattern: 'iPhone 17 Pro Max', condition: 'HAND_2', allowance: '2000', maxMonths: 15, minDownPct: 30, isActive: true }],
  factors: [
    { id: 'f12', months: 12, shopCommissionPct: 15, factor: '0.1105', feePerInstallment: '100', isActive: true },
    { id: 'f15', months: 15, shopCommissionPct: 15, factor: '0.0921', feePerInstallment: '100', isActive: true },
  ],
  settings: { minDownPct: 25, maxDownPct: 80, downStepPct: 5, contractFee: 100, commissionPctByCategory: { PHONE: 15, TABLET: 5 } },
};
