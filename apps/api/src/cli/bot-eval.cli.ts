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
      // คลังสเปคจำลอง — ให้เทิร์นเทียบรุ่นมีสเปคอ้างอิงเหมือน prod (id ขึ้นต้น spec:)
      if (q.includes('สเปค') || q.includes('15') || q.includes('16')) {
        return { matches: [
          { id: 'spec:iphone-15', responseTemplate: 'iPhone 15 — กล้องหลัก 48MP คมขึ้นชัดเจน · สาย USB-C · Dynamic Island' },
          { id: 'spec:iphone-16', responseTemplate: 'iPhone 16 — ชิปรุ่นใหม่รองรับ AI ยาว ๆ · ปุ่มชัตเตอร์กล้อง · แบตอึดขึ้นจาก 15' },
        ] };
      }
      return { matches: [] };
    }
    case 'capture_lead':
      return { customerId: 'eval-c1', promptPayQr: null, downAmount: Number(input.downAmount ?? 0), handoffMessage: 'ทางแอดมินจะส่ง QR ให้ในแชทนี้นะคะ' };
    case 'handoff_to_human':
      return { ok: true };
    default:
      return { error: 'unknown_tool' };
  }
}

// เลขที่ "มีที่มา" — เลียนแบบ GroundingGuard: เลข >=500 ในคำตอบต้องอยู่ในชุดนี้ (±5%)
const GROUNDED = [17500, 19900, 13900, 1750, 1578, 1990, 1790, 1390, 1245, 1900, 2566, 3400, 2905, 2766, 3600, 3105, 20686, 23470, 16330, 3000, 2000];

// ───────────────────────── checks ─────────────────────────
type Turn = { user: string; expectTools?: string[]; forbidTools?: string[]; contains?: string[]; notContains?: string[]; wantButtons?: boolean; noBigNumbers?: boolean };
type Scenario = { id: string; name: string; turns: Turn[] };

const BANNED = ['ดอกเบี้ย', '%', 'GFIN', 'ผ่อนกับร้าน', 'เรทร้าน', 'สั่งเข้า', 'ครับ', '{customerName}', '{', 'เรียนคุณ'];

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
  // ตัวเลขต้องมีที่มา
  const nums = [...reply.matchAll(/\d[\d,]{2,}/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => n >= 500);
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
      { user: '128GB', expectTools: ['get_installment_rates'], contains: ['เรทที่ 1', 'เรทที่ 2', '1,900', '2,566', '3,400', '2,905', 'เข้ามา', 'จอง', 'สเตทเม้นท์', '---', '[ตัวเลือก:'] },
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
    id: 'S3', name: 'แนะนำตามงบ → การ์ดสั้น ไม่มีราคาเต็มนำ',
    turns: [
      { user: 'แนะนำหน่อย ไม่รู้จะเอารุ่นไหน', noBigNumbers: true },
      { user: 'ดาวน์ไม่เกิน 3000', noBigNumbers: true },
      { user: 'ผ่อนเดือนละไม่เกิน 2000', expectTools: ['calculate_installment'], contains: ['ดาวน์', 'ผ่อนเดือนละ'], notContains: ['17,500', '19,900', '13,900'] },
    ],
  },
  {
    id: 'S4', name: 'ของมีในสต๊อก 2 สภาพ → เทียบด้วยดาวน์+งวด',
    turns: [
      { user: 'สนใจ iPhone 15 ตัวธรรมดา 128GB มือสอง', expectTools: ['search_products'], notContains: ['17,500', '19,900'], contains: ['ผ่อนเดือนละ'] },
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
  let totalChecks = 0, totalFails = 0;

  for (const sc of SCENARIOS) {
    if (only && sc.id !== only) continue;
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
        console.log(`      ↳ reply: ${text.replace(/\n/g, ' / ').slice(0, 300)}`);
      } else {
        console.log(`  ✓ "${turn.user}" (tools: ${toolsUsed.join(',') || '-'})`);
      }
    }
  }
  console.log(`\nผล: ${totalChecks - totalFails}/${totalChecks} เทิร์นผ่าน`);
  if (totalFails > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
