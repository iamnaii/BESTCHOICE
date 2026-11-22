import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { BuybackQuoteDto } from './dto/quote.dto';

export const QUOTE_WINDOW_MS = 24 * 60 * 60 * 1000;
type Input = Pick<BuybackQuoteDto, 'model' | 'storage' | 'answers' | 'deviceEligibilityConfirmed'>;
type WindowPayload = { version: 1; assessed: number; expires: number; input: string };
function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new ServiceUnavailableException('ยังไม่สามารถออกผลประเมินได้ กรุณาลองใหม่');
  return value;
}
function digest(input: Input) {
  return createHash('sha256').update(JSON.stringify({
    model: input.model, storage: input.storage,
    eligibility: input.deviceEligibilityConfirmed === true,
    answers: input.answers.map((a) => ({ key: a.questionKey, choices: [...a.choiceIds].sort() }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  })).digest('hex');
}
function signature(body: string, key: string) {
  return createHmac('sha256', key).update(`bestchoice-sell-quote-v1:${body}`).digest('base64url');
}
function dates(payload: WindowPayload) {
  return { assessedAt: new Date(payload.assessed).toISOString(), expiresAt: new Date(payload.expires).toISOString() };
}
export function issueQuoteWindow(input: Input, now = Date.now(), key = secret()) {
  const payload: WindowPayload = { version: 1, assessed: now, expires: now + QUOTE_WINDOW_MS, input: digest(input) };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { ...dates(payload), serverNow: new Date(now).toISOString(), quoteToken: `${body}.${signature(body, key)}` };
}
export function verifyQuoteWindow(token: string | undefined, input: Input, now = Date.now(), key = secret()) {
  const invalid = () => new BadRequestException({ code: 'QUOTE_INVALID', message: 'ผลประเมินไม่ตรงกับข้อมูลนี้ กรุณาประเมินราคาใหม่' });
  if (!token || token.length > 2048) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2) throw invalid();
  const [body, supplied] = parts;
  const expected = signature(body, key);
  if (!/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw invalid();
  let payload: WindowPayload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (!payload || typeof payload !== 'object' || payload.version !== 1 || !Number.isSafeInteger(payload.assessed) || !Number.isSafeInteger(payload.expires)
    || payload.expires - payload.assessed !== QUOTE_WINDOW_MS || payload.assessed > now
    || payload.input !== digest(input)) throw invalid();
  if (now >= payload.expires) throw new BadRequestException({ code: 'QUOTE_EXPIRED', message: 'พ้นช่วงอ้างอิง 24 ชั่วโมงแล้ว กรุณาประเมินราคาใหม่' });
  return dates(payload);
}
