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

const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-5';
const EFFORT = (process.env.EVAL_EFFORT ?? 'medium') as 'low' | 'medium' | 'high';
const MAX_HOPS = 4;

// ───────────────────────── fixtures ─────────────────────────
// สต๊อกจำลอง: 15 128GB มือสอง 2 สภาพ + 14 128GB + (15 Plus ไม่มีของ — เทสโหมดรับออเดอร์)
const UNITS = {
  p15b: { id: 'p15b', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'B', color: 'ชมพู', batteryPct: 87, priceThb: 17500 },
  p15a: { id: 'p15a', model: 'iPhone 15', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 92, priceThb: 19900 },
  p14: { id: 'p14', model: 'iPhone 14', storage: '128GB', condition: 'USED', grade: 'A', color: 'ฟ้า', batteryPct: 90, priceThb: 13900 },
};
const CALC: Record<string, { downAmountThb: number; monthlyThb: number; termMonths: number }> = {
  p15b: { downAmountThb: 1750, monthlyThb: 1578, termMonths: 12 },
  p15a: { downAmountThb: 1990, monthlyThb: 1790, termMonths: 12 },
  p14: { downAmountThb: 1390, monthlyThb: 1245, termMonths: 12 },
};
const RATES_15PLUS = {
  templates: [
    {
      brand: 'Apple', model: 'iPhone 15 Plus', storage: '128GB', hasWarranty: false,
      rate1: { downPayment: 1900, monthlyPrice: 2566, termMonths: 12 },
      rate2: { downPayment: 3400, monthlyPrice: 2905, termMonths: 12 },
    },
    {
      brand: 'Apple', model: 'iPhone 15 Plus', storage: '256GB', hasWarranty: false,
      rate1: { downPayment: 1900, monthlyPrice: 2766, termMonths: 12 },
      rate2: { downPayment: 3600, monthlyPrice: 3105, termMonths: 12 },
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
  const q = String(input.query ?? '').toLowerCase();
  switch (name) {
    case 'search_products': {
      if (q.includes('plus') || q.includes('pro')) {
        return { query: { brand: 'Apple', model: input.query, storage: null, color: null }, totalMatches: 0, priceMissingCount: 0, groups: [] };
      }
      if (q.includes('14')) {
        return { query: { brand: 'Apple', model: 'iPhone 14', storage: null, color: null }, totalMatches: 1, priceMissingCount: 0, groups: [group([UNITS.p14])] };
      }
      if (q.includes('15')) {
        return { query: { brand: 'Apple', model: 'iPhone 15', storage: null, color: null }, totalMatches: 2, priceMissingCount: 0, groups: [group([UNITS.p15b, UNITS.p15a])] };
      }
      // ค้นกว้าง: คืนแคตตาล็อกย่อ
      return { query: { brand: null, model: input.query, storage: null, color: null }, totalMatches: 3, priceMissingCount: 0, groups: [group([UNITS.p15b, UNITS.p15a]), group([UNITS.p14])] };
    }
    case 'get_installment_rates':
      if (q.includes('plus')) return RATES_15PLUS;
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
        { id: 'faq:no-payslip-freelance', kw: ['สลิป', 'ฟรีแลนซ์', 'แม่ค้า', 'ขายของ', 'รับจ้าง', 'อิสระ'], t: 'ไม่ต้องมีสลิป ไม่ต้องมีบัตรเครดิตค่ะ 😊\nฟรีแลนซ์ แม่ค้าออนไลน์ รับจ้าง ผ่อนได้หมด\nมีเงินเข้าบัญชี → สเตทเม้นท์ 3 เดือน (เรทที่ 1)\nไม่มี → รูปตอนทำงาน (เรทที่ 2)' },
        { id: 'faq:age-requirement', kw: ['อายุ', 'กี่ปี', '18', '19', 'ผู้ปกครอง', 'นักเรียน'], t: 'อายุ 20 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ\n17-19 ผ่อนได้ แต่มีผู้ปกครองมาเซ็นด้วยวันรับเครื่อง\nต่ำกว่า 17 ยังทำสัญญาไม่ได้ค่ะ\nนักศึกษา มีผู้ปกครองค้ำให้ค่า' },
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
    default:
      return { error: 'unknown_tool' };
  }
}

// เลขที่ "มีที่มา" — เลียนแบบ GroundingGuard: เลข >=500 ในคำตอบต้องอยู่ในชุดนี้ (±5%)
const GROUNDED = [17500, 19900, 13900, 1750, 1578, 1990, 1790, 1390, 1245, 1900, 2566, 3400, 2905, 2766, 3600, 3105, 20686, 23470, 16330, 3000, 2000,
  // recommend_devices / compare_devices fixtures (ดาวน์ 2,500 ผ่อน 1,758 / ดาวน์ 3,000 ผ่อน 1,980 / เทิร์น 4,000)
  2500, 1758, 1980, 3500];

// ───────────────────────── checks ─────────────────────────
type Turn = { user: string; expectTools?: string[]; forbidTools?: string[]; contains?: string[]; notContains?: string[]; wantButtons?: boolean; noBigNumbers?: boolean };
type Scenario = { id: string; name: string; turns: Turn[] };

// 'เกรด' — คำสั่งเจ้าของ 2026-08-17: tool คืนเกรดมาได้ แต่ห้ามพิมพ์ให้ลูกค้า (บอก % แบตพอ)
const BANNED = ['ดอกเบี้ย', '%', 'GFIN', 'ผ่อนกับร้าน', 'เรทร้าน', 'สั่งเข้า', 'ครับ', '{customerName}', '{', 'เรียนคุณ', 'เกรด', 'QR', 'โอนมัดจำ', 'โอนดาวน์',
  // Responsible Lending (วิจัย 2026-08-24): ห้ามถ้อยคำกระตุ้นก่อหนี้ + ห้ามอ้างว่าไม่ล็อก/ดาวน์ 0
  'ไม่ต้องคิด', 'อยากได้ต้องได้', 'จองเลย', 'ดาวน์ 0 บาท', 'ไม่มีดอกเบี้ย', 'ดอก 0', 'ไม่ล็อกเครื่อง', 'ไม่มีล็อก'];

function globalChecks(reply: string): string[] {
  const fails: string[] = [];
  // "แบต 87%" เป็นการใช้ % ที่ถูกกติกา (สเปคแบต) — ตัดออกก่อนเช็คคำต้องห้าม
  const scrubbed = reply.replace(/แบต(?:เตอรี่)?\s*(?:เหลือ|ยังดี)?\s*\d+\s*%/g, 'แบตSPEC');
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
    id: 'S2', name: 'ถามดาวน์โดยไม่เลือกรุ่น → ต้องถามงบ',
    turns: [
      { user: 'ดาวน์เท่าไหร่', contains: ['งบดาวน์'], noBigNumbers: true },
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
    id: 'S13', name: 'objections: ไม่มีสลิป / อายุ 18 / โดนล็อกไหม / จ่ายช้า / ปิดยอดก่อน → ตอบจาก KB',
    turns: [
      { user: 'เป็นฟรีแลนซ์ ไม่มีสลิปเงินเดือน ผ่อนได้ไหม', expectTools: ['search_knowledge_base'], contains: ['สเตทเม้นท์', 'รูปตอนทำงาน'], notContains: ['ผ่านแน่', 'อนุมัติแน่นอน'], noBigNumbers: true },
      { user: 'อายุ 18 ผ่อนได้ไหม', contains: ['ผู้ปกครอง'], notContains: ['20 ปีขึ้นไปเท่านั้น'], noBigNumbers: true },
      { user: 'แล้วเครื่องโดนล็อกไหม', expectTools: ['search_knowledge_base'], contains: ['ค้างชำระ'], notContains: ['ไม่ล็อก', 'UFUND', 'Samsung Finance'], noBigNumbers: true },
      { user: 'ถ้าจ่ายช้าโดนอะไรบ้าง', expectTools: ['search_knowledge_base'], contains: ['50', '100', 'ค่าปรับ'], notContains: ['ต่อวัน', 'เดี๋ยวเช็คให้'], forbidTools: ['handoff_to_human'] },
      { user: 'ปิดยอดก่อนได้ไหม', expectTools: ['search_knowledge_base'], contains: ['ได้'], notContains: ['ดอกเบี้ย', '%', '50%'], noBigNumbers: true },
    ],
  },
  {
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
    id: 'S4', name: 'ของมีในสต๊อก 2 สภาพ → เทียบด้วยดาวน์+งวด',
    turns: [
      // ต้องบอกสีด้วย (เจ้าของสั่ง 2026-08-17) — fixture มี 2 เครื่อง: ชมพู กับ ฟ้า
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', expectTools: ['search_products'], contains: ['เงินสด', 'ผ่อน'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], notContains: ['17,500', '19,900'], contains: ['ผ่อนเดือนละ', 'ชมพู', 'ฟ้า'] },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-24: ลูกค้าซื้อสด ห้ามยิงเรทผ่อนใส่ — อ่านสัญญาณแล้วตอบราคาสดเลย
    id: 'S15', name: 'สัญญาณซื้อสด → ตอบราคาเงินสด ห้ามยัดเยียดผ่อน',
    turns: [
      { user: 'iPhone 15 128GB มือสอง ซื้อสดเท่าไหร่', expectTools: ['search_products'], contains: ['เงินสด', '17,500'], notContains: ['ดาวน์', 'ผ่อนเดือนละ', 'งบดาวน์'], forbidTools: ['get_installment_rates'] },
    ],
  },
  {
    id: 'S16', name: 'ไม่มีสัญญาณ → ถามแยกทาง 1 คำถามก่อนบอกตัวเลข',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เงินสด', 'ผ่อน', '[ตัวเลือก:'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], contains: ['ดาวน์', 'ผ่อนเดือนละ'] },
    ],
  },
  {
    id: 'S17', name: 'ซื้อสดแต่ไม่มีของ → บอกหาเข้ามาให้ + ทีมเช็คราคา ห้ามเดาราคา',
    turns: [
      { user: 'iPhone 15 Plus 128GB ราคาสดเท่าไหร่', contains: ['เช็ค'], notContains: ['สั่งเข้า', 'ดาวน์ 1,900', 'ผ่อนเดือนละ 2,566'], noBigNumbers: true },
    ],
  },
  {
    // เจ้าของสั่ง 2026-08-17: ลูกค้าขอความจุที่ร้านไม่มี (fixture มีแค่ 128/256GB)
    // → ต้องบอกว่าไม่มี + เสนอความจุที่มี + เทียบเรทให้ดูในเทิร์นเดียว
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
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', contains: ['เงินสด', 'ผ่อน'], noBigNumbers: true },
      { user: 'ผ่อน', expectTools: ['calculate_installment'], contains: ['ผ่อนเดือนละ'] },
      { user: 'ต่างกับ 15 Plus ยังไง', contains: ['ผ่อนเดือนละ'] },
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

const TOOLS = [
  SEARCH_PRODUCTS_TOOL, CALCULATE_INSTALLMENT_TOOL, LIST_PROMOTIONS_TOOL,
  HANDOFF_TO_HUMAN_TOOL, CAPTURE_LEAD_TOOL, GET_INSTALLMENT_RATES_TOOL, SEARCH_KNOWLEDGE_BASE_TOOL,
  RECOMMEND_DEVICES_TOOL, COMPARE_DEVICES_TOOL,
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
      output_config: { effort: EFFORT },
      messages,
    });
    const toolCalls = resp.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const text = resp.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';
    if (toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: text || '...' });
      return { text, toolsUsed };
    }
    messages.push({ role: 'assistant', content: resp.content.filter((c) => c.type === 'text' || c.type === 'tool_use') as Anthropic.ContentBlockParam[] });
    messages.push({
      role: 'user',
      content: toolCalls.map((tc) => {
        toolsUsed.push(tc.name);
        return { type: 'tool_result' as const, tool_use_id: tc.id, content: JSON.stringify(runFixtureTool(tc.name, tc.input as Record<string, unknown>)) };
      }),
    });
  }
  return { text: '', toolsUsed };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ต้องมี ANTHROPIC_API_KEY');
  const system = await loadPersona();
  console.log(`bot-eval: model=${MODEL} effort=${EFFORT} persona=${system.length.toLocaleString()} chars\n`);
  const client = new Anthropic();
  const only = process.env.EVAL_ONLY;
  const onlyIds = only ? new Set(only.split(',').map((x) => x.trim())) : null;
  let totalChecks = 0, totalFails = 0;

  for (const sc of SCENARIOS) {
    if (onlyIds && !onlyIds.has(sc.id)) continue;
    console.log(`━━ ${sc.id}: ${sc.name}`);
    // fidelity เท่ากับ prod: ประวัติข้ามเทิร์นเก็บเฉพาะ "ข้อความ" (ai-auto-reply สร้าง
    // priorMessages จาก chat_messages) — ผล tool ของเทิร์นก่อนหายไป บอทต้องเรียกใหม่เอง
    const transcript: Anthropic.MessageParam[] = [];
    for (const turn of sc.turns) {
      const messages: Anthropic.MessageParam[] = [...transcript, { role: 'user', content: turn.user }];
      const { text, toolsUsed } = await botReply(client, system, messages);
      transcript.push({ role: 'user', content: turn.user });
      transcript.push({ role: 'assistant', content: text || '...' });
      const fails: string[] = [...globalChecks(text)];
      for (const t of turn.expectTools ?? []) if (!toolsUsed.includes(t)) fails.push(`ไม่ได้เรียก tool: ${t}`);
      for (const t of turn.forbidTools ?? []) if (toolsUsed.includes(t)) fails.push(`เรียก tool ที่ห้าม: ${t}`);
      for (const s of turn.contains ?? []) if (!text.includes(s)) fails.push(`ขาด: "${s}"`);
      for (const s of turn.notContains ?? []) if (text.includes(s)) fails.push(`ห้ามมีแต่มี: "${s}"`);
      if (turn.wantButtons && !text.includes('[ตัวเลือก:')) fails.push('ไม่มีปุ่มกด');
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
      }
    }
  }
  console.log(`\nผล: ${totalChecks - totalFails}/${totalChecks} เทิร์นผ่าน`);
  if (totalFails > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
