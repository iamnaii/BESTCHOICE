/**
 * B3 §5 — กฎ grounding เดียวของทั้งระบบบอท
 *
 * ยกมาจาก `modules/sales-bot/sales-bot.service.ts:292-369` (พฤติกรรมเดิมทุกข้อ)
 * เพื่อให้ `FinanceAiService` (น้องเบส — คนละ pipeline, ไม่ผ่าน MessageRouter)
 * ใช้ backstop ตัวเดียวกันได้ โดยไม่ต้อง import module ข้ามกัน
 *
 * ประวัติที่ต้องไม่ลืม:
 *  - #1064: Gemini 2.5 เมิน persona rule แล้วตอบ "iPhone 15 7,000 บาท" ทั้งที่ tool
 *    คืนแค่ iPhone 13/16 → ต้องมี backstop ที่ไม่ขึ้นกับพฤติกรรมโมเดล
 *  - #1337: เพิ่ม key ของ get_installment_rates/calculate_installment ทีหลัง เพราะ
 *    เปลี่ยน shape แล้วลืม → บอทโดน block เงียบ ๆ
 *  - B3: เพิ่ม installmentPriceThb / cashPriceThb / financedThb จาก shape ใหม่
 */

export const GROUNDED_PRICE_KEYS: ReadonlySet<string> = new Set([
  // ชุดเดิม (search_products et al.)
  'priceThb',
  'monthly',
  'minPrice',
  'maxPrice',
  // #1337 — get_installment_rates v2 (PricingTemplate เป็นบาทจริง)
  'downPayment',
  'monthlyPrice',
  // #1337 reviewer fix — ผลคำนวณของ calculate_installment
  'downAmountThb',
  'monthlyThb',
  'totalPaidThb',
  // B3 — shape ใหม่: ราคาผ่อนต่อเครื่อง / ราคาเงินสดอ้างอิง / ยอดจัด
  'installmentPriceThb',
  'cashPriceThb',
  'financedThb',
]);

/**
 * คีย์ของ "น้องเบส" = ชุดบอทขาย + คีย์เงินฝั่งการเงิน (Task 11)
 * แยกออกมาเพราะคีย์กว้าง ๆ อย่าง `amount` ต้องไม่ไปขยายพูลที่บอทขายยอมรับ
 * (`search_products` มีแถวราคาชื่อ `amount` ใน `prices[]`) — ห้ามไปแก้
 * `GROUNDED_PRICE_KEYS` (ชุดของบอทขาย) เพื่อขยายพูลนี้แทน. `FinanceAiService`
 * (น้องเบส) เป็นเจ้าของพูลนี้จริง ๆ และเป็นคนเดียวที่ส่ง set นี้เข้า
 * `collectGroundedPrices`.
 */
// B3 Task 11 — audit shape จริงของ FinanceToolsService (apps/api/src/modules/chatbot-finance/
// services/finance-tools.service.ts) ทีละ method แล้วเติมทีละคีย์พร้อมเทสต์ใน
// price-grounding.util.spec.ts (ห้ามเดาเพิ่มคีย์ที่ไม่พิสูจน์ว่าเป็นราคาจริง):
//
//  - getCurrentBalance (:71-82)      → amountDue, lateFee, totalAmount เป็นเงิน;
//                                       daysOverdue เป็นจำนวนวัน ไม่เติม
//  - getPaymentSchedule (:121-133)   → totalAmount, paidAmount, remainingAmount, nextAmount
//                                       เป็นเงิน; totalInstallments/paidInstallments/
//                                       remainingInstallments เป็นจำนวนนับ ไม่เติม
//  - calculateFine (:150-154)        → totalFine เป็นเงิน (ตัวเลขในเพดานค่าปรับซ้ำใน
//                                       explanation ด้วย ดูดผ่าน collectGroundedPricesFromToolText
//                                       แยกต่างหาก ไม่ต้องเติมคีย์ใหม่)
//  - listRecentReceipts (:182-186)   → receipts[].amount เป็นเงิน (ใช้คีย์กว้าง 'amount' —
//                                       ตั้งใจแยกพูลนี้จาก GROUNDED_PRICE_KEYS ของบอทขายเพราะ
//                                       search_products มี prices[].amount ที่เป็นราคาทุน/ราคาเก่า
//                                       ที่บอทขายห้าม quote)
//  - getBankInfo (:196-201)          → bankName/accountNumber/accountName/formatted เป็น string
//                                       ล้วน ไม่มีคีย์ตัวเลขให้เติม (นี่คือ tool ที่ทำให้ turn 2
//                                       ของบทสนทนาปกติ "โอนยังไงคะ" ไม่คืนตัวเลขเลย — ต้อง seed
//                                       grounded จาก history แทน ดู finance-ai.service.ts)
export const FINANCE_GROUNDED_PRICE_KEYS: ReadonlySet<string> = new Set([
  ...GROUNDED_PRICE_KEYS,
  'amountDue',
  'lateFee',
  'totalAmount',
  'paidAmount',
  'remainingAmount',
  'nextAmount',
  'totalFine',
  'amount',
]);

/** ราคาที่ต่ำกว่านี้ถูกมองว่าเป็นค่าปรับ/วัน/เปอร์เซ็นต์ — เสี่ยง false-positive เกินไป */
const MIN_GROUNDED_THB = 1000;

/**
 * ⚠️ **แก้บั๊กของเดิม (ห้าม copy regex เก่ามา)** — ตัวเดิมใน `sales-bot.service.ts:351`
 * คือ `/([\d][\d,]{2,})\s*(?:บาท|฿|baht|THB)/gi` ซึ่ง **จับยอดที่มีสตางค์ไม่ได้เลย**
 * เพราะ `.` ไม่อยู่ใน character class → match ขาดที่จุดทศนิยม แล้วเศษ (`83`) สั้นกว่า `{2,}`
 * พิสูจน์แล้วด้วย node: `'ยอด 1,515.83 บาท'` → `[]`, `'ยอดรวม 13,642.51 บาท'` → `[]`,
 * `'ยอด 99,999.00 บาท'` → `[]` (จับได้เฉพาะเลขกลมอย่าง `32,900`)
 *
 * ผลกระทบ: ยอดจริงฝั่งการเงินมีสตางค์เกือบทั้งหมดตาม CPA rounding
 * (`.claude/rules/accounting.md` — 1,416.66 + 99.17 = 1,515.83) ⇒ ถ้าใช้ regex เดิม
 * guard ของน้องเบส (Task 11) จะเป็น **no-op**: โมเดลแต่งยอด `99,999.00 บาท` ผ่านฉลุย
 * ขณะที่ทีมเชื่อว่ามี backstop แล้ว
 *
 * กลุ่มทศนิยม `(?:\.\d{1,2})?` เป็น optional ⇒ พฤติกรรมกับเลขกลมเหมือนเดิมทุกประการ
 * (ตรวจแล้ว: `sales-bot.service.spec.ts` ไม่มีเลขทศนิยมก่อน "บาท" เลยสักเคส
 * — บรรทัด 100/259/297/374-375/415/447/491 เป็นเลขกลมล้วน → suite เดิมยังเขียว)
 * และ `Number(m[1].replace(/,/g, ''))` ยังใช้ได้เหมือนเดิม (parse '1,515.83' → 1515.83)
 */
const PRICE_IN_TEXT_RE = /([\d][\d,]{2,}(?:\.\d{1,2})?)\s*(?:บาท|฿|baht|THB)/gi;

/**
 * `keys` เป็นพารามิเตอร์ (default = ชุดบอทขาย) ไม่ใช่ค่าคงที่ตัวเดียวที่บอท 2 ตัวใช้ร่วม
 * — คีย์ที่ Task 11 ต้องใช้ฝั่งการเงิน (`amount`, `totalAmount`, …) กว้างเกินกว่าจะปล่อยให้
 * ไปขยายพูลที่บอทขายยอมรับโดยไม่มีใครรีวิว (`search_products` select แถวราคาชื่อ `amount`)
 */
export function collectGroundedPrices(
  value: unknown,
  into: Set<number>,
  keys: ReadonlySet<string> = GROUNDED_PRICE_KEYS,
): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) collectGroundedPrices(v, into, keys);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(k) && v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) into.add(n);
      }
      collectGroundedPrices(v, into, keys);
    }
  }
}

/**
 * ดูดเลขบาทออกจากข้อความอิสระ — ใช้กับผลลัพธ์ที่เป็น "ข้อความที่แอดมินเขียนเอง"
 * (KB responseTemplate) ซึ่งเป็น ground truth ไม่ใช่การเดาของโมเดล ถ้าไม่ทำ
 * KB ที่เขียนว่า "ค่ามัดจำ 3,000 บาท" จะทำให้บอทโดน block ทันทีที่พูดตาม
 */
export function collectGroundedPricesFromText(text: string, into: Set<number>): void {
  if (!text) return;
  for (const m of text.matchAll(PRICE_IN_TEXT_RE)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n >= MIN_GROUNDED_THB) into.add(n);
  }
}

/**
 * ดูดเลขบาทจาก "ฟิลด์ที่เป็นข้อความแอดมินเขียนเอง" ในผลลัพธ์ tool
 * (list_promotions.name/description, search_knowledge_base.matches[].responseTemplate)
 * — เติมของจริงใน Task 6 (list_promotions) และ Task 8 (search_knowledge_base)
 * ต้องเป็น util เพราะ **บอททั้ง 2 ตัวมี tool ชื่อเดียวกันแต่คนละ pipeline**
 * (Task 6/8 = SalesBotService, Task 11 = FinanceAiService) — ห้าม copy-paste 2 ที่
 *
 * B3 §5 — บาง tool คืน "ข้อความที่แอดมินพิมพ์เอง" (คำอธิบายโปรโมชั่น, FAQ) ซึ่ง
 * เป็น ground truth ไม่ใช่การเดาของโมเดล ถ้าไม่ดูดเลขบาทจากข้อความพวกนี้เข้า
 * ledger บอทจะโดน guard block ทันทีที่พูดตามโปรที่แอดมินเขียนไว้เอง
 * (อาการเดียวกับ #1337: บอทเงียบโดยไม่มี error ให้เห็น)
 *
 * รองรับ 3 tool: `list_promotions` (Task 6), `search_knowledge_base` (Task 8)
 * — ทั้งบอทขายและน้องเบสมี tool ชื่อเดียวกัน shape เดียวกัน จึงใช้ตัวนี้ได้ทั้งคู่ —
 * และ `calculate_fine` (ฝั่งน้องเบส, Task 11)
 */
export function collectGroundedPricesFromToolText(
  toolName: string,
  result: unknown,
  into: Set<number>,
): void {
  if (result == null || typeof result !== 'object') return;

  if (toolName === 'list_promotions') {
    const promos = (result as { promotions?: unknown }).promotions;
    if (!Array.isArray(promos)) return;
    for (const p of promos) {
      const r = p as { name?: unknown; description?: unknown };
      if (typeof r.name === 'string') collectGroundedPricesFromText(r.name, into);
      if (typeof r.description === 'string') collectGroundedPricesFromText(r.description, into);
    }
    return;
  }

  if (toolName === 'search_knowledge_base') {
    const matches = (result as { matches?: unknown }).matches;
    if (!Array.isArray(matches)) return;
    for (const m of matches) {
      const t = (m as { responseTemplate?: unknown }).responseTemplate;
      if (typeof t === 'string') collectGroundedPricesFromText(t, into);
    }
    return;
  }

  // `calculate_fine` (น้องเบส) ซ่อนตัวเลขไว้ใน `explanation` ที่ interpolate
  // ค่าจาก SystemConfig (`finance-tools.service.ts:143-160`: `${cfg.maxAmount}`,
  // `${cfg.tier1Amount}`, `${cfg.tier2Amount}`) — คีย์เดียวที่เป็นตัวเลขล้วนคือ
  // `totalFine` ⇒ วันที่ owner ตั้ง `late_fee_max_amount` เป็น 4 หลัก (เช่น 1500)
  // น้องเบสจะโดน block ทั้งที่อ่านเลขมาจาก tool ตรง ๆ. explanation ประกอบจาก
  // config ที่ owner ตั้งเอง = ground truth เหมือน KB/โปรโมชั่น
  if (toolName === 'calculate_fine') {
    const explanation = (result as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string') collectGroundedPricesFromText(explanation, into);
  }
}

export type GroundingVerdict = { ok: true } | { ok: false; reason: string };

export function guardGrounding(reply: string, grounded: Set<number>): GroundingVerdict {
  // B3 Task 6 review [C2]: filter down to numbers that actually count as "a price"
  // (>= MIN_GROUNDED_THB) BEFORE the `grounded.size === 0` early-return below. The
  // old order ran the size check first, so a reply that ONLY mentions sub-1,000
  // figures (e.g. a promo's "ลด 500 บาท") got blocked as price-mentioned-no-tool-result
  // even though the identical figure inside the per-match loop further down would
  // have been exempted via `num < MIN_GROUNDED_THB` — the two paths disagreed for the
  // exact same input. Filtering first makes both paths apply the same exemption
  // consistently; it does not loosen the backstop for real prices (>= 1,000 still
  // requires a non-empty grounded set, same as before).
  const matches = [...reply.matchAll(PRICE_IN_TEXT_RE)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((num) => Number.isFinite(num) && num >= MIN_GROUNDED_THB);
  if (matches.length === 0) return { ok: true };

  if (grounded.size === 0) {
    return { ok: false, reason: 'price-mentioned-no-tool-result' };
  }

  for (const num of matches) {
    const closeMatch = [...grounded].some((g) => Math.abs(g - num) / g <= 0.05);
    if (!closeMatch) {
      return { ok: false, reason: `unmatched-price=${num}` };
    }
  }
  return { ok: true };
}
