import { THAI_ADDRESS_DATA } from '@/data/thai-address-data';
import { composeAddress, deserializeAddress } from '@/components/ui/AddressForm';

/**
 * ใบปะหน้าพัสดุจากใบขาย (A6 · 2026-10-22) — ส่วน pure: ขนส่ง · แยกจังหวัด/รหัสไปรษณีย์จากที่อยู่บรรทัดเดียวของลูกค้า ·
 * ร่างใบปะหน้าจากใบขาย+ลูกค้า+บริษัท · รูปแบบกระดาษที่จำต่อเครื่อง · CSS ของกระดาษ (100×150 มม. ตาม mockup `Label.dc.html`)
 */

export type CarrierCode = 'FLASH' | 'KERRY' | 'JT_EXPRESS' | 'THAILAND_POST';

/** ลำดับและป้ายตาม mockup · รหัสตาม enum `OnlineShippingMethod` เดิม (ตัด BRANCH_PICKUP) */
export const CARRIERS: { code: CarrierCode; label: string }[] = [
  { code: 'FLASH', label: 'Flash' },
  { code: 'KERRY', label: 'Kerry' },
  { code: 'JT_EXPRESS', label: 'J&T' },
  { code: 'THAILAND_POST', label: 'ไปรษณีย์' },
];

export type ParcelLabelFormat = 'LABEL_100x150' | 'A4';

/** จำรูปแบบกระดาษต่อเครื่อง — เครื่องพิมพ์ต่างกันต่อสาขา/ต่อเครื่อง จึงไม่ใช่การตั้งค่ากลาง */
export const PARCEL_LABEL_FORMAT_KEY = 'parcel-label:format';
const DEFAULT_FORMAT: ParcelLabelFormat = 'A4';

export function readLabelFormat(): ParcelLabelFormat {
  try {
    const raw = window.localStorage.getItem(PARCEL_LABEL_FORMAT_KEY);
    return raw === 'LABEL_100x150' || raw === 'A4' ? raw : DEFAULT_FORMAT;
  } catch {
    return DEFAULT_FORMAT;
  }
}

export function writeLabelFormat(format: ParcelLabelFormat): void {
  try {
    window.localStorage.setItem(PARCEL_LABEL_FORMAT_KEY, format);
  } catch {
    /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว/ถูกปิด) — ไม่ใช่ข้อมูลที่ต้องอยู่ถาวร */
  }
}

const PROVINCES: readonly string[] = Array.from(new Set(THAI_ADDRESS_DATA.map((row) => row[0])));
const BANGKOK = 'กรุงเทพมหานคร';
/** ชื่อย่อที่ลูกค้า/พนักงานพิมพ์บ่อย — เรียงยาว→สั้น ให้จับ "กรุงเทพฯ" ก่อน "กรุงเทพ" */
const PROVINCE_ALIASES: { alias: string; province: string }[] = [
  { alias: 'กรุงเทพมหานคร', province: BANGKOK },
  { alias: 'กรุงเทพฯ', province: BANGKOK },
  { alias: 'กรุงเทพ', province: BANGKOK },
  { alias: 'กทม.', province: BANGKOK },
  { alias: 'กทม', province: BANGKOK },
];
const PROVINCE_PREFIX = /(?:จังหวัด|จ\.)\s*$/;
const POSTAL_CODE = /(?:^|\s)(\d{5})(?!\d)/g;

export interface ParsedThaiAddress {
  /** ที่อยู่ที่ถอดจังหวัดและรหัสไปรษณีย์ออกแล้ว (บ้านเลขที่ หมู่ ซอย ถนน ตำบล อำเภอ) */
  lines: string;
  province: string | null;
  postalCode: string | null;
}

const EMPTY_ADDRESS: ParsedThaiAddress = { lines: '', province: null, postalCode: null };

type ProvinceHit = { index: number; length: number; province: string; prefixStart: number };

/**
 * หาชื่อจังหวัดในข้อความแบบมีขอบคำ — รับเฉพาะที่ (ก) ตัวอักษรก่อนหน้าเป็นต้นข้อความ/ช่องว่าง/`.` และ
 * (ข) มี "จ."/"จังหวัด" นำหน้า หรือเป็นคำท้ายข้อความ (ถัดไปมีแต่ช่องว่าง) — ชื่อจังหวัดที่ซ้อนในชื่อถนน/ตำบล/อำเภอ
 * ("ถ.ตากสิน" · "ต.สระแก้ว อ.เมือง" · "ศรีเชียงใหม่") จึงไม่ถูกเดาเป็นจังหวัด (ผลตรวจทานอิสระ 2026-10-22)
 */
function findProvince(text: string): ProvinceHit | null {
  const candidates = [...PROVINCE_ALIASES, ...PROVINCES.map((p) => ({ alias: p, province: p }))];
  let best: ProvinceHit | null = null;
  for (const { alias, province } of candidates) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(alias, from);
      if (index < 0) break;
      from = index + 1;
      const before = text.slice(0, index);
      const prev = before.slice(-1);
      const boundaryBefore = index === 0 || /\s|\./.test(prev);
      const prefix = PROVINCE_PREFIX.exec(before); // "จังหวัดเชียงใหม่" ติดกันก็นับ — คำนำหน้าคือขอบคำในตัว
      const tailOk = /^\s*$/.test(text.slice(index + alias.length));
      if (!prefix && !(boundaryBefore && tailOk)) continue;
      const hit: ProvinceHit = { index, length: alias.length, province, prefixStart: prefix ? prefix.index : index };
      if (!best || hit.index > best.index || (hit.index === best.index && hit.length > best.length)) best = hit;
    }
  }
  return best;
}

/**
 * ที่อยู่ปัจจุบันของลูกค้าเป็นข้อความบรรทัดเดียว (ข้อมูลเก่า/นำเข้า) — จังหวัด = ชื่อจังหวัดที่ปรากฏ**ท้ายสุด**ตามกติกา `findProvince`
 * รหัสไปรษณีย์ = เลข 5 หลักตัวสุดท้าย · จับไม่ได้ = null และคงข้อความเดิมไว้ให้พนักงานแก้เอง
 */
export function parseThaiAddress(text: string | null | undefined): ParsedThaiAddress {
  let rest = (text ?? '').trim();
  if (!rest) return { ...EMPTY_ADDRESS };

  let postalCode: string | null = null;
  let zipMatch: RegExpExecArray | null = null;
  for (const m of rest.matchAll(POSTAL_CODE)) zipMatch = m;
  if (zipMatch) {
    postalCode = zipMatch[1];
    const start = zipMatch.index + zipMatch[0].indexOf(postalCode);
    rest = `${rest.slice(0, start)} ${rest.slice(start + postalCode.length)}`;
  }

  let province: string | null = null;
  const hit = findProvince(rest);
  if (hit) {
    province = hit.province;
    rest = `${rest.slice(0, hit.prefixStart)} ${rest.slice(hit.index + hit.length)}`;
  }

  return { lines: rest.replace(/\s+/g, ' ').trim(), province, postalCode };
}

/**
 * ที่อยู่ลูกค้าจากฟอร์มเว็บเก็บเป็น JSON (`serializeAddress` ใน AddressForm) — อ่านโครงสร้างตรง ๆ ก่อน;
 * ข้อความบรรทัดเดียว (ข้อมูลเก่า / นำเข้า / บอท) ค่อย `parseThaiAddress`
 */
export function resolveCustomerAddress(text: string | null | undefined): ParsedThaiAddress {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ...EMPTY_ADDRESS };
  if (!trimmed.startsWith('{')) return parseThaiAddress(trimmed);
  const addr = deserializeAddress(trimmed);
  return {
    lines: composeAddress({ ...addr, province: '', postalCode: '' }),
    province: addr.province.trim() || null,
    postalCode: addr.postalCode.trim() || null,
  };
}

export interface ParcelLabelSources {
  sale: {
    id: string;
    saleNumber: string;
    customer: { id: string; name: string; phone: string | null };
    product: { name: string; imeiSerial: string | null; serialNumber: string | null };
    bundleProducts?: { id: string; name: string }[];
  };
  customer: { prefix: string | null; name: string; phone: string | null; addressCurrent: string | null } | null;
  company: { nameTh: string; address: string; phone: string | null } | null;
  /** `window.location.origin` — QR เปิดใบขายในระบบจากกล้องมือถือ */
  origin: string;
}

export interface ParcelLabelDraft {
  saleId: string;
  saleNumber: string;
  recipientName: string;
  phone: string;
  addressLines: string;
  province: string;
  postalCode: string;
  /** null = พิมพ์ช่องว่างทั้ง 4 ให้ติ๊กมือ */
  carrier: CarrierCode | null;
  note: string;
  cod: string;
  item: { title: string; imei: string | null; extras: string[] };
  sender: { name: string; address: string; phone: string };
  qrValue: string;
}

const clean = (value: string | null | undefined): string => (value ?? '').trim();

export function buildParcelLabelDraft({ sale, customer, company, origin }: ParcelLabelSources): ParcelLabelDraft {
  const parsed = resolveCustomerAddress(customer?.addressCurrent);
  const baseName = clean(customer?.name) || clean(sale.customer.name);
  const prefix = clean(customer?.prefix);
  return {
    saleId: sale.id,
    saleNumber: sale.saleNumber,
    recipientName: prefix ? `${prefix} ${baseName}` : baseName,
    phone: clean(customer?.phone) || clean(sale.customer.phone),
    addressLines: parsed.lines,
    province: parsed.province ?? '',
    postalCode: parsed.postalCode ?? '',
    carrier: null,
    note: '',
    cod: 'ไม่มี',
    item: {
      title: clean(sale.product.name),
      imei: clean(sale.product.imeiSerial) || clean(sale.product.serialNumber) || null,
      extras: (sale.bundleProducts ?? []).map((p) => clean(p.name)).filter((name) => name.length > 0),
    },
    sender: {
      name: clean(company?.nameTh) || 'BESTCHOICE',
      address: clean(company?.address),
      phone: clean(company?.phone),
    },
    qrValue: `${origin}/sales?saleId=${encodeURIComponent(sale.id)}`,
  };
}

/**
 * กระดาษ 100×150 มม. ขาวดำ (mockup มาตราส่วน 1 มม. = 6px → หน่วย mm ตรง ๆ) · ตัวอักษรไทย line-height ≥ 1.35 ทุกบรรทัด ·
 * ไม่มี absolute / overflow:hidden ตัดหัวสระ (บทเรียนสติกเกอร์ A5) · ชื่อ/ที่อยู่ยาวขึ้นบรรทัดใหม่ในโซนผู้รับซึ่งยืดได้
 */
const PAPER_STYLES = `
.parcel-label { width: 100mm; height: 150mm; box-sizing: border-box; background: #fff; color: #000;
  display: flex; flex-direction: column; font-family: 'IBM Plex Sans Thai', 'Noto Sans Thai Looped', system-ui, sans-serif;
  line-height: 1.35; overflow-wrap: anywhere; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.parcel-label .pl-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.parcel-label .pl-k { font-size: 1.9mm; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.parcel-label .pl-head { background: #000; color: #fff; padding: 2mm 3mm; display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
.parcel-label .pl-brand { font-size: 4mm; font-weight: 800; letter-spacing: -.01em; }
.parcel-label .pl-head-right { text-align: right; line-height: 1.3; }
.parcel-label .pl-head-right .pl-k { opacity: .85; }
.parcel-label .pl-sale-no { font-size: 3mm; font-weight: 700; }
.parcel-label .pl-zone { padding: 2mm 3mm; border-bottom: .5mm solid #000; }
.parcel-label .pl-carriers { display: flex; align-items: center; gap: 2.5mm; flex-wrap: wrap; }
.parcel-label .pl-carrier { display: inline-flex; align-items: center; gap: 1.2mm; font-size: 2.5mm; font-weight: 700; white-space: nowrap; }
.parcel-label .pl-cb { width: 3.6mm; height: 3.6mm; border: .5mm solid #000; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.parcel-label .pl-cb.on { background: #000; }
.parcel-label .pl-cb.on::after { content: ''; width: .9mm; height: 1.8mm; border: solid #fff; border-width: 0 .5mm .5mm 0; transform: translateY(-.2mm) rotate(45deg); }
.parcel-label .pl-date { margin-left: auto; font-size: 2mm; }
.parcel-label .pl-recipient { flex: 1; display: flex; flex-direction: column; gap: .8mm; min-height: 0; }
.parcel-label .pl-name { font-size: 5.6mm; font-weight: 800; line-height: 1.35; margin-top: .5mm; }
.parcel-label .pl-phone { font-size: 4.3mm; font-weight: 700; letter-spacing: .02em; }
.parcel-label .pl-address { font-size: 3.4mm; line-height: 1.4; margin-top: .8mm; white-space: pre-line; }
.parcel-label .pl-province-row { display: flex; align-items: baseline; gap: 2.3mm; margin-top: .4mm; flex-wrap: wrap; }
.parcel-label .pl-province { font-size: 4mm; font-weight: 800; }
.parcel-label .pl-zip { font-size: 5mm; font-weight: 700; letter-spacing: .08em; }
.parcel-label .pl-note { margin-top: auto; font-size: 2.2mm; border-top: .25mm dashed #000; padding-top: 1.3mm; }
.parcel-label .pl-items { display: flex; gap: 2.5mm; align-items: stretch; }
.parcel-label .pl-items-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .6mm; }
.parcel-label .pl-item-title { font-size: 2.7mm; font-weight: 700; margin-top: .5mm; }
.parcel-label .pl-item-imei { font-size: 2.2mm; }
.parcel-label .pl-item-extras { font-size: 2.3mm; }
.parcel-label .pl-cod { margin-top: auto; display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; border-top: .25mm solid #000; padding-top: 1.3mm; }
.parcel-label .pl-cod-value { font-size: 3.4mm; font-weight: 800; }
.parcel-label .pl-qr { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .6mm; flex-shrink: 0; }
.parcel-label .pl-qr svg { width: 22mm; height: 22mm; }
.parcel-label .pl-qr-no { font-size: 2mm; font-weight: 700; }
.parcel-label .pl-sender { padding: 1.6mm 3mm 2mm; display: flex; justify-content: space-between; align-items: flex-end; gap: 2mm; font-size: 2mm; line-height: 1.4; }
.parcel-label .pl-sender-name { font-weight: 700; margin-top: .3mm; }
.parcel-label .pl-sender-hint { text-align: right; white-space: nowrap; }
`;

/**
 * CSS ของกระดาษ + @page ตามรูปแบบ — A4 = ฉลากขนาดจริงพร้อมเส้นประให้ตัด
 * ตอนพิมพ์ต้องหลบ chrome ของ MainLayout (`.wrapper` มี padding-left ตามเมนู 264/70px ซึ่ง index.css ไม่รีเซ็ตในโหมดพิมพ์):
 * ซ่อนทุกอย่างด้วย visibility แล้ววาง `.parcel-print` ที่มุมซ้ายบนของกระดาษ — แบบเดียวกับหน้าสติกเกอร์ (`StickerCard` `.print-stickers`)
 * ไม่งั้นฉลาก 100×150 เริ่มที่ 74 มม. จากขอบซ้ายและถูกตัดไป 3/4 (ผลตรวจทานอิสระ 2026-10-22)
 */
export function labelStyles(format: ParcelLabelFormat): string {
  const page =
    format === 'LABEL_100x150'
      ? `@page { size: 100mm 150mm; margin: 0; }
  .parcel-print .parcel-label { outline: none; }`
      : `@page { size: A4; margin: 12mm; }
  .parcel-print .parcel-label { outline: .25mm dashed #000; outline-offset: 1mm; }`;
  return `${PAPER_STYLES}
@media print {
  ${page}
  html, body { margin: 0; padding: 0; background: #fff; }
  body * { visibility: hidden !important; }
  .parcel-print, .parcel-print * { visibility: visible !important; }
  .parcel-print { position: absolute; top: 0; left: 0; width: 100mm; margin: 0; padding: 0; border: 0; display: block !important; overflow: visible !important; }
  .parcel-print > .print\\:hidden { display: none !important; }
  .parcel-print > :not(.print\\:hidden) { display: block !important; overflow: visible !important; }
  .parcel-print .parcel-label { page-break-inside: avoid; break-inside: avoid; box-shadow: none; margin: 0; }
}`;
}
