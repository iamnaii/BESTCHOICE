import { PrismaService } from '../../../prisma/prisma.service';
import { extractStorageToken, normalizeStorage } from '../../../utils/device-query-normalize.util';
import { SHOP_BRAND } from '../../../utils/product-readiness.util';
import type { DeviceSpec } from '../data/device-specs';

/**
 * ราคารับซื้อโดยประมาณของ "เครื่องที่ลูกค้าใช้อยู่" — ใช้ร่วมกันโดย recommend_devices
 * และ compare_devices (ห้ามก๊อปไปไว้สองที่)
 *
 * แหล่งเดียว = `TradeInValuation` เกรด A (ตารางกลางที่หน้า /trade-in ใช้ตีราคา)
 *  - ถ้าลูกค้าบอกความจุมาในข้อความ ('ใช้ 11 64GB อยู่') เลือกแถวความจุนั้น
 *  - ไม่บอก/ไม่มีแถวตรง → max(basePrice) ของรุ่น (เพดานสูงสุด ให้ note กำกับว่าเป็นราคาประมาณ)
 *  - ไม่มีแถวเลย → null (บอทต้องไม่เดาราคาเทิร์น)
 *
 * คีย์ `estimateThb` ถูกเพิ่มเข้า GROUNDED_PRICE_KEYS แล้ว — guard รู้จักเลขนี้
 */
export interface TradeInEstimate {
  model: string;
  estimateThb: number;
  note: string;
}

export const TRADE_IN_NOTE = 'ราคาประมาณ ประเมินจริงหน้าร้าน สภาพมีผลต่อราคา';
const TRADE_IN_GRADE = 'A';
/** นโยบายร้าน (persona BASE): "รับเทิร์น iPhone 12 ถึงรุ่นล่าสุด" — รุ่นเก่ากว่านี้ไม่เสนอราคาในแชท */
export const TRADE_IN_MIN_GENERATION = 12;

interface ValuationRow {
  storage: string;
  basePrice: unknown;
}

export async function estimateTradeIn(
  prisma: PrismaService,
  currentSpec: DeviceSpec | null,
  currentModelText: string,
): Promise<TradeInEstimate | null> {
  if (!currentSpec) return null;
  if (currentSpec.generation < TRADE_IN_MIN_GENERATION) return null;
  // นโยบายร้าน (KB extracted:trade_in บน prod): "ไม่รับรุ่น Mini"
  if (currentSpec.variant === 'mini') return null;
  // ชื่อรุ่นในตารางราคากลาง prod (seed yellobe) ต่างจาก canonical บางรุ่น:
  // 'iPhone SE 2022' (ไม่มีวงเล็บ) / 'iPhone Xr' 'iPhone 12 Mini' (ตัวพิมพ์ — insensitive ครอบแล้ว)
  // ตรวจกับ prod 2026-08-23: iPhone 8..17 Pro Max, Xr/Xs/Xs Max, SE 2020/2022, 16e/17e, Air
  const modelAliases = Array.from(
    new Set([currentSpec.model, currentSpec.model.replace(/\s*\((\d{4})\)$/, ' $1')]),
  );
  const rows: ValuationRow[] = await prisma.tradeInValuation.findMany({
    where: {
      brand: { equals: SHOP_BRAND, mode: 'insensitive' },
      OR: modelAliases.map((m) => ({ model: { equals: m, mode: 'insensitive' as const } })),
      condition: TRADE_IN_GRADE,
      deletedAt: null,
    },
    select: { storage: true, basePrice: true },
  });
  if (rows.length === 0) return null;

  const wantStorage = extractStorageToken(currentModelText ?? '');
  let picked = rows;
  if (wantStorage) {
    const bySize = rows.filter((r) => normalizeStorage(r.storage) === wantStorage);
    if (bySize.length > 0) picked = bySize;
  }
  const prices = picked.map((r) => Number(r.basePrice)).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length === 0) return null;
  // ไม่รู้ความจุ → ใช้ราคาความจุต่ำสุด (ลูกค้าส่วนใหญ่ถือความจุเริ่มต้น) — บอกเลขสูงแล้วผิดหวังหน้าร้าน
  // แย่กว่าบอกเลขต่ำแล้วได้มากกว่า (รีวิว 2026-08-23) · รู้ความจุ → แถวนั้น (picked = แถวเดียว)
  const estimate = wantStorage && picked.length < rows.length ? Math.max(...prices) : Math.min(...prices);
  return { model: currentSpec.model, estimateThb: estimate, note: TRADE_IN_NOTE };
}
