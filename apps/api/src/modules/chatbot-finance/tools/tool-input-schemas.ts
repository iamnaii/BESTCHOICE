/**
 * Runtime validation schemas for Claude tool_use inputs.
 *
 * Why: Claude Sonnet receives user-crafted prompts and may be coerced (prompt
 * injection) into emitting tool_use blocks with unexpected shapes — extra
 * fields, wrong types, PII echoed back into tool args. Executing those
 * directly risks leaking data via tool-side queries and polluting our audit
 * logs with PII.
 *
 * This layer is defense-in-depth next to the tool-definitions JSON Schema
 * (which Claude *should* obey but we do not trust). Inputs failing validation
 * are rejected with `invalid tool input` and logged as Sentry warning.
 *
 * PII redaction (keys matching /password|token|secret|national[_-]?id/i) is
 * applied when serialising inputs for the audit trail — the underlying
 * validator rejects the call before execution anyway, but defence is layered.
 */

import { ToolName } from './tool-definitions';

export interface ValidationOk {
  ok: true;
  value: Record<string, unknown>;
}

export interface ValidationErr {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

type Validator = (input: unknown) => ValidationResult;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function emptyObject(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    return { ok: true, value: {} };
  };
}

function calculateFineInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const days = input.daysOverdue;
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days > 3650) {
      return { ok: false, error: 'daysOverdue ต้องเป็นตัวเลข 0-3650' };
    }
    return { ok: true, value: { daysOverdue: days } };
  };
}

function searchKnowledgeBaseInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const query = input.query;
    if (typeof query !== 'string') return { ok: false, error: 'query ต้องเป็น string' };
    const trimmed = query.trim();
    if (trimmed.length === 0) return { ok: false, error: 'query ห้ามว่าง' };
    if (trimmed.length > 500) return { ok: false, error: 'query ยาวเกินไป (สูงสุด 500 ตัวอักษร)' };
    return { ok: true, value: { query: trimmed } };
  };
}

function handoffToHumanInput(): Validator {
  const allowedPriorities = new Set(['low', 'normal', 'high', 'critical']);
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const { reason, priority, summary } = input;
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200) {
      return { ok: false, error: 'reason ต้องเป็น string ไม่เกิน 200 ตัวอักษร' };
    }
    if (typeof priority !== 'string' || !allowedPriorities.has(priority)) {
      return { ok: false, error: 'priority ต้องเป็น low|normal|high|critical' };
    }
    if (typeof summary !== 'string' || summary.length > 1000) {
      return { ok: false, error: 'summary ต้องเป็น string ไม่เกิน 1000 ตัวอักษร' };
    }
    return {
      ok: true,
      value: { reason: reason.trim(), priority, summary: summary.trim() },
    };
  };
}

function searchProductsInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const query = input.query;
    if (typeof query !== 'string') return { ok: false, error: 'query ต้องเป็น string' };
    const trimmed = query.trim();
    if (trimmed.length === 0) return { ok: false, error: 'query ห้ามว่าง' };
    if (trimmed.length > 200) return { ok: false, error: 'query ยาวเกินไป (สูงสุด 200 ตัวอักษร)' };
    const value: Record<string, unknown> = { query: trimmed };
    const cap = input.maxPriceThb;
    if (cap !== undefined) {
      if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0 || cap > 10_000_000) {
        return { ok: false, error: 'maxPriceThb ต้องเป็นตัวเลข 1-10,000,000' };
      }
      value.maxPriceThb = cap;
    }
    return { ok: true, value };
  };
}

function calculateInstallmentInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const productId = input.productId;
    if (typeof productId !== 'string' || productId.trim().length === 0 || productId.length > 64) {
      return { ok: false, error: 'productId ต้องเป็น string ไม่เกิน 64 ตัวอักษร' };
    }
    const tenure = input.tenureMonths;
    if (typeof tenure !== 'number' || !Number.isInteger(tenure) || tenure < 1 || tenure > 60) {
      return { ok: false, error: 'tenureMonths ต้องเป็นจำนวนเต็ม 1-60' };
    }
    const value: Record<string, unknown> = { productId: productId.trim(), tenureMonths: tenure };
    const downPct = input.downPct;
    if (downPct !== undefined) {
      if (typeof downPct !== 'number' || !Number.isFinite(downPct) || downPct < 0 || downPct > 100) {
        return { ok: false, error: 'downPct ต้องเป็นตัวเลข 0-100' };
      }
      value.downPct = downPct;
    }
    return { ok: true, value };
  };
}

function listPromotionsInput(): Validator {
  return (input) => {
    if (!isPlainObject(input)) return { ok: false, error: 'input ต้องเป็น object' };
    const productId = input.productId;
    if (productId === undefined) return { ok: true, value: {} };
    if (typeof productId !== 'string' || productId.length > 64) {
      return { ok: false, error: 'productId ต้องเป็น string ไม่เกิน 64 ตัวอักษร' };
    }
    return { ok: true, value: { productId: productId.trim() } };
  };
}

const TOOL_INPUT_VALIDATORS: Record<ToolName, Validator> = {
  get_current_balance: emptyObject(),
  get_payment_schedule: emptyObject(),
  calculate_fine: calculateFineInput(),
  list_recent_receipts: emptyObject(),
  get_bank_info: emptyObject(),
  search_knowledge_base: searchKnowledgeBaseInput(),
  handoff_to_human: handoffToHumanInput(),
  search_products: searchProductsInput(),
  calculate_installment: calculateInstallmentInput(),
  list_promotions: listPromotionsInput(),
};

export function validateToolInput(name: string, input: unknown): ValidationResult {
  const validator = TOOL_INPUT_VALIDATORS[name as ToolName];
  if (!validator) {
    return { ok: false, error: `unknown tool: ${name}` };
  }
  return validator(input);
}

const PII_KEY_REGEX = /password|token|secret|national[_-]?id/i;

/**
 * Shallow copy of input with PII-looking keys redacted. Used when writing to
 * audit trails / Sentry extras — never pass to the underlying service.
 */
export function redactPii(input: unknown): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (PII_KEY_REGEX.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof val === 'string' && val.length > 200) {
      out[key] = val.slice(0, 200) + '…';
    } else {
      out[key] = val;
    }
  }
  return out;
}
