import type { DefaultInstallment } from '@installment/shared';
import { formatBaht } from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import { getPositiveDisplayPrices, type ProductPriceRow } from '@/utils/getDisplayPrices';

/** ข้อมูลเครื่องจาก GET /sticker-templates/products/data (อ่านจากตัวเครื่อง ไม่ใช่ตารางราคากลาง) */
export interface StickerProductData {
  productId: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  status: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  hasBox: boolean | null;
  /** YYYY-MM-DD เฉพาะประกันศูนย์ที่ยังไม่หมด */
  warrantyExpireDate: string | null;
  imei: string | null;
  stockInDate: string | null;
  cashPrice: string | null;
  installmentPrice: string | null;
  prices: ProductPriceRow[];
}

/** เรทที่ 1 = ผ่อนกับร้าน (BESTCHOICE) · เรทที่ 2 = ไฟแนนซ์ภายนอก — คำนวณด้วยสูตรเดียวกับหน้าสินค้า */
export interface StickerQuotes {
  rate1: DefaultInstallment | null;
  rate2: DefaultInstallment | null;
}

export interface StickerRateView {
  no: 1 | 2;
  down: string;
  monthly: string;
  months: number;
}

/** สิ่งที่พิมพ์ลงดวง 50×30 มม. — pure data, ไม่มี DOM */
export interface StickerView {
  productId: string;
  /** รุ่นอย่างเดียว ไม่มียี่ห้อ (คำตัดสินเจ้าของ) · อุปกรณ์ที่ไม่มีรุ่นใช้ชื่อสินค้า */
  model: string;
  spec: string | null;
  /** "ประกันศูนย์ DD/MM/YY" เมื่อยังไม่หมดประกัน */
  warrantyLabel: string | null;
  /** เฉพาะมือสอง — ชิป %แบต + มีกล่อง/ไม่มีกล่อง (null ในช่อง = ไม่ระบุ ไม่มีชิปนั้น) */
  used: { battery: number | null; box: boolean | null } | null;
  cash: string;
  rates: StickerRateView[];
  imei: string | null;
}

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** 'YYYY-MM-DD' → 'DD/MM/YY' (ปี ค.ศ. 2 หลัก — ปี 4 หลักทำให้บรรทัดสเปกถูกตัดเมื่อชื่อสียาว) */
export function formatWarrantyShort(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1].slice(2)}`;
}

function rateView(no: 1 | 2, rate: DefaultInstallment | null): StickerRateView | null {
  if (
    !rate ||
    !Number.isFinite(rate.months) ||
    !Number.isFinite(rate.downAmount) ||
    !Number.isFinite(rate.monthlyPayment)
  ) {
    return null;
  }
  return {
    no,
    down: formatBaht(rate.downAmount),
    monthly: formatBaht(rate.monthlyPayment),
    months: rate.months,
  };
}

/**
 * แปลงข้อมูลเครื่อง + ค่างวดเป็นสิ่งที่พิมพ์ · คืน null เมื่อเครื่องยังไม่มีราคาเงินสด
 * (ระบบไม่พิมพ์ดวง ฿0 หรือดวงว่างอีกต่อไป — หน้าพิมพ์เตือนและข้ามเครื่องนั้น)
 */
export function buildStickerView(product: StickerProductData, quotes: StickerQuotes): StickerView | null {
  const { cash } = getPositiveDisplayPrices(product);
  if (cash == null) return null;

  const warrantyShort = product.warrantyExpireDate ? formatWarrantyShort(product.warrantyExpireDate) : null;
  const battery = product.batteryHealth;
  const used =
    product.category === 'PHONE_USED'
      ? {
          battery: battery != null && Number.isFinite(battery) && battery >= 0 && battery <= 100 ? battery : null,
          box: product.hasBox ?? null,
        }
      : null;

  return {
    productId: product.productId,
    model: nonEmpty(product.model) ?? nonEmpty(product.name) ?? '-',
    spec: [nonEmpty(product.color), nonEmpty(product.storage)].filter((p): p is string => p !== null).join(' · ') || null,
    warrantyLabel: warrantyShort ? `ประกันศูนย์ ${warrantyShort}` : null,
    used,
    cash: formatBaht(cash),
    rates: [rateView(1, quotes.rate1), rateView(2, quotes.rate2)].filter((r): r is StickerRateView => r !== null),
    imei: nonEmpty(product.imei),
  };
}
