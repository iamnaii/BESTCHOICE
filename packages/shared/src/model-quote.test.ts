import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { buildModelQuote, type ModelQuoteGfinContext, type ModelQuoteInput } from './model-quote';
import type { BcConfig, GfinRateFactorRow } from './installment-calc.types';

// ตั้งค่าตามชีต MASTER 2026-11-19 (สเปคข้อ 8): ดอกเบี้ย 10 / 12 งวด = 50% · ดาวน์ขั้นต่ำ 15% · คอม 10% · VAT 7%
const BC: BcConfig = {
  minDownPct: new Decimal('0.15'),
  commissionPct: new Decimal('0.10'),
  vatPct: new Decimal('0.07'),
  ratePctByMonths: new Map([
    [10, new Decimal('0.50')],
    [12, new Decimal('0.50')],
  ]),
  allowedMonths: [10, 12],
};

// เรท GFIN ตามชีต: 10 งวด 0.201 · 12 งวด 0.17 · 15 งวด 0.1467 · ค่าธรรมเนียม 100/งวด · คอมมือถือ 15%
const RATES: GfinRateFactorRow[] = (
  [
    [10, '0.201'],
    [12, '0.17'],
    [15, '0.1467'],
  ] as const
).map(([months, factor]) => ({
  months,
  shopCommissionPct: 15,
  factor: new Decimal(factor),
  feePerInstallment: new Decimal(100),
  isActive: true,
}));

interface GoldenRow {
  model: string;
  storage: string;
  category: 'PHONE_NEW' | 'PHONE_USED';
  cost: number | null;
  cash: number;
  bc: number;
  fin: number;
  t1: number;
  d1: number | null;
  t2: number | null;
  /** ใบราคา G-Finn ของแถว: ราคา · OVER · งวดสูงสุด · ดาวน์ขั้นต่ำ % ที่ชีตใช้ — null = GFIN ไม่รับ */
  gfin: { list: number; over: number; maxMonths: number; minDownPct: number } | null;
  expect: {
    down1: number;
    contract: string;
    display: number;
    /** ค่างวดเรท 1 ที่ชีตพิมพ์ (คอลัมน์ U) */
    sheet: number;
    price2: number;
    rate2: { down: number; monthly: number; months: number; price3: number } | null;
  };
}

// สร้างจาก 'ข้อมูลหลัก มือ 1' / 'ข้อมูลหลัก มือ 2' ของ master-sheet-2026-11-19.xlsx (คอลัมน์ A–K, M–O, S, U, X, Y, AA, AB, AJ)
// ค่าคาดหวังคิดด้วยสูตรของแผนนี้แล้วเทียบชีต: ตรงทุกบาท ยกเว้นค่างวดเรท 1 ที่แสดง (สูงกว่าชีต 0–3 บาท)
const GOLDEN: GoldenRow[] = [
  { model: 'iPhone 15', storage: '128GB', category: 'PHONE_NEW', cost: 25800, cash: 25900, bc: 25900, fin: 25900, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 1000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3900, contract: '3138.66', display: 3139, sheet: 3137, price2: 28100, rate2: { down: 6500, monthly: 3403, months: 12, price3: 28738 } } },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', cost: null, cash: 28900, bc: 28900, fin: 28900, t1: 12, d1: null, t2: null, gfin: { list: 26900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4400, contract: '3495.33', display: 3496, sheet: 3493, price2: 31350, rate2: { down: 7300, monthly: 3280, months: 15, price3: 32126 } } },
  { model: 'iPhone 16 Plus', storage: '128GB', category: 'PHONE_NEW', cost: null, cash: 31900, bc: 31900, fin: 31900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4800, contract: '3866.26', display: 3867, sheet: 3864, price2: 34610, rate2: { down: 8000, monthly: 3610, months: 15, price3: 35413 } } },
  { model: 'iPhone 17', storage: '256GB', category: 'PHONE_NEW', cost: 32000, cash: 31900, bc: 31900, fin: 31900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 4800, contract: '3866.26', display: 3867, sheet: 3864, price2: 34610, rate2: { down: 9600, monthly: 3376, months: 15, price3: 35179 } } },
  { model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_NEW', cost: 38900, cash: 39000, bc: 39000, fin: 39000, t1: 12, d1: 15000, t2: null, gfin: { list: 39900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 15000, contract: '3424.00', display: 3424, sheet: 3422, price2: 41400, rate2: { down: 9700, monthly: 4403, months: 15, price3: 43329 } } },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_NEW', cost: 43500, cash: 45900, bc: 45900, fin: 45900, t1: 12, d1: 15000, t2: null, gfin: { list: 44900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 15000, contract: '4408.40', display: 4409, sheet: 4406, price2: 48990, rate2: { down: 13100, monthly: 4917, months: 15, price3: 50754 } } },
  { model: 'iPhone 18 Pro', storage: '256GB', category: 'PHONE_NEW', cost: 47000, cash: 48900, bc: 48900, fin: 48900, t1: 12, d1: 18000, t2: 15, gfin: { list: 48900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 18000, contract: '4408.40', display: 4409, sheet: 4406, price2: 51990, rate2: { down: 13300, monthly: 5327, months: 15, price3: 54174 } } },
  { model: 'iPhone 18 Pro Max', storage: '256GB', category: 'PHONE_NEW', cost: 52500, cash: 52900, bc: 52900, fin: 52900, t1: 12, d1: 20000, t2: 15, gfin: { list: 52900, over: 2000, maxMonths: 15, minDownPct: 30 },
    expect: { down1: 20000, contract: '4693.73', display: 4694, sheet: 4691, price2: 56190, rate2: { down: 14500, monthly: 5738, months: 15, price3: 58594 } } },
  { model: 'iPhone 12', storage: '64GB', category: 'PHONE_USED', cost: 5000, cash: 8900, bc: 7000, fin: 6700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1100, contract: '1010.08', display: 1011, sheet: 1010, price2: 7590, rate2: null } },
  { model: 'iPhone 12', storage: '128GB', category: 'PHONE_USED', cost: 6000, cash: 9900, bc: 7800, fin: 7500, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1200, contract: '1129.92', display: 1130, sheet: 1129, price2: 8460, rate2: null } },
  { model: 'iPhone 12', storage: '256GB', category: 'PHONE_USED', cost: 7000, cash: 10900, bc: 8500, fin: 8200, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1300, contract: '1232.64', display: 1233, sheet: 1232, price2: 9220, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '128GB', category: 'PHONE_USED', cost: 8300, cash: 10900, bc: 8700, fin: 8200, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1400, contract: '1249.76', display: 1250, sheet: 1249, price2: 9430, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '256GB', category: 'PHONE_USED', cost: 8800, cash: 11900, bc: 9500, fin: 9000, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1500, contract: '1369.60', display: 1370, sheet: 1369, price2: 10300, rate2: null } },
  { model: 'iPhone 12 Pro', storage: '512GB', category: 'PHONE_USED', cost: 9300, cash: 12900, bc: 10200, fin: 9700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1600, contract: '1472.32', display: 1473, sheet: 1472, price2: 11060, rate2: null } },
  { model: 'iPhone 12 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 10500, cash: 12900, bc: 10200, fin: 9700, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1600, contract: '1472.32', display: 1473, sheet: 1472, price2: 11060, rate2: null } },
  { model: 'iPhone 12 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 11000, cash: 13900, bc: 11000, fin: 10500, t1: 10, d1: null, t2: null, gfin: null,
    expect: { down1: 1700, contract: '1592.16', display: 1593, sheet: 1592, price2: 11930, rate2: null } },
  { model: 'iPhone 13', storage: '128GB', category: 'PHONE_USED', cost: 9700, cash: 12500, bc: 10200, fin: 9600, t1: 12, d1: null, t2: null, gfin: { list: 12900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1600, contract: '1226.93', display: 1227, sheet: 1226, price2: 11060, rate2: { down: 0, monthly: 1745, months: 12, price3: 11026 } } },
  { model: 'iPhone 13', storage: '256GB', category: 'PHONE_USED', cost: 10500, cash: 13500, bc: 11000, fin: 10400, t1: 12, d1: null, t2: null, gfin: { list: 13900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1700, contract: '1326.80', display: 1327, sheet: 1326, price2: 11930, rate2: { down: 0, monthly: 1873, months: 12, price3: 11888 } } },
  { model: 'iPhone 13 Pro', storage: '128GB', category: 'PHONE_USED', cost: 12000, cash: 14900, bc: 12500, fin: 11900, t1: 12, d1: null, t2: null, gfin: { list: 15900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1900, contract: '1512.26', display: 1513, sheet: 1511, price2: 13560, rate2: { down: 0, monthly: 2128, months: 12, price3: 13613 } } },
  { model: 'iPhone 13 Pro', storage: '256GB', category: 'PHONE_USED', cost: 13000, cash: 15900, bc: 13200, fin: 12600, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2000, contract: '1597.86', display: 1598, sheet: 1597, price2: 14320, rate2: { down: 0, monthly: 2255, months: 12, price3: 14476 } } },
  { model: 'iPhone 13 Pro', storage: '512GB', category: 'PHONE_USED', cost: 13200, cash: 16900, bc: 14200, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2200, contract: '1712.00', display: 1712, sheet: 1711, price2: 15400, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 13 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 13000, cash: 16900, bc: 14200, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2200, contract: '1712.00', display: 1712, sheet: 1711, price2: 15400, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 13 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 14000, cash: 17900, bc: 14900, fin: 14100, t1: 12, d1: null, t2: null, gfin: { list: 18900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2300, contract: '1797.60', display: 1798, sheet: 1796, price2: 16160, rate2: { down: 0, monthly: 2510, months: 12, price3: 16201 } } },
  { model: 'iPhone 13 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 15000, cash: 18900, bc: 15700, fin: 14900, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 0, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2400, contract: '1897.46', display: 1898, sheet: 1896, price2: 17030, rate2: { down: 0, monthly: 2638, months: 12, price3: 17063 } } },
  { model: 'iPhone 14', storage: '128GB', category: 'PHONE_USED', cost: 11500, cash: 13900, bc: 11700, fin: 11100, t1: 12, d1: null, t2: null, gfin: { list: 12900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1800, contract: '1412.40', display: 1413, sheet: 1411, price2: 12690, rate2: { down: 0, monthly: 2000, months: 12, price3: 12751 } } },
  { model: 'iPhone 14', storage: '256GB', category: 'PHONE_USED', cost: 12000, cash: 14900, bc: 12500, fin: 11900, t1: 12, d1: null, t2: null, gfin: { list: 13900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 1900, contract: '1512.26', display: 1513, sheet: 1511, price2: 13560, rate2: { down: 0, monthly: 2128, months: 12, price3: 13613 } } },
  { model: 'iPhone 14 Plus', storage: '128GB', category: 'PHONE_USED', cost: 13500, cash: 15900, bc: 14000, fin: 13400, t1: 12, d1: null, t2: null, gfin: { list: 15900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2100, contract: '1697.73', display: 1698, sheet: 1696, price2: 15190, rate2: { down: 0, monthly: 2383, months: 12, price3: 15338 } } },
  { model: 'iPhone 14 Plus', storage: '256GB', category: 'PHONE_USED', cost: 14500, cash: 16900, bc: 14700, fin: 14100, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2300, contract: '1769.06', display: 1770, sheet: 1768, price2: 15940, rate2: { down: 0, monthly: 2510, months: 12, price3: 16201 } } },
  { model: 'iPhone 14 Pro', storage: '128GB', category: 'PHONE_USED', cost: 15500, cash: 18900, bc: 16500, fin: 15600, t1: 12, d1: null, t2: null, gfin: { list: 18900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2500, contract: '1997.33', display: 1998, sheet: 1996, price2: 17900, rate2: { down: 0, monthly: 2765, months: 12, price3: 17926 } } },
  { model: 'iPhone 14 Pro', storage: '256GB', category: 'PHONE_USED', cost: 16500, cash: 19900, bc: 17300, fin: 16400, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2600, contract: '2097.20', display: 2098, sheet: 2096, price2: 18770, rate2: { down: 0, monthly: 2893, months: 12, price3: 18788 } } },
  { model: 'iPhone 14 Pro', storage: '512GB', category: 'PHONE_USED', cost: 17500, cash: 20900, bc: 18200, fin: 17100, t1: 12, d1: null, t2: null, gfin: { list: 20900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2800, contract: '2197.06', display: 2198, sheet: 2196, price2: 19740, rate2: { down: 0, monthly: 3020, months: 12, price3: 19651 } } },
  { model: 'iPhone 14 Pro Max', storage: '128GB', category: 'PHONE_USED', cost: 18000, cash: 21900, bc: 19000, fin: 17900, t1: 12, d1: null, t2: null, gfin: { list: 21900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2900, contract: '2296.93', display: 2297, sheet: 2295, price2: 20610, rate2: { down: 0, monthly: 3148, months: 12, price3: 20513 } } },
  { model: 'iPhone 14 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 19000, cash: 22900, bc: 19700, fin: 18600, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2382.53', display: 2383, sheet: 2381, price2: 21370, rate2: { down: 0, monthly: 3275, months: 12, price3: 21376 } } },
  { model: 'iPhone 15', storage: '128GB', category: 'PHONE_USED', cost: 15500, cash: 18900, bc: 17000, fin: 16000, t1: 12, d1: null, t2: null, gfin: { list: 16900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2600, contract: '2054.40', display: 2055, sheet: 2053, price2: 18440, rate2: { down: 1900, monthly: 2510, months: 12, price3: 18101 } } },
  { model: 'iPhone 15', storage: '256GB', category: 'PHONE_USED', cost: 16500, cash: 19900, bc: 17500, fin: 16800, t1: 12, d1: null, t2: null, gfin: { list: 17900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 2700, contract: '2111.46', display: 2112, sheet: 2110, price2: 18980, rate2: { down: 1900, monthly: 2638, months: 12, price3: 18963 } } },
  { model: 'iPhone 15 Plus', storage: '128GB', category: 'PHONE_USED', cost: 17000, cash: 21900, bc: 19500, fin: 18300, t1: 12, d1: null, t2: null, gfin: { list: 19900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2354.00', display: 2354, sheet: 2352, price2: 21150, rate2: { down: 1900, monthly: 2893, months: 12, price3: 20688 } } },
  { model: 'iPhone 15 Plus', storage: '256GB', category: 'PHONE_USED', cost: 18000, cash: 22900, bc: 20000, fin: 19000, t1: 12, d1: null, t2: null, gfin: { list: 20900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3000, contract: '2425.33', display: 2426, sheet: 2424, price2: 21700, rate2: { down: 1900, monthly: 3020, months: 12, price3: 21551 } } },
  { model: 'iPhone 15 Pro', storage: '128GB', category: 'PHONE_USED', cost: 18500, cash: 23900, bc: 20500, fin: 18600, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3100, contract: '2482.40', display: 2483, sheet: 2481, price2: 22240, rate2: { down: 0, monthly: 3275, months: 12, price3: 21376 } } },
  { model: 'iPhone 15 Pro', storage: '256GB', category: 'PHONE_USED', cost: 19500, cash: 24900, bc: 21200, fin: 19400, t1: 12, d1: null, t2: null, gfin: { list: 23900, over: 2000, maxMonths: 12, minDownPct: 25 },
    expect: { down1: 3200, contract: '2568.00', display: 2568, sheet: 2566, price2: 23000, rate2: { down: 0, monthly: 3403, months: 12, price3: 22238 } } },
  { model: 'iPhone 15 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 22800, cash: 26900, bc: 24200, fin: 23100, t1: 12, d1: null, t2: null, gfin: { list: 28900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3700, contract: '2924.66', display: 2925, sheet: 2923, price2: 26250, rate2: { down: 0, monthly: 3500, months: 15, price3: 26551 } } },
  { model: 'iPhone 15 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 23800, cash: 27900, bc: 25000, fin: 23900, t1: 12, d1: null, t2: null, gfin: { list: 29900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3800, contract: '3024.53', display: 3025, sheet: 3023, price2: 27120, rate2: { down: 0, monthly: 3610, months: 15, price3: 27413 } } },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_USED', cost: 19000, cash: 21900, bc: 20800, fin: 19800, t1: 12, d1: null, t2: null, gfin: { list: 21900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3200, contract: '2510.93', display: 2511, sheet: 2509, price2: 22560, rate2: { down: 1900, monthly: 2730, months: 15, price3: 22413 } } },
  { model: 'iPhone 16', storage: '256GB', category: 'PHONE_USED', cost: 20000, cash: 22900, bc: 21500, fin: 20500, t1: 12, d1: null, t2: null, gfin: { list: 22900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3300, contract: '2596.53', display: 2597, sheet: 2595, price2: 23320, rate2: { down: 1900, monthly: 2840, months: 15, price3: 23276 } } },
  { model: 'iPhone 16 Plus', storage: '128GB', category: 'PHONE_USED', cost: 22500, cash: 24900, bc: 23200, fin: 22300, t1: 12, d1: null, t2: null, gfin: { list: 23900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3500, contract: '2810.53', display: 2811, sheet: 2809, price2: 25170, rate2: { down: 2900, monthly: 2950, months: 15, price3: 25138 } } },
  { model: 'iPhone 16 Plus', storage: '256GB', category: 'PHONE_USED', cost: 23500, cash: 25900, bc: 24000, fin: 23000, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3600, contract: '2910.40', display: 2911, sheet: 2909, price2: 26040, rate2: { down: 2900, monthly: 3060, months: 15, price3: 26001 } } },
  { model: 'iPhone 16 Pro', storage: '128GB', category: 'PHONE_USED', cost: 22000, cash: 26900, bc: 23500, fin: 22400, t1: 12, d1: null, t2: null, gfin: { list: 27900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3600, contract: '2839.06', display: 2840, sheet: 2837, price2: 25490, rate2: { down: 0, monthly: 3390, months: 15, price3: 25688 } } },
  { model: 'iPhone 16 Pro', storage: '256GB', category: 'PHONE_USED', cost: 23000, cash: 27900, bc: 24200, fin: 23100, t1: 12, d1: null, t2: null, gfin: { list: 28900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3700, contract: '2924.66', display: 2925, sheet: 2923, price2: 26250, rate2: { down: 0, monthly: 3500, months: 15, price3: 26551 } } },
  { model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 27500, cash: 32900, bc: 29200, fin: 27600, t1: 12, d1: null, t2: null, gfin: { list: 34900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4400, contract: '3538.13', display: 3539, sheet: 3536, price2: 31680, rate2: { down: 0, monthly: 4160, months: 15, price3: 31726 } } },
  { model: 'iPhone 16 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 28500, cash: 33900, bc: 30700, fin: 29100, t1: 12, d1: null, t2: null, gfin: { list: 36900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 4700, contract: '3709.33', display: 3710, sheet: 3707, price2: 33300, rate2: { down: 0, monthly: 4380, months: 15, price3: 33451 } } },
  { model: 'iPhone 17', storage: '256GB', category: 'PHONE_USED', cost: 24500, cash: 27900, bc: 25000, fin: 24000, t1: 12, d1: null, t2: null, gfin: { list: 24900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 3800, contract: '3024.53', display: 3025, sheet: 3023, price2: 27120, rate2: { down: 3900, monthly: 3060, months: 15, price3: 27001 } } },
  { model: 'iPhone 17 Pro', storage: '256GB', category: 'PHONE_USED', cost: 33000, cash: 36900, bc: 34500, fin: 33000, t1: 12, d1: 10000, t2: null, gfin: { list: 35900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 10000, contract: '3495.33', display: 3496, sheet: 3493, price2: 36950, rate2: { down: 4600, monthly: 4270, months: 15, price3: 37188 } } },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_USED', cost: 38000, cash: 42900, bc: 40000, fin: 38000, t1: 12, d1: 15000, t2: null, gfin: { list: 40900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 15000, contract: '3566.66', display: 3567, sheet: 3565, price2: 42500, rate2: { down: 5900, monthly: 4821, months: 15, price3: 42801 } } },
  { model: 'iPhone 17 Pro Max', storage: '512GB', category: 'PHONE_USED', cost: 33000, cash: 43900, bc: 41000, fin: 39000, t1: 12, d1: 15000, t2: null, gfin: { list: 41900, over: 2000, maxMonths: 15, minDownPct: 25 },
    expect: { down1: 15000, contract: '3709.33', display: 3710, sheet: 3707, price2: 43600, rate2: { down: 6100, monthly: 4931, months: 15, price3: 43863 } } },
];

function gfinFor(row: GoldenRow): ModelQuoteGfinContext {
  const condition = row.category === 'PHONE_USED' ? 'HAND_2' : 'HAND_1';
  return {
    mappings: row.gfin
      ? [{ id: 'm', gfinSeries: row.model, gfinVariant: null, storage: row.storage, condition, maxPrice: new Decimal(row.gfin.list), modelMatchPattern: row.model, isActive: true }]
      : [],
    rules: row.gfin
      ? [{ id: 'r', label: row.model, seriesPattern: row.model, condition, allowance: new Decimal(row.gfin.over), maxMonths: row.gfin.maxMonths, minDownPct: row.gfin.minDownPct, isActive: true }]
      : [],
    rateFactors: RATES,
    settingMinDownPct: new Decimal('0.25'),
    commissionPct: 15,
    contractFee: new Decimal(100),
  };
}

function inputFor(row: GoldenRow, over: Partial<ModelQuoteInput> = {}): ModelQuoteInput {
  return {
    product: { brand: 'Apple', model: row.model, storage: row.storage, category: row.category },
    deviceOrigin: 'THAI',
    cashPrice: row.cash,
    bcPrice: row.bc,
    financePrice: row.fin,
    rate1TermMonths: row.t1,
    rate1DownPayment: row.d1,
    rate2TermMonths: row.t2,
    bcConfig: BC,
    gfin: gfinFor(row),
    costPrice: row.cost,
    ...over,
  };
}

const golden = (model: string, storage: string, category: GoldenRow['category']): GoldenRow => {
  const row = GOLDEN.find((g) => g.model === model && g.storage === storage && g.category === category);
  if (!row) throw new Error(`no golden row ${model} ${storage} ${category}`);
  return row;
};

describe('buildModelQuote — ตัวเลขตรวจสเปคข้อ 4.5 (เครื่องไทย)', () => {
  it('iPhone 15 128GB มือ 1: เงินสด 25,900 · เรท 1 ดาวน์ 3,900 · 3,138.66 → 3,139 × 12 · เรท 2 ดาวน์ 6,500 · 3,403 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 15', '128GB', 'PHONE_NEW')));
    expect(q.cash?.price).toBe(25900);
    expect(q.rate1).toMatchObject({ downAmount: 3900, monthlyContract: 3138.66, monthlyDisplay: 3139, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 6500, monthly: 3403, months: 12, submitPrice: 25900, originNote: false });
  });

  it('iPhone 15 128GB มือ 1 ทุน 25,800: ราคา 2 = 28,100 · ราคา 3 = 28,738 · กำไร 100 / 2,300 / 2,938', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 15', '128GB', 'PHONE_NEW')));
    expect(q.cash?.profit).toBe(100);
    expect(q.rate1).toMatchObject({ recordedSalePrice: 28100, profit: 2300 });
    expect(q.rate2).toMatchObject({ recordedSalePrice: 28738, profit: 2938 });
  });

  it('iPhone 17 Pro 256GB มือ 1: ดาวน์กำหนดเอง 15,000 · 3,424.00 → 3,424 × 12 · เรท 2 ดาวน์ 9,700 · 4,403 × 15', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 17 Pro', '256GB', 'PHONE_NEW')));
    expect(q.cash?.price).toBe(39000);
    expect(q.rate1).toMatchObject({ downAmount: 15000, monthlyContract: 3424, monthlyDisplay: 3424, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 9700, monthly: 4403, months: 15 });
  });

  it('iPhone 12 64GB มือ 2: เรท 1 ดาวน์ 1,100 · 1,010.08 → 1,011 × 10 · GFIN ไม่รับ', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 12', '64GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(8900);
    expect(q.rate1).toMatchObject({ downAmount: 1100, monthlyContract: 1010.08, monthlyDisplay: 1011, months: 10 });
    expect(q.rate2).toEqual({ available: false, reason: 'NO_PRICE_LIST', message: 'GFIN ไม่รับรุ่นนี้' });
  });

  it('iPhone 13 128GB มือ 2: เรท 1 ดาวน์ 1,600 · 1,226.93 → 1,227 × 12 · เรท 2 ดาวน์ 0 · 1,745 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 13', '128GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(12500);
    expect(q.rate1).toMatchObject({ downAmount: 1600, monthlyContract: 1226.93, monthlyDisplay: 1227, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 0, monthly: 1745, months: 12 });
  });

  it('iPhone 14 Pro 128GB มือ 2: เรท 1 ดาวน์ 2,500 · 1,997.33 → 1,998 × 12 · เรท 2 ดาวน์ 0 · 2,765 × 12', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 14 Pro', '128GB', 'PHONE_USED')));
    expect(q.cash?.price).toBe(18900);
    expect(q.rate1).toMatchObject({ downAmount: 2500, monthlyContract: 1997.33, monthlyDisplay: 1998, months: 12 });
    expect(q.rate2).toMatchObject({ available: true, downAmount: 0, monthly: 2765, months: 12 });
  });
});

describe('buildModelQuote — 53 แถวของชีต MASTER (สเปคข้อ 10)', () => {
  it('ชุดตรวจครบ 53 แถว (มือ 1 8 · มือ 2 45)', () => {
    expect(GOLDEN.filter((g) => g.category === 'PHONE_NEW')).toHaveLength(8);
    expect(GOLDEN.filter((g) => g.category === 'PHONE_USED')).toHaveLength(45);
  });

  it.each(GOLDEN.map((g) => [`${g.model} ${g.storage} ${g.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}`, g] as const))(
    '%s',
    (_name, row) => {
      const q = buildModelQuote(inputFor(row));
      expect(q.cash).toEqual({ price: row.cash, profit: row.cost === null ? null : row.cash - row.cost });

      expect(q.rate1).not.toBeNull();
      expect(q.rate1!.downAmount).toBe(row.expect.down1);
      expect(q.rate1!.months).toBe(row.t1);
      expect(q.rate1!.monthlyContract.toFixed(2)).toBe(row.expect.contract);
      expect(q.rate1!.monthlyDisplay).toBe(row.expect.display);
      // ชีตคูณเรท 0.1426 แล้วปัดลง · สัญญาคิด 50% จริงแล้วแสดงปัดขึ้น ⇒ สูงกว่าชีตได้ 0–3 บาท (11 แถวต่าง 3)
      expect(q.rate1!.monthlyDisplay - row.expect.sheet).toBeGreaterThanOrEqual(0);
      expect(q.rate1!.monthlyDisplay - row.expect.sheet).toBeLessThanOrEqual(3);
      expect(q.rate1!.recordedSalePrice).toBe(row.expect.price2);
      expect(q.rate1!.profit).toBe(row.cost === null ? null : row.expect.price2 - row.cost);

      if (row.expect.rate2 === null) {
        expect(q.rate2).toMatchObject({ available: false, reason: 'NO_PRICE_LIST' });
      } else {
        expect(q.rate2).toMatchObject({
          available: true,
          downAmount: row.expect.rate2.down,
          monthly: row.expect.rate2.monthly,
          months: row.expect.rate2.months,
          recordedSalePrice: row.expect.rate2.price3,
          profit: row.cost === null ? null : row.expect.rate2.price3 - row.cost,
        });
      }
    },
  );
});

describe('buildModelQuote — กติกาเพิ่มเติม', () => {
  const iphone15 = golden('iPhone 15', '128GB', 'PHONE_NEW');

  it('เครื่องนอก → OVER ครึ่ง (ราคาส่ง 24,900 + 500)', () => {
    const q = buildModelQuote(inputFor(iphone15, { deviceOrigin: 'IMPORTED' }));
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, downAmount: 6400, monthly: 3339, months: 12, originNote: false });
  });

  it('ยังไม่ระบุไทย/นอก → OVER ครึ่ง + originNote', () => {
    const q = buildModelQuote(inputFor(iphone15, { deviceOrigin: null }));
    expect(q.rate2).toMatchObject({ available: true, submitPrice: 25400, monthly: 3339, originNote: true });
  });

  it('งวดเรท 1 ของรุ่นไม่อยู่ในตารางดอกเบี้ย → 12 · ไม่มี 12 → งวดแรกที่มี', () => {
    expect(buildModelQuote(inputFor(iphone15, { rate1TermMonths: 24 })).rate1?.months).toBe(12);
    const only10: BcConfig = { ...BC, ratePctByMonths: new Map([[10, new Decimal('0.50')]]), allowedMonths: [10] };
    const q = buildModelQuote(inputFor(iphone15, { rate1TermMonths: 12, bcConfig: only10 }));
    expect(q.rate1?.months).toBe(10);
    expect(q.rate1?.allowedMonths).toEqual([10]);
  });

  it('ดาวน์เรท 1 ที่กำหนดเป็นจำนวนเงินไม่ถูกปัด (15,050 คง 15,050)', () => {
    const q = buildModelQuote(inputFor(golden('iPhone 17 Pro', '256GB', 'PHONE_NEW'), { rate1DownPayment: 15050 }));
    expect(q.rate1?.downAmount).toBe(15050);
  });

  it('ไม่มีตั้งค่าดอกเบี้ย หรือไม่มีราคาผ่อน → เรท 1 = null', () => {
    expect(buildModelQuote(inputFor(iphone15, { bcConfig: null })).rate1).toBeNull();
    expect(buildModelQuote(inputFor(iphone15, { bcPrice: null })).rate1).toBeNull();
  });

  it('ไม่มีราคาขาย GFIN → เรท 2 ใช้ราคาผ่อน BESTCHOICE', () => {
    const q = buildModelQuote(inputFor(iphone15, { financePrice: null }));
    expect(q.rate2).toMatchObject({ available: true, salePrice: 25900 });
  });

  it('ไม่มีราคาเลยทั้งสองช่อง → NO_PRICE', () => {
    const q = buildModelQuote(inputFor(iphone15, { financePrice: null, bcPrice: null }));
    expect(q.rate2).toMatchObject({ available: false, reason: 'NO_PRICE' });
  });

  it('ไม่มีเรท GFIN ของงวดนั้น → NO_RATE พร้อมจำนวนงวด', () => {
    const q = buildModelQuote(inputFor(iphone15, { rate2TermMonths: 18 }));
    expect(q.rate2).toEqual({ available: false, reason: 'NO_RATE', message: 'ยังไม่มีเรท GFIN 18 งวด' });
  });

  it('ไม่ส่งตั้งค่า GFIN → NO_CONFIG', () => {
    expect(buildModelQuote(inputFor(iphone15, { gfin: null })).rate2).toMatchObject({ available: false, reason: 'NO_CONFIG' });
  });

  it('ไม่ส่งทุน → กำไรทุกแถวเป็น null', () => {
    const q = buildModelQuote(inputFor(iphone15, { costPrice: undefined }));
    expect(q.cash?.profit).toBeNull();
    expect(q.rate1?.profit).toBeNull();
    expect(q.rate2).toMatchObject({ profit: null });
  });

  it('ไม่มีราคาเงินสด → cash = null', () => {
    expect(buildModelQuote(inputFor(iphone15, { cashPrice: null })).cash).toBeNull();
  });
});
