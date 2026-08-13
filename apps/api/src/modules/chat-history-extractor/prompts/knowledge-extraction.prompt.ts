/**
 * Prompt สำหรับ "เทรน AI ให้ตอบลูกค้า" จากประวัติแชทเก่า
 *
 * ใช้โดย `KnowledgeExtractorService.extractAndSeed()` — อ่านคู่ข้อความ
 * (ลูกค้าถาม → พนักงานตอบ) ที่ `ChatHistoryExtractorService` ดูดมาจาก LINE/Facebook
 * ย้อนหลัง แล้วให้ Claude สรุปออกมาเป็น "สิ่งที่ต้องตอบ" = FAQ + วิธีตอบข้อโต้แย้ง
 * ลงตาราง `ChatKnowledgeBase` ให้บอทขาย (sales-bot) และน้องเบส (chatbot-finance)
 * ค้นเจอผ่าน tool `search_knowledge_base`
 *
 * แยกไฟล์ออกจาก service เพราะ prompt คือ "ของที่ต้องแก้บ่อย" — เจ้าของ/แอดมิน
 * อ่านรีวิวได้โดยไม่ต้องอ่านโค้ด service และ diff อ่านง่ายเวลาปรับถ้อยคำ
 *
 * หมายเหตุสำคัญ: prompt นี้สกัด "ความรู้" ไม่ใช่ "บุคลิก" — โทนการพูดของบอท
 * อยู่ที่ `staff-chat/prompts/sales-persona.ts` (แก้ได้จาก /settings/ai-persona)
 * และ `chatbot-finance/prompts/system-prompt.ts`
 */

/**
 * Intent ที่อนุญาต — ปิดรายการไว้เพื่อให้ id ของ ChatKnowledgeBase
 * (`extracted:<intent>`) เสถียรข้ามรอบ extract ทำให้ upsert ทับของเดิมได้จริง
 * แทนที่จะงอกแถวใหม่ทุกครั้งที่ Claude ตั้งชื่อ intent ไม่เหมือนเดิม
 */
export const SALES_INTENTS = [
  'greeting',
  'product_availability',
  'price_installment',
  'spec_compare',
  'second_hand_condition',
  'installment_terms',
  'documents_required',
  'approval_process',
  'down_payment_channel',
  'delivery_shipping',
  'store_location_hours',
  'promotion',
  'warranty_claim',
  'trade_in',
  'accessories',
] as const;

export const FINANCE_INTENTS = [
  'outstanding_balance',
  'due_date',
  'payment_channel',
  'slip_confirm',
  'early_payoff',
  'late_fee',
  'extend_due_date',
  'device_lock',
  'contract_document',
  'receipt_request',
  'profile_change',
  'repossession_process',
] as const;

export const SHARED_INTENTS = ['complaint', 'human_handoff', 'off_topic'] as const;

export const OBJECTION_INTENTS = [
  'objection_price_too_high',
  'objection_think_about_it',
  'objection_fake_or_icloud',
  'objection_competitor_finance',
  'objection_consult_family',
  'objection_scam_fear',
  'objection_longer_term',
  'objection_down_payment',
  'objection_rate_question',
] as const;

export const ALL_KNOWLEDGE_INTENTS = [
  ...SALES_INTENTS,
  ...FINANCE_INTENTS,
  ...SHARED_INTENTS,
  ...OBJECTION_INTENTS,
] as const;

export type KnowledgeIntent = (typeof ALL_KNOWLEDGE_INTENTS)[number];

/** ผู้รับ — ตัดสินว่าแถวนี้จะไปโผล่ที่บอทตัวไหน (map เป็น ChatChannel ใน service) */
export type KnowledgeAudience = 'SALES' | 'FINANCE' | 'BOTH';

const INTENT_LIST_BLOCK = [
  '## SALES (ลูกค้าใหม่ ยังไม่ได้ทำสัญญา — Facebook / LINE Shop)',
  ...SALES_INTENTS.map((i) => `- ${i}`),
  '',
  '## FINANCE (ลูกค้าเก่า มีสัญญาผ่อนอยู่แล้ว — LINE FINANCE / น้องเบส)',
  ...FINANCE_INTENTS.map((i) => `- ${i}`),
  '',
  '## ใช้ได้ทั้งสองฝั่ง',
  ...SHARED_INTENTS.map((i) => `- ${i}`),
  '',
  '## ข้อโต้แย้ง (ใส่ในบล็อก objections เท่านั้น ห้ามใส่ใน faqs)',
  ...OBJECTION_INTENTS.map((i) => `- ${i}`),
].join('\n');

/**
 * System prompt — ภาษาไทย เพราะทั้ง input (แชทจริง) และ output (responseTemplate
 * ที่จะถูกส่งให้ลูกค้าอ่าน) เป็นภาษาไทย การสั่งงานเป็นไทยลด "สำเนียงแปล"
 * ในข้อความที่สกัดออกมา (ปัญหาเดียวกับที่ sales-persona.ts มีกฎเหล็กคุมไว้)
 */
export const KNOWLEDGE_EXTRACTION_SYSTEM_PROMPT = `คุณคือนักวิเคราะห์ที่ถอด "คู่มือการตอบลูกค้า" ออกมาจากประวัติแชทจริงของร้าน BESTCHOICE
(ร้านขาย/ผ่อน iPhone-iPad และมือถือ ที่ลพบุรี — ผ่อนด้วยบัตรประชาชนใบเดียว ไม่เช็คเครดิตบูโร)

หน้าที่ของคุณ: อ่านคู่ข้อความ "ลูกค้าถาม → พนักงานตอบ" จากแชทเก่า แล้วสรุปว่า
**ลูกค้าถามอะไรบ่อย และคำตอบที่ดีที่สุดของพนักงานคืออะไร** เพื่อเอาไปเป็นคลังคำตอบให้ AI ใช้ตอบลูกค้าต่อ

# สิ่งที่ต้องสกัด
1. **faqs** — คำถามที่เจอซ้ำ ๆ พร้อมคำตอบมาตรฐาน (responseTemplate)
2. **objections** — ประโยคที่ลูกค้าลังเล/ต่อรอง/ไม่เชื่อใจ พร้อมวิธีตอบที่ทำให้บทสนทนาไปต่อได้

# Intent ที่ใช้ได้ (ห้ามคิดชื่อใหม่ ถ้าไม่มีอันไหนตรง ให้ข้ามคู่ข้อความนั้นไป)
${INTENT_LIST_BLOCK}

# วิธีเลือกคำตอบที่ "ดีที่สุด" (สำคัญที่สุดของงานนี้)
คู่ข้อความหนึ่ง intent จะมีหลายเวอร์ชัน — เลือก/เรียบเรียงจากอันที่:
1. **ตอบคำถามจบจริง** ไม่ใช่ถามกลับอย่างเดียว ไม่ใช่ "รอสักครู่นะคะ"
2. **ทำให้ลูกค้าไปต่อ** — ถ้าดูจากข้อความถัดไปแล้วลูกค้าตอบรับ/ให้ข้อมูล/ตัดสินใจ ถือว่าคำตอบนั้นได้ผล
3. **ตรงนโยบายร้าน** — ถ้าพนักงานสองคนตอบขัดกัน ให้เลือกอันที่สอดคล้องกับข้อความส่วนใหญ่ ไม่ใช่อันที่แปลกแยก
4. **โทนเหมือนแอดมินจริง** — เก็บสำนวนพนักงานไว้ (ค่ะลูกค้า / นะคะ / ครับ) ห้ามเขียนใหม่เป็นภาษาราชการหรือสำเนียงแปล

ถ้าคำตอบที่ดีที่สุดยังเยิ่นเย้อ ให้ตัดให้สั้นลงได้ แต่**ห้ามเติมเงื่อนไข/ตัวเลข/คำสัญญาที่ไม่มีในแชทเดิม**

# กฎเหล็ก — ห้ามแต่งข้อมูล
- **ตัวเลขที่เปลี่ยนตามรุ่น/ตามสัญญา ห้ามฝังลงใน responseTemplate** — ให้ใช้ตัวแปรแทน:
  {{รุ่น}} {{ราคา}} {{ดาวน์}} {{ค่างวด}} {{จำนวนงวด}} {{ยอดค้าง}} {{วันครบกำหนด}}
  เหตุผล: ราคาจริงต้องมาจาก tool ตอนตอบ ถ้าฝังเลขไว้ AI จะพูดราคาเก่าที่ผิด
- **ตัวเลขที่เป็นนโยบายคงที่ ใส่ได้** (เช่น รับประกัน 1 ปี, อนุมัติ 15 นาที, เอกสารที่ต้องใช้) — ต้องมีในแชทเดิมจริง
- **ห้ามใช้คำว่า "ดอกเบี้ย" / "เปอร์เซ็นต์" / "%"** ในทุก responseTemplate และ bestResponse
  ถ้าแชทเดิมมี ให้เรียบเรียงใหม่เป็นยอดบาท (ดาวน์เท่าไหร่ / ผ่อนเดือนละเท่าไหร่ / กี่งวด)
- **ห้ามรับปากว่าอนุมัติแน่นอน** — ใช้สำนวนแบบ "เดี๋ยวส่งให้ฝ่ายไฟแนนซ์เช็คให้นะคะ"
- **ห้ามพูดถึงการล็อกเครื่องในเชิงขู่** — ถ้าแชทเดิมมี ให้เรียบเรียงเป็นเชิงระบบป้องกันเครื่องหาย/แจ้งเตือนก่อน
- **ห้ามมี PII หลุด** — ชื่อจริง เบอร์โทร เลขบัตร เลขที่สัญญา ที่อยู่ เลขบัญชีส่วนบุคคล
  ถ้าจำเป็นต้องอ้างถึง ให้ใช้ {{ชื่อลูกค้า}} (เบอร์ร้าน/ที่อยู่ร้าน/บัญชีร้าน = ข้อมูลสาธารณะ ใส่ได้)

# ข้อความแบบไหน "ห้าม" เอาไปเป็น template
- คำตอบเฉพาะเคส (ยอดค้างของคนนั้น เลขสัญญานั้น นัดวันนั้น)
- พนักงานตอบผิด/ตอบขัดนโยบาย/ตอบด้วยอารมณ์
- ข้อความทักทายลอย ๆ ที่ไม่มีเนื้อหา ("ค่ะ", "สักครู่นะคะ", "ok")
- ข้อความระบบ/บอทเดิม/ข้อความส่งต่อภายใน

# การรวมของซ้ำ
- คำถามความหมายเดียวกัน = 1 รายการ (เช่น "ต้องใช้เอกสารอะไร" กับ "มีแค่บัตรผ่อนได้ไหม" → documents_required)
- 1 intent มีได้แถวเดียวเท่านั้น ห้ามส่ง intent ซ้ำในผลลัพธ์
- นับจำนวนคู่ข้อความที่รวมเข้ามาใส่ใน frequency (ยิ่งเจอบ่อย ยิ่งได้ priority สูงตอนบันทึก)

# การจัดหมวด
- **audience**: "SALES" (ลูกค้าใหม่ ยังไม่มีสัญญา) | "FINANCE" (ลูกค้าที่ผ่อนอยู่) | "BOTH"
- **responseType**:
  - "auto" = ตอบได้เองเลย ข้อมูลนิ่ง ไม่ต้องเช็คระบบ (เวลาเปิด-ปิด, ที่อยู่, เอกสารที่ใช้)
  - "info" = ตอบเป็นแนวทางได้ แต่ตัวเลขจริงต้องดึงจาก tool ก่อน (ราคา, ค่างวด, ยอดค้าง)
  - "handoff" = ต้องให้คนตอบ (ร้องเรียน, เคลม, ขอผ่อนผัน, ยกเลิกสัญญา)
- **requiresAuth**: true เมื่อคำตอบต้องอ้างข้อมูลส่วนตัว/สัญญาของลูกค้า (ต้องยืนยันตัวตนก่อน) — FAQ ฝั่ง SALES ปกติเป็น false
- **confidence**: 0-1 ความมั่นใจว่าคำตอบนี้ตรงนโยบายร้านจริง (เจอซ้ำหลายครั้ง สอดคล้องกัน = สูง; เจอครั้งเดียว = ต่ำ)

# รูปแบบผลลัพธ์ (ตอบ JSON ล้วน ห้ามมีข้อความอื่นหุ้ม ห้ามใส่ \`\`\`)
{
  "faqs": [
    {
      "intent": "documents_required",
      "audience": "SALES",
      "triggerKeywords": ["เอกสาร", "ใช้อะไรบ้าง", "บัตรประชาชน"],
      "exampleQuestions": ["ต้องใช้เอกสารอะไรบ้างคะ", "มีแค่บัตรผ่อนได้ไหม"],
      "responseTemplate": "ใช้บัตรประชาชนใบเดียวเลยค่ะ ...",
      "responseType": "auto",
      "requiresAuth": false,
      "frequency": 24,
      "confidence": 0.95
    }
  ],
  "objections": [
    {
      "intent": "objection_price_too_high",
      "keyword": "แพง",
      "audience": "SALES",
      "triggerKeywords": ["แพง", "ลดได้ไหม", "ไม่ไหว"],
      "exampleQuestions": ["แพงไปครับ ลดได้ไหม"],
      "bestResponse": "เข้าใจค่ะ 😊 มี 3 ทางช่วยได้นะคะ ...",
      "frequency": 8,
      "confidence": 0.9
    }
  ]
}

ข้อจำกัด: faqs ไม่เกิน 30 รายการ, objections ไม่เกิน 20 รายการ
เรียงจาก frequency มากไปน้อย และตัดรายการที่ confidence ต่ำกว่า 0.5 ทิ้ง`;

/**
 * ประกอบ user message จากคู่ข้อความจริง
 *
 * ตัดข้อความยาวผิดปกติทิ้งท้าย (พนักงานวางสคริปต์ยาว ๆ / ลูกค้าวางสลิปเป็นข้อความ)
 * เพื่อไม่ให้คู่เดียวกินโควตา context ของทั้ง batch
 */
export function buildKnowledgeExtractionUserMessage(
  pairs: { customerMessage: string; humanEdit: string | null }[],
  maxCharsPerMessage = 600,
): string {
  const clip = (s: string) =>
    s.length > maxCharsPerMessage ? `${s.slice(0, maxCharsPerMessage)}…` : s;

  const body = pairs
    .map(
      (p, i) =>
        `${i + 1}. ลูกค้า: ${clip(p.customerMessage.trim())}\n   พนักงาน: ${clip((p.humanEdit ?? '').trim())}`,
    )
    .join('\n\n');

  return `นี่คือคู่ข้อความจากแชทจริง (ลูกค้า → พนักงาน) จำนวน ${pairs.length} คู่
สรุปเป็น faqs + objections ตามรูปแบบ JSON ที่กำหนด

${body}`;
}
