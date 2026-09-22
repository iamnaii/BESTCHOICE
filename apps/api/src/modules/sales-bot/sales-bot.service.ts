import { Injectable, Logger, Optional } from '@nestjs/common';
import { PersonaService } from '../staff-chat/services/persona.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import { SearchProductsTool, SEARCH_PRODUCTS_TOOL } from './tools/search-products.tool';
import {
  CalculateInstallmentTool,
  CALCULATE_INSTALLMENT_TOOL,
} from './tools/calculate-installment.tool';
import { ListPromotionsTool, LIST_PROMOTIONS_TOOL } from './tools/list-promotions.tool';
import { HandoffToHumanTool, HANDOFF_TO_HUMAN_TOOL } from './tools/handoff-to-human.tool';
import { CaptureLeadTool, CAPTURE_LEAD_TOOL } from './tools/capture-lead.tool';
import {
  GetInstallmentRatesTool,
  GET_INSTALLMENT_RATES_TOOL,
} from './tools/get-installment-rates.tool';
import {
  SearchKnowledgeBaseTool,
  SEARCH_KNOWLEDGE_BASE_TOOL,
} from './tools/search-knowledge-base.tool';
import {
  RecommendDevicesTool,
  RECOMMEND_DEVICES_TOOL,
  stripRecommendStockFields,
} from './tools/recommend-devices.tool';
import { CompareDevicesTool, COMPARE_DEVICES_TOOL } from './tools/compare-devices.tool';
import {
  NO_CARD_REQUESTED,
  SendRateCardTool,
  buildSendRateCardTool,
  type SendRateCardResult,
} from './tools/send-rate-card.tool';
import { NotifyStaffTool, NOTIFY_STAFF_TOOL } from './tools/notify-staff.tool';
import {
  BotRuntimeConfigService,
  NO_STOCK_PROMPT,
  type RateCardsConfig,
  type StockMode,
} from './bot-runtime-config.service';
import { LlmProviderRegistry } from './providers/llm-provider.registry';
import {
  LlmChatMessage,
  LlmToolCall,
  LlmToolDefinition,
} from './providers/llm-provider.interface';
import {
  collectConversationNumbers,
  collectGroundedPrices,
  collectGroundedPricesFromToolText,
  guardGrounding,
} from '../../utils/price-grounding.util';
import {
  collectAttachmentsFromToolResult,
  MAX_BOT_ATTACHMENTS,
  RATE_CARD_ID_PREFIX,
  type BotAttachment,
} from '../../utils/bot-attachments.util';
import { stripStrayForeignScript } from '../../utils/bot-reply-sanitize.util';
import {
  SHOP_OPEN_HOUR,
  SHOP_CLOSE_HOUR,
  SHOP_OPEN_LABEL_TH,
  isShopOpen,
} from '../../utils/shop-hours.util';

export interface SalesBotInput {
  text: string;
  roomId: string;
  customerId: string | null;
  priorMessages?: { role: 'user' | 'assistant'; content: string }[];
  /**
   * บันทึกสถานะการขายจาก SalesStateService (สมุดสถานะประจำห้อง) — ฉีดเป็นข้อความแรก
   * ของประวัติ ไม่ใช่ system block (system โดน prompt cache; note ต่างกันทุกห้อง)
   */
  sessionNote?: string;
  /** โน้ตเก่ากว่า 48 ชม. — ห้าม seed เลขในโน้ตเป็น grounded (เรทอาจเปลี่ยน ต้องเรียก tool ใหม่) */
  sessionNoteStale?: boolean;
  /** เวลาปัจจุบัน (เทสส่งค่าคงที่ได้) — ไม่ส่ง = new Date() */
  now?: Date;
}

const STOCK_TOOL_NAMES = new Set(['search_products', 'calculate_installment']);
/**
 * เครื่องมือที่ "ลงมือแทน" (ส่งรูป / ปักธงให้พนักงาน) — ผลของมันไม่มีข้อมูลให้โมเดลเอาไปเขียนคำตอบ
 * ถ้าโมเดลเขียนคำตอบมาแล้วในข้อความเดียวกับที่เรียกเฉพาะตัวเหล่านี้ และทุกตัวสำเร็จ → จบเทิร์นด้วย
 * ข้อความนั้นเลย (ดู isCleanSideEffectResult). เดิมวนอีกรอบแล้วใช้เฉพาะข้อความรอบสุดท้าย ซึ่งมักเป็น
 * "ส่งตารางให้ดูนะคะ" หรือว่างเปล่า ⇒ ข้อความเรทที่เขียนไว้แล้วหายทั้งก้อน (bot:eval 2026-09-22)
 * ไม่สำเร็จ (รูปบางใบส่งไม่ได้) / ตัวเลขไม่ผ่านด่าน → วนต่อ **พร้อม systemNote ในผลเครื่องมือ**
 * สั่งให้เขียนคำตอบใหม่ทั้งก้อน (ไม่วนเงียบ ๆ ให้ข้อความหาย — รีวิว TOOLLOOP-1/3) · ข้อความที่ตัวเลขผ่านแล้วถูกเก็บไว้
 * (pendingText) — รอบเขียนใหม่ว่าง/แต่งตัวเลข/หมดรอบ ⇒ ส่งข้อความเดิม (ตัดบรรทัดอ้างรูปที่ไม่ได้แนบ) แทนข้อความสำรอง (SB-V2)
 */
export const SIDE_EFFECT_TOOL_NAMES = new Set(['send_rate_card', 'notify_staff']);

/**
 * ส่งรูปครบทุกใบที่ขอ / ปักธงสำเร็จ — ไม่ครบ = ให้โมเดลเห็นผลแล้วแก้คำตอบเอง
 * send_rate_card: ต้องใช้ผลที่ผ่าน reconcileRateCardResult แล้ว (sent = แนบถึงลูกค้าจริง)
 */
export function isCleanSideEffectResult(name: string, result: unknown): boolean {
  const r = (result ?? {}) as Record<string, unknown>;
  if (name === 'send_rate_card') {
    return Array.isArray(r.sent) && r.sent.length > 0 && Array.isArray(r.missing) && r.missing.length === 0;
  }
  if (name === 'notify_staff') return r.staffNotified === true;
  return false;
}

/**
 * กระทบยอดผล send_rate_card กับช่องแนบจริงของคำตอบ — รูปที่เครื่องมือบอกว่า "sent" แต่ไม่ได้อยู่ในช่องแนบ
 * (ช่องเต็มด้วยรูปตารางใบอื่นแล้ว) ย้ายไป missing ⇒ โมเดล/ทางลัดจบเทิร์นเห็นความจริง (รีวิว TOOLLOOP-2 / ATTACH-1)
 * ไม่แก้ต้นฉบับ · ผลที่ไม่ใช่รูปแบบ send_rate_card คืนตามเดิม (แชร์กับ bot-eval ได้)
 */
export function reconcileRateCardResult(
  result: unknown,
  attachments: ReadonlyMap<string, BotAttachment>,
): unknown {
  if (!result || typeof result !== 'object') return result;
  const r = result as Partial<SendRateCardResult>;
  if (!Array.isArray(r.sent)) return result;
  const attached = r.sent.filter((s) => attachments.has(`${RATE_CARD_ID_PREFIX}${s.card}`));
  if (attached.length === r.sent.length) return result;
  const dropped = r.sent.filter((s) => !attached.includes(s)).map((s) => s.card);
  return {
    ...r,
    sent: attached,
    missing: [...(Array.isArray(r.missing) ? r.missing : []), ...dropped],
    images: Array.isArray(r.images)
      ? r.images.filter((im) => !dropped.some((card) => im.id === `${RATE_CARD_ID_PREFIX}${card}`))
      : r.images,
  };
}

/** ผลเครื่องมือที่โมเดลเห็น + หมายเหตุระบบ (ต่อท้ายถ้ามีอยู่แล้ว) — ส่งในผลเครื่องมือ ไม่ใช่ข้อความ user แยก
 *  เพราะ Gemini ต้องสลับบทบาทเคร่ง (assistant → tool → assistant) */
export function withSystemNote(payload: unknown, note: string): Record<string, unknown> {
  const base: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : { result: payload };
  const prev = typeof base.systemNote === 'string' && base.systemNote ? `${base.systemNote}\n` : '';
  return { ...base, systemNote: `${prev}${note}` };
}

/**
 * หมายเหตุในผล send_rate_card เมื่อรูปบางใบส่งไม่ได้ — ห้ามจบเทิร์นด้วยข้อความที่อ้างรูป และห้ามวนเงียบ
 * (ข้อความที่เขียนมาพร้อมการเรียกจะถูกทิ้ง ⇒ ต้องสั่งให้เขียนคำตอบเต็มใหม่ ไม่งั้นรอบถัดไปมักเหลือแค่
 * "ส่งตารางให้ดูนะคะ" หรือว่าง — รีวิว TOOLLOOP-1 / PROMPT-2)
 */
export function rateCardMissingNote(opts: {
  missing: string[];
  sent: string[];
  textWasWritten: boolean;
}): string {
  const named = opts.missing.filter((m) => m !== NO_CARD_REQUESTED);
  const parts: string[] = [];
  // เรียกโดยไม่ระบุรูป (cards ว่าง) — ไม่มีรูปถูกส่ง (รีวิว SB-V3)
  if (named.length < opts.missing.length) {
    parts.push(
      '[ข้อความระบบ — ลูกค้าไม่เห็น] เรียก send_rate_card โดยไม่ระบุรูป (cards ว่าง) จึงไม่มีรูปถูกส่ง — ห้ามบอกว่าส่งรูปแล้ว',
    );
  }
  if (named.length > 0) {
    parts.push(
      `[ข้อความระบบ — ลูกค้าไม่เห็น] รูป ${named.join(', ')} ส่งไม่ได้ ลูกค้าไม่ได้รับรูปนี้ — ห้ามพูดถึงรูปนี้ ห้ามบอกว่าส่งแล้ว และห้ามเรียก send_rate_card ขอรูปนี้ซ้ำ`,
    );
  }
  if (opts.sent.length > 0) parts.push(`รูปที่ถึงลูกค้าแล้ว: ${opts.sent.join(', ')}`);
  parts.push(
    opts.textWasWritten
      ? 'ข้อความที่คุณเขียนมาพร้อมการเรียกครั้งนี้ยังไม่ถูกส่งถึงลูกค้า — เขียนคำตอบทั้งหมดใหม่ให้ครบในข้อความเดียว (ตัวเลขชุดเดิมที่มาจากผล tool ครบทุกตัว) โดยตัดประโยคที่พูดถึงรูปที่ส่งไม่ได้ออก'
      : 'ตอบลูกค้าเป็นข้อความตามปกติ',
  );
  return parts.join(' · ');
}

/** บรรทัดที่อ้างว่ามีรูปแนบ/ส่งให้ดู ("อันนี้ตารางผ่อนค่ะ" "ส่งตารางให้ดูนะคะ") */
const IMAGE_CLAIM_VERB_RE =
  /(ส่ง|แนบ|อันนี้|ตามนี้|ด้านล่าง|ข้างล่าง|ตามรูป|ในรูป|ให้ดู|ดูนะ|ดูได้)/;
/** คนอื่นเป็นผู้ส่ง ("เดี๋ยวแอดมินส่งรูปเครื่องจริงให้ดูนะคะ") — ไม่ใช่การอ้างว่ารูปแนบมากับข้อความนี้ */
const STAFF_ACTOR_RE = /(แอดมิน|ทีมงาน|ทีม|พนักงาน|staff)/i;

/**
 * ตัดบรรทัดที่อ้างรูปซึ่งไม่ได้แนบจริงออกจากข้อความสำรอง (pendingText) ก่อนส่ง — ใช้เฉพาะตอนที่รอบเขียนใหม่
 * ล้มแล้วต้องส่งข้อความเดิม (รีวิว SB-V2) · ตัดเฉพาะบรรทัดที่: มีคำอ้างว่าส่ง/แนบ + ไม่ใช่การรับปากของแอดมิน +
 * ไม่มีตัวเลข (บรรทัดที่มีเลขคือเนื้อหาเรท ห้ามทิ้ง) + อ้างชนิดรูปที่ไม่มีในช่องแนบ
 * (ตาราง = ใบเรท/โปรใดก็ได้ · แผนที่ = shop_map · "รูป" เฉย ๆ = ไม่มีรูปตารางแนบเลยสักใบ)
 * คืน '' ได้ (ทุกบรรทัดเป็นคำอ้างรูป) — ผู้เรียกต้องถอยไปข้อความสำรองของพนักงาน
 */
export function stripUnsentImageClaims(text: string, sentCards: readonly string[]): string {
  const sentKinds = new Set(sentCards.map((c) => (c === 'shop_map' ? 'map' : 'table')));
  return text
    .split('\n')
    .filter((line) => {
      const claimsAttachedImage =
        IMAGE_CLAIM_VERB_RE.test(line) && !STAFF_ACTOR_RE.test(line) && !/\d/.test(line);
      if (!claimsAttachedImage) return true;
      const unsentTable = /ตาราง/.test(line) && !sentKinds.has('table');
      const unsentMap = /แผนที่/.test(line) && !sentKinds.has('map');
      const unsentImage = /รูป/.test(line) && sentKinds.size === 0;
      return !(unsentTable || unsentMap || unsentImage);
    })
    .join('\n')
    .trim();
}

/**
 * ข้อความ SYSTEM GUARD เมื่อตัวเลขในคำตอบไม่มีที่มา — ให้โมเดลเขียนใหม่ครั้งเดียว
 * - canCallTools = รอบถัดไปเรียกเครื่องมือได้ไหม (รอบสุดท้ายบังคับ toolChoice 'none' ⇒ ห้ามสั่งให้เรียกเครื่องมือ — TOOLLOOP-6)
 * - NO_STOCK: calculate_installment ใช้ไม่ได้ ⇒ เหลือ get_installment_rates
 * - sideEffect: ข้อความมากับ send_rate_card/notify_staff (ทำไปแล้ว ห้ามเรียกซ้ำ) และยังไม่ถึงลูกค้า (TOOLLOOP-3)
 */
export function groundingGuardNote(opts: {
  reason: string;
  canCallTools: boolean;
  stockMode: StockMode;
  sideEffect: boolean;
}): string {
  const lead = opts.sideEffect
    ? 'ข้อความที่คุณเขียนมาพร้อมการเรียกเครื่องมือรอบนี้ถูกบล็อก ยังไม่ถูกส่งถึงลูกค้า (รูป/การแจ้งพนักงานในรอบนี้ทำไปแล้ว ห้ามเรียกซ้ำ)'
    : 'คำตอบล่าสุดถูกบล็อก';
  const rateTools =
    opts.stockMode === 'NO_STOCK'
      ? 'get_installment_rates'
      : 'calculate_installment (ของในสต็อก) หรือ get_installment_rates (รับออเดอร์)';
  const options = opts.canCallTools
    ? `(1) ใช้เฉพาะตัวเลขที่ tool คืนมาแล้วในบทสนทนานี้ ` +
      `(2) ถ้าจะพูดค่างวด เรียก ${rateTools} ก่อน ` +
      `(3) ตัดตัวเลขที่ไม่มีแหล่งออก แล้วถามขั้นถัดไปตามลำดับการขายแทน`
    : `(1) ใช้เฉพาะตัวเลขที่ tool คืนมาแล้วในบทสนทนานี้ ` +
      `(2) ตัดตัวเลขที่ไม่มีแหล่งออก แล้วถามขั้นถัดไปตามลำดับการขายแทน ` +
      `— รอบนี้เรียกเครื่องมือไม่ได้แล้ว ตอบเป็นข้อความอย่างเดียว`;
  return (
    `[SYSTEM GUARD — ลูกค้าไม่เห็นข้อความนี้ ห้ามเอ่ยถึง] ${lead}: ` +
    `มีตัวเลขที่ไม่ได้มาจากผล tool (${opts.reason}) — ห้ามคำนวณ/เดา/จำตัวเลขเอง ` +
    `เขียนคำตอบ${opts.sideEffect ? 'ทั้งหมด' : ''}ใหม่ทางใดทางหนึ่ง: ${options}`
  );
}

/** ผลของเครื่องมือสต๊อกในโหมดไม่มีสต๊อก — แชร์กับ bot-eval ให้ fixture ตรงกับของจริง */
export const NO_STOCK_TOOL_RESULT = {
  unavailable: true,
  note:
    'โหมดไม่มีสต๊อก: ระบบยังไม่มีรายการเครื่อง (หน้าร้านมีเครื่องจริง) — ห้ามพูดว่าหมด/มีของ/สีอะไร · ' +
    'ค่างวดใช้ get_installment_rates (เครื่องไทย) หรือ search_knowledge_base (โปรเครื่องนอก) · ' +
    'สี/แบต/รูปเครื่องจริง → notify_staff',
};

// เวลาทำการอยู่ที่ utils/shop-hours.util (ใช้ร่วมกับตัวส่งข้อความ) — re-export ให้ผู้เรียกเดิม
export { SHOP_OPEN_HOUR, SHOP_CLOSE_HOUR };
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * "[เวลาร้านตอนนี้: จันทร์ 22/09 21:05 น. · นอกเวลาทำการ (ร้านเปิด 10:00-19:00)]" — เวลาไทยเสมอ
 * (Cloud Run เป็น UTC) · persona ใช้บรรทัดนี้ตัดสินว่าจะพูด "รอสักครู่/รู้ผลใน 5 นาที" ได้ไหม
 */
export function shopClockLine(now: Date): string {
  const bkk = new Date(now.getTime() + 7 * 3_600_000);
  const h = bkk.getUTCHours();
  const hh = String(h).padStart(2, '0');
  const mm = String(bkk.getUTCMinutes()).padStart(2, '0');
  const dd = String(bkk.getUTCDate()).padStart(2, '0');
  const mo = String(bkk.getUTCMonth() + 1).padStart(2, '0');
  const state = isShopOpen(now) ? 'ในเวลาทำการ' : 'นอกเวลาทำการ';
  return `[เวลาร้านตอนนี้: ${TH_DAYS[bkk.getUTCDay()]} ${dd}/${mo} ${hh}:${mm} น. · ${state} (ร้านเปิด ${SHOP_OPEN_HOUR}:00-${SHOP_CLOSE_HOUR}:00) — ข้อความระบบ ลูกค้าไม่เห็น]`;
}

export type SalesBotAttachment = BotAttachment; // re-export ชื่อเดิมไว้ให้ผู้เรียกอ่านง่าย

export interface SalesBotResult {
  reply: string;
  confidence: number;
  toolsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  attachments?: SalesBotAttachment[]; // ← ใหม่ (optional = ผู้เรียกเดิมไม่พัง)
}

/**
 * ตัด photoUrl/webUrl ออกจากก้อน JSON ที่ส่งให้โมเดล (ยาว ~100-900 tokens/ครั้ง
 * ที่ search_products คืน 5 เครื่อง) — โมเดลไม่เคยใช้ URL พวกนี้ (ห้ามพ่น URL ใส่ลูกค้า
 * อยู่แล้ว) ส่วนการ์ดรูป/ลิงก์ที่ลูกค้าเห็นมาจาก collectAttachmentsFromToolResult
 * ซึ่งอ่านจาก result ดิบ ไม่ใช่ก้อนนี้
 */
export function redactMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMediaUrls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'photoUrl' || k === 'webUrl') continue;
      out[k] = redactMediaUrls(v);
    }
    return out;
  }
  return value;
}

// 6 (เดิม 4): โมเดลมักเรียกเครื่องมือทีละตัวต่อรอบ — เทิร์นเรทแรกเดิน rates → send_rate_card
// (+ search_products ที่โหมดไม่มีสต๊อกตอบว่าไม่มี) → ตอบ เกิน 4 รอบบ่อย จนได้ข้อความสำรอง
// "ให้พี่ staff เช็ค" แทนเรท (bot:eval 2026-09-22) · รอบสุดท้ายบังคับ toolChoice 'none' ให้เขียนคำตอบเสมอ
const MAX_TOOL_HOPS = 6;
/** ข้อความสำรองในเวลาทำการ (ขึ้นต้นเหมือนกันทั้งสองแบบ — สคริปต์วัดผลนับจากคำนี้) */
export const STAFF_FALLBACK_REPLY = 'ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติมสักครู่นะคะ';

/**
 * ข้อความสำรองเมื่อบอทตอบเองไม่ได้ — นอกเวลาทำการห้ามรับปาก "สักครู่" (ไม่มีคนตอบจนร้านเปิด ·
 * synth C03 / รีวิว PROMPT-8) · confidence 0.3 เสมอ ⇒ router มักส่งข้อความรอแอดมินของตัวเองแทน
 */
export function staffFallbackReply(now: Date): string {
  return isShopOpen(now)
    ? STAFF_FALLBACK_REPLY
    : `ขออนุญาตให้พี่ staff เช็คข้อมูลเพิ่มเติม แล้วตอบกลับช่วงร้านเปิด ${SHOP_OPEN_LABEL_TH}นะคะ`;
}

/**
 * คำตอบสั้นที่เป็น "การรับปากเปล่า ๆ" ('ได้ค่ะ' 'ผ่านค่ะ' 'มีค่ะ' 'ส่งได้ค่ะ') — ไม่มีข้อมูลรองรับ
 * ถ้าไม่ได้เรียกเครื่องมือในเทิร์นนั้น = อาจรับปากเรื่องนโยบาย/อนุมัติ/สต๊อกเอง ⇒ ไม่ส่งอัตโนมัติ
 * (แทนกฎเดิม "สั้นกว่า 20 ตัวอักษร = 0.6" ที่เปลี่ยน 'ยินดีค่ะ 😊' เป็นข้อความรอแอดมิน — synth C02)
 */
const BARE_PROMISE_RE =
  /^(?:ได้|มี|ผ่าน|ส่งได้|ผ่อนได้|ทำได้|รับได้|อนุมัติ|ใช่)(?:เลย|แน่นอน|แน่ๆ|แน่|แล้ว)?(?:ค่ะ|คะ|ค่า|ครับ|นะคะ|จ้า|จ้ะ)?(?:พี่)?$/;
export function isBarePromise(reply: string): boolean {
  const t = reply.trim();
  if (!t || t.length >= 20) return false;
  // ตัดอีโมจิ/เครื่องหมาย/ช่องว่าง เหลือแต่ตัวอักษรไทย-อังกฤษ-ตัวเลข
  const core = t.replace(/[^฀-๿a-zA-Z0-9]/g, '');
  return BARE_PROMISE_RE.test(core);
}

/**
 * Convert legacy Anthropic-style tool definition (uses `input_schema`)
 * to the provider-agnostic LlmToolDefinition (uses `inputSchema`).
 *
 * The tool definitions live as constants in each `tools/*.ts` file in
 * Anthropic shape. Rather than touching every file, we do a small adapter
 * here. Once we have confidence on Gemini parity, we can promote
 * LlmToolDefinition into the tool files directly.
 */
function adaptTool(t: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}): LlmToolDefinition {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  };
}

@Injectable()
export class SalesBotService {
  private readonly logger = new Logger(SalesBotService.name);

  constructor(
    private readonly providerRegistry: LlmProviderRegistry,
    private readonly searchProducts: SearchProductsTool,
    private readonly calcInstallment: CalculateInstallmentTool,
    private readonly listPromotions: ListPromotionsTool,
    private readonly handoff: HandoffToHumanTool,
    private readonly captureLead: CaptureLeadTool,
    private readonly getInstallmentRates: GetInstallmentRatesTool,
    private readonly searchKnowledgeBase: SearchKnowledgeBaseTool,
    private readonly recommendDevices: RecommendDevicesTool,
    private readonly compareDevices: CompareDevicesTool,
    private readonly persona: PersonaService,
    private readonly aiUsage: AiUsageService,
    // @Optional: ของใหม่ 2026-09-22 (โหมดไม่มีสต๊อก + ส่งรูปตารางผ่อน + แจ้งพนักงาน) —
    // ผู้สร้าง service แบบเดิม (spec/CLI) ที่ไม่ได้ให้มาจะได้พฤติกรรมเดิมทุกประการ
    @Optional() private readonly runtimeConfig?: BotRuntimeConfigService,
    @Optional() private readonly sendRateCard?: SendRateCardTool,
    @Optional() private readonly notifyStaff?: NotifyStaffTool,
  ) {}

  /**
   * ชุดเครื่องมือของเทิร์นนี้
   * - โหมดไม่มีสต๊อกยังประกาศเครื่องมือสต๊อกไว้ (runTool คืน NO_STOCK_TOOL_RESULT) — ถอดออกแล้วโมเดลยัง
   *   เรียกชื่อที่ไม่ได้ประกาศอยู่ดี (persona อ้างถึงทั้งเล่ม) หรือหลุดไปใช้สคริปต์ "ของกำลังเข้ามา"
   *   (bot:eval A/B 2026-09-22) และ Gemini ปฏิเสธการเรียกฟังก์ชันที่ไม่ได้ประกาศ
   * - send_rate_card ประกาศเฉพาะรูปที่ตั้งไว้ใน `shop_bot_rate_cards` (ไม่มีเลย = ไม่ประกาศ) —
   *   เดิมประกาศครบ 6 ใบ โมเดลจึงขอรูปที่ prod ไม่มีทุกเทิร์นเรทแรก (รีวิว TOOLLOOP-1)
   */
  static buildToolDefinitions(opts: {
    rateCards?: RateCardsConfig | null;
    notifyStaff: boolean;
  }): LlmToolDefinition[] {
    const rateCardTool = buildSendRateCardTool(opts.rateCards);
    return [
      SEARCH_PRODUCTS_TOOL,
      CALCULATE_INSTALLMENT_TOOL,
      LIST_PROMOTIONS_TOOL,
      HANDOFF_TO_HUMAN_TOOL,
      CAPTURE_LEAD_TOOL,
      GET_INSTALLMENT_RATES_TOOL,
      SEARCH_KNOWLEDGE_BASE_TOOL,
      RECOMMEND_DEVICES_TOOL,
      COMPARE_DEVICES_TOOL,
      ...(rateCardTool ? [rateCardTool] : []),
      ...(opts.notifyStaff ? [NOTIFY_STAFF_TOOL] : []),
    ].map(adaptTool);
  }

  // ต้อง await เสมอ — Cloud Run ตั้ง cpu-throttling=true: หลังจบ awaited chain ของ
  // webhook เบื้องหลัง CPU ถูกตัด ทำให้ promise ที่ไม่มีใคร await ค้างและตายเงียบ
  // (ai_usage_logs ไม่มีแถวใหม่เลยตั้งแต่ 23 ส.ค. ทั้งที่โค้ดถูก — insert ~5ms รอได้)
  private async recordUsage(
    modelUsed: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await this.aiUsage.record({
      service: 'sales-bot',
      method: 'generateReply',
      model: modelUsed || 'unknown',
      inputTokens,
      outputTokens,
      status: 'success',
    });
  }

  /**
   * Generate a SHOP sales reply.
   *
   * Default path: provider is resolved from SystemConfig via LlmProviderRegistry.
   * Bench-test override: pass `explicitProvider` to bypass registry and target
   * a specific provider implementation (used by shop-ai-bench CLI).
   */
  async generateReply(
    input: SalesBotInput,
    explicitProvider?: import('./providers/llm-provider.interface').ILlmProvider,
  ): Promise<SalesBotResult> {
    const now = input.now ?? new Date();
    const stockMode: StockMode = (await this.runtimeConfig?.getStockMode()) ?? 'LIVE';
    const rateCards: RateCardsConfig = this.sendRateCard
      ? ((await this.runtimeConfig?.getRateCards()) ?? {})
      : {};
    const tools: LlmToolDefinition[] = SalesBotService.buildToolDefinitions({
      rateCards,
      notifyStaff: !!this.notifyStaff,
    });

    const messages: LlmChatMessage[] = [
      ...(input.sessionNote ? [{ role: 'user', content: input.sessionNote } as LlmChatMessage] : []),
      ...(input.priorMessages ?? []).map(
        (m): LlmChatMessage => ({ role: m.role, content: m.content }),
      ),
      // บอกเวลาร้านตอนนี้ไว้ต้นข้อความล่าสุด (ไม่ใส่ใน system — prompt cache ต้องคงที่) —
      // เดิมบอทไม่รู้เวลาเลย ตอบตีสองก็ยังสัญญา "รู้ผลใน 5 นาที/รอสักครู่" (พบ 2026-09-22)
      { role: 'user', content: `${shopClockLine(now)}\n${input.text}` },
    ];

    const provider = explicitProvider ?? (await this.providerRegistry.getActive());
    // Resolve persona ONCE per generateReply call (not per hop) so a mid-stream
    // edit from /settings/ai-persona doesn't flip the system prompt halfway
    // through a tool loop. PersonaService cache makes this O(1) most of the
    // time anyway.
    const personaPrompt = await this.persona.getBot();
    // ต่อท้าย (ไม่แทรกกลาง) ⇒ prefix ของ persona ยังเป็นก้อนเดียวกับโหมดปกติ
    const systemPrompt = stockMode === 'NO_STOCK' ? `${personaPrompt}\n${NO_STOCK_PROMPT}` : personaPrompt;
    const toolsUsed: string[] = [];
    // Grounding ledger: every priceThb the model has seen via tool results
    // this session. Used by guardGrounding() to catch hallucinated prices
    // (e.g. Gemini 2.5 ignored PR #1064 anti-hallucinate rules and replied
    // "iPhone 15 7,000" though tool returned only iPhone 13/16 at 14,691/17,000).
    const groundedPrices = new Set<number>();
    // เลขที่อยู่ในบทสนทนาแล้ว = มีที่มาเช่นกัน (แก้ false positive จากเทสจริง 2026-08-15:
    // ลูกค้าบอกงบ "3000" → บอททวน "งบดาวน์ 3,000 บาท" → โดน block ฐานไม่มี tool result):
    // - เลขที่ลูกค้าพิมพ์เอง (งบ/ยอดที่ต่อรอง) — บอทต้องทวนได้
    // - เลขที่บอทเคยส่งไปแล้วในเทิร์นก่อน — ผ่าน guard ตอนส่งครั้งแรกแล้ว
    //   (เช่น ทวน "เรทที่ 1 ดาวน์ 1,900" หลังลูกค้าเลือก โดยไม่ต้องเรียก tool ซ้ำ)
    collectConversationNumbers(input.text, groundedPrices);
    for (const pm of input.priorMessages ?? []) {
      collectConversationNumbers(pm.content, groundedPrices);
    }
    // เลขในสมุดสถานะ (งบ/เรทที่จดไว้ข้ามวัน) ก็มีที่มาแล้วเช่นกัน — ยกเว้นโน้ตเก่า
    // (>48 ชม.): ราคา/เรทอาจเปลี่ยนแล้ว บังคับให้บอทเรียก tool ใหม่ก่อนทวนตัวเลข
    if (input.sessionNote && !input.sessionNoteStale) {
      collectConversationNumbers(input.sessionNote, groundedPrices);
    }
    // ช่องส่งรูป/ลิงก์ — เติมจาก "ผลลัพธ์ tool" เท่านั้น (deterministic)
    const attachments = new Map<string, BotAttachment>();
    let totalIn = 0;
    let totalOut = 0;
    let modelUsed = '';
    // Distinguishes "the LLM provider blew up" from "a tool (often Prisma-backed)
    // blew up mid-loop" so the AiUsage error row tells an honest story instead of
    // always blaming the provider — see the outer catch below.
    let toolFailed = false;
    // One self-correction retry when guardGrounding blocks a reply — see below.
    let groundingRetried = false;
    // คำตอบที่ผ่านด่านตัวเลขแล้วแต่ยังไม่ได้ส่ง เพราะมากับ send_rate_card/notify_staff ที่ไม่สะอาด (รูปบางใบส่งไม่ได้)
    // ระหว่างรอโมเดลเขียนใหม่ — รอบเขียนใหม่ว่าง / ตัวเลขไม่ผ่าน / หมดรอบ → ส่งข้อความนี้แทนข้อความสำรอง
    // (คำตัดสินข้อ 2: รูปหายต้องไม่ทำให้ข้อความที่เขียนแล้วหาย — รีวิว SB-V2) · ตัดบรรทัดที่อ้างรูปที่ไม่ได้แนบแล้ว
    let pendingText: string | null = null;

    const staffFallback = async (): Promise<SalesBotResult> => {
      await this.recordUsage(modelUsed, totalIn, totalOut);
      return {
        reply: staffFallbackReply(now),
        confidence: 0.3,
        toolsUsed,
        inputTokens: totalIn,
        outputTokens: totalOut,
        modelUsed,
      };
    };
    const finalReply = async (text: string): Promise<SalesBotResult> => {
      await this.recordUsage(modelUsed, totalIn, totalOut);
      return {
        reply: stripStrayForeignScript(text),
        confidence: this.estimateConfidence(text, toolsUsed),
        toolsUsed,
        inputTokens: totalIn,
        outputTokens: totalOut,
        modelUsed,
        ...(attachments.size > 0
          ? { attachments: [...attachments.values()].slice(0, MAX_BOT_ATTACHMENTS) }
          : {}),
      };
    };
    /** ยอมแพ้ในเทิร์นนี้ — มีคำตอบที่ผ่านด่านค้างอยู่ (pendingText) ใช้อันนั้น ไม่งั้นข้อความสำรองของพนักงาน */
    const giveUp = async (hop: number, why: string): Promise<SalesBotResult> => {
      if (pendingText) {
        this.logger.warn(
          `[FinalReply] room=${input.roomId} hop=${hop} ${why} → pending side-effect reply toolsUsed=${JSON.stringify(toolsUsed)}`,
        );
        return finalReply(pendingText);
      }
      return staffFallback();
    };

    try {
      for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
        // รอบถัดไปยังเรียกเครื่องมือได้ไหม — รอบสุดท้ายบังคับ toolChoice 'none' (คำสั่งแก้ตัวต้องไม่สั่งเรียกเครื่องมือ)
        const nextHopCanCallTools = hop + 1 < MAX_TOOL_HOPS - 1;
        const resp = await provider.chat({
          systemPrompt,
          messages,
          tools,
          ...(hop === MAX_TOOL_HOPS - 1 ? { toolChoice: 'none' as const } : {}),
        });
        totalIn += resp.inputTokens;
        totalOut += resp.outputTokens;
        modelUsed = resp.modelName;

        if (resp.toolCalls.length === 0) {
          this.logger.log(
            `[FinalReply] room=${input.roomId} hop=${hop} toolsUsed=${JSON.stringify(toolsUsed)} reply=${JSON.stringify(resp.text).slice(0, 400)}`,
          );
          const grounding = guardGrounding(resp.text, groundedPrices);
          if (!grounding.ok) {
            this.logger.warn(
              `[GroundingGuard] room=${input.roomId} HALLUCINATION_BLOCKED reason=${grounding.reason} reply=${JSON.stringify(resp.text).slice(0, 200)} grounded=${JSON.stringify([...groundedPrices])}`,
            );
            // Self-correct ครั้งเดียวก่อนยอมแพ้: ป้อนเหตุผลที่โดนบล็อกกลับให้โมเดล
            // เขียนใหม่ (แทนที่จะเงียบ+handoff ทันที — ลูกค้าไม่ได้คำตอบทั้งที่แค่
            // ตัวเลขไม่มีแหล่ง เช่น Haiku คำนวณค่างวดเองแทนที่จะเรียก tool)
            // มีคำตอบเดิมที่ผ่านด่านค้างอยู่ = ใช้อันนั้นเลย ไม่ต้องเสียรอบแก้ตัว (รอบเขียนใหม่แต่งตัวเลขเอง)
            if (pendingText) return giveUp(hop, 'rewrite HALLUCINATION_BLOCKED');
            if (!groundingRetried && hop < MAX_TOOL_HOPS - 1) {
              groundingRetried = true;
              messages.push({ role: 'assistant', content: resp.text });
              messages.push({
                role: 'user',
                content: groundingGuardNote({
                  reason: grounding.reason ?? '',
                  canCallTools: nextHopCanCallTools,
                  stockMode,
                  sideEffect: false,
                }),
              });
              continue;
            }
            return staffFallback();
          }
          // ไม่มีทั้งข้อความและการเรียกเครื่องมือ (เช่น โดน max_tokens ตัด) — ห้ามส่งบับเบิลว่าง
          if (!resp.text.trim()) {
            this.logger.warn(`[FinalReply] room=${input.roomId} hop=${hop} EMPTY_REPLY`);
            return giveUp(hop, 'EMPTY_REPLY');
          }
          return finalReply(resp.text);
        }

        // Record + execute every tool call from this turn (typically 1, but
        // models can request several at once — prompt v2.18 encourages calling
        // them together). Execute in PARALLEL: tools are independent reads
        // (search/rates/calc/promotions), so concurrent execution shaves the
        // sum of their latencies down to the max.
        for (const tc of resp.toolCalls) toolsUsed.push(tc.name);
        const executed = await Promise.all(
          resp.toolCalls.map(async (tc) => {
            try {
              return { tc, result: await this.runTool(tc.name, tc.input, input.roomId, stockMode) };
            } catch (toolError) {
              // Tag before rethrow — tools are Prisma-backed and can throw for
              // reasons that have nothing to do with the LLM provider (DB down,
              // constraint violation, etc). The outer catch reads this flag to
              // record an honest errorKind instead of always blaming the provider.
              toolFailed = true;
              throw toolError;
            }
          }),
        );
        // เก็บรูปแนบให้ครบทั้งรอบก่อน แล้วค่อยกระทบยอด send_rate_card กับช่องแนบจริง
        // (รูปตารางชนะรูปสินค้าเมื่อช่องเต็ม — ใบที่แนบไม่ได้ย้ายไป missing)
        for (const { tc, result } of executed) {
          collectGroundedPrices(result, groundedPrices);
          collectGroundedPricesFromToolText(tc.name, result, groundedPrices);
          collectAttachmentsFromToolResult(tc.name, result, attachments);
        }
        const settled = executed.map(({ tc, result }) => ({
          tc,
          result: tc.name === 'send_rate_card' ? reconcileRateCardResult(result, attachments) : result,
        }));
        const textWasWritten = resp.text.trim() !== '';
        const payloads: unknown[] = settled.map(({ tc, result }) => {
          this.logger.log(
            `[ToolCall] room=${input.roomId} tool=${tc.name} args=${JSON.stringify(tc.input).slice(0, 300)} result=${JSON.stringify(result).slice(0, 600)}`,
          );
          const redacted = redactMediaUrls(result);
          const r = result as Partial<SendRateCardResult> | null;
          if (tc.name === 'send_rate_card' && Array.isArray(r?.missing) && r.missing.length > 0) {
            return withSystemNote(
              redacted,
              rateCardMissingNote({
                missing: r.missing,
                sent: (r.sent ?? []).map((s) => s.card),
                textWasWritten,
              }),
            );
          }
          return redacted;
        });

        // คำตอบเขียนมาพร้อมเครื่องมือลงมือแทนล้วน (ส่งรูป/ปักธง) — ข้อความนี้คือคำตอบของเทิร์น
        if (textWasWritten && settled.every(({ tc }) => SIDE_EFFECT_TOOL_NAMES.has(tc.name))) {
          const allClean = settled.every(({ tc, result }) => isCleanSideEffectResult(tc.name, result));
          const grounding = guardGrounding(resp.text, groundedPrices);
          if (allClean && grounding.ok) {
            this.logger.log(
              `[FinalReply] room=${input.roomId} hop=${hop} sideEffectOnly toolsUsed=${JSON.stringify(toolsUsed)} reply=${JSON.stringify(resp.text).slice(0, 400)}`,
            );
            return finalReply(resp.text);
          }
          if (grounding.ok) {
            // ไม่สะอาด (รูปบางใบส่งไม่ได้ / ไม่ได้ระบุรูป) แต่ตัวเลขผ่าน — เก็บไว้เผื่อรอบเขียนใหม่ล้ม (SB-V2)
            // ช่องแนบสะสมทั้งเทิร์นและถูกส่งพร้อมคำตอบ ⇒ นับรูปที่แนบจากรอบก่อนด้วย
            const sentCards = [...attachments.keys()]
              .filter((k) => k.startsWith(RATE_CARD_ID_PREFIX))
              .map((k) => k.slice(RATE_CARD_ID_PREFIX.length));
            pendingText = stripUnsentImageClaims(resp.text, sentCards) || pendingText;
          } else {
            this.logger.warn(
              `[GroundingGuard] room=${input.roomId} HALLUCINATION_BLOCKED sideEffect reason=${grounding.reason} reply=${JSON.stringify(resp.text).slice(0, 200)} grounded=${JSON.stringify([...groundedPrices])}`,
            );
            // แก้ตัวครั้งเดียวเหมือนทางไม่มีเครื่องมือ — แต่ส่งคำสั่งในผลเครื่องมือ (ไม่ใช่ข้อความ user แยก)
            // เดิมวนต่อเงียบ ๆ ⇒ รอบถัดไปได้แค่ "ส่งตารางให้ดูนะคะ" ไม่มีตัวเลข (รีวิว TOOLLOOP-3)
            // มีคำตอบเดิมที่ผ่านด่านค้างอยู่ = ใช้อันนั้นเลย (รูป/ธงของรอบนี้ทำไปแล้วและแนบไปด้วย)
            if (pendingText) return giveUp(hop, 'sideEffect rewrite HALLUCINATION_BLOCKED');
            if (groundingRetried) return staffFallback();
            groundingRetried = true;
            payloads[payloads.length - 1] = withSystemNote(
              payloads[payloads.length - 1],
              groundingGuardNote({
                reason: grounding.reason ?? '',
                canCallTools: nextHopCanCallTools,
                stockMode,
                sideEffect: true,
              }),
            );
          }
          // ไม่สะอาด (รูปบางใบส่งไม่ได้) → systemNote ในผล send_rate_card สั่งเขียนคำตอบใหม่ทั้งก้อนแล้ว
        }

        // Conversation grows: assistant turn (text + tool_calls) then tool results.
        messages.push({
          role: 'assistant',
          content: resp.text,
          toolCalls: resp.toolCalls as LlmToolCall[],
        });
        settled.forEach(({ tc }, i) => {
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: JSON.stringify(payloads[i]),
          });
        });
      }

      return giveUp(MAX_TOOL_HOPS, 'MAX_TOOL_HOPS');
    } catch (error) {
      await this.aiUsage.record({
        service: 'sales-bot',
        method: 'generateReply',
        model: modelUsed || 'unknown',
        inputTokens: totalIn,
        outputTokens: totalOut,
        status: 'error',
        errorKind: toolFailed ? 'tool_error' : 'provider_error',
      });
      throw error;
    }
  }

  private async runTool(
    name: string,
    input: Record<string, unknown>,
    roomId: string,
    stockMode: StockMode = 'LIVE',
  ): Promise<unknown> {
    // โหมดไม่มีสต๊อก: ถอดเครื่องมือสต๊อกออกจากรายการแล้ว แต่ persona ยังเอ่ยชื่อบ่อย โมเดลจึงเรียกชื่อเองได้
    // (API ไม่บล็อกชื่อที่ไม่ได้ประกาศ — เจอจริงใน bot:eval 2026-09-22) — ผลว่างจะทำให้บอทพูดว่า "หมด"
    // จึงคืนข้อความบอกโหมดแทน
    if (stockMode === 'NO_STOCK' && STOCK_TOOL_NAMES.has(name)) return NO_STOCK_TOOL_RESULT;
    switch (name) {
      case 'search_products':
        return this.searchProducts.run(input as { query: string; maxPriceThb?: number });
      case 'calculate_installment':
        return this.calcInstallment.run(
          input as { productId: string; downPct?: number; tenureMonths: number },
        );
      case 'list_promotions':
        return this.listPromotions.run(input as { productId?: string });
      case 'handoff_to_human':
        return this.handoff.run({
          reason: String(input.reason ?? 'bot_uncertain'),
          roomId,
        });
      case 'capture_lead':
        return this.captureLead.run({
          customerName: String(input.customerName ?? ''),
          phone: String(input.phone ?? ''),
          address: input.address as string | undefined,
          productId: input.productId ? String(input.productId) : undefined,
          packageChoice: input.packageChoice as 'A' | 'B' | 'C' | undefined,
          productNote: input.productNote ? String(input.productNote) : undefined,
          // schema ประกาศ visitPlan ไว้แต่เดิมไม่ถูกส่งต่อ ⇒ แผนเข้าร้านของลูกค้าหายทุก lead (พบ 2026-09-22)
          visitPlan: input.visitPlan ? String(input.visitPlan) : undefined,
          downAmount: Number(input.downAmount ?? 0),
          roomId,
        });
      case 'get_installment_rates':
        return this.getInstallmentRates.run(input);
      case 'search_knowledge_base':
        return this.searchKnowledgeBase.run({ query: String(input.query ?? '') });
      case 'recommend_devices': {
        // parse ให้ปลอดภัย — โมเดลอาจส่งเลขเป็น string ("3000") หรือส่ง null มา
        const optStr = (v: unknown): string | undefined =>
          v != null && String(v).trim() ? String(v).trim() : undefined;
        const optNum = (v: unknown): number | undefined => {
          if (v == null || v === '') return undefined;
          if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
          // โมเดลอาจส่ง "3,000 บาท" / "3 พัน" / "5k" มาเป็น string
          const raw = String(v).replace(/,/g, '').trim().toLowerCase();
          const m = /(\d+(?:\.\d+)?)\s*(หมื่น|พัน|k)?/.exec(raw);
          if (!m) return undefined;
          const mult = m[2] === 'หมื่น' ? 10_000 : m[2] === 'พัน' || m[2] === 'k' ? 1_000 : 1;
          const n = Number(m[1]) * mult;
          return Number.isFinite(n) && n > 0 ? n : undefined;
        };
        const args = {
          currentModel: optStr(input.currentModel),
          downBudget: optNum(input.downBudget),
          monthlyBudget: optNum(input.monthlyBudget),
          preferStorage: optStr(input.preferStorage),
        };
        // โหมดไม่มีสต๊อก: ไม่อ่านสต๊อกในระบบ (แถวค้างห้ามถูกดันขึ้นก่อน) + ตัดฟิลด์สต๊อก/สี/แบตออกก่อนถึงโมเดล
        // (รีวิว TOOLLOOP-4 — เดิมการ์ดแนะนำพก inStock/sampleUnit สี+แบตของแถว Product สด)
        if (stockMode === 'NO_STOCK') {
          return stripRecommendStockFields(await this.recommendDevices.run(args, { ignoreStock: true }));
        }
        return this.recommendDevices.run(args);
      }
      case 'compare_devices':
        return this.compareDevices.run({
          currentModel: String(input.currentModel ?? ''),
          candidateModel: String(input.candidateModel ?? ''),
        });
      case 'send_rate_card':
        if (!this.sendRateCard) return { error: 'unknown_tool' };
        return this.sendRateCard.run({ cards: input.cards });
      case 'notify_staff':
        if (!this.notifyStaff) return { error: 'unknown_tool' };
        return this.notifyStaff.run({ reason: String(input.reason ?? ''), roomId });
      default:
        return { error: 'unknown_tool' };
    }
  }

  /**
   * Confidence used by AiAutoReplyService threshold gating (default 0.80).
   *
   * Mapping (synth C02 2026-09-22):
   * - handoff_to_human used                         → 0.3  (signal to handoff path, do not auto-send)
   * - empty reply                                   → 0    (never auto-send an empty bubble)
   * - short bare promise, no tool this turn         → 0.6  ('ได้ค่ะ' 'ผ่านค่ะ' 'มีค่ะ' 'ส่งได้ค่ะ' — อาจรับปากนโยบาย/อนุมัติเอง)
   * - tool-used reply                               → 0.95 (high confidence: fact-grounded)
   * - any other reply, incl. short ones             → 0.9  ('ยินดีค่ะ 😊' 'ค่ะ' — เดิม < 20 ตัวอักษร = 0.6
   *                                                    ทำให้คำตอบสั้นที่ถูกต้องกลายเป็นข้อความรอแอดมิน)
   */
  private estimateConfidence(reply: string, toolsUsed: string[]): number {
    if (toolsUsed.includes('handoff_to_human')) return 0.3;
    if (!reply.trim()) return 0;
    if (toolsUsed.length === 0 && isBarePromise(reply)) return 0.6;
    if (toolsUsed.length > 0) return 0.95;
    return 0.9;
  }
}
