/**
 * bot-eval — ชุดเทสบทสนทนาจำลองของบอทขาย (regression harness)
 *
 * รันบทสนทนาสคริปต์กับ "prompt จริง + โมเดลจริง" แต่ tool เป็น fixture คงที่
 * แล้วตรวจกฎอัตโนมัติ (ค้นก่อนลิสต์รุ่น / ปุ่มกด / ห้ามราคาเต็มนำ / เลขต้องมาจาก fixture /
 * คำต้องห้าม / เรทที่ 1-2 / ลำดับการขาย) — ใช้กันของที่แก้แล้วเด้งกลับ ก่อน apply prompt ใหม่
 *
 * ลูปเครื่องมือเลียน SalesBotService.generateReply ทุกขั้น (รอบ 2026-09-22 synth C05 + รีวิว TOOLLOOP-1..6):
 * - นิยามเครื่องมือจาก SalesBotService.buildToolDefinitions — send_rate_card ประกาศเฉพาะรูปที่ตั้งไว้จริง
 *   (default = ชุดเดียวกับ apply-bot-tune-2026-09-22.sql: imported_free_down + shop_map) · fixture ใช้ SendRateCardTool
 *   ตัวจริง (used_rate1/2 · new_rate1/2 ได้ missing เหมือน prod)
 * - ทางลัดจบเทิร์นเฉพาะผลลงมือแทนที่สะอาด + ตัวเลขผ่าน GroundingGuard · systemNote เมื่อรูปส่งไม่ได้/ตัวเลขไม่ผ่าน ·
 *   ข้อความค้าง (pendingText) · 6 รอบ รอบสุดท้าย tool_choice none · ข้อความสำรองพนักงาน · ตัดอักษรแปลก
 * - confidence แบบเดียวกับ estimateConfidence — ต่ำกว่าเกณฑ์ = ลูกค้าไม่เห็นคำตอบนี้ (router ส่งข้อความรอแอดมินแทน)
 * - ประวัติข้ามเทิร์นแบบ router: แตกก้อนตาม --- · ตัดปุ่ม [ตัวเลือก:] · รูปที่แนบจดเป็น "[รูป <label>]"
 *   (ไม่ตัดเหลือ 16 แถวแบบ prod — prod มีสมุดสถานะ sessionNote ที่สกัดด้วย LLM อีกตัวเล่าบริบทแทน eval จึงเก็บประวัติเต็มแทนโน้ต ·
 *    ฉากที่ประวัติเกิน 16 แถวพิมพ์คำเตือนตอนรัน: เทิร์นต่อจากนั้นบอทเห็นบริบท/เลขที่มีที่มามากกว่า prod)
 * - สต๊อกจำลองมี photoUrl/webUrl แบบ prod ⇒ โหมดปกติแนบรูปสินค้าจริง และชนช่องแนบกับรูปตารางได้ (รีวิว ATTACH-1)
 *
 * ใช้:
 *   ANTHROPIC_API_KEY=... DATABASE_URL=... npm --prefix apps/api run bot:eval
 *     (อ่าน persona จริงจาก DB — ต้องมี cloud-sql-proxy ถ้าชี้ prod)
 *   ANTHROPIC_API_KEY=... EVAL_BASE_FILE=base.txt EVAL_EXTRAS_FILE=extras.txt npm run bot:eval
 *     (ทดสอบ prompt ฉบับร่างก่อน apply — ไม่แตะ DB)
 *   EVAL_DRY=1 npm run bot:eval
 *     (ตรวจโครงฉาก + fixture + ลูปเครื่องมือด้วยโมเดลปลอม — ไม่เรียก API ไม่แตะ DB ไม่ต้องมี key)
 * ตัวเลือก:
 *   EVAL_MODEL (default claude-sonnet-5) · EVAL_EFFORT (default medium)
 *   EVAL_NO_STOCK=1 — โหมดไม่มีสต๊อก (= shop_bot_stock_mode NO_STOCK: เครื่องมือสต๊อกคืน NO_STOCK_TOOL_RESULT
 *     + ต่อท้าย NO_STOCK_PROMPT + recommend_devices ไม่มีฟิลด์สต๊อก)
 *   EVAL_SET=S,NS,E | ALL — เลือกชุดฉาก · ไม่ระบุ = S (โหมดปกติ) หรือ NS (EVAL_NO_STOCK=1) แบบเดิม
 *     ฉากที่โหมดไม่ตรงถูกข้าม · ชุด E ส่วนใหญ่รันได้ทั้งสองโหมด — prod เริ่มที่ NO_STOCK: EVAL_SET=E EVAL_NO_STOCK=1
 *   EVAL_ONLY=S3,E0*,NS* — เลือกรายฉาก (ลงท้าย * = ขึ้นต้นด้วย · ข้ามฉากที่โหมดไม่ตรง/รอรอบหน้า)
 *     ระบุชื่อเต็ม = รันแม้โหมดไม่ตรง (มีคำเตือน เช่นวัด S4 ใต้ EVAL_NO_STOCK=1) หรือเป็นฉากที่รอรอบหน้า (deferred)
 *   EVAL_REPEAT=3 — รันแต่ละฉากซ้ำ N รอบ (ฉากที่กำหนด runs เองใช้ค่าที่มากกว่า)
 *   EVAL_INCLUDE_DEFERRED=1 — รวมฉากที่พึ่งกติกา persona/KB ที่ยังไม่อยู่ในรอบนี้
 *   EVAL_KB_FILE=<ไฟล์ JSON นอก repo> — ค้น KB ด้วยคลังจริงผ่าน scoreKbEntries ตัวจริง (แถว: id, category, priority,
 *     triggerKeywords, exampleQuestions, responseTemplate) · EVAL_KB_PATCH_FILE=<kb_changes.json> ทับค่าก่อนค้น
 *     ⚠️ repo เป็น public — ห้าม commit สำเนาคลัง
 *   EVAL_RATE_CARDS='<json shop_bot_rate_cards>' — ลองชุดรูปอื่น ('{}' = ไม่ประกาศ send_rate_card)
 *   EVAL_CONF_THRESHOLD (default 0.8 = ai.autoConfidenceThreshold) · EVAL_SHOW=1 (พิมพ์ผลเครื่องมือ/คำตอบทุกเทิร์น)
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  SalesBotService,
  shopClockLine,
  NO_STOCK_TOOL_RESULT,
  SIDE_EFFECT_TOOL_NAMES,
  isCleanSideEffectResult,
  reconcileRateCardResult,
  withSystemNote,
  rateCardMissingNote,
  stripUnsentImageClaims,
  groundingGuardNote,
  redactMediaUrls,
  staffFallbackReply,
  isBarePromise,
} from '../modules/sales-bot/sales-bot.service';
import {
  NO_STOCK_PROMPT,
  parseRateCards,
  type BotRuntimeConfigService,
  type RateCardsConfig,
  type StockMode,
} from '../modules/sales-bot/bot-runtime-config.service';
import {
  SendRateCardTool,
  buildSendRateCardTool,
  type SendRateCardResult,
} from '../modules/sales-bot/tools/send-rate-card.tool';
import { stripRecommendStockFields } from '../modules/sales-bot/tools/recommend-devices.tool';
import type { StorageService } from '../modules/storage/storage.service';
import { stripStrayForeignScript } from '../utils/bot-reply-sanitize.util';
import {
  collectConversationNumbers,
  collectGroundedPrices,
  collectGroundedPricesFromToolText,
  guardGrounding,
} from '../utils/price-grounding.util';
import {
  collectAttachmentsFromToolResult,
  MAX_BOT_ATTACHMENTS,
  RATE_CARD_ID_PREFIX,
  type BotAttachment,
} from '../utils/bot-attachments.util';
import {
  extractStorageToken,
  normalizeStorage,
  stripStorageToken,
} from '../utils/device-query-normalize.util';
import { scoreKbEntries, type KbMatch, type KbScorableEntry } from '../utils/kb-match.util';

const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-5';
const EFFORT = (process.env.EVAL_EFFORT ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_HOPS = 6; // = MAX_TOOL_HOPS ของ SalesBotService (รอบสุดท้ายบังคับ tool_choice none)
const MAX_TOKENS = 4096; // = DEFAULT_MAX_TOKENS ของ ClaudeProvider
const NO_STOCK = process.env.EVAL_NO_STOCK === '1';
const MODE: StockMode = NO_STOCK ? 'NO_STOCK' : 'LIVE';
/** = ai.autoConfidenceThreshold (default 80) — ต่ำกว่านี้ router ทิ้งคำตอบบอทแล้วส่งข้อความรอแอดมิน + ส่งต่อพนักงาน */
const CONF_THRESHOLD = Number(process.env.EVAL_CONF_THRESHOLD ?? '0.8');
const SHOW = process.env.EVAL_SHOW === '1';

// ───────────────────────── ค่าตั้งรูปตาราง (send_rate_card) ─────────────────────────
// ชุดเดียวกับที่ scripts/ops/apply-bot-tune-2026-09-22.sql ตั้งบน prod (EVAL_DRY เทียบกับไฟล์ SQL ให้)
// ตารางเครื่องไทย/มือ 1 (used_rate*/new_rate*) ยังไม่มีรูป ⇒ ไม่อยู่ใน enum และเรียกแล้วได้ missing (รีวิว TOOLLOOP-1)
const PROD_RATE_CARDS_JSON =
  '{"imported_free_down": {"storageKey": "bot-media/rate-cards/imported-free-down-2026-09-22.jpg", "label": "ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2 (เครื่องนอก)"}, ' +
  '"shop_map": {"storageKey": "bot-media/rate-cards/shop-map-2026-09-22.jpg", "label": "วิธีเดินทางมาร้าน BESTCHOICE ลพบุรี"}}';
const APPLY_SQL_PATH = resolve(__dirname, '../../../../scripts/ops/apply-bot-tune-2026-09-22.sql');
const RATE_CARDS: RateCardsConfig = parseRateCards(process.env.EVAL_RATE_CARDS ?? PROD_RATE_CARDS_JSON);

// ลำดับ/ชุดเดียวกับ SalesBotService.generateReply (prod ประกาศ notify_staff เสมอ — NotifyStaffTool อยู่ในโมดูล)
/** นิยามเครื่องมือของ service → รูปแบบที่ SDK รับ (ใช้ซ้ำได้กับชุดรูปอื่น เช่นด่านทดสอบตัวเองใน EVAL_DRY) */
function toolsFor(cards: RateCardsConfig): Anthropic.Tool[] {
  return SalesBotService.buildToolDefinitions({ rateCards: cards, notifyStaff: true }).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));
}
const TOOL_DEFS = SalesBotService.buildToolDefinitions({ rateCards: RATE_CARDS, notifyStaff: true });
const TOOLS: Anthropic.Tool[] = toolsFor(RATE_CARDS);
/** ชื่อเครื่องมือที่ฉากอ้างได้ (รวม send_rate_card แม้ชุดรูปที่ทดสอบจะว่าง) */
const ALL_TOOL_NAMES = new Set([...TOOL_DEFS.map((t) => t.name), 'send_rate_card', 'notify_staff']);

// ───────────────────────── fixtures ─────────────────────────
// สต๊อกจำลอง: 15 128GB มือสอง 2 สภาพ + 14 128GB + 16 128GB (ไทย 2 + นอก 1) · 15 Plus/Pro = ไม่มีของ (เทสโหมดรับออเดอร์)
interface FixtureUnit {
  id: string;
  model: string;
  storage: string;
  condition: string;
  grade: string;
  color: string;
  batteryPct: number;
  priceThb: number;
  /** = Product.deviceOrigin — search_products กรองตรงตัว (THAI/IMPORTED) เหมือนของจริง */
  deviceOrigin: 'THAI' | 'IMPORTED';
  cosmeticNotes?: string | null;
  shopWarrantyDays?: number;
  /** รูป/ลิงก์สินค้าแบบ prod (SearchProductsTool คืน photoUrl เมื่อ photoAvailable) — https เท่านั้น
   *  collectAttachmentsFromToolResult ถึงจะรับ ⇒ ฉากโหมดปกติแนบรูปสินค้าจริงและชนช่องแนบกับรูปตารางได้ (รีวิว ATTACH-1) */
  photoUrl?: string;
  webUrl?: string;
}
/** ใส่ photoUrl/webUrl ให้ทุกตัว — fixture เดิมบอก photoAvailable: true แต่ไม่มีลิงก์ ⇒ ช่องแนบว่างตลอด ไม่เหมือน prod */
function withPhoto(u: FixtureUnit): FixtureUnit {
  return { ...u, photoUrl: `https://eval.invalid/photo/${u.id}.jpg`, webUrl: `https://eval.invalid/share/${u.id}` };
}
const UNITS: Record<string, FixtureUnit> = {
  p15b: withPhoto({ id: 'p15b', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'B', color: 'ชมพู', batteryPct: 87, priceThb: 17500, deviceOrigin: 'THAI' }),
  p15a: withPhoto({ id: 'p15a', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 92, priceThb: 19900, deviceOrigin: 'THAI' }),
  p14: withPhoto({ id: 'p14', model: 'iPhone 14', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 90, priceThb: 13900, deviceOrigin: 'THAI' }),
  // S21: สต๊อกมีเครื่องนอกปนอยู่ — หน้าร้านจดช่องตำหนิขึ้นต้น "เครื่องนอก" + ประกันร้าน 30 วัน (tool จริงคืน cosmeticNotes/shopWarrantyDays)
  p16th: withPhoto({ id: 'p16th', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'A', color: 'ดำ', batteryPct: 95, priceThb: 24900, cosmeticNotes: null, shopWarrantyDays: 60, deviceOrigin: 'THAI' }),
  // เครื่องไทย 2 ตัว (เหมือนโครง S4) — fixture calculate_installment คืนเลขคงที่ไม่ขึ้นกับ downPct/งวด: ถ้ามีเครื่องไทยตัวเดียว
  // บอทจะลองคิดหลายแพ็กเกจแล้วได้เลขเดิมซ้ำ ๆ จนชนเพดาน hop (artifact ของ fixture ไม่ใช่พฤติกรรมจริง)
  p16th2: withPhoto({ id: 'p16th2', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'B', color: 'ชมพู', batteryPct: 91, priceThb: 23900, cosmeticNotes: null, shopWarrantyDays: 60, deviceOrigin: 'THAI' }),
  p16imp: withPhoto({ id: 'p16imp', model: 'iPhone 16', storage: '128GB', condition: 'USED', grade: 'A', color: 'ขาว', batteryPct: 97, priceThb: 22900, cosmeticNotes: 'เครื่องนอก LL/A', shopWarrantyDays: 30, deviceOrigin: 'IMPORTED' }),
};
/** เครื่องที่เลขของมัน "จงใจไม่อยู่ใน GROUNDED" — บอทเอาไปเสนอเป็นเครื่องไทยเมื่อไร = ตกทั้ง notContains และเลขไม่มีที่มา */
const UNGROUNDED_UNITS = new Set(['p16imp']);
const CALC: Record<string, { downAmountThb: number; monthlyThb: number; termMonths: number }> = {
  p15b: { downAmountThb: 1750, monthlyThb: 1578, termMonths: 12 },
  p15a: { downAmountThb: 1990, monthlyThb: 1790, termMonths: 12 },
  p14: { downAmountThb: 1390, monthlyThb: 1245, termMonths: 12 },
  p16th: { downAmountThb: 2490, monthlyThb: 2245, termMonths: 12 },
  p16th2: { downAmountThb: 2390, monthlyThb: 2155, termMonths: 12 },
  p16imp: { downAmountThb: 2290, monthlyThb: 2065, termMonths: 12 },
};

// ตารางเรท (PricingTemplate) จำลอง — get_installment_rates ค้นแบบเดียวกับ GetInstallmentRatesTool.run ทุกขั้น
// (contains รุ่น · ความจุเป็นตัวแคบผล · กรอง condition/deviceOrigin · เรียง รุ่น/ความจุ/มือ 1 ก่อน · ≤3 แถว)
// ทุกแถว deviceOrigin UNSPECIFIED (ตาราง prod ทั้งชุดยังไม่ติดป้าย) · เลข 15/15 Plus/16 มือสอง = ตาราง prod เดิม ·
// 16 มือ 1 / 16 PM / 17 PM 256GB = synth C05 · 15 256GB และ 17 PM 512GB = เลขสมมติของ fixture (ให้มีตัวเลือกความจุ)
interface RateRow {
  model: string;
  storage: string;
  category: 'PHONE_NEW' | 'PHONE_USED';
  rate1: [down: number, monthly: number, term: number];
  rate2: [down: number, monthly: number, term: number];
}
const RATE_TABLE: RateRow[] = [
  { model: 'iPhone 15', storage: '128GB', category: 'PHONE_USED', rate1: [900, 2424, 12], rate2: [3700, 2523, 12] },
  { model: 'iPhone 15', storage: '256GB', category: 'PHONE_USED', rate1: [1900, 2690, 12], rate2: [4300, 2790, 12] },
  { model: 'iPhone 15 Plus', storage: '128GB', category: 'PHONE_USED', rate1: [1900, 2566, 12], rate2: [3400, 2905, 12] },
  { model: 'iPhone 15 Plus', storage: '256GB', category: 'PHONE_USED', rate1: [1900, 2766, 12], rate2: [3600, 3105, 12] },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_NEW', rate1: [4100, 3251, 12], rate2: [5900, 3181, 15] },
  { model: 'iPhone 16', storage: '128GB', category: 'PHONE_USED', rate1: [3300, 2652, 12], rate2: [3900, 2741, 15] },
  { model: 'iPhone 16 Pro Max', storage: '256GB', category: 'PHONE_USED', rate1: [4800, 3793, 12], rate2: [3700, 4171, 15] },
  { model: 'iPhone 16 Pro Max', storage: '512GB', category: 'PHONE_USED', rate1: [5100, 4106, 12], rate2: [4700, 4391, 15] },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_NEW', rate1: [7400, 5917, 12], rate2: [10700, 5712, 15] },
  { model: 'iPhone 17 Pro Max', storage: '256GB', category: 'PHONE_USED', rate1: [9900, 4577, 12], rate2: [7500, 5162, 15] },
  { model: 'iPhone 17 Pro Max', storage: '512GB', category: 'PHONE_NEW', rate1: [8400, 6650, 12], rate2: [12100, 6420, 15] },
];

function runRates(input: Record<string, unknown>): { templates: unknown[] } {
  const rawQuery = String(input.query ?? '').trim();
  if (!rawQuery) return { templates: [] };
  const storageToken = extractStorageToken(rawQuery);
  const modelQuery = (storageToken ? stripStorageToken(rawQuery) : rawQuery).toLowerCase();
  if (!modelQuery) return { templates: [] };
  const origin = String(input.deviceOrigin ?? '');
  // ทุกแถวเป็น UNSPECIFIED: THAI (= THAI + UNSPECIFIED) และ UNSPECIFIED ได้ทั้งหมด · IMPORTED ไม่มีแถว
  if (origin === 'IMPORTED') return { templates: [] };
  const cond = String(input.condition ?? '').replace(/\s+/g, '');
  const rows = RATE_TABLE.filter(
    (r) =>
      (cond === 'มือ1' ? r.category === 'PHONE_NEW' : cond === 'มือสอง' || cond === 'มือ2' ? r.category !== 'PHONE_NEW' : true) &&
      (r.model.toLowerCase().includes(modelQuery) || 'apple'.includes(modelQuery)),
  ).sort(
    (a, b) =>
      (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) ||
      (a.storage < b.storage ? -1 : a.storage > b.storage ? 1 : 0) ||
      (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );
  let candidates = rows;
  if (storageToken) {
    const bySize = rows.filter((r) => normalizeStorage(r.storage) === storageToken);
    if (bySize.length > 0) candidates = bySize;
  }
  const opt = ([downPayment, monthlyPrice, termMonths]: [number, number, number]) => ({ downPayment, monthlyPrice, termMonths });
  return {
    templates: candidates.slice(0, 3).map((r) => ({
      deviceOrigin: 'UNSPECIFIED',
      condition: r.category === 'PHONE_NEW' ? 'มือ 1' : 'มือสอง',
      brand: 'Apple',
      model: r.model,
      storage: r.storage,
      hasWarranty: false,
      rate1: opt(r.rate1),
      rate2: opt(r.rate2),
    })),
  };
}

// recommend_devices / compare_devices จำลอง: ลูกค้าใช้ iPhone 12 → แนะนำ 13/14 128GB มือสอง (นโยบายเทิร์น ≥12)
// (ตัวเลขดาวน์/ผ่อนต้องอยู่ใน GROUNDED ด้านล่าง; สเปคประโยคเลียน compareDevices ของจริง)
const TRADE_IN_NOTE = 'ราคาประมาณ ประเมินจริงหน้าร้าน สภาพมีผลต่อราคา';
const TRADE_IN_11 = { model: 'iPhone 12', estimateThb: 3500, note: TRADE_IN_NOTE };
// E22: ขาย/เทิร์น iPhone 16 128GB — ราคารับซื้อเกรด A (เลขของ fixture)
const TRADE_IN_16 = { model: 'iPhone 16', estimateThb: 15500, note: TRADE_IN_NOTE };
const BETTER_11_TO_13 = ['ชิป A14 → A15 เร็วขึ้นอีกนิด', 'แบตนานขึ้น ~2 ชม.', 'อัปเดต iOS ได้อีกหลายปี'];
const BETTER_11_TO_14 = ['ชิป A14 → A15 เร็วขึ้นอีกนิด', 'แบตนานขึ้น ~3 ชม.', 'อัปเดต iOS ได้อีกหลายปี'];
const RECOMMEND_CARDS = [
  {
    brand: 'Apple', model: 'iPhone 13', storage: '128GB', hasWarranty: false, condition: 'มือสอง',
    rateLabel: 'เรทที่ 2', downPayment: 2500, monthlyPrice: 1758, termMonths: 12,
    inStock: true, unitCount: 1,
    sampleUnit: { productId: 'p13', batteryHealth: 89, color: 'ดำ', photoUrl: null },
    betterThanCurrent: BETTER_11_TO_13, worseThanCurrent: [] as string[], generationGap: 1,
  },
  {
    brand: 'Apple', model: 'iPhone 14', storage: '128GB', hasWarranty: false, condition: 'มือสอง',
    rateLabel: 'เรทที่ 2', downPayment: 3000, monthlyPrice: 1980, termMonths: 12,
    inStock: true, unitCount: 1,
    sampleUnit: { productId: 'p14', batteryHealth: 90, color: 'ฟ้า', photoUrl: null },
    betterThanCurrent: BETTER_11_TO_14, worseThanCurrent: [] as string[], generationGap: 2,
  },
];
const RECOMMEND_HIGHLIGHTS: Record<string, string[]> = {
  'iPhone 13': ['ชิป A15 แรงเกินพอ', 'แบตอึดกว่า 12 ชัดเจน', 'กล้องคู่มีโหมดภาพยนตร์'],
  'iPhone 14': ['กล้องหน้าโฟกัสอัตโนมัติ', 'ระบบตรวจจับอุบัติเหตุ', 'ชิป A15 ลื่นทุกแอป'],
};
const COMPARE_11_TO_15 = {
  current: { model: 'iPhone 12', recognized: true },
  candidate: { model: 'iPhone 15', recognized: true },
  better: ['กล้องหลัก 12MP → 48MP คมชัดขึ้นมาก', 'ชิป A14 → A16 เร็วขึ้นชัดเจน', 'แบตนานขึ้น ~3 ชม.', 'อัปเดต iOS ได้ยาว ๆ อีกหลายปี'],
  same: ['กล้องหลัง 2 ตัวเท่าเดิม', 'จอขนาด 6.1" เท่าเดิม'],
  worse: [] as string[],
  generationGap: 3,
  tradeIn: TRADE_IN_11,
};
const CANDIDATE_15_HIGHLIGHTS = ['กล้องหลัก 48MP', 'Dynamic Island', 'USB-C'];

/** เลขงบจากโมเดล ("3,000 บาท" / "3 พัน" / "5k") — เหมือน SalesBotService.runTool */
function optBudget(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const raw = String(v).replace(/,/g, '').trim().toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*(หมื่น|พัน|k)?/.exec(raw);
  if (!m) return undefined;
  const mult = m[2] === 'หมื่น' ? 10_000 : m[2] === 'พัน' || m[2] === 'k' ? 1_000 : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function runRecommend(input: Record<string, unknown>, mode: StockMode): unknown {
  const cur = String(input.currentModel ?? '').trim();
  // ตัดความจุก่อนจับเลขรุ่น เหมือน runCompare — "Samsung A54 128GB" ไม่ใช่ iPhone 12
  const recognized = /12/.test(stripStorageToken(cur));
  const current = cur ? { model: recognized ? 'iPhone 12' : cur, recognized } : null;
  const down = optBudget(input.downBudget);
  const monthly = optBudget(input.monthlyBudget);
  const base = { current, budget: { down: down ?? null, monthly: monthly ?? null }, tradeIn: recognized ? TRADE_IN_11 : null };
  let result: Record<string, unknown>;
  if (down === undefined && monthly === undefined) {
    result = { ...base, recommended: [], nearMiss: [], reason: 'ยังไม่ทราบงบดาวน์/งวดต่อเดือน — ถามลูกค้าก่อนแล้วค่อยเรียกใหม่' };
  } else {
    const cards = RECOMMEND_CARDS.map((d) => ({
      ...d,
      betterThanCurrent: recognized ? d.betterThanCurrent : [],
      worseThanCurrent: recognized ? d.worseThanCurrent : [],
      generationGap: recognized ? d.generationGap : null,
      highlights: RECOMMEND_HIGHLIGHTS[d.model] ?? [],
    }));
    const overBy = (d: (typeof cards)[number]) => ({
      down: down === undefined ? 0 : Math.max(0, d.downPayment - down),
      monthly: monthly === undefined ? 0 : Math.max(0, d.monthlyPrice - monthly),
    });
    const fits = cards.filter((d) => overBy(d).down === 0 && overBy(d).monthly === 0);
    const misses = cards.filter((d) => !fits.includes(d));
    // ใกล้งบที่สุด ≤1 เมื่อแนะนำได้ไม่ครบ 2 (P23: ดาวน์เกินงบ → persona เติมบรรทัดโปรฟรีดาวน์)
    const closest = [...misses].sort((a, b) => overBy(a).down + overBy(a).monthly - (overBy(b).down + overBy(b).monthly))[0];
    const nearMiss = fits.length < 2 && closest ? [{ ...closest, overBy: overBy(closest) }] : [];
    result = { ...base, recommended: fits, nearMiss };
    if (fits.length === 0) result.reason = recognized ? 'ไม่มีรุ่นที่ใหม่กว่า iPhone 12 ในงบนี้' : 'ไม่มีรุ่นที่เข้างบนี้';
  }
  // เหมือน SalesBotService.runTool: โหมดไม่มีสต๊อกตัด inStock/unitCount/sampleUnit + แนบ stockNote (รีวิว TOOLLOOP-4)
  return mode === 'NO_STOCK' ? stripRecommendStockFields(result) : result;
}

function runCompare(input: Record<string, unknown>): unknown {
  const cur = String(input.currentModel ?? '');
  const cand = String(input.candidateModel ?? '');
  // ตัดความจุออกก่อนจับเลขรุ่นเสมอ — "iPhone 16 128GB" มี "12" อยู่ใน "128GB"
  // ⇒ ของเดิมเข้าสาขา iPhone 12 แล้วคืนราคาเทิร์น 3,500 ให้เครื่อง 16 (E22 ตกเพราะ fixture ไม่ใช่เพราะบอท)
  const curModel = stripStorageToken(cur);
  const candModel = stripStorageToken(cand);
  if (/12/.test(curModel)) return { ...COMPARE_11_TO_15, candidateHighlights: CANDIDATE_15_HIGHLIGHTS };
  // E22: ขาย/เทิร์น iPhone 16 — ใช้แค่ tradeIn (รุ่นเดียวกัน/ไม่มีสเปคให้เทียบ = ห้ามพูดสเปค)
  if (/16/.test(curModel) && !/(samsung|ซัมซุง|oppo|vivo|xiaomi)/i.test(curModel)) {
    return {
      current: { model: 'iPhone 16', recognized: true },
      candidate: { model: cand || 'iPhone 16', recognized: /16/.test(candModel) },
      candidateHighlights: [],
      better: [],
      same: [],
      worse: [],
      generationGap: /16/.test(candModel) ? 0 : null,
      tradeIn: TRADE_IN_16,
    };
  }
  return { ...COMPARE_11_TO_15, current: { model: cur, recognized: false }, candidateHighlights: CANDIDATE_15_HIGHLIGHTS, better: [], same: [], worse: [], generationGap: null, tradeIn: null };
}

function groupsOf(units: FixtureUnit[]) {
  const byKey = new Map<string, FixtureUnit[]>();
  for (const u of units) {
    // ของจริงแยกกลุ่มตาม รุ่น|ความจุ|สภาพ|deviceOrigin — เครื่องไทยกับเครื่องนอกไม่อยู่กลุ่มเดียวกัน
    const key = `${u.model}|${u.storage}|${u.deviceOrigin}`;
    byKey.set(key, [...(byKey.get(key) ?? []), u]);
  }
  return [...byKey.values()].map((us) => ({
    deviceOrigin: us[0].deviceOrigin,
    brand: 'Apple', model: us[0].model, storage: us[0].storage, condition: us[0].condition,
    unitCount: us.length,
    minPrice: Math.min(...us.map((x) => x.priceThb)),
    maxPrice: Math.max(...us.map((x) => x.priceThb)),
    reservedCount: 0, priceMissingCount: 0,
    units: us.map((x) => ({ ...x, reserved: false, photoAvailable: true })),
  }));
}

function runSearchProducts(input: Record<string, unknown>) {
  const q = String(input.query ?? '').toLowerCase();
  const origin = String(input.deviceOrigin ?? '');
  // search_products ปัจจุบันกรอง deviceOrigin ตรงตัว (THAI ยังไม่รวมเครื่องที่ไม่ติดป้าย — synth C10 ยังไม่ทำ)
  const pick = (us: FixtureUnit[]) => us.filter((u) => origin !== 'THAI' && origin !== 'IMPORTED' ? true : u.deviceOrigin === origin);
  const result = (model: string | null, us: FixtureUnit[]) => {
    const picked = pick(us);
    return { query: { brand: model ? 'Apple' : null, model: model ?? input.query, storage: null, color: null }, totalMatches: picked.length, priceMissingCount: 0, groups: groupsOf(picked) };
  };
  if (q.includes('plus') || q.includes('pro')) return result(String(input.query ?? ''), []);
  if (q.includes('14')) return result('iPhone 14', [UNITS.p14]);
  if (q.includes('16')) return result('iPhone 16', [UNITS.p16th, UNITS.p16th2, UNITS.p16imp]);
  if (q.includes('15')) return result('iPhone 15', [UNITS.p15b, UNITS.p15a]);
  // ค้นกว้าง: คืนแคตตาล็อกย่อ
  return result(null, [UNITS.p15b, UNITS.p15a, UNITS.p14]);
}

// ───────────────────────── คลังความรู้ (search_knowledge_base) ─────────────────────────
// แถวที่ฉากต้องใช้ — ค่าหลัง apply-bot-tune-2026-09-22 (K1-K4: ข้อความ/คีย์เวิร์ด/priority ชุดเดียวกับ SQL ใน scripts/ops)
// จัดอันดับด้วย scoreKbEntries ตัวจริง (เดิมจับด้วย keyword เองแบบ includes) · คลังเต็มใช้ EVAL_KB_FILE (นอก repo)
// intent = ค่าจริงบน prod (ผลค้นคืน intent ไม่คืน id — forbidKbHits/ด่าน EVAL_DRY เทียบด้วย intent)
interface KbRow {
  id: string;
  intent?: string;
  category: string;
  priority: number;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
  responseType?: string;
  channel?: string | null;
  active?: boolean;
  deletedAt?: string | null;
}
const KB_FIXTURE: KbRow[] = [
  // K1 — แถวแรก (synth C05) · ลิงก์แผนที่คงไว้ตามจริง (ด่านตัวเลขของ eval ตัด URL ออกก่อนแล้ว)
  {
    id: 'faq:no-delivery-pickup-only', intent: 'faq_no_delivery_pickup_only', category: 'FAQ', priority: 90,
    triggerKeywords: ['จัดส่ง', 'ส่งของ', 'ส่งได้ไหม', 'ส่งต่างจังหวัด', 'เก็บปลายทาง', 'ปลายทาง', 'ems', 'ไปรษณีย์', 'kerry', 'flash', 'มารับ', 'รับเครื่อง', 'รับของ', 'ทำสัญญาออนไลน์', 'ทำออนไลน์', 'ทำเรื่องออนไลน์', 'แบบออนไลน์', 'ต่างจังหวัด', 'ต่างอำเภอ', 'อยู่ไกล', 'ส่งถึงบ้าน', 'ส่งเครื่องให้', 'ค่าส่ง', 'นอกสถานที่', 'มาร้านไม่ได้'],
    exampleQuestions: ['ส่งของได้ไหม', 'เก็บเงินปลายทางได้ไหม', 'ส่งต่างจังหวัดไหม', 'ต้องไปรับที่ร้านไหม', 'อยู่ต่างจังหวัดทำได้ไหม', 'ทำสัญญาออนไลน์ได้ไหม'],
    responseTemplate: 'เครื่องไทยต้องเข้ามารับเครื่องที่ร้านลพบุรีค่ะ\nส่วนโปรฟรีดาวน์เครื่องนอก ทำสัญญาออนไลน์ได้ค่ะ\n\nร้านอยู่เส้นหลัง บขส สระแก้วลพบุรี ตรงข้ามชาบูแม็คซิโกค่ะ\nแผนที่ 🗺️ https://maps.app.goo.gl/bqGcmr5FupWLw1378\nเปิดทุกวัน 10 โมงเช้าถึง 1 ทุ่มค่ะ\n\nรับเครื่องที่ร้านได้เช็คสภาพเครื่องต่อหน้าก่อนรับเลยนะคะ',
  },
  // K2 — โปรฟรีดาวน์เครื่องนอก (ตัวเลขคงเดิม: 15PM 3,401 · 16PM 4,061 · ไม่มี 15 Plus จนกว่าเจ้าของตอบ O01)
  {
    id: 'promo:imported-free-down', intent: 'promo_imported_free_down', category: 'PROMO', priority: 100,
    triggerKeywords: ['เครื่องนอก', 'ฟรีดาวน์', 'ฟรีดาว', 'ฟรี ดาวน์', 'ไม่ต้องดาวน์', 'ไม่มีดาวน์', 'ไม่วางดาวน์', 'โปรเครื่องนอก', 'ฟรีดาวน์จริง', 'ดาวน์ 0', 'ดาวน์0', 'ไม่ต้องใช้เงินดาวน์', 'ไม่ต้องวางดาวน์', 'ไม่ต้องจ่ายดาวน์', 'ดาวน์ฟรี'],
    exampleQuestions: ['เครื่องนอกผ่อนเดือนละเท่าไหร่', 'มีโปรฟรีดาวน์ไหม', 'ฟรีดาวน์มีรุ่นไหนบ้าง', 'ฟรีดาวน์จริงไหม', 'โปรฟรีดาวน์ยังมีอยู่ไหม', 'ฟรีดาวน์วันรับเครื่องต้องจ่ายอะไรไหม'],
    responseTemplate: [
      'โปรฟรีดาวน์ iPhone มือสอง เครื่องนอก (ของแท้ Apple โมเดลต่างประเทศ ประกันร้าน 30 วัน)',
      'iPhone 13 128GB ผ่อนเดือนละ 1,758 บาท 12 งวด',
      'iPhone 14 128GB ผ่อนเดือนละ 1,885 บาท 12 งวด',
      'iPhone 15 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด',
      'iPhone 16 128GB ผ่อนเดือนละ 2,631 บาท 12 งวด',
      'iPhone 13 Pro 128GB ผ่อนเดือนละ 2,140 บาท 12 งวด',
      'iPhone 14 Pro 128GB ผ่อนเดือนละ 2,650 บาท 12 งวด',
      'iPhone 15 Pro 128GB ผ่อนเดือนละ 3,288 บาท 12 งวด',
      'iPhone 16 Pro 128GB ผ่อนเดือนละ 3,291 บาท 12 งวด',
      'iPhone 13 Pro Max 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด',
      'iPhone 14 Pro Max 128GB ผ่อนเดือนละ 3,033 บาท 12 งวด',
      'iPhone 15 Pro Max 256GB ผ่อนเดือนละ 3,401 บาท 15 งวด',
      'iPhone 16 Pro Max 256GB ผ่อนเดือนละ 4,061 บาท 15 งวด',
      'ทุกรุ่นฟรีดาวน์ ใช้บัตรประชาชนใบเดียว · แถมเคสกับฟิล์มทุกเครื่องในโปร · รุ่น/ความจุนอกรายการนี้ไม่มีในโปร',
      // ถ้อยคำวันรับเครื่อง = ฉบับที่เจ้าของเคาะแล้ว (ตรงกับ kb_changes.json ของรอบนี้ — ของเดิม
      // "ไม่ต้องวางเงินดาวน์ / ค่างวดเริ่มจ่ายงวดแรกตามวันที่ในสัญญา" ถูกแทนที่แล้ว)
      'ฟรีดาวน์ = วันรับเครื่องไม่ต้องจ่ายเงิน ค่างวดยังผ่อนครบตามจำนวนงวด · งวดแรกจ่ายเดือนถัดไป วันเดียวกับวันที่ทำสัญญา · ค่าใช้จ่ายอื่นตามเงื่อนไข ทีมงานเปิดให้ดูครบก่อนเซ็น',
      'โปรนี้ใช้ต่อเนื่องจนกว่าร้านจะแจ้งเปลี่ยน',
      'ผู้สมัครอายุ 18-59 ปี ไม่เช็คบูโร · อยู่ต่างจังหวัดทำสัญญาออนไลน์ได้ (เฉพาะโปรนี้)',
      'ขอคืนได้ก่อนชำระงวดแรก แต่ต้องจ่ายงวดแรก 1 งวด เครื่องต้องสภาพเดิม ครบกล่องอุปกรณ์ ออก iCloud แล้ว',
    ].join('\n'),
  },
  // K3
  {
    id: 'faq:imported-device', intent: 'imported_device_info', category: 'POLICY', priority: 100,
    triggerKeywords: ['เครื่องนอก', 'eSIM', 'อีซิม', 'ใส่ซิม', 'ซิมไทย', 'ซิมอะไร', 'ซิมคู่', '2 ซิม', 'ค่ายไหน', 'ชัตเตอร์', 'โมเดลต่างประเทศ', 'เครื่องนอกโมเดล', 'รหัสรุ่น', 'LL', 'ZP', 'J/A', 'KH/A', 'CH/A', 'โมเดลจีน', 'เครื่องหิ้ว'],
    exampleQuestions: ['เครื่องนอกคืออะไร', 'เครื่องนอกใส่ซิมไทยได้ไหม', 'เครื่องนอกใช้ซิมอะไรได้', 'เครื่องนอกโมเดลประเทศอะไร'],
    responseTemplate: 'เครื่องนอกคือ iPhone แท้ของ Apple โมเดลต่างประเทศค่ะ ไม่ติด iCloud\nคละประเทศตามล็อตที่เข้า · ร้านไม่นำเข้าโมเดลจีน\nเช็ครหัสรุ่นในเครื่องได้ที่ ตั้งค่า > ทั่วไป > เกี่ยวกับ\nบางโมเดลมีข้อจำกัด: โมเดลอเมริการุ่น 14 ขึ้นไปใช้ eSIM อย่างเดียว · โมเดลญี่ปุ่น/เกาหลีปิดเสียงชัตเตอร์ไม่ได้ · โมเดลฮ่องกง/สิงคโปร์ต้องเช็คชนิดซิมของเครื่องจริง\nทีมงานเปิดรหัสรุ่นให้ดู และลองโทรออกกับเปิดเน็ตกับเครื่องจริงก่อนส่งมอบค่ะ',
  },
  // K4.5 — คีย์เวิร์ดใหม่ (ถอด 'ปิด' เดี่ยว) · ข้อความคงเดิม
  {
    id: 'extracted:store_location_hours', category: 'EXTRACTED', priority: 95,
    triggerKeywords: ['ที่ไหน', 'ที่อยู่', 'อยุ่', 'แถว', 'เปิด', 'กี่โมง', 'ร้านอยู่', 'บขส', 'แผนที่', 'พิกัด', 'ทางไป', 'ไปยังไง', 'ร้านปิด', 'ปิดกี่', 'ปิดยัง', 'ปิดหรือยัง', 'ที่ตั้ง', 'โลเคชั่น', 'โลเคชัน', 'วันหยุด', 'โมงเย็น', 'ทุ่ม', 'เข้าไปดู', 'เข้าไปได้', 'ไปถึง', 'เข้าร้าน', 'เบอร์ร้าน', 'หาร้าน', 'หาไม่เจอ'],
    exampleQuestions: ['ร้านอยู่ที่ไหน', 'เปิดกี่โมง', 'เป็นที่ไหนของลพบุรี', 'ขอโลเคชั่นร้านหน่อย', 'วันนี้เข้าไปได้ไหม', 'ขอเบอร์ร้านหน่อย'],
    responseTemplate: 'ร้านอยู่เส้นหลัง บขส สระแก้วลพบุรีค่ะ\nที่เดียวกับร้านประกัน ตรงข้ามชาบูแม็คซิโกเลยค่า\n\nแผนที่ 🗺️ https://maps.app.goo.gl/bqGcmr5FupWLw1378\nเปิดทุกวัน 10 โมงเช้าถึง 1 ทุ่มค่ะ',
  },
  // K4.4
  {
    id: 'faq:no-payslip-freelance', category: 'POLICY', priority: 100,
    triggerKeywords: ['สลิป', 'สลิปเงินเดือน', 'ฟรีแลนซ์', 'แม่ค้า', 'พ่อค้า', 'ขายของออนไลน์', 'รับจ้าง', 'อาชีพอิสระ', 'ไม่มีเงินเดือน', 'รายได้ประจำ', 'ทำงานอิสระ', 'เงินเดือนเงินสด', 'เงินเดือนเป็นเงินสด', 'รับเงินสดอย่างเดียว', 'ไม่ผ่านบัญชี', 'ไม่ได้ผ่านบัญชี', 'บัตรพนักงาน', 'ค้าขาย', 'ธุรกิจส่วนตัว', 'ค่าคอม'],
    exampleQuestions: [],
    responseTemplate: 'ไม่ต้องมีสลิป ไม่ต้องมีบัตรเครดิตค่ะ 😊\nฟรีแลนซ์ แม่ค้าออนไลน์ รับจ้าง ยื่นผ่อนได้ค่ะ\nมีเงินเข้าบัญชี → สเตทเม้นท์ 3 เดือน (เรทที่ 1)\nไม่มี → รูปตอนทำงาน (เรทที่ 2)',
  },
  // K4.3 — ถอดคีย์เวิร์ด '17'/'18'/'19' เดี่ยว (ชน iPhone 18 / ราคา)
  {
    id: 'faq:age-requirement', category: 'POLICY', priority: 100,
    triggerKeywords: ['อายุ', 'อายุเท่าไหร่', 'ต้องอายุ', 'เด็ก', 'นักเรียน', 'นักศึกษา', 'ผู้ปกครอง', 'ค้ำ', 'คนค้ำ', 'ผู้ค้ำ'],
    exampleQuestions: ['นักศึกษาผ่อน', 'ต้องอายุเท่าไหร่', 'ต้องมีคนค้ำ'],
    responseTemplate: 'อายุ 18 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ\nต่ำกว่า 18 ยังทำสัญญาไม่ได้นะคะ\nนักศึกษา มีผู้ปกครองค้ำให้ค่า',
  },
  {
    id: 'faq:device-lock', category: 'POLICY', priority: 100,
    triggerKeywords: ['ล็อกเครื่อง', 'โดนล็อก', 'ล็อคเครื่อง', 'ล็อกไหม', 'ล็อคไหม', 'ระบบล็อก', 'MDM', 'ล็อกเครื่องคืออะไร', 'ถูกล็อก', 'เครื่องล็อก'],
    exampleQuestions: [],
    responseTemplate: 'ระหว่างผ่อนเครื่องมีระบบดูแลของร้านค่ะ บอกตรง ๆ นะคะ\nจ่ายตรงตามนัด → ใช้งานปกติทุกอย่าง\nล็อกเฉพาะค้างชำระแล้วติดต่อไม่ได้ จ่ายครบปลดให้ทันที\nผ่อนครบ เครื่องเป็นของพี่เต็มตัวค่ะ 😊',
  },
  {
    id: 'faq:late-fee', category: 'POLICY', priority: 100,
    triggerKeywords: ['จ่ายช้า', 'ผิดนัด', 'ค้างชำระ', 'ค่าปรับ', 'ลืมจ่าย', 'เลยกำหนด', 'จ่ายไม่ทัน', 'จ่ายไม่ตรง', 'เลยวัน', 'ช้าได้ไหม', 'เลื่อนจ่าย', 'เลื่อนวัน'],
    exampleQuestions: [],
    responseTemplate: 'เลยกำหนดมีค่าปรับต่องวดแบบเหมาค่ะ\nเลย 1-2 วัน 50 บาท · วันที่ 3 ขึ้นไป 100 บาท (ไม่คิดรายวัน)\nค้างนานแล้วติดต่อไม่ได้ เครื่องอาจถูกล็อกจนกว่าจะชำระ\n---\nจ่ายไม่ทันจริง ๆ ทักมาเลื่อนนัดก่อนถึงวันได้เลย ทีมช่วยดูให้ค่ะ\nค่างวดไม่เกิน 1 ใน 3 ของรายได้ต่อเดือนจะผ่อนสบายสุดนะคะ 😊',
  },
  {
    id: 'faq:early-payoff', category: 'POLICY', priority: 100,
    triggerKeywords: ['ปิดยอด', 'ปิดก่อน', 'โปะ', 'จ่ายหมดก่อน', 'ปิดบัญชี', 'ปิดสัญญา', 'จ่ายครบก่อน', 'ปิดยอดก่อนกำหนด'],
    exampleQuestions: [],
    responseTemplate: 'ปิดยอดก่อนกำหนดได้ทุกเมื่อค่ะ ไม่มีค่าปรับ 😊\nแถมมีส่วนลดให้สำหรับงวดที่ยังไม่ถึงกำหนดด้วยค่ะ\n\nยอดปิดจริงทีมการเงินคำนวณแจ้งให้ตอนขอปิดนะคะ',
  },
  {
    id: 'faq:payment-channel-reminder', category: 'POLICY', priority: 100,
    triggerKeywords: ['จ่ายค่างวด', 'จ่ายยังไง', 'ชำระยังไง', 'ช่องทาง', 'โอนค่างวด', 'แจ้งเตือน', 'เตือน', 'ตัดบัตร', 'หักบัญชี', 'อัตโนมัติ', 'จ่ายที่ไหน', 'ชำระที่ไหน'],
    exampleQuestions: [],
    responseTemplate: 'ค่างวดจ่ายได้ 3 ทางค่ะ\nไลน์การเงินของร้าน (พิมพ์ "ชำระ" รับ QR) · โอนเข้าบัญชีร้าน · จ่ายที่ร้าน\nมีแจ้งเตือนทางไลน์ก่อนถึงวันจ่าย 3 วัน และ 1 วัน กันลืมค่ะ 🔔\n---\nไม่มีระบบตัดบัตรอัตโนมัตินะคะ กดจ่ายเองทุกงวด\nช่องทางทั้งหมดทีมแนะนำให้วันรับเครื่องค่ะ',
  },
  // K4.2 — แถวใหม่
  {
    id: 'faq:credit-history', category: 'POLICY', priority: 90,
    triggerKeywords: ['บูโร', 'ติดบูโร', 'ติดบู', 'แบล็ค', 'แบล็ก', 'แบล๊ค', 'blacklist', 'ติดเครดิต', 'เครดิตไม่ดี', 'เครดิตให้', 'เครดิตก่อน', 'ประวัติไม่ดี', 'เคยค้าง', 'หนี้เสีย', 'เคยไม่ผ่าน', 'ยื่นไม่ผ่าน', 'กลัวไม่ผ่าน', 'ไม่อนุมัติ', 'เคยยื่น'],
    exampleQuestions: ['เคยติดแบล็คลิสต์', 'ติดบูโรอยู่', 'ขอเช็คเครดิตก่อน', 'เคยยื่นที่อื่นไม่ผ่าน', 'เช็คเครดิตไหม', 'เช็คบูโรไหม'],
    responseTemplate: 'ไม่เช็คบูโรค่ะ แต่ทุกเคสต้องพิจารณาก่อนนะคะ\nส่งให้ทีมงานเช็คเบื้องต้นให้ก่อนได้นะคะ',
  },
  // K4.1 — "5 นาที" ยังอยู่ในแถว (รอเจ้าของ O14) ⇒ ฉากนอกเวลาทำการ (NS8/E17) วัดว่าบอทไม่ลอกไปพูด
  {
    id: 'extracted:approval_process', category: 'EXTRACTED', priority: 60,
    triggerKeywords: ['อนุมัติ', 'อนุมัติไว', 'รู้ผล', 'รอผล', 'รอนาน', 'กี่นาที', 'อายุงาน'],
    exampleQuestions: ['อนุมัติเร็วไหม', 'รู้ผลกี่นาที'],
    responseTemplate: 'ไม่ต้องมีบัตรเครดิต ไม่เช็คบูโรค่ะ 😊\nส่งเอกสารตามเรทที่เลือกในแชทนี้ได้เลย\nทีมงานเช็คให้ในเวลาทำการ 10:00-19:00\nรู้ผลไวใน 5 นาทีค่ะ',
  },
  // คลังสเปค (คีย์เวิร์ดตาม scripts/ops/seed-device-specs-kb.sql) — ให้เทิร์นเทียบรุ่นมีสเปคอ้างอิงเหมือน prod
  {
    id: 'spec:iphone-15', intent: 'spec_iphone_15', category: 'SPEC', priority: 40,
    triggerKeywords: ['สเปค', 'iPhone 15', '15', 'ต่างกัน', 'ดียังไง', 'USB-C'],
    exampleQuestions: ['iPhone 15 สเปคเป็นไง', '15 ดีกว่า 14 ยังไง'],
    responseTemplate: 'iPhone 15 — กล้องหลัก 48MP คมขึ้นชัดเจน · สาย USB-C · Dynamic Island',
  },
  {
    id: 'spec:iphone-16', intent: 'spec_iphone_16', category: 'SPEC', priority: 40,
    triggerKeywords: ['สเปค', 'iPhone 16', '16', 'ต่างกัน', 'ดียังไง', 'ปุ่มกล้อง'],
    exampleQuestions: ['iPhone 16 สเปคเป็นไง', '16 กับ 15 ต่างกันยังไง'],
    responseTemplate: 'iPhone 16 — ชิปรุ่นใหม่รองรับ AI ยาว ๆ · ปุ่มชัตเตอร์กล้อง · แบตอึดขึ้นจาก 15',
  },
];

/** intent ของแถว (ไม่ระบุ = id ตัด prefix แล้วแทน - ด้วย _ เช่น faq:age-requirement → age_requirement) — ผลค้นของจริงคืน intent ไม่คืน id */
function kbIntentOf(row: Pick<KbRow, 'id' | 'intent'>): string {
  return row.intent ?? row.id.replace(/^[a-z]+:/, '').replace(/-/g, '_');
}
const SALES_BOT_KB_CHANNELS = new Set(['LINE_SHOP', 'FACEBOOK', 'WEB']);

interface KbPatch {
  id: string;
  insert?: boolean;
  category?: string;
  new_priority?: number;
  new_triggers?: string[];
  new_examples?: string[];
  new_template?: string;
}

function loadKb(): { entries: KbScorableEntry[]; source: string; rowCount: number } {
  let rows: KbRow[] = KB_FIXTURE;
  let source = `fixture ${KB_FIXTURE.length} แถว`;
  const file = process.env.EVAL_KB_FILE;
  if (file) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error(`EVAL_KB_FILE ต้องเป็น JSON array: ${file}`);
    rows = (parsed as KbRow[]).filter((r) => r && typeof r.id === 'string');
    source = `EVAL_KB_FILE ${rows.length} แถว`;
  }
  const patchFile = process.env.EVAL_KB_PATCH_FILE;
  if (patchFile) {
    const patches = JSON.parse(readFileSync(patchFile, 'utf8')) as KbPatch[];
    const byId = new Map(rows.map((r) => [r.id, { ...r }]));
    for (const p of patches) {
      const cur = byId.get(p.id) ?? (p.insert ? { id: p.id, category: p.category ?? 'POLICY', priority: 0, triggerKeywords: [], exampleQuestions: [], responseTemplate: '' } : undefined);
      if (!cur) continue;
      if (p.new_priority !== undefined) cur.priority = p.new_priority;
      if (p.new_triggers) cur.triggerKeywords = p.new_triggers;
      if (p.new_examples) cur.exampleQuestions = p.new_examples;
      if (p.new_template !== undefined) cur.responseTemplate = p.new_template;
      byId.set(p.id, cur);
    }
    rows = [...byId.values()];
    source += ` + patch ${patches.length} รายการ`;
  }
  const usable = rows.filter(
    (r) =>
      r.active !== false && !r.deletedAt && typeof r.responseTemplate === 'string' && r.responseTemplate.trim() &&
      (!r.channel || SALES_BOT_KB_CHANNELS.has(r.channel)),
  );
  // prod: findMany orderBy priority desc แล้วค่อยจัดอันดับ (คะแนนเท่ากัน = priority สูงก่อน)
  const entries = [...usable]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map((r) => ({
      intent: kbIntentOf(r),
      category: r.category ?? 'POLICY',
      responseTemplate: r.responseTemplate,
      responseType: r.responseType ?? 'info',
      triggerKeywords: r.triggerKeywords ?? [],
      exampleQuestions: r.exampleQuestions ?? [],
      priority: r.priority ?? 0,
    }));
  if (usable.length < rows.length) source += ` (ใช้ได้ ${usable.length} — แถวที่ไม่มี responseTemplate/ปิดใช้/ช่องทางอื่นถูกตัด)`;
  return { entries, source, rowCount: usable.length };
}
const KB = loadKb();

function runKb(input: Record<string, unknown>): { matches: KbMatch[] } {
  const query = String(input.query ?? '').trim();
  if (!query) return { matches: [] };
  return { matches: scoreKbEntries(query, KB.entries) };
}

// ───────────────────────── send_rate_card: เครื่องมือตัวจริง + ค่าตั้งจำลอง ─────────────────────────
function makeRateCardTool(cards: RateCardsConfig): SendRateCardTool {
  const runtime = { getRateCards: async () => cards } as unknown as BotRuntimeConfigService;
  // ลิงก์ลงนามปลอม (https) — collectAttachmentsFromToolResult รับเฉพาะ https เหมือน prod
  const storage = { getSignedDownloadUrl: async (key: string) => `https://eval.invalid/${key}` } as unknown as StorageService;
  return new SendRateCardTool(runtime, storage);
}
const RATE_CARD_TOOL = makeRateCardTool(RATE_CARDS);

// = CaptureLeadTool.handoffMessage (รวมประโยคแจ้งสิทธิ์ข้อมูลส่วนบุคคล)
const CAPTURE_LEAD_HANDOFF =
  'ทีมงานจะเช็คเอกสารแล้วติดต่อกลับไปนะคะ 🙏 ยังไม่ต้องโอนอะไรทั้งนั้น แวะมาดูเครื่องที่ร้านก่อนได้เลยค่ะ ข้อมูลชื่อ-เบอร์จะใช้ติดต่อเรื่องคำสั่งซื้อนี้เท่านั้นนะคะ';

/**
 * cardTool = เครื่องมือส่งรูปที่จะใช้ (default = ชุดรูปที่ตั้งผ่าน EVAL_RATE_CARDS/ค่า prod)
 * ด่านทดสอบตัวเองใน EVAL_DRY ส่งตัวที่ผูกชุดรูป prod มาเอง — ไม่งั้น EVAL_RATE_CARDS='{}' ทำให้ด่านที่ใช้รูปตกทั้งที่ไม่มีอะไรพัง
 */
async function runFixtureTool(name: string, input: Record<string, unknown>, mode: StockMode, cardTool: SendRateCardTool = RATE_CARD_TOOL): Promise<unknown> {
  // เหมือน SalesBotService.runTool: โหมดไม่มีสต๊อก เครื่องมือสต๊อกคืนข้อความบอกโหมด
  if (mode === 'NO_STOCK' && (name === 'search_products' || name === 'calculate_installment')) return NO_STOCK_TOOL_RESULT;
  switch (name) {
    case 'search_products':
      return runSearchProducts(input);
    case 'get_installment_rates':
      return runRates(input);
    case 'calculate_installment': {
      const pid = String(input.productId ?? '');
      const c = CALC[pid];
      if (!c) return { error: 'product_not_found' };
      const u = UNITS[pid];
      // prod คืน gallery[0] ของสินค้า (CalculateInstallmentTool) ⇒ fixture คืนรูปของเครื่องนั้นเหมือนกัน
      return { productId: pid, productName: `${u.model} ${u.storage} มือสอง เกรด ${u.grade}`, ...c, totalPaidThb: c.downAmountThb + c.monthlyThb * c.termMonths, photoUrl: u.photoUrl ?? null, webUrl: u.webUrl ?? null };
    }
    case 'list_promotions':
      return { promotions: [] };
    case 'search_knowledge_base':
      return runKb(input);
    case 'recommend_devices':
      return runRecommend(input, mode);
    case 'compare_devices':
      return runCompare(input);
    case 'capture_lead':
      return { customerId: 'eval-c1', promptPayQr: null, downAmount: Number(input.downAmount ?? 0), handoffMessage: CAPTURE_LEAD_HANDOFF };
    case 'handoff_to_human':
      return { handoffAccepted: true };
    case 'send_rate_card':
      return cardTool.run({ cards: input.cards });
    case 'notify_staff':
      return { staffNotified: true };
    default:
      return { error: 'unknown_tool' };
  }
}

// ───────────────────────── เลขที่ "มีที่มา" ─────────────────────────
const URL_RE = /https?:\/\/\S+/g;
/** ตัวเลข ≥ min ในข้อความ (ตัด URL / ความจุ 128GB ออกก่อน — ไม่ใช่ราคา) */
function moneyNumbers(text: string, min: number): number[] {
  const scrubbed = text.replace(URL_RE, ' ').replace(/\d+\s*(?:GB|TB|gb|tb)/g, 'ความจุSPEC');
  return [...scrubbed.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => Number.isFinite(n) && n >= min);
}
// เลียนแบบ GroundingGuard: เลข >=500 ในคำตอบต้องอยู่ในชุดนี้ (±5%) — สร้างจาก fixture ทุกตัว (ยกเว้นเครื่องนอก p16imp)
const GROUNDED: number[] = [
  ...new Set<number>([
    ...Object.values(UNITS).filter((u) => !UNGROUNDED_UNITS.has(u.id)).map((u) => u.priceThb),
    ...Object.entries(CALC)
      .filter(([id]) => !UNGROUNDED_UNITS.has(id))
      .flatMap(([, c]) => [c.downAmountThb, c.monthlyThb, c.downAmountThb + c.monthlyThb * c.termMonths]),
    ...RATE_TABLE.flatMap((r) => [r.rate1[0], r.rate1[1], r.rate2[0], r.rate2[1]]),
    ...RECOMMEND_CARDS.flatMap((d) => [d.downPayment, d.monthlyPrice]),
    TRADE_IN_11.estimateThb,
    TRADE_IN_16.estimateThb,
    // S30: ดาวน์เกินงบ (งบ 1,000 → เกิน 1,500 ของ iPhone 13)
    1500,
    // เลขในข้อความ KB ที่ใช้อยู่ (fixture หรือ EVAL_KB_FILE) — GroundingGuard นับเลขจากผล search_knowledge_base ว่ามีที่มา
    ...KB.entries.flatMap((e) => moneyNumbers(e.responseTemplate, 500)),
  ]),
];
function isGrounded(n: number, extra: Set<number>): boolean {
  return GROUNDED.some((g) => Math.abs(n - g) / g <= 0.05) || [...extra].some((g) => Math.abs(n - g) / g <= 0.05);
}

// ───────────────────────── checks ─────────────────────────
// skipGlobal: เทิร์นปูทางที่รูปแบบข้อความถูกตรวจในฉากอื่นอยู่แล้ว (เช่น การ์ดแนะนำรุ่น = S3/S9) — ไม่นับด่านความยาว/คำต้องห้ามซ้ำ
type Turn = {
  user: string;
  /** เวลาร้านของเทิร์นนี้ (ทับของฉาก) — เช่น E16 เทิร์นสุดท้ายหลังร้านปิด */
  clockIso?: string;
  expectTools?: string[];
  forbidTools?: string[];
  /** ต้องมีการเรียก tool นี้ที่ input (JSON) มีข้อความนี้ — เช่น send_rate_card + 'imported_free_down' / get_installment_rates + 'มือสอง' */
  expectCalls?: { tool: string; inputIncludes: string }[];
  /** ลำดับการเรียกครั้งแรกของแต่ละ tool ต้องเป็นตามนี้ */
  expectToolOrder?: string[];
  /** intent ของแถว KB ที่ห้ามโผล่ในผล search_knowledge_base ของเทิร์นนี้ (เช่น 'age_requirement') */
  forbidKbHits?: string[];
  contains?: string[];
  notContains?: string[];
  match?: RegExp[];
  notMatch?: RegExp[];
  /** ก้อนแรก (ก่อน ---) ต้องมีทุกคำ */
  firstBubbleContains?: string[];
  /** ก้อนสุดท้ายต้องตรงทุก regex */
  lastBubbleMatch?: RegExp[];
  /** เลขหลัง "(ผ่อน)เดือนละ" ต้องอยู่ในชุดนี้เป๊ะ (synth C05 Turn.allowedMonthly) */
  allowedMonthly?: number[];
  /** ค่านี้ต้องอยู่ใต้หัวการ์ดนี้ (หัวที่ใกล้ที่สุดข้างบน จากหัวทั้งหมดในรายการ) — synth C05 cardOrder */
  cardUnder?: { header: string; value: string }[];
  wantButtons?: boolean;
  /** true = ห้ามเลข ≥1,000 · ตัวเลข = ห้ามเลข ≥ ค่านี้ */
  noBigNumbers?: boolean | number;
  skipGlobal?: boolean;
};
// promoSilent: ฉากที่ไม่เกี่ยวกับโปรเครื่องนอก (รุ่นนอกโปร / ซื้อสด / ยังไม่เลือกรุ่น) — บอทเอ่ย "เครื่องนอก/ฟรีดาวน์" เอง = ตก
// noStock: ฉากของโหมดไม่มีสต๊อก (EVAL_NO_STOCK=1) · anyMode: รันได้ทั้งสองโหมด · ไม่มีทั้งคู่ = โหมดปกติเท่านั้น
// history: ข้อความก่อนหน้าในห้อง (แถวแบบที่ router เก็บ) · clockIso: เวลาที่ระบบแนบต้นข้อความ (ค่าเริ่ม = บ่าย 2 เวลาไทย)
// runs: รันซ้ำกี่รอบต่อครั้ง · deferred: พึ่งกติกาที่ยังไม่อยู่ในรอบนี้ (ข้ามเว้นแต่สั่ง) · source: ที่มาใน synth
type Scenario = {
  id: string; name: string; turns: Turn[]; promoSilent?: boolean; noStock?: boolean; anyMode?: boolean;
  history?: { role: 'user' | 'assistant'; content: string }[]; clockIso?: string;
  runs?: number; deferred?: string; source?: string;
};

type Banned = { label: string; re: RegExp };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 'เกรด' — คำสั่งเจ้าของ 2026-08-17: tool คืนเกรดมาได้ แต่ห้ามพิมพ์ให้ลูกค้า (บอก % แบตพอ) · "อัปเกรด/อัพเกรด" ไม่นับ
const BANNED: Banned[] = [
  ...['ดอกเบี้ย', '%', 'GFIN', 'ผ่อนกับร้าน', 'เรทร้าน', 'สั่งเข้า', 'ครับ', '{customerName}', '{', 'เรียนคุณ', 'QR', 'โอนมัดจำ', 'โอนดาวน์',
    // Responsible Lending (วิจัย 2026-08-24): ห้ามถ้อยคำกระตุ้นก่อหนี้ + ห้ามอ้างว่าไม่ล็อก/ดาวน์ 0
    'ไม่ต้องคิด', 'อยากได้ต้องได้', 'จองเลย', 'ดาวน์ 0 บาท', 'ไม่มีดอกเบี้ย', 'ดอก 0', 'ไม่ล็อกเครื่อง', 'ไม่มีล็อก',
    // ชื่อขั้นตอน/รายการภายในของ persona ห้ามหลุดถึงลูกค้า (โปรเครื่องนอก 2026-09)
    'ขั้น 3.5', 'รายการเครื่องนอก', 'ไม่อยู่ในรายการ',
  ].map((w) => ({ label: w, re: new RegExp(escapeRe(w)) })),
  { label: 'เกรด', re: /(?<!อั[ปพ])เกรด/ },
  // ป้ายภายในของตาราง/สต๊อก (deviceOrigin) — ห้ามพิมพ์ให้ลูกค้า (synth C04)
  ...['UNSPECIFIED', 'IMPORTED', 'THAI'].map((w) => ({ label: w, re: new RegExp(`\\b${w}\\b`) })),
];

function splitBubbles(text: string): string[] {
  return text.split(/\n\s*---+\s*\n/);
}

function globalChecks(reply: string, spoken: Set<number>): string[] {
  const fails: string[] = [];
  // "แบต 87%" เป็นการใช้ % ที่ถูกกติกา (สเปคแบต) — ตัดออกก่อนเช็คคำต้องห้าม
  // รวมรูปแบบช่วง "แบต 87-92%" ที่บอทใช้ตอนสรุปเครื่องหลายตัวในการ์ดเดียว
  const scrubbed = reply.replace(/แบต(?:เตอรี่)?\s*(?:เหลือ|ยังดี)?\s*\d+(?:\s*[-–]\s*\d+)?\s*%/g, 'แบตSPEC');
  for (const b of BANNED) if (b.re.test(scrubbed)) fails.push(`คำต้องห้ามหลุด: "${b.label}"`);
  if (/^\s*[*#-]\s/m.test(reply.replace(/^[ \t]*---+[ \t]*$/gm, ''))) fails.push('ใช้ markdown bullet (*/-/#)');
  if (/\*\*/.test(reply)) fails.push('ใช้ตัวหนา ** (FB แสดงดิบ)');
  // คำถามได้ข้อเดียว และอยู่ก้อนสุดท้าย
  // ใช้ splitBubbles (= MessageRouterService) ที่เดียวทั้งไฟล์ — ก่อนหน้านี้ด่านนี้ตัดด้วย /\n---\n/ เคร่ง ๆ
  // ทำให้คำตอบที่คั่นด้วย '----' หรือ '--- ' (router แตกให้จริง) ถูกนับเป็นก้อนเดียวแล้วตกด่านความยาวลอย ๆ
  // ปุ่มกด "[ตัวเลือก: …]" ท้ายข้อความ: MessageRouterService ตัดออกเป็น quick replies **ก่อน** แตกก้อน
  // (message-router.service.ts — regex เดียวกันนี้ แล้ว .trim().filter(Boolean) ก่อน slice)
  // ⇒ ลูกค้าไม่เห็นเป็นข้อความในบับเบิล ด่านความยาว/จำนวนบรรทัด/จำนวนก้อนจึงต้องวัดหลังตัดปุ่ม
  // (ด่านความยาวทั้งเทิร์น `visible` และด่านความยาวบรรทัดตัดปุ่มออกอยู่แล้ว — ตรงนี้เคยตกหล่นที่เดียว
  //  ทำให้ก้อนที่อ่านง่ายอยู่แล้วตกด่านเพราะป้ายปุ่มไปกินโควตาบรรทัด/ตัวอักษร)
  const layoutText = reply.replace(/\n?\s*\[ตัวเลือก:\s*([^\]]+)\]\s*$/, '');
  const bubbles = splitBubbles(layoutText).map((b) => b.trim()).filter(Boolean);
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
  const visible = splitBubbles(reply).join('').replace(/\[ตัวเลือก:[^\]]*\]/g, '').trim();
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

  // ตัวเลขต้องมีที่มา — ตัดลิงก์ (แผนที่มีเลขใน URL) / ความจุ (512GB) ออกก่อน ไม่ใช่ราคา
  // เลขที่ลูกค้าพิมพ์เองก็มีที่มา (เหมือน collectConversationNumbers ของ GroundingGuard)
  for (const n of moneyNumbers(reply, 500)) {
    if (!isGrounded(n, spoken)) fails.push(`เลขไม่มีที่มา: ${n}`);
  }
  return fails;
}

const CASH_QUESTION = /(เงินสด|ซื้อสด)\s*(หรือ(ว่า)?|\/)\s*ผ่อน|ผ่อน\s*(หรือ(ว่า)?|\/)\s*(เงินสด|ซื้อสด)/;
const FILTER_QUESTION = /เครื่องนอก[\s\S]*เครื่องไทย|เครื่องไทย[\s\S]*เครื่องนอก/;
const MONTHLY_RE = /เดือนละ\s*([\d,]{3,})/g;

// ───────────────────────── ประวัติที่ใช้บ่อย ─────────────────────────
const DAY_CLOCK = '2026-09-22T07:00:00Z'; // อังคาร 22/09 14:00 น. (ในเวลาทำการ)
const AFTER_CLOSE_CLOCK = '2026-09-22T13:30:00Z'; // 20:30 น. (ร้านปิดแล้ว)
const NIGHT_CLOCK = '2026-09-22T19:10:00Z'; // พุธ 23/09 02:10 น.
// = MessageRouterService.describeNonTextInbound (private) — ข้อความที่บอทเห็นเมื่อลูกค้าส่งรูป/ไฟล์
const IMAGE_INBOUND = '[ลูกค้าส่งรูปภาพมา 1 รูป — อาจเป็นเอกสาร/สลิป/รูปเครื่อง/สติกเกอร์]';
const FILE_INBOUND = '[ลูกค้าส่งไฟล์แนบมา]';
const PAGE_AUTOREPLY_HISTORY: Scenario['history'] = [
  { role: 'user', content: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
  { role: 'assistant', content: 'อันนี้ตารางผ่อนเครื่องนอกค่ะ 😊\n\nดาวน์ 0 บาท\nประกันร้าน 30 วัน\nแถมเคสกับฟิล์มให้ด้วยค่ะ\n\nสนใจรุ่นไหนคะ' },
];
// ทางเครื่องไทย 15 Plus (ไม่อยู่ในโปร) → เลือกเรทที่ 1 → บอทขอสเตทเม้นท์ (แถวแบบที่ router เก็บ: แยกก้อน ไม่มีปุ่ม)
const THAI_RATE1_HISTORY: NonNullable<Scenario['history']> = [
  { role: 'user', content: 'สนใจ iPhone 15 Plus 128GB ผ่อนค่ะ' },
  { role: 'assistant', content: '📱 iPhone 15 Plus 128GB มือสอง\nเรทที่ 1 ดาวน์ 1,900 ผ่อนเดือนละ 2,566 บาท 12 งวด\nเรทที่ 2 ดาวน์ 3,400 ผ่อนเดือนละ 2,905 บาท 12 งวด' },
  { role: 'assistant', content: 'พี่สนใจเรทไหนคะ' },
  { role: 'user', content: 'เรทที่ 1' },
  { role: 'assistant', content: 'เรทที่ 1 ใช้สเตทเม้นท์ย้อนหลัง 3 เดือนค่ะ\nส่งในแชทนี้ได้เลยนะคะ' },
];
const THAI_DOCS_SENT_HISTORY: Scenario['history'] = [
  ...THAI_RATE1_HISTORY,
  { role: 'user', content: FILE_INBOUND },
  { role: 'assistant', content: 'ได้รับแล้ว เดี๋ยวทีมเช็คให้ไวเลยนะคะ' },
  { role: 'assistant', content: 'พี่สะดวกเข้ามาดูเครื่องวันไหนคะ' },
];

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
    // P23 (2026-09-22): การ์ดแนะนำที่เข้างบ ห้ามเติมบรรทัดโปรฟรีดาวน์/เครื่องนอก (เติมได้เฉพาะดาวน์เกินงบ — S30)
    id: 'S3', name: 'แนะนำตามงบ → ถามรุ่นที่ใช้อยู่ก่อน → การ์ดสั้นจาก recommend_devices',
    turns: [
      { user: 'แนะนำหน่อย ไม่รู้จะเอารุ่นไหน', contains: ['รุ่นไหนอยู่'], noBigNumbers: true, forbidTools: ['recommend_devices'] },
      { user: 'ใช้ 12 อยู่', noBigNumbers: true, forbidTools: ['recommend_devices'] },
      { user: 'ดาวน์ไม่เกิน 3000 ผ่อนเดือนละไม่เกิน 2000', expectTools: ['recommend_devices'], forbidTools: ['search_products', 'calculate_installment'], contains: ['ดาวน์', 'ผ่อนเดือนละ', 'ดีกว่า'], notContains: ['17,500', '19,900', '13,900', 'ฟรีดาวน์', 'เครื่องนอก'] },
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
      { user: 'ดาวน์ 3000 ผ่อนไม่เกิน 2000', expectTools: ['recommend_devices'], contains: ['ดาวน์', 'ผ่อนเดือนละ', 'จุดเด่น'], notContains: ['ดีกว่า', 'เทิร์นได้ประมาณ', '3,500', 'A54:', 'ฟรีดาวน์', 'เครื่องนอก'] },
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
        notContains: ['48MP', '120Hz', 'USB-C', 'Dynamic Island', '5G', 'ฟรีดาวน์', 'เครื่องนอก'] },
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
    // P10 (2026-09-22): รุ่นนอกโปร → "ไม่มีในโปร" + ทางออก [เรทรุ่นนี้ | รุ่นในโปร] · กด "เรทรุ่นนี้" = เดินขั้น 2 ของรุ่นนี้
    // (ไม่ถามเงินสด/ผ่อน ไม่ถามกรองนอก/ไทย ไม่พูดฟรีดาวน์) — เดิมฉากนี้มีเทิร์นเดียวและไม่มีปุ่มทางออก
    id: 'S20', name: 'ถามหาฟรีดาวน์รุ่นที่ไม่อยู่ในโปร → บอกตรง ๆ + ทางออกเรทรุ่นนี้ ห้ามแต่งค่างวด',
    turns: [
      { user: 'มีฟรีดาวน์ iPhone 15 Plus ไหมคะ', contains: ['ไม่มีในโปร', 'เรทรุ่นนี้'], notContains: ['ไฟแนนซ์', 'ดาวน์ 0 บาท'], noBigNumbers: true },
      { user: 'เรทรุ่นนี้', contains: ['128GB', '256GB', '[ตัวเลือก:'], notContains: ['ฟรีดาวน์', 'งบ', 'ไฟแนนซ์'], notMatch: [CASH_QUESTION, FILTER_QUESTION], noBigNumbers: true },
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
    // P23 (2026-09-22): recommended ว่างเพราะดาวน์เกินงบ (nearMiss overBy.down > 0) → เติมบรรทัดโปรฟรีดาวน์ + ปุ่ม "โปรฟรีดาวน์"
    id: 'S30', name: 'แนะนำตามงบ แต่ดาวน์เกินงบทุกรุ่น → รุ่นใกล้งบ + ชวนโปรฟรีดาวน์เครื่องนอก',
    turns: [
      { user: 'ใช้ไอโฟน 12 อยู่ อยากเปลี่ยนเครื่อง ดาวน์ได้ไม่เกิน 1000 ผ่อนไม่เกิน 2000', expectTools: ['recommend_devices'], contains: ['ฟรีดาวน์'], match: [/\[ตัวเลือก:[^\]]*โปรฟรีดาวน์/] },
    ],
  },
  {
    // สต๊อกจริงจะมีเครื่องนอกปนอยู่ (หน้าร้านจดช่องตำหนิ "เครื่องนอก XX/A" + ประกัน 30 วัน) — ลูกค้าเลือกเครื่องไทย
    // บอทต้องเสนอเฉพาะเครื่องไทย ห้ามหยิบเครื่องนอกมาคิดเรทผ่อนของร้าน/ประกัน 60 วัน
    // โหมดปกติ + เจอของ (4A) → ยังถามเงินสด/ผ่อนก่อน (คำตัดสินรอบนี้ข้อ 3 — ต่างจาก NO_STOCK ที่เสนอเรทเลย)
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
    // P20 (2026-09-22): ซื้อสดแต่ไม่เจอของ → ห้ามพูด "หมด"/"สั่งเข้า"/"1-2 วัน" · "ราคาเงินสดขอทีมเช็คแล้วแจ้งกลับ" (เดิม: บอกหาเข้ามาให้)
    promoSilent: true,
    id: 'S17', name: 'ซื้อสดแต่ไม่มีของ → ทีมเช็คราคาแจ้งกลับ ห้ามพูดหมด ห้ามเดาราคา',
    turns: [
      { user: 'iPhone 15 Plus 128GB ราคาสดเท่าไหร่', contains: ['เช็ค'], notContains: ['สั่งเข้า', 'หมด', '1-2 วัน', 'ดาวน์ 1,900', 'ผ่อนเดือนละ 2,566'], noBigNumbers: true },
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
    history: PAGE_AUTOREPLY_HISTORY,
    turns: [
      { user: '15 Pro ค่ะ', expectTools: ['search_knowledge_base'], forbidTools: ['send_rate_card'], contains: ['3,288', '30 วัน'], notContains: ['โปรฟรีดาวน์เป็น', 'ไฟแนนซ์', 'บริษัทสินเชื่อ', 'หมด'] },
    ],
  },
  {
    // คำตัดสินรอบนี้ข้อ 3: NO_STOCK ไม่ถามเงินสด/ผ่อน · ตาราง "iPhone 15 128GB" คืนแถวพี่น้อง 15 Plus มาด้วย → ค่างวดต้องเป็นของ 15 เท่านั้น
    noStock: true,
    id: 'NS3', name: 'เครื่องไทยมือสอง ตอนไม่มีสต๊อก → เรท 2 แบบจากตาราง ห้ามพูดหมด/กำลังเข้า/พร้อมรับ',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย'], notContains: ['หมด', 'กำลังเข้ามา'], noBigNumbers: true },
      { user: 'เครื่องไทย ผ่อนค่ะ', expectTools: ['get_installment_rates'], contains: ['เรทที่ 1', 'เรทที่ 2', '2,424', '2,523'], notContains: ['หมด', 'กำลังเข้ามา', 'กำลังจะเข้ามา', 'จองไว้ก่อน', 'พร้อมรับที่ร้าน', 'ของเข้า'], notMatch: [CASH_QUESTION], allowedMonthly: [2424, 2523] },
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
    clockIso: NIGHT_CLOCK,
    turns: [
      { user: 'ถ้าส่งสเตทเม้นท์ไปตอนนี้ รู้ผลกี่นาทีคะ', notContains: ['5 นาที', 'รอสักครู่', 'แอดมินกำลัง'], contains: ['10 โมง'] },
    ],
  },
  {
    // รีวิว TOOLLOOP-4: โหมดไม่มีสต๊อก recommend_devices ไม่มี inStock/unitCount/sampleUnit (สี/แบต) — การ์ดห้ามมีแบต/สี/สถานะของ
    noStock: true,
    id: 'NS9', name: 'แนะนำตามงบตอนไม่มีสต๊อก → การ์ดไม่มีแบต/สี/สถานะของ',
    turns: [
      // ห้ามเคลม **%แบตของเครื่องจริง** (sampleUnit ถูกตัดในโหมดนี้) — ไม่ใช่ห้ามคำว่า "แบต":
      // บรรทัด betterThanCurrent ของ tool มี "แบตนานขึ้น ~3 ชม." ซึ่งเป็นสเปคเทียบรุ่น ไม่ใช่ของเครื่องในสต๊อก
      { user: 'ใช้ไอโฟน 12 อยู่ ดาวน์ 3000 ผ่อนไม่เกิน 2000 แนะนำหน่อยค่ะ', expectTools: ['recommend_devices'], contains: ['ดาวน์', 'ผ่อนเดือนละ'],
        notContains: ['มีของ', 'พร้อมรับ', 'หมด', 'กำลังเข้า'], notMatch: [/สี\s*(ดำ|ฟ้า)/, /แบต(?:เตอรี่)?\s*(?:เหลือ|ยังดี)?\s*\d{1,3}\s*%/] },
    ],
  },
  {
    // คำตัดสินรอบนี้ข้อ 3 (เจ้าของ 2026-08-24: ไม่เจอของ = เสนอเรทเลย): NO_STOCK + เลือกเครื่องไทยโดยไม่มีสัญญาณซื้อสด
    // → get_installment_rates (มือสอง) + เรท 4B ในเทิร์นนั้น ห้ามถามเงินสด/ผ่อน · ห้ามหยิบแถวมือ 1 ของ 16 128GB
    noStock: true,
    id: 'NS10', name: 'ไม่มีสต๊อก + เลือกเครื่องไทยเฉย ๆ → เรทมือสองเลย ไม่ถามเงินสด/ผ่อน',
    turns: [
      { user: 'สนใจ iPhone 16 128GB มือสองค่ะ', contains: ['เครื่องนอก', 'เครื่องไทย'], notContains: ['หมด', 'กำลังเข้ามา'], noBigNumbers: true },
      { user: 'เครื่องไทย', expectCalls: [{ tool: 'get_installment_rates', inputIncludes: 'มือสอง' }], contains: ['เรทที่ 1', 'เรทที่ 2', '2,652', '2,741'], notContains: ['3,251', '3,181', 'หมด', 'กำลังเข้ามา'], notMatch: [CASH_QUESTION], allowedMonthly: [2652, 2741] },
    ],
  },
  // ───────── ชุด E: ฉากจาก synth (แชทจริง 458 ห้อง 3 วัน · 2026-09-22) — EVAL_SET=E (prod เริ่ม NO_STOCK: + EVAL_NO_STOCK=1) ─────────
  // must/must_not ที่ตรวจด้วยเครื่องไม่ได้ (เช่น "ฟันธงว่าแบบไหนคุ้มกว่า") แปลงเป็นคำ/regex ที่ใกล้ที่สุด — ดูคอมเมนต์ต่อฉาก
  {
    noStock: true,
    id: 'E01', source: 'synth E01 · P01', name: 'ปุ่มโฆษณาฟรีดาวน์ → รูปตารางโปร + ก้อน 3 เรื่องก่อน + ปุ่มรุ่น 13-16',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', expectCalls: [{ tool: 'send_rate_card', inputIncludes: 'imported_free_down' }],
        firstBubbleContains: ['เครื่องนอก', '30 วัน', 'จ่ายงวดแรก'], lastBubbleMatch: [/\[ตัวเลือก:[^\]]*13[^\]]*16[^\]]*\]/],
        // "ไล่รายการรุ่น/ความจุ" → ห้ามมีความจุในข้อความ
        notContains: ['ดาวน์ 0', 'ไฟแนนซ์', '128GB', '256GB'], noBigNumbers: 500 },
    ],
  },
  {
    anyMode: true,
    id: 'E02', source: 'synth E02 · P01/P02 (X2)', name: 'ต่อจากข้อความอัตโนมัติของเพจ → การ์ด 16 Pro + ก้อน 3 เรื่อง ไม่ส่งตาราง/ไม่แนะนำโปรซ้ำ',
    history: PAGE_AUTOREPLY_HISTORY,
    turns: [
      { user: '16 Pro ค่ะ', expectTools: ['search_knowledge_base'], forbidTools: ['send_rate_card'], contains: ['3,291', '30 วัน', 'จ่ายงวดแรก'], notContains: ['โปรฟรีดาวน์เป็น', 'ดาวน์ 0 บาท', 'บริษัทสินเชื่อ'], allowedMonthly: [3291] },
    ],
  },
  {
    // เทิร์น 3 ต้องครบทั้งสคริปต์บังคับ (persona "ถามเงินวันรับเครื่อง/งวดแรก/ค่าเอกสาร" คำต่อคำ) เทิร์น 4 ต้องตอบเรื่องงวดแรก
    // ถ้อยคำเจ้าของเคาะแล้ว: "วันรับเครื่องไม่ต้องจ่ายเงิน · งวดแรกจ่ายเดือนถัดไป วันเดียวกับวันที่ทำสัญญา"
    // — แทนฉบับกลางเดิม "ไม่ต้องวางเงินดาวน์ / ตามวันที่ในสัญญา" (O04 ตอบแล้ว) · เทิร์น 4 เป็นคำตอบรับ-ปฏิเสธ
    // ของลูกค้า ไม่ใช่จังหวะสคริปต์เต็ม จึงรับถ้อยคำเทียบเท่า ("วันทำสัญญา" ไม่มี "ที่") แต่ยังห้ามบอกวันที่เจาะจง
    anyMode: true,
    id: 'E03', source: 'synth E03 · P03 · K2', name: 'ทางโปร: วันรับเครื่องจ่ายเท่าไหร่ / ไม่ต้องจ่ายงวดแรกหรอ → วันรับเครื่องไม่ต้องจ่ายเงิน + งวดแรกเดือนถัดไป ไม่ handoff',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?', notContains: ['ไฟแนนซ์'] },
      { user: 'iPhone 14 ธรรมดาค่ะ', contains: ['1,885'], allowedMonthly: [1885], notContains: ['ไฟแนนซ์'] },
      { user: 'วันไปรับเครื่องต้องจ่ายเท่าไหร่คะ', forbidTools: ['handoff_to_human'],
        contains: ['วันรับเครื่องไม่ต้องจ่ายเงิน', 'งวดแรกจ่ายเดือนถัดไป', 'วันเดียวกับวันที่ทำสัญญา', 'ก่อนเซ็น'],
        notContains: ['ไม่มีค่าใช้จ่าย', 'ฟรีงวดแรก', '1,000', 'ไฟแนนซ์', 'ไม่มีบริการจัดส่ง'] },
      // ห้ามบอกวันที่เจาะจงของงวดแรก (persona: บอกได้แค่ "เดือนถัดไป วันเดียวกับวันที่ทำสัญญา")
      { user: 'ไม่มีดาวน์ แล้วไม่ต้องจ่ายงวดแรกหรอคะ', forbidTools: ['handoff_to_human'], contains: ['งวดแรก', 'เดือนถัดไป'],
        match: [/วันเดียวกับวัน(?:ที่)?ทำสัญญา/], notMatch: [/(?:ทุก)?วันที่\s*\d{1,2}/],
        notContains: ['ไม่มีค่าใช้จ่าย', 'ฟรีงวดแรก', '1,000', 'ไฟแนนซ์', 'ไม่มีบริการจัดส่ง'] },
    ],
  },
  {
    // โหมดปกติ: search_products "16 Pro Max" ไม่เจอของ → 4B เสนอเรทเลยเหมือน NO_STOCK
    anyMode: true,
    id: 'E04', source: 'synth E04 · P04/P05 · X4', name: '16 Pro Max ส่งเดือนละเท่าไหร่ → ไม่มีผลิต+ความจุ → กรองนอก/ไทย → เครื่องไทย = เรทมือสอง 256GB',
    turns: [
      { user: '16 Pro Max ส่งเดือนละเท่าไหร่คะ', forbidTools: ['handoff_to_human'], contains: ['ไม่มีผลิต', '256GB', '512GB', '[ตัวเลือก:'], notContains: ['งบ', 'กำลังเข้ามา'], noBigNumbers: true },
      { user: '256', forbidTools: ['handoff_to_human'], contains: ['เครื่องนอก', 'เครื่องไทย', '30 วัน', '60 วัน'], notContains: ['งบ'], noBigNumbers: true },
      { user: 'เครื่องไทย', forbidTools: ['handoff_to_human'], expectCalls: [{ tool: 'get_installment_rates', inputIncludes: 'มือสอง' }],
        contains: ['เรทที่ 1', 'เรทที่ 2', '3,793', '4,171', '15 งวด'], notContains: ['ฟรีดาวน์', '4,106', '4,391', 'กำลังเข้ามา', 'จัดส่ง', 'งบ'],
        notMatch: [CASH_QUESTION], allowedMonthly: [3793, 4171] },
    ],
  },
  {
    noStock: true, runs: 5,
    id: 'E05', source: 'synth E05 · P04 · C04', name: 'ไม่มีสต๊อก: เครื่องไทย ผ่อน → เรทที่ 1/2 ของมือสองในเทิร์นนั้น (≥5 รอบ ต้องผ่านทุกรอบ)',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เครื่องนอก', 'เครื่องไทย'], noBigNumbers: true },
      { user: 'เครื่องไทย ผ่อนค่ะ', expectTools: ['get_installment_rates'], forbidTools: ['handoff_to_human', 'list_promotions'],
        contains: ['เรทที่ 1', 'เรทที่ 2', '2,424', '2,523'], notMatch: [CASH_QUESTION], allowedMonthly: [2424, 2523] },
    ],
  },
  {
    // โหมดปกติมีของ 16 128GB (4A → calculate_installment) จึงเป็นฉาก NO_STOCK
    noStock: true,
    id: 'E06', source: 'synth E06 · P05', name: '16 ธรรมดา 128GB ผ่อนเท่าไร → 3 แบบ (มือ 1/มือสองไทย/มือสองนอก) → มือสองเครื่องไทย = เรทมือสอง',
    turns: [
      { user: 'ไอโฟน 16 ธรรมดา 128GB ผ่อนเดือนละเท่าไรครับ', contains: ['มือ 1', 'มือสองเครื่องไทย', 'มือสองเครื่องนอก', '[ตัวเลือก:'], notContains: ['งบ', 'เงินสด'], noBigNumbers: true },
      { user: 'มือสองเครื่องไทย', expectTools: ['get_installment_rates'], contains: ['2,652', '2,741'], notContains: ['3,251', '3,181', 'งบ', 'เงินสด', '2,631'], allowedMonthly: [2652, 2741] },
    ],
  },
  {
    noStock: true,
    id: 'E07', source: 'synth E07 · P05 (การ์ดเทียบมือ)', name: 'มือ 1 กับมือ 2 ผ่อนต่างกันเท่าไหร่ → การ์ด 2 ใบแยกมือ ห้ามคิดส่วนต่าง',
    turns: [
      { user: 'ไอโฟน 16 ธรรมดา 128GB มือ 1 กับมือ 2 ผ่อนต่างกันเท่าไหร่', expectTools: ['get_installment_rates'], contains: ['3,251', '2,652', '[ตัวเลือก:'],
        cardUnder: [{ header: 'มือ 1', value: '3,251' }, { header: 'มือสอง', value: '2,652' }],
        // "ตัวเลขส่วนต่างที่คิดเอง" → ห้าม "ต่าง(กัน) <เลข>" (599/440 < 500 หลุดด่านเลขไม่มีที่มา)
        notContains: ['งบ', '2,631'], notMatch: [/ต่าง(?:กัน)?\s*(?:ประมาณ|อยู่)?\s*[\d,]{3,}/], allowedMonthly: [3251, 3181, 2652, 2741] },
    ],
  },
  {
    anyMode: true,
    id: 'E08', source: 'synth E08 · P06 · K4', name: 'ขอเรท iPhone 18 Pro Max (ไม่มีในตาราง) → แอดมินเช็คเรท + notify_staff ไม่มีตัวเลข',
    turns: [
      { user: 'ขอเรทผ่อนไอโฟน 18 pro max', expectToolOrder: ['get_installment_rates', 'notify_staff'], forbidTools: ['handoff_to_human', 'capture_lead'],
        contains: ['แอดมินเช็คเรท'], notContains: ['ไม่มีผลิต', 'มือสอง', 'งบ'], forbidKbHits: ['age_requirement'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true,
    id: 'E09', source: 'synth E09 · P09', name: 'มีผ่อน 24 งวดไหม → สูงสุด 15 งวด ไม่มี 24 + ปุ่มรุ่น',
    turns: [
      { user: 'มีผ่อน 24 งวดไหมคะ', contains: ['สูงสุด 15 งวด', 'ไม่มี 24', '[ตัวเลือก:'], notContains: ['งบ', 'เรทที่ 1', 'เรทที่ 2', 'สเตทเม้นท์'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true, deferred: 'รอ P07 (ดาวน์ที่ลูกค้ากำหนดเอง — P1 รอบหน้า): persona ยังไม่มี "ค่างวดจะลดลง"',
    id: 'E10', source: 'synth E10 · P07', name: '17 Pro Max มือ 1 ดาวน์ 10,000 → ค่างวดตามตารางเท่านั้น ทีมงานคิดให้',
    turns: [
      { user: '17 Pro Max 256 มือ 1 ดาวน์ 10,000 ส่งเดือนเท่าไร', expectCalls: [{ tool: 'get_installment_rates', inputIncludes: 'มือ 1' }],
        contains: ['มือ 1', 'ค่างวดจะลดลง', 'ทีมงานคิดให้'], notContains: ['4,577', '5,162', 'งบ', 'เพิ่มดาวน์ได้'], allowedMonthly: [5917, 5712] },
    ],
  },
  {
    anyMode: true, deferred: 'รอ P08 (ลูกค้ายกตัวเลขมาให้ยืนยัน — P1 รอบหน้า)',
    id: 'E11', source: 'synth E11 · P08', name: 'ทางโปร: ลูกค้ายก "ดาวน์ 2700 ส่ง 3401/15" → ตอบจาก KB (ฟรีดาวน์) ห้ามยืนยันว่ามีดาวน์',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { user: '15 Pro Max ดาวน์ 2700 ส่ง 3401/15 ถูกไหมคะ', expectTools: ['search_knowledge_base'], forbidTools: ['get_installment_rates', 'calculate_installment'],
        contains: ['ฟรีดาวน์', '15 งวด', '3,401'], notContains: ['ไฟแนนซ์'], notMatch: [/ดาวน์\s*2,?700/], allowedMonthly: [3401] },
    ],
  },
  {
    anyMode: true,
    id: 'E12', source: 'synth E12 · P10', name: 'ทางโปรแต่ขอเครื่องไทย → ฟรีดาวน์มีเฉพาะเครื่องนอก (ครั้งเดียว) → เดินลำดับหลัก ถามความจุ',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { user: 'ขอเป็นเครื่องไทยได้ไหมคะ ดาวน์เท่าไหร่', contains: ['ฟรีดาวน์มีเฉพาะเครื่องนอก', '[ตัวเลือก:'], notContains: ['เครื่องไทยฟรีดาวน์', 'งบ'], noBigNumbers: true },
      { user: '15 ธรรมดา', contains: ['128GB', '256GB', '[ตัวเลือก:'], notContains: ['ฟรีดาวน์', 'งบ', '2,395'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true,
    id: 'E13', source: 'synth E13 · P10', name: 'ทางโปรถามรุ่นนอกโปร (17 Pro Max) → ไม่มีในโปร + [เรทรุ่นนี้ | รุ่นในโปร] → เรทรุ่นนี้ = ถามความจุ',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { user: '17 Pro Max ดาวน์เท่าไหร่คะ', contains: ['ไม่มีในโปร', 'เรทรุ่นนี้', 'รุ่นในโปร'], notContains: ['งบ'], noBigNumbers: true },
      { user: 'เรทรุ่นนี้', contains: ['256GB', '512GB', '[ตัวเลือก:'], notContains: ['ฟรีดาวน์', 'งบ'], notMatch: [FILTER_QUESTION] },
    ],
  },
  {
    anyMode: true,
    id: 'E14', source: 'synth E14 · P12 · K1', name: 'ทางโปร + ต่างจังหวัด → ออนไลน์ได้ ถามรุ่น (ไม่ขอเบอร์) → การ์ด → ค่าส่ง = ทีมงานแจ้งก่อนเริ่มสัญญา',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { user: 'อยู่ต่างจังหวัดค่ะ ทำสัญญาออนไลน์ได้ไหมคะ', forbidTools: ['capture_lead'], contains: ['ออนไลน์', '[ตัวเลือก:'], notContains: ['เบอร์', 'ไม่มีบริการจัดส่ง', 'มารับเครื่องที่', '1,000', 'ไฟแนนซ์', 'นัด', 'ที่อยู่'], noBigNumbers: true },
      { user: 'iPhone 14 Pro ค่ะ', expectTools: ['search_knowledge_base'], forbidTools: ['capture_lead'], contains: ['30 วัน', 'จ่ายงวดแรก', '2,650'], notContains: ['ไม่มีบริการจัดส่ง', 'มารับเครื่องที่', '1,000', 'ไฟแนนซ์', 'นัด', 'ที่อยู่'], allowedMonthly: [2650] },
      { user: 'ค่าส่งเท่าไหร่คะ ส่งกี่วันถึง', forbidTools: ['capture_lead'], contains: ['ทีมงานแจ้งให้ครบก่อนเริ่มทำสัญญา'], notContains: ['ไม่มีบริการจัดส่ง', 'มารับเครื่องที่', '1,000', 'ไฟแนนซ์', 'นัด', 'ที่อยู่'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true,
    id: 'E15', source: 'synth E15 · P12 · K1', name: 'ทางเครื่องไทย + ต่างจังหวัด → ต้องมารับที่ร้านลพบุรี + เสนอทางเครื่องนอกออนไลน์ 1 ครั้ง',
    turns: [
      { user: 'สนใจผ่อน iPhone 15 ตัวธรรมดา 128GB มือสองค่ะ', contains: ['เครื่องนอก', 'เครื่องไทย'], noBigNumbers: true },
      { user: 'เครื่องไทยค่ะ', notContains: ['ไฟแนนซ์'] },
      { user: 'อยู่ต่างจังหวัดค่ะ ส่งเครื่องให้ได้ไหม', contains: ['เครื่องไทยต้องเข้ามารับเครื่องที่ร้านลพบุรี', 'ออนไลน์', '[ตัวเลือก:'], notContains: ['ไปรษณีย์', 'ขนส่ง', 'Kerry', 'Flash', 'ที่อยู่', 'ผ่อนกับร้าน'] },
    ],
  },
  {
    anyMode: true,
    id: 'E16', source: 'synth E16 · P13', name: 'ที่ตั้ง/เวลาปิด → แผนที่ + 19:00 น. · 20:30 ถามเข้าร้านวันนี้ → ร้านปิดแล้ว พรุ่งนี้ 10:00',
    turns: [
      { user: 'ร้านอยู่ตรงไหนคะ', expectCalls: [{ tool: 'send_rate_card', inputIncludes: 'shop_map' }], forbidTools: ['handoff_to_human'], contains: ['บขส', 'maps.app.goo.gl', '19:00 น.'], notContains: ['เดี๋ยวเช็คให้'] },
      { user: 'ร้านปิดกี่โมงคะ', forbidTools: ['handoff_to_human'], contains: ['19:00 น.'], notContains: ['เดี๋ยวเช็คให้'] },
      // persona รอบ 3 (R2-hours-verbatim) กำกับบรรทัดเวลาร้านว่า **คำต่อคำ ห้ามเรียบเรียงใหม่ ห้ามย้ายเวลาไปไว้ในวงเล็บ**
      // ⇒ ด่านนี้กลับมาบังคับสตริงของ persona เป๊ะ ๆ ("ตอนนี้ร้านปิดแล้วค่ะ (ปิด 19:00 น.)" = ตก)
      // ถ้าเจ้าของอยากให้เรียบเรียงได้ ต้องถอย R2-hours-verbatim ออกจาก persona ด้วย ไม่ใช่ผ่อนที่ด่านนี้ที่เดียว
      { user: 'วันนี้เข้าไปได้ไหมคะ', clockIso: AFTER_CLOSE_CLOCK, forbidTools: ['handoff_to_human'],
        contains: ['ร้านปิด 19:00 น. แล้ว', 'พรุ่งนี้ 10:00'],
        notContains: ['เดี๋ยวเช็คให้', 'แวะมาได้เลย', 'คืนนี้'] },
    ],
  },
  {
    anyMode: true,
    id: 'E17', source: 'synth E17 · P14 · P15', name: 'ตีสอง ส่งไฟล์เอกสาร (เลือกเรทที่ 1 แล้ว) → ได้รับแล้ว ทีมเช็คช่วงร้านเปิด 10 โมง แล้วเดินขั้น 7',
    clockIso: NIGHT_CLOCK,
    history: THAI_RATE1_HISTORY,
    turns: [
      // persona รอบ 3 (R2-doc-ack-verbatim) สั่งว่า "ได้รับแล้ว" ต้องติดกันเป๊ะ ๆ และ **ห้าม** "ได้รับเอกสารแล้ว"/"ได้รับไฟล์แล้ว"
      // ⇒ ด่านนี้บังคับสตริงเดิม (ถ้าจะยอมให้แทรกคำ ต้องถอย R2-doc-ack-verbatim ออกจาก persona ด้วย)
      { user: FILE_INBOUND, forbidTools: ['handoff_to_human'], contains: ['ได้รับแล้ว', 'ร้านเปิด', '10 โมง'],
        match: [/สะดวก|วันไหน|เข้ามา/],
        notContains: ['5 นาที', 'รอสักครู่', 'ไวเลย', 'รหัส', 'ส่งซ้ำ', 'ส่งใหม่', 'พรุ่งนี้'] },
      { user: 'ส่งสเตทเม้นให้แล้วนะคะ', forbidTools: ['handoff_to_human'], notContains: ['5 นาที', 'รอสักครู่', 'ไวเลย', 'รหัส', 'ส่งซ้ำ', 'ส่งใหม่', 'พรุ่งนี้'] },
    ],
  },
  {
    anyMode: true,
    id: 'E18', source: 'synth E18 · P15 · P18', name: 'ห้องใหม่ส่งแค่รูป → ขอบคุณ + ปุ่ม 3 ตัว → ส่งสลิปค่างวด = notify_staff + ขอชื่อ-นามสกุลที่ทำสัญญา',
    turns: [
      { user: IMAGE_INBOUND, forbidTools: ['capture_lead'], contains: ['ขอบคุณที่ทักมา', '[ตัวเลือก:'], match: [/\[ตัวเลือก:[^|\]]+\|[^|\]]+\|[^|\]]+\]/], notContains: ['ได้รับเอกสาร', 'มองไม่เห็น'] },
      { user: 'ส่งสลิปค่างวด', expectTools: ['notify_staff'], forbidTools: ['capture_lead'], contains: ['ชื่อ-นามสกุล'], notContains: ['ไฟแนนซ์', 'ได้รับเงินแล้ว', 'ได้รับยอด', 'เลขบัญชี'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true,
    id: 'E19', source: 'synth E19 · P16', name: 'ทางเครื่องไทยส่งเอกสารแล้ว ถาม "สรุปผ่านไหม" → handoff ทันที ห้ามตอบผล',
    history: THAI_DOCS_SENT_HISTORY,
    turns: [
      { user: 'สรุปผ่านไหมคะ', expectTools: ['handoff_to_human'], notContains: ['ผ่านแล้ว', 'ไม่ผ่าน', 'ผ่านค่ะ', '5 นาที', 'ส่งใหม่', 'ส่งอีกครั้ง'] },
    ],
  },
  {
    anyMode: true,
    id: 'E20', source: 'synth E20 · P29 · K4', name: 'เคยติดแบล็คลิสต์ → ไม่เช็คบูโรแต่ทุกเคสต้องพิจารณา + [ให้เช็คก่อน | ดูรุ่นก่อน] → ให้เช็คก่อน = handoff',
    turns: [
      { user: 'เคยติดแบล็คลิสต์ ผ่อนได้ไหมคะ', forbidTools: ['handoff_to_human'], contains: ['ไม่เช็คบูโร', 'ทุกเคสต้องพิจารณาก่อน', 'ให้เช็คก่อน', 'ดูรุ่นก่อน'], notContains: ['ผ่อนได้เลย', '5 นาที', 'ไม่ผ่าน', 'เลขบัตร', 'รูปบัตร'] },
      { user: 'ให้เช็คก่อน', expectTools: ['handoff_to_human'], notContains: ['ผ่อนได้เลย', '5 นาที', 'ไม่ผ่าน', 'เลขบัตร', 'รูปบัตร'] },
    ],
  },
  {
    anyMode: true,
    id: 'E21', source: 'synth E21 · P17', name: 'ผ่อนกับร้านหรือไฟแนนซ์ → ผ่อนได้หลายแบบ ไม่เช็คบูโร + ถามรุ่น → ขอชื่อบริษัท = handoff',
    turns: [
      { user: 'นี่ผ่อนกับร้านหรือไฟแนนซ์คะ', forbidTools: ['handoff_to_human'], contains: ['ผ่อนได้หลายแบบ', 'ไม่เช็คบูโร'], match: [/รุ่น/], notContains: ['ไฟแนนซ์', 'บริษัทสินเชื่อ', 'ลีสซิ่ง', 'จำกัด'] },
      { user: 'ขอชื่อบริษัทหน่อยค่ะ', expectTools: ['handoff_to_human'], notContains: ['ไฟแนนซ์', 'บริษัทสินเชื่อ', 'ลีสซิ่ง', 'จำกัด'] },
    ],
  },
  {
    anyMode: true,
    id: 'E22', source: 'synth E22 · P19', name: 'รับซื้อ iPhone 16 128GB → รับซื้อได้ถึงประมาณ (tool) + [ขายเลย | เทิร์นเครื่องใหม่] → ต่อราคา = ประเมินจากเครื่องจริง',
    turns: [
      { user: 'รับซื้อไอโฟนไหมคะ', forbidTools: ['handoff_to_human', 'capture_lead'] },
      { user: 'iPhone 16 128GB ค่ะ', expectTools: ['compare_devices'], forbidTools: ['handoff_to_human', 'capture_lead'], contains: ['รับซื้อได้ถึงประมาณ', '15,500', 'ประเมินจากเครื่องที่ร้าน', 'ขายเลย', 'เทิร์นเครื่องใหม่'], notContains: ['48MP', 'A18', 'Dynamic Island', 'USB-C'] },
      { user: 'ขอเพิ่มเป็น 19,000 ได้ไหม', forbidTools: ['handoff_to_human', 'capture_lead'], contains: ['ราคาสุดท้ายทีมงานประเมินจากเครื่องจริง'], notContains: ['19,000', '19000', 'ได้ค่ะ'] },
    ],
  },
  {
    anyMode: true, deferred: 'รอ P25 + K5 (กลัวมิจฉาชีพ/ไม่กล้าส่งบัตร — P1 รอบหน้า)',
    id: 'E23', source: 'synth E23 · P25 · K5', name: 'กลัวมิจฉาชีพเอาบัตร → หน้าร้านจริง + ยังไม่ต้องโอน + คำถามเดียว ไม่ handoff',
    turns: [
      { user: 'กลัวมิจฉาชีพหลอกเอาบัตรค่ะ', forbidTools: ['handoff_to_human'], contains: ['หน้าร้านจริง', 'ยังไม่ต้องโอน'], notContains: ['ไม่ต้องใช้บัตร'], notMatch: [/\d+\s*รีวิว|\d+\s*ปี/] },
      { user: 'ไม่กล้าส่งรูปบัตรในแชทอะค่ะ', forbidTools: ['handoff_to_human'], notContains: ['ไม่ต้องใช้บัตร'], notMatch: [/\d+\s*รีวิว|\d+\s*ปี/] },
    ],
  },
  {
    anyMode: true,
    id: 'E24', source: 'synth E24 · P15 · P18', name: 'ลูกค้าเก่าส่งรูป + "โอนค่างวดแล้ว งวดหน้าวันไหน" → ได้รับรูปแล้ว + notify_staff + ขอชื่อ-นามสกุล ห้ามบอกวัน/ยอด',
    turns: [
      { user: IMAGE_INBOUND },
      // persona รอบ 3 (R2-service-image-ack) ตัดสินให้แล้วว่า "ลูกค้าส่งรูป/สลิปมาในบทสนทนานี้ = บรรทัดแรกต้องขึ้นต้นด้วย
      // ได้รับรูปแล้วค่ะ เสมอ ชนะบรรทัดแทนอันอื่น" ⇒ รับ "เรื่องวันครบกำหนด…" เฉย ๆ ไม่ได้ (ลูกค้าส่งสลิปมาแล้วบอทไม่รับรูป = ของจริงที่ต้องจับ)
      { user: 'โอนค่างวดแล้วนะคะ งวดหน้าต้องจ่ายวันไหนคะ', expectTools: ['notify_staff'], forbidTools: ['search_products', 'get_installment_rates', 'capture_lead'],
        contains: ['ได้รับรูปแล้ว', 'ชื่อ-นามสกุล'],
        notContains: ['ไฟแนนซ์', 'เลขบัญชี'], notMatch: [/(ทุก)?วันที่\s*\d{1,2}|\d{1,2}\s*(ต\.?ค\.?|ก\.?ย\.?|พ\.?ย\.?)/], noBigNumbers: true },
    ],
  },
  {
    anyMode: true,
    id: 'E25', source: 'synth E25 · P11', name: 'เครื่องนอกกับเครื่องไทยต่างกันยังไง → ครบ 4 เรื่อง + [เครื่องนอก | เครื่องไทย] ไม่เรียก compare_devices',
    turns: [
      { user: 'ฟรีดาวน์มีรุ่นไหนบ้าง?' },
      { user: 'เครื่องนอกกับเครื่องไทยต่างกันยังไงคะ', forbidTools: ['compare_devices'], contains: ['โมเดล', 'ดาวน์', '30 วัน', '60 วัน', 'eSIM', 'งวดแรก', '[ตัวเลือก:'],
        lastBubbleMatch: [/\[ตัวเลือก:[^\]]*เครื่องนอก[^\]]*เครื่องไทย/], notContains: ['เหมือนเครื่องไทย', 'คุ้มกว่า'], noBigNumbers: true },
    ],
  },
  {
    anyMode: true, deferred: 'รอ P27 + K7 (ประกันก่อนซื้อ / คืนเครื่อง — P1 รอบหน้า)',
    id: 'E26', source: 'synth E26 · P27 · K7', name: 'มีประกันร้านไหม → 1 ปี/60 วัน/30 วัน · ผ่อนไม่ไหวคืนเครื่องได้ไหม → ขึ้นกับวิธีซื้อ ไม่ handoff',
    turns: [
      { user: 'มีรับประกันร้านไหมคะ', forbidTools: ['handoff_to_human'], contains: ['1 ปี', '60 วัน', '30 วัน'], notContains: ['ประกันศูนย์ Apple', 'ซ่อมฟรี', '1,000'] },
      { user: 'ถ้าผ่อนไม่ไหว เอาเครื่องไปคืนได้ไหม', forbidTools: ['handoff_to_human'], contains: ['เงื่อนไขการคืนเครื่องขึ้นกับวิธีซื้อ'], notContains: ['ประกันศูนย์ Apple', 'ซ่อมฟรี', '1,000'] },
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

type CreateFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
interface BotDeps {
  create: CreateFn;
  system: string;
  tools: Anthropic.Tool[];
  mode: StockMode;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}
interface ToolCallLog { name: string; input: Record<string, unknown>; result: unknown }
interface BotTurnResult {
  text: string;
  toolsUsed: string[];
  calls: ToolCallLog[];
  attachments: BotAttachment[];
  confidence: number;
  /** reply | sideEffectOnly | pending(<เหตุ>) | staffFallback */
  path: string;
  guardBlocks: string[];
}

/** = SalesBotService.estimateConfidence (private) */
function confidenceOf(reply: string, toolsUsed: string[]): number {
  if (toolsUsed.includes('handoff_to_human')) return 0.3;
  if (!reply.trim()) return 0;
  if (toolsUsed.length === 0 && isBarePromise(reply)) return 0.6;
  if (toolsUsed.length > 0) return 0.95;
  return 0.9;
}

/**
 * หนึ่งเทิร์นของบอท = SalesBotService.generateReply (Claude provider) ทุกขั้น — ดูหัวไฟล์
 * history = แถวก่อนหน้าแบบที่ ai-auto-reply ส่งเป็น priorMessages (ข้อความล้วน ไม่มีผล tool ของเทิร์นก่อน)
 */
async function botReply(deps: BotDeps, history: Anthropic.MessageParam[], userText: string, now: Date): Promise<BotTurnResult> {
  // บรรทัดเวลาร้านนำหน้าเฉพาะข้อความล่าสุด (ประวัติเก็บข้อความดิบ)
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: `${shopClockLine(now)}\n${userText}` }];
  // Grounding ledger แบบเดียวกับ service: เลขในข้อความลูกค้า/ประวัติ + ผล tool ของเทิร์นนี้
  const grounded = new Set<number>();
  collectConversationNumbers(userText, grounded);
  for (const m of history) if (typeof m.content === 'string') collectConversationNumbers(m.content, grounded);
  const attachments = new Map<string, BotAttachment>();
  const toolsUsed: string[] = [];
  const calls: ToolCallLog[] = [];
  const guardBlocks: string[] = [];
  let groundingRetried = false;
  let pendingText: string | null = null;

  const finish = (text: string, path: string): BotTurnResult => ({
    text: stripStrayForeignScript(text),
    toolsUsed, calls, guardBlocks, path,
    attachments: [...attachments.values()].slice(0, MAX_BOT_ATTACHMENTS),
    confidence: confidenceOf(text, toolsUsed),
  });
  // ข้อความสำรองของพนักงาน — confidence 0.3 เสมอ ไม่มีรูปแนบ
  const staffFallback = (): BotTurnResult => ({
    text: staffFallbackReply(now), toolsUsed, calls, guardBlocks, path: 'staffFallback', attachments: [], confidence: 0.3,
  });
  const giveUp = (why: string): BotTurnResult => (pendingText ? finish(pendingText, `pending(${why})`) : staffFallback());

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const nextHopCanCallTools = hop + 1 < MAX_HOPS - 1;
    const resp = await deps.create({
      model: MODEL, max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: deps.system, cache_control: { type: 'ephemeral' } }],
      tools: deps.tools.map((t, i) => (i === deps.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t)),
      ...(hop === MAX_HOPS - 1 ? { tool_choice: { type: 'none' as const } } : {}),
      output_config: { effort: EFFORT },
      messages,
    });
    const toolCalls = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    // ClaudeProvider ใช้เฉพาะ text block แรก
    const text = resp.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';

    if (toolCalls.length === 0) {
      const grounding = guardGrounding(text, grounded);
      if (!grounding.ok) {
        guardBlocks.push(grounding.reason ?? 'blocked');
        if (pendingText) return giveUp('rewrite HALLUCINATION_BLOCKED');
        if (!groundingRetried && hop < MAX_HOPS - 1) {
          groundingRetried = true;
          messages.push({ role: 'assistant', content: text });
          messages.push({
            role: 'user',
            content: groundingGuardNote({ reason: grounding.reason ?? '', canCallTools: nextHopCanCallTools, stockMode: deps.mode, sideEffect: false }),
          });
          continue;
        }
        return staffFallback();
      }
      if (!text.trim()) return giveUp('EMPTY_REPLY');
      return finish(text, 'reply');
    }

    for (const tc of toolCalls) toolsUsed.push(tc.name);
    const executed = await Promise.all(
      toolCalls.map(async (tc) => ({ tc, result: await deps.runTool(tc.name, (tc.input ?? {}) as Record<string, unknown>) })),
    );
    // เก็บรูปแนบให้ครบทั้งรอบก่อน แล้วค่อยกระทบยอด send_rate_card กับช่องแนบจริง
    for (const { tc, result } of executed) {
      collectGroundedPrices(result, grounded);
      collectGroundedPricesFromToolText(tc.name, result, grounded);
      collectAttachmentsFromToolResult(tc.name, result, attachments);
    }
    const settled = executed.map(({ tc, result }) => ({
      tc,
      result: tc.name === 'send_rate_card' ? reconcileRateCardResult(result, attachments) : result,
    }));
    for (const { tc, result } of settled) calls.push({ name: tc.name, input: (tc.input ?? {}) as Record<string, unknown>, result });
    const textWasWritten = text.trim() !== '';
    const payloads: unknown[] = settled.map(({ tc, result }) => {
      const redacted = redactMediaUrls(result);
      const r = result as Partial<SendRateCardResult> | null;
      if (tc.name === 'send_rate_card' && Array.isArray(r?.missing) && r.missing.length > 0) {
        return withSystemNote(redacted, rateCardMissingNote({ missing: r.missing, sent: (r.sent ?? []).map((s) => s.card), textWasWritten }));
      }
      return redacted;
    });

    // คำตอบเขียนมาพร้อมเครื่องมือลงมือแทนล้วน — จบเทิร์นเฉพาะเมื่อสะอาดและตัวเลขผ่าน
    if (textWasWritten && settled.every(({ tc }) => SIDE_EFFECT_TOOL_NAMES.has(tc.name))) {
      const allClean = settled.every(({ tc, result }) => isCleanSideEffectResult(tc.name, result));
      const grounding = guardGrounding(text, grounded);
      if (allClean && grounding.ok) return finish(text, 'sideEffectOnly');
      if (grounding.ok) {
        const sentCards = [...attachments.keys()]
          .filter((k) => k.startsWith(RATE_CARD_ID_PREFIX))
          .map((k) => k.slice(RATE_CARD_ID_PREFIX.length));
        pendingText = stripUnsentImageClaims(text, sentCards) || pendingText;
      } else {
        guardBlocks.push(`sideEffect ${grounding.reason ?? 'blocked'}`);
        if (pendingText) return giveUp('sideEffect rewrite HALLUCINATION_BLOCKED');
        if (groundingRetried) return staffFallback();
        groundingRetried = true;
        payloads[payloads.length - 1] = withSystemNote(
          payloads[payloads.length - 1],
          groundingGuardNote({ reason: grounding.reason ?? '', canCallTools: nextHopCanCallTools, stockMode: deps.mode, sideEffect: true }),
        );
      }
    }

    if (SHOW) {
      settled.forEach(({ tc }, i) => {
        console.log(`      · tool ${tc.name} ${JSON.stringify(tc.input).slice(0, 200)}`);
        console.log(`        ↳ ${JSON.stringify(payloads[i]).slice(0, 300)}`);
      });
    }
    // ClaudeProvider.projectMessages: assistant = text block (ถ้ามี) + tool_use · ผล tool = user หนึ่งข้อความ
    messages.push({
      role: 'assistant',
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...toolCalls.map((tc) => ({ type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input })),
      ],
    });
    messages.push({
      role: 'user',
      content: settled.map(({ tc }, i) => ({ type: 'tool_result' as const, tool_use_id: tc.id, content: JSON.stringify(payloads[i]) })),
    });
  }
  return giveUp('MAX_TOOL_HOPS');
}

/**
 * แถวที่ router บันทึกหลังส่งคำตอบ (= ประวัติที่บอทเห็นเทิร์นถัดไป): ตัดปุ่มท้าย · แตกก้อนตาม --- (≤4) ·
 * รูปแนบจดเป็น "[รูป <label>]" (มีปุ่ม = ส่งรูปก่อนก้อนสุดท้าย)
 */
function historyRowsForReply(reply: string, attachments: BotAttachment[]): Anthropic.MessageParam[] {
  let replyText = reply;
  const qr = replyText.match(/\n?\s*\[ตัวเลือก:\s*([^\]]+)\]\s*$/);
  if (qr) replyText = replyText.slice(0, qr.index).trimEnd();
  const bubbles = replyText.split(/\n\s*---+\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const parts = bubbles.length > 0 ? bubbles : [replyText];
  const images = attachments.filter((a) => !!a.imageUrl).slice(0, MAX_BOT_ATTACHMENTS).map((a) => (a.label ? `[รูป ${a.label}]` : '[image]'));
  const imagesBeforeLast = !!qr && images.length > 0;
  const rows: string[] = [];
  parts.forEach((p, i) => {
    if (imagesBeforeLast && i === parts.length - 1) rows.push(...images);
    rows.push(p);
  });
  if (!imagesBeforeLast) rows.push(...images);
  return rows.filter((r) => r.trim()).map((content) => ({ role: 'assistant' as const, content }));
}

function checkTurn(
  sc: Scenario,
  turn: Turn,
  res: BotTurnResult,
  ctx: { isLastTurn: boolean; spoken: Set<number> },
): string[] {
  const text = res.text;
  const fails: string[] = turn.skipGlobal ? [] : [...globalChecks(text, ctx.spoken)];
  const expectsHandoff = !!turn.expectTools?.includes('handoff_to_human');
  // ลูกค้าเห็นอะไรจริง: confidence ต่ำกว่าเกณฑ์ = router ทิ้งคำตอบนี้แล้วส่งข้อความรอแอดมิน + ส่งต่อพนักงาน
  if (res.path === 'staffFallback') {
    fails.push(`บอทยอมแพ้ → ข้อความสำรองพนักงาน (${res.guardBlocks.join(' / ') || 'ว่าง/หมดรอบ'})`);
  } else if (res.confidence < CONF_THRESHOLD && !expectsHandoff) {
    fails.push(`ลูกค้าไม่เห็นคำตอบนี้: confidence ${res.confidence} < ${CONF_THRESHOLD} → ระบบส่งข้อความรอแอดมิน + ส่งต่อพนักงานแทน`);
  }
  if (res.toolsUsed.includes('handoff_to_human') && !ctx.isLastTurn) {
    fails.push('handoff_to_human ก่อนจบฉาก — ระบบจริงหยุดบอททั้งห้อง เทิร์นถัดไปไม่มีคำตอบ');
  }
  for (const t of turn.expectTools ?? []) if (!res.toolsUsed.includes(t)) fails.push(`ไม่ได้เรียก tool: ${t}`);
  for (const t of turn.forbidTools ?? []) if (res.toolsUsed.includes(t)) fails.push(`เรียก tool ที่ห้าม: ${t}`);
  for (const e of turn.expectCalls ?? []) {
    if (!res.calls.some((c) => c.name === e.tool && JSON.stringify(c.input).includes(e.inputIncludes))) {
      fails.push(`ไม่ได้เรียก ${e.tool} ที่มี "${e.inputIncludes}"`);
    }
  }
  if (turn.expectToolOrder) {
    const idx = turn.expectToolOrder.map((t) => res.toolsUsed.indexOf(t));
    if (idx.some((i) => i < 0) || idx.some((v, i) => i > 0 && v < idx[i - 1])) {
      fails.push(`ลำดับ tool ต้องเป็น ${turn.expectToolOrder.join(' → ')} (ได้ ${res.toolsUsed.join(',') || '-'})`);
    }
  }
  for (const intent of turn.forbidKbHits ?? []) {
    const hit = res.calls.some((c) => c.name === 'search_knowledge_base' && ((c.result as { matches?: KbMatch[] })?.matches ?? []).some((m) => m.intent === intent));
    if (hit) fails.push(`ผลค้น KB มีแถวที่ห้าม: ${intent}`);
  }
  for (const s of turn.contains ?? []) if (!text.includes(s)) fails.push(`ขาด: "${s}"`);
  for (const s of turn.notContains ?? []) if (text.includes(s)) fails.push(`ห้ามมีแต่มี: "${s}"`);
  for (const re of turn.match ?? []) if (!re.test(text)) fails.push(`ไม่ตรงรูปแบบ: ${re}`);
  for (const re of turn.notMatch ?? []) if (re.test(text)) fails.push(`ห้ามตรงรูปแบบแต่ตรง: ${re}`);
  const bubbles = splitBubbles(text);
  for (const s of turn.firstBubbleContains ?? []) if (!bubbles[0].includes(s)) fails.push(`ก้อนแรกขาด: "${s}"`);
  for (const re of turn.lastBubbleMatch ?? []) if (!re.test(bubbles[bubbles.length - 1])) fails.push(`ก้อนสุดท้ายไม่ตรง: ${re}`);
  if (turn.wantButtons && !text.includes('[ตัวเลือก:')) fails.push('ไม่มีปุ่มกด');
  if (sc.promoSilent && /เครื่องนอก|ฟรีดาวน์/.test(text)) fails.push('เอ่ยถึงเครื่องนอก/ฟรีดาวน์เองในฉากที่ไม่เกี่ยวกับโปร');
  if (turn.noBigNumbers) {
    const min = typeof turn.noBigNumbers === 'number' ? turn.noBigNumbers : 1000;
    const nums = moneyNumbers(text, min);
    if (nums.length) fails.push(`มีตัวเลขเงิน (≥${min}) ทั้งที่ยังไม่ควรมี: ${nums.join(',')}`);
  }
  if (turn.allowedMonthly) {
    const allowed = new Set(turn.allowedMonthly);
    for (const m of text.matchAll(MONTHLY_RE)) {
      const n = Number(m[1].replace(/,/g, ''));
      if (!allowed.has(n)) fails.push(`ค่างวด ${n.toLocaleString('en-US')} ไม่อยู่ในชุดที่ถูก (${turn.allowedMonthly.join('/')})`);
    }
  }
  if (turn.cardUnder) {
    const headers = [...new Set(turn.cardUnder.map((c) => c.header))];
    const lines = text.split('\n');
    for (const { header, value } of turn.cardUnder) {
      const idx = lines.findIndex((l) => l.includes(value));
      if (idx < 0) continue; // "ขาด" รายงานโดย contains แล้ว
      let owner: string | null = null;
      for (let i = idx; i >= 0 && !owner; i--) owner = headers.find((h) => lines[i].includes(h)) ?? null;
      if (owner !== header) fails.push(`"${value}" ไม่ได้อยู่ใต้หัวการ์ด "${header}" (อยู่ใต้ ${owner ?? 'ไม่มีหัว'})`);
    }
  }
  return fails;
}

/** prod ส่ง priorMessages แค่ 16 แถวล่าสุด (ai-auto-reply) — eval เก็บเต็มแทนสมุดสถานะที่สกัดด้วย LLM (ดูหัวไฟล์) */
const PROD_HISTORY_ROWS = 16;

async function runScenario(sc: Scenario, deps: BotDeps, label: string): Promise<{ checks: number; fails: number }> {
  console.log(`━━ ${label}: ${sc.name}`);
  // fidelity เท่ากับ prod: ประวัติข้ามเทิร์นเก็บเฉพาะ "ข้อความ" (ai-auto-reply สร้าง priorMessages
  // จาก chat_messages) — ผล tool ของเทิร์นก่อนหายไป บอทต้องเรียกใหม่เอง
  const transcript: Anthropic.MessageParam[] = [...(sc.history ?? [])];
  let checks = 0;
  let failed = 0;
  let wideHistoryWarned = false;
  for (let ti = 0; ti < sc.turns.length; ti++) {
    const turn = sc.turns[ti];
    const now = new Date(turn.clockIso ?? sc.clockIso ?? DAY_CLOCK);
    const history = [...transcript];
    // เตือนเมื่อฉากยาวเกินหน้าต่างของ prod — เทิร์นถัดจากนี้บอทเห็นบริบท (และเลขที่ "มีที่มา") มากกว่าบน prod
    if (!wideHistoryWarned && history.length > PROD_HISTORY_ROWS) {
      wideHistoryWarned = true;
      console.log(`  ⚠ ประวัติ ${history.length} แถว > ${PROD_HISTORY_ROWS} แถวที่ prod ส่งจริง — เทิร์นต่อจากนี้บอทเห็นบริบทมากกว่า prod (อ่านผลโดยเผื่อข้อนี้)`);
    }
    // เลขที่พูดกันในห้องแล้ว (ประวัติ + ข้อความลูกค้าเทิร์นนี้) มีที่มาเหมือน GroundingGuard — ไม่รวมคำตอบของเทิร์นนี้เอง
    const spoken = new Set<number>();
    collectConversationNumbers(turn.user, spoken);
    for (const m of history) if (typeof m.content === 'string') collectConversationNumbers(m.content, spoken);
    const res = await botReply(deps, history, turn.user, now);
    transcript.push({ role: 'user', content: turn.user });
    transcript.push(...historyRowsForReply(res.text, res.attachments));
    const fails = checkTurn(sc, turn, res, { isLastTurn: ti === sc.turns.length - 1, spoken });
    checks++;
    const tools = res.toolsUsed.join(',') || '-';
    const via = res.path === 'reply' ? '' : ` [${res.path}]`;
    if (fails.length) {
      failed++;
      console.log(`  ✗ "${turn.user.slice(0, 80)}" (tools: ${tools})${via}`);
      fails.forEach((f) => console.log(`      - ${f}`));
      console.log(`      ↳ reply: ${res.text.replace(/\n/g, ' / ').slice(0, 900)}`);
    } else {
      console.log(`  ✓ "${turn.user.slice(0, 80)}" (tools: ${tools})${via}`);
      // EVAL_SHOW=1 — พิมพ์คำตอบของเทิร์นที่ผ่านด้วย (ไว้อ่านถ้อยคำจริงก่อน apply persona)
      if (SHOW) console.log(`      ↳ reply: ${res.text.replace(/\n/g, ' / ').slice(0, 900)}`);
    }
  }
  return { checks, fails: failed };
}

// ───────────────────────── เลือกฉาก ─────────────────────────
type SetName = 'S' | 'NS' | 'E';
function setOf(id: string): SetName {
  if (/^NS\d/.test(id)) return 'NS';
  if (/^E\d/.test(id)) return 'E';
  return 'S';
}
function modeOk(sc: Scenario, noStock: boolean): boolean {
  return !!sc.anyMode || !!sc.noStock === noStock;
}
function selectScenarios(env: NodeJS.ProcessEnv, noStock: boolean): { run: Scenario[]; notes: string[] } {
  const includeDeferred = env.EVAL_INCLUDE_DEFERRED === '1';
  const tokens = (env.EVAL_ONLY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const run: Scenario[] = [];
  const notes: string[] = [];
  if (tokens.length > 0) {
    for (const sc of SCENARIOS) {
      const exact = tokens.includes(sc.id);
      const byPrefix = tokens.some((t) => t.endsWith('*') && sc.id.startsWith(t.slice(0, -1)));
      if (!exact && !byPrefix) continue;
      if (sc.deferred && !exact && !includeDeferred) {
        notes.push(`⏭ ${sc.id} ข้าม — ${sc.deferred} (ระบุชื่อเต็มหรือ EVAL_INCLUDE_DEFERRED=1 เพื่อรัน)`);
        continue;
      }
      const modeName = (ns: boolean) => (ns ? 'ไม่มีสต๊อก' : 'ปกติ');
      if (!modeOk(sc, noStock)) {
        // ชื่อเต็ม = ตั้งใจรันข้ามโหมด (เช่นวัด S4 ใต้ NO_STOCK) · เลือกด้วย * = ข้าม (กันผลตกปลอมจากโหมดผิด)
        if (!exact) {
          notes.push(`⏭ ${sc.id} ข้าม — ฉากโหมด${modeName(!!sc.noStock)} (ระบุชื่อเต็มเพื่อรันในโหมด${modeName(noStock)})`);
          continue;
        }
        notes.push(`⚠ ${sc.id} เป็นฉากโหมด${modeName(!!sc.noStock)} แต่รันในโหมด${modeName(noStock)} (สั่งผ่าน EVAL_ONLY)`);
      }
      run.push(sc);
    }
    for (const t of tokens) {
      if (!SCENARIOS.some((sc) => sc.id === t || (t.endsWith('*') && sc.id.startsWith(t.slice(0, -1))))) notes.push(`⚠ EVAL_ONLY "${t}" ไม่ตรงฉากไหน`);
    }
    return { run, notes };
  }
  const raw = (env.EVAL_SET ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const sets = new Set<SetName>(raw.includes('ALL') ? ['S', 'NS', 'E'] : raw.length ? (raw as SetName[]) : [noStock ? 'NS' : 'S']);
  for (const s of sets) if (!['S', 'NS', 'E'].includes(s)) notes.push(`⚠ EVAL_SET "${s}" ไม่รู้จัก (ใช้ S / NS / E / ALL)`);
  for (const sc of SCENARIOS) {
    if (!sets.has(setOf(sc.id))) continue;
    if (!modeOk(sc, noStock)) {
      if (setOf(sc.id) === 'E') notes.push(`⏭ ${sc.id} ข้าม — ฉากโหมด${sc.noStock ? 'ไม่มีสต๊อก (EVAL_NO_STOCK=1)' : 'ปกติ'}`);
      continue;
    }
    if (sc.deferred && !includeDeferred) {
      notes.push(`⏭ ${sc.id} ข้าม — ${sc.deferred}`);
      continue;
    }
    run.push(sc);
  }
  return { run, notes };
}

async function main() {
  if (process.env.EVAL_DRY === '1') {
    process.exit(await dryRun());
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ต้องมี ANTHROPIC_API_KEY');
  const persona = await loadPersona();
  // ต่อท้าย (ไม่แทรกกลาง) เหมือน SalesBotService ⇒ prefix ของ persona ยังเป็นก้อนเดียวกับโหมดปกติ
  const system = NO_STOCK ? `${persona}\n${NO_STOCK_PROMPT}` : persona;
  const cardKeys = Object.keys(RATE_CARDS).join('+') || 'ไม่มี (ไม่ประกาศ send_rate_card)';
  console.log(`bot-eval: model=${MODEL} effort=${EFFORT} persona=${system.length.toLocaleString()} chars · ${MODE} · รูปตาราง ${cardKeys} · KB ${KB.source}\n`);
  const client = new Anthropic();
  const deps: BotDeps = {
    create: (p) => client.messages.create(p),
    system,
    tools: TOOLS,
    mode: MODE,
    runTool: (name, input) => runFixtureTool(name, input, MODE),
  };
  const repeat = Math.max(1, Math.min(20, Number(process.env.EVAL_REPEAT ?? '1') || 1));
  const { run, notes } = selectScenarios(process.env, NO_STOCK);
  notes.forEach((n) => console.log(n));
  if (notes.length) console.log('');
  let totalChecks = 0;
  let totalFails = 0;
  const scenarioFails: string[] = [];
  for (const sc of run) {
    const runs = Math.max(sc.runs ?? 1, repeat);
    let failedRuns = 0;
    for (let r = 1; r <= runs; r++) {
      const { checks, fails } = await runScenario(sc, deps, runs > 1 ? `${sc.id} (รอบ ${r}/${runs})` : sc.id);
      totalChecks += checks;
      totalFails += fails;
      if (fails > 0) failedRuns++;
    }
    if (failedRuns > 0) scenarioFails.push(runs > 1 ? `${sc.id} (ตก ${failedRuns}/${runs} รอบ)` : sc.id);
  }
  console.log(`\nผล: ${totalChecks - totalFails}/${totalChecks} เทิร์นผ่าน · ฉากผ่านครบ ${run.length - scenarioFails.length}/${run.length}`);
  if (scenarioFails.length) console.log(`ฉากที่ตก: ${scenarioFails.join(', ')}`);
  if (totalFails > 0) process.exit(1);
}

// ───────────────────────── EVAL_DRY: ตรวจโดยไม่เรียก API / ไม่แตะ DB ─────────────────────────
type FakeResp = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };
function fakeCreate(script: FakeResp[], log: Anthropic.MessageCreateParamsNonStreaming[]): CreateFn {
  let i = 0;
  return async (params) => {
    log.push(JSON.parse(JSON.stringify(params)) as Anthropic.MessageCreateParamsNonStreaming);
    const r = script[i++] ?? { text: '' };
    const content = [
      ...(r.text !== undefined ? [{ type: 'text', text: r.text }] : []),
      ...(r.tools ?? []).map((t, k) => ({ type: 'tool_use', id: `toolu_${i}_${k}`, name: t.name, input: t.input })),
    ];
    return { content } as unknown as Anthropic.Message;
  };
}
function lastUserPayload(p: Anthropic.MessageCreateParamsNonStreaming): string {
  return JSON.stringify(p.messages[p.messages.length - 1]?.content ?? '');
}

async function dryRun(): Promise<number> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };

  // (1) โครงฉาก
  const ids = new Set<string>();
  const knownIds = new Set(SCENARIOS.map((s) => s.id));
  for (const sc of SCENARIOS) {
    const where = sc.id || '(ไม่มี id)';
    ok(/^(S|NS|E)\d+$/.test(sc.id), `${where}: id ต้องเป็น S<n> / NS<n> / E<nn>`);
    ok(!ids.has(sc.id), `${where}: id ซ้ำ`);
    ids.add(sc.id);
    ok(!!sc.name?.trim(), `${where}: ไม่มีชื่อ`);
    ok(Array.isArray(sc.turns) && sc.turns.length > 0, `${where}: ไม่มีเทิร์น`);
    ok(!(sc.noStock && sc.anyMode), `${where}: noStock กับ anyMode ใช้พร้อมกันไม่ได้`);
    ok(sc.runs === undefined || (Number.isInteger(sc.runs) && sc.runs >= 1 && sc.runs <= 10), `${where}: runs ต้องเป็น 1-10`);
    ok(sc.deferred === undefined || sc.deferred.trim().length > 0, `${where}: deferred ต้องบอกเหตุผล`);
    ok(setOf(sc.id) !== 'NS' || !!sc.noStock, `${where}: ฉาก NS ต้องตั้ง noStock`);
    ok(setOf(sc.id) !== 'E' || !!sc.source, `${where}: ฉาก E ต้องบอก source (ที่มาใน synth)`);
    if (sc.clockIso) ok(!Number.isNaN(Date.parse(sc.clockIso)), `${where}: clockIso ไม่ใช่วันที่`);
    for (const h of sc.history ?? []) ok((h.role === 'user' || h.role === 'assistant') && !!h.content?.trim(), `${where}: history แถวผิดรูป`);
    // เลขที่ลูกค้าพิมพ์ในฉาก = มีที่มา (เหมือน GroundingGuard)
    const typed = new Set<number>();
    for (const h of sc.history ?? []) collectConversationNumbers(h.content, typed);
    for (const t of sc.turns) collectConversationNumbers(t.user, typed);
    const exactGrounded = (n: number) => GROUNDED.includes(n) || typed.has(n);
    sc.turns.forEach((t, i) => {
      const at = `${where} เทิร์น ${i + 1}`;
      ok(typeof t.user === 'string' && t.user.trim().length > 0, `${at}: user ว่าง`);
      if (t.clockIso) ok(!Number.isNaN(Date.parse(t.clockIso)), `${at}: clockIso ไม่ใช่วันที่`);
      const toolRefs = [...(t.expectTools ?? []), ...(t.forbidTools ?? []), ...(t.expectCalls ?? []).map((c) => c.tool), ...(t.expectToolOrder ?? [])];
      for (const name of toolRefs) ok(ALL_TOOL_NAMES.has(name), `${at}: ไม่มีเครื่องมือชื่อ ${name}`);
      for (const name of [...(t.expectTools ?? []), ...(t.expectCalls ?? []).map((c) => c.tool), ...(t.expectToolOrder ?? [])]) {
        ok(!(t.forbidTools ?? []).includes(name), `${at}: ${name} ทั้งบังคับและห้าม`);
      }
      for (const s of t.contains ?? []) ok(!(t.notContains ?? []).some((n) => s.includes(n)), `${at}: "${s}" ขัดกับ notContains`);
      for (const s of t.firstBubbleContains ?? []) ok(!(t.notContains ?? []).some((n) => s.includes(n)), `${at}: ก้อนแรก "${s}" ขัดกับ notContains`);
      const requiredNumbers = [
        ...(t.contains ?? []).flatMap((s) => moneyNumbers(s, 500)),
        ...(t.cardUnder ?? []).flatMap((c) => moneyNumbers(c.value, 500)),
        ...(t.allowedMonthly ?? []),
      ];
      for (const n of requiredNumbers) ok(exactGrounded(n), `${at}: เลข ${n} ที่ฉากต้องการไม่อยู่ใน fixture (GROUNDED) — บอทพูดแล้วจะตกด่านเลขไม่มีที่มา`);
      if (t.noBigNumbers) {
        const min = typeof t.noBigNumbers === 'number' ? t.noBigNumbers : 1000;
        for (const s of t.contains ?? []) ok(moneyNumbers(s, min).length === 0, `${at}: contains "${s}" มีเลข ≥${min} ขัดกับ noBigNumbers`);
      }
      for (const c of t.cardUnder ?? []) ok((t.contains ?? []).includes(c.value), `${at}: cardUnder "${c.value}" ควรอยู่ใน contains ด้วย (ไม่งั้นขาดแล้วไม่ถูกรายงาน)`);
    });
  }
  for (let n = 1; n <= 26; n++) {
    const id = `E${String(n).padStart(2, '0')}`;
    ok(knownIds.has(id), `ขาดฉาก ${id} (synth eval_scenarios)`);
  }

  // (2) นิยามเครื่องมือ = ของ service + ชุดรูป prod
  const prodCards = parseRateCards(PROD_RATE_CARDS_JSON);
  const prodTool = buildSendRateCardTool(prodCards);
  ok(!!prodTool, 'send_rate_card ต้องถูกประกาศเมื่อมีรูปตั้งไว้');
  ok(
    JSON.stringify(prodTool?.input_schema.properties.cards.items.enum) === JSON.stringify(['imported_free_down', 'shop_map']),
    `send_rate_card enum ต้องเป็น imported_free_down,shop_map (ได้ ${prodTool?.input_schema.properties.cards.items.enum})`,
  );
  ok(!!prodTool && Object.values(prodCards).every((c) => prodTool.description.includes(c.label)), 'คำอธิบาย send_rate_card ต้องมี label ของรูปทุกใบ');
  const svcNames = SalesBotService.buildToolDefinitions({ rateCards: prodCards, notifyStaff: true }).map((t) => t.name);
  ok(
    JSON.stringify(svcNames) === JSON.stringify(['search_products', 'calculate_installment', 'list_promotions', 'handoff_to_human', 'capture_lead', 'get_installment_rates', 'search_knowledge_base', 'recommend_devices', 'compare_devices', 'send_rate_card', 'notify_staff']),
    `ลำดับเครื่องมือของ service เปลี่ยน: ${svcNames.join(',')}`,
  );
  ok(!SalesBotService.buildToolDefinitions({ rateCards: {}, notifyStaff: true }).some((t) => t.name === 'send_rate_card'), 'ไม่มีรูป = ต้องไม่ประกาศ send_rate_card');
  if (!process.env.EVAL_RATE_CARDS) {
    ok(JSON.stringify(TOOLS.map((t) => t.name)) === JSON.stringify(svcNames), 'TOOLS ของ eval ต้องตรงกับ service (ชุดรูป prod)');
  } else if (Object.keys(RATE_CARDS).length === 0) {
    warnings.push('EVAL_RATE_CARDS ว่าง/อ่านไม่ได้ → ไม่ประกาศ send_rate_card');
  }
  // เทียบกับค่าที่ SQL จะตั้งบน prod
  if (existsSync(APPLY_SQL_PATH)) {
    const sql = readFileSync(APPLY_SQL_PATH, 'utf8');
    const m = sql.match(/'shop_bot_rate_cards',\s*\$C\$([\s\S]*?)\$C\$/);
    if (!m) warnings.push('ไม่พบค่า shop_bot_rate_cards ใน apply-bot-tune-2026-09-22.sql');
    else ok(JSON.stringify(parseRateCards(m[1])) === JSON.stringify(prodCards), 'ชุดรูปของ eval ไม่ตรงกับ shop_bot_rate_cards ใน apply SQL');
  } else {
    warnings.push(`ไม่พบไฟล์ ${APPLY_SQL_PATH} — ข้ามการเทียบชุดรูปกับ SQL`);
  }

  // (3) fixture
  const rc = (await makeRateCardTool(prodCards).run({ cards: ['used_rate1', 'used_rate2', 'new_rate1', 'new_rate2'] })) as SendRateCardResult;
  ok(rc.sent.length === 0 && ['used_rate1', 'used_rate2', 'new_rate1', 'new_rate2'].every((k) => rc.missing.includes(k)), `send_rate_card: used/new_rate ต้องเป็น missing (TOOLLOOP-1) — ได้ ${JSON.stringify(rc)}`);
  const rc2 = (await makeRateCardTool(prodCards).run({ cards: ['imported_free_down', 'shop_map'] })) as SendRateCardResult;
  ok(rc2.sent.length === 2 && rc2.missing.length === 0, 'send_rate_card: imported_free_down + shop_map ต้องส่งได้');
  const rc3 = (await makeRateCardTool(prodCards).run({ cards: [] })) as SendRateCardResult;
  ok(rc3.sent.length === 0 && rc3.missing.length === 1, 'send_rate_card: ไม่ระบุรูป = missing (NO_CARD_REQUESTED)');
  const monthlies = (r: unknown) => ((r as { templates: { rate1: { monthlyPrice: number }; rate2: { monthlyPrice: number } }[] }).templates ?? []).map((t) => `${t.rate1.monthlyPrice}/${t.rate2.monthlyPrice}`);
  ok(JSON.stringify(monthlies(runRates({ query: 'iPhone 16 Pro Max 256GB', condition: 'มือสอง' }))) === JSON.stringify(['3793/4171']), 'rates: 16 PM 256GB มือสอง ต้องได้ 3793/4171');
  ok(JSON.stringify(monthlies(runRates({ query: 'iPhone 17 Pro Max 256GB', condition: 'มือ 1' }))) === JSON.stringify(['5917/5712']), 'rates: 17 PM 256GB มือ 1 ต้องได้ 5917/5712');
  ok(monthlies(runRates({ query: 'iPhone 18 Pro Max' })).length === 0, 'rates: iPhone 18 ต้องว่าง');
  const r16 = runRates({ query: 'iPhone 16 128GB' }) as { templates: { condition: string }[] };
  ok(r16.templates[0]?.condition === 'มือ 1' && r16.templates[1]?.condition === 'มือสอง', 'rates: แถวแฝดต้องออกมือ 1 ก่อน');
  ok(runRates({ query: 'iPhone 15', deviceOrigin: 'IMPORTED' }).templates.length === 0, 'rates: IMPORTED ต้องว่าง (ตารางยังไม่ติดป้าย)');
  ok(runRates({ query: 'iPhone 15', deviceOrigin: 'THAI' }).templates.length > 0, 'rates: THAI ต้องรวมแถว UNSPECIFIED');
  const recNs = (await runFixtureTool('recommend_devices', { currentModel: 'iPhone 12', downBudget: 3000, monthlyBudget: 2000 }, 'NO_STOCK')) as { recommended: Record<string, unknown>[]; stockNote?: string };
  ok(recNs.recommended.length > 0 && recNs.recommended.every((d) => !('inStock' in d) && !('unitCount' in d) && !('sampleUnit' in d)) && !!recNs.stockNote, 'recommend NO_STOCK: ต้องไม่มี inStock/unitCount/sampleUnit และมี stockNote (TOOLLOOP-4)');
  const recLive = (await runFixtureTool('recommend_devices', { currentModel: 'iPhone 12', downBudget: 3000, monthlyBudget: 2000 }, 'LIVE')) as { recommended: Record<string, unknown>[] };
  ok(recLive.recommended.every((d) => 'inStock' in d), 'recommend LIVE: ต้องยังมีฟิลด์สต๊อก');
  const recMiss = (await runFixtureTool('recommend_devices', { currentModel: 'iPhone 12', downBudget: 1000, monthlyBudget: 2000 }, 'LIVE')) as { recommended: unknown[]; nearMiss: { overBy: { down: number } }[] };
  ok(recMiss.recommended.length === 0 && recMiss.nearMiss[0]?.overBy.down === 1500, 'recommend: ดาวน์เกินงบต้องได้ nearMiss overBy.down 1500 (S30/P23)');
  ok((await runFixtureTool('search_products', { query: 'iPhone 16' }, 'NO_STOCK')) === NO_STOCK_TOOL_RESULT, 'NO_STOCK: search_products ต้องคืน NO_STOCK_TOOL_RESULT');
  const thai16 = runSearchProducts({ query: 'iPhone 16', deviceOrigin: 'THAI' });
  ok(thai16.groups.flatMap((g) => g.units).every((u) => u.deviceOrigin === 'THAI') && thai16.totalMatches === 2, 'search_products THAI ต้องไม่มีเครื่องนอก');
  ok(runSearchProducts({ query: 'iPhone 16' }).groups.length === 2, 'search_products: เครื่องไทยกับเครื่องนอกต้องแยกกลุ่ม');
  const kbTop = (q: string) => runKb({ query: q }).matches.map((m) => m.intent);
  ok(kbTop('ทำสัญญาออนไลน์ได้ไหม')[0] === 'faq_no_delivery_pickup_only', `KB: "ทำสัญญาออนไลน์ได้ไหม" ต้องได้แถวจัดส่ง (K1) — ได้ ${kbTop('ทำสัญญาออนไลน์ได้ไหม')}`);
  ok(!kbTop('iPhone 18 Pro Max ผ่อนเท่าไหร่').includes('age_requirement'), 'KB: iPhone 18 ต้องไม่ได้แถวอายุ (K4)');
  ok(kbTop('เคยติดแบล็คลิสต์ ผ่อนได้ไหม')[0] === 'credit_history', `KB: แบล็คลิสต์ต้องได้ credit_history — ได้ ${kbTop('เคยติดแบล็คลิสต์ ผ่อนได้ไหม')}`);
  ok(kbTop('ร้านปิดกี่โมง')[0] === 'store_location_hours', `KB: ร้านปิดกี่โมง ต้องได้แถวที่ตั้ง — ได้ ${kbTop('ร้านปิดกี่โมง')}`);
  ok(kbTop('อายุ 18 ผ่อนได้ไหม')[0] === 'age_requirement', `KB: อายุ 18 ต้องได้แถวอายุ — ได้ ${kbTop('อายุ 18 ผ่อนได้ไหม')}`);
  ok(kbTop('ฟรีดาวน์มีรุ่นไหนบ้าง')[0] === 'promo_imported_free_down', `KB: ฟรีดาวน์ต้องได้แถวโปร — ได้ ${kbTop('ฟรีดาวน์มีรุ่นไหนบ้าง')}`);
  ok(!globalChecks('อัปเกรดเป็น 16 ดีกว่าค่ะ', new Set()).some((f) => f.includes('เกรด')) && !globalChecks('อัพเกรดได้เลยค่ะ', new Set()).some((f) => f.includes('เกรด')), 'คำต้องห้าม: "อัปเกรด/อัพเกรด" ต้องไม่ติด "เกรด"');
  ok(globalChecks('เครื่องเกรด A ค่ะ', new Set()).some((f) => f.includes('"เกรด"')), 'คำต้องห้าม: "เกรด A" ต้องติด');
  for (const w of ['UNSPECIFIED', 'IMPORTED', 'THAI']) ok(globalChecks(`แถวนี้ ${w} ค่ะ`, new Set()).some((f) => f.includes(w)), `คำต้องห้าม: ${w} ต้องติด`);
  ok(!globalChecks('แผนที่ https://maps.app.goo.gl/bqGcmr5FupWLw1378', new Set()).some((f) => f.includes('เลขไม่มีที่มา')), 'เลขใน URL ต้องไม่ถูกนับเป็นราคา');
  ok(!globalChecks('ขอเพิ่มเป็น 19,000 ใช่ไหมคะ', new Set([19000])).some((f) => f.includes('เลขไม่มีที่มา')), 'เลขที่ลูกค้าพิมพ์ต้องนับว่ามีที่มา');
  // ตัวคั่นก้อนต้องใช้กติกาเดียวกับ MessageRouterService ทุกด่าน ('----' / '--- ' router ก็แตกให้)
  for (const sep of ['\n---\n', '\n----\n', '\n--- \n']) {
    const twoBubbles = [1, 2].map((n) => [1, 2, 3].map(() => `${'ก'.repeat(59)}${n}`).join('\n')).join(sep);
    ok(
      !globalChecks(twoBubbles, new Set()).some((f) => f.includes('บับเบิล') || f.includes('บรรทัด')),
      `ก้อน: ตัวคั่น ${JSON.stringify(sep)} ต้องนับเป็นคนละก้อน — ได้ ${JSON.stringify(globalChecks(twoBubbles, new Set()))}`,
    );
  }
  ok(!!(await runFixtureTool('capture_lead', { downAmount: 0 }, 'LIVE') as { handoffMessage: string }).handoffMessage.includes('คำสั่งซื้อนี้เท่านั้น'), 'capture_lead: handoffMessage ต้องมีประโยคแจ้งสิทธิ์ข้อมูล');

  // (4) ลูปเครื่องมือ (โมเดลปลอม)
  // ผูกชุดรูป prod ไว้ในด่านนี้เสมอ — ไม่อ่าน TOOLS/RATE_CARD_TOOL ที่ขึ้นกับ EVAL_RATE_CARDS
  // (เดิม EVAL_RATE_CARDS='{}' ที่หัวไฟล์บอกว่าลองได้ ทำให้ 2 ด่านที่ใช้รูปตกทั้งที่ไม่มีอะไรพัง)
  const loopDeps = (
    script: FakeResp[],
    log: Anthropic.MessageCreateParamsNonStreaming[],
    mode: StockMode = 'NO_STOCK',
    cards: RateCardsConfig = prodCards,
  ): BotDeps => {
    const cardTool = makeRateCardTool(cards);
    return {
      create: fakeCreate(script, log), system: 'persona', tools: toolsFor(cards), mode,
      runTool: (n, i) => runFixtureTool(n, i, mode, cardTool),
    };
  };
  const now = new Date(DAY_CLOCK);
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: 'โปรฟรีดาวน์เป็นเครื่องนอกค่ะ', tools: [{ name: 'send_rate_card', input: { cards: ['imported_free_down'] } }] }], log), [], 'ฟรีดาวน์มีรุ่นไหนบ้าง?', now);
    ok(r.path === 'sideEffectOnly' && log.length === 1 && r.attachments.some((a) => a.productId === `${RATE_CARD_ID_PREFIX}imported_free_down`) && r.confidence === 0.95, `ลูป: ส่งรูปสำเร็จต้องจบเทิร์นด้วยข้อความนั้น (ได้ ${r.path} hops=${log.length})`);
    const rows = historyRowsForReply('ก้อนแรก\n---\nพี่สนใจรุ่นไหนคะ [ตัวเลือก: iPhone 13 | iPhone 16]', r.attachments).map((m) => m.content);
    ok(JSON.stringify(rows) === JSON.stringify(['ก้อนแรก', '[รูป ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2 (เครื่องนอก)]', 'พี่สนใจรุ่นไหนคะ']), `ประวัติ: ต้องแตกก้อน ตัดปุ่ม และจดรูปก่อนก้อนสุดท้าย (ได้ ${JSON.stringify(rows)})`);
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([
      { tools: [{ name: 'get_installment_rates', input: { query: 'iPhone 15 128GB', condition: 'มือสอง' } }] },
      { text: 'เรทที่ 1 ดาวน์ 900 ผ่อนเดือนละ 2,424 บาท 12 งวด\nส่งตารางให้ดูนะคะ', tools: [{ name: 'send_rate_card', input: { cards: ['used_rate1'] } }] },
      { text: '' },
    ], log), [], 'เครื่องไทย ผ่อนค่ะ', now);
    ok(lastUserPayload(log[2]).includes('systemNote') && lastUserPayload(log[2]).includes('used_rate1'), 'ลูป: รูปส่งไม่ได้ต้องมี systemNote ในผล send_rate_card (TOOLLOOP-1)');
    ok(r.path.startsWith('pending') && r.text.includes('2,424') && !r.text.includes('ส่งตาราง'), `ลูป: รอบเขียนใหม่ว่าง → ข้อความเดิมที่ตัดบรรทัดอ้างรูป (ได้ ${r.path}: ${r.text})`);
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: 'ผ่อนเดือนละ 9,999 บาทค่ะ' }, { text: 'พี่สนใจรุ่นไหนคะ' }], log), [], 'ผ่อนเท่าไหร่', now);
    ok(r.path === 'reply' && r.text === 'พี่สนใจรุ่นไหนคะ' && lastUserPayload(log[1]).includes('SYSTEM GUARD') && r.guardBlocks.length === 1, 'ลูป: ตัวเลขไม่มีที่มา → SYSTEM GUARD แล้วเขียนใหม่');
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: 'ผ่อนเดือนละ 9,999 บาทค่ะ', tools: [{ name: 'notify_staff', input: { reason: 'x' } }] }, { text: 'เดี๋ยวแอดมินเช็คเรทให้นะคะ' }], log), [], 'ขอเรท iPhone 18', now);
    ok(r.path === 'reply' && lastUserPayload(log[1]).includes('SYSTEM GUARD'), 'ลูป: ตัวเลขไม่ผ่านพร้อมเครื่องมือลงมือแทน → SYSTEM GUARD ในผลเครื่องมือ (TOOLLOOP-3)');
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const script: FakeResp[] = [...Array(MAX_HOPS - 1)].map(() => ({ tools: [{ name: 'list_promotions', input: {} }] }));
    script.push({ text: 'ตอนนี้ไม่มีโปรเพิ่มค่ะ' });
    const r = await botReply(loopDeps(script, log, 'LIVE'), [], 'มีโปรไหม', now);
    ok(log.length === MAX_HOPS && JSON.stringify(log[MAX_HOPS - 1].tool_choice) === JSON.stringify({ type: 'none' }) && log.slice(0, -1).every((p) => !p.tool_choice) && r.path === 'reply', 'ลูป: รอบที่ 6 ต้องบังคับ tool_choice none (รอบก่อนหน้าไม่บังคับ)');
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: '自 iPhone 16 ดีค่ะ' }], log), [], 'ดีไหม', now);
    ok(!/[一-鿿]/.test(r.text), 'ลูป: ต้องตัดอักษรจีน/ญี่ปุ่น/เกาหลี (stripStrayForeignScript)');
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: 'ให้ทีมงานดูให้นะคะ', tools: [{ name: 'handoff_to_human', input: { reason: 'x' } }] }, { text: 'ส่งต่อทีมงานแล้วค่ะ' }], log), [], 'ขอชื่อบริษัท', now);
    ok(r.confidence === 0.3, 'ลูป: handoff_to_human ต้องได้ confidence 0.3');
  }
  {
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([{ text: '' }], log), [], 'สวัสดี', now);
    ok(r.path === 'staffFallback' && r.confidence === 0.3, 'ลูป: คำตอบว่าง + ไม่มีข้อความค้าง → ข้อความสำรองพนักงาน');
  }
  {
    // ATTACH-1 ก: รูปสินค้าเต็มช่องแล้วขอรูปตาราง → ถอดรูปสินค้าที่ใส่ก่อนสุด รูปตารางยังนับว่าส่งแล้ว
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([
      { tools: [
        { name: 'search_products', input: { query: 'iPhone 15', condition: 'มือสอง' } },
        { name: 'send_rate_card', input: { cards: ['imported_free_down'] } },
      ] },
      { text: 'ส่งรูปเครื่องกับตารางให้แล้วนะคะ' },
    ], log, 'LIVE'), [], 'ขอดู iPhone 15 กับตารางผ่อนหน่อย', now);
    const ids = r.attachments.map((a) => a.productId);
    const cardRes = r.calls.find((c) => c.name === 'send_rate_card')?.result as SendRateCardResult;
    ok(
      ids.length === MAX_BOT_ATTACHMENTS && ids.includes(`${RATE_CARD_ID_PREFIX}imported_free_down`) &&
      ids.includes('p15a') && !ids.includes('p15b') &&
      cardRes.sent.map((s) => s.card).includes('imported_free_down') && cardRes.missing.length === 0,
      `ลูป: รูปตารางต้องเบียดรูปสินค้าที่ใส่ก่อนสุดและยังเป็น sent (ATTACH-1) — ได้ ${JSON.stringify(ids)} ${JSON.stringify(cardRes)}`,
    );
  }
  {
    // ATTACH-1 ข: ช่องเต็มด้วยรูปตารางแล้ว ขอรูปตารางใบที่สาม → reconcile ย้ายไป missing + systemNote (ชุดรูปสมมติ 3 ใบ)
    const threeCards = parseRateCards(
      '{"imported_free_down": {"storageKey": "eval/free-down.jpg", "label": "ตารางผ่อนฟรีดาวน์"}, ' +
      '"shop_map": {"storageKey": "eval/map.jpg", "label": "แผนที่ร้าน"}, ' +
      '"used_rate1": {"storageKey": "eval/used-rate1.jpg", "label": "ตารางมือสองเรทที่ 1"}}',
    );
    const log: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const r = await botReply(loopDeps([
      { tools: [{ name: 'send_rate_card', input: { cards: ['imported_free_down', 'shop_map'] } }] },
      { text: 'ส่งตารางเรทที่ 1 ให้อีกใบนะคะ', tools: [{ name: 'send_rate_card', input: { cards: ['used_rate1'] } }] },
      { text: 'เดี๋ยวแอดมินส่งตารางเรทที่ 1 ให้นะคะ' },
    ], log, 'NO_STOCK', threeCards), [], 'ขอตารางทั้งหมดเลยค่ะ', now);
    const second = r.calls.filter((c) => c.name === 'send_rate_card')[1]?.result as SendRateCardResult;
    ok(
      second.sent.length === 0 && second.missing.includes('used_rate1') &&
      lastUserPayload(log[2]).includes('systemNote') && lastUserPayload(log[2]).includes('used_rate1') &&
      r.attachments.length === MAX_BOT_ATTACHMENTS && r.attachments.every((a) => a.productId.startsWith(RATE_CARD_ID_PREFIX)),
      `ลูป: ช่องแนบเต็มด้วยรูปตาราง → ใบที่เกินต้องกลายเป็น missing (TOOLLOOP-2) — ได้ ${JSON.stringify(second)}`,
    );
  }

  // (5) รายงาน
  const bySet = (s: SetName) => SCENARIOS.filter((sc) => setOf(sc.id) === s).length;
  const deferred = SCENARIOS.filter((sc) => sc.deferred).map((sc) => sc.id);
  console.log(`EVAL_DRY: ${SCENARIOS.length} ฉาก (S ${bySet('S')} · NS ${bySet('NS')} · E ${bySet('E')}) · ${SCENARIOS.reduce((n, sc) => n + sc.turns.length, 0)} เทิร์น · รอรอบหน้า ${deferred.join(', ') || '-'}`);
  console.log(`  เครื่องมือ: ${TOOLS.map((t) => t.name).join(', ')}`);
  console.log(`  send_rate_card enum: ${JSON.stringify(TOOLS.find((t) => t.name === 'send_rate_card')?.input_schema.properties ?? {})}`.slice(0, 200));
  console.log(`  KB: ${KB.source} · GROUNDED ${GROUNDED.length} เลข`);
  const { run, notes } = selectScenarios(process.env, NO_STOCK);
  console.log(`  ค่าที่ตั้งตอนนี้ (${MODE}) จะรัน ${run.length} ฉาก: ${run.map((s) => s.id).join(', ') || '-'}`);
  notes.forEach((n) => console.log(`    ${n}`));
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  if (errors.length) {
    console.log(`\n✗ ${errors.length} ข้อผิดพลาด:`);
    errors.forEach((e) => console.log(`  - ${e}`));
    return 1;
  }
  console.log('\n✓ ผ่านทุกข้อ (ไม่ได้เรียก API / ไม่ได้แตะ DB)');
  return 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
