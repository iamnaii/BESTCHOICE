import { PrismaClient, Prisma } from '@prisma/client';

// tradeInValuation is added via migration — cast to any until `prisma generate` runs
type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Seed data for TradeInValuation table.
 * Prices are approximate market rates for Thailand (THB) as of 2026.
 * Condition grades: A = ใหม่มาก/ไม่มีรอย, B = รอยเล็กน้อย, C = รอยปกติ, D = รอยมาก/มีปัญหา
 */

type ValuationEntry = {
  brand: string;
  model: string;
  storage: string;
  condition: 'A' | 'B' | 'C' | 'D';
  basePrice: number;
  note?: string;
};

const valuationData: ValuationEntry[] = [
  // ─── Apple iPhone 16 Series ──────────────────────────────────────────────────
  { brand: 'Apple', model: 'iPhone 16', storage: '128GB', condition: 'A', basePrice: 25000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '128GB', condition: 'B', basePrice: 22000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '128GB', condition: 'C', basePrice: 18000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '128GB', condition: 'D', basePrice: 13000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '256GB', condition: 'A', basePrice: 27000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '256GB', condition: 'B', basePrice: 24000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '256GB', condition: 'C', basePrice: 20000 },
  { brand: 'Apple', model: 'iPhone 16', storage: '256GB', condition: 'D', basePrice: 15000 },
  { brand: 'Apple', model: 'iPhone 16 Plus', storage: '128GB', condition: 'A', basePrice: 28000 },
  { brand: 'Apple', model: 'iPhone 16 Plus', storage: '128GB', condition: 'B', basePrice: 25000 },
  { brand: 'Apple', model: 'iPhone 16 Plus', storage: '128GB', condition: 'C', basePrice: 20000 },
  { brand: 'Apple', model: 'iPhone 16 Plus', storage: '128GB', condition: 'D', basePrice: 15000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', condition: 'A', basePrice: 35000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', condition: 'B', basePrice: 31000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', condition: 'C', basePrice: 26000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '256GB', condition: 'D', basePrice: 19000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '512GB', condition: 'A', basePrice: 40000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '512GB', condition: 'B', basePrice: 36000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '512GB', condition: 'C', basePrice: 30000 },
  { brand: 'Apple', model: 'iPhone 16 Pro', storage: '512GB', condition: 'D', basePrice: 22000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', condition: 'A', basePrice: 40000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', condition: 'B', basePrice: 36000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', condition: 'C', basePrice: 30000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB', condition: 'D', basePrice: 22000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '512GB', condition: 'A', basePrice: 45000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '512GB', condition: 'B', basePrice: 40000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '512GB', condition: 'C', basePrice: 34000 },
  { brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '512GB', condition: 'D', basePrice: 25000 },

  // ─── Apple iPhone 15 Series ──────────────────────────────────────────────────
  { brand: 'Apple', model: 'iPhone 15', storage: '128GB', condition: 'A', basePrice: 20000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '128GB', condition: 'B', basePrice: 17000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '128GB', condition: 'C', basePrice: 14000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '128GB', condition: 'D', basePrice: 10000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '256GB', condition: 'A', basePrice: 22000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '256GB', condition: 'B', basePrice: 19000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '256GB', condition: 'C', basePrice: 16000 },
  { brand: 'Apple', model: 'iPhone 15', storage: '256GB', condition: 'D', basePrice: 11000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', condition: 'A', basePrice: 28000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', condition: 'B', basePrice: 25000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', condition: 'C', basePrice: 21000 },
  { brand: 'Apple', model: 'iPhone 15 Pro', storage: '256GB', condition: 'D', basePrice: 15000 },
  { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'A', basePrice: 32000 },
  { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'B', basePrice: 28000 },
  { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'C', basePrice: 23000 },
  { brand: 'Apple', model: 'iPhone 15 Pro Max', storage: '256GB', condition: 'D', basePrice: 17000 },

  // ─── Apple iPhone 14 Series ──────────────────────────────────────────────────
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB', condition: 'A', basePrice: 15000 },
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB', condition: 'B', basePrice: 13000 },
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB', condition: 'C', basePrice: 10000 },
  { brand: 'Apple', model: 'iPhone 14', storage: '128GB', condition: 'D', basePrice: 7000 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', condition: 'A', basePrice: 20000 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', condition: 'B', basePrice: 17000 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', condition: 'C', basePrice: 14000 },
  { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128GB', condition: 'D', basePrice: 10000 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', condition: 'A', basePrice: 23000 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', condition: 'B', basePrice: 20000 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', condition: 'C', basePrice: 16000 },
  { brand: 'Apple', model: 'iPhone 14 Pro Max', storage: '256GB', condition: 'D', basePrice: 11000 },

  // ─── Apple iPhone 13 Series ──────────────────────────────────────────────────
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB', condition: 'A', basePrice: 12000 },
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB', condition: 'B', basePrice: 10000 },
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB', condition: 'C', basePrice: 8000 },
  { brand: 'Apple', model: 'iPhone 13', storage: '128GB', condition: 'D', basePrice: 5500 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', condition: 'A', basePrice: 15000 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', condition: 'B', basePrice: 13000 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', condition: 'C', basePrice: 10000 },
  { brand: 'Apple', model: 'iPhone 13 Pro', storage: '128GB', condition: 'D', basePrice: 7000 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '256GB', condition: 'A', basePrice: 17000 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '256GB', condition: 'B', basePrice: 14000 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '256GB', condition: 'C', basePrice: 11000 },
  { brand: 'Apple', model: 'iPhone 13 Pro Max', storage: '256GB', condition: 'D', basePrice: 8000 },

  // ─── Samsung Galaxy S24 Series ───────────────────────────────────────────────
  { brand: 'Samsung', model: 'Galaxy S24', storage: '128GB', condition: 'A', basePrice: 18000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '128GB', condition: 'B', basePrice: 15000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '128GB', condition: 'C', basePrice: 12000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '128GB', condition: 'D', basePrice: 8000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', condition: 'A', basePrice: 20000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', condition: 'B', basePrice: 17000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', condition: 'C', basePrice: 14000 },
  { brand: 'Samsung', model: 'Galaxy S24', storage: '256GB', condition: 'D', basePrice: 9000 },
  { brand: 'Samsung', model: 'Galaxy S24+', storage: '256GB', condition: 'A', basePrice: 25000 },
  { brand: 'Samsung', model: 'Galaxy S24+', storage: '256GB', condition: 'B', basePrice: 21000 },
  { brand: 'Samsung', model: 'Galaxy S24+', storage: '256GB', condition: 'C', basePrice: 17000 },
  { brand: 'Samsung', model: 'Galaxy S24+', storage: '256GB', condition: 'D', basePrice: 12000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', condition: 'A', basePrice: 35000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', condition: 'B', basePrice: 30000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', condition: 'C', basePrice: 24000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '256GB', condition: 'D', basePrice: 17000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '512GB', condition: 'A', basePrice: 38000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '512GB', condition: 'B', basePrice: 33000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '512GB', condition: 'C', basePrice: 27000 },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra', storage: '512GB', condition: 'D', basePrice: 19000 },

  // ─── Samsung Galaxy S23 Series ───────────────────────────────────────────────
  { brand: 'Samsung', model: 'Galaxy S23', storage: '128GB', condition: 'A', basePrice: 14000 },
  { brand: 'Samsung', model: 'Galaxy S23', storage: '128GB', condition: 'B', basePrice: 12000 },
  { brand: 'Samsung', model: 'Galaxy S23', storage: '128GB', condition: 'C', basePrice: 9000 },
  { brand: 'Samsung', model: 'Galaxy S23', storage: '128GB', condition: 'D', basePrice: 6000 },
  { brand: 'Samsung', model: 'Galaxy S23+', storage: '256GB', condition: 'A', basePrice: 18000 },
  { brand: 'Samsung', model: 'Galaxy S23+', storage: '256GB', condition: 'B', basePrice: 15000 },
  { brand: 'Samsung', model: 'Galaxy S23+', storage: '256GB', condition: 'C', basePrice: 12000 },
  { brand: 'Samsung', model: 'Galaxy S23+', storage: '256GB', condition: 'D', basePrice: 8000 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', storage: '256GB', condition: 'A', basePrice: 24000 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', storage: '256GB', condition: 'B', basePrice: 20000 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', storage: '256GB', condition: 'C', basePrice: 16000 },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra', storage: '256GB', condition: 'D', basePrice: 11000 },

  // ─── Samsung Galaxy A Series (popular mid-range) ─────────────────────────────
  { brand: 'Samsung', model: 'Galaxy A55', storage: '128GB', condition: 'A', basePrice: 9000 },
  { brand: 'Samsung', model: 'Galaxy A55', storage: '128GB', condition: 'B', basePrice: 7500 },
  { brand: 'Samsung', model: 'Galaxy A55', storage: '128GB', condition: 'C', basePrice: 6000 },
  { brand: 'Samsung', model: 'Galaxy A55', storage: '128GB', condition: 'D', basePrice: 4000 },
  { brand: 'Samsung', model: 'Galaxy A35', storage: '128GB', condition: 'A', basePrice: 6500 },
  { brand: 'Samsung', model: 'Galaxy A35', storage: '128GB', condition: 'B', basePrice: 5500 },
  { brand: 'Samsung', model: 'Galaxy A35', storage: '128GB', condition: 'C', basePrice: 4500 },
  { brand: 'Samsung', model: 'Galaxy A35', storage: '128GB', condition: 'D', basePrice: 3000 },

  // ─── Xiaomi Series ───────────────────────────────────────────────────────────
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', storage: '256GB', condition: 'A', basePrice: 6000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', storage: '256GB', condition: 'B', basePrice: 5000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', storage: '256GB', condition: 'C', basePrice: 4000 },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', storage: '256GB', condition: 'D', basePrice: 2500 },
  { brand: 'Xiaomi', model: 'POCO X6 Pro', storage: '256GB', condition: 'A', basePrice: 7000 },
  { brand: 'Xiaomi', model: 'POCO X6 Pro', storage: '256GB', condition: 'B', basePrice: 6000 },
  { brand: 'Xiaomi', model: 'POCO X6 Pro', storage: '256GB', condition: 'C', basePrice: 4800 },
  { brand: 'Xiaomi', model: 'POCO X6 Pro', storage: '256GB', condition: 'D', basePrice: 3000 },

  // ─── OPPO Series ─────────────────────────────────────────────────────────────
  { brand: 'OPPO', model: 'Reno12 Pro', storage: '256GB', condition: 'A', basePrice: 8000 },
  { brand: 'OPPO', model: 'Reno12 Pro', storage: '256GB', condition: 'B', basePrice: 6500 },
  { brand: 'OPPO', model: 'Reno12 Pro', storage: '256GB', condition: 'C', basePrice: 5000 },
  { brand: 'OPPO', model: 'Reno12 Pro', storage: '256GB', condition: 'D', basePrice: 3000 },
  { brand: 'OPPO', model: 'Find X8 Pro', storage: '256GB', condition: 'A', basePrice: 25000 },
  { brand: 'OPPO', model: 'Find X8 Pro', storage: '256GB', condition: 'B', basePrice: 21000 },
  { brand: 'OPPO', model: 'Find X8 Pro', storage: '256GB', condition: 'C', basePrice: 17000 },
  { brand: 'OPPO', model: 'Find X8 Pro', storage: '256GB', condition: 'D', basePrice: 12000 },

  // ─── vivo Series ─────────────────────────────────────────────────────────────
  { brand: 'vivo', model: 'X100 Pro', storage: '256GB', condition: 'A', basePrice: 22000 },
  { brand: 'vivo', model: 'X100 Pro', storage: '256GB', condition: 'B', basePrice: 18000 },
  { brand: 'vivo', model: 'X100 Pro', storage: '256GB', condition: 'C', basePrice: 14000 },
  { brand: 'vivo', model: 'X100 Pro', storage: '256GB', condition: 'D', basePrice: 9000 },
  { brand: 'vivo', model: 'V30 Pro', storage: '256GB', condition: 'A', basePrice: 9000 },
  { brand: 'vivo', model: 'V30 Pro', storage: '256GB', condition: 'B', basePrice: 7500 },
  { brand: 'vivo', model: 'V30 Pro', storage: '256GB', condition: 'C', basePrice: 6000 },
  { brand: 'vivo', model: 'V30 Pro', storage: '256GB', condition: 'D', basePrice: 3500 },
];

export async function seedTradeInValuations(prisma: PrismaClient) {
  console.log('Seeding trade-in valuations...');
  let created = 0;
  let skipped = 0;
  const db = prisma as unknown as PrismaAny;

  for (const entry of valuationData) {
    const existing = await db.tradeInValuation.findFirst({
      where: {
        brand: entry.brand,
        model: entry.model,
        storage: entry.storage,
        condition: entry.condition,
        deletedAt: null,
      },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await db.tradeInValuation.create({
      data: {
        brand: entry.brand,
        model: entry.model,
        storage: entry.storage,
        condition: entry.condition,
        basePrice: new Prisma.Decimal(entry.basePrice),
        note: entry.note ?? null,
      },
    });
    created++;
  }

  console.log(`Trade-in valuations: ${created} created, ${skipped} skipped (already existed)`);
}
