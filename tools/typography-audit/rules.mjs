// Typography audit — pure decision layer (no browser, no app imports).
// Consumes Fact[] from the in-page collector; produces Finding[] / DeltaFinding[].

export const SCALE_TOLERANCE_PX = 0.5;
export const PROFILES = {
  web: { scale: [12, 13, 14, 16, 18, 20, 22, 24, 30, 36], weights: [300, 400, 500, 600, 700], sarabunInReadingBlock: false },
  shop: { scale: [12, 14, 16, 18, 20, 24, 30, 36, 48], weights: [400, 500, 600, 700], sarabunInReadingBlock: true },
};

export const UI_FONT_RE = /^["']?Noto Sans Thai["']?,/;
export const SARABUN_RE = /^["']?Sarabun["']?,/;
export const NUMERIC_ONLY_RE = /^[\d,.\s฿%+\-–/]+$/;
// numeric-only = plan regex AND at least one ASCII digit ('-', '/', '–' placeholders are not numbers).
// The collector computes Fact.numericOnly with these semantics; R10 trusts the flag only.
export const isNumericOnly = (text) => NUMERIC_ONLY_RE.test(text) && /[0-9]/.test(text);
export const NON_DIFF_RULES = ['R8'];
const SEVERITY_RANK = { P3: 1, P2: 2, P1: 3 };

export const LH_SMALL_MAX_FONT = 20; // < 20px uses the small range
export const LH_SMALL_RANGE = [1.4, 1.8];
export const LH_LARGE_RANGE = [1.2, 1.6];
export const LH_THAI_MIN = 1.2;
export const LH_EPSILON = 1e-6; // float noise only; spec has no tolerance
export const INK_CLIP_SLACK_PX = 1;
export const DESKTOP_MIN_WIDTH = 1024; // R5 P1 at/above
export const MOBILE_MAX_WIDTH = 430;
export const TABLET_MIN_WIDTH = 768;
export const TOUCH_MIN_MOBILE = 44;
export const TOUCH_MIN_DESKTOP = 36;
export const INPUT_MIN_FONT_MOBILE = 16;
export const TNUM_MIN_FONT = 20;
export const ICON_RATIO_RANGE = [0.85, 1.6];
export const MEASURE_MIN_WIDTH = 1280;
export const MEASURE_MAX_EM = 45;
export const D1_INK_WIDTH_CHANGE = 0.08;
export const D2_OFFSET_PX = 1.5;
export const D2_WORSE_BY_PX = 0.5;
export const D2_FIXED_HEIGHT_PX = 0.5;

export const R5_KINDS = ['button', 'badge', 'th', 'nav', 'tab'];
export const R6_KINDS = ['button', 'badge', 'th', 'nav', 'tab', 'label'];
export const R7_KINDS = ['button', 'input'];
export const D2_KINDS = ['button', 'badge', 'input', 'tab'];

// ---- key (reference implementation; the in-page collector must replicate exactly) ----
// normalizeKeyText: collapse whitespace runs to one space, trim, replace EVERY digit (0-9)
// with '#', keep the first 40 characters (UTF-16 code units, i.e. String.slice(0, 40)).
// factKey: `${kind}|${normalizeKeyText(text)}|${dup}` where dup = 0-based index among facts
// on the page with the same kind + normalized text.
export const normalizeKeyText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[0-9]/g, '#').slice(0, 40);
export const factKey = (kind, text, dup) => `${kind}|${normalizeKeyText(text)}|${dup}`;
export const findingKey = (f) => `${f.route}|${f.width}|${f.theme}|${f.role}|${f.rule}|${f.key}`;

// Shared key resolver (evaluateTypography + compareFacts): fact.key when present, else
// factKey(kind, text, dup) with dup = count of earlier facts of same kind + normalized text.
export function resolveKeys(facts) {
  const seen = new Map();
  return facts.map((f) => {
    const base = `${f.kind}|${normalizeKeyText(f.text)}`;
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    return f.key ? f.key : factKey(f.kind, f.text, dup);
  });
}

const inRange = (v, [lo, hi]) => v >= lo - LH_EPSILON && v <= hi + LH_EPSILON;
const finite = (n) => Number.isFinite(n);

export function evaluateTypography(facts, ctx) {
  const profile = PROFILES[ctx.app];
  const out = [];
  const keys = resolveKeys(facts);
  const h1Max = Math.max(0, ...facts.filter((f) => f.headingLevel === 1).map((f) => f.fontSize));

  for (const [i, f] of facts.entries()) {
    const emit = (rule, severity, detail) => out.push({
      rule, severity, route: ctx.route, width: ctx.width, theme: ctx.theme, role: ctx.role,
      key: keys[i], text: f.text, detail,
    });

    // R1
    if (!profile.scale.some((s) => Math.abs(s - f.fontSize) <= SCALE_TOLERANCE_PX)) {
      emit('R1', 'P3', { fontSize: f.fontSize, scale: profile.scale });
    }
    // R2 (Ruling E)
    if ((f.headingLevel === 2 || f.headingLevel === 3) && h1Max > 0 && f.fontSize > h1Max + SCALE_TOLERANCE_PX) {
      emit('R2', 'P2', { headingLevel: f.headingLevel, fontSize: f.fontSize, h1FontSize: h1Max });
    }
    // R3 (Ruling F)
    if (finite(f.lineHeight) && f.fontSize > 0) {
      const ratio = f.lineHeight / f.fontSize;
      const range = f.fontSize < LH_SMALL_MAX_FONT ? LH_SMALL_RANGE : LH_LARGE_RANGE;
      if (f.hasThai && ratio < LH_THAI_MIN - LH_EPSILON) {
        emit('R3', 'P1', { ratio, fontSize: f.fontSize, lineHeight: f.lineHeight, min: LH_THAI_MIN });
      } else if (!inRange(ratio, range)) {
        emit('R3', 'P2', { ratio, fontSize: f.fontSize, lineHeight: f.lineHeight, range });
      }
    }
    // R4 (Ruling G)
    if (f.hasThai && (f.overflowClip === 'y' || f.overflowClip === 'both')) {
      // scroll branch fires even with non-finite lineHeight; only the ink branch needs it
      const inkOverflow = finite(f.lineHeight) && f.inkHeight > f.lineHeight + INK_CLIP_SLACK_PX;
      if (inkOverflow || f.scrollOverflowY) {
        emit('R4', 'P1', { inkHeight: f.inkHeight, lineHeight: f.lineHeight, scrollOverflowY: f.scrollOverflowY, overflowClip: f.overflowClip });
      }
    }
    // R5 (Ruling D)
    if (R5_KINDS.includes(f.kind) && f.lines >= 2) {
      emit('R5', ctx.width >= DESKTOP_MIN_WIDTH ? 'P1' : 'P2', { kind: f.kind, lines: f.lines });
    }
    // R6
    if (R6_KINDS.includes(f.kind) && (f.overflowClip === 'x' || f.overflowClip === 'both') && f.scrollOverflowX) {
      emit('R6', 'P2', { kind: f.kind, overflowClip: f.overflowClip, w: f.w });
    }
    // R7 / R7b (Ruling N)
    if (R7_KINDS.includes(f.kind)) {
      const min = ctx.width <= MOBILE_MAX_WIDTH ? TOUCH_MIN_MOBILE : ctx.width >= TABLET_MIN_WIDTH ? TOUCH_MIN_DESKTOP : null;
      if (min !== null && f.h < min) emit('R7', 'P2', { kind: f.kind, h: f.h, min });
    }
    if (f.kind === 'input' && ctx.width <= MOBILE_MAX_WIDTH && f.fontSize < INPUT_MIN_FONT_MOBILE) {
      emit('R7b', 'P2', { fontSize: f.fontSize, min: INPUT_MIN_FONT_MOBILE });
    }
    // R8
    const familyOk = UI_FONT_RE.test(f.fontFamily)
      || (profile.sarabunInReadingBlock && f.inReadingBlock && SARABUN_RE.test(f.fontFamily));
    if (!familyOk) emit('R8', 'P1', { fontFamily: f.fontFamily, inReadingBlock: f.inReadingBlock });
    // R9
    const weight = Number(f.fontWeight);
    if (!profile.weights.includes(weight)) emit('R9', 'P3', { fontWeight: weight, weights: profile.weights });
    // R10 (Ruling M: f.numeric = tabular-nums active; numericOnly flag is the single source)
    if (f.numericOnly && (f.tag === 'td' || f.fontSize >= TNUM_MIN_FONT) && !f.numeric) {
      emit('R10', 'P3', { tag: f.tag, fontSize: f.fontSize });
    }
    // R11
    const badIcons = (f.iconRatios ?? []).filter((r) => r < ICON_RATIO_RANGE[0] || r > ICON_RATIO_RANGE[1]);
    if (badIcons.length) emit('R11', 'P3', { iconRatios: f.iconRatios, outOfRange: badIcons, range: ICON_RATIO_RANGE });
    // R12
    if (f.kind === 'paragraph' && f.lines >= 2 && ctx.width >= MEASURE_MIN_WIDTH && f.w > MEASURE_MAX_EM * f.fontSize) {
      emit('R12', 'P3', { w: f.w, fontSize: f.fontSize, em: f.w / f.fontSize, maxEm: MEASURE_MAX_EM });
    }
  }
  return out;
}

// persisting entries = AFTER finding + `before` (matching BEFORE finding).
// escalated = persisting entries whose severity rank rose (P3 < P2 < P1).
export function diffFindings(before, after, options) {
  const excludeRules = options?.excludeRules ?? NON_DIFF_RULES;
  const keep = (list) => list.filter((f) => !excludeRules.includes(f.rule));
  const b = keep(before), a = keep(after);
  const bMap = new Map(b.map((f) => [findingKey(f), f]));
  const aKeys = new Set(a.map(findingKey));
  const persisting = a.filter((f) => bMap.has(findingKey(f))).map((f) => ({ ...f, before: bMap.get(findingKey(f)) }));
  return {
    added: a.filter((f) => !bMap.has(findingKey(f))),
    resolved: b.filter((f) => !aKeys.has(findingKey(f))),
    persisting,
    escalated: persisting.filter((f) => SEVERITY_RANK[f.severity] > SEVERITY_RANK[f.before.severity]),
  };
}

// DeltaFinding = { rule: 'D1'|'D2', key, kind, text, detail, ...ctx }
// D1 detail: { before, after, change }  (inkWidth px, change = fraction)
// D2 detail: { beforeOffset, afterOffset, beforeH, afterH }
const inkCentreOffset = (f) => f.textTop + f.textHeight / 2 - (f.y + f.h / 2);

export function compareFacts(beforeFacts, afterFacts, ctx = {}) {
  const bKeys = resolveKeys(beforeFacts), aKeys = resolveKeys(afterFacts);
  const byKey = new Map(beforeFacts.map((f, i) => [bKeys[i], f]));
  const out = [];
  for (const [i, a] of afterFacts.entries()) {
    const b = byKey.get(aKeys[i]);
    if (!b) continue;
    const base = { ...ctx, key: aKeys[i], kind: a.kind, text: a.text };
    if (a.text === b.text && b.inkWidth > 0) {
      const change = (a.inkWidth - b.inkWidth) / b.inkWidth;
      if (Math.abs(change) > D1_INK_WIDTH_CHANGE) out.push({ ...base, rule: 'D1', detail: { before: b.inkWidth, after: a.inkWidth, change } });
    }
    if (D2_KINDS.includes(a.kind) && Math.abs(a.h - b.h) <= D2_FIXED_HEIGHT_PX) {
      const beforeOffset = inkCentreOffset(b), afterOffset = inkCentreOffset(a);
      if (Math.abs(afterOffset) > D2_OFFSET_PX && Math.abs(afterOffset) > Math.abs(beforeOffset) + D2_WORSE_BY_PX) {
        out.push({ ...base, rule: 'D2', detail: { beforeOffset, afterOffset, beforeH: b.h, afterH: a.h } });
      }
    }
  }
  return out;
}
