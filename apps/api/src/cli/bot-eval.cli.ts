/**
 * bot-eval — ชุดเทสบทสนทนาจำลองของบอทขาย (regression harness)
 *
 * รันบทสนทนาสคริปต์กับ "prompt จริง + โมเดลจริง" แต่ tool เป็น fixture คงที่
 * แล้วตรวจกฎอัตโนมัติ (ค้นก่อนลิสต์รุ่น / ปุ่มกด / ห้ามราคาเต็มนำ / เลขต้องมาจาก fixture /
 * คำต้องห้าม / เรทที่ 1-2 / ลำดับการขาย) — ใช้กันของที่แก้แล้วเด้งกลับ ก่อน apply prompt ใหม่
 *
 * ใช้:
 *   ANTHROPIC_API_KEY=... DATABASE_URL=... npm --prefix apps/api run bot:eval
 *     (อ่าน persona จริงจาก DB — ต้องมี cloud-sql-proxy ถ้าชี้ prod)
 *   ANTHROPIC_API_KEY=... EVAL_BASE_FILE=base.txt EVAL_EXTRAS_FILE=extras.txt npm run bot:eval
 *     (ทดสอบ prompt ฉบับร่างก่อน apply — ไม่แตะ DB)
 * ตัวเลือก: EVAL_MODEL (default claude-sonnet-5) · EVAL_EFFORT (default medium)
 *          EVAL_ONLY=S3 (รันเฉพาะ scenario เดียว)
 *          EVAL_NO_STOCK=1 (โหมดไม่มีสต๊อก 2026-09-22 — ตัด search_products/calculate_installment
 *            + ต่อท้าย NO_STOCK_PROMPT เหมือน SalesBotService; รันเฉพาะฉาก noStock เว้นแต่ระบุ EVAL_ONLY)
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { SEARCH_PRODUCTS_TOOL } from '../modules/sales-bot/tools/search-products.tool';
import { CALCULATE_INSTALLMENT_TOOL } from '../modules/sales-bot/tools/calculate-installment.tool';
import { LIST_PROMOTIONS_TOOL } from '../modules/sales-bot/tools/list-promotions.tool';
import { HANDOFF_TO_HUMAN_TOOL } from '../modules/sales-bot/tools/handoff-to-human.tool';
import { CAPTURE_LEAD_TOOL } from '../modules/sales-bot/tools/capture-lead.tool';
import { GET_INSTALLMENT_RATES_TOOL } from '../modules/sales-bot/tools/get-installment-rates.tool';
import { SEARCH_KNOWLEDGE_BASE_TOOL } from '../modules/sales-bot/tools/search-knowledge-base.tool';
import { RECOMMEND_DEVICES_TOOL } from '../modules/sales-bot/tools/recommend-devices.tool';
import { COMPARE_DEVICES_TOOL } from '../modules/sales-bot/tools/compare-devices.tool';
import { SEND_RATE_CARD_TOOL } from '../modules/sales-bot/tools/send-rate-card.tool';
import { NOTIFY_STAFF_TOOL } from '../modules/sales-bot/tools/notify-staff.tool';
import { NO_STOCK_PROMPT } from '../modules/sales-bot/bot-runtime-config.service';
import {
  shopClockLine,
  NO_STOCK_TOOL_RESULT,
  SIDE_EFFECT_TOOL_NAMES,
  isCleanSideEffectResult,
} from '../modules/sales-bot/sales-bot.service';
import { stripStrayForeignScript } from '../utils/bot-reply-sanitize.util';

const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-5';
const EFFORT = (process.env.EVAL_EFFORT ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_HOPS = 6; // = MAX_TOOL_HOPS ของ SalesBotService (รอบสุดท้ายบังคับ tool_choice none)
const NO_STOCK = process.env.EVAL_NO_STOCK === '1';

// ───────────────────────── fixtures ─────────────────────────
// สต๊อกจำลอง: 15 128GB มือสอง 2 สภาพ + 14 128GB + (15 Plus ไม่มีของ — เทสโหมดรับออเดอร์)
const UNITS = {
  p15b: { id: 'p15b', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'B', color: 'ชมพู', batteryPct: 87, priceThb: 17500 },
  p15a: { id: 'p15a', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 92, priceThb: 19900 },
  p14: { id: 'p14', model: 'iPhone 14', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 90, priceThb: 13900 },
  // S21: สต๊อกมีเครื่องนอกปนอยู่ — หน้าร้านจดช่องตำหนิขึ้นต้น "เครื่องนอก" + ประกันร้าน 30 วัน (tool จริงคืน cosmeticNotes/shopWarrantyDays)
  p16th: { id: 'p16th', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'A', color: 'ดำ', batteryPct: 95, priceThb: 24900, cosmeticNotes: null, shopWarrantyDays: 60 },
  // เครื่องไทย 2 ตัว (เหมือนโครง S4) — fixture calculate_installment คืนเลขคงที่ไม่ขึ้นกับ downPct/งวด: ถ้ามีเครื่องไทยตัวเดียว
  // บอทจะลองคิดหลายแพ็กเกจแล้วได้เลขเดิมซ้ำ ๆ จนชนเพดาน hop (artifact ของ fixture ไม่ใช่พฤติกรรมจริง)
  p16th2: { id: 'p16th2', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'B', color: 'ชมพู', batteryPct: 91, priceThb: 23900, cosmeticNotes: null, shopWarrantyDays: 60 },
  p16imp: { id: 'p16imp', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'A', color: 'ขาว', batteryPct: 97, priceThb: 22900, cosmeticNotes: 'เครื่องนอก LL/A', shopWarrantyDays: 30 },
};
const CALC: Record<string, { downAmountThb: number; monthlyThb: number; termMonths: number }> = {
  p15b: { downAmountThb: 1750, monthlyThb: 1578, termMonths: 12 },
  p15a: { downAmountThb: 1990, monthlyThb: 1790, termMonths: 12 },
  p14: { downAmountThb: 1390, monthlyThb: 1245, termMonths: 12 },
  p16th: { downAmountThb: 2490, monthlyThb: 2245, termMonths: 12 },
  p16th2: { downAmountThb: 2390, monthlyThb: 2155, termMonths: 12 },
  // เลขของเครื่องนอกจงใจ "ไม่อยู่ใน GROUNDED" — บอทเอาไปเสนอเป็นเครื่องไทยเมื่อไร = ตกทั้ง notContains และเลขไม่มีที่มา
  p16imp: { downAmountThb: 2290, monthlyThb: 2065, termMonths: 12 },
};
const RATES_15PLUS = {
  templates: [
    {
      brand: 'Apple', model: 'iPhone 15 Plus', storage: '128GB', hasWarranty: false, condition: 'มือสอง',
      rate1: { downPayment: 1900, monthlyPrice: 2566, termMonths: 12 },
      rate2: { downPayment: 3400, monthlyPrice: 2905, termMonths: 12 },
    },
    {
      brand: 'Apple', model: 'iPhone 15 Plus', storage: '256GB', hasWarranty: false, condition: 'มือสอง',
      rate1: { downPayment: 1900, monthlyPrice: 2766, termMonths: 12 },
      rate2: { downPayment: 3600, monthlyPrice: 3105, termMonths: 12 },
    },
  ],
};

// โหมดไม่มีสต๊อก: เรทมือ 2 ตามตารางของร้าน (ตัวเลขเดียวกับ pricing_templates บน prod)
const RATES_15 = {
  templates: [
    {
      brand: 'Apple', model: 'iPhone 15', storage: '128GB', hasWarranty: false, deviceOrigin: 'UNSPECIFIED', condition: 'มือสอง',
      rate1: { downPayment: 900, monthlyPrice: 2424, termMonths: 12 },
      rate2: { downPayment: 3700, monthlyPrice: 2523, termMonths: 12 },
    },
  ],
};
const RATES_16 = {
  templates: [
    {
      brand: 'Apple', model: 'iPhone 16', storage: '128GB', hasWarranty: false, deviceOrigin: 'UNSPECIFIED', condition: 'มือสอง',
      rate1: { downPayment: 3300, monthlyPrice: 2652, termMonths: 12 },
      rate2: { downPayment: 3900, monthlyPrice: 2741, termMonths: 15 },
    },
  ],
};

// recommend_devices / compare_devices จำลอง: ลูกค้าใช้ iPhone 12 → แนะนำ 13/14 128GB มือสอง (นโยบายเทิร์น ≥12)
// (ตัวเลขดาวน์/ผ่อนต้องอยู่ใน GROUNDED ด้านล่าง; สเปคประโยคเลียน compareDevices ของจริง)
const TRADE_IN_11 = { model: 'iPhone 12', estimateThb: 3500, note: 'ราคาประมาณ ประเมินจริงหน้าร้าน สภาพมีผลต่อราคา' };
const BETTER_11_TO_13 = ['ชิป A14 → A15 เร็วขึ้นอีกนิด', 'แบตนานขึ้น ~2 ชม.', 'อัปเดต iOS ได้อีกหลายปี'];
const BETTER_11_TO_14 = ['ชิป A14 → A15 เร็วขึ้นอีกนิด', 'แบตนานขึ้น ~3 ชม.', 'อัปเดต iOS ได้อีกหลายปี'];
const RECOMMEND_FROM_11 = {
  current: { model: 'iPhone 12', recognized: true },
  budget: { down: 3000, monthly: 2000 },
  recommended: [
    {
      brand: 'Apple', model: 'iPhone 13', storage: '128GB', hasWarranty: false, condition: 'มือสอง',
      rateLabel: 'เรทที่ 2', downPayment: 2500, monthlyPrice: 1758, termMonths: 12,
      inStock: true, unitCount: 1,
      sampleUnit: { productId: 'p13', batteryHealth: 89, color: 'ดำ', photoUrl: null },
      betterThanCurrent: BETTER_11_TO_13, worseThanCurrent: [], generationGap: 1,
    },
    {
      brand: 'Apple', model: 'iPhone 14', storage: '128GB', hasWarranty: false, condition: 'มือสอง',
      rateLabel: 'เรทที่ 2', downPayment: 3000, monthlyPrice: 1980, termMonths: 12,
      inStock: true, unitCount: 1,
      sampleUnit: { productId: 'p14', batteryHealth: 90, color: 'ฟ้า', photoUrl: null },
      betterThanCurrent: BETTER_11_TO_14, worseThanCurrent: [], generationGap: 2,
    },
  ],
  nearMiss: [],
  tradeIn: TRADE_IN_11,
};
const COMPARE_11_TO_15 = {
  current: { model: 'iPhone 12', recognized: true },
  candidate: { model: 'iPhone 15', recognized: true },
  better: ['กล้องหลัก 12MP → 48MP คมชัดขึ้นมาก', 'ชิป A14 → A16 เร็วขึ้นชัดเจน', 'แบตนานขึ้น ~3 ชม.', 'อัปเดต iOS ได้ยาว ๆ อีกหลายปี'],
  same: ['กล้องหลัง 2 ตัวเท่าเดิม', 'จอขนาด 6.1" เท่าเดิม'],
  worse: [],
  generationGap: 3,
  tradeIn: TRADE_IN_11,
};

function group(units: (typeof UNITS)[keyof typeof UNITS][]) {
  const u = units[0];
  return {
    brand: 'Apple', model: u.model, storage: u.storage, condition: u.condition,
    reservedCount: 0, priceMissingCount: 0,
    units: units.map((x) => ({ ...x, reserved: false, photoAvailable: true })),
  };
}

function runFixtureTool(name: string, input: Record<string, unknown>): unknown {
  // เหมือน SalesBotService.runTool: โหมดไม่มีสต๊อก เครื่องมือสต๊อกคืนข้อความบอกโหมด
  if (NO_STOCK && (name === 'search_products' || name === 'calculate_installment')) return NO_STOCK_TOOL_RESULT;
  const q = String(input.query ?? '').toLowerCase();
  switch (name) {
    case 'search_products': {
      if (q.includes('plus') || q.includes('pro')) {
        return { query: { brand: 'Apple', model: input.query, storage: null, color: null }, totalMatches: 0, priceMissingCount: 0, groups: [] };
      }
      if (q.includes('14')) {
        return { query: { brand: 'Apple', model: 'iPhone 14', storage: null, color: null }, totalMatches: 1, priceMissingCount: 0, groups: [group([UNITS.p14])] };
      }
      if (q.includes('16')) {
        return { query: { brand: 'Apple', model: 'iPhone 16', storage: null, color: null }, totalMatches: 3, priceMissingCount: 0, groups: [group([UNITS.p16th, UNITS.p16th2, UNITS.p16imp])] };
      }
      if (q.includes('15')) {
        return { query: { brand: 'Apple', model: 'iPhone 15', storage: null, color: null }, totalMatches: 2, priceMissingCount: 0, groups: [group([UNITS.p15b, UNITS.p15a])] };
      }
      // ค้นกว้าง: คืนแคตตาล็อกย่อ
      return { query: { brand: null, model: input.query, storage: null, color: null }, totalMatches: 3, priceMissingCount: 0, groups: [group([UNITS.p15b, UNITS.p15a]), group([UNITS.p14])] };
    }
    case 'get_installment_rates':
      if (q.includes('plus')) return RATES_15PLUS;
      if (q.includes('16')) return RATES_16;
      if (q.includes('15')) return RATES_15;
      return { templates: [] };
    case 'calculate_installment': {
      const pid = String(input.productId ?? '');
      const c = CALC[pid];
      if (!c) return { error: 'product_not_found' };
      const u = UNITS[pid as keyof typeof UNITS];
      return { productId: pid, productName: `${u.model} ${u.storage} มือสอง เกรด ${u.grade}`, ...c, totalPaidThb: c.downAmountThb + c.monthlyThb * c.termMonths, photoUrl: null, webUrl: null };
    }
    case 'list_promotions':
      return { promotions: [] };
    case 'search_knowledge_base': {
      // KB นโยบาย (v5.4 — ข้อความเดียวกับแถว faq:* บน prod) จับด้วย keyword แบบ kb-match
      const FAQ: Array<{ id: string; kw: string[]; t: string }> = [
        // โปรฟรีดาวน์เครื่องนอก (เจ้าของสั่ง 2026-09-20) — ข้อความเดียวกับแถว KB บน prod (apply-imported-free-down.sql)
        { id: 'faq:promo-imported-free-down', kw: ['เครื่องนอก', 'ฟรีดาวน์'], t: 'โปรฟรีดาวน์ iPhone มือสอง เครื่องนอก (ของแท้ Apple โมเดลต่างประเทศ ประกันร้าน 30 วัน)\niPhone 13 128GB ผ่อนเดือนละ 1,758 บาท 12 งวด\niPhone 14 128GB ผ่อนเดือนละ 1,885 บาท 12 งวด\niPhone 15 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด\niPhone 16 128GB ผ่อนเดือนละ 2,631 บาท 12 งวด\niPhone 13 Pro 128GB ผ่อนเดือนละ 2,140 บาท 12 งวด\niPhone 14 Pro 128GB ผ่อนเดือนละ 2,650 บาท 12 งวด\niPhone 15 Pro 128GB ผ่อนเดือนละ 3,288 บาท 12 งวด\niPhone 16 Pro 128GB ผ่อนเดือนละ 3,291 บาท 12 งวด\niPhone 13 Pro Max 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด\niPhone 14 Pro Max 128GB ผ่อนเดือนละ 3,033 บาท 12 งวด\niPhone 15 Pro Max 256GB ผ่อนเดือนละ 3,401 บาท 15 งวด\niPhone 16 Pro Max 256GB ผ่อนเดือนละ 4,061 บาท 15 งวด\nทุกรุ่นฟรีดาวน์ ใช้บัตรประชาชนใบเดียว · แถมเคสกับฟิล์มทุกเครื่องในโปร · รุ่น/ความจุนอกรายการนี้ไม่มีในโปร\nผู้สมัครอายุ 18-59 ปี ไม่เช็คบูโร · อยู่ต่างจังหวัดทำสัญญาออนไลน์ได้ (เฉพาะโปรนี้)\nขอคืนได้ก่อนชำระงวดแรก แต่ต้องจ่ายงวดแรก 1 งวด เครื่องต้องสภาพเดิม ครบกล่องอุปกรณ์ ออก iCloud แล้ว' },
        { id: 'faq:imported-device', kw: ['esim', 'อีซิม', 'ชัตเตอร์', 'โมเดลต่างประเทศ', 'ของแท้', 'ของปลอม'], t: 'เครื่องนอกคือ iPhone แท้ของ Apple ที่ผลิตขายในต่างประเทศค่ะ ไม่ติด iCloud\nเช็ครหัสรุ่นในเครื่องได้ที่ ตั้งค่า > ทั่วไป > เกี่ยวกับ\nบางโมเดลมีข้อจำกัด: โมเดลอเมริการุ่น 14 ขึ้นไปใช้ eSIM อย่างเดียว · โมเดลญี่ปุ่น/เกาหลีปิดเสียงชัตเตอร์ไม่ได้ · โมเดลฮ่องกงใส่ 2 ซิมแต่ไม่มี eSIM\nทีมงานเปิดเครื่องจริงให้เช็คและลองซิมที่ร้านก่อนตัดสินใจค่ะ' },
        { id: 'extracted:store_location_hours', kw: ['ที่ไหน', 'ร้านอยู่', 'เปิด', 'กี่โมง', 'แผนที่', 'บขส', 'พิกัด', 'ทางไป'], t: 'ร้านอยู่เส้นหลัง บขส สระแก้วลพบุรีค่ะ\nที่เดียวกับร้านประกัน ตรงข้ามชาบูแม็คซิโกเลยค่า\n\nแผนที่ 🗺️ https://maps.app.goo.gl/bqGcmr5FupWLw1378\nเปิดทุกวัน 10 โมงเช้าถึง 1 ทุ่มค่ะ' },
        { id: 'faq:no-payslip-freelance', kw: ['สลิป', 'ฟรีแลนซ์', 'แม่ค้า', 'ขายของ', 'รับจ้าง', 'อิสระ'], t: 'ไม่ต้องมีสลิป ไม่ต้องมีบัตรเครดิตค่ะ 😊\nฟรีแลนซ์ แม่ค้าออนไลน์ รับจ้าง ผ่อนได้หมด\nมีเงินเข้าบัญชี → สเตทเม้นท์ 3 เดือน (เรทที่ 1)\nไม่มี → รูปตอนทำงาน (เรทที่ 2)' },
        { id: 'faq:age-requirement', kw: ['อายุ', 'กี่ปี', '18', '19', 'ผู้ปกครอง', 'นักเรียน'], t: 'อายุ 18 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ\nต่ำกว่า 18 ยังทำสัญญาไม่ได้นะคะ\nนักศึกษา มีผู้ปกครองค้ำให้ค่า' },
        { id: 'faq:device-lock', kw: ['ล็อก', 'ล็อค', 'MDM'], t: 'ระหว่างผ่อนเครื่องมีระบบดูแลของร้านค่ะ บอกตรง ๆ นะคะ\nจ่ายตรงตามนัด → ใช้งานปกติทุกอย่าง\nล็อกเฉพาะค้างชำระแล้วติดต่อไม่ได้ จ่ายครบปลดให้ทันที\nผ่อนครบ เครื่องเป็นของพี่เต็มตัวค่ะ 😊' },
        { id: 'faq:late-fee', kw: ['จ่ายช้า', 'ผิดนัด', 'ค้าง', 'ค่าปรับ', 'ลืมจ่าย', 'เลยกำหนด', 'ไม่ทัน'], t: 'เลยกำหนดมีค่าปรับต่องวดแบบเหมาค่ะ\nเลย 1-2 วัน 50 บาท · วันที่ 3 ขึ้นไป 100 บาท (ไม่คิดรายวัน)\nค้างนานแล้วติดต่อไม่ได้ เครื่องอาจถูกล็อกจนกว่าจะชำระ\n---\nจ่ายไม่ทันจริง ๆ ทักมาเลื่อนนัดก่อนถึงวันได้เลย ทีมช่วยดูให้ค่ะ\nค่างวดไม่เกิน 1 ใน 3 ของรายได้ต่อเดือนจะผ่อนสบายสุดนะคะ 😊' },
        { id: 'faq:early-payoff', kw: ['ปิดยอด', 'ปิดก่อน', 'โปะ', 'ปิดสัญญา'], t: 'ปิดยอดก่อนกำหนดได้ทุกเมื่อค่ะ ไม่มีค่าปรับ 😊\nแถมมีส่วนลดให้สำหรับงวดที่ยังไม่ถึงกำหนดด้วยค่ะ\n\nยอดปิดจริงทีมการเงินคำนวณแจ้งให้ตอนขอปิดนะคะ' },
        { id: 'faq:payment-channel-reminder', kw: ['จ่ายค่างวด', 'จ่ายยังไง', 'ชำระยังไง', 'ช่องทาง', 'แจ้งเตือน', 'ตัดบัตร', 'อัตโนมัติ'], t: 'ค่างวดจ่ายได้ 3 ทางค่ะ\nไลน์การเงินของร้าน (พิมพ์ "ชำระ" รับ QR) · โอนเข้าบัญชีร้าน · จ่ายที่ร้าน\nมีแจ้งเตือนทางไลน์ก่อนถึงวันจ่าย 3 วัน และ 1 วัน กันลืมค่ะ 🔔\n---\nไม่มีระบบตัดบัตรอัตโนมัตินะคะ กดจ่ายเองทุกงวด\nช่องทางทั้งหมดทีมแนะนำให้วันรับเครื่องค่ะ' },
      ];
      const faqHits = FAQ.filter((f) => f.kw.some((k) => q.includes(k))).slice(0, 3);
      if (faqHits.length > 0) {
        return { matches: faqHits.map((f) => ({ intent: f.id.replace('faq:', ''), category: 'POLICY', responseTemplate: f.t, responseType: 'info', score: 5 })) };
      }
      // คลังสเปคจำลอง — ให้เทิร์นเทียบรุ่นมีสเปคอ้างอิงเหมือน prod (id ขึ้นต้น spec:)
      if (q.includes('สเปค') || q.includes('15') || q.includes('16')) {
        return { matches: [
          { id: 'spec:iphone-15', responseTemplate: 'iPhone 15 — กล้องหลัก 48MP คมขึ้นชัดเจน · สาย USB-C · Dynamic Island' },
          { id: 'spec:iphone-16', responseTemplate: 'iPhone 16 — ชิปรุ่นใหม่รองรับ AI ยาว ๆ · ปุ่มชัตเตอร์กล้อง · แบตอึดขึ้นจาก 15' },
        ] };
      }
      return { matches: [] };
    }
    case 'recommend_devices': {
      const cur = String(input.currentModel ?? '');
      const current = cur ? { model: 'iPhone 12', recognized: /12/.test(cur) } : null;
      const recognized = current?.recognized ?? false;
      const HL: Record<string, string[]> = { 'iPhone 13': ['ชิป A15 แรงเกินพอ', 'แบตอึดกว่า 12 ชัดเจน', 'กล้องคู่มีโหมดภาพยนตร์'], 'iPhone 14': ['กล้องหน้าโฟกัสอัตโนมัติ', 'ระบบตรวจจับอุบัติเหตุ', 'ชิป A15 ลื่นทุกแอป'] };
      const recommended = RECOMMEND_FROM_11.recommended.map((d) => ({ ...d, betterThanCurrent: recognized ? d.betterThanCurrent : [], worseThanCurrent: recognized ? d.worseThanCurrent : [], generationGap: recognized ? d.generationGap : null, highlights: HL[d.model] ?? [] }));
      return { ...RECOMMEND_FROM_11, recommended, current, budget: { down: Number(input.downBudget ?? 0) || null, monthly: Number(input.monthlyBudget ?? 0) || null }, tradeIn: recognized ? TRADE_IN_11 : null };
    }
    case 'compare_devices': {
      const cur = String(input.currentModel ?? '');
      const known = /12/.test(cur);
      return known
        ? { ...COMPARE_11_TO_15, candidateHighlights: ['กล้องหลัก 48MP', 'Dynamic Island', 'USB-C'] }
        : { ...COMPARE_11_TO_15, current: { model: cur, recognized: false }, candidateHighlights: ['กล้องหลัก 48MP', 'Dynamic Island', 'USB-C'], better: [], same: [], worse: [], generationGap: null, tradeIn: null };
    }
    case 'capture_lead':
      return { customerId: 'eval-c1', promptPayQr: null, downAmount: Number(input.downAmount ?? 0), handoffMessage: 'ทีมงานจะเช็คเอกสารแล้วติดต่อกลับไปนะคะ ยังไม่ต้องโอนอะไรทั้งนั้นค่ะ' };
    case 'handoff_to_human':
      return { ok: true };
    case 'send_rate_card': {
      // รูปที่ตั้งไว้บน prod ตอนนี้: เครื่องนอก + แผนที่ (ตารางเครื่องไทย/มือ 1 รอรูปฉบับล่าสุดจากเจ้าของ)
      const LABELS: Record<string, string> = { imported_free_down: 'ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2 (เครื่องนอก)', shop_map: 'วิธีเดินทางมาร้าน', used_rate1: 'ตารางผ่อนไอโฟนมือ 2 เรทที่ 1', used_rate2: 'ตารางผ่อนไอโฟนมือ 2 เรทที่ 2' };
      const cards = (Array.isArray(input.cards) ? input.cards : [input.cards]).map(String);
      return { sent: cards.filter((c) => LABELS[c]).map((c) => ({ card: c, label: LABELS[c] })), missing: cards.filter((c) => !LABELS[c]) };
    }
    case 'notify_staff':
      return { staffNotified: true };
    default:
      return { error: 'unknown_tool' };
  }
}

// เลขที่ "มีที่มา" — เลียนแบบ GroundingGuard: เลข >=500 ในคำตอบต้องอยู่ในชุดนี้ (±5%)
const GROUNDED = [17500, 19900, 13900, 1750, 1578, 1990, 1790, 1390, 1245, 1900, 2566, 3400, 2905, 2766, 3600, 3105, 20686, 23470, 16330, 3000, 2000,
  // recommend_devices / compare_devices fixtures (ดาวน์ 2,500 ผ่อน 1,758 / ดาวน์ 3,000 ผ่อน 1,980 / เทิร์น 4,000)
  2500, 1758, 1980, 3500,
  // โปรฟรีดาวน์เครื่องนอก (KB faq:promo-imported-free-down)
  1885, 2395, 2631, 2140, 2650, 3288, 3291, 3033, 3401, 4061,
  // S21: เครื่องไทย p16th / p16th2 เท่านั้น (เลขของ p16imp จงใจไม่ใส่)
  24900, 2490, 2245, 29430, 23900, 2390, 2155, 28250,
  // โหมดไม่มีสต๊อก: RATES_15 / RATES_16
  900, 2424, 3700, 2523, 3300, 2652, 3900, 2741];

// ───────────────────────── checks ─────────────────────────
// skipGlobal: เทิร์นปูทางที่รูปแบบข้อความถูกตรวจในฉากอื่นอยู่แล้ว (เช่น การ์ดแนะนำรุ่น = S3/S9) — ไม่นับด่านความยาว/คำต้องห้ามซ้ำ
type Turn = { user: string; expectTools?: string[]; forbidTools?: string[]; contains?: string[]; notContains?: string[]; wantButtons?: boolean; noBigNumbers?: boolean; skipGlobal?: boolean };
// promoSilent: ฉากที่ไม่เกี่ยวกับโปรเครื่องนอก (รุ่นนอกโปร / ซื้อสด / ยังไม่เลือกรุ่น) — บอทเอ่ย "เครื่องนอก/ฟรีดาวน์" เอง = ตก
// noStock: ฉากของโหมดไม่มีสต๊อก — รันเมื่อ EVAL_NO_STOCK=1 เท่านั้น (ฉากเดิมรันเมื่อไม่ได้ตั้ง)
// history: ข้อความก่อนหน้าในห้อง (เช่นข้อความอัตโนมัติของเพจ) · clockIso: เวลาที่ระบบแนบต้นข้อความ (ค่าเริ่ม = บ่าย 2 เวลาไทย)
type Scenario = {
  id: string; name: string; turns: Turn[]; promoSilent?: boolean; noStock?: boolean;
  history?: { role: 'user' | 'assistant'; content: string }[]; clockIso?: string;
};

// 'เกรด' — คำสั่งเจ้าของ 2026-08-17: tool คืนเกรดมาได้ แต่ห้ามพิมพ์ให้ลูกค้า (บอก % แบตพอ)
const BANNED = ['ดอกเบี้ย', '%', 'GFIN', 'ผ่อนกับร้าน', 'เรทร้าน', 'สั่งเข้า', 'ครับ', '{customerName}', '{', 'เรียนคุณ', 'เกรด', 'QR', 'โอนมัดจำ', 'โอนดาวน์',
  // Responsible Lending (วิจัย 2026-08-24): ห้ามถ้อยคำกระตุ้นก่อหนี้ + ห้ามอ้างว่าไม่ล็อก/ดาวน์ 0
  'ไม่ต้องคิด', 'อยากได้ต้องได้', 'จองเลย', 'ดาวน์ 0 บาท', 'ไม่มีดอกเบี้ย', 'ดอก 0', 'ไม่ล็อกเครื่อง', 'ไม่มีล็อก',
  // ชื่อขั้นตอน/รายการภายในของ persona ห้ามหลุดถึงลูกค้า (โปรเครื่องนอก 2026-09)
  'ขั้น 3.5', 'รายการเครื่องนอก', 'ไม่อยู่ในรายการ'];

function globalChecks(reply: string): string[] {
  const fails: string[] = [];
  // "แบต 87%" เป็นการใช้ % ที่ถูกกติกา (สเปคแบต) — ตัดออกก่อนเช็คคำต้องห้าม
  // รวมรูปแบบช่วง "แบต 87-92%" ที่บอทใช้ตอนสรุปเครื่องหลายตัวในการ์ดเดียว
  const scrubbed = reply.replace(/แบต(?:เตอรี่)?\s*(?:เหลือ|ยังดี)?\s*\d+(?:\s*[-–]\s*\d+)?\s*%/g, 'แบตSPEC');
  for (const w of BANNED) if (scrubbed.includes(w)) fails.push(`คำต้องห้ามหลุด: "${w}"`);
  if (/^\s*[*#-]\s/m.test(reply.replace(/^---$/gm, ''))) fails.push('ใช้ markdown bullet (*/-/#)');
  if (/\*\*/.test(reply)) fails.push('ใช้ตัวหนา ** (FB แสดงดิบ)');
  // คำถามได้ข้อเดียว และอยู่ก้อนสุดท้าย
  const bubbles = reply.split(/\n---\n/);
  const isQ = (line: string) => /(?:(?<!นะ)คะ|ไหม|มั้ย)\s*$/.test(line.trim()) && !/(ค่ะ|ค่า|นะคะ)\s*$/.test(line.trim());
  let qCount = 0;
  bubbles.forEach((b) => b.split('\n').forEach((l) => { if (l.trim() && isQ(l)) qCount++; }));
  if (qCount > 1) fails.push(`คำถามเกิน 1 ข้อ (${qCount})`);
  // อ่านง่าย (เจ้าของสั่ง 2026-08-17 "กลัวคนอ่านยาก แล้วจะขี้เกียจอ่าน"):
  // กฎใน prompt ตั้ง target ที่ บรรทัด 60 / ก้อน 180 / ทั้งเทิร์น 300 ตัวอักษร
  // ด่านนี้เผื่อ ~25% แล้วจับที่ 75 / 200 / 380 — เกินนี้คือกำแพงตัวหนังสือจริง ๆ
  // (วัดจากของจริงบน prod: เฉลี่ย 87 แต่เทิร์นสำคัญพุ่งถึง 366 ก้อนเดียว)
  bubbles.forEach((b, i) => {
    const len = b.trim().length;
    // ก้อนที่เป็น "การ์ดเทียบ" (มีบรรทัดดาวน์/ผ่อน ตั้งแต่ 2 ใบ) จัดเป็นตารางกวาดตาอยู่แล้ว
    // → เพดานสูงกว่าก้อนร้อยแก้วปกติ (กฎ prompt: 180 ทั่วไป / 240 ก้อนการ์ด)
    const cardLines = (b.match(/ดาวน์[^\n]*ผ่อนเดือนละ/g) ?? []).length;
    const cap = cardLines >= 2 ? 285 : 200; // 285: การ์ด 2 ใบ + 📱 นำหน้า (v4.1)
    if (len > cap) fails.push(`บับเบิล ${i + 1} ยาว ${len} ตัวอักษร (เพดาน ${cap} — ควรแตกด้วย ---)`);
    const textLines = b.split('\n').filter((l) => l.trim());
    const lineCap = cardLines >= 2 ? 7 : 6;
    if (textLines.length > lineCap) fails.push(`บับเบิล ${i + 1} มี ${textLines.length} บรรทัด (เพดาน ${lineCap})`);
    textLines.forEach((l) => {
      const t = l.trim();
      // สคริปต์บังคับของเจ้าของ ("มือ 1 ไม่มีผลิตแล้ว...") ห้ามเรียบเรียงใหม่และยาว ~58
      // ตัวอักษรโดยตัวมันเอง — พอมีชื่อรุ่นนำหน้าก็ชนเพดานปกติ จึงผ่อนเป็น 90 เฉพาะบรรทัดนั้น
      const cap = t.includes('ไม่มีผลิตแล้ว') ? 90 : 75;
      if (t.length > cap && !t.startsWith('[ตัวเลือก:')) {
        fails.push(`บรรทัดยาว ${t.length} ตัวอักษร: "${t.slice(0, 40)}..." (เพดาน ${cap} — ตัดเป็นหลายบรรทัด)`);
      }
    });
  });
  const visible = reply.replace(/\n---\n/g, '').replace(/\[ตัวเลือก:[^\]]*\]/g, '').trim();
  // เทิร์นที่มีการ์ดเทียบ 2 ใบ (+สคริปต์บังคับบางเคส) ยาวกว่าโดยธรรมชาติ แต่ยังกวาดตาได้
  const totalCards = (reply.match(/ดาวน์[^\n]*ผ่อนเดือนละ/g) ?? []).length;
  // v5.2: เทิร์นแนะนำอัปเกรด = 2 การ์ด (4 บรรทัด) + เทิร์น 2 บรรทัด + คำถาม — แยก 3 ก้อนแล้วอ่านง่าย
  // ยอมให้ 470 เฉพาะเมื่อมีบรรทัด "ดีกว่า ...:" (ไม่ใช่ผ่อนคลายเพดานทั่วไป)
  const hasUpgradeLines = /^ดีกว่า .*:/m.test(reply);
  const totalCap = totalCards >= 2 ? (hasUpgradeLines ? 470 : 430) : 380;
  if (visible.length > totalCap) {
    fails.push(`ทั้งเทิร์นยาว ${visible.length} ตัวอักษร (เพดาน ${totalCap})`);
  }
  if (bubbles.length > 3) fails.push(`แตก ${bubbles.length} ก้อน (เพดาน 3)`);

  // ตัวเลขต้องมีที่มา — ตัดความจุ (512GB) และแบต% ออกก่อน ไม่ใช่ราคา
  // (GroundingGuard ตัวจริงบน prod บังคับว่าต้องมีคำว่า "บาท/฿" ต่อท้ายอยู่แล้ว ไม่มีปัญหานี้)
  const priceScrubbed = reply.replace(/\d+\s*(?:GB|TB|gb|tb)/g, 'ความจุSPEC');
  const nums = [...priceScrubbed.matchAll(/\d[\d,]{2,}/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => n >= 500);
  for (const n of nums) {
    if (!GROUNDED.some((g) => Math.abs(n - g) / g <= 0.05)) fails.push(`เลขไม่มีที่มา: ${n}`);
  }
  return fails;
}

const SCENARIOS: Scenario[] = [
  {
    promoSilent: true,
    id: 'S1', name: 'เปิดแชท → ถามรุ่นย่อยเต็มชุด',
    turns: [
      // ไม่บังคับ search ในเทิร์นถามตระกูล — ตราบใดที่ไม่เคลมสถานะของ (ชื่อรุ่นย่อย = ความรู้ทั่วไป)
      { user: 'สนใจ 15', contains: ['ธรรมดา', 'Plus', 'Pro Max', '[ตัวเลือก:'], notContains: ['พร้อมส่ง', 'มีของ'], noBigNumbers: true },
      { user: '15 Plus', contains: ['ไม่มีผลิต', '128GB', '256GB', '[ตัวเลือก:'], notContains: ['พร้อมส่ง'], noBigNumbers: true },
      // v3.9: เจ้าของสั่งตัดคำชวน "จอง" ทุกจุด — เทิร์นเรทเหลือบอกสถานะ "เข้ามา" เฉย ๆ
      // 15 Plus = ไม่มีของ (โหมดรับออเดอร์) → ไม่ต้องถามแยกทาง เสนอเรทเลย (v5.5)
      { user: '128GB', expectTools: ['get_installment_rates'], contains: ['เรทที่ 1', 'เรทที่ 2', '1,900', '2,566', '3,400', '2,905', 'เข้ามา', 'สเตทเม้นท์', '---', '[ตัวเลือก:'] },
      { user: 'เรทที่ 1', contains: ['สเตทเม้นท์', 'แชทนี้'], notContains: ['อนุมัติแน่นอน'] },
    ],
  },
  {
    // เจ้าของเคาะ 2026-09-20: ร้านมีของไม่ต้องดาวน์แล้ว → ถามดาวน์/ราคาลอย ๆ = บอกสองแบบแล้วถามรุ่น **ห้ามถามงบ**
    // (เดิม: ต้องถามงบ — แชทจริง 30 วัน: 80 ห้องถามแบบนี้ · 104 ห้องบอกว่าไม่มีเงินดาวน์) · เส้น "ขอให้แนะนำ" ยังถามงบตามเดิม (S3/S9/S11)
    id: 'S2', name: 'ถามดาวน์โดยไม่เลือกรุ่น → บอกสองแบบ (เครื่องนอกฟรีดาวน์ / เครื่องไทยตามเรท) แล้วถามรุ่น ห้ามถามงบ',
    turns: [
      { user: 'ดาวน์เท่าไหร่', contains: ['ฟรีดาวน์', 'เครื่องไทย', 'รุ่นไหน', '[ตัวเลือก:'], notContains: ['งบ', 'ไฟแนนซ์'], noBigNumbers: true },
    ],
  },
  {
    id: 'S29', name: 'ข้อความก้ำกึ่ง "สนใจผ่อน ดาวน์เท่าไหร่" → สคริปต์เดียวกัน ห้ามถามงบ',
    turns: [
      { user: 'สนใจผ่อน ดาวน์เท่าไหร่คะ', contains: ['ฟรีดาวน์', 'เครื่องไทย', 'รุ่นไหน'], notContains: ['งบ', 'ไฟแนนซ์'], noBigNumbers: true },
      { user: '15', contains: ['[ตัวเลือก:'], notContains: ['งบ'], noBigNumbers: true },
    ],
  },
  {
    // v5.2 (เจ้าของสั่ง 2026-08-23): ขอแนะนำ → ถาม "รุ่นที่ใช้อยู่" ก่อนงบ → recommend_devices ครั้งเดียว
    id: 'S3', name: 'แนะนำตามงบ → ถามรุ่นที่ใช้อยู่ก่อน → การ์ดสั้นจาก recommend_devices',
    turns: [
      { user: 'แนะนำหน่อย ไม่รู้จะเอารุ่นไหน', contains: ['รุ่นไหนอยู่'], noBigNumbers: true, forbidTools: ['recommend_devices'] },
      { user: 'ใช้ 12 อยู่', noBigNumbers: true, forbidTools: ['recommend_devices'] },
      { user: 'ดาวน์ไม่เกิน 3000 ผ่อนเดือนละไม่เกิน 2000', expectTools: ['recommend_devices'], forbidTools: ['search_products', 'calculate_installment'], contains: ['ดาวน์', 'ผ่อนเดือนละ', 'ดีกว่า'], notContains: ['17,500', '19,900', '13,900'] },
    ],
  },
  {
    // วิจัย 2026-08-24: objections ยอดฮิตของลูกค้าผ่อนไม่ใช้บัตรเครดิต — ต้องตอบจาก KB ตรง ๆ ไม่เลี่ยง ไม่แต่ง
    promoSilent: true,
    id: 'S13', name: 'objections: ไม่มีสลิป / อายุ 18 / โดนล็อกไหม / จ่ายช้า / ปิดยอดก่อน → ตอบจาก KB',
    turns: [
      { user: 'เป็นฟรีแลนซ์ ไม่มีสลิปเงินเดือน ผ่อนได้ไหม', expectTools: ['search_knowledge_base'], contains: ['สเตทเม้นท์', 'รูปตอนทำงาน'], notContains: ['ผ่านแน่', 'อนุมัติแน่นอน'], noBigNumbers: true },
      { user: 'อายุ 18 ผ่อนได้ไหม', contains: ['18'], notContains: ['20 ปี', 'ผู้ปกครองมาเซ็น'], noBigNumbers: true },
      { user: 'แล้วเครื่องโดนล็อกไหม', expectTools: ['search_knowledge_base'], contains: ['ค้างชำระ'], notContains: ['ไม่ล็อก', 'UFUND', 'Samsung Finance'], noBigNumbers: true },
      { user: 'ถ้าจ่ายช้าโดนอะไรบ้าง', expectTools: ['search_knowledge_base'], contains: ['50', '100', 'ค่าปรับ'], notContains: ['ต่อวัน', 'เดี๋ยวเช็คให้'], forbidTools: ['handoff_to_human'] },
      { user: 'ปิดยอดก่อนได้ไหม', expectTools: ['search_knowledge_base'], contains: ['ได้'], notContains: ['ดอกเบี้ย', '%', '50%'], noBigNumbers: true },
    ],
  },
  {
    promoSilent: true,
    id: 'S14', name: 'Responsible Lending: เลือกเรทแล้วต้องมีคำเตือน 1 ใน 3 ของรายได้ + ไม่มีคำกระตุ้น',
    turns: [
      { user: '15 Plus', expectTools: ['get_installment_rates'] },
      { user: '128GB', expectTools: ['get_installment_rates'], contains: ['เรทที่ 1', 'เรทที่ 2'] },
      { user: 'เรทที่ 2', contains: ['1 ใน 3'], notContains: ['จองเลย', 'ไม่ต้องคิด'] },
    ],
  },
  {
    // ลูกค้าใช้แอนดรอยด์ — tool ไม่รู้จักรุ่น (recognized:false) ไม่มี diff/เทิร์น
    id: 'S11', name: 'ใช้แอนดรอยด์อยู่ → แนะนำตามงบได้ ไม่มีบรรทัดดีกว่า/เทิร์น ไม่มั่วสเปค',
    turns: [
      { user: 'แนะนำหน่อย ไม่รู้จะเอารุ่นไหน', contains: ['รุ่นไหนอยู่'], noBigNumbers: true },
      { user: 'ใช้ซัมซุง A54 อยู่', noBigNumbers: true },
      { user: 'ดาวน์ 3000 ผ่อนไม่เกิน 2000', expectTools: ['recommend_devices'], contains: ['ดาวน์', 'ผ่อนเดือนละ', 'จุดเด่น'], notContains: ['ดีกว่า', 'เทิร์นได้ประมาณ', '3,500', 'A54:'] },
    ],
  },
  {
    id: 'S12', name: 'ใช้แอนดรอยด์ ถามว่า 15 ดีกว่ายังไง → ห้ามมั่วสเปคซัมซุง',
    turns: [
      { user: 'ใช้ Samsung S21 อยู่ ถ้าเปลี่ยนมา iPhone 15 ดีกว่ายังไง', expectTools: ['compare_devices'], contains: ['48MP'], notContains: ['Exynos', 'Snapdragon', 'เทิร์นได้ประมาณ', 'ลื่นกว่า'] },
    ],
  },
  {
    // v5.2: การ์ดต้องบอก "ดีกว่าเครื่องเดิม" จาก tool + เสนอเทิร์นเป็น "ประมาณ" + "ประเมินจริงที่ร้าน"
    id: 'S9', name: 'อัปเกรดจาก 12 → ดีกว่ายังไง (จาก tool) + เทิร์นเครื่องเดิมแบบ "ประมาณ"',
    turns: [
      { user: 'ตอนนี้ใช้ไอโฟน 12 อยู่ อยากเปลี่ยนเครื่อง งบดาวน์ 3000 ผ่อนไม่เกิน 2000', expectTools: ['recommend_devices'],
        contains: ['ดีกว่า 12:', 'A15', 'เทิร์น', 'ประมาณ', 'ประเมินจริงที่ร้าน', '3,500', '2,500', '1,758'],
        notContains: ['48MP', '120Hz', 'USB-C', 'Dynamic Island', '5G'] },
    ],
  },
  {
    // v5.2: ถาม "ดีกว่าที่ใช้อยู่ยังไง" กับรุ่นที่ระบุเอง → compare_devices (ห้ามเดาสเปคจากความจำ)
    id: 'S10', name: 'เทียบรุ่นที่สนใจกับเครื่องที่ใช้อยู่ → compare_devices',
    turns: [
      { user: 'ใช้ 12 อยู่ ถ้าเปลี่ยนเป็น 15 ดีกว่ายังไงบ้าง', expectTools: ['compare_devices'], contains: ['48MP', 'A16'], notContains: ['ProMotion', '120Hz', 'ไทเทเนียม', '5G'] },
    ],
  },
  {
    // เจ้าของสั่ง 2026-09-20: โปรฟรีดาวน์ = เครื่องนอกมือสองเท่านั้น · ค่างวดจาก KB · บอก 3 เรื่องก่อนราคา
    // ห้ามเอ่ยว่าผ่อนกับใคร · ไม่ขอเอกสารในแชท · เก็บชื่อ+เบอร์นัดเข้าร้าน (downAmount 0)
    id: 'S18', name: 'เครื่องนอกฟรีดาวน์: กรอง → 3 เรื่องก่อนราคา → ค่างวดจาก KB → นัดเข้าร้าน',
    turns: [
      { user: 'สนใจผ่อน iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย', '30 วัน', '60 วัน', '[ตัวเลือก:'], notContains: ['ไฟแนนซ์', 'งบ', 'ขั้น 3', 'รายการเครื่องนอก', 'KB'], noBigNumbers: true },
      { user: 'เครื่องนอก', expectTools: ['search_knowledge_base'], forbidTools: ['calculate_installment', 'get_installment_rates', 'handoff_to_human'],
        contains: ['ของแท้', '30 วัน', 'งวดแรก', 'ฟรีดาวน์', '2,395', '12 งวด', 'บัตรประชาชน'],
        notContains: ['ไฟแนนซ์', 'ของศูนย์', '60 วัน', 'เรทที่ 1', 'สเตทเม้นท์', 'รูปตอนทำงาน', '1,758', '3,288'] },
      { user: 'ผ่อนกับใครคะ ต้องส่งเอกสารอะไรไหม', notContains: ['ไฟแนนซ์', 'GFIN', 'สเตทเม้นท์', 'รูปตอนทำงาน'], contains: ['บัตรประชาชน'], noBigNumbers: true },
      // ทางเครื่องนอก = ผู้ให้ผ่อนภายนอก: ห้ามตอบเงื่อนไขล็อก/ค่าปรับของสัญญาร้าน (KB device-lock/late-fee ไม่ใช้กับทางนี้)
      { user: 'ถ้าจ่ายช้าเครื่องจะล็อกไหมคะ', contains: ['สัญญา'], notContains: ['ระบบดูแลของร้าน', 'ไม่ล็อก', '50 บาท', '100 บาท', 'ไฟแนนซ์', 'ไลน์การเงิน'], noBigNumbers: true },
      { user: 'พรุ่งนี้บ่ายเข้าไปดูได้ค่ะ', contains: ['เบอร์'], notContains: ['ระบบดูแลของร้าน', 'ไฟแนนซ์'], forbidTools: ['handoff_to_human'] },
      // ทางเครื่องนอกไม่มีเอกสารในแชท — ห้ามพูดตาม handoffMessage ของ tool ว่า "ทีมงานจะเช็คเอกสาร"
      // แต่ประโยคแจ้งสิทธิ์ข้อมูลส่วนบุคคล (pdpaNote ใน capture-lead.tool.ts) ต้องยังอยู่ครบ
      { user: 'สมหญิง ใจดี 0812345678', expectTools: ['capture_lead'], contains: ['บัตรประชาชน', 'คำสั่งซื้อนี้เท่านั้น'], notContains: ['เช็คเอกสาร', 'ไฟแนนซ์'] },
    ],
  },
  {
    id: 'S19', name: 'เครื่องนอก Pro Max ฟรีดาวน์ → ไม่ใช่ red flag + หยิบบรรทัด KB ถูกรุ่น',
    turns: [
      { user: 'สนใจ 16 Pro Max 256GB มือสอง เครื่องนอก ฟรีดาวน์', expectTools: ['search_knowledge_base'], forbidTools: ['handoff_to_human', 'calculate_installment'],
        contains: ['ฟรีดาวน์', '4,061', '15 งวด', '30 วัน', 'งวดแรก'], notContains: ['ไฟแนนซ์', '3,401', '60 วัน'] },
    ],
  },
  {
    id: 'S20', name: 'ถามหาฟรีดาวน์รุ่นที่ไม่อยู่ในโปร → บอกตรง ๆ ห้ามแต่งค่างวด',
    turns: [
      { user: 'มีฟรีดาวน์ iPhone 15 Plus ไหมคะ', contains: ['ไม่มีในโปร'], notContains: ['ไฟแนนซ์', 'ดาวน์ 0 บาท'], noBigNumbers: true },
    ],
  },
  {
    // ทางเข้าหลักของโปร (สถิติแชทจริง 19-20 ก.ย. 2026): 69 จาก 114 ห้องทักด้วยปุ่มโฆษณา "ฟรีดาวน์มีรุ่นไหนบ้าง?" — ไม่บอกรุ่น
    // ลูกค้าทักมาด้วยโปรเอง = ทางเครื่องนอกทั้งบทสนทนา: ห้ามถามนอก/ไทยซ้ำ · ไม่ถามความจุ · ปุ่มรุ่นย่อยต้องไม่มีตัวนอกโปร (Plus)
    id: 'S22', name: 'ปุ่มโฆษณา "ฟรีดาวน์มีรุ่นไหนบ้าง?" → ช่วงรุ่นสั้น ๆ → รุ่นย่อยเฉพาะในโปร → ค่างวดจาก KB',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', contains: ['เครื่องนอก', 'ของแท้', '[ตัวเลือก:'], notContains: ['ไฟแนนซ์', 'Plus', 'เครื่องไทย'], noBigNumbers: true },
      { user: '16', contains: ['Pro Max', '[ตัวเลือก:'], notContains: ['Plus', 'เครื่องไทย', 'ไฟแนนซ์'], noBigNumbers: true },
      { user: 'ตัวธรรมดาค่ะ', expectTools: ['search_knowledge_base'], forbidTools: ['calculate_installment', 'get_installment_rates'],
        contains: ['ของแท้', '30 วัน', 'งวดแรก', 'ฟรีดาวน์', '2,631', '12 งวด', 'บัตรประชาชน'], notContains: ['เครื่องไทย', 'ไฟแนนซ์', '4,061', '3,291'] },
    ],
  },
  {
    // ปุ่มโฆษณาอันที่สอง (5 ห้อง) — มาจากโฆษณาโปร แต่ข้อความไม่เอ่ยถึงโปร: ต้องบอกว่าโปรใช้บัตรใบเดียว
    // และห้ามยกเงื่อนไขอนุมัติของสัญญาที่ผ่อนกับร้าน (ไม่เช็คบูโร / 5 นาที / ผู้ปกครองค้ำ) มาตอบเหมา
    id: 'S23', name: 'ปุ่มโฆษณา "สมัครใช้เอกสารอะไรบ้าง?" → บัตรใบเดียว (โปร) / ตามเรท (เครื่องไทย) → ถามรุ่น',
    turns: [
      { user: 'สมัครใช้เอกสารอะไรบ้าง?', contains: ['บัตรประชาชน', 'ฟรีดาวน์', '18-59', '[ตัวเลือก:'], notContains: ['ไฟแนนซ์', '5 นาที', 'ค้ำ'], noBigNumbers: true },
    ],
  },
  {
    // แชทจริง: อายุ/นักศึกษา 8 ห้อง · เครดิต/แบล็คลิสต์ 8 ห้อง · อาชีพ/รายได้ 20 ห้อง — เงื่อนไขของสัญญาที่ผ่อนกับร้านใช้กับทางเครื่องนอกไม่ได้
    // เจ้าของให้เกณฑ์ 2026-09-20: อายุ 18-59 ปี · ไม่เช็คบูโร · บอทไม่ต้องถามอาชีพ
    id: 'S24', name: 'ทางเครื่องนอก: ถามอายุ/นักศึกษา/แบล็คลิสต์ → 18-59 ปี ไม่เช็คบูโร ห้ามอ้างเงื่อนไขของร้าน ห้ามรับปากว่าผ่าน',
    turns: [
      { user: 'สนใจฟรีดาวน์ iPhone 15 ตัวธรรมดาค่ะ', expectTools: ['search_knowledge_base'], contains: ['ฟรีดาวน์', '2,395'], notContains: ['เครื่องไทย', 'ไฟแนนซ์'] },
      { user: 'อายุ 19 เป็นนักศึกษา ผ่อนได้ไหมคะ', contains: ['18-59', 'บัตรประชาชน'], notContains: ['5 นาที', 'ค้ำ', 'ผู้ปกครอง', 'ผ่านแน่', 'อนุมัติแน่นอน', 'ไฟแนนซ์', 'ทำงานอะไร', 'อาชีพอะไร'] },
      { user: 'ติดแบล็คลิสต์อยู่ผ่อนได้ไหมคะ', contains: ['ไม่เช็คบูโร'], notContains: ['5 นาที', 'ผ่านแน่', 'อนุมัติแน่นอน', 'ไฟแนนซ์'] },
    ],
  },
  {
    // แชทจริง: สี/แบต/สภาพ 20 ห้อง — ทางเครื่องนอกบอกได้เฉพาะเครื่องที่ช่องตำหนิขึ้นต้น "เครื่องนอก" (fixture: ขาว แบต 97) ห้ามหยิบเครื่องไทย (ดำ 95) ห้ามบอกราคาจาก tool
    id: 'S25', name: 'ทางเครื่องนอก: ถามสี/แบต → บอกเฉพาะเครื่องนอกในสต๊อก ไม่มีราคาจาก tool',
    turns: [
      { user: 'สนใจฟรีดาวน์ iPhone 16 ตัวธรรมดาค่ะ', expectTools: ['search_knowledge_base'], contains: ['ฟรีดาวน์', '2,631'], notContains: ['เครื่องไทย', 'ไฟแนนซ์'] },
      { user: 'มีสีอะไรบ้างคะ แบตเท่าไหร่', expectTools: ['search_products'], contains: ['ขาว', '97'], notContains: ['ดำ', 'ชมพู', '2,290', '2,065', '22,900', '24,900', '23,900', 'LL/A', 'ไฟแนนซ์'] },
    ],
  },
  {
    // แชทจริง: ต่างจังหวัด/จัดส่ง/ออนไลน์ 6 ห้อง — เจ้าของ 2026-09-20: "ทำได้ แต่เป็นไฟแนนซ์นอกเท่านั้น"
    // บอทไม่บอกค่าส่ง/ค่าธรรมเนียมเอง (ค่ายกเลิกระหว่างทำสัญญา 1,000 พนักงานแจ้ง) · ปิดท้ายต้องไม่ชวนมาร้าน + ต้องมีประโยค PDPA
    id: 'S26', name: 'ทางเครื่องนอก + อยู่ต่างจังหวัด → ทำสัญญาออนไลน์ได้ → เก็บชื่อ+เบอร์ (ไม่บอกค่าส่ง/ค่าธรรมเนียม)',
    turns: [
      { user: 'สนใจฟรีดาวน์ iPhone 13 ตัวธรรมดาค่ะ', expectTools: ['search_knowledge_base'], contains: ['ฟรีดาวน์', '1,758'], notContains: ['เครื่องไทย', 'ไฟแนนซ์'] },
      { user: 'อยู่เชียงใหม่ค่ะ ไปร้านไม่ได้ ทำได้ไหมคะ', contains: ['ออนไลน์', 'เบอร์'], notContains: ['ไม่มีบริการจัดส่ง', 'มารับเครื่องที่', 'ค่าส่ง', '1,000', 'ไฟแนนซ์', 'ที่อยู่'] },
      { user: 'สมชาย ใจดี 0898765432', expectTools: ['capture_lead'], contains: ['ออนไลน์', 'บัตรประชาชน', 'คำสั่งซื้อนี้เท่านั้น'], notContains: ['เช็คเอกสาร', 'วันมาร้าน', '1,000', 'ไฟแนนซ์'] },
    ],
  },
  {
    // ยังไม่รู้ว่าสนใจแบบไหน: ผ่อนกับร้าน = ต้องมารับที่ร้าน (กติกาเดิม) · โปรเครื่องนอก = ออนไลน์ได้ → ถามรุ่นต่อ
    id: 'S27', name: 'ถามเรื่องส่ง/ต่างจังหวัดลอย ๆ → บอกสองทาง (ร้าน = มารับที่ร้าน · โปรเครื่องนอก = ออนไลน์ได้)',
    turns: [
      { user: 'อยู่ต่างจังหวัดค่ะ ส่งเครื่องให้ได้ไหมคะ', contains: ['ลพบุรี', 'ออนไลน์'], notContains: ['Kerry', 'Flash', 'เก็บปลายทาง', 'ค่าส่ง', 'ไฟแนนซ์', 'ที่อยู่'], noBigNumbers: true },
    ],
  },
  {
    // เจ้าของเคาะ 2026-09-20: เส้นแนะนำตามงบไม่เพิ่มคำถามก่อนแนะนำ แต่พอลูกค้าเลือกรุ่นที่อยู่ในโปร ต้องถามกรองนอก/ไทยตอนนั้น
    // (13 เครื่องไทยที่ tool แนะนำ: ดาวน์ 2,500 ผ่อน 1,758 · 13 เครื่องนอกในโปร: ฟรีดาวน์ ผ่อน 1,758 เท่ากัน — ลูกค้างบจำกัดควรได้ยิน)
    id: 'S28', name: 'แนะนำตามงบ → ลูกค้าเลือก 13 → ถามกรองนอก/ไทย → เครื่องนอก = ค่างวดจาก KB',
    turns: [
      { user: 'ตอนนี้ใช้ไอโฟน 12 อยู่ อยากเปลี่ยนเครื่อง งบดาวน์ 3000 ผ่อนไม่เกิน 2000', expectTools: ['recommend_devices'], skipGlobal: true },
      { user: 'เอา 13 ค่ะ', contains: ['เครื่องนอก', 'เครื่องไทย', '[ตัวเลือก:'], notContains: ['ไฟแนนซ์'] },
      { user: 'เครื่องนอก', expectTools: ['search_knowledge_base'], forbidTools: ['calculate_installment'], contains: ['ฟรีดาวน์', '1,758', '30 วัน', 'งวดแรก'], notContains: ['ไฟแนนซ์', '2,500'] },
    ],
  },
  {
    // สต๊อกจริงจะมีเครื่องนอกปนอยู่ (หน้าร้านจดช่องตำหนิ "เครื่องนอก XX/A" + ประกัน 30 วัน) — ลูกค้าเลือกเครื่องไทย
    // บอทต้องเสนอเฉพาะเครื่องไทย ห้ามหยิบเครื่องนอกมาคิดเรทผ่อนของร้าน/ประกัน 60 วัน
    id: 'S21', name: 'สต๊อกมีเครื่องนอกปน + ลูกค้าเลือกเครื่องไทย → เสนอเฉพาะเครื่องไทย',
    turns: [
      { user: 'สนใจ iPhone 16 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย'], notContains: ['ไฟแนนซ์', 'LL/A'], noBigNumbers: true },
      { user: 'เครื่องไทย', contains: ['เงินสด', 'ผ่อน'], notContains: ['2,290', '2,065', 'LL/A', 'ไฟแนนซ์'], noBigNumbers: true },
      { user: 'ผ่อนค่ะ', expectTools: ['calculate_installment'], contains: ['2,490', '2,245'], notContains: ['2,290', '2,065', 'LL/A', 'ฟรีดาวน์', 'ไฟแนนซ์'] },
    ],
  },
  {
    id: 'S4', name: 'ของมีในสต๊อก 2 สภาพ → เทียบด้วยดาวน์+งวด',
    turns: [
      // ต้องบอกสีด้วย (เจ้าของสั่ง 2026-08-17) — fixture มี 2 เครื่อง: ชมพู กับ ฟ้า
      // ขั้น 3.5 (2026-09-20): 15 128GB มือสองมีเครื่องนอก → กรองก่อน ห้ามมีตัวเลข
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย', '[ตัวเลือก:'], notContains: ['ไฟแนนซ์', 'ขั้น 3', 'รายการเครื่องนอก', 'KB'], noBigNumbers: true },
      // เทิร์นนี้แค่ถามแยกทาง ยังไม่มีตัวเลข — ไม่บังคับ search_products (บอทค้นไปแล้วตอนเทิร์นแรกหรือจะค้นตอนบอกตัวเลขก็ได้)
      // ด่าน "ต้องมาจาก tool" อยู่ที่เทิร์นถัดไป (calculate_installment + เลขต้องอยู่ใน GROUNDED)
      { user: 'เครื่องไทย', contains: ['เงินสด', 'ผ่อน'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], notContains: ['17,500', '19,900', 'ฟรีดาวน์'], contains: ['ผ่อนเดือนละ', 'ชมพู', 'ฟ้า'] },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-24: ลูกค้าซื้อสด ห้ามยิงเรทผ่อนใส่ — อ่านสัญญาณแล้วตอบราคาสดเลย
    promoSilent: true,
    id: 'S15', name: 'สัญญาณซื้อสด → ตอบราคาเงินสด ห้ามยัดเยียดผ่อน',
    turns: [
      { user: 'iPhone 15 128GB มือสอง ซื้อสดเท่าไหร่', expectTools: ['search_products'], contains: ['เงินสด', '17,500'], notContains: ['ดาวน์', 'ผ่อนเดือนละ', 'งบดาวน์'], forbidTools: ['get_installment_rates'] },
    ],
  },
  {
    id: 'S16', name: 'ไม่มีสัญญาณ → ถามแยกทาง 1 คำถามก่อนบอกตัวเลข',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย', '[ตัวเลือก:'], notContains: ['ขั้น 3', 'รายการเครื่องนอก', 'KB'], noBigNumbers: true },
      { user: 'เครื่องไทย', contains: ['เงินสด', 'ผ่อน', '[ตัวเลือก:'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], contains: ['ดาวน์', 'ผ่อนเดือนละ'] },
    ],
  },
  {
    promoSilent: true,
    id: 'S17', name: 'ซื้อสดแต่ไม่มีของ → บอกหาเข้ามาให้ + ทีมเช็คราคา ห้ามเดาราคา',
    turns: [
      { user: 'iPhone 15 Plus 128GB ราคาสดเท่าไหร่', contains: ['เช็ค'], notContains: ['สั่งเข้า', 'ดาวน์ 1,900', 'ผ่อนเดือนละ 2,566'], noBigNumbers: true },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-17: ลูกค้าขอความจุที่ร้านไม่มี (fixture มีแค่ 128/256GB)
    // → ต้องบอกว่าไม่มี + เสนอความจุที่มี + เทียบเรทให้ดูในเทิร์นเดียว
    promoSilent: true,
    id: 'S8', name: 'ความจุที่ลูกค้าอยากได้ไม่มี → บอกตรง ๆ + เทียบเรทที่มี',
    turns: [
      {
        user: 'สนใจ iPhone 15 Plus 512GB',
        expectTools: ['get_installment_rates'],
        contains: ['512GB', 'ไม่มี', '128GB', '256GB', 'ผ่อนเดือนละ'],
      },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-17 จากแชทจริง: อธิบายความต่างเรท/เอกสารไปแล้ว ห้ามพูดซ้ำ
    // (ลูกค้าเลือกเรทที่ 1 แล้วถามรุ่นใหม่ "ถ้า 14 Pro ล่ะ" → บอทอธิบายเอกสารซ้ำทั้งดุ้น)
    promoSilent: true,
    id: 'S7', name: 'บอกความต่างเรทไปแล้ว → ถามรุ่นใหม่ ห้ามอธิบายซ้ำ',
    turns: [
      { user: '15 Plus', expectTools: ['get_installment_rates'] },
      // ครั้งแรก: ต้องอธิบายความต่างเรท (3 ก้อน) — 15 Plus ไม่มีของ จึงไม่ถามแยกทาง
      { user: '128GB', expectTools: ['get_installment_rates'], contains: ['ต่างกันที่เอกสาร'] },
      // ครั้งที่สองในบทสนทนาเดียวกัน (ความจุอื่นของรุ่นเดิม) — ห้ามอธิบายความต่างซ้ำ
      { user: 'แล้ว 256GB ล่ะ', notContains: ['ต่างกันที่เอกสาร', 'ใช้แค่รูปตอนทำงาน'] },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-17 จากแชทจริง: ลูกค้าพิมพ์ "สนใจ" เฉย ๆ ต้องถามรุ่นก่อน
    // (เดิมเด้งถามงบดาวน์ → ลูกค้าตอบ "งบอะไร" แล้ว "ไม่มีค่ะ" = คุยต่อไม่ได้)
    promoSilent: true,
    id: 'S6', name: '"สนใจ" เฉย ๆ → ต้องถามรุ่นก่อน ห้ามเด้งถามงบ',
    turns: [
      { user: 'สนใจ', contains: ['รุ่นไหน'], notContains: ['งบดาวน์', 'ดาวน์ประมาณเท่าไหร่', 'ผ่อนต่อเดือน'] },
    ],
  },
  {
    // เทิร์นเทียบรุ่นคือตัวที่ยาวที่สุดในโลกจริง (วัดจาก prod: 366/323 ตัวอักษรก้อนเดียว)
    // — ด่านอ่านง่ายใน globalChecks จะจับตรงนี้เป็นหลัก
    id: 'S5', name: 'เทียบรุ่น (เทิร์นยาวสุดในโลกจริง) → ต้องอ่านง่าย',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย'], notContains: ['ขั้น 3', 'รายการเครื่องนอก', 'KB'], noBigNumbers: true },
      { user: 'เครื่องไทย', contains: ['เงินสด', 'ผ่อน'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], contains: ['ผ่อนเดือนละ'] },
      { user: 'ต่างกับ 15 Plus ยังไง', contains: ['ผ่อนเดือนละ'] },
    ],
  },
  // ───────── โหมดไม่มีสต๊อก + รูปตาราง (2026-09-22 — ประโยคจริงจากแชท 19-22 ก.ย.) · รันด้วย EVAL_NO_STOCK=1 ─────────
  {
    noStock: true,
    id: 'NS1', name: 'ปุ่มโฆษณา "ฟรีดาวน์มีรุ่นไหนบ้าง?" → รูปตารางโปร + ประกัน/ของแถม → รุ่นย่อย → ค่างวดจาก KB',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', expectTools: ['send_rate_card'], contains: ['ฟรีดาวน์', '30 วัน', 'เคส', '[ตัวเลือก:'], notContains: ['หมด', 'กำลังเข้ามา', 'กำลังจะเข้า', 'ไฟแนนซ์', 'Plus'], noBigNumbers: true },
      { user: '16', contains: ['Pro Max', '[ตัวเลือก:'], notContains: ['Plus', 'หมด', 'กำลังเข้ามา'], forbidTools: ['send_rate_card'], noBigNumbers: true },
      { user: '16 ธรรมดา', expectTools: ['search_knowledge_base'], contains: ['2,631', '12 งวด', '30 วัน', 'งวดแรก'], notContains: ['หมด', 'กำลังเข้ามา', 'ไฟแนนซ์', 'เครื่องไทย'] },
    ],
  },
  {
    noStock: true,
    id: 'NS2', name: 'ต่อจากข้อความอัตโนมัติของเพจ → ไม่ส่งตาราง/ไม่อธิบายโปรซ้ำ ไม่ลอก "ดาวน์ 0 บาท"',
    history: [
      { role: 'user', content: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { role: 'assistant', content: 'อันนี้ตารางผ่อนเครื่องนอกค่ะ 😊\n\nดาวน์ 0 บาท\nประกันร้าน 30 วัน\nแถมเคสกับฟิล์มให้ด้วยค่ะ\n\nสนใจรุ่นไหนคะ' },
    ],
    turns: [
      { user: '15 Pro ค่ะ', expectTools: ['search_knowledge_base'], forbidTools: ['send_rate_card'], contains: ['3,288', '30 วัน'], notContains: ['โปรฟรีดาวน์เป็น', 'ไฟแนนซ์', 'บริษัทสินเชื่อ', 'หมด'] },
    ],
  },
  {
    noStock: true,
    id: 'NS3', name: 'เครื่องไทยมือสอง ตอนไม่มีสต๊อก → เรท 2 แบบจากตาราง ห้ามพูดหมด/กำลังเข้า/พร้อมรับ',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย'], notContains: ['หมด', 'กำลังเข้ามา'], noBigNumbers: true },
      { user: 'เครื่องไทย ผ่อนค่ะ', expectTools: ['get_installment_rates'], contains: ['เรทที่ 1', 'เรทที่ 2', '2,424', '2,523'], notContains: ['หมด', 'กำลังเข้ามา', 'กำลังจะเข้ามา', 'จองไว้ก่อน', 'พร้อมรับที่ร้าน', 'ของเข้า'] },
    ],
  },
  {
    noStock: true,
    id: 'NS4', name: 'ขอดูรูปเครื่องจริง/ถามสี → บอกแอดมินส่งรูป + notify_staff ห้ามเดาสี ห้ามพูดหมด',
    turns: [
      { user: 'iPhone 16 มือสอง มีสีอะไรบ้างคะ ขอดูรูปเครื่องจริงหน่อย', expectTools: ['notify_staff'], forbidTools: ['handoff_to_human'], contains: ['รูป'], notContains: ['หมด', 'กำลังเข้ามา', 'กำลังจะเข้ามา', 'ชมพู', 'สีดำ', 'สีขาว'] },
    ],
  },
  {
    noStock: true,
    id: 'NS5', name: 'ถามที่ตั้งร้าน → KB + รูปแผนที่ ไม่ handoff',
    turns: [
      { user: 'ร้านอยู่ตรงไหนคะ เปิดกี่โมง', expectTools: ['send_rate_card', 'search_knowledge_base'], forbidTools: ['handoff_to_human'], contains: ['บขส'], notContains: ['หมด'] },
    ],
  },
  {
    noStock: true,
    id: 'NS6', name: 'รุ่นเพิ่งออก iPhone 18 Pro (ไม่มีในตาราง) → ห้ามบอกว่ามือ 1 ไม่มีผลิต ห้ามถามงบ → แจ้งพนักงาน',
    turns: [
      { user: 'สนใจ iPhone 18 Pro ผ่อนเท่าไหร่คะ', expectTools: ['get_installment_rates', 'notify_staff'], notContains: ['ไม่มีผลิตแล้ว', 'งบ', 'หมด', 'กำลังเข้ามา'], noBigNumbers: true },
    ],
  },
  {
    noStock: true,
    id: 'NS7', name: 'อายุ 18 → ทำเองได้ (เจ้าของ 2026-09-22)',
    turns: [
      { user: 'อายุ 18 ผ่อนได้ไหมคะ', expectTools: ['search_knowledge_base'], contains: ['18'], notContains: ['20 ปี', 'ผู้ปกครองมาเซ็น'], noBigNumbers: true },
    ],
  },
  {
    noStock: true,
    id: 'NS8', name: 'ตีสองถามผลอนุมัติ → ห้ามสัญญา 5 นาที/รอสักครู่ บอกช่วงร้านเปิด',
    clockIso: '2026-09-22T19:10:00Z',
    turns: [
      { user: 'ถ้าส่งสเตทเม้นท์ไปตอนนี้ รู้ผลกี่นาทีคะ', notContains: ['5 นาที', 'รอสักครู่', 'แอดมินกำลัง'], contains: ['10 โมง'] },
    ],
  },
];

// ───────────────────────── engine ─────────────────────────
async function loadPersona(): Promise<string> {
  if (process.env.EVAL_BASE_FILE && process.env.EVAL_EXTRAS_FILE) {
    return readFileSync(process.env.EVAL_BASE_FILE, 'utf8') + readFileSync(process.env.EVAL_EXTRAS_FILE, 'utf8');
  }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['shop_bot_persona_base', 'shop_bot_persona_bot_extras'] }, deletedAt: null },
  });
  await prisma.$disconnect();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const base = map.get('shop_bot_persona_base');
  const extras = map.get('shop_bot_persona_bot_extras');
  if (!base || !extras) throw new Error('persona ไม่ครบใน DB — ใช้ EVAL_BASE_FILE/EVAL_EXTRAS_FILE แทนได้');
  return `${base}${extras}`;
}

// ลำดับ/ชุดเดียวกับ SalesBotService.buildToolDefinitions
const TOOLS = [
  SEARCH_PRODUCTS_TOOL, CALCULATE_INSTALLMENT_TOOL, LIST_PROMOTIONS_TOOL, // NO_STOCK ยังประกาศ (runFixtureTool คืน unavailable)
  HANDOFF_TO_HUMAN_TOOL, CAPTURE_LEAD_TOOL, GET_INSTALLMENT_RATES_TOOL, SEARCH_KNOWLEDGE_BASE_TOOL,
  RECOMMEND_DEVICES_TOOL, COMPARE_DEVICES_TOOL, SEND_RATE_CARD_TOOL, NOTIFY_STAFF_TOOL,
].map((t: { name: string; description: string; input_schema?: unknown; inputSchema?: unknown }) => ({
  name: t.name,
  description: t.description,
  input_schema: (t.input_schema ?? t.inputSchema) as Anthropic.Tool['input_schema'],
}));

async function botReply(
  client: Anthropic, system: string, messages: Anthropic.MessageParam[],
): Promise<{ text: string; toolsUsed: string[] }> {
  const toolsUsed: string[] = [];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS.map((t, i) => (i === TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t)),
      ...(hop === MAX_HOPS - 1 ? { tool_choice: { type: 'none' as const } } : {}),
      output_config: { effort: EFFORT },
      messages,
    });
    const toolCalls = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const text = resp.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';
    if (toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: text || '...' });
      return { text: stripStrayForeignScript(text), toolsUsed };
    }
    const results = toolCalls.map((tc) => {
      toolsUsed.push(tc.name);
      if (process.env.EVAL_SHOW === '1') console.log(`      · tool ${tc.name} ${JSON.stringify(tc.input).slice(0, 200)}`);
      return { tc, result: runFixtureTool(tc.name, tc.input as Record<string, unknown>) };
    });
    // เหมือน SalesBotService: เขียนคำตอบมาพร้อมเครื่องมือลงมือแทนที่สำเร็จ = จบเทิร์นด้วยข้อความนั้น
    if (text.trim() && results.every(({ tc, result }) => SIDE_EFFECT_TOOL_NAMES.has(tc.name) && isCleanSideEffectResult(tc.name, result))) {
      messages.push({ role: 'assistant', content: text });
      return { text: stripStrayForeignScript(text), toolsUsed };
    }
    messages.push({ role: 'assistant', content: resp.content.filter((c) => c.type === 'text' || c.type === 'tool_use') as Anthropic.ContentBlockParam[] });
    messages.push({
      role: 'user',
      content: results.map(({ tc, result }) => ({ type: 'tool_result' as const, tool_use_id: tc.id, content: JSON.stringify(result) })),
    });
  }
  return { text: '', toolsUsed };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ต้องมี ANTHROPIC_API_KEY');
  const persona = await loadPersona();
  const system = NO_STOCK ? `${persona}\n${NO_STOCK_PROMPT}` : persona;
  console.log(`bot-eval: model=${MODEL} effort=${EFFORT} persona=${system.length.toLocaleString()} chars${NO_STOCK ? ' · NO_STOCK' : ''}\n`);
  const client = new Anthropic();
  const only = process.env.EVAL_ONLY;
  const onlyIds = only ? new Set(only.split(',').map((x) => x.trim())) : null;
  let totalChecks = 0, totalFails = 0;

  for (const sc of SCENARIOS) {
    if (onlyIds && !onlyIds.has(sc.id)) continue;
    if (!onlyIds && !!sc.noStock !== NO_STOCK) continue;
    console.log(`━━ ${sc.id}: ${sc.name}`);
    // fidelity เท่ากับ prod: ประวัติข้ามเทิร์นเก็บเฉพาะ "ข้อความ" (ai-auto-reply สร้าง
    // priorMessages จาก chat_messages) — ผล tool ของเทิร์นก่อนหายไป บอทต้องเรียกใหม่เอง
    const transcript: Anthropic.MessageParam[] = [...(sc.history ?? [])];
    // เหมือน SalesBotService: บรรทัดเวลาร้านนำหน้าเฉพาะข้อความล่าสุด (ประวัติเก็บข้อความดิบ)
    const clock = shopClockLine(new Date(sc.clockIso ?? '2026-09-22T07:00:00Z'));
    for (const turn of sc.turns) {
      const messages: Anthropic.MessageParam[] = [...transcript, { role: 'user', content: `${clock}\n${turn.user}` }];
      const { text, toolsUsed } = await botReply(client, system, messages);
      transcript.push({ role: 'user', content: turn.user });
      transcript.push({ role: 'assistant', content: text || '...' });
      const fails: string[] = turn.skipGlobal ? [] : [...globalChecks(text)];
      for (const t of turn.expectTools ?? []) if (!toolsUsed.includes(t)) fails.push(`ไม่ได้เรียก tool: ${t}`);
      for (const t of turn.forbidTools ?? []) if (toolsUsed.includes(t)) fails.push(`เรียก tool ที่ห้าม: ${t}`);
      for (const s of turn.contains ?? []) if (!text.includes(s)) fails.push(`ขาด: "${s}"`);
      for (const s of turn.notContains ?? []) if (text.includes(s)) fails.push(`ห้ามมีแต่มี: "${s}"`);
      if (turn.wantButtons && !text.includes('[ตัวเลือก:')) fails.push('ไม่มีปุ่มกด');
      if (sc.promoSilent && /เครื่องนอก|ฟรีดาวน์/.test(text)) fails.push('เอ่ยถึงเครื่องนอก/ฟรีดาวน์เองในฉากที่ไม่เกี่ยวกับโปร');
      if (turn.noBigNumbers) {
        const nums = [...text.matchAll(/\d[\d,]{3,}/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => n >= 1000);
        if (nums.length) fails.push(`มีตัวเลขเงินทั้งที่ยังไม่ควรมี: ${nums.join(',')}`);
      }
      totalChecks++;
      if (fails.length) {
        totalFails++;
        console.log(`  ✗ "${turn.user}" (tools: ${toolsUsed.join(',') || '-'})`);
        fails.forEach((f) => console.log(`      - ${f}`));
        console.log(`      ↳ reply: ${text.replace(/\n/g, ' / ').slice(0, 900)}`);
      } else {
        console.log(`  ✓ "${turn.user}" (tools: ${toolsUsed.join(',') || '-'})`);
        // EVAL_SHOW=1 — พิมพ์คำตอบของเทิร์นที่ผ่านด้วย (ไว้อ่านถ้อยคำจริงก่อน apply persona)
        if (process.env.EVAL_SHOW === '1') console.log(`      ↳ reply: ${text.replace(/\n/g, ' / ').slice(0, 900)}`);
      }
    }
  }
  console.log(`\nผล: ${totalChecks - totalFails}/${totalChecks} เทิร์นผ่าน`);
  if (totalFails > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
